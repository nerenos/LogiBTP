using System.Collections.Concurrent;
using System.Text.Json;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
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
    /// <summary>Adresses de confiance (réseau local, serveur TSE ; CIDR) : ni exclusion d'adresse, ni double facteur (D30).</summary>
    public List<string> AdressesConfiance { get; set; } = [];
    /// <summary>Nom du cookie du jeton d'accès (JWT court) et du cookie de machine connue.</summary>
    public string NomCookieAcces { get; set; } = "logibtp_acces";
    public string NomCookieMachine { get; set; } = "logibtp_machine";
    public bool EnTetes => string.Equals(Mode, "EnTetes", StringComparison.OrdinalIgnoreCase);
}

public sealed record ParametresSession(int InactiviteHeures = 10, int ResterConnecteJours = 7, bool ResterConnecte = true, int DureeMaxHeures = 24);
public sealed record ParametresVerrouillage(int Echecs = 5, int Minutes = 15);

/// <summary>Réglages de la société (parametre_authentification).</summary>
public sealed record ParametresAuthentification(ParametresSession Session, ParametresVerrouillage Verrouillage, PolitiqueMotDePasse MotDePasse, IReadOnlyList<string> PseudosReserves);

public sealed record ConnexionSaisie(string? Identifiant, string? MotDePasse, bool ResterConnecte = false);

/// <summary>
/// Résultat d'une connexion : session ouverte (jeton de rafraîchissement à poser en cookie, jeton de machine connue
/// nouvellement créée), ou étape du double facteur (code envoyé par courriel, à saisir avec le jeton d'étape).
/// </summary>
public sealed record ResultatConnexion(string? Jeton, SessionLue? Session, string? Machine = null, EtapeConnexion? Etape = null);

/// <summary>Étape du double facteur : jeton à renvoyer avec le code, destination masquée du courriel, fin de validité.</summary>
public sealed record EtapeConnexion(string Jeton, string Destination, DateTimeOffset ExpireLe);
public sealed record ChangementMotDePasse(string? Actuel, string? Nouveau);
public sealed record DemandeOubli(string? Identifiant);
public sealed record Reinitialisation(string? Jeton, string? Nouveau);

/// <summary>Session valide lue depuis le cookie (en cache court par base).</summary>
public sealed record SessionLue(long SesId, long CptId, string Code, string? Libelle, string Profil, bool MdpAChanger,
    string? TypeElement, string? IdElement, DateTimeOffset ExpireLe, bool Persistante, DateTimeOffset VuLe, UsurpationLue? Usurpation = null, AgentRequete? Agent = null)
{
    /// <summary>
    /// Utilisateur de la requête : le compte usurpé pendant une usurpation (administrateur en Usurpateur), sinon le compte
    /// (avec l'agent pour un jeton délégué : jamais d'usurpation dans ce cas).
    /// </summary>
    public Utilisateur Utilisateur => Agent is { } agent ? new Utilisateur(Code, Profil) { Agent = agent }
        : Usurpation is { } us ? new Utilisateur(us.Code, us.Profil) { Usurpateur = Code } : new Utilisateur(Code, Profil);
}

/// <summary>Usurpation en cours dans une session : compte usurpé, fin, motif.</summary>
public sealed record UsurpationLue(long CptId, string Code, string? Libelle, string Profil, DateTimeOffset Fin, string Motif);

public sealed record DemandeUsurpation(string? Identifiant, string? Motif);
public sealed record ParametresUsurpation(int Minutes = 60, bool Notifier = true);

/// <summary>Ce que le client sait de sa session (GET /auth/session).</summary>
public sealed record DescriptionSession(bool Connecte, string? Code, string? Libelle, string? Profil, bool MdpAChanger,
    string? TypeElement, string? IdElement, DateTimeOffset? ExpireLe, string Mode, bool ComptesTest, bool ResterConnectePermis,
    object? Usurpation = null);

/// <summary>
/// Comptes, connexion, sessions et journal (ANALYSE-MODULE-AUTHENTIFICATION.md) : verrouillage après N échecs (message
/// identique pour un identifiant inconnu, un mot de passe faux ou un compte verrouillé), expiration glissante,
/// « Rester connecté », mot de passe provisoire à changer, journal des connexions.
/// </summary>
public sealed partial class ServiceAuthentification(AuthDbContext db, SpecialisationAuthentification specialisation, SocieteCourante societe,
    IOptions<OptionsAuthentification> options, IServiceProvider services)
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

    private static readonly JsonSerializerOptions JsonCalculOptions = JsonCalcul.Options;

    // ---------------------------------------------------------------- connexion

    /// <summary>Ouvre une session (jeton du cookie renvoyé) ; refus générique pour un identifiant inconnu, un mot de passe faux ou un compte verrouillé.</summary>
    public async Task<ResultatConnexion> ConnecterAsync(ConnexionSaisie s, Origine origine, CancellationToken ct)
    {
        var code = ReglesCompte.Normaliser(s.Identifiant);
        var mdp = s.MotDePasse ?? "";
        var parametres = await ParametresAsync(ct);
        var maintenant = DateTimeOffset.UtcNow;
        await ControlerAdresseAsync(code, origine, ct);
        var compte = code.Length == 0 ? null : await db.Comptes.FirstOrDefaultAsync(x => x.CptCode.ToLower() == code && x.CptType != "API", ct);
        if (compte is null)
        {
            HachageMotDePasse.Verifier(mdp, HashFactice); // même durée qu'un compte existant
            await JournaliserAsync(code.Length == 0 ? "?" : code, "ECHEC", "identifiant inconnu", origine, null, ct);
            await CompterEchecAsync(origine, ct);
            throw Refus();
        }
        var etat = ReglesCompte.Etat(compte.AEvaluer(), maintenant);
        if (etat.Etat == "VERROUILLE")
        {
            await JournaliserAsync(compte.CptCode, "ECHEC", "compte verrouillé", origine, null, ct);
            await CompterEchecAsync(origine, ct);
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
            await CompterEchecAsync(origine, ct);
            throw Refus();
        }
        await VerifierOuvertureAsync(compte, etat, origine, ct);
        compte.CptEchecs = 0;
        compte.CptVerrouilleJusquAu = null;
        if (HachageMotDePasse.AReprendre(compte.CptHash)) compte.CptHash = HachageMotDePasse.Hacher(mdp);
        var rester = s.ResterConnecte && parametres.Session.ResterConnecte;
        // Double facteur (D3, D30) : code par courriel, sauf adresse de confiance ou machine déjà connue du compte.
        if (await DoubleFacteurRequisAsync(compte, origine, ct) && await EnvoyerCodeAsync(compte, rester, origine, ct) is { } etape)
        {
            await db.SaveChangesAsync(ct);
            return new ResultatConnexion(null, null, null, etape);
        }
        compte.CptDerniereConnexion = maintenant;
        return await OuvrirAsync(compte, rester, parametres, origine, "", ct);
    }

    /// <summary>Connexion sans mot de passe à un compte choisi : environnement de développement et ComptesTest seulement (A10, A11).</summary>
    public async Task<ResultatConnexion> ConnecterTestAsync(string? identifiant, bool developpement, Origine origine, CancellationToken ct)
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

    /// <summary>
    /// Ouvre une session (famille de jetons) : « Rester connecté » enregistre la machine (D4) si elle n'est pas encore
    /// connue du compte et porte la fin absolue à 7 jours ; sinon un jour (D2). Expiration glissante dans cette limite.
    /// </summary>
    private async Task<ResultatConnexion> OuvrirAsync(Compte compte, bool rester, ParametresAuthentification p, Origine origine, string detail,
        CancellationToken ct, bool test = false, bool api = false)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var (jeton, empreinte) = HachageMotDePasse.NouveauJeton();
        var machine = api || test ? null : await MachineDuCompteAsync(compte.CptId, origine, ct);
        string? nouvelleMachine = null;
        if (rester && machine is null && !api && !test) (machine, nouvelleMachine) = await EnregistrerMachineAsync(compte, origine, ct);
        var persistante = rester && machine is not null;
        var absolue = persistante ? maintenant.AddDays(p.Session.ResterConnecteJours) : maintenant.AddHours(p.Session.DureeMaxHeures);
        var glissante = persistante ? absolue : maintenant.AddHours(p.Session.InactiviteHeures);
        var session = new SessionUtilisateur
        {
            SesJetonHache = empreinte, SesCptId = compte.CptId, SesCreeLe = maintenant, SesVuLe = maintenant, SesPersistante = persistante,
            SesExpireLe = glissante < absolue ? glissante : absolue, SesAbsolueLe = absolue, SesMacId = machine?.MacId, SesApi = api,
            SesAdresse = Tronquer(origine.Adresse, 64), SesNavigateur = Tronquer(origine.Navigateur, 300), SesTest = test,
        };
        db.Sessions.Add(session);
        db.Journal.Add(Entree(compte.CptCode, api ? "JETON_API" : "CONNEXION",
            detail.Length == 0 ? (persistante ? "rester connecté (machine connue)" : machine is not null ? "machine connue" : null) : detail, origine, null));
        await db.SaveChangesAsync(ct);
        return new ResultatConnexion(jeton, Lue(session, compte), nouvelleMachine);
    }

    private static SessionLue Lue(SessionUtilisateur s, Compte c) =>
        new(s.SesId, c.CptId, c.CptCode, c.CptLibelle, c.CptProfil, c.CptMdpProvisoire && !s.SesTest, c.CptTypeElement, c.CptIdElement, s.SesExpireLe, s.SesPersistante, s.SesVuLe);

    private static ExceptionMetier Refus() => new(StatusCodes.Status401Unauthorized, "CONNEXION_REFUSEE", MessageRefus);

    // ---------------------------------------------------------------- session courante

    /// <summary>
    /// Session valide du jeton (null : inconnue, fermée, expirée, compte devenu inutilisable — la session est alors
    /// fermée). Expiration glissante sans « Rester connecté » ; dernière activité notée au plus une fois par minute.
    /// </summary>
    public Task<SessionLue?> LireSessionAsync(string jeton, CancellationToken ct) => LireSessionHacheeAsync(HachageMotDePasse.Empreinte(jeton), ct);

    private async Task<SessionLue?> LireSessionHacheeAsync(string empreinte, CancellationToken ct)
    {
        var cle = (societe.Connexion, empreinte);
        var maintenant = DateTimeOffset.UtcNow;
        if (Cache.TryGetValue(cle, out var c) && maintenant - c.Lu < DureeCache && c.Session.ExpireLe > maintenant) return c.Session;
        var session = await db.Sessions.FirstOrDefaultAsync(x => x.SesJetonHache == empreinte && x.SesFermeeLe == null, ct);
        if (session is null || session.SesExpireLe <= maintenant || session.SesAbsolueLe <= maintenant)
        {
            Cache.TryRemove(cle, out _);
            return null;
        }
        var compte = await db.Comptes.FirstOrDefaultAsync(x => x.CptId == session.SesCptId, ct);
        var utilisable = compte is { CptActif: true } && compte.CptType == (session.SesApi ? "API" : "PERSONNE")
            && !(compte.CptValideJusquAu < DateOnly.FromDateTime(maintenant.UtcDateTime));
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
            if (!session.SesPersistante)
            {
                var glissante = maintenant.AddHours((await ParametresAsync(ct)).Session.InactiviteHeures);
                session.SesExpireLe = session.SesAbsolueLe is { } absolue && absolue < glissante ? absolue : glissante;
            }
            await db.SaveChangesAsync(ct);
        }
        var lue = Lue(session, compte!);
        if (session.SesUsurpeCptId is long usurpe)
        {
            var cible = await db.Comptes.AsNoTracking().FirstOrDefaultAsync(x => x.CptId == usurpe, ct);
            if (session.SesUsurpationFin > maintenant && cible is { CptType: "PERSONNE", CptActif: true })
            {
                lue = lue with { Usurpation = new UsurpationLue(cible.CptId, cible.CptCode, cible.CptLibelle, cible.CptProfil, session.SesUsurpationFin.Value, session.SesUsurpationMotif ?? "") };
            }
            else
            {
                session.SesUsurpeCptId = null;
                session.SesUsurpationFin = null;
                session.SesUsurpationMotif = null;
                db.Journal.Add(Entree(compte!.CptCode, "USURPATION_FIN", $"{cible?.CptCode} : durée écoulée", new Origine(null, null), null));
                await db.SaveChangesAsync(ct);
            }
        }
        Cache[cle] = (maintenant, lue);
        return lue;
    }

    // ---------------------------------------------------------------- usurpation

    public async Task<ParametresUsurpation> ParametresUsurpationAsync(CancellationToken ct)
    {
        var p = await db.Parametres.AsNoTracking().FirstOrDefaultAsync(x => x.PauCle == "usurpation", ct);
        return p?.PauValeur.RootElement.Deserialize<ParametresUsurpation>(JsonCalculOptions) ?? new ParametresUsurpation();
    }

    /// <summary>
    /// Usurpation (D14, D27) : un administrateur agit pour un autre compte de personne (tests des droits, dépannage) ;
    /// jamais un compte à profil total ni le sien, motif obligatoire, durée limitée (paramètre), mot de passe et gestion
    /// des droits interdits pendant l'usurpation (intergiciel) ; début, fin et chaque écriture au journal des deux comptes.
    /// </summary>
    public async Task<SessionLue> UsurperAsync(SessionLue s, DemandeUsurpation d, IServiceProvider services, Origine origine, CancellationToken ct)
    {
        if (s.Agent is not null) throw ExceptionMetier.AgentInterdit("usurpation");
        if (s.Usurpation is not null) throw ExceptionMetier.Conflit("USURPATION_EN_COURS", "Une usurpation est déjà en cours : terminez-la d'abord");
        if (!await specialisation.PeutUsurperAsync(services, new Utilisateur(s.Code, s.Profil), ct)) throw ExceptionMetier.AccesRefuse(ActionsDroits.Usurper);
        var motif = d.Motif?.Trim() ?? "";
        if (motif.Length < 3) throw ExceptionMetier.Invalide("USURPATION_MOTIF", "Motif de l'usurpation obligatoire (test des droits, dépannage…)");
        var code = ReglesCompte.Normaliser(d.Identifiant);
        var cible = await db.Comptes.AsNoTracking().FirstOrDefaultAsync(x => x.CptCode.ToLower() == code && x.CptType == "PERSONNE", ct)
            ?? throw ExceptionMetier.Introuvable($"Compte {code}");
        if (cible.CptId == s.CptId) throw ExceptionMetier.Invalide("USURPATION_SOI", "Usurpation de son propre compte impossible");
        if (ReglesCompte.Etat(cible.AEvaluer(), DateTimeOffset.UtcNow).Etat is "INACTIF" or "EXPIRE")
        {
            throw ExceptionMetier.Invalide("USURPATION_INACTIF", $"Le compte {cible.CptCode} est désactivé ou expiré");
        }
        if (await specialisation.ProfilTotalAsync(services, cible.CptProfil, ct))
        {
            throw ExceptionMetier.Invalide("USURPATION_ADMIN", "Un compte administrateur ne peut pas être usurpé");
        }
        var p = await ParametresUsurpationAsync(ct);
        var fin = DateTimeOffset.UtcNow.AddMinutes(Math.Clamp(p.Minutes, 5, 60));
        var session = await db.Sessions.FirstAsync(x => x.SesId == s.SesId, ct);
        session.SesUsurpeCptId = cible.CptId;
        session.SesUsurpationFin = fin;
        session.SesUsurpationMotif = Tronquer(motif, 200);
        db.Journal.Add(Entree(s.Code, "USURPATION", Tronquer($"→ {cible.CptCode} : {motif}", 200), origine, s.Code));
        db.Journal.Add(Entree(cible.CptCode, "USURPATION", Tronquer($"par {s.Code} : {motif}", 200), origine, s.Code));
        await db.SaveChangesAsync(ct);
        OublierSessions();
        if (p.Notifier) await specialisation.ApresUsurpationAsync(services, cible, s.Code, motif, ct);
        return s with { Usurpation = new UsurpationLue(cible.CptId, cible.CptCode, cible.CptLibelle, cible.CptProfil, fin, motif) };
    }

    public async Task<SessionLue> TerminerUsurpationAsync(SessionLue s, Origine origine, CancellationToken ct)
    {
        if (s.Usurpation is not { } us) return s;
        await db.Sessions.Where(x => x.SesId == s.SesId).ExecuteUpdateAsync(x => x
            .SetProperty(y => y.SesUsurpeCptId, (long?)null).SetProperty(y => y.SesUsurpationFin, (DateTimeOffset?)null)
            .SetProperty(y => y.SesUsurpationMotif, (string?)null), ct);
        db.Journal.Add(Entree(s.Code, "USURPATION_FIN", us.Code, origine, s.Code));
        db.Journal.Add(Entree(us.Code, "USURPATION_FIN", $"par {s.Code}", origine, s.Code));
        await db.SaveChangesAsync(ct);
        OublierSessions();
        return s with { Usurpation = null };
    }

    /// <summary>Écriture faite pendant une usurpation : tracée au journal du compte usurpé, par l'administrateur.</summary>
    public Task JournaliserActionUsurpeeAsync(SessionLue s, string action, Origine origine, CancellationToken ct) =>
        JournaliserAsync(s.Usurpation!.Code, "USURPATION_ACTION", Tronquer(action, 200), origine, s.Code, ct);

    public DescriptionSession Decrire(SessionLue? s, ParametresAuthentification? p, bool developpement) => new(
        s is not null, s?.Code, s?.Libelle, s?.Profil, s?.MdpAChanger ?? false, s?.TypeElement, s?.IdElement, s?.ExpireLe,
        Options.EnTetes ? "EnTetes" : "Session", developpement && Options.ComptesTest, p?.Session.ResterConnecte ?? true,
        s?.Usurpation is { } us ? new { code = us.Code, libelle = us.Libelle, profil = us.Profil, fin = us.Fin, motif = us.Motif } : null);

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
        await RevoquerJetonsAsync(db, compte.CptId, ct);
        OublierSessions();
    }

    // ---------------------------------------------------------------- mot de passe oublié

    /// <summary>Durée de validité d'un lien de réinitialisation, demandes par heure et par compte.</summary>
    public static readonly TimeSpan DureeLien = TimeSpan.FromMinutes(30);
    public const int DemandesParHeure = 3;

    /// <summary>
    /// Demande de réinitialisation : sans effet visible pour le demandeur (aucune indication sur l'existence du compte) ;
    /// compte de personne actif, à changer, verrouillé ou sans mot de passe, trois demandes par heure au plus : lien à
    /// usage unique de 30 minutes envoyé par la spécialisation (courriel de la personne liée), journalisé.
    /// </summary>
    public async Task DemanderReinitialisationAsync(DemandeOubli d, string adresseApplication, IServiceProvider services, Origine origine, CancellationToken ct)
    {
        var code = ReglesCompte.Normaliser(d.Identifiant);
        if (code.Length == 0) return;
        var compte = await db.Comptes.FirstOrDefaultAsync(x => x.CptCode.ToLower() == code, ct);
        var maintenant = DateTimeOffset.UtcNow;
        if (compte is null || compte.CptType != "PERSONNE" || ReglesCompte.Etat(compte.AEvaluer(), maintenant).Etat is "INACTIF" or "EXPIRE" or "SERVICE")
        {
            await JournaliserAsync(code, "MDP_OUBLI", "demande sans suite (compte inconnu ou inactif)", origine, null, ct);
            return;
        }
        var heure = maintenant.AddHours(-1);
        if (await db.Reinitialisations.CountAsync(r => r.RmpCptId == compte.CptId && r.RmpCreeLe > heure, ct) >= DemandesParHeure)
        {
            await JournaliserAsync(compte.CptCode, "MDP_OUBLI", "demande refusée : trop de demandes dans l'heure", origine, null, ct);
            return;
        }
        var (jeton, empreinte) = HachageMotDePasse.NouveauJeton();
        var expire = maintenant + DureeLien;
        db.Reinitialisations.Add(new ReinitialisationMdp
        {
            RmpCptId = compte.CptId, RmpEmpreinte = empreinte, RmpCreeLe = maintenant, RmpExpireLe = expire, RmpAdresse = Tronquer(origine.Adresse, 64),
        });
        await db.SaveChangesAsync(ct);
        var envoye = await specialisation.EnvoyerReinitialisationAsync(services, compte, $"{adresseApplication.TrimEnd('/')}/connexion?jeton={jeton}", expire, ct);
        await JournaliserAsync(compte.CptCode, "MDP_OUBLI", envoye ? "lien envoyé par courriel" : "lien non envoyé (pas d'adresse ou pas de messagerie)", origine, null, ct);
    }

    /// <summary>
    /// Nouveau mot de passe par un lien valable (non utilisé, non expiré) : politique appliquée, compte déverrouillé, mot
    /// de passe définitif, autres demandes du compte annulées, sessions fermées ; lien inconnu : 422 LIEN_INVALIDE.
    /// </summary>
    public async Task ReinitialiserAsync(Reinitialisation r, Origine origine, CancellationToken ct)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var empreinte = HachageMotDePasse.Empreinte(r.Jeton ?? "");
        var d = await db.Reinitialisations.FirstOrDefaultAsync(x => x.RmpEmpreinte == empreinte, ct);
        var compte = d is null ? null : await db.Comptes.FirstOrDefaultAsync(x => x.CptId == d.RmpCptId, ct);
        if (d is null || compte is null || d.RmpUtiliseLe is not null || d.RmpExpireLe < maintenant
            || ReglesCompte.Etat(compte.AEvaluer(), maintenant).Etat is "INACTIF" or "EXPIRE" or "SERVICE")
        {
            throw ExceptionMetier.Invalide("LIEN_INVALIDE", "Lien expiré ou déjà utilisé : refaites une demande depuis la page de connexion");
        }
        var erreurs = ReglesCompte.ControlerMotDePasse(r.Nouveau, (await ParametresAsync(ct)).MotDePasse, compte.CptCode);
        if (erreurs.Count > 0) throw ErreursRegles(erreurs);
        compte.CptHash = HachageMotDePasse.Hacher(r.Nouveau!);
        compte.CptMdpProvisoire = false;
        compte.CptEchecs = 0;
        compte.CptVerrouilleJusquAu = null;
        compte.CptMajLe = maintenant;
        compte.CptMajPar = compte.CptCode;
        await db.Reinitialisations.Where(x => x.RmpCptId == compte.CptId && x.RmpUtiliseLe == null)
            .ExecuteUpdateAsync(x => x.SetProperty(y => y.RmpUtiliseLe, maintenant), ct);
        db.Journal.Add(Entree(compte.CptCode, "MDP_REINITIALISE", "par le lien envoyé par courriel", origine, compte.CptCode));
        await db.SaveChangesAsync(ct);
        await db.Sessions.Where(x => x.SesCptId == compte.CptId && x.SesFermeeLe == null).ExecuteUpdateAsync(x => x.SetProperty(y => y.SesFermeeLe, maintenant), ct);
        await RevoquerJetonsAsync(db, compte.CptId, ct);
        OublierSessions();
    }

    /// <summary>Erreurs de règles traduites en 422 (code de la première, détail de toutes).</summary>
    public static ExceptionMetier ErreursRegles(List<string> codes) => ExceptionMetier.Invalide(codes[0],
        string.Join(" · ", codes.Select(c => ReglesCompte.Messages.GetValueOrDefault(c, c == "MDP_IDENTIQUE" ? "Le nouveau mot de passe doit différer de l'actuel" : c))),
        codes.Select(c => new { code = c, message = ReglesCompte.Messages.GetValueOrDefault(c, c == "MDP_IDENTIQUE" ? "Le nouveau mot de passe doit différer de l'actuel" : c) }).ToList());

    /// <summary>Cache des sessions et des jetons délégués vidé (désactivation, changement de profil ou de mot de passe, déconnexion) : relu au prochain appel.</summary>
    public static void OublierSessions()
    {
        Cache.Clear();
        CacheJetons.Clear();
        JetonsAcces.Invalider();
    }

    // ---------------------------------------------------------------- journal

    /// <summary>Origine d'une requête : adresse, navigateur, jeton de machine connue (cookie, jamais journalisé).</summary>
    public sealed record Origine(string? Adresse, string? Navigateur, string? Machine = null)
    {
        public static Origine Depuis(HttpContext http) => new(http.Connection.RemoteIpAddress?.ToString(), http.Request.Headers.UserAgent.ToString(),
            http.Request.Cookies[http.RequestServices.GetService(typeof(IOptions<OptionsAuthentification>)) is IOptions<OptionsAuthentification> o ? o.Value.NomCookieMachine : "logibtp_machine"]);
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
