using System.Collections.Concurrent;
using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LogiBTP.Authentification.Web;

/// <summary>
/// Réglages de l'installation (section Authentification) : Mode Session (défaut) ou EnTetes (développement seulement :
/// sans session, l'utilisateur est lu dans les en-têtes X-Utilisateur / X-Profil), ComptesTest (développement
/// seulement : connexion à un compte choisi sans mot de passe, A10 / A11), nom du cookie.
/// </summary>
public sealed class OptionsAuthentification
{
    public string Mode { get; set; } = "Session";
    public bool ComptesTest { get; set; }
    public string NomCookie { get; set; } = "logibtp_session";
    /// <summary>Routes de l'application accessibles sans session (en plus de celles du module).</summary>
    public List<string> RoutesPubliques { get; set; } = [];
    public bool EnTetes => string.Equals(Mode, "EnTetes", StringComparison.OrdinalIgnoreCase);
}

public sealed record ParametresSession(int InactiviteHeures = 10, int ResterConnecteJours = 7, bool ResterConnecte = true);
public sealed record ParametresVerrouillage(int Echecs = 5, int Minutes = 15);

/// <summary>Réglages de la société (parametre_authentification).</summary>
public sealed record ParametresAuthentification(ParametresSession Session, ParametresVerrouillage Verrouillage, PolitiqueMotDePasse MotDePasse, IReadOnlyList<string> PseudosReserves);

public sealed record ConnexionSaisie(string? Identifiant, string? MotDePasse, bool ResterConnecte = false);
public sealed record ChangementMotDePasse(string? Actuel, string? Nouveau);

/// <summary>Session valide lue depuis le cookie (en cache court par base).</summary>
public sealed record SessionLue(long SesId, long CptId, string Code, string? Libelle, string Profil, bool MdpAChanger,
    string? TypeElement, string? IdElement, DateTimeOffset ExpireLe, bool Persistante, DateTimeOffset VuLe);

/// <summary>Ce que le client sait de sa session (GET /auth/session).</summary>
public sealed record DescriptionSession(bool Connecte, string? Code, string? Libelle, string? Profil, bool MdpAChanger,
    string? TypeElement, string? IdElement, DateTimeOffset? ExpireLe, string Mode, bool ComptesTest, bool ResterConnectePermis);

/// <summary>
/// Comptes, connexion, sessions et journal (ANALYSE-MODULE-AUTHENTIFICATION.md) : verrouillage après N échecs (message
/// identique pour un identifiant inconnu, un mot de passe faux ou un compte verrouillé), expiration glissante,
/// « Rester connecté », mot de passe provisoire à changer, journal des connexions.
/// </summary>
public sealed class ServiceAuthentification(AuthDbContext db, SpecialisationAuthentification specialisation, SocieteCourante societe,
    IOptions<OptionsAuthentification> options)
{
    private static readonly ConcurrentDictionary<(string Base, string Empreinte), (DateTimeOffset Lu, SessionLue Session)> Cache = new();
    private static readonly TimeSpan DureeCache = TimeSpan.FromSeconds(30);
    private static readonly string HashFactice = HachageMotDePasse.Hacher("logibtp-compte-inconnu");

    public OptionsAuthentification Options => options.Value;

    public const string MessageRefus = "Identifiant ou mot de passe incorrect, ou compte verrouillé temporairement après plusieurs échecs";

    // ---------------------------------------------------------------- paramètres

    public async Task<ParametresAuthentification> ParametresAsync(CancellationToken ct)
    {
        var p = await db.Parametres.AsNoTracking().ToDictionaryAsync(x => x.PauCle, x => x.PauValeur.RootElement.Clone(), ct);
        T Lire<T>(string cle, T defaut) => p.TryGetValue(cle, out var v) ? v.Deserialize<T>(JsonCalculOptions) ?? defaut : defaut;
        var mdp = p.TryGetValue("mot_de_passe", out var m) ? m : default;
        var politique = new PolitiqueMotDePasse(
            mdp.ValueKind == JsonValueKind.Object && mdp.TryGetProperty("longueur_min", out var l) ? l.GetInt32() : 12,
            mdp.ValueKind == JsonValueKind.Object && mdp.TryGetProperty("courants", out var c) ? c.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : []);
        return new ParametresAuthentification(Lire("session", new ParametresSession()), Lire("verrouillage", new ParametresVerrouillage()), politique,
            Lire<List<string>>("pseudos_reserves", []));
    }

    private static readonly JsonSerializerOptions JsonCalculOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    // ---------------------------------------------------------------- connexion

    /// <summary>Ouvre une session (jeton du cookie renvoyé) ; refus générique pour un identifiant inconnu, un mot de passe faux ou un compte verrouillé.</summary>
    public async Task<(string Jeton, SessionLue Session)> ConnecterAsync(ConnexionSaisie s, Origine origine, CancellationToken ct)
    {
        var code = ReglesCompte.Normaliser(s.Identifiant);
        var mdp = s.MotDePasse ?? "";
        var parametres = await ParametresAsync(ct);
        var maintenant = DateTimeOffset.UtcNow;
        var compte = code.Length == 0 ? null : await db.Comptes.FirstOrDefaultAsync(x => x.CptCode.ToLower() == code, ct);
        if (compte is null)
        {
            HachageMotDePasse.Verifier(mdp, HashFactice); // même durée qu'un compte existant
            await JournaliserAsync(code.Length == 0 ? "?" : code, "ECHEC", "identifiant inconnu", origine, null, ct);
            throw Refus();
        }
        var etat = ReglesCompte.Etat(compte.AEvaluer(), maintenant);
        if (etat.Etat == "VERROUILLE")
        {
            await JournaliserAsync(compte.CptCode, "ECHEC", "compte verrouillé", origine, null, ct);
            throw Refus();
        }
        if (!HachageMotDePasse.Verifier(mdp, compte.CptHash))
        {
            compte.CptEchecs++;
            if (compte.CptEchecs >= parametres.Verrouillage.Echecs)
            {
                compte.CptVerrouilleJusquAu = maintenant.AddMinutes(parametres.Verrouillage.Minutes);
                compte.CptEchecs = 0;
                await JournaliserAsync(compte.CptCode, "VERROUILLAGE", $"{parametres.Verrouillage.Echecs} échecs : {parametres.Verrouillage.Minutes} min", origine, null, ct, enregistrer: false);
            }
            await JournaliserAsync(compte.CptCode, "ECHEC", "mot de passe incorrect", origine, null, ct);
            throw Refus();
        }
        await VerifierOuvertureAsync(compte, etat, origine, ct);
        compte.CptEchecs = 0;
        compte.CptVerrouilleJusquAu = null;
        compte.CptDerniereConnexion = maintenant;
        if (HachageMotDePasse.AReprendre(compte.CptHash)) compte.CptHash = HachageMotDePasse.Hacher(mdp);
        return await OuvrirAsync(compte, s.ResterConnecte && parametres.Session.ResterConnecte, parametres, origine, "", ct);
    }

    /// <summary>Connexion sans mot de passe à un compte choisi : environnement de développement et ComptesTest seulement (A10, A11).</summary>
    public async Task<(string Jeton, SessionLue Session)> ConnecterTestAsync(string? identifiant, bool developpement, Origine origine, CancellationToken ct)
    {
        if (!developpement || !Options.ComptesTest) throw ExceptionMetier.AccesRefuse("CONNEXION_TEST");
        var code = ReglesCompte.Normaliser(identifiant);
        var compte = await db.Comptes.FirstOrDefaultAsync(x => x.CptCode.ToLower() == code && x.CptType == "PERSONNE", ct)
            ?? throw ExceptionMetier.Introuvable($"Compte {code}");
        var etat = ReglesCompte.Etat(compte.AEvaluer() with { AMotDePasse = true, MdpProvisoire = false, VerrouilleJusquAu = null }, DateTimeOffset.UtcNow);
        await VerifierOuvertureAsync(compte, etat, origine, ct);
        compte.CptDerniereConnexion = DateTimeOffset.UtcNow;
        var parametres = await ParametresAsync(ct);
        return await OuvrirAsync(compte, false, parametres, origine, "test sans mot de passe", ct, test: true);
    }

    /// <summary>Comptes proposés à la connexion de test (développement seulement).</summary>
    public async Task<List<object>> ComptesTestAsync(bool developpement, CancellationToken ct)
    {
        if (!developpement || !Options.ComptesTest) return [];
        return await db.Comptes.AsNoTracking().Where(c => c.CptType == "PERSONNE" && c.CptActif).OrderBy(c => c.CptCode)
            .Select(c => (object)new { code = c.CptCode, libelle = c.CptLibelle, profil = c.CptProfil }).ToListAsync(ct);
    }

    private async Task VerifierOuvertureAsync(Compte compte, EtatCompte etat, Origine origine, CancellationToken ct)
    {
        if (etat.Etat is "SERVICE" or "SANS_MOT_DE_PASSE")
        {
            await JournaliserAsync(compte.CptCode, "REFUS", etat.Etat, origine, null, ct);
            throw Refus();
        }
        if (etat.Etat == "INACTIF")
        {
            await JournaliserAsync(compte.CptCode, "REFUS", "compte désactivé", origine, null, ct);
            throw new ExceptionMetier(StatusCodes.Status403Forbidden, "COMPTE_INACTIF", "Compte désactivé : adressez-vous à un administrateur");
        }
        if (etat.Etat == "EXPIRE")
        {
            await JournaliserAsync(compte.CptCode, "EXPIRE", $"fin de validité {compte.CptValideJusquAu:dd/MM/yyyy}", origine, null, ct);
            throw new ExceptionMetier(StatusCodes.Status403Forbidden, "COMPTE_EXPIRE", "Compte expiré : adressez-vous à un administrateur");
        }
        if (compte.CptTypeElement is not null && compte.CptIdElement is not null)
        {
            var p = await specialisation.PersonneAsync(db, compte.CptTypeElement, compte.CptIdElement, ct);
            if (p is not { Autorisee: true })
            {
                await JournaliserAsync(compte.CptCode, "REFUS", p?.Motif ?? "personne liée inactive", origine, null, ct);
                throw new ExceptionMetier(StatusCodes.Status403Forbidden, "COMPTE_INACTIF", $"Compte inutilisable : {p?.Motif ?? "personne liée inactive ou introuvable"}");
            }
        }
    }

    private async Task<(string, SessionLue)> OuvrirAsync(Compte compte, bool persistante, ParametresAuthentification p, Origine origine, string detail,
        CancellationToken ct, bool test = false)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var (jeton, empreinte) = HachageMotDePasse.NouveauJeton();
        var session = new SessionUtilisateur
        {
            SesJetonHache = empreinte, SesCptId = compte.CptId, SesCreeLe = maintenant, SesVuLe = maintenant, SesPersistante = persistante,
            SesExpireLe = persistante ? maintenant.AddDays(p.Session.ResterConnecteJours) : maintenant.AddHours(p.Session.InactiviteHeures),
            SesAdresse = Tronquer(origine.Adresse, 64), SesNavigateur = Tronquer(origine.Navigateur, 300), SesTest = test,
        };
        db.Sessions.Add(session);
        db.Journal.Add(Entree(compte.CptCode, "CONNEXION", detail.Length == 0 ? (persistante ? "rester connecté" : null) : detail, origine, null));
        await db.SaveChangesAsync(ct);
        return (jeton, Lue(session, compte));
    }

    private static SessionLue Lue(SessionUtilisateur s, Compte c) =>
        new(s.SesId, c.CptId, c.CptCode, c.CptLibelle, c.CptProfil, c.CptMdpProvisoire && !s.SesTest, c.CptTypeElement, c.CptIdElement, s.SesExpireLe, s.SesPersistante, s.SesVuLe);

    private static ExceptionMetier Refus() => new(StatusCodes.Status401Unauthorized, "CONNEXION_REFUSEE", MessageRefus);

    // ---------------------------------------------------------------- session courante

    /// <summary>
    /// Session valide du jeton (null : inconnue, fermée, expirée, compte devenu inutilisable — la session est alors
    /// fermée). Expiration glissante sans « Rester connecté » ; dernière activité notée au plus une fois par minute.
    /// </summary>
    public async Task<SessionLue?> LireSessionAsync(string jeton, CancellationToken ct)
    {
        var empreinte = HachageMotDePasse.Empreinte(jeton);
        var cle = (societe.Connexion, empreinte);
        var maintenant = DateTimeOffset.UtcNow;
        if (Cache.TryGetValue(cle, out var c) && maintenant - c.Lu < DureeCache && c.Session.ExpireLe > maintenant) return c.Session;
        var session = await db.Sessions.FirstOrDefaultAsync(x => x.SesJetonHache == empreinte && x.SesFermeeLe == null, ct);
        if (session is null || session.SesExpireLe <= maintenant)
        {
            Cache.TryRemove(cle, out _);
            return null;
        }
        var compte = await db.Comptes.FirstOrDefaultAsync(x => x.CptId == session.SesCptId, ct);
        var utilisable = compte is { CptType: "PERSONNE", CptActif: true } && !(compte.CptValideJusquAu < DateOnly.FromDateTime(maintenant.UtcDateTime));
        if (utilisable && compte!.CptTypeElement is not null && compte.CptIdElement is not null)
        {
            utilisable = (await specialisation.PersonneAsync(db, compte.CptTypeElement, compte.CptIdElement, ct)) is { Autorisee: true };
        }
        if (!utilisable)
        {
            session.SesFermeeLe = maintenant;
            await db.SaveChangesAsync(ct);
            Cache.TryRemove(cle, out _);
            return null;
        }
        if (maintenant - session.SesVuLe > TimeSpan.FromMinutes(1))
        {
            session.SesVuLe = maintenant;
            if (!session.SesPersistante) session.SesExpireLe = maintenant.AddHours((await ParametresAsync(ct)).Session.InactiviteHeures);
            await db.SaveChangesAsync(ct);
        }
        var lue = Lue(session, compte!);
        Cache[cle] = (maintenant, lue);
        return lue;
    }

    public DescriptionSession Decrire(SessionLue? s, ParametresAuthentification? p, bool developpement) => new(
        s is not null, s?.Code, s?.Libelle, s?.Profil, s?.MdpAChanger ?? false, s?.TypeElement, s?.IdElement, s?.ExpireLe,
        Options.EnTetes ? "EnTetes" : "Session", developpement && Options.ComptesTest, p?.Session.ResterConnecte ?? true);

    public async Task DeconnecterAsync(SessionLue s, Origine origine, CancellationToken ct)
    {
        await db.Sessions.Where(x => x.SesId == s.SesId).ExecuteUpdateAsync(x => x.SetProperty(y => y.SesFermeeLe, DateTimeOffset.UtcNow), ct);
        await JournaliserAsync(s.Code, "DECONNEXION", null, origine, null, ct);
        OublierSessions();
    }

    /// <summary>Changement du mot de passe par l'utilisateur : ancien mot de passe vérifié, politique appliquée ; ses autres sessions sont fermées.</summary>
    public async Task ChangerMotDePasseAsync(SessionLue s, ChangementMotDePasse c, Origine origine, CancellationToken ct)
    {
        var compte = await db.Comptes.FirstOrDefaultAsync(x => x.CptId == s.CptId, ct) ?? throw ExceptionMetier.Introuvable("Compte");
        if (!HachageMotDePasse.Verifier(c.Actuel ?? "", compte.CptHash))
        {
            throw ExceptionMetier.Invalide("MDP_ACTUEL", "Mot de passe actuel incorrect");
        }
        var parametres = await ParametresAsync(ct);
        var erreurs = ReglesCompte.ControlerMotDePasse(c.Nouveau, parametres.MotDePasse, compte.CptCode);
        if (c.Nouveau == c.Actuel) erreurs.Add("MDP_IDENTIQUE");
        if (erreurs.Count > 0) throw ErreursRegles(erreurs);
        compte.CptHash = HachageMotDePasse.Hacher(c.Nouveau!);
        compte.CptMdpProvisoire = false;
        compte.CptMajLe = DateTimeOffset.UtcNow;
        compte.CptMajPar = compte.CptCode;
        db.Journal.Add(Entree(compte.CptCode, "MDP_CHANGE", null, origine, compte.CptCode));
        await db.SaveChangesAsync(ct);
        await db.Sessions.Where(x => x.SesCptId == compte.CptId && x.SesId != s.SesId && x.SesFermeeLe == null)
            .ExecuteUpdateAsync(x => x.SetProperty(y => y.SesFermeeLe, DateTimeOffset.UtcNow), ct);
        OublierSessions();
    }

    /// <summary>Erreurs de règles traduites en 422 (code de la première, détail de toutes).</summary>
    public static ExceptionMetier ErreursRegles(List<string> codes) => ExceptionMetier.Invalide(codes[0],
        string.Join(" · ", codes.Select(c => ReglesCompte.Messages.GetValueOrDefault(c, c == "MDP_IDENTIQUE" ? "Le nouveau mot de passe doit différer de l'actuel" : c))),
        codes.Select(c => new { code = c, message = ReglesCompte.Messages.GetValueOrDefault(c, c == "MDP_IDENTIQUE" ? "Le nouveau mot de passe doit différer de l'actuel" : c) }).ToList());

    /// <summary>Cache des sessions vidé (désactivation, changement de profil ou de mot de passe, déconnexion) : relu au prochain appel.</summary>
    public static void OublierSessions() => Cache.Clear();

    // ---------------------------------------------------------------- journal

    public sealed record Origine(string? Adresse, string? Navigateur)
    {
        public static Origine Depuis(HttpContext http) => new(http.Connection.RemoteIpAddress?.ToString(), http.Request.Headers.UserAgent.ToString());
    }

    private static string? Tronquer(string? s, int n) => s is null ? null : s.Length <= n ? s : s[..n];

    private static JournalConnexion Entree(string code, string evenement, string? detail, Origine o, string? par) => new()
    {
        JcoCode = Tronquer(code, 50)!, JcoEvenement = evenement, JcoDetail = Tronquer(detail, 200), JcoLe = DateTimeOffset.UtcNow,
        JcoAdresse = Tronquer(o.Adresse, 64), JcoNavigateur = Tronquer(o.Navigateur, 300), JcoPar = par,
    };

    public async Task JournaliserAsync(string code, string evenement, string? detail, Origine o, string? par, CancellationToken ct, bool enregistrer = true)
    {
        db.Journal.Add(Entree(code, evenement, detail, o, par));
        if (enregistrer) await db.SaveChangesAsync(ct);
    }
}
