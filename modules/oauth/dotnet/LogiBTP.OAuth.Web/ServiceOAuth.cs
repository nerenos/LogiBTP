using System.Collections.Concurrent;
using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace LogiBTP.OAuth.Web;

/// <summary>Réglages du module (section « OAuth ») : adresse de retour commune, tâche de fond.</summary>
public sealed class OptionsOAuth
{
    /// <summary>Adresse de retour déclarée chez les fournisseurs, commune à l'installation (la société est portée par le state).</summary>
    public string AdresseRetour { get; set; } = "http://localhost:5173/api/oauth/retour";
    public bool Actif { get; set; } = true;
    public int IntervalleMinutes { get; set; } = 60;
}

public sealed record SaisieConnexion(string Code, string Nom, string Fournisseur, string? Portees, bool ModeTest = true, List<string>? Droits = null,
    List<int>? RappelsJours = null, DateTimeOffset? SecretExpireLe = null, string Flux = "CODE_PKCE");

/// <summary>
/// Client du fournisseur saisi : identifiant, secret (vide = inchangé) ou certificat PKCS#12 en base64 (fin de validité
/// lue dans le certificat), locataire, clé JSON d'un compte de service et boîte déléguée, points de terminaison propres.
/// </summary>
public sealed record SaisieClient(string IdentifiantClient, string? Secret, string? Locataire, DateTimeOffset? SecretExpireLe, string? Certificat = null,
    string? MotDePasseCertificat = null, string? CleCompteService = null, string? Sujet = null, string? UrlAutorisation = null, string? UrlJeton = null,
    string? UrlRevocation = null);

public sealed record FournisseurDto(string Code, string Libelle, string Portees, int? RafraichissementTestJours);

public sealed record ConnexionDto(long Id, string Code, string Nom, string Fournisseur, string FournisseurLibelle, string Flux, string Portees, bool ModeTest,
    string Etat, string? Pastille, bool ClientConfigure, bool Connectee, DateTimeOffset? AccesExpireLe, DateTimeOffset? RafraichissementExpireLe,
    DateTimeOffset? SecretExpireLe, string? DerniereErreur, DateTimeOffset? RenouveleLe, DateTimeOffset? ConnecteLe, string? ConnectePar,
    List<string> Droits, List<int>? RappelsJours, IReadOnlyList<string> Utilisations, bool PeutReconnecter, bool PeutModifier);

public sealed record ResultatAutorisation(long? Connexion, string? Origine, bool Ok, string Message);

public sealed record JournalDto(string Evenement, string? Detail, string? Utilisateur, DateTimeOffset Le);

/// <summary>
/// Connexions OAuth 2.0 de la base courante : paramétrage (administrateur), client et jetons chiffrés, autorisation par
/// code + PKCE et retour du fournisseur, jeton d'accès valable pour les modules (<see cref="IFournisseurJeton"/>, un seul
/// renouvellement à la fois par connexion), test, révocation, passage de fond (renouvellement préventif, rappels
/// d'échéance) et journal.
/// </summary>
public sealed class ServiceOAuth(OAuthDbContext db, Chiffrement chiffrement, ClientOAuth client, SpecialisationOAuth specialisation,
    IOptions<OptionsOAuth> options, SocieteCourante societe, IServiceProvider services, TimeProvider horloge) : IFournisseurJeton
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Verrous = new();
    private static readonly int[] RappelsDefaut = [30, 7, 1];
    private static readonly TimeSpan Marge = TimeSpan.FromMinutes(5);

    private DateTimeOffset Maintenant => horloge.GetUtcNow();

    // --- Lecture ---

    public async Task<List<FournisseurDto>> FournisseursAsync(CancellationToken ct) =>
        await db.Fournisseurs.AsNoTracking().Where(f => f.OfoActif).OrderBy(f => f.OfoLibelle)
            .Select(f => new FournisseurDto(f.OfoCode, f.OfoLibelle, f.OfoPortees, f.OfoRafraichissementTestJours)).ToListAsync(ct);

    /// <summary>Connexions visibles : toutes pour un administrateur, sinon celles que l'utilisateur peut reconnecter.</summary>
    public async Task<List<ConnexionDto>> ListeAsync(Utilisateur u, CancellationToken ct)
    {
        var services = await ServicesAsync(u, ct);
        var fournisseurs = await db.Fournisseurs.AsNoTracking().ToDictionaryAsync(f => f.OfoCode, ct);
        var res = new List<ConnexionDto>();
        foreach (var c in await db.Connexions.AsNoTracking().OrderBy(c => c.OcoNom).ToListAsync(ct))
        {
            if (!PeutReconnecter(u, c, services)) continue;
            res.Add(await DtoAsync(c, fournisseurs.GetValueOrDefault(c.OcoOfoCode), u, services, ct));
        }
        return res;
    }

    public async Task<ConnexionDto> DetailAsync(Utilisateur u, long id, CancellationToken ct)
    {
        var c = await db.Connexions.AsNoTracking().FirstOrDefaultAsync(x => x.OcoId == id, ct) ?? throw ExceptionMetier.Introuvable("Connexion");
        var services = await ServicesAsync(u, ct);
        if (!PeutReconnecter(u, c, services)) throw ExceptionMetier.AccesRefuse("RECONNECTER");
        return await DtoAsync(c, await db.Fournisseurs.AsNoTracking().FirstOrDefaultAsync(f => f.OfoCode == c.OcoOfoCode, ct), u, services, ct);
    }

    /// <summary>Connexions en alerte (à connecter, à reconnecter, échéance à moins de 30 jours) visibles par l'utilisateur : widget de l'accueil.</summary>
    public async Task<List<ConnexionDto>> AlertesAsync(Utilisateur u, CancellationToken ct) =>
        (await ListeAsync(u, ct)).Where(c => c.Pastille is ReglesOAuth.Rouge or ReglesOAuth.Orange).ToList();

    /// <summary>Compte connecté en clair (administrateur, journalisé) : jamais dans les listes.</summary>
    public async Task<string?> CompteAsync(Utilisateur u, long id, CancellationToken ct)
    {
        u.ExigerAdmin();
        var c = await Connexion(id, ct);
        Journaliser(c.OcoId, "AFFICHAGE_COMPTE", null, u.Code);
        await db.SaveChangesAsync(ct);
        return chiffrement.Dechiffrer(c.OcoCompte);
    }

    public async Task<List<JournalDto>> JournalAsync(Utilisateur u, long id, CancellationToken ct)
    {
        await DetailAsync(u, id, ct);
        return await db.Journal.AsNoTracking().Where(j => j.OjoOcoId == id).OrderByDescending(j => j.OjoLe).Take(100)
            .Select(j => new JournalDto(j.OjoEvenement, j.OjoDetail, j.OjoUtilisateur, j.OjoLe)).ToListAsync(ct);
    }

    // --- Paramétrage (administrateur) ---

    public async Task<ConnexionDto> CreerAsync(Utilisateur u, SaisieConnexion s, CancellationToken ct)
    {
        u.ExigerAdmin();
        var c = new ConnexionEntite { OcoCreePar = u.Code, OcoCreeLe = Maintenant };
        await AppliquerAsync(c, s, ct);
        if (await db.Connexions.AnyAsync(x => x.OcoCode == c.OcoCode, ct)) throw ExceptionMetier.Conflit("CONNEXION_CODE_PRIS", $"Code {c.OcoCode} déjà utilisé");
        db.Connexions.Add(c);
        await db.SaveChangesAsync(ct);
        Journaliser(c.OcoId, "CREATION", c.OcoNom, u.Code);
        await db.SaveChangesAsync(ct);
        return await DetailAsync(u, c.OcoId, ct);
    }

    public async Task<ConnexionDto> ModifierAsync(Utilisateur u, long id, SaisieConnexion s, CancellationToken ct)
    {
        u.ExigerAdmin();
        var c = await Connexion(id, ct);
        var fournisseur = c.OcoOfoCode;
        await AppliquerAsync(c, s, ct);
        if (fournisseur != c.OcoOfoCode && c.OcoJetons is not null)
        {
            throw ExceptionMetier.Invalide("CONNEXION_FOURNISSEUR", "Révoquer la connexion avant de changer de fournisseur");
        }
        if (await db.Connexions.AnyAsync(x => x.OcoCode == c.OcoCode && x.OcoId != id, ct)) throw ExceptionMetier.Conflit("CONNEXION_CODE_PRIS", $"Code {c.OcoCode} déjà utilisé");
        c.OcoMajPar = u.Code;
        c.OcoMajLe = Maintenant;
        Journaliser(id, "MODIFICATION", null, u.Code);
        await db.SaveChangesAsync(ct);
        return await DetailAsync(u, id, ct);
    }

    private async Task AppliquerAsync(ConnexionEntite c, SaisieConnexion s, CancellationToken ct)
    {
        var code = (s.Code ?? "").Trim().ToUpperInvariant();
        var nom = (s.Nom ?? "").Trim();
        if (code.Length is 0 or > 30) throw ExceptionMetier.Invalide("CONNEXION_CODE", "Code obligatoire (30 caractères au plus)");
        if (nom.Length is 0 or > 100) throw ExceptionMetier.Invalide("CONNEXION_NOM", "Nom d'usage obligatoire (100 caractères au plus)");
        var f = await db.Fournisseurs.AsNoTracking().FirstOrDefaultAsync(x => x.OfoCode == s.Fournisseur && x.OfoActif, ct)
            ?? throw ExceptionMetier.Invalide("CONNEXION_FOURNISSEUR", "Fournisseur inconnu");
        if (!Flux.Contains(s.Flux)) throw ExceptionMetier.Invalide("CONNEXION_FLUX", "Flux inconnu : CODE_PKCE, CLIENT ou COMPTE_SERVICE");
        if (c.OcoJetons is not null && c.OcoFlux != s.Flux) throw ExceptionMetier.Invalide("CONNEXION_FLUX", "Révoquer la connexion avant de changer de flux");
        var rappels = s.RappelsJours?.Where(d => d > 0).Distinct().OrderByDescending(d => d).ToList();
        c.OcoCode = code;
        c.OcoNom = nom;
        c.OcoOfoCode = f.OfoCode;
        c.OcoFlux = s.Flux;
        c.OcoPortees = !string.IsNullOrWhiteSpace(s.Portees) ? string.Join(' ', s.Portees.Split(' ', StringSplitOptions.RemoveEmptyEntries)) : PorteesParDefaut(f, s.Flux);
        c.OcoModeTest = s.ModeTest;
        c.OcoDroits = (s.Droits ?? []).Select(d => d.Trim()).Where(d => d.Length > 0).Distinct().ToList();
        c.OcoRappelsJours = rappels is { Count: > 0 } ? rappels : null;
        if (s.SecretExpireLe is not null) c.OcoSecretExpireLe = s.SecretExpireLe;
    }

    public static readonly string[] Flux = ["CODE_PKCE", "CLIENT", "COMPTE_SERVICE"];

    /// <summary>Portées par défaut : celles du fournisseur ; application Microsoft (client credentials) : .default d'Exchange Online.</summary>
    public static string PorteesParDefaut(FournisseurEntite f, string flux) => (f.OfoCode, flux) switch
    {
        ("MICROSOFT", "CLIENT") => "https://outlook.office365.com/.default",
        ("GOOGLE", "COMPTE_SERVICE") => "https://mail.google.com/",
        _ => f.OfoPortees,
    };

    /// <summary>
    /// Client du fournisseur : réécrit en entier, chiffré, jamais relu par le navigateur (secret, certificat, clé vides :
    /// inchangés). Certificat : fin de validité lue dans le certificat ; compte de service : clé contrôlée, compte = boîte
    /// déléguée.
    /// </summary>
    public async Task<ConnexionDto> EnregistrerClientAsync(Utilisateur u, long id, SaisieClient s, CancellationToken ct)
    {
        u.ExigerAdmin();
        var c = await Connexion(id, ct);
        var ancien = LireClient(c);
        var cle = Vide(s.CleCompteService) ?? ancien?.CleCompteService;
        if (c.OcoFlux == "COMPTE_SERVICE")
        {
            if (cle is null) throw ExceptionMetier.Invalide("OAUTH_CLIENT", "Clé du compte de service obligatoire");
            try { AssertionsOAuth.LireCleCompteService(cle); }
            catch (Exception e) when (e is ErreurOAuth or JsonException) { throw ExceptionMetier.Invalide("OAUTH_CLIENT", $"Clé du compte de service illisible : {e.Message}"); }
        }
        else if (string.IsNullOrWhiteSpace(s.IdentifiantClient)) throw ExceptionMetier.Invalide("OAUTH_CLIENT", "Identifiant du client obligatoire");
        if (c.OcoOfoCode == "GENERIQUE" && (Vide(s.UrlJeton) is null || (c.OcoFlux == "CODE_PKCE" && Vide(s.UrlAutorisation) is null)))
            throw ExceptionMetier.Invalide("OAUTH_CLIENT", "Adresses d'autorisation et de jeton obligatoires pour un autre fournisseur");
        foreach (var url in new[] { s.UrlAutorisation, s.UrlJeton, s.UrlRevocation }.Select(Vide).OfType<string>())
            if (!Uri.TryCreate(url, UriKind.Absolute, out var u2) || u2.Scheme != "https") throw ExceptionMetier.Invalide("OAUTH_CLIENT", $"Adresse HTTPS attendue : {url}");
        var certificat = Vide(s.Certificat) ?? ancien?.Certificat;
        var mdpCertificat = Vide(s.Certificat) is null ? ancien?.MotDePasseCertificat : Vide(s.MotDePasseCertificat);
        DateTimeOffset? finCertificat = null;
        if (Vide(s.Certificat) is { } nouveau)
        {
            try
            {
                using var cert = AssertionsOAuth.LireCertificat(nouveau, mdpCertificat);
                if (!cert.HasPrivateKey) throw ExceptionMetier.Invalide("OAUTH_CERTIFICAT", "Le certificat doit contenir sa clé privée (fichier .pfx)");
                finCertificat = new DateTimeOffset(cert.NotAfter.ToUniversalTime(), TimeSpan.Zero);
            }
            catch (Exception e) when (e is System.Security.Cryptography.CryptographicException or FormatException)
            {
                throw ExceptionMetier.Invalide("OAUTH_CERTIFICAT", $"Certificat illisible : {e.Message}");
            }
        }
        var client = new ClientFournisseur((s.IdentifiantClient ?? "").Trim(), Vide(s.Secret) ?? ancien?.Secret, Vide(s.Locataire), certificat, mdpCertificat, cle,
            Vide(s.Sujet) ?? ancien?.Sujet, Vide(s.UrlAutorisation), Vide(s.UrlJeton), Vide(s.UrlRevocation));
        c.OcoClient = chiffrement.Chiffrer(JsonSerializer.Serialize(client, JsonCalcul.Options));
        c.OcoSecretExpireLe = finCertificat ?? s.SecretExpireLe ?? (certificat is not null ? c.OcoSecretExpireLe : null);
        if (c.OcoFlux == "COMPTE_SERVICE" && client.Sujet is { } sujet)
        {
            c.OcoCompte = chiffrement.Chiffrer(sujet);
            c.OcoCompteEmpreinte = chiffrement.Empreinte(sujet);
        }
        c.OcoMajPar = u.Code;
        c.OcoMajLe = Maintenant;
        Journaliser(id, "CLIENT", "Client du fournisseur enregistré", u.Code);
        await db.SaveChangesAsync(ct);
        return await DetailAsync(u, id, ct);
    }

    public async Task<int[]> RappelsGlobauxAsync(CancellationToken ct)
    {
        var p = await db.Parametres.AsNoTracking().FirstOrDefaultAsync(x => x.OpaCle == "rappels_jours", ct);
        try
        {
            var l = p is null ? null : JsonSerializer.Deserialize<int[]>(p.OpaValeur);
            return l is { Length: > 0 } ? l : RappelsDefaut;
        }
        catch (JsonException)
        {
            return RappelsDefaut;
        }
    }

    public async Task<int[]> EnregistrerRappelsGlobauxAsync(Utilisateur u, int[] jours, CancellationToken ct)
    {
        u.ExigerAdmin();
        var l = jours.Where(d => d > 0).Distinct().OrderByDescending(d => d).ToArray();
        if (l.Length == 0) throw ExceptionMetier.Invalide("OAUTH_RAPPELS", "Au moins un délai de rappel");
        var p = await db.Parametres.FirstOrDefaultAsync(x => x.OpaCle == "rappels_jours", ct);
        if (p is null) db.Parametres.Add(p = new ParametreEntite { OpaCle = "rappels_jours" });
        p.OpaValeur = JsonSerializer.Serialize(l);
        await db.SaveChangesAsync(ct);
        return l;
    }

    /// <summary>Suppression (administrateur) : refusée tant qu'un module s'en sert ; jetons révoqués auprès du fournisseur.</summary>
    public async Task SupprimerAsync(Utilisateur u, long id, CancellationToken ct)
    {
        u.ExigerAdmin();
        var c = await Connexion(id, ct);
        var utilisations = await UtilisationsAsync(id, ct);
        if (utilisations.Count > 0) throw ExceptionMetier.Conflit("CONNEXION_UTILISEE", $"Connexion utilisée : {string.Join(", ", utilisations)}", utilisations);
        await RevoquerChezFournisseurAsync(c, ct);
        db.Connexions.Remove(c);
        Journaliser(null, "SUPPRESSION", $"{c.OcoCode} – {c.OcoNom}", u.Code);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Révocation (administrateur) : jetons révoqués chez le fournisseur et effacés, connexion désactivée (reconnecter la réactive).</summary>
    public async Task<ConnexionDto> RevoquerAsync(Utilisateur u, long id, CancellationToken ct)
    {
        u.ExigerAdmin();
        var c = await Connexion(id, ct);
        await RevoquerChezFournisseurAsync(c, ct);
        c.OcoJetons = null;
        c.OcoAccesExpireLe = null;
        c.OcoRafraichissementExpireLe = null;
        c.OcoEtat = "DESACTIVEE";
        Journaliser(id, "REVOCATION", null, u.Code);
        await db.SaveChangesAsync(ct);
        return await DetailAsync(u, id, ct);
    }

    private async Task RevoquerChezFournisseurAsync(ConnexionEntite c, CancellationToken ct)
    {
        var j = LireJetons(c);
        var cl = LireClient(c);
        var f = await db.Fournisseurs.AsNoTracking().FirstOrDefaultAsync(x => x.OfoCode == c.OcoOfoCode, ct);
        if (j is null || cl is null || f is null) return;
        await client.RevoquerAsync(f, cl, j.Rafraichissement ?? j.Acces, ct);
    }

    // --- Autorisation (code + PKCE) ---

    /// <summary>
    /// Adresse de la page d'autorisation du fournisseur pour (re)connecter la connexion ; l'origine (adresse de
    /// l'application de la société) reçoit la fenêtre au retour. <paramref name="autreCompte"/> : accepter un compte
    /// différent du précédent.
    /// </summary>
    public async Task<string> AutoriserAsync(Utilisateur u, long id, string origine, bool autreCompte, CancellationToken ct)
    {
        var c = await Connexion(id, ct);
        if (c.OcoFlux != "CODE_PKCE") throw ExceptionMetier.Invalide("CONNEXION_FLUX", "Connexion sans page d'autorisation : « Connecter » obtient le jeton directement");
        if (!PeutReconnecter(u, c, await ServicesAsync(u, ct))) throw ExceptionMetier.AccesRefuse("RECONNECTER");
        var cl = LireClient(c) ?? throw ExceptionMetier.Invalide("OAUTH_CLIENT_ABSENT", "Client du fournisseur à renseigner par un administrateur");
        var f = await Fournisseur(c, ct);
        await db.Autorisations.Where(a => a.OauExpireLe < Maintenant).ExecuteDeleteAsync(ct);
        var pkce = ReglesOAuth.NouveauPkce();
        var state = ReglesOAuth.NouveauState(societe.Code);
        db.Autorisations.Add(new AutorisationEntite
        {
            OauState = state, OauOcoId = id, OauVerificateur = chiffrement.Chiffrer(pkce.Verificateur)!, OauUtilisateur = u.Code,
            OauOrigine = origine, OauAutreCompte = autreCompte, OauExpireLe = Maintenant.AddMinutes(10),
        });
        Journaliser(id, "AUTORISATION", "Demande d'autorisation ouverte", u.Code);
        await db.SaveChangesAsync(ct);
        return ReglesOAuth.UrlAutorisation(ClientOAuth.UrlAutorisation(f, cl), cl.IdentifiantClient, options.Value.AdresseRetour, c.OcoPortees,
            state, pkce.Defi, Parametres(f), chiffrement.Dechiffrer(c.OcoCompte));
    }

    /// <summary>
    /// Retour du fournisseur (state à usage unique) : échange du code, compte lu dans l'id_token, jetons et compte
    /// chiffrés, connexion à l'état OK. Un compte différent du précédent est refusé sans confirmation.
    /// </summary>
    public async Task<ResultatAutorisation> TerminerAsync(string state, string? code, string? erreur, CancellationToken ct)
    {
        var a = await db.Autorisations.FirstOrDefaultAsync(x => x.OauState == state, ct);
        if (a is null || a.OauExpireLe < Maintenant) return new(null, a?.OauOrigine, false, "Demande d'autorisation inconnue ou expirée : recommencer");
        db.Autorisations.Remove(a);
        await db.SaveChangesAsync(ct);
        var c = await Connexion(a.OauOcoId, ct);
        if (!string.IsNullOrEmpty(erreur) || string.IsNullOrEmpty(code))
        {
            Journaliser(c.OcoId, "AUTORISATION_REFUSEE", erreur, a.OauUtilisateur);
            await db.SaveChangesAsync(ct);
            return new(c.OcoId, a.OauOrigine, false, erreur == "access_denied" ? "Autorisation refusée sur la page du fournisseur" : $"Autorisation refusée : {erreur}");
        }
        var f = await Fournisseur(c, ct);
        var cl = LireClient(c) ?? throw ExceptionMetier.Invalide("OAUTH_CLIENT_ABSENT", "Client du fournisseur absent");
        ReponseJeton r;
        try
        {
            r = await client.EchangerCodeAsync(f, cl, code, chiffrement.Dechiffrer(a.OauVerificateur)!, options.Value.AdresseRetour, ct);
        }
        catch (Exception e) when (e is ErreurOAuth or HttpRequestException)
        {
            Journaliser(c.OcoId, "ECHANGE_ECHOUE", Tronquer(e.Message), a.OauUtilisateur);
            await db.SaveChangesAsync(ct);
            return new(c.OcoId, a.OauOrigine, false, $"Échange du code refusé : {e.Message}");
        }
        var compte = ReglesOAuth.CompteDeIdToken(r.IdToken);
        var empreinte = chiffrement.Empreinte(compte);
        if (c.OcoCompteEmpreinte is not null && empreinte is not null && empreinte != c.OcoCompteEmpreinte && !a.OauAutreCompte)
        {
            Journaliser(c.OcoId, "AUTRE_COMPTE", "Compte différent du précédent : non enregistré", a.OauUtilisateur);
            await db.SaveChangesAsync(ct);
            return new(c.OcoId, a.OauOrigine, false, "Le compte connecté diffère du précédent : confirmer la reconnexion avec un autre compte");
        }
        var rafraichissement = r.Rafraichissement ?? LireJetons(c)?.Rafraichissement;
        if (rafraichissement is null)
        {
            return new(c.OcoId, a.OauOrigine, false, "Le fournisseur n'a pas donné de jeton de rafraîchissement (accès hors ligne refusé)");
        }
        var premiere = c.OcoConnecteLe is null;
        EcrireJetons(c, new JetonsConnexion(r.Acces, rafraichissement, r.Type), r.ExpireDans);
        c.OcoRafraichissementExpireLe = ReglesOAuth.FinRafraichissement(Maintenant, r.RafraichissementExpireDans, c.OcoModeTest, f.OfoRafraichissementTestJours);
        if (compte is not null)
        {
            c.OcoCompte = chiffrement.Chiffrer(compte);
            c.OcoCompteEmpreinte = empreinte;
        }
        c.OcoEtat = "OK";
        c.OcoDerniereErreur = null;
        c.OcoConnecteLe = Maintenant;
        c.OcoConnectePar = a.OauUtilisateur;
        Journaliser(c.OcoId, premiere ? "CONNEXION" : "RECONNEXION", null, a.OauUtilisateur);
        await db.SaveChangesAsync(ct);
        return new(c.OcoId, a.OauOrigine, true, "Connexion établie");
    }

    // --- Jetons ---

    /// <summary>Jeton d'accès valable (renouvelé s'il expire dans moins de 5 minutes) ; connexion inutilisable : CONNEXION_A_RECONNECTER.</summary>
    public async Task<JetonAcces> JetonAsync(long connexion, CancellationToken ct)
    {
        var verrou = Verrous.GetOrAdd($"{societe.Base}:{connexion}", _ => new SemaphoreSlim(1, 1));
        await verrou.WaitAsync(ct);
        try
        {
            var c = await Connexion(connexion, ct);
            if (c.OcoEtat != "OK" || LireJetons(c) is not { } j) throw AReconnecter(c);
            if (c.OcoAccesExpireLe is not { } fin || fin - Maintenant < Marge)
            {
                j = await RenouvelerAsync(c, ct);
            }
            return new JetonAcces(j.Acces, chiffrement.Dechiffrer(c.OcoCompte) ?? "", c.OcoAccesExpireLe ?? Maintenant);
        }
        finally
        {
            verrou.Release();
        }
    }

    public async Task<IReadOnlyList<ConnexionExterne>> ConnexionsAsync(CancellationToken ct) =>
        await db.Connexions.AsNoTracking().OrderBy(c => c.OcoNom).Select(c => new ConnexionExterne(c.OcoId, c.OcoNom, c.OcoOfoCode, c.OcoEtat)).ToListAsync(ct);

    /// <summary>Test (personne autorisée) : renouvellement forcé du jeton d'accès.</summary>
    public async Task<ConnexionDto> TesterAsync(Utilisateur u, long id, CancellationToken ct)
    {
        var c = await Connexion(id, ct);
        if (!PeutReconnecter(u, c, await ServicesAsync(u, ct))) throw ExceptionMetier.AccesRefuse("RECONNECTER");
        if (c.OcoEtat != "OK") throw AReconnecter(c);
        await RenouvelerSousVerrouAsync(c, ct);
        Journaliser(id, "TEST", "Jeton renouvelé", u.Code);
        await db.SaveChangesAsync(ct);
        return await DetailAsync(u, id, ct);
    }

    /// <summary>
    /// Connexion d'un flux sans utilisateur (application Microsoft, compte de service Google) : premier jeton obtenu
    /// directement (personne autorisée), connexion à l'état OK.
    /// </summary>
    public async Task<ConnexionDto> ConnecterAsync(Utilisateur u, long id, CancellationToken ct)
    {
        var c = await Connexion(id, ct);
        if (!PeutReconnecter(u, c, await ServicesAsync(u, ct))) throw ExceptionMetier.AccesRefuse("RECONNECTER");
        if (c.OcoFlux == "CODE_PKCE") throw ExceptionMetier.Invalide("CONNEXION_FLUX", "Connexion par la page du fournisseur : « Se connecter »");
        if (LireClient(c) is null) throw ExceptionMetier.Invalide("OAUTH_CLIENT_ABSENT", "Client du fournisseur à renseigner");
        var premiere = c.OcoConnecteLe is null;
        c.OcoEtat = "OK";
        try
        {
            await RenouvelerSousVerrouAsync(c, ct);
        }
        catch (ExceptionMetier)
        {
            if (c.OcoEtat == "OK") c.OcoEtat = "A_RECONNECTER";
            await db.SaveChangesAsync(ct);
            throw;
        }
        c.OcoConnecteLe = Maintenant;
        c.OcoConnectePar = u.Code;
        Journaliser(id, premiere ? "CONNEXION" : "RECONNEXION", null, u.Code);
        await db.SaveChangesAsync(ct);
        return await DetailAsync(u, id, ct);
    }

    /// <summary>
    /// Renouvelle le jeton d'accès par le jeton de rafraîchissement (sans utilisateur : nouveau jeton du client ou du compte de service). Refus définitif du fournisseur : connexion à
    /// reconnecter, signal immédiat aux personnes autorisées, CONNEXION_A_RECONNECTER ; fournisseur injoignable :
    /// erreur notée, connexion inchangée.
    /// </summary>
    private async Task<JetonsConnexion> RenouvelerAsync(ConnexionEntite c, CancellationToken ct)
    {
        var j = LireJetons(c);
        var cl = LireClient(c);
        var sansUtilisateur = c.OcoFlux != "CODE_PKCE";
        if (cl is null || (!sansUtilisateur && j?.Rafraichissement is null))
        {
            await MarquerAReconnecterAsync(c, "Jeton de rafraîchissement ou client absent", ct);
            throw AReconnecter(c);
        }
        var f = await Fournisseur(c, ct);
        ReponseJeton r;
        try
        {
            r = c.OcoFlux switch
            {
                "CLIENT" => await client.ClientCredentialsAsync(f, cl, c.OcoPortees, ct),
                "COMPTE_SERVICE" => await client.CompteServiceAsync(f, cl, c.OcoPortees, ct),
                _ => await client.RafraichirAsync(f, cl, j!.Rafraichissement!, null, ct),
            };
        }
        catch (ErreurOAuth e) when (e.AReconnecter)
        {
            await MarquerAReconnecterAsync(c, e.Message, ct);
            throw AReconnecter(c);
        }
        catch (Exception e) when (e is ErreurOAuth or HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            c.OcoDerniereErreur = Tronquer(e.Message);
            Journaliser(c.OcoId, "RENOUVELLEMENT_ECHOUE", Tronquer(e.Message), null);
            await db.SaveChangesAsync(ct);
            throw ExceptionMetier.Conflit("OAUTH_INDISPONIBLE", $"Fournisseur injoignable pour {c.OcoNom} : {e.Message}");
        }
        var nouveaux = new JetonsConnexion(r.Acces, r.Rafraichissement ?? j?.Rafraichissement, r.Type);
        EcrireJetons(c, nouveaux, r.ExpireDans);
        if (r.Rafraichissement is not null && r.RafraichissementExpireDans is > 0)
        {
            c.OcoRafraichissementExpireLe = Maintenant.AddSeconds(r.RafraichissementExpireDans.Value);
        }
        c.OcoDerniereErreur = null;
        await db.SaveChangesAsync(ct);
        return nouveaux;
    }

    private async Task MarquerAReconnecterAsync(ConnexionEntite c, string erreur, CancellationToken ct)
    {
        var etaitOk = c.OcoEtat == "OK";
        c.OcoEtat = "A_RECONNECTER";
        c.OcoDerniereErreur = Tronquer(erreur);
        Journaliser(c.OcoId, "A_RECONNECTER", Tronquer(erreur), null);
        await db.SaveChangesAsync(ct);
        if (!etaitOk) return;
        await SignalerAsync(c, new SignalOAuth(c.OcoId, c.OcoNom, "ECHEC", $"Connexion {c.OcoNom} à reconnecter",
            "Le fournisseur refuse le renouvellement du jeton : reconnecter la connexion pour rétablir les envois et la réception.", NiveauNotification.Urgent,
            $"oauth:{c.OcoId}:echec:{Maintenant:yyyyMMddHHmm}"), ct);
    }

    // --- Passage de fond ---

    /// <summary>
    /// Passage de fond sur la base courante : demandes d'autorisation expirées effacées ; connexions OK renouvelées si
    /// leur jeton expire ou n'a pas été renouvelé depuis un jour (une boîte peu active garde sa connexion) ; rappels
    /// d'échéance dus (secret, jeton de rafraîchissement) signalés une fois par délai.
    /// </summary>
    public async Task PasserAsync(CancellationToken ct)
    {
        await db.Autorisations.Where(a => a.OauExpireLe < Maintenant).ExecuteDeleteAsync(ct);
        var globaux = await RappelsGlobauxAsync(ct);
        var ids = await db.Connexions.AsNoTracking().Where(c => c.OcoEtat != "DESACTIVEE").Select(c => c.OcoId).ToListAsync(ct);
        foreach (var id in ids)
        {
            var c = await db.Connexions.FirstAsync(x => x.OcoId == id, ct);
            if (c.OcoEtat == "OK" && (c.OcoRenouveleLe is not { } r || Maintenant - r > TimeSpan.FromDays(1) || c.OcoAccesExpireLe is not { } e || e - Maintenant < Marge))
            {
                try
                {
                    await RenouvelerSousVerrouAsync(c, ct);
                }
                catch (ExceptionMetier)
                {
                    // Connexion marquée à reconnecter (signalée) ou fournisseur injoignable (erreur notée).
                }
            }
            await RappelerAsync(c, c.OcoRappelsJours is { Count: > 0 } l ? l : globaux, ct);
        }
    }

    private async Task RenouvelerSousVerrouAsync(ConnexionEntite c, CancellationToken ct)
    {
        var verrou = Verrous.GetOrAdd($"{societe.Base}:{c.OcoId}", _ => new SemaphoreSlim(1, 1));
        await verrou.WaitAsync(ct);
        try
        {
            await RenouvelerAsync(c, ct);
        }
        finally
        {
            verrou.Release();
        }
    }

    private async Task RappelerAsync(ConnexionEntite c, IEnumerable<int> delais, CancellationToken ct)
    {
        foreach (var d in ReglesOAuth.RappelsDus(c.OcoSecretExpireLe, c.OcoEtat == "OK" ? c.OcoRafraichissementExpireLe : null, c.OcoConnecteLe, delais, Maintenant))
        {
            if (await db.Rappels.AnyAsync(x => x.OraOcoId == c.OcoId && x.OraEcheance == d.Echeance && x.OraDate == d.Date && x.OraDelai == d.Delai, ct)) continue;
            db.Rappels.Add(new RappelEntite { OraOcoId = c.OcoId, OraEcheance = d.Echeance, OraDate = d.Date, OraDelai = d.Delai, OraEmisLe = Maintenant });
            await db.SaveChangesAsync(ct);
            var quoi = d.Echeance == "SECRET" ? "Le secret du client" : "L'autorisation (jeton de rafraîchissement)";
            var quand = d.Delai == 0 ? "a expiré" : $"expire le {d.Date.ToLocalTime():dd/MM/yyyy HH:mm}";
            var action = d.Echeance == "SECRET" ? "renouveler le secret chez le fournisseur puis l'enregistrer" : "reconnecter la connexion";
            await SignalerAsync(c, new SignalOAuth(c.OcoId, c.OcoNom, "RAPPEL", $"Connexion {c.OcoNom} : échéance {(d.Delai == 0 ? "dépassée" : $"dans {d.Delai} jour(s) au plus")}",
                $"{quoi} {quand} : {action}.", d.Delai is 0 or 1 ? NiveauNotification.Urgent : d.Delai <= 7 ? NiveauNotification.Attention : NiveauNotification.Info,
                $"oauth:{c.OcoId}:{d.Echeance}:{d.Date:yyyyMMddHHmm}:{d.Delai}"), ct);
        }
    }

    private async Task SignalerAsync(ConnexionEntite c, SignalOAuth s, CancellationToken ct)
    {
        var destinataires = await specialisation.DestinatairesAsync(c.OcoDroits, ct);
        await specialisation.SignalerAsync(s, destinataires, ct);
    }

    // --- Outils ---

    private async Task<ConnexionDto> DtoAsync(ConnexionEntite c, FournisseurEntite? f, Utilisateur u, IReadOnlyList<string> services, CancellationToken ct) => new(
        c.OcoId, c.OcoCode, c.OcoNom, c.OcoOfoCode, f?.OfoLibelle ?? c.OcoOfoCode, c.OcoFlux, c.OcoPortees, c.OcoModeTest, c.OcoEtat,
        ReglesOAuth.PastilleConnexion(c.OcoEtat, c.OcoSecretExpireLe, c.OcoEtat == "OK" ? c.OcoRafraichissementExpireLe : null, Maintenant),
        c.OcoClient is not null, c.OcoJetons is not null, c.OcoAccesExpireLe, c.OcoRafraichissementExpireLe, c.OcoSecretExpireLe, c.OcoDerniereErreur,
        c.OcoRenouveleLe, c.OcoConnecteLe, c.OcoConnectePar, c.OcoDroits, c.OcoRappelsJours, await UtilisationsAsync(c.OcoId, ct),
        PeutReconnecter(u, c, services), u.EstAdmin);

    private async Task<List<string>> UtilisationsAsync(long id, CancellationToken ct)
    {
        var res = new List<string>();
        foreach (var x in services.GetServices<IUtilisationsConnexion>()) res.AddRange(await x.UtilisationsAsync(id, ct));
        return res;
    }

    private Task<IReadOnlyList<string>> ServicesAsync(Utilisateur u, CancellationToken ct) =>
        u.EstAdmin ? Task.FromResult<IReadOnlyList<string>>([]) : specialisation.ServicesAsync(u.Code, ct);

    /// <summary>Droit de reconnecter : administrateur, profil de l'utilisateur ou un de ses services (« service:&lt;code&gt; ») dans les droits.</summary>
    public static bool PeutReconnecter(Utilisateur u, ConnexionEntite c, IReadOnlyList<string> services) =>
        u.EstAdmin || c.OcoDroits.Contains(u.Profil, StringComparer.OrdinalIgnoreCase)
        || services.Any(s => c.OcoDroits.Contains($"service:{s}", StringComparer.OrdinalIgnoreCase));

    private async Task<ConnexionEntite> Connexion(long id, CancellationToken ct) =>
        await db.Connexions.FirstOrDefaultAsync(x => x.OcoId == id, ct) ?? throw ExceptionMetier.Introuvable("Connexion");

    private async Task<FournisseurEntite> Fournisseur(ConnexionEntite c, CancellationToken ct) =>
        await db.Fournisseurs.AsNoTracking().FirstOrDefaultAsync(f => f.OfoCode == c.OcoOfoCode, ct) ?? throw ExceptionMetier.Introuvable("Fournisseur");

    private ClientFournisseur? LireClient(ConnexionEntite c) =>
        c.OcoClient is null ? null : JsonSerializer.Deserialize<ClientFournisseur>(chiffrement.Dechiffrer(c.OcoClient)!, JsonCalcul.Options);

    private JetonsConnexion? LireJetons(ConnexionEntite c) =>
        c.OcoJetons is null ? null : JsonSerializer.Deserialize<JetonsConnexion>(chiffrement.Dechiffrer(c.OcoJetons)!, JsonCalcul.Options);

    private void EcrireJetons(ConnexionEntite c, JetonsConnexion j, int? expireDans)
    {
        c.OcoJetons = chiffrement.Chiffrer(JsonSerializer.Serialize(j, JsonCalcul.Options));
        c.OcoAccesExpireLe = Maintenant.AddSeconds(expireDans is > 0 ? expireDans.Value : 3600);
        c.OcoRenouveleLe = Maintenant;
    }

    private static Dictionary<string, string> Parametres(FournisseurEntite f)
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(f.OfoParametres) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private void Journaliser(long? id, string evenement, string? detail, string? utilisateur) =>
        db.Journal.Add(new JournalEntite { OjoOcoId = id, OjoEvenement = evenement, OjoDetail = detail, OjoUtilisateur = utilisateur, OjoLe = Maintenant });

    private static ExceptionMetier AReconnecter(ConnexionEntite c) =>
        ExceptionMetier.Conflit(IFournisseurJeton.AReconnecter, $"Connexion {c.OcoNom} à reconnecter", new { connexion = c.OcoId });

    private static string Tronquer(string s) => s.Length > 500 ? s[..500] : s;

    private static string? Vide(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
