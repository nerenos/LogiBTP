using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using LogiBTP.FactureElectronique.Formats;

namespace LogiBTP.FactureElectronique.Web.Connecteurs;

/// <summary>
/// Statut programmé par la plateforme simulée après un accusé Ok : code (<see cref="StatutCdv"/>), émetteur
/// (<see cref="EmetteurStatut"/>) et motif (<see cref="MotifStatut"/>, obligatoire pour Rejetée, Refusée, En litige…).
/// </summary>
public sealed record StatutProgramme(string Statut, string Emetteur, string? Motif = null);

/// <summary>
/// Règles de démonstration de la plateforme simulée : délai de l'accusé, intervalle entre deux statuts programmés,
/// statuts posés après un accusé Ok (200 → 205 : Déposée et Émise par la PA-E, Reçue et Mise à disposition par la PA-R,
/// Prise en charge et Approuvée par l'acheteur), marqueur du numéro de facture qui provoque un accusé Error, taille
/// maximale d'un fichier.
/// </summary>
public sealed record OptionsPlateformeSimulee
{
    public TimeSpan DelaiAccuse { get; init; } = TimeSpan.FromMinutes(1);
    public TimeSpan IntervalleStatuts { get; init; } = TimeSpan.FromMinutes(2);
    public IReadOnlyList<StatutProgramme> Statuts { get; init; } =
    [
        new(StatutCdv.Deposee, EmetteurStatut.PaE), new(StatutCdv.Emise, EmetteurStatut.PaE),
        new(StatutCdv.Recue, EmetteurStatut.PaR), new(StatutCdv.MiseADisposition, EmetteurStatut.PaR),
        new(StatutCdv.PriseEnCharge, EmetteurStatut.Acheteur), new(StatutCdv.Approuvee, EmetteurStatut.Acheteur),
    ];
    /// <summary>Numéro de facture contenant ce marqueur : accusé Error (OtherTechnicalError), pour la démonstration d'un rejet.</summary>
    public string MarqueurErreur { get; init; } = "REJET";
    public long TailleMaximale { get; init; } = ConnecteurPlateforme.TailleMaximale;
}

/// <summary>
/// Flux tenu localement (plateforme simulée, dépôt manuel) : métadonnées, fichier original, rang de la dernière modification (ordre de la
/// recherche et curseur), accusé définitif et sa date, statuts encore programmés (avec leur échéance), statuts déjà
/// émis (historique du cycle de vie).
/// </summary>
public sealed record FluxLocal(Flux Flux, byte[] Original, long Rang)
{
    public AccuseFlux? AccuseFinal { get; init; }
    public DateTimeOffset? AccuseLe { get; init; }
    public IReadOnlyList<(StatutProgramme Statut, DateTimeOffset Echeance)> AVenir { get; init; } = [];
    public IReadOnlyList<string> Historique { get; init; } = [];
}

/// <summary>
/// Flux tenus localement pour une société (plateforme simulée, dépôts et imports manuels) : flux et compteur de rang.
/// En mémoire (<see cref="MagasinFluxMemoire"/>) dans ce lot ; une implémentation en base pourra la remplacer (lot 8)
/// sans changer la plateforme ni le connecteur manuel.
/// </summary>
public interface IMagasinFlux
{
    /// <summary>Rang suivant (croissant, jamais réutilisé).</summary>
    long RangSuivant();
    /// <summary>Ajoute ou remplace un flux (par son identifiant).</summary>
    void Enregistrer(FluxLocal flux);
    FluxLocal? Trouver(string idFlux);
    /// <summary>Flux dans l'ordre de leur rang.</summary>
    IReadOnlyList<FluxLocal> Tous();
}

/// <summary>Flux tenus en mémoire du processus (perdus au redémarrage).</summary>
public sealed class MagasinFluxMemoire : IMagasinFlux
{
    private readonly ConcurrentDictionary<string, FluxLocal> flux = new();
    private long rang;

    public long RangSuivant() => Interlocked.Increment(ref rang);
    public void Enregistrer(FluxLocal f) => flux[f.Flux.IdFlux] = f;
    public FluxLocal? Trouver(string idFlux) => flux.GetValueOrDefault(idFlux);
    public IReadOnlyList<FluxLocal> Tous() => [.. flux.Values.OrderBy(f => f.Rang)];
}

/// <summary>
/// Plateforme agréée simulée (démonstration et tests, sans réseau) : reçoit les dépôts, rend l'accusé (Pending, puis Ok
/// ou Error après <see cref="OptionsPlateformeSimulee.DelaiAccuse"/>), produit les statuts programmés en CDAR (flux
/// entrants CustomerInvoiceLC écrits par <see cref="Cdar"/>), tient les factures reçues de démonstration et un annuaire.
/// Le temps vient du <see cref="TimeProvider"/> : les événements dus sont produits à chaque consultation.
/// Accusé Error : fichier vide (EmptyFlow), empreinte différente (ChecksumMismatch), identifiant de suivi déjà déposé
/// (AlreadyExistingFlow), syntaxe déclarée différente du contenu (FlowTypeError), XML ou XSD invalide (InvalidSchema),
/// numéro contenant le marqueur d'erreur (OtherTechnicalError).
/// </summary>
public sealed class PlateformeSimulee(IMagasinFlux etat, TimeProvider horloge, OptionsPlateformeSimulee? options = null)
{
    private const string PrefixeCurseur = "rang:";
    private readonly object verrou = new();

    public OptionsPlateformeSimulee Options { get; } = options ?? new OptionsPlateformeSimulee();
    public AnnuaireSimule Annuaire { get; } = new();

    // ---------------------------------------------------------------- dépôt

    /// <summary>Dépôt d'un flux sortant (POST /v1/flows) : accusé Pending, définitif après le délai.</summary>
    public FluxDepose Deposer(FluxADeposer f, string? empreinte)
    {
        lock (verrou)
        {
            Avancer();
            var maintenant = horloge.GetUtcNow();
            var calculee = ConnecteurPlateforme.Empreinte(f.Contenu ?? []);
            var (type, profil, regleCalculee, accuse) = Controler(f, empreinte, calculee);
            var flux = new Flux(
                NouvelId(), f.IdentifiantSuivi, f.Nom, f.Syntaxe, f.Profil ?? profil, f.RegleTraitement ?? regleCalculee,
                f.RegleTraitement is null ? OrigineRegle.Calculee : OrigineRegle.Fournie, type, SensFlux.Sortant, maintenant, maintenant,
                AccuseFlux.EnAttente) { Empreinte = calculee };
            var accuseLe = maintenant + Options.DelaiAccuse;
            var aVenir = accuse.Etat == EtatAccuse.Ok && type is TypeFlux.FactureClient or TypeFlux.FactureFournisseur
                ? Options.Statuts.Select((s, i) => (s, accuseLe + Options.IntervalleStatuts * (i + 1))).ToList()
                : [];
            etat.Enregistrer(new FluxLocal(flux, f.Contenu ?? [], etat.RangSuivant()) { AccuseFinal = accuse, AccuseLe = accuseLe, AVenir = aVenir });
            Avancer();
            return new FluxDepose(flux.IdFlux, flux.DeposeLe, flux.IdentifiantSuivi, flux.Nom, flux.Syntaxe)
            {
                Profil = flux.Profil, RegleTraitement = flux.RegleTraitement, Empreinte = calculee,
            };
        }
    }

    /// <summary>Facture reçue de démonstration (flux entrant SupplierInvoice, accusé Ok) : lue pour la syntaxe et le profil.</summary>
    public Flux RecevoirFacture(byte[] contenu, string nom, string regle = RegleTraitement.B2B)
    {
        var lue = Lecture.Lire(contenu);
        return Recevoir(contenu, nom, lue.Syntaxe, lue.Facture.Profil, TypeFlux.FactureFournisseur, regle);
    }

    /// <summary>Statut reçu de démonstration (flux entrant CDAR) sur une facture émise (CustomerInvoiceLC) ou reçue (SupplierInvoiceLC).</summary>
    public Flux RecevoirStatut(byte[] cdar, string nom, string type = TypeFlux.CdvFactureClient)
    {
        Cdar.Lire(cdar);
        return Recevoir(cdar, nom, Syntaxe.Cdar, ProfilFacture.NonDefini, type, RegleTraitement.B2B);
    }

    private Flux Recevoir(byte[] contenu, string nom, string syntaxe, string profil, string type, string regle)
    {
        lock (verrou)
        {
            Avancer();
            var maintenant = horloge.GetUtcNow();
            var flux = new Flux(NouvelId(), null, nom, syntaxe, profil, regle, OrigineRegle.Calculee, type, SensFlux.Entrant,
                maintenant, maintenant, new AccuseFlux(EtatAccuse.Ok, [])) { Empreinte = ConnecteurPlateforme.Empreinte(contenu) };
            etat.Enregistrer(new FluxLocal(flux, contenu, etat.RangSuivant()));
            return flux;
        }
    }

    // ---------------------------------------------------------------- consultation

    /// <summary>Recherche (POST /v1/flows/search) dans l'ordre des modifications ; curseur = rang de la dernière modification rendue.</summary>
    public PageFlux Rechercher(CriteresFlux c, string? curseur, int limite)
    {
        lock (verrou)
        {
            Avancer();
            return Page(etat, c, curseur, limite);
        }
    }

    /// <summary>Page d'une recherche dans un magasin de flux, dans l'ordre des rangs (curseur « rang:N »).</summary>
    internal static PageFlux Page(IMagasinFlux magasin, CriteresFlux c, string? curseur, int limite)
    {
        var depuis = LireCurseur(curseur);
        var retenus = magasin.Tous().Where(f => f.Rang > depuis && Retenu(f.Flux, c)).ToList();
        var page = retenus.Take(limite).ToList();
        return new PageFlux([.. page.Select(f => f.Flux)], retenus.Count > limite ? PrefixeCurseur + page[^1].Rang.ToString(CultureInfo.InvariantCulture) : null);
    }

    /// <summary>Métadonnées d'un flux (RESSOURCE_INTROUVABLE si inconnu).</summary>
    public Flux Lire(string idFlux)
    {
        lock (verrou)
        {
            Avancer();
            return Trouver(idFlux).Flux;
        }
    }

    /// <summary>
    /// Fichier d'un flux : Original ; Converted pour un Factur-X (XML CII embarqué) ; ReadableView pour une facture
    /// (résumé en texte). RESSOURCE_INTROUVABLE si le document n'existe pas.
    /// </summary>
    public FichierFlux Telecharger(string idFlux, string typeDocument)
    {
        FluxLocal f;
        lock (verrou)
        {
            Avancer();
            f = Trouver(idFlux);
        }
        var nom = Path.GetFileNameWithoutExtension(f.Flux.Nom);
        switch (typeDocument)
        {
            case TypeDocumentFlux.Original:
                return new FichierFlux(f.Original, f.Flux.Nom, f.Flux.Syntaxe == Syntaxe.FacturX ? "application/pdf" : "application/xml");
            case TypeDocumentFlux.Converti when f.Flux.Syntaxe == Syntaxe.FacturX:
                return new FichierFlux(ExtractionFacturX.Extraire(f.Original), nom + ".xml", "application/xml");
            case TypeDocumentFlux.Lisible when f.Flux.Syntaxe is Syntaxe.Cii or Syntaxe.Ubl or Syntaxe.FacturX:
                return new FichierFlux(Lisible(Lecture.Lire(f.Original, validerXsd: false).Facture), nom + ".txt", "text/plain");
            default:
                throw new ExceptionConnecteur(ErreurFe.RessourceIntrouvable, $"Document {typeDocument} absent du flux {idFlux}", 404);
        }
    }

    // ---------------------------------------------------------------- règles de démonstration

    private (string Type, string Profil, string Regle, AccuseFlux Accuse) Controler(FluxADeposer f, string? empreinte, string calculee)
    {
        var type = TypeFlux.FactureClient;
        var profil = ProfilFacture.NonDefini;
        var regle = RegleTraitement.B2B;
        AccuseFlux Erreur(string element, string motif, string message) =>
            new(EtatAccuse.Erreur, [new DetailAccuse(NiveauAccuse.Erreur, element, motif, message)]);

        if (f.Syntaxe == Syntaxe.Cdar) type = TypeFlux.CdvFactureFournisseur;
        if (f.Contenu is null || f.Contenu.Length == 0) return (type, profil, regle, Erreur("file", MotifAccuse.FluxVide, "Empty flow"));
        if (f.Contenu.LongLength > Options.TailleMaximale) return (type, profil, regle, Erreur("file", MotifAccuse.TailleDepassee, "File size exceeded"));
        if (empreinte is not null && empreinte != calculee)
            return (type, profil, regle, Erreur("sha256", MotifAccuse.Empreinte, "Checksum provided is different from computed one"));
        if (f.IdentifiantSuivi is not null && etat.Tous().Any(x => x.Flux.Sens == SensFlux.Sortant && x.Flux.IdentifiantSuivi == f.IdentifiantSuivi))
            return (type, profil, regle, Erreur("trackingId", MotifAccuse.FluxExistant, "The flow has already been sent and received"));
        // E-reporting (flux 10, lots 19 et 28) : non lu par la plateforme simulée ; refusé si le marqueur figure dans le XML.
        if (f.Syntaxe == Syntaxe.Frr)
        {
            return !string.IsNullOrEmpty(Options.MarqueurErreur)
                   && System.Text.Encoding.UTF8.GetString(f.Contenu).Contains(Options.MarqueurErreur, StringComparison.OrdinalIgnoreCase)
                ? (TypeFlux.NonDefini, profil, regle, Erreur("file", MotifAccuse.AutreErreurTechnique, "Rejected by the simulated platform (demonstration)"))
                : (TypeFlux.NonDefini, profil, regle, new AccuseFlux(EtatAccuse.Ok, []));
        }
        try
        {
            var detectee = Lecture.Detecter(f.Contenu);
            if (detectee != f.Syntaxe)
                return (type, profil, regle, Erreur("flowSyntax", MotifAccuse.TypeFlux, $"Declared syntax {f.Syntaxe}, found {detectee}"));
            if (f.Syntaxe == Syntaxe.Cdar)
            {
                var m = Cdar.Lire(f.Contenu);
                // Statut posé par le vendeur (Encaissée) : cycle de vie d'une facture émise ; sinon d'une facture reçue.
                if (m.Emetteur?.Role == RoleCdar.Vendeur) type = TypeFlux.CdvFactureClient;
                return (type, profil, regle, new AccuseFlux(EtatAccuse.Ok, []));
            }
            var facture = Lecture.Lire(f.Contenu).Facture;
            profil = facture.Profil;
            if (EstAutofacture(facture.TypeFacture)) type = TypeFlux.FactureFournisseur;
            if (!string.IsNullOrEmpty(Options.MarqueurErreur) && facture.Numero.Contains(Options.MarqueurErreur, StringComparison.OrdinalIgnoreCase))
                return (type, profil, regle, Erreur("BT-1", MotifAccuse.AutreErreurTechnique, "Rejected by the simulated platform (demonstration)"));
            return (type, profil, regle, new AccuseFlux(EtatAccuse.Ok, []));
        }
        catch (ExceptionLectureFacture e)
        {
            return (type, profil, regle, Erreur("file", MotifAccuse.SchemaInvalide, e.Message));
        }
        catch (ExceptionCdar e)
        {
            return (type, profil, regle, Erreur("file", MotifAccuse.SchemaInvalide, e.Message));
        }
    }

    private static bool EstAutofacture(string type) => type is TypeFacture.Autofacture or TypeFacture.AutofactureAffacturee
        or TypeFacture.AcompteAutofacture or TypeFacture.RectificativeAutofacturee or TypeFacture.RectificativeAutofactureeAffacturee
        or TypeFacture.AvoirAutofacture;

    /// <summary>Produit les accusés et les statuts dus, dans l'ordre de leur échéance.</summary>
    private void Avancer()
    {
        var maintenant = horloge.GetUtcNow();
        while (true)
        {
            var dus = etat.Tous()
                .Select(f => (f, Echeance: f.AccuseFinal is not null && f.AccuseLe <= maintenant ? f.AccuseLe : f.AccuseFinal is null && f.AVenir.Count > 0 && f.AVenir[0].Echeance <= maintenant ? f.AVenir[0].Echeance : null))
                .Where(x => x.Echeance is not null).OrderBy(x => x.Echeance).ThenBy(x => x.f.Rang).ToList();
            if (dus.Count == 0) return;
            var (flux, echeance) = dus[0];
            if (flux.AccuseFinal is not null)
            {
                etat.Enregistrer(flux with
                {
                    Flux = flux.Flux with { Accuse = flux.AccuseFinal, ModifieLe = echeance!.Value }, AccuseFinal = null, AccuseLe = null,
                    Rang = etat.RangSuivant(),
                });
                continue;
            }
            var (statut, quand) = flux.AVenir[0];
            byte[] cdar;
            try
            {
                cdar = EcrireStatut(flux, statut, quand);
            }
            catch (Exception e) when (e is ExceptionCdar or ExceptionLectureFacture)
            {
                // Facture sans les données d'un CDAR (SIREN, adresse électronique) : la démonstration s'arrête là.
                etat.Enregistrer(flux with { AVenir = [] });
                continue;
            }
            etat.Enregistrer(flux with { AVenir = [.. flux.AVenir.Skip(1)], Historique = [.. flux.Historique, statut.Statut] });
            var nom = $"{Path.GetFileNameWithoutExtension(flux.Flux.Nom)}_CDV-{statut.Statut}.xml";
            var lc = flux.Flux.Type == TypeFlux.FactureClient ? TypeFlux.CdvFactureClient : TypeFlux.CdvFactureFournisseur;
            var recu = new Flux(NouvelId(), null, nom, Syntaxe.Cdar, ProfilFacture.NonDefini, flux.Flux.RegleTraitement, OrigineRegle.Calculee,
                lc, SensFlux.Entrant, quand, quand, new AccuseFlux(EtatAccuse.Ok, [])) { Empreinte = ConnecteurPlateforme.Empreinte(cdar) };
            etat.Enregistrer(new FluxLocal(recu, cdar, etat.RangSuivant()));
        }
    }

    /// <summary>CDAR d'un statut programmé, adressé au vendeur de la facture déposée.</summary>
    private static byte[] EcrireStatut(FluxLocal flux, StatutProgramme s, DateTimeOffset quand)
    {
        var f = Lecture.Lire(flux.Original, validerXsd: false).Facture;
        PartieCdar Partie(Partie p, string? role) => new(role, p.Siren, p.Siren is null ? null : SchemaIdentifiant.Siren, p.RaisonSociale,
            p.AdresseElectronique?.Valeur ?? p.Siren, p.AdresseElectronique?.Schema ?? SchemaIdentifiant.AdresseElectronique);
        var auteur = s.Emetteur == EmetteurStatut.Acheteur ? Partie(f.Acheteur, null) : new PartieCdar(null);
        var reference = new FactureReferencee(f.Numero, f.TypeFacture, f.DateEmission, f.Vendeur.Siren, flux.Flux.DeposeLe.UtcDateTime);
        var date = quand.UtcDateTime;
        return Cdar.Ecrire(new StatutAEcrire(SensFacture.Emise, s.Statut, s.Emetteur, reference, auteur, [Partie(f.Vendeur, RoleCdar.Vendeur)], date, date)
        {
            Historique = flux.Historique, Motif = s.Motif,
        });
    }

    private static byte[] Lisible(Facture f)
    {
        var t = new StringBuilder()
            .AppendLine(CultureInfo.InvariantCulture, $"{f.TypeFacture} {f.Numero} {f.DateEmission:yyyy-MM-dd}")
            .AppendLine(CultureInfo.InvariantCulture, $"{f.Vendeur.RaisonSociale} ({f.Vendeur.Siren})")
            .AppendLine(CultureInfo.InvariantCulture, $"{f.Acheteur.RaisonSociale} ({f.Acheteur.Siren})")
            .AppendLine(CultureInfo.InvariantCulture, $"{f.Totaux.TotalTtc.ToString(CultureInfo.InvariantCulture)} {f.Devise}");
        return Encoding.UTF8.GetBytes(t.ToString());
    }

    private static bool Retenu(Flux f, CriteresFlux c) =>
        (c.ModifieApres is null || f.ModifieLe > c.ModifieApres) && (c.ModifieAvant is null || f.ModifieLe < c.ModifieAvant)
        && (c.Regles.Count == 0 || c.Regles.Contains(f.RegleTraitement)) && (c.Types.Count == 0 || c.Types.Contains(f.Type))
        && (c.Sens.Count == 0 || c.Sens.Contains(f.Sens)) && (c.IdentifiantSuivi is null || c.IdentifiantSuivi == f.IdentifiantSuivi)
        && (c.EtatAccuse is null || c.EtatAccuse == f.Accuse.Etat);

    private static long LireCurseur(string? curseur)
    {
        if (curseur is null) return 0;
        if (curseur.StartsWith(PrefixeCurseur, StringComparison.Ordinal)
            && long.TryParse(curseur.AsSpan(PrefixeCurseur.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var r))
            return r;
        throw new ExceptionConnecteur(ErreurFe.RequeteRefusee, "Curseur inconnu de la plateforme simulée", 400);
    }

    private FluxLocal Trouver(string idFlux) => Trouver(etat, idFlux);

    internal static FluxLocal Trouver(IMagasinFlux magasin, string idFlux) =>
        magasin.Trouver(idFlux) ?? throw new ExceptionConnecteur(ErreurFe.RessourceIntrouvable, $"Flux {idFlux} introuvable", 404);

    internal static string NouvelId() => Guid.NewGuid().ToString();
}

/// <summary>Registre des plateformes simulées, une par base de société (singleton de l'application).</summary>
public sealed class PlateformesSimulees(TimeProvider horloge, Func<string, IMagasinFlux>? magasin = null, OptionsPlateformeSimulee? options = null)
{
    private readonly ConcurrentDictionary<string, PlateformeSimulee> plateformes = new();

    public PlateformeSimulee Pour(string base_) =>
        plateformes.GetOrAdd(base_, b => new PlateformeSimulee(magasin?.Invoke(b) ?? new MagasinFluxMemoire(), horloge, options));
}
