using System.Text.Json;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.FactureElectronique.Web;

/// <summary>Paramètres du module (lecture et enregistrement).</summary>
public sealed record ParametresFeDto(
    bool Actif, string Connecteur, long? ConnexionOauth, string? AdresseFlux, string? AdresseAnnuaire, string? Organisation,
    string? AdresseElectronique, string SchemaAdresse, string Syntaxe, string Profil, int FrequenceReleve, int DelaiSecondes,
    string DecoupageEreporting)
{
    /// <summary>Connecteurs disponibles (lecture seule).</summary>
    public IReadOnlyList<string> Connecteurs { get; init; } = [];

    /// <summary>Statuts posés gardés au journal sans CDAR envoyé (ReglesParametresFe.StatutsParametrables).</summary>
    public IReadOnlyList<string> StatutsNonEnvoyes { get; init; } = [];
}

/// <summary>Flux (liste et détail).</summary>
public sealed record FluxDto(
    long Id, string Sens, string Type, string Syntaxe, string? Profil, string? Regle, string Nom, string? Numero, string? IdSuivi,
    string? IdFlux, string Connecteur, string Empreinte, long? GedOriginalId, long? GedConvertiId, long? GedLisibleId, string? TypeElement,
    string? IdElement, string Etat, string? Accuse, JsonElement? AccuseDetails, int Essais, DateTimeOffset? ProchainEssai,
    string? DerniereErreur, DateTimeOffset? DeposeLe, DateTimeOffset? ModifiePaLe, DateTimeOffset CreeLe, string? StatutAffiche, bool HorsPlateforme = false);

/// <summary>Statut d'une facture.</summary>
public sealed record StatutDto(
    long Id, long? FluxId, string NumeroFacture, string SensFacture, string Code, string? Motif, string? Action, decimal? Montant,
    decimal? Taux, string? Emetteur, string Sens, long? FluxCdarId, long? GedCdarId, DateTimeOffset Date, JsonElement Erreurs);

/// <summary>Erreur d'un flux.</summary>
public sealed record ErreurDto(long Id, string Code, string? Niveau, string? Element, string? Message, int? StatutHttp, string? RequestId,
    int Essai, DateTimeOffset CreeLe);

/// <summary>Fichier gardé pour un flux (sans son contenu).</summary>
public sealed record FichierDto(string Document, string Nom, string TypeMime, long Taille, string Empreinte);

/// <summary>Détail d'un flux : statuts, erreurs, fichiers, chronologie.</summary>
public sealed record FluxDetailDto(FluxDto Flux, List<StatutDto> Statuts, List<ErreurDto> Erreurs, List<FichierDto> Fichiers, List<EvenementDto> Chronologie);

/// <summary>Filtre de la liste des flux (<see cref="Erreurs"/> : avec ou sans erreur enregistrée ; <see cref="Du"/> / <see cref="Au"/> : jours de création, bornes comprises, en UTC ; page par identifiant décroissant : <see cref="Avant"/> = dernier identifiant de la page précédente).</summary>
public sealed record FiltreFlux(string? Sens = null, string? Etat = null, string? Type = null, string? TypeElement = null, string? IdElement = null,
    long? Avant = null, int? Limite = null, bool? Erreurs = null, DateOnly? Du = null, DateOnly? Au = null);

/// <summary>
/// Flux à émettre, produit par l'application : contenu et nom ; syntaxe (détectée si absente), profil et numéro (lus
/// d'une facture si absents), règle de traitement, identifiant de suivi (trackingId, unique ; tiré au hasard si absent),
/// type de flux (déduit de la syntaxe si absent), élément de l'application.
/// </summary>
public sealed record FluxAEmettre(byte[] Contenu, string Nom)
{
    public string? Syntaxe { get; init; }
    public string? Profil { get; init; }
    public string? Regle { get; init; }
    public string? IdSuivi { get; init; }
    public string? Type { get; init; }
    public string? Numero { get; init; }
    public string? TypeElement { get; init; }
    public string? IdElement { get; init; }
}

/// <summary>Confirmation d'un dépôt manuel : accusé Ok ou Error rendu par le portail de la PA, motif et message d'un refus.</summary>
public sealed record ConfirmationDepot(string Etat, string? Motif = null, string? Message = null);

/// <summary>
/// Import manuel d'un fichier reçu hors connexion : nom, contenu en base 64, type du statut (CDAR). Hors plateforme
/// (lot 14 : facture glissée sur une liste ou une pièce, reçue en dehors de toute plateforme) : facture seule, aucun
/// statut posé envoyé.
/// </summary>
public sealed record ImportManuel(string Nom, string Contenu, string? TypeStatut = null, bool HorsPlateforme = false);

/// <summary>
/// Statut posé par la société sur une facture : code, motif, action, montant et taux (Encaissée), commentaire (note du
/// CDAR) ; CDAR déjà écrit à déposer (sinon écrit par le module), origine dans l'application (journal, sans contrôle).
/// </summary>
public sealed record StatutAPoser(string Code, string? Motif = null, string? Action = null, decimal? Montant = null, decimal? Taux = null)
{
    public string? Commentaire { get; init; }
    public byte[]? Cdar { get; init; }
    public string? NomCdar { get; init; }
    public object? Origine { get; init; }
}

/// <summary>Statut demandé par un utilisateur (route POST /flux/{id}/statut) : code, motif de la liste autorisée, action, commentaire.</summary>
public sealed record DemandeStatut(string Code, string? Motif = null, string? Action = null, string? Commentaire = null);

/// <summary>Ligne d'annuaire retenue pour un tiers : trouvée ou non, adresse, type de plateforme (WK, DFH), code de routage, suffixe.</summary>
public sealed record ResultatAnnuaireFe(bool Trouve, string? Adresse, string? TypePlateforme, string? CodeRoutage, string? Suffixe);

/// <summary>
/// Services du module Facturation électronique sur la base de la société courante : paramètres, mise en file d'un flux
/// à émettre, enregistrement des flux reçus (factures, statuts CDAR), accusés des flux déposés, consultation (liste,
/// détail, fichier, chronologie), dépôt et import manuels, nouvelle tentative, statut posé, vérification du journal.
/// Chaque étape et chaque changement d'état est inscrit au journal (<see cref="JournalFe"/>) dans la même transaction.
/// </summary>
public class ServiceFactureElectronique(
    FactureElectroniqueDbContext db, SpecialisationFactureElectronique specialisation, FabriqueConnecteurs fabrique, SocieteCourante societe,
    DepotsManuels depotsManuels, TimeProvider? horloge = null)
{
    private static readonly string[] SyntaxesFacture = [Syntaxe.Cii, Syntaxe.Ubl, Syntaxe.FacturX];
    private static readonly string[] TypesFacture = [TypeFlux.FactureClient, TypeFlux.FactureFournisseur];

    public FactureElectroniqueDbContext Db => db;
    public SpecialisationFactureElectronique Specialisation => specialisation;
    public DateTimeOffset Maintenant => (horloge ?? TimeProvider.System).GetUtcNow();

    /// <summary>Nom de la base de la société (état par base des connecteurs).</summary>
    public string Base => societe.Base ?? throw new ExceptionConnecteur(ErreurFe.ParametreConnecteur, "Base de la société absente de la connexion");

    // ---------------------------------------------------------------- paramètres et connecteur

    public async Task<ParametreFe> ParametreAsync(CancellationToken ct) =>
        await db.Parametres.FirstOrDefaultAsync(ct) ?? new ParametreFe();

    public async Task<ParametresFeDto> Parametres(CancellationToken ct) => Dto(await ParametreAsync(ct));

    private ParametresFeDto Dto(ParametreFe p) => new(p.FpaActif, p.FpaConnecteur, p.FpaConnexionOauth, p.FpaAdresseFlux, p.FpaAdresseAnnuaire,
        p.FpaOrganisation, p.FpaAdresseElectronique, p.FpaSchemaAdresse, p.FpaSyntaxe, p.FpaProfil, p.FpaFrequenceReleve, p.FpaDelaiSecondes,
        p.FpaDecoupageEreporting) { Connecteurs = fabrique.Codes, StatutsNonEnvoyes = p.FpaStatutsNonEnvoyes };

    /// <summary>Enregistre les paramètres (droit de paramétrage ; PARAMETRE_INVALIDE si incohérents).</summary>
    public async Task<ParametresFeDto> EnregistrerParametres(ParametresFeDto d, Utilisateur u, CancellationToken ct)
    {
        specialisation.ExigerParametrage(u);
        var champs = ReglesParametresFe.Controler(d, fabrique.Codes);
        if (champs.Count > 0)
            throw ExceptionMetier.Invalide(ErreurFe.ParametreInvalide, string.Join(" ; ", champs.Select(c => $"{c} : {ReglesParametresFe.Messages[c]}")));

        var p = await db.Parametres.FirstOrDefaultAsync(ct);
        if (p is null) db.Parametres.Add(p = new ParametreFe());
        p.FpaActif = d.Actif;
        p.FpaConnecteur = d.Connecteur;
        p.FpaConnexionOauth = d.ConnexionOauth;
        p.FpaAdresseFlux = Vide(d.AdresseFlux);
        p.FpaAdresseAnnuaire = Vide(d.AdresseAnnuaire);
        p.FpaOrganisation = Vide(d.Organisation);
        p.FpaAdresseElectronique = Vide(d.AdresseElectronique);
        p.FpaSchemaAdresse = string.IsNullOrWhiteSpace(d.SchemaAdresse) ? SchemaIdentifiant.AdresseElectronique : d.SchemaAdresse;
        p.FpaSyntaxe = d.Syntaxe;
        p.FpaProfil = d.Profil;
        p.FpaFrequenceReleve = d.FrequenceReleve;
        p.FpaDelaiSecondes = d.DelaiSecondes;
        p.FpaDecoupageEreporting = d.DecoupageEreporting;
        p.FpaStatutsNonEnvoyes = [.. (d.StatutsNonEnvoyes ?? []).Distinct().Order(StringComparer.Ordinal)];
        p.FpaModifieLe = Maintenant;
        p.FpaModifiePar = u.Code;
        await db.SaveChangesAsync(ct);
        return Dto(p);
    }

    private static string? Vide(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>Connecteur des paramètres de la société.</summary>
    public async Task<ConnecteurPlateforme> ConnecteurAsync(CancellationToken ct) => Connecteur(await ParametreAsync(ct));

    public ConnecteurPlateforme Connecteur(ParametreFe p) => fabrique.Creer(new ParametresConnecteur(p.FpaConnecteur, Base)
    {
        AdresseFlux = p.FpaAdresseFlux is null ? null : new Uri(p.FpaAdresseFlux),
        AdresseAnnuaire = p.FpaAdresseAnnuaire is null ? null : new Uri(p.FpaAdresseAnnuaire),
        ConnexionOAuth = p.FpaConnexionOauth,
        Organisation = p.FpaOrganisation,
        Delai = TimeSpan.FromSeconds(p.FpaDelaiSecondes),
    });

    /// <summary>Connecteur du dépôt manuel de la société (import de fichiers reçus hors connexion).</summary>
    public ConnecteurManuel ConnecteurManuel() => new(depotsManuels.Pour(Base), horloge ?? TimeProvider.System);

    /// <summary>Disponibilité de la plateforme (healthcheck).</summary>
    public async Task<EtatSante> Sante(CancellationToken ct) => await (await ConnecteurAsync(ct)).SanteAsync(ct);

    /// <summary>
    /// Interroge l'annuaire (Directory Service) de la plateforme pour un SIREN (et un SIRET facultatif) : ligne active la plus
    /// précise (SIRET identique, puis ligne sans SIRET ni suffixe, puis première) ; aucune ligne active : <c>Trouve</c> faux.
    /// </summary>
    public async Task<ResultatAnnuaireFe> InterrogerAnnuaireAsync(string siren, string? siret, CancellationToken ct)
    {
        var connecteur = await ConnecteurAsync(ct);
        var r = await connecteur.RechercherLignesAnnuaireAsync(new RechercheAnnuaire([new FiltreAnnuaire("siren", siren)]) { Limite = 50 }, ct);
        return ChoisirLigneAnnuaire(r.Resultats, siret);
    }

    /// <summary>Choix de la ligne d'annuaire d'un tiers (règle de <see cref="InterrogerAnnuaireAsync"/>).</summary>
    public static ResultatAnnuaireFe ChoisirLigneAnnuaire(IEnumerable<LigneAnnuaire> lignes, string? siret)
    {
        var l = lignes.Where(x => x.Etat == EtatLigneAnnuaire.Active)
            .OrderBy(x => !string.IsNullOrEmpty(siret) && x.Siret == siret ? 0 : x.Siret is null && x.Suffixe is null ? 1 : 2)
            .ThenBy(x => x.IdentifiantAdressage, StringComparer.Ordinal).FirstOrDefault();
        return l is null ? new(false, null, null, null, null)
            : new(true, l.IdentifiantAdressage, l.TypePlateforme, l.IdentifiantRoutage, l.Suffixe);
    }

    // ---------------------------------------------------------------- émission : mise en file

    /// <summary>
    /// Met un flux en file (A_ENVOYER, dépôt par <see cref="FileFlux"/>) : fichier gardé et rangé, étape PRODUCTION.
    /// Même identifiant de suivi et même contenu : le flux existant est rendu (doublon sans effet) ; contenu différent : 409.
    /// </summary>
    public Task<FluxDto> MettreEnFileAsync(FluxAEmettre a, Utilisateur? u, CancellationToken ct) =>
        MettreEnFileAsync(a, u is null ? ActeurFe.Systeme : ActeurFe.Utilisateur, u?.Code, ct);

    private async Task<FluxDto> MettreEnFileAsync(FluxAEmettre a, string acteur, string? utilisateur, CancellationToken ct)
    {
        if (a.Contenu is null || a.Contenu.Length == 0) throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Fichier vide");
        if (string.IsNullOrWhiteSpace(a.Nom) || a.Nom.Length > ConnecteurPlateforme.LongueurNom)
            throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Nom du fichier vide ou trop long");
        if (a.IdSuivi is { Length: > ConnecteurPlateforme.LongueurIdentifiant })
            throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Identifiant de suivi de 64 caractères au plus");
        if ((a.TypeElement is null) != (a.IdElement is null)) throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Élément : type et identifiant");
        var empreinte = ConnecteurPlateforme.Empreinte(a.Contenu);
        if (a.IdSuivi is not null && await Doublon(a.IdSuivi, empreinte, ct) is { } existant) return existant;

        string syntaxe;
        string? profil = a.Profil, numero = a.Numero;
        try
        {
            syntaxe = a.Syntaxe ?? Lecture.Detecter(a.Contenu);
            if (SyntaxesFacture.Contains(syntaxe) && (profil is null || numero is null))
            {
                var f = Lecture.Lire(a.Contenu, validerXsd: false).Facture;
                profil ??= f.Profil;
                numero ??= f.Numero;
            }
        }
        catch (ExceptionLectureFacture e)
        {
            throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, $"{e.Code} : {e.Message}");
        }
        var type = a.Type ?? syntaxe switch
        {
            Syntaxe.Cdar => TypeFlux.CdvFactureFournisseur,
            Syntaxe.Frr => TypeFlux.NonDefini,
            _ => TypeFlux.FactureClient,
        };
        var p = await ParametreAsync(ct);
        var maintenant = Maintenant;
        var flux = new FluxFe
        {
            FflSens = SensFlux.Sortant, FflType = type, FflSyntaxe = syntaxe, FflProfil = profil, FflRegle = a.Regle, FflNom = a.Nom,
            FflNumero = numero, FflIdSuivi = a.IdSuivi ?? Guid.NewGuid().ToString("N"), FflConnecteur = p.FpaConnecteur, FflEmpreinte = empreinte,
            FflTypeElement = a.TypeElement, FflIdElement = a.IdElement, FflEtat = EtatFlux.AEnvoyer, FflProchainEssai = maintenant,
            FflCreeLe = maintenant, FflModifieLe = maintenant, FflCreePar = utilisateur ?? "",
        };
        // Dans la transaction en cours s'il y en a une (statut posé à la réception), sinon dans la sienne.
        await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        db.Flux.Add(flux);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException e) when (tx is not null && e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            await tx.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            return await Doublon(flux.FflIdSuivi, empreinte, ct)
                ?? throw new InvalidOperationException($"Flux {flux.FflIdSuivi} : doublon introuvable", e);
        }
        var fichier = new FichierFlux(a.Contenu, a.Nom, TypeMime(syntaxe));
        await GarderFichierAsync(flux, TypeDocumentFlux.Original, fichier, ct);
        await JournalFe.AjouterAsync(db, EtapeFe.Du(flux, EvenementFe.Production, acteur, utilisateur) with
        {
            EtatApres = EtatFlux.AEnvoyer,
            Detail = new { flux.FflNom, flux.FflSyntaxe, flux.FflProfil, flux.FflType, flux.FflIdSuivi, flux.FflEmpreinte, taille = a.Contenu.Length, flux.FflConnecteur },
        }, ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return await DtoAsync(flux, ct);
    }

    private async Task<FluxDto?> Doublon(string idSuivi, string empreinte, CancellationToken ct)
    {
        var f = await db.Flux.AsNoTracking().FirstOrDefaultAsync(x => x.FflIdSuivi == idSuivi, ct);
        if (f is null) return null;
        if (f.FflEmpreinte != empreinte)
            throw ExceptionMetier.Conflit(ErreurFe.DemandeInvalide, $"Identifiant de suivi {idSuivi} déjà employé pour un autre fichier");
        return await DtoAsync(f, ct);
    }

    internal static string TypeMime(string syntaxe) => syntaxe == Syntaxe.FacturX ? "application/pdf" : "application/xml";

    /// <summary>Garde un fichier du flux (fe_fichier) et le fait ranger en GED par l'application.</summary>
    internal async Task GarderFichierAsync(FluxFe flux, string document, FichierFlux fichier, CancellationToken ct)
    {
        if (!await db.Fichiers.AnyAsync(x => x.FfiFflId == flux.FflId && x.FfiDocument == document, ct))
        {
            db.Fichiers.Add(new FichierFe
            {
                FfiFflId = flux.FflId, FfiDocument = document, FfiNom = fichier.Nom ?? flux.FflNom, FfiTypeMime = fichier.TypeMime ?? TypeMime(flux.FflSyntaxe),
                FfiEmpreinte = ConnecteurPlateforme.Empreinte(fichier.Contenu), FfiContenu = fichier.Contenu, FfiCreeLe = Maintenant,
            });
        }
        var ged = await specialisation.RangerAsync(flux, document, fichier, ct);
        if (ged is long g)
        {
            switch (document)
            {
                case TypeDocumentFlux.Original: flux.FflGedOriginalId = g; break;
                case TypeDocumentFlux.Converti: flux.FflGedConvertiId = g; break;
                case TypeDocumentFlux.Lisible: flux.FflGedLisibleId = g; break;
            }
        }
        await db.SaveChangesAsync(ct);
    }

    // ---------------------------------------------------------------- erreurs et accusés

    /// <summary>Erreur d'un flux (fe_erreur) ; message passé par le masquage.</summary>
    internal void AjouterErreur(FluxFe f, string code, string? message, string? niveau = null, string? element = null, int? statutHttp = null,
        string? requestId = null)
    {
        db.Erreurs.Add(new ErreurFluxFe
        {
            FerFflId = f.FflId, FerCode = code.Length > 60 ? code[..60] : code, FerNiveau = niveau, FerElement = element, FerMessage = Masquage.Texte(message),
            FerStatutHttp = statutHttp, FerRequestId = requestId, FerEssai = f.FflEssais, FerCreeLe = Maintenant,
        });
        f.FflDerniereErreur = Masquage.Texte($"{code} : {message}");
    }

    /// <summary>
    /// Accusé d'un flux déposé (relève, confirmation manuelle) : Ok → ACQUITTE ; Error → ERREUR (détails en fe_erreur,
    /// signalement), sauf un refus pour flux déjà déposé seulement (AlreadyExistingFlow), tenu pour un succès ; Pending :
    /// rien. Étape ACCUSE. Rend vrai si le flux a changé d'état.
    /// </summary>
    internal async Task<bool> AppliquerAccuseAsync(FluxFe f, Flux meta, string acteur, string? utilisateur, CancellationToken ct)
    {
        if (f.FflEtat != EtatFlux.Envoye || meta.Accuse.Etat == EtatAccuse.EnAttente) return false;
        var details = meta.Accuse.Details;
        var dejaDepose = meta.Accuse.Etat == EtatAccuse.Erreur && details.Count > 0 && details.All(d => d.Motif == MotifAccuse.FluxExistant);
        var avant = f.FflEtat;
        var succes = meta.Accuse.Etat == EtatAccuse.Ok || dejaDepose;
        f.FflEtat = succes ? EtatFlux.Acquitte : EtatFlux.Erreur;
        f.FflAccuse = meta.Accuse.Etat;
        f.FflAccuseDetails = details.Count == 0 ? null : JsonSerializer.Serialize(details, JsonCalcul.Options);
        f.FflModifiePaLe = meta.ModifieLe;
        f.FflModifieLe = Maintenant;
        if (!succes)
            foreach (var d in details) AjouterErreur(f, d.Motif, d.Message, d.Niveau, d.Element);
        await db.SaveChangesAsync(ct);
        await JournalFe.AjouterAsync(db, EtapeFe.Du(f, EvenementFe.Accuse, acteur, utilisateur) with
        {
            EtatAvant = avant, EtatApres = f.FflEtat,
            Detail = new { accuse = meta.Accuse.Etat, deja_depose = dejaDepose, details, id_flux = meta.IdFlux, modifie_le = meta.ModifieLe },
        }, ct);
        if (!succes)
            await specialisation.SignalerAsync(new SignalementFe(EvenementFe.Accuse, f, f.FflEtat, details.FirstOrDefault()?.Motif,
                Masquage.Texte(details.FirstOrDefault()?.Message)), ct);
        return true;
    }

    // ---------------------------------------------------------------- réception

    /// <summary>
    /// Enregistre un flux reçu (relève ou import) puis le traite : facture (lecture, rattachement ou création de pièce par
    /// l'application) ou statut CDAR (statuts de la facture visée). Déjà connu (même connecteur et même identifiant de la
    /// plateforme) : rien, le flux existant est rendu (relève idempotente).
    /// </summary>
    public async Task<FluxFe> EnregistrerEntrantAsync(string connecteur, Flux meta, FichierFlux original, string? curseur, string evenement,
        string acteur, string? utilisateur, CancellationToken ct, bool horsPlateforme = false, object? origine = null)
    {
        var connu = await db.Flux.FirstOrDefaultAsync(x => x.FflConnecteur == connecteur && x.FflIdFlux == meta.IdFlux, ct);
        if (connu is not null) return connu;
        var maintenant = Maintenant;
        var f = new FluxFe
        {
            FflSens = SensFlux.Entrant, FflType = meta.Type, FflSyntaxe = meta.Syntaxe, FflProfil = meta.Profil, FflRegle = meta.RegleTraitement,
            FflOrigineRegle = meta.OrigineRegle, FflNom = meta.Nom, FflIdSuivi = null, FflIdFlux = meta.IdFlux, FflConnecteur = connecteur,
            FflEmpreinte = ConnecteurPlateforme.Empreinte(original.Contenu), FflEtat = EtatFlux.Recu, FflAccuse = meta.Accuse.Etat,
            FflCurseur = curseur, FflDeposeLe = meta.DeposeLe, FflModifiePaLe = meta.ModifieLe, FflCreeLe = maintenant, FflModifieLe = maintenant,
            FflCreePar = utilisateur ?? "", FflHorsPlateforme = horsPlateforme,
        };
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.Flux.Add(f);
        await db.SaveChangesAsync(ct);
        await GarderFichierAsync(f, TypeDocumentFlux.Original, original with { Nom = original.Nom ?? meta.Nom }, ct);
        await JournalFe.AjouterAsync(db, EtapeFe.Du(f, evenement, acteur, utilisateur) with
        {
            EtatApres = EtatFlux.Recu,
            Detail = new
            {
                id_flux = meta.IdFlux, meta.Nom, meta.Syntaxe, meta.Type, meta.Profil, regle = meta.RegleTraitement, f.FflEmpreinte, f.FflConnecteur,
                hors_plateforme = horsPlateforme ? true : (bool?)null, origine,
            },
        }, ct);
        if (f.FflSyntaxe == Syntaxe.Cdar) await TraiterStatutsRecusAsync(f, original.Contenu, ct);
        else if (SyntaxesFacture.Contains(f.FflSyntaxe)) await TraiterFactureRecueAsync(f, original.Contenu, ct);
        await tx.CommitAsync(ct);
        return f;
    }

    private async Task Echec(FluxFe f, string code, string message, CancellationToken ct)
    {
        var avant = f.FflEtat;
        f.FflEtat = EtatFlux.Erreur;
        f.FflModifieLe = Maintenant;
        AjouterErreur(f, code, message);
        await db.SaveChangesAsync(ct);
        await JournalFe.AjouterAsync(db, EtapeFe.Du(f, EvenementFe.Erreur, ActeurFe.Systeme) with
        {
            EtatAvant = avant, EtatApres = f.FflEtat, Detail = new { code, message },
        }, ct);
        await specialisation.SignalerAsync(new SignalementFe(EvenementFe.Erreur, f, f.FflEtat, code, Masquage.Texte(message)), ct);
    }

    /// <summary>Résumé d'une facture lue, inscrit au journal (étape LECTURE) : en-tête, parties, références, totaux.</summary>
    public static object ResumeLecture(Facture x, string syntaxe) => new
    {
        numero = x.Numero, date = x.DateEmission, type = x.TypeFacture, cadre = x.CadreFacturation, profil = x.Profil, syntaxe, devise = x.Devise,
        vendeur = new
        {
            raison_sociale = x.Vendeur.RaisonSociale, siren = x.Vendeur.Siren, numero_tva = x.Vendeur.NumeroTva,
            siret = x.Vendeur.Identifiants.FirstOrDefault(i => i.Schema == SchemaIdentifiant.Siret)?.Valeur,
        },
        acheteur = new { raison_sociale = x.Acheteur.RaisonSociale, siren = x.Acheteur.Siren },
        references = new
        {
            commande = x.References.Commande, contrat = x.References.Contrat, projet = x.References.Projet, objet = x.References.Objet,
            acheteur = x.References.Acheteur,
        },
        total_ht = x.Totaux.TotalHt, total_tva = x.Totaux.TotalTva, total_ttc = x.Totaux.TotalTtc, net_a_payer = x.Totaux.NetAPayer,
        lignes = x.Lignes.Count, pieces_jointes = x.PiecesJointes.Count, payeur = x.Payeur?.RaisonSociale,
    };

    /// <summary>
    /// Facture reçue : lecture (étape LECTURE, ou ERREUR si illisible), puis élément existant, sinon pièce créée par
    /// l'application (étape PIECE_CREEE) ou refusée pour doublon (étape DOUBLON, erreur FACTURE_EN_DOUBLE, la facture reste
    /// à traiter) ; rattachée : étape RATTACHEMENT (RECU → TRAITE), fichiers gardés rangés en GED de l'élément, vue
    /// lisible téléchargée de la plateforme si elle en fournit une. Signalement RECEPTION dans tous les cas lus.
    /// </summary>
    private async Task TraiterFactureRecueAsync(FluxFe f, byte[] contenu, CancellationToken ct)
    {
        FactureLue lue;
        try
        {
            lue = Lecture.Lire(contenu);
        }
        catch (ExceptionLectureFacture e)
        {
            await Echec(f, e.Code, e.Message, ct);
            return;
        }
        f.FflNumero = lue.Facture.Numero;
        if (f.FflProfil is null or ProfilFacture.NonDefini) f.FflProfil = lue.Facture.Profil;
        await db.SaveChangesAsync(ct);
        await JournalFe.AjouterAsync(db, EtapeFe.Du(f, EvenementFe.Lecture, ActeurFe.Systeme) with
        {
            EtatAvant = f.FflEtat, EtatApres = f.FflEtat, Detail = ResumeLecture(lue.Facture, lue.Syntaxe),
        }, ct);
        var recue = new FactureRecueFe(f, lue.Facture, lue.Syntaxe);
        var existant = await specialisation.ElementDuFluxAsync(recue, ct);
        var element = existant;
        IReadOnlyList<StatutAPoser> statuts = [];
        if (element is null)
        {
            var piece = await specialisation.CreerPieceRecueAsync(recue, ct);
            statuts = piece?.Refus is null ? piece?.Statuts ?? [] : [];
            if (piece?.Refus is { } refus)
            {
                AjouterErreur(f, refus, piece.Message);
                f.FflModifieLe = Maintenant;
                await db.SaveChangesAsync(ct);
                await JournalFe.AjouterAsync(db, EtapeFe.Du(f, EvenementFe.Doublon, ActeurFe.Systeme) with
                {
                    EtatAvant = f.FflEtat, EtatApres = f.FflEtat,
                    Detail = new { code = refus, message = piece.Message, type_element = piece.Element?.Type, id_element = piece.Element?.Id, detail = piece.Detail },
                }, ct);
            }
            else if (piece?.Element is { } cree)
            {
                element = cree;
                f.FflTypeElement = cree.Type;
                f.FflIdElement = cree.Id;
                f.FflModifieLe = Maintenant;
                await db.SaveChangesAsync(ct);
                await JournalFe.AjouterAsync(db, EtapeFe.Du(f, EvenementFe.PieceCreee, ActeurFe.Systeme) with
                {
                    EtatAvant = f.FflEtat, EtatApres = f.FflEtat, Detail = piece.Detail,
                }, ct);
            }
        }
        if (element is not null)
        {
            var avant = f.FflEtat;
            f.FflTypeElement = element.Type;
            f.FflIdElement = element.Id;
            f.FflEtat = EtatFlux.Traite;
            f.FflModifieLe = Maintenant;
            await db.SaveChangesAsync(ct);
            await RangerFichiersAsync(f, ct);
            var lisible = await TelechargerLisibleAsync(f, ct);
            await JournalFe.AjouterAsync(db, EtapeFe.Du(f, EvenementFe.Rattachement, ActeurFe.Systeme) with
            {
                EtatAvant = avant, EtatApres = f.FflEtat,
                Detail = new { numero = f.FflNumero, cree = existant is null, ged_original = f.FflGedOriginalId, ged_lisible = f.FflGedLisibleId, lisible },
            }, ct);
            foreach (var a in statuts)
            {
                try
                {
                    await PoserAsync(f, a, ActeurFe.Systeme, null, ct);
                }
                catch (ExceptionMetier e)
                {
                    // Statut non posable (CDAR incomplet…) : la pièce reste rattachée, l'erreur est gardée sur le flux.
                    AjouterErreur(f, e.Code, $"Statut {a.Code} non posé : {e.Message}");
                    await db.SaveChangesAsync(ct);
                }
            }
        }
        await specialisation.SignalerAsync(new SignalementFe(EvenementFe.Reception, f, f.FflEtat), ct);
    }

    /// <summary>Fichiers gardés d'un flux rangés en GED par l'application (après un rattachement) ; ceux déjà rangés restent.</summary>
    private async Task RangerFichiersAsync(FluxFe f, CancellationToken ct)
    {
        foreach (var x in await db.Fichiers.AsNoTracking().Where(x => x.FfiFflId == f.FflId).ToListAsync(ct))
        {
            var deja = x.FfiDocument switch
            {
                TypeDocumentFlux.Original => f.FflGedOriginalId,
                TypeDocumentFlux.Converti => f.FflGedConvertiId,
                TypeDocumentFlux.Lisible => f.FflGedLisibleId,
                _ => null,
            };
            if (deja is null) await GarderFichierAsync(f, x.FfiDocument, new FichierFlux(x.FfiContenu, x.FfiNom, x.FfiTypeMime), ct);
        }
    }

    /// <summary>
    /// Vue lisible d'une facture reçue d'une plateforme (ReadableView), gardée et rangée ; vrai si obtenue. Une plateforme
    /// qui n'en fournit pas (ou injoignable) n'empêche pas le rattachement : le fichier reste téléchargeable plus tard.
    /// </summary>
    private async Task<bool> TelechargerLisibleAsync(FluxFe f, CancellationToken ct)
    {
        if (f.FflGedLisibleId is not null || await db.Fichiers.AnyAsync(x => x.FfiFflId == f.FflId && x.FfiDocument == TypeDocumentFlux.Lisible, ct)) return true;
        if (f.FflIdFlux is null || f.FflConnecteur == ConnecteurFe.Manuel) return false;
        var p = await ParametreAsync(ct);
        if (p.FpaConnecteur != f.FflConnecteur) return false;
        FichierFlux fichier;
        try
        {
            fichier = await Connecteur(p).TelechargerAsync(f.FflIdFlux, TypeDocumentFlux.Lisible, ct);
        }
        catch (ExceptionConnecteur)
        {
            return false;
        }
        await GarderFichierAsync(f, TypeDocumentFlux.Lisible, fichier, ct);
        return true;
    }

    /// <summary>Sens de la facture visée par un flux de statuts : CustomerInvoiceLC → facture émise, sinon reçue.</summary>
    private static string SensFactureDu(string typeFlux) => typeFlux is TypeFlux.CdvFactureClient or TypeFlux.EtatCdvFactureClient
        ? SensFacture.Emise : SensFacture.Recue;

    /// <summary>Flux de la facture d'un numéro et d'un sens (le plus récent).</summary>
    private Task<FluxFe?> FactureAsync(string numero, string sensFacture, CancellationToken ct)
    {
        var sens = sensFacture == SensFacture.Emise ? SensFlux.Sortant : SensFlux.Entrant;
        return db.Flux.Where(x => x.FflNumero == numero && x.FflSens == sens && TypesFacture.Contains(x.FflType))
            .OrderByDescending(x => x.FflId).FirstOrDefaultAsync(ct);
    }

    /// <summary>Codes des statuts d'une facture dans l'ordre chronologique.</summary>
    public async Task<List<string>> HistoriqueAsync(long? fluxId, string numero, CancellationToken ct) =>
        await db.Statuts.AsNoTracking().Where(s => fluxId != null ? s.FstFflId == fluxId : s.FstFflId == null && s.FstNumeroFacture == numero)
            .OrderBy(s => s.FstDate).ThenBy(s => s.FstId).Select(s => s.FstCode).ToListAsync(ct);

    private async Task TraiterStatutsRecusAsync(FluxFe cdar, byte[] contenu, CancellationToken ct)
    {
        MessageCdar m;
        try
        {
            m = Cdar.Lire(contenu);
        }
        catch (ExceptionCdar e)
        {
            await Echec(cdar, e.Code, e.Message, ct);
            return;
        }
        var sensFacture = SensFactureDu(cdar.FflType);
        var premiere = m.Accuses.SelectMany(a => a.Statuts).FirstOrDefault();
        var cible = premiere is null ? null : await FactureAsync(premiere.Numero, sensFacture, ct);
        var historique = premiere is null ? [] : await HistoriqueAsync(cible?.FflId, premiere.Numero, ct);
        var lus = Cdar.StatutsLus(m, sensFacture, historique);
        foreach (var s in lus)
        {
            var facture = s.Numero == premiere?.Numero ? cible : await FactureAsync(s.Numero, sensFacture, ct);
            var avant = ReglesCycleVie.StatutAffiche(await HistoriqueAsync(facture?.FflId, s.Numero, ct));
            var statut = new StatutFe
            {
                FstFflId = facture?.FflId, FstNumeroFacture = s.Numero, FstSensFacture = sensFacture, FstCode = s.Statut, FstMotif = s.Motif,
                FstAction = s.Action, FstMontant = s.Encaissements.Count == 0 ? null : s.Encaissements.Sum(x => x.Montant),
                FstTaux = s.Encaissements.Count == 1 ? s.Encaissements[0].TauxTva : null, FstEmetteur = s.Emetteur, FstSens = SensStatut.Recu,
                FstFflCdarId = cdar.FflId, FstGedCdarId = cdar.FflGedOriginalId,
                FstDate = s.DateStatut is DateTime d ? new DateTimeOffset(DateTime.SpecifyKind(d, DateTimeKind.Utc)) : Maintenant,
                FstErreurs = JsonSerializer.Serialize(s.Erreurs, JsonCalcul.Options),
                FstDetail = s.Encaissements.Count == 0 ? null : JsonSerializer.Serialize(new { encaissements = s.Encaissements }, JsonCalcul.Options),
                FstCreeLe = Maintenant,
            };
            db.Statuts.Add(statut);
            await db.SaveChangesAsync(ct);
            var apres = ReglesCycleVie.StatutAffiche(await HistoriqueAsync(facture?.FflId, s.Numero, ct));
            await JournalFe.AjouterAsync(db, new EtapeFe(EvenementFe.StatutRecu, ActeurFe.Plateforme)
            {
                FluxId = facture?.FflId ?? cdar.FflId, TypeElement = facture?.FflTypeElement, IdElement = facture?.FflIdElement,
                EtatAvant = avant, EtatApres = apres,
                Detail = new
                {
                    numero = s.Numero, statut = s.Statut, s.Emetteur, s.Motif, s.Action, erreurs = s.Erreurs, flux_cdar = cdar.FflId,
                    facture_connue = facture is not null,
                },
            }, ct);
            await specialisation.StatutRecuAsync(new StatutSignaleFe(statut, facture, avant, apres), ct);
        }
        cdar.FflNumero = premiere?.Numero;
        cdar.FflEtat = EtatFlux.Traite;
        cdar.FflModifieLe = Maintenant;
        await db.SaveChangesAsync(ct);
        await JournalFe.AjouterAsync(db, EtapeFe.Du(cdar, EvenementFe.Controle, ActeurFe.Systeme) with
        {
            EtatAvant = EtatFlux.Recu, EtatApres = EtatFlux.Traite,
            Detail = new { statuts = lus.Count, erreurs = lus.Sum(x => x.Erreurs.Count) },
        }, ct);
    }

    // ---------------------------------------------------------------- statut posé

    /// <summary>
    /// Statut posé par un utilisateur sur la facture d'un flux (route POST /flux/{id}/statut : droit Modifier du module).
    /// Voir <see cref="PoserAsync"/>.
    /// </summary>
    public async Task<StatutDto> PoserStatutAsync(long fluxId, StatutAPoser a, Utilisateur u, CancellationToken ct)
    {
        specialisation.Exiger(u, ActionsDroits.Modifier);
        return await PoserAsync(await Charger(fluxId, ct), a, ActeurFe.Utilisateur, u.Code, ct);
    }

    /// <summary>
    /// Statut posé par l'application sans action dans le module (validation d'une pièce, règlement enregistré) : pas de
    /// droit du module exigé, acteur SYSTEME, utilisateur à l'origine noté. Voir <see cref="PoserAsync"/>.
    /// </summary>
    public async Task<StatutDto> PoserStatutApplicationAsync(long fluxId, StatutAPoser a, string? utilisateur, CancellationToken ct) =>
        await PoserAsync(await Charger(fluxId, ct), a, ActeurFe.Systeme, utilisateur, ct);

    /// <summary>
    /// Statut posé par la société sur la facture d'un flux : contrôlé par <see cref="ReglesCycleVie.Controler"/> (émetteur =
    /// rôle du sens ; refus : code de la première erreur, toutes en détail), puis CDAR (fourni, sinon écrit par
    /// <see cref="CdarDuStatut"/> depuis l'original de la facture) mis en file pour la plateforme, sauf si le code est parmi
    /// les statuts non envoyés des paramètres (<see cref="ReglesParametresFe.AEnvoyer"/>) ; statut enregistré (fe_statut,
    /// sens POSE) et étape STATUT_POSE (avant / après = statut affiché). Dans la transaction en cours s'il y en a une (réception),
    /// sinon dans la sienne ; l'application est avertie ensuite (<see cref="SpecialisationFactureElectronique.StatutPoseAsync"/>).
    /// </summary>
    public async Task<StatutDto> PoserAsync(FluxFe f, StatutAPoser a, string acteur, string? utilisateur, CancellationToken ct)
    {
        if (!TypesFacture.Contains(f.FflType) || f.FflNumero is null)
            throw ExceptionMetier.Invalide(ErreurFe.EtatFluxInvalide, "Statut posé seulement sur une facture");
        var sensFacture = f.FflSens == SensFlux.Sortant ? SensFacture.Emise : SensFacture.Recue;
        var emetteur = ReglesCycleVie.EmetteurDuSens(sensFacture)!;
        var motif = string.IsNullOrWhiteSpace(a.Motif) ? null : a.Motif.Trim();
        var action = string.IsNullOrWhiteSpace(a.Action) ? null : a.Action.Trim();
        var commentaire = string.IsNullOrWhiteSpace(a.Commentaire) ? null : a.Commentaire.Trim();
        if (commentaire is { Length: > LongueurCommentaire }) throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, $"Commentaire de {LongueurCommentaire} caractères au plus");
        var historique = await HistoriqueAsync(f.FflId, f.FflNumero, ct);
        var erreurs = ReglesCycleVie.Controler(new StatutPropose(sensFacture, historique, a.Code, emetteur, motif, action));
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0], $"Statut {a.Code} refusé : {string.Join(", ", erreurs)}", new { erreurs });
        var p = await ParametreAsync(ct);
        // Facture reçue hors plateforme (lot 14) : aucune plateforme à prévenir, le statut reste au journal.
        var envoyer = !f.FflHorsPlateforme && (a.Cdar is { Length: > 0 } || ReglesParametresFe.AEnvoyer(a.Code, p.FpaStatutsNonEnvoyes));
        var date = Maintenant;
        byte[]? cdar = null;
        if (envoyer)
        {
            try
            {
                cdar = a.Cdar is { Length: > 0 } c ? c : await CdarDuStatut(f, sensFacture, a with { Motif = motif, Action = action, Commentaire = commentaire }, historique, date, ct);
            }
            catch (ExceptionCdar e)
            {
                throw ExceptionMetier.Invalide(e.Code, $"CDAR du statut {a.Code} : {e.Message}", new { erreurs = e.Details });
            }
        }
        var avant = ReglesCycleVie.StatutAffiche(historique);
        var apres = ReglesCycleVie.StatutAffiche([.. historique, a.Code]);
        var externe = db.Database.CurrentTransaction is not null;
        await using var tx = externe ? null : await db.Database.BeginTransactionAsync(ct);
        long? cdarId = null;
        if (cdar is not null)
        {
            var flux = await MettreEnFileAsync(new FluxAEmettre(cdar, a.NomCdar ?? $"{f.FflNumero}_CDV-{a.Code}_{date:yyyyMMddHHmmss}.xml")
            {
                Syntaxe = Syntaxe.Cdar, Type = sensFacture == SensFacture.Emise ? TypeFlux.CdvFactureClient : TypeFlux.CdvFactureFournisseur,
                Numero = f.FflNumero, TypeElement = f.FflTypeElement, IdElement = f.FflIdElement,
            }, acteur, utilisateur, ct);
            cdarId = flux.Id;
        }
        var statut = new StatutFe
        {
            FstFflId = f.FflId, FstNumeroFacture = f.FflNumero, FstSensFacture = sensFacture, FstCode = a.Code, FstMotif = motif, FstAction = action,
            FstMontant = a.Montant, FstTaux = a.Taux, FstEmetteur = emetteur, FstSens = SensStatut.Pose, FstFflCdarId = cdarId, FstDate = date,
            FstCreeLe = date, FstCreePar = utilisateur ?? "",
            FstDetail = commentaire is null && a.Origine is null ? null : JsonSerializer.Serialize(new { commentaire, origine = a.Origine }, JsonCalcul.Options),
        };
        db.Statuts.Add(statut);
        await db.SaveChangesAsync(ct);
        await JournalFe.AjouterAsync(db, EtapeFe.Du(f, EvenementFe.StatutPose, acteur, utilisateur) with
        {
            EtatAvant = avant, EtatApres = apres,
            Detail = new
            {
                statut = a.Code, motif, action, a.Montant, a.Taux, commentaire, origine = a.Origine, envoye = cdarId is not null, flux_cdar = cdarId,
                hors_plateforme = f.FflHorsPlateforme ? true : (bool?)null,
            },
        }, ct);
        if (tx is not null) await tx.CommitAsync(ct);
        await specialisation.StatutPoseAsync(new StatutSignaleFe(statut, f, avant, apres), ct);
        return Dto(statut);
    }

    /// <summary>Longueur maximale du commentaire d'un statut posé (note du CDAR).</summary>
    public const int LongueurCommentaire = 500;

    /// <summary>
    /// CDAR d'un statut posé par la société, écrit depuis l'original de la facture (fe_fichier) : facture reçue, auteur =
    /// acheteur, destinataire = vendeur ; facture émise, l'inverse. Identifiant de l'auteur = SIREN, adresse électronique
    /// de la facture (BT-49 / BT-34), à défaut celle des paramètres pour la société, puis le SIREN. PPF ajouté par
    /// <see cref="Cdar.Construire"/> pour un statut qu'il exige. Contrôle complet (cycle de vie, données BR-FR-CDV, XSD).
    /// </summary>
    private async Task<byte[]> CdarDuStatut(FluxFe f, string sensFacture, StatutAPoser a, IReadOnlyList<string> historique, DateTimeOffset date,
        CancellationToken ct)
    {
        var original = await db.Fichiers.AsNoTracking().FirstOrDefaultAsync(x => x.FfiFflId == f.FflId && x.FfiDocument == TypeDocumentFlux.Original, ct)
            ?? throw new ExceptionCdar(ErreurFe.RessourceIntrouvable, $"Original de la facture du flux {f.FflId} absent");
        Facture facture;
        try
        {
            facture = Lecture.Lire(original.FfiContenu, validerXsd: false).Facture;
        }
        catch (ExceptionLectureFacture e)
        {
            throw new ExceptionCdar(e.Code, e.Message);
        }
        var p = await ParametreAsync(ct);
        PartieCdar Partie(Partie x, string? role, bool societe) => new(role, x.Siren, x.Siren is null ? null : SchemaIdentifiant.Siren, x.RaisonSociale,
            x.AdresseElectronique?.Valeur ?? (societe ? p.FpaAdresseElectronique : null) ?? x.Siren,
            x.AdresseElectronique?.Schema ?? (societe && p.FpaAdresseElectronique is not null ? p.FpaSchemaAdresse : SchemaIdentifiant.AdresseElectronique));
        var recue = sensFacture == SensFacture.Recue;
        var auteur = recue ? Partie(facture.Acheteur, null, true) : Partie(facture.Vendeur, null, true);
        var destinataire = recue ? Partie(facture.Vendeur, RoleCdar.Vendeur, false) : Partie(facture.Acheteur, RoleCdar.Acheteur, false);
        var reference = new FactureReferencee(facture.Numero, facture.TypeFacture, facture.DateEmission, facture.Vendeur.Siren, f.FflDeposeLe?.UtcDateTime);
        var d = date.UtcDateTime;
        return Cdar.Ecrire(new StatutAEcrire(sensFacture, a.Code, ReglesCycleVie.EmetteurDuSens(sensFacture)!, reference, auteur, [destinataire], d, d)
        {
            Historique = historique, Motif = a.Motif, Action = a.Action,
            Notes = a.Commentaire is null ? [] : [new NoteCdar(a.Commentaire)],
            Encaissements = a.Montant is decimal m && a.Taux is decimal t ? [new MontantEncaisse(m, t, facture.Devise)] : [],
        });
    }

    // ---------------------------------------------------------------- actions de l'utilisateur

    internal async Task<FluxFe> Charger(long id, CancellationToken ct) =>
        await db.Flux.FirstOrDefaultAsync(x => x.FflId == id, ct)
        ?? throw new ExceptionMetier(StatusCodes.Status404NotFound, ErreurFe.FluxIntrouvable, $"Flux {id} introuvable");

    /// <summary>Nouvelle tentative d'un flux à émettre en erreur ou en attente de reprise : A_ENVOYER, essais remis à zéro, dû tout de suite.</summary>
    public async Task<FluxDto> NouvelleTentative(long id, Utilisateur u, CancellationToken ct)
    {
        specialisation.Exiger(u, ActionsDroits.Modifier);
        var f = await Charger(id, ct);
        if (f.FflSens != SensFlux.Sortant || f.FflEtat is not (EtatFlux.Erreur or EtatFlux.AEnvoyer))
            throw ExceptionMetier.Invalide(ErreurFe.EtatFluxInvalide, $"Flux {id} : nouvelle tentative impossible ({f.FflEtat})");
        var avant = f.FflEtat;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Refusé par la plateforme : nouveau dépôt, sous un nouvel identifiant de suivi (l'ancien est connu de la PA).
        var redepot = f.FflIdFlux is not null;
        if (redepot)
        {
            f.FflIdSuivi = Guid.NewGuid().ToString("N");
            f.FflIdFlux = null;
            f.FflAccuse = null;
            f.FflAccuseDetails = null;
        }
        f.FflEtat = EtatFlux.AEnvoyer;
        f.FflEssais = 0;
        f.FflProchainEssai = Maintenant;
        f.FflModifieLe = Maintenant;
        await db.SaveChangesAsync(ct);
        await JournalFe.AjouterAsync(db, EtapeFe.Du(f, EvenementFe.ActionUtilisateur, ActeurFe.Utilisateur, u.Code) with
        {
            EtatAvant = avant, EtatApres = f.FflEtat, Detail = new { action = "NOUVELLE_TENTATIVE", nouveau_suivi = redepot ? f.FflIdSuivi : null },
        }, ct);
        await tx.CommitAsync(ct);
        return await DtoAsync(f, ct);
    }

    /// <summary>Dépôt fait à la main sur le portail de la PA (connecteur MANUEL) : accusé Ok ou Error saisi par l'utilisateur.</summary>
    public async Task<FluxDto> ConfirmerDepotManuel(long id, ConfirmationDepot c, Utilisateur u, CancellationToken ct)
    {
        specialisation.Exiger(u, ActionsDroits.Modifier);
        var f = await Charger(id, ct);
        if (f.FflConnecteur != ConnecteurFe.Manuel || f.FflEtat != EtatFlux.Envoye || f.FflIdFlux is null)
            throw ExceptionMetier.Invalide(ErreurFe.EtatFluxInvalide, $"Flux {id} : aucun dépôt manuel en attente");
        if (c.Etat is not (EtatAccuse.Ok or EtatAccuse.Erreur)) throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Accusé Ok ou Error attendu");
        var accuse = c.Etat == EtatAccuse.Ok
            ? new AccuseFlux(EtatAccuse.Ok, [])
            : new AccuseFlux(EtatAccuse.Erreur, [new DetailAccuse(NiveauAccuse.Erreur, "file", c.Motif ?? MotifAccuse.AutreErreurTechnique, c.Message ?? "")]);
        var meta = ConnecteurManuel().Confirmer(f.FflIdFlux, accuse);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await AppliquerAccuseAsync(f, meta, ActeurFe.Utilisateur, u.Code, ct);
        await tx.CommitAsync(ct);
        return await DtoAsync(f, ct);
    }

    /// <summary>
    /// Import d'un fichier reçu hors connexion (facture ou CDAR) : enregistré et traité comme un flux reçu (étape
    /// IMPORT_MANUEL). Hors plateforme : voir <see cref="ImporterHorsPlateformeAsync"/>.
    /// </summary>
    public async Task<FluxDto> Importer(ImportManuel i, Utilisateur u, CancellationToken ct)
    {
        specialisation.Exiger(u, ActionsDroits.Modifier);
        byte[] contenu;
        try
        {
            contenu = Convert.FromBase64String(i.Contenu ?? "");
        }
        catch (FormatException)
        {
            throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Contenu attendu en base 64");
        }
        if (i.HorsPlateforme) return await ImporterHorsPlateformeAsync(contenu, i.Nom, null, u, ct);
        var connecteur = ConnecteurManuel();
        var meta = connecteur.Importer(contenu, i.Nom, i.TypeStatut ?? TypeFlux.CdvFactureClient);
        var f = await EnregistrerEntrantAsync(ConnecteurFe.Manuel, meta, new FichierFlux(contenu, i.Nom, TypeMime(meta.Syntaxe)), null,
            EvenementFe.ImportManuel, ActeurFe.Utilisateur, u.Code, ct);
        return await DtoAsync(f, ct);
    }

    /// <summary>
    /// Facture reçue hors plateforme (lot 14) : Factur-X ou XML CII / UBL glissé sur une liste ou une pièce, ou pièce
    /// jointe d'un courriel. Même traitement qu'un flux reçu (sens R, connecteur MANUEL, étape IMPORT_MANUEL : lecture,
    /// pièce créée ou doublon refusé, rattachement) ; le flux est marqué hors plateforme : ses statuts posés restent au
    /// journal, aucun CDAR n'est envoyé. Un statut CDAR est refusé (DEMANDE_INVALIDE). <paramref name="origine"/> :
    /// provenance notée au journal (courriel…).
    /// </summary>
    public async Task<FluxDto> ImporterHorsPlateformeAsync(byte[] contenu, string nom, object? origine, Utilisateur u, CancellationToken ct)
    {
        specialisation.Exiger(u, ActionsDroits.Modifier);
        if (EstCdar(contenu))
            throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Facture attendue : un statut (CDAR) ne se reçoit que d'une plateforme");
        var meta = ConnecteurManuel().Importer(contenu ?? [], nom, TypeFlux.CdvFactureClient);
        var f = await EnregistrerEntrantAsync(ConnecteurFe.Manuel, meta, new FichierFlux(contenu!, nom, TypeMime(meta.Syntaxe)), null,
            EvenementFe.ImportManuel, ActeurFe.Utilisateur, u.Code, ct, horsPlateforme: true, origine: origine);
        return await DtoAsync(f, ct);
    }

    private static bool EstCdar(byte[]? contenu)
    {
        if (contenu is not { Length: > 0 }) return false;
        try
        {
            return Lecture.Detecter(contenu) == Syntaxe.Cdar;
        }
        catch (ExceptionLectureFacture)
        {
            return false;
        }
    }

    public async Task<List<FluxDto>> Liste(FiltreFlux filtre, CancellationToken ct)
    {
        var q = db.Flux.AsNoTracking();
        if (filtre.Sens is not null) q = q.Where(f => f.FflSens == filtre.Sens);
        if (filtre.Etat is not null) q = q.Where(f => f.FflEtat == filtre.Etat);
        if (filtre.Type is not null) q = q.Where(f => f.FflType == filtre.Type);
        if (filtre.TypeElement is not null) q = q.Where(f => f.FflTypeElement == filtre.TypeElement && f.FflIdElement == filtre.IdElement);
        if (filtre.Erreurs is bool erreurs) q = q.Where(f => db.Erreurs.Any(e => e.FerFflId == f.FflId) == erreurs);
        if (filtre.Du is DateOnly du) { var d = new DateTimeOffset(du.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero); q = q.Where(f => f.FflCreeLe >= d); }
        if (filtre.Au is DateOnly au) { var a = new DateTimeOffset(au.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero); q = q.Where(f => f.FflCreeLe < a); }
        if (filtre.Avant is long avant) q = q.Where(f => f.FflId < avant);
        var lignes = await q.OrderByDescending(f => f.FflId).Take(Math.Clamp(filtre.Limite ?? 50, 1, 500)).ToListAsync(ct);
        var ids = lignes.Select(f => f.FflId).ToList();
        var statuts = (await db.Statuts.AsNoTracking().Where(s => s.FstFflId != null && ids.Contains(s.FstFflId.Value))
                .OrderBy(s => s.FstDate).ThenBy(s => s.FstId).Select(s => new { s.FstFflId, s.FstCode }).ToListAsync(ct))
            .GroupBy(s => s.FstFflId!.Value).ToDictionary(g => g.Key, g => ReglesCycleVie.StatutAffiche([.. g.Select(x => x.FstCode)]));
        return [.. lignes.Select(f => Dto(f, statuts.GetValueOrDefault(f.FflId)))];
    }

    public async Task<FluxDetailDto> Detail(long id, CancellationToken ct)
    {
        var f = await Charger(id, ct);
        var statuts = await db.Statuts.AsNoTracking().Where(s => s.FstFflId == id).OrderBy(s => s.FstDate).ThenBy(s => s.FstId).ToListAsync(ct);
        var erreurs = await db.Erreurs.AsNoTracking().Where(e => e.FerFflId == id).OrderBy(e => e.FerId).ToListAsync(ct);
        var fichiers = await db.Fichiers.AsNoTracking().Where(x => x.FfiFflId == id)
            .Select(x => new FichierDto(x.FfiDocument, x.FfiNom, x.FfiTypeMime, x.FfiContenu.Length, x.FfiEmpreinte)).ToListAsync(ct);
        return new FluxDetailDto(Dto(f, ReglesCycleVie.StatutAffiche([.. statuts.Select(s => s.FstCode)])), [.. statuts.Select(Dto)],
            [.. erreurs.Select(e => new ErreurDto(e.FerId, e.FerCode, e.FerNiveau, e.FerElement, e.FerMessage, e.FerStatutHttp, e.FerRequestId, e.FerEssai, e.FerCreeLe))],
            fichiers, await JournalFe.ChronologieAsync(db, id, null, null, ct));
    }

    /// <summary>
    /// Fichier d'un flux : gardé par le module, sinon lu en GED par l'application, sinon (Converted, ReadableView d'un flux
    /// de la plateforme) téléchargé, gardé et rangé. Absent : 404 RESSOURCE_INTROUVABLE.
    /// </summary>
    public async Task<FichierFlux> Fichier(long id, string? document, CancellationToken ct)
    {
        var doc = document ?? TypeDocumentFlux.Original;
        var f = await Charger(id, ct);
        var garde = await db.Fichiers.AsNoTracking().FirstOrDefaultAsync(x => x.FfiFflId == id && x.FfiDocument == doc, ct);
        if (garde is not null) return new FichierFlux(garde.FfiContenu, garde.FfiNom, garde.FfiTypeMime);
        var ged = doc switch
        {
            TypeDocumentFlux.Original => f.FflGedOriginalId,
            TypeDocumentFlux.Converti => f.FflGedConvertiId,
            TypeDocumentFlux.Lisible => f.FflGedLisibleId,
            _ => throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, $"Document inconnu : {doc}"),
        };
        if (ged is long g && await specialisation.LireFichierAsync(g, ct) is { } lu) return lu;
        if (f.FflIdFlux is null || f.FflConnecteur == ConnecteurFe.Manuel)
            throw new ExceptionConnecteur(ErreurFe.RessourceIntrouvable, $"Document {doc} absent du flux {id}", 404);
        var p = await ParametreAsync(ct);
        if (p.FpaConnecteur != f.FflConnecteur)
            throw new ExceptionConnecteur(ErreurFe.RessourceIntrouvable, $"Document {doc} absent du flux {id} (connecteur changé)", 404);
        var fichier = await Connecteur(p).TelechargerAsync(f.FflIdFlux, doc, ct);
        await GarderFichierAsync(f, doc, fichier, ct);
        return fichier;
    }

    public Task<List<EvenementDto>> Chronologie(long? fluxId, string? typeElement, string? idElement, CancellationToken ct) =>
        typeElement is null && fluxId is null
            ? throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Flux ou élément attendu")
            : JournalFe.ChronologieAsync(db, fluxId, typeElement, idElement, ct);

    public Task<VerificationJournal> VerifierJournal(CancellationToken ct) => JournalFe.VerifierAsync(db, ct);

    /// <summary>
    /// Étape décidée par l'application (avoir interne d'une facture rejetée ou refusée, action d'un utilisateur…) inscrite
    /// au journal : le module n'en tire aucune conséquence sur ses flux.
    /// </summary>
    public Task JournaliserAsync(EtapeFe e, CancellationToken ct) => JournalFe.AjouterAsync(db, e, ct);

    // ---------------------------------------------------------------- DTO

    private async Task<FluxDto> DtoAsync(FluxFe f, CancellationToken ct) =>
        Dto(f, ReglesCycleVie.StatutAffiche(await HistoriqueAsync(f.FflId, f.FflNumero ?? "", ct)));

    public static FluxDto Dto(FluxFe f, string? statutAffiche) => new(f.FflId, f.FflSens, f.FflType, f.FflSyntaxe, f.FflProfil, f.FflRegle, f.FflNom,
        f.FflNumero, f.FflIdSuivi, f.FflIdFlux, f.FflConnecteur, f.FflEmpreinte, f.FflGedOriginalId, f.FflGedConvertiId, f.FflGedLisibleId,
        f.FflTypeElement, f.FflIdElement, f.FflEtat, f.FflAccuse, f.FflAccuseDetails is null ? null : JsonSerializer.Deserialize<JsonElement>(f.FflAccuseDetails),
        f.FflEssais, f.FflProchainEssai, f.FflDerniereErreur, f.FflDeposeLe, f.FflModifiePaLe, f.FflCreeLe, statutAffiche, f.FflHorsPlateforme);

    public static StatutDto Dto(StatutFe s) => new(s.FstId, s.FstFflId, s.FstNumeroFacture, s.FstSensFacture, s.FstCode, s.FstMotif, s.FstAction,
        s.FstMontant, s.FstTaux, s.FstEmetteur, s.FstSens, s.FstFflCdarId, s.FstGedCdarId, s.FstDate, JsonSerializer.Deserialize<JsonElement>(s.FstErreurs));
}
