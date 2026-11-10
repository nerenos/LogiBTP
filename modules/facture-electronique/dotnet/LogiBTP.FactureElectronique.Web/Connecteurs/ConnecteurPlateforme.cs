using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace LogiBTP.FactureElectronique.Web.Connecteurs;

/// <summary>
/// Classe mère des connecteurs de plateforme (méthode patron) : les méthodes publiques contrôlent la demande selon le
/// contrat XP Z12-013 (fichier non vide de 100 Mo au plus, nom de 255 caractères, identifiants de 64, codes connus,
/// SIREN de 9 chiffres, SIRET de 14, limite de 1 à 100), calculent l'empreinte SHA-256, puis appellent les étapes
/// protégées propres au connecteur ; elles contrôlent enfin la réponse. Un connecteur propre à une PA dérive de
/// <see cref="ConnecteurAfnor"/> (ou de cette classe) et s'enregistre dans <see cref="FabriqueConnecteurs"/>.
/// Erreurs : <see cref="ExceptionConnecteur"/>.
/// </summary>
public abstract partial class ConnecteurPlateforme
{
    /// <summary>Taille maximale d'un fichier déposé (100 Mo, FlowPostRequest).</summary>
    public const long TailleMaximale = 100L * 1024 * 1024;
    public const int LongueurNom = 255;
    public const int LongueurIdentifiant = 64;
    public const int LimiteParDefaut = 25;
    public const int LimiteMaximale = 100;

    private static readonly string[] Syntaxes = [Syntaxe.Cii, Syntaxe.Ubl, Syntaxe.FacturX, Syntaxe.Cdar, Syntaxe.Frr];
    private static readonly string[] Profils = [ProfilFacture.Basic, ProfilFacture.En16931, ProfilFacture.ExtendedCtcFr, ProfilFacture.NonDefini];
    private static readonly string[] Regles =
    [
        RegleTraitement.B2B, RegleTraitement.B2BInt, RegleTraitement.B2C, RegleTraitement.B2G, RegleTraitement.B2GInt,
        RegleTraitement.HorsReforme, RegleTraitement.B2GHorsReforme, RegleTraitement.ArchivageSeul, RegleTraitement.NonApplicable,
        RegleTraitement.NonDefini,
    ];
    private static readonly string[] SensConnus = [SensFlux.Entrant, SensFlux.Sortant];
    private static readonly string[] EtatsAccuse = [EtatAccuse.EnAttente, EtatAccuse.Ok, EtatAccuse.Erreur];
    private static readonly string[] Documents = [TypeDocumentFlux.Original, TypeDocumentFlux.Converti, TypeDocumentFlux.Lisible];

    /// <summary>Code du connecteur (<see cref="ConnecteurFe"/> ou code d'une PA).</summary>
    public abstract string Code { get; }

    /// <summary>Le connecteur transmet-il réellement à une plateforme (faux pour le dépôt manuel).</summary>
    public virtual bool TransmetAutomatiquement => true;

    // ---------------------------------------------------------------- Flow Service

    /// <summary>Dépose un flux (POST /v1/flows) : facture, statut CDAR ou e-reporting.</summary>
    public async Task<FluxDepose> DeposerAsync(FluxADeposer flux, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(flux);
        if (flux.Contenu is null || flux.Contenu.Length == 0) throw ExceptionConnecteur.Demande("Fichier vide");
        if (flux.Contenu.LongLength > TailleMaximale)
            throw new ExceptionConnecteur(ErreurFe.FichierTropGros, $"Fichier de plus de {TailleMaximale / 1024 / 1024} Mo");
        if (string.IsNullOrWhiteSpace(flux.Nom) || flux.Nom.Length > LongueurNom)
            throw ExceptionConnecteur.Demande($"Nom du fichier vide ou de plus de {LongueurNom} caractères");
        Identifiant(flux.IdentifiantSuivi, "identifiant de suivi", facultatif: true);
        Admis(flux.Syntaxe, Syntaxes, "syntaxe");
        if (flux.Profil is not null) Admis(flux.Profil, Profils, "profil");
        if (flux.RegleTraitement is not null) Admis(flux.RegleTraitement, Regles, "règle de traitement");

        var depose = await DeposerFluxAsync(new FluxPrepare(flux, Empreinte(flux.Contenu)), ct);
        if (string.IsNullOrWhiteSpace(depose.IdFlux)) throw Illisible("dépôt sans identifiant de flux");
        return depose;
    }

    /// <summary>Recherche des flux (POST /v1/flows/search), par page : curseur de la page précédente (null : première page).</summary>
    public Task<PageFlux> RechercherAsync(CriteresFlux criteres, string? curseur = null, int? limite = null, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(criteres);
        if (criteres.EstVide) throw ExceptionConnecteur.Demande("Au moins un critère de recherche");
        foreach (var r in criteres.Regles) Admis(r, Regles, "règle de traitement");
        foreach (var s in criteres.Sens) Admis(s, SensConnus, "sens");
        if (criteres.EtatAccuse is not null) Admis(criteres.EtatAccuse, EtatsAccuse, "état de l'accusé");
        Identifiant(criteres.IdentifiantSuivi, "identifiant de suivi", facultatif: true);
        if (curseur is not null && curseur.Length == 0) throw ExceptionConnecteur.Demande("Curseur vide");
        var l = limite ?? LimiteParDefaut;
        if (l is < 1 or > LimiteMaximale) throw ExceptionConnecteur.Demande($"Limite de 1 à {LimiteMaximale}");
        return RechercherFluxAsync(criteres, curseur, l, ct);
    }

    /// <summary>Toutes les pages d'une recherche, du curseur donné à la dernière ; rend le dernier curseur reçu (à garder pour la relève suivante).</summary>
    public async Task<(IReadOnlyList<Flux> Flux, string? Curseur)> RechercherToutAsync(
        CriteresFlux criteres, string? curseur = null, int? limite = null, CancellationToken ct = default)
    {
        var tous = new List<Flux>();
        var vus = new HashSet<string>();
        while (true)
        {
            var page = await RechercherAsync(criteres, curseur, limite, ct);
            tous.AddRange(page.Flux);
            if (page.CurseurSuivant is null) return (tous, curseur);
            if (!vus.Add(page.CurseurSuivant)) throw Illisible("curseur de pagination répété");
            curseur = page.CurseurSuivant;
        }
    }

    /// <summary>Métadonnées d'un flux (GET /v1/flows/{flowId}, docType Metadata).</summary>
    public async Task<Flux> FluxAsync(string idFlux, CancellationToken ct = default)
    {
        Identifiant(idFlux, "identifiant de flux");
        return await LireFluxAsync(idFlux, ct);
    }

    /// <summary>Fichier d'un flux (GET /v1/flows/{flowId}?docType=Original, Converted ou ReadableView).</summary>
    public async Task<FichierFlux> TelechargerAsync(string idFlux, string typeDocument = TypeDocumentFlux.Original, CancellationToken ct = default)
    {
        Identifiant(idFlux, "identifiant de flux");
        Admis(typeDocument, Documents, "document du flux");
        var f = await TelechargerFluxAsync(idFlux, typeDocument, ct);
        if (f.Contenu.Length == 0) throw Illisible("fichier vide");
        return f;
    }

    /// <summary>Abonnement aux événements (réservé : relève par curseur, Q11).</summary>
    public Task<Abonnement> AbonnerAsync(DemandeAbonnement demande, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(demande);
        if (!demande.AdresseRappel.IsAbsoluteUri || demande.AdresseRappel.Scheme != Uri.UriSchemeHttps)
            throw ExceptionConnecteur.Demande("Adresse de rappel en https");
        if (demande.Sens is not null) Admis(demande.Sens, SensConnus, "sens");
        if (demande.EtatAccuse is not null) Admis(demande.EtatAccuse, EtatsAccuse, "état de l'accusé");
        return AbonnerFluxAsync(demande, ct);
    }

    /// <summary>Disponibilité de la plateforme (GET /v1/healthcheck) ; ne lève pas : l'échec est dans le résultat.</summary>
    public async Task<EtatSante> SanteAsync(CancellationToken ct = default)
    {
        var chrono = Stopwatch.StartNew();
        try
        {
            await VerifierSanteAsync(ct);
            return new EtatSante(true, null, chrono.Elapsed);
        }
        catch (ExceptionConnecteur e)
        {
            return new EtatSante(false, e.Code, chrono.Elapsed);
        }
    }

    // ---------------------------------------------------------------- Directory Service

    /// <summary>Unité légale par SIREN (GET /v1/siren/code-insee:{siren}).</summary>
    public Task<UniteLegale> UniteLegaleAsync(string siren, CancellationToken ct = default) =>
        LireUniteLegaleAsync(Chiffres(siren, 9, "SIREN"), ct);

    /// <summary>Établissement par SIRET (GET /v1/siret/code-insee:{siret}), avec son unité légale.</summary>
    public Task<Etablissement> EtablissementAsync(string siret, CancellationToken ct = default) =>
        LireEtablissementAsync(Chiffres(siret, 14, "SIRET"), ct);

    /// <summary>Code de routage d'un établissement (GET /v1/routing-code/siret:{siret}/code:{id}).</summary>
    public Task<CodeRoutage> CodeRoutageAsync(string siret, string identifiant, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(identifiant) || !IdentifiantRoutage().IsMatch(identifiant))
            throw ExceptionConnecteur.Demande("Identifiant de routage invalide (lettres, chiffres, - _ /, 100 au plus)");
        return LireCodeRoutageAsync(Chiffres(siret, 14, "SIRET"), identifiant, ct);
    }

    /// <summary>Ligne d'annuaire par identifiant d'adressage (GET /v1/directory-line/code:{id}), avec unité légale, établissement et code de routage.</summary>
    public Task<LigneAnnuaire> LigneAnnuaireAsync(string identifiantAdressage, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(identifiantAdressage) || identifiantAdressage.Length > 125)
            throw ExceptionConnecteur.Demande("Identifiant d'adressage vide ou de plus de 125 caractères");
        return LireLigneAnnuaireAsync(identifiantAdressage, ct);
    }

    /// <summary>Recherche d'unités légales (POST /v1/siren/search).</summary>
    public Task<ResultatsAnnuaire<UniteLegale>> RechercherUnitesLegalesAsync(RechercheAnnuaire r, CancellationToken ct = default) =>
        ChercherUnitesLegalesAsync(Recherche(r), ct);

    /// <summary>Recherche d'établissements (POST /v1/siret/search).</summary>
    public Task<ResultatsAnnuaire<Etablissement>> RechercherEtablissementsAsync(RechercheAnnuaire r, CancellationToken ct = default) =>
        ChercherEtablissementsAsync(Recherche(r), ct);

    /// <summary>Recherche de codes de routage (POST /v1/routing-code/search).</summary>
    public Task<ResultatsAnnuaire<CodeRoutage>> RechercherCodesRoutageAsync(RechercheAnnuaire r, CancellationToken ct = default) =>
        ChercherCodesRoutageAsync(Recherche(r), ct);

    /// <summary>Recherche de lignes d'annuaire (POST /v1/directory-line/search) : adresse électronique d'un destinataire.</summary>
    public Task<ResultatsAnnuaire<LigneAnnuaire>> RechercherLignesAnnuaireAsync(RechercheAnnuaire r, CancellationToken ct = default) =>
        ChercherLignesAnnuaireAsync(Recherche(r), ct);

    // ---------------------------------------------------------------- étapes propres au connecteur

    protected abstract Task<FluxDepose> DeposerFluxAsync(FluxPrepare flux, CancellationToken ct);
    protected abstract Task<PageFlux> RechercherFluxAsync(CriteresFlux criteres, string? curseur, int limite, CancellationToken ct);
    protected abstract Task<Flux> LireFluxAsync(string idFlux, CancellationToken ct);
    protected abstract Task<FichierFlux> TelechargerFluxAsync(string idFlux, string typeDocument, CancellationToken ct);
    protected abstract Task VerifierSanteAsync(CancellationToken ct);

    protected virtual Task<Abonnement> AbonnerFluxAsync(DemandeAbonnement demande, CancellationToken ct) => throw NonPrisEnCharge("abonnement");
    protected virtual Task<UniteLegale> LireUniteLegaleAsync(string siren, CancellationToken ct) => throw NonPrisEnCharge("annuaire");
    protected virtual Task<Etablissement> LireEtablissementAsync(string siret, CancellationToken ct) => throw NonPrisEnCharge("annuaire");
    protected virtual Task<CodeRoutage> LireCodeRoutageAsync(string siret, string identifiant, CancellationToken ct) => throw NonPrisEnCharge("annuaire");
    protected virtual Task<LigneAnnuaire> LireLigneAnnuaireAsync(string identifiant, CancellationToken ct) => throw NonPrisEnCharge("annuaire");
    protected virtual Task<ResultatsAnnuaire<UniteLegale>> ChercherUnitesLegalesAsync(RechercheAnnuaire r, CancellationToken ct) => throw NonPrisEnCharge("annuaire");
    protected virtual Task<ResultatsAnnuaire<Etablissement>> ChercherEtablissementsAsync(RechercheAnnuaire r, CancellationToken ct) => throw NonPrisEnCharge("annuaire");
    protected virtual Task<ResultatsAnnuaire<CodeRoutage>> ChercherCodesRoutageAsync(RechercheAnnuaire r, CancellationToken ct) => throw NonPrisEnCharge("annuaire");
    protected virtual Task<ResultatsAnnuaire<LigneAnnuaire>> ChercherLignesAnnuaireAsync(RechercheAnnuaire r, CancellationToken ct) => throw NonPrisEnCharge("annuaire");

    // ---------------------------------------------------------------- outils

    /// <summary>Empreinte SHA-256 d'un contenu en hexadécimal minuscule (sha256 de FlowInfo : ^[a-f0-9]{64}$).</summary>
    public static string Empreinte(byte[] contenu) => Convert.ToHexStringLower(SHA256.HashData(contenu));

    protected ExceptionConnecteur NonPrisEnCharge(string fonction) =>
        new(ErreurFe.FonctionNonPriseEnCharge, $"Connecteur {Code} : {fonction} non pris en charge");

    protected static ExceptionConnecteur Illisible(string quoi, string? requestId = null) =>
        new(ErreurFe.ReponseIllisible, $"Réponse de la plateforme illisible : {quoi}", requestId: requestId);

    private static void Admis(string valeur, string[] admis, string quoi)
    {
        if (!admis.Contains(valeur)) throw ExceptionConnecteur.Demande($"Valeur inconnue pour {quoi} : {valeur}");
    }

    private static void Identifiant(string? valeur, string quoi, bool facultatif = false)
    {
        if (valeur is null && facultatif) return;
        if (string.IsNullOrWhiteSpace(valeur) || valeur.Length > LongueurIdentifiant)
            throw ExceptionConnecteur.Demande($"{char.ToUpperInvariant(quoi[0])}{quoi[1..]} vide ou de plus de {LongueurIdentifiant} caractères");
    }

    private static string Chiffres(string? valeur, int longueur, string quoi)
    {
        if (valeur is null || valeur.Length != longueur || !valeur.All(char.IsAsciiDigit))
            throw ExceptionConnecteur.Demande($"{quoi} de {longueur} chiffres attendu");
        return valeur;
    }

    private static RechercheAnnuaire Recherche(RechercheAnnuaire r)
    {
        ArgumentNullException.ThrowIfNull(r);
        if (r.Filtres.Count == 0) throw ExceptionConnecteur.Demande("Au moins un filtre de recherche");
        foreach (var f in r.Filtres)
        {
            if (string.IsNullOrWhiteSpace(f.Champ)) throw ExceptionConnecteur.Demande("Champ du filtre vide");
            Admis(f.Operateur, [OperateurAnnuaire.Egal, OperateurAnnuaire.Contient, OperateurAnnuaire.CommencePar], "opérateur");
        }
        if (r.Limite is < 1 || r.Ignorer is < 0) throw ExceptionConnecteur.Demande("Limite ou décalage négatif");
        return r;
    }

    [GeneratedRegex(@"^(?!\s+$)[\-_/a-zA-Z0-9]{1,100}$")]
    private static partial Regex IdentifiantRoutage();
}
