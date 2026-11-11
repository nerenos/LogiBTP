using System.Collections.Concurrent;
using LogiBTP.FactureElectronique.Formats;

namespace LogiBTP.FactureElectronique.Web.Connecteurs;

/// <summary>
/// Connecteur de repli (Q1 (c)) : rien n'est envoyé. Un dépôt est tenu localement, accusé Pending, et son fichier est
/// mis à disposition au téléchargement (Original) pour être déposé à la main sur le portail de la PA ; l'utilisateur
/// confirme ensuite le dépôt (<see cref="Confirmer"/> : Ok ou Error). Les fichiers et statuts reçus hors connexion
/// s'importent (<see cref="Importer"/>) et sont rendus par la recherche comme des flux entrants. Pas d'annuaire.
/// </summary>
public sealed class ConnecteurManuel(IMagasinFlux magasin, TimeProvider horloge) : ConnecteurPlateforme
{
    private readonly object verrou = new();

    public override string Code => ConnecteurFe.Manuel;
    public override bool TransmetAutomatiquement => false;

    protected override Task<FluxDepose> DeposerFluxAsync(FluxPrepare p, CancellationToken ct)
    {
        var f = p.Flux;
        var type = f.Syntaxe switch
        {
            Syntaxe.Cdar => TypeFlux.CdvFactureFournisseur,
            Syntaxe.Frr => TypeFlux.NonDefini,
            _ => TypeFlux.FactureClient,
        };
        var maintenant = horloge.GetUtcNow();
        var flux = new Flux(PlateformeSimulee.NouvelId(), f.IdentifiantSuivi, f.Nom, f.Syntaxe, f.Profil ?? ProfilFacture.NonDefini,
            f.RegleTraitement ?? RegleTraitement.NonDefini, f.RegleTraitement is null ? OrigineRegle.Calculee : OrigineRegle.Fournie, type,
            SensFlux.Sortant, maintenant, maintenant, AccuseFlux.EnAttente) { Empreinte = p.Empreinte };
        lock (verrou) magasin.Enregistrer(new FluxLocal(flux, f.Contenu, magasin.RangSuivant()));
        return Task.FromResult(new FluxDepose(flux.IdFlux, maintenant, f.IdentifiantSuivi, f.Nom, f.Syntaxe)
        {
            Profil = f.Profil, RegleTraitement = f.RegleTraitement, Empreinte = p.Empreinte,
        });
    }

    /// <summary>Dépôt fait à la main sur le portail : accusé Ok (sans détail) ou Error (avec le motif rendu par la PA).</summary>
    public Flux Confirmer(string idFlux, AccuseFlux accuse)
    {
        lock (verrou)
        {
            var f = PlateformeSimulee.Trouver(magasin, idFlux);
            if (f.Flux.Sens != SensFlux.Sortant || f.Flux.Accuse.Etat != EtatAccuse.EnAttente)
                throw ExceptionConnecteur.Demande($"Flux {idFlux} : aucun dépôt manuel en attente");
            if (accuse.Etat == EtatAccuse.EnAttente) throw ExceptionConnecteur.Demande("Accusé Ok ou Error attendu");
            var flux = f.Flux with { Accuse = accuse, ModifieLe = horloge.GetUtcNow() };
            magasin.Enregistrer(f with { Flux = flux, Rang = magasin.RangSuivant() });
            return flux;
        }
    }

    /// <summary>
    /// Import d'un fichier reçu hors connexion : facture (CII, UBL, Factur-X : SupplierInvoice, lue et validée) ou statut
    /// CDAR (type <paramref name="typeStatut"/> : CustomerInvoiceLC pour une facture émise, SupplierInvoiceLC pour une
    /// reçue). Fichier illisible : DEMANDE_INVALIDE (code de la lecture dans le message).
    /// </summary>
    public Flux Importer(byte[] contenu, string nom, string typeStatut = TypeFlux.CdvFactureClient)
    {
        if (contenu is null || contenu.Length == 0) throw ExceptionConnecteur.Demande("Fichier vide");
        if (string.IsNullOrWhiteSpace(nom) || nom.Length > LongueurNom) throw ExceptionConnecteur.Demande("Nom du fichier vide ou trop long");
        if (typeStatut is not (TypeFlux.CdvFactureClient or TypeFlux.CdvFactureFournisseur))
            throw ExceptionConnecteur.Demande($"Type de statut inconnu : {typeStatut}");
        string syntaxe, profil, type;
        try
        {
            syntaxe = Lecture.Detecter(contenu);
            if (syntaxe == Syntaxe.Cdar)
            {
                Cdar.Lire(contenu);
                (profil, type) = (ProfilFacture.NonDefini, typeStatut);
            }
            else (profil, type) = (Lecture.Lire(contenu).Facture.Profil, TypeFlux.FactureFournisseur);
        }
        catch (ExceptionLectureFacture e)
        {
            throw ExceptionConnecteur.Demande($"{e.Code} : {e.Message}");
        }
        catch (ExceptionCdar e)
        {
            throw ExceptionConnecteur.Demande($"{e.Code} : {e.Message}");
        }
        var maintenant = horloge.GetUtcNow();
        var flux = new Flux(PlateformeSimulee.NouvelId(), null, nom, syntaxe, profil, RegleTraitement.NonDefini, OrigineRegle.Calculee, type,
            SensFlux.Entrant, maintenant, maintenant, new AccuseFlux(EtatAccuse.Ok, [])) { Empreinte = Empreinte(contenu) };
        lock (verrou) magasin.Enregistrer(new FluxLocal(flux, contenu, magasin.RangSuivant()));
        return flux;
    }

    protected override Task<PageFlux> RechercherFluxAsync(CriteresFlux criteres, string? curseur, int limite, CancellationToken ct) =>
        Task.FromResult(PlateformeSimulee.Page(magasin, criteres, curseur, limite));

    protected override Task<Flux> LireFluxAsync(string idFlux, CancellationToken ct) => Task.FromResult(PlateformeSimulee.Trouver(magasin, idFlux).Flux);

    protected override Task<FichierFlux> TelechargerFluxAsync(string idFlux, string typeDocument, CancellationToken ct)
    {
        var f = PlateformeSimulee.Trouver(magasin, idFlux);
        if (typeDocument != TypeDocumentFlux.Original)
            throw new ExceptionConnecteur(ErreurFe.RessourceIntrouvable, $"Document {typeDocument} absent du flux {idFlux} (dépôt manuel)", 404);
        return Task.FromResult(new FichierFlux(f.Original, f.Flux.Nom, f.Flux.Syntaxe == Syntaxe.FacturX ? "application/pdf" : "application/xml"));
    }

    protected override Task VerifierSanteAsync(CancellationToken ct) => Task.CompletedTask;
}

/// <summary>Registre des magasins du dépôt manuel, un par base de société (singleton de l'application).</summary>
public sealed class DepotsManuels(Func<string, IMagasinFlux>? magasin = null)
{
    private readonly ConcurrentDictionary<string, IMagasinFlux> magasins = new();

    public IMagasinFlux Pour(string base_) => magasins.GetOrAdd(base_, b => magasin?.Invoke(b) ?? new MagasinFluxMemoire());
}
