using System.Security.Cryptography;
using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Authentification.Web;

public sealed record ParametresDoubleFacteur(string Mode = "ADMIN");
public sealed record ParametresExclusion(int Echecs = 20, int Minutes = 10, List<int>? Durees = null)
{
    public IReadOnlyList<int> DureesEffectives => Durees is { Count: > 0 } ? Durees : [15, 60, 1440];
}

public sealed record SaisieCode(string? Etape, string? Code);
public sealed record DemandeJeton(string? Identifiant, string? Secret);
public sealed record DemandeRafraichissement(string? Rafraichissement);
/// <summary>Jetons d'un identifiant d'API : accès (Bearer, 15 min), rafraîchissement (usage unique, rotatif).</summary>
public sealed record JetonsApi(string Acces, string Rafraichissement, int ExpireDans);
public sealed record SessionDto(Guid Id, DateTimeOffset CreeLe, DateTimeOffset VuLe, DateTimeOffset ExpireLe, string? Adresse, string? Navigateur,
    bool Persistante, bool Courante, bool Api, string? Machine);
public sealed record MachineDto(Guid Id, string? Nom, DateTimeOffset CreeLe, DateTimeOffset VuLe, string? Adresse);
public sealed record ExclusionDto(long Id, string Prefixe, DateTimeOffset Debut, DateTimeOffset Fin, int Echecs, string? LeveePar, DateTimeOffset? LeveeLe);
public sealed record CompteApiSaisi(string? Code, string? Libelle, string? Profil, List<string>? Adresses);

/// <summary>
/// Sécurité de la connexion (module Droits, lot 3) : rafraîchissement rotatif des sessions (D1), machines connues (D4),
/// double facteur par courriel (D3, D30), exclusion d'une adresse après trop d'échecs (D19 à D21), identifiants d'API
/// (D15), sessions et machines d'un compte (déconnexion à distance).
/// </summary>
public sealed partial class ServiceAuthentification
{
    private static readonly TimeSpan GraceRotation = TimeSpan.FromSeconds(30);

    private async Task<T> ParametreAsync<T>(string cle, T defaut, CancellationToken ct) where T : class
    {
        var p = await db.Parametres.AsNoTracking().FirstOrDefaultAsync(x => x.PauCle == cle, ct);
        return p?.PauValeur.RootElement.Deserialize<T>(JsonCalculOptions) ?? defaut;
    }

    private bool DeConfiance(Origine o) => Adresses.DansPlages(o.Adresse, Options.AdressesConfiance);

    // ---------------------------------------------------------------- exclusion d'adresse (D19 à D21)

    /// <summary>
    /// Adresse exclue (et pas de confiance) : refus générique, sauf si la requête présente le jeton d'une machine connue
    /// (D20 : l'exemption vaut pour la requête, pas pour l'adresse entière).
    /// </summary>
    private async Task ControlerAdresseAsync(string code, Origine o, CancellationToken ct)
    {
        if (DeConfiance(o) || Adresses.Prefixe(o.Adresse) is not { } prefixe) return;
        var maintenant = DateTimeOffset.UtcNow;
        if (!await db.Exclusions.AnyAsync(e => e.IpePrefixe == prefixe && e.IpeFin > maintenant && e.IpeLeveeLe == null, ct)) return;
        if (await MachineValideAsync(o, ct)) return;
        await JournaliserAsync(code.Length == 0 ? "?" : code, "ECHEC", "adresse exclue", o, null, ct);
        throw Refus();
    }

    /// <summary>Échec compté par adresse sur la fenêtre, tous comptes confondus ; au seuil : exclusion de durée croissante.</summary>
    private async Task CompterEchecAsync(Origine o, CancellationToken ct)
    {
        if (DeConfiance(o) || Adresses.Prefixe(o.Adresse) is not { } prefixe) return;
        var p = await ParametreAsync("exclusion_ip", new ParametresExclusion(), ct);
        var maintenant = DateTimeOffset.UtcNow;
        var depuis = maintenant.AddMinutes(-p.Minutes);
        var adresses = await db.Journal.AsNoTracking().Where(j => j.JcoEvenement == "ECHEC" && j.JcoLe >= depuis && j.JcoAdresse != null)
            .Select(j => j.JcoAdresse).ToListAsync(ct);
        var echecs = adresses.Count(a => Adresses.Prefixe(a) == prefixe);
        if (echecs < p.Echecs || await db.Exclusions.AnyAsync(e => e.IpePrefixe == prefixe && e.IpeFin > maintenant && e.IpeLeveeLe == null, ct)) return;
        var hier = maintenant.AddDays(-1);
        var recidive = await db.Exclusions.CountAsync(e => e.IpePrefixe == prefixe && e.IpeDebut >= hier, ct);
        var duree = p.DureesEffectives[Math.Min(recidive, p.DureesEffectives.Count - 1)];
        var fin = maintenant.AddMinutes(duree);
        db.Exclusions.Add(new IpExclue { IpePrefixe = prefixe, IpeDebut = maintenant, IpeFin = fin, IpeEchecs = echecs });
        db.Journal.Add(Entree(prefixe, "EXCLUSION_IP", $"{echecs} échecs en {p.Minutes} min : exclue {duree} min", o, null));
        await db.SaveChangesAsync(ct);
        await specialisation.ApresExclusionAsync(services, prefixe, fin, echecs, ct);
    }

    public async Task<List<ExclusionDto>> ExclusionsAsync(Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("EXCLUSIONS");
        var depuis = DateTimeOffset.UtcNow.AddDays(-7);
        return (await db.Exclusions.AsNoTracking().Where(e => e.IpeFin >= depuis).OrderByDescending(e => e.IpeDebut).Take(200).ToListAsync(ct))
            .Select(e => new ExclusionDto(e.IpeId, e.IpePrefixe, e.IpeDebut, e.IpeFin, e.IpeEchecs, e.IpeLeveePar, e.IpeLeveeLe)).ToList();
    }

    public async Task LeverExclusionAsync(long id, Utilisateur u, Origine o, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("EXCLUSIONS");
        var e = await db.Exclusions.FirstOrDefaultAsync(x => x.IpeId == id, ct) ?? throw ExceptionMetier.Introuvable("Exclusion");
        e.IpeLeveeLe = DateTimeOffset.UtcNow;
        e.IpeLeveePar = u.Code;
        db.Journal.Add(Entree(e.IpePrefixe, "EXCLUSION_IP", "levée", o, u.Code));
        await db.SaveChangesAsync(ct);
    }

    // ---------------------------------------------------------------- machines connues (D4)

    private async Task<MachineConnue?> MachineAsync(Origine o, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(o.Machine)) return null;
        var empreinte = HachageMotDePasse.Empreinte(o.Machine);
        return await db.Machines.FirstOrDefaultAsync(m => m.MacEmpreinte == empreinte && m.MacRevoqueeLe == null, ct);
    }

    private async Task<bool> MachineValideAsync(Origine o, CancellationToken ct) => await MachineAsync(o, ct) is not null;

    /// <summary>Machine de la requête si elle est connue de ce compte (dernière utilisation notée).</summary>
    private async Task<MachineConnue?> MachineDuCompteAsync(long cptId, Origine o, CancellationToken ct)
    {
        var m = await MachineAsync(o, ct);
        if (m is null || m.MacCptId != cptId) return null;
        m.MacVuLe = DateTimeOffset.UtcNow;
        m.MacAdresse = Tronquer(o.Adresse, 64);
        return m;
    }

    private async Task<(MachineConnue, string)> EnregistrerMachineAsync(Compte compte, Origine o, CancellationToken ct)
    {
        var (jeton, empreinte) = HachageMotDePasse.NouveauJeton();
        var m = new MachineConnue { MacCptId = compte.CptId, MacEmpreinte = empreinte, MacNom = Tronquer(NomNavigateur(o.Navigateur), 120), MacAdresse = Tronquer(o.Adresse, 64) };
        db.Machines.Add(m);
        db.Journal.Add(Entree(compte.CptCode, "MACHINE", $"nouvelle machine : {m.MacNom}", o, null));
        await db.SaveChangesAsync(ct);
        return (m, jeton);
    }

    /// <summary>Nom lisible d'une machine : navigateur et système tirés de l'agent utilisateur.</summary>
    public static string NomNavigateur(string? agent)
    {
        agent ??= "";
        var navigateur = agent.Contains("Edg/") ? "Edge" : agent.Contains("Firefox/") ? "Firefox" : agent.Contains("Chrome/") ? "Chrome" : agent.Contains("Safari/") ? "Safari" : "Navigateur";
        var systeme = agent.Contains("Windows") ? "Windows" : agent.Contains("Android") ? "Android" : agent.Contains("iPhone") || agent.Contains("iPad") ? "iOS"
            : agent.Contains("Mac OS") ? "macOS" : agent.Contains("Linux") ? "Linux" : "";
        return systeme.Length > 0 ? $"{navigateur} sur {systeme}" : navigateur;
    }

    public async Task<List<MachineDto>> MachinesAsync(long cptId, CancellationToken ct) =>
        (await db.Machines.AsNoTracking().Where(m => m.MacCptId == cptId && m.MacRevoqueeLe == null).OrderByDescending(m => m.MacVuLe).ToListAsync(ct))
        .Select(m => new MachineDto(m.MacUuid, m.MacNom, m.MacCreeLe, m.MacVuLe, m.MacAdresse)).ToList();

    /// <summary>Machine oubliée : plus de « Rester connecté » ni d'exemption du double facteur ; ses sessions sont fermées.</summary>
    public async Task RevoquerMachineAsync(long cptId, Guid id, Origine o, string par, CancellationToken ct)
    {
        var m = await db.Machines.FirstOrDefaultAsync(x => x.MacUuid == id && x.MacCptId == cptId, ct) ?? throw ExceptionMetier.Introuvable("Machine");
        var maintenant = DateTimeOffset.UtcNow;
        m.MacRevoqueeLe = maintenant;
        var code = await db.Comptes.Where(c => c.CptId == cptId).Select(c => c.CptCode).FirstAsync(ct);
        db.Journal.Add(Entree(code, "MACHINE", $"machine oubliée : {m.MacNom}", o, par));
        await db.SaveChangesAsync(ct);
        await db.Sessions.Where(s => s.SesMacId == m.MacId && s.SesFermeeLe == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.SesFermeeLe, maintenant), ct);
        OublierSessions();
    }

    // ---------------------------------------------------------------- sessions d'un compte

    public async Task<List<SessionDto>> SessionsAsync(long cptId, long? courante, CancellationToken ct)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var sessions = await db.Sessions.AsNoTracking().Where(s => s.SesCptId == cptId && s.SesFermeeLe == null && s.SesExpireLe > maintenant)
            .OrderByDescending(s => s.SesVuLe).ToListAsync(ct);
        var machines = await db.Machines.AsNoTracking().Where(m => m.MacCptId == cptId).ToDictionaryAsync(m => m.MacId, m => m.MacNom, ct);
        return sessions.Select(s => new SessionDto(s.SesUuid, s.SesCreeLe, s.SesVuLe, s.SesExpireLe, s.SesAdresse, NomNavigateur(s.SesNavigateur), s.SesPersistante,
            s.SesId == courante, s.SesApi, s.SesMacId is long m ? machines.GetValueOrDefault(m) : null)).ToList();
    }

    /// <summary>Déconnexion à distance d'une session du compte (ou de toutes, sauf la courante).</summary>
    public async Task FermerSessionsAsync(long cptId, Guid? id, long? courante, Origine o, string par, CancellationToken ct)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var n = await db.Sessions.Where(s => s.SesCptId == cptId && s.SesFermeeLe == null && (id == null ? s.SesId != courante : s.SesUuid == id))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.SesFermeeLe, maintenant), ct);
        var code = await db.Comptes.Where(c => c.CptId == cptId).Select(c => c.CptCode).FirstAsync(ct);
        await JournaliserAsync(code, "SESSION_FERMEE", id is null ? $"{n} session(s) fermée(s) à distance" : "session fermée à distance", o, par, ct);
        OublierSessions();
    }

    // ---------------------------------------------------------------- rafraîchissement rotatif (D1)

    /// <summary>
    /// Rafraîchissement : le jeton courant de la session est remplacé par un nouveau (usage unique) ; un jeton remplacé
    /// depuis moins de 30 s (requêtes simultanées) reste reçu sans nouvelle rotation ; au-delà, c'est un vol présumé :
    /// la session est fermée et journalisée. Renvoie la session et le nouveau jeton (null : pas de rotation).
    /// </summary>
    public async Task<(SessionLue? Session, string? Nouveau)> RafraichirAsync(string jeton, Origine o, CancellationToken ct)
    {
        var lue = await LireSessionAsync(jeton, ct);
        var empreinte = HachageMotDePasse.Empreinte(jeton);
        if (lue is null)
        {
            var remplace = await db.JetonsRemplaces.AsNoTracking().FirstOrDefaultAsync(j => j.JreEmpreinte == empreinte, ct);
            if (remplace is null) return (null, null);
            var session = await db.Sessions.FirstOrDefaultAsync(s => s.SesId == remplace.JreSesId && s.SesFermeeLe == null, ct);
            if (session is null) return (null, null);
            if (DateTimeOffset.UtcNow - remplace.JreRemplaceLe <= GraceRotation)
            {
                return (await LireSessionParEmpreinteAsync(session.SesJetonHache, ct), null);
            }
            session.SesFermeeLe = DateTimeOffset.UtcNow;
            var code = await db.Comptes.Where(c => c.CptId == session.SesCptId).Select(c => c.CptCode).FirstAsync(ct);
            db.Journal.Add(Entree(code, "VOL_PRESUME", "jeton de rafraîchissement réutilisé : session fermée", o, null));
            await db.SaveChangesAsync(ct);
            OublierSessions();
            return (null, null);
        }
        var (nouveau, nouvelleEmpreinte) = HachageMotDePasse.NouveauJeton();
        var maintenant = DateTimeOffset.UtcNow;
        db.JetonsRemplaces.Add(new JetonRemplace { JreEmpreinte = empreinte, JreSesId = lue.SesId, JreRemplaceLe = maintenant });
        await db.Sessions.Where(s => s.SesId == lue.SesId).ExecuteUpdateAsync(s => s.SetProperty(x => x.SesJetonHache, nouvelleEmpreinte), ct);
        await db.SaveChangesAsync(ct);
        Cache.TryRemove((societe.Connexion, empreinte), out _);
        return (lue, nouveau);
    }

    private Task<SessionLue?> LireSessionParEmpreinteAsync(string empreinte, CancellationToken ct) => LireSessionHacheeAsync(empreinte, ct);

    // ---------------------------------------------------------------- double facteur (D3, D30)

    /// <summary>Double facteur exigé : règle de la société (AUCUN, ADMIN, TOUS) ou choix du compte ; jamais depuis une adresse de confiance ni une machine connue du compte.</summary>
    private async Task<bool> DoubleFacteurRequisAsync(Compte compte, Origine o, CancellationToken ct)
    {
        if (DeConfiance(o) || await MachineDuCompteAsync(compte.CptId, o, ct) is not null) return false;
        var mode = (await ParametreAsync("double_facteur", new ParametresDoubleFacteur(), ct)).Mode;
        return compte.CptDoubleFacteur || mode == "TOUS" || (mode == "ADMIN" && await specialisation.ProfilTotalAsync(services, compte.CptProfil, ct));
    }

    /// <summary>
    /// Code à 6 chiffres envoyé par courriel (10 min, 5 essais, 3 envois par heure) ; null si le compte n'a pas d'adresse
    /// ou si aucun envoi n'est possible : la connexion se fait alors sans double facteur (journalisé, pas de blocage).
    /// </summary>
    private async Task<EtapeConnexion?> EnvoyerCodeAsync(Compte compte, bool rester, Origine o, CancellationToken ct)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var heure = maintenant.AddHours(-1);
        if (await db.Codes.CountAsync(c => c.CcoCptId == compte.CptId && c.CcoCreeLe > heure, ct) >= 3)
        {
            throw new ExceptionMetier(StatusCodes.Status429TooManyRequests, "CODE_TROP_DEMANDE", "Trop de codes demandés : réessayez dans une heure");
        }
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        var expire = maintenant.AddMinutes(10);
        var destination = await specialisation.EnvoyerCodeAsync(services, compte, code, expire, ct);
        if (destination is null)
        {
            await JournaliserAsync(compte.CptCode, "DOUBLE_FACTEUR", "exigé mais impossible (pas d'adresse ou pas de messagerie) : connexion sans code", o, null, ct);
            return null;
        }
        var (etape, empreinte) = HachageMotDePasse.NouveauJeton();
        db.Codes.Add(new CodeConnexion
        {
            CcoCptId = compte.CptId, CcoEtape = empreinte, CcoCode = HachageMotDePasse.Empreinte(code), CcoCreeLe = maintenant, CcoExpireLe = expire,
            CcoRester = rester, CcoAdresse = Tronquer(o.Adresse, 64),
        });
        db.Journal.Add(Entree(compte.CptCode, "DOUBLE_FACTEUR", $"code envoyé à {destination}", o, null));
        return new EtapeConnexion(etape, destination, expire);
    }

    /// <summary>Second temps de la connexion : code juste → session ouverte (machine enregistrée si « Rester connecté »).</summary>
    public async Task<ResultatConnexion> ValiderCodeAsync(SaisieCode s, Origine o, CancellationToken ct)
    {
        var etape = HachageMotDePasse.Empreinte(s.Etape ?? "");
        var maintenant = DateTimeOffset.UtcNow;
        var c = await db.Codes.FirstOrDefaultAsync(x => x.CcoEtape == etape, ct);
        if (c is null || c.CcoUtiliseLe is not null || c.CcoExpireLe <= maintenant || c.CcoEssais >= 5)
        {
            throw ExceptionMetier.Invalide("CODE_EXPIRE", "Code expiré ou trop d'essais : reconnectez-vous pour recevoir un nouveau code");
        }
        var compte = await db.Comptes.FirstAsync(x => x.CptId == c.CcoCptId, ct);
        if (!CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(c.CcoCode),
                System.Text.Encoding.ASCII.GetBytes(HachageMotDePasse.Empreinte((s.Code ?? "").Trim()))))
        {
            c.CcoEssais++;
            db.Journal.Add(Entree(compte.CptCode, "ECHEC", "code du double facteur incorrect", o, null));
            await db.SaveChangesAsync(ct);
            await CompterEchecAsync(o, ct);
            throw ExceptionMetier.Invalide("CODE_INCORRECT", $"Code incorrect ({5 - c.CcoEssais} essai(s) restant(s))");
        }
        c.CcoUtiliseLe = maintenant;
        var etat = ReglesCompte.Etat(compte.AEvaluer(), maintenant);
        await VerifierOuvertureAsync(compte, etat, o, ct);
        compte.CptDerniereConnexion = maintenant;
        return await OuvrirAsync(compte, c.CcoRester, await ParametresAsync(ct), o, "double facteur", ct);
    }

    /// <summary>Choix de l'utilisateur : double facteur à chaque connexion depuis une machine inconnue.</summary>
    public async Task ChoisirDoubleFacteurAsync(long cptId, bool actif, Origine o, CancellationToken ct)
    {
        var compte = await db.Comptes.FirstAsync(c => c.CptId == cptId, ct);
        compte.CptDoubleFacteur = actif;
        db.Journal.Add(Entree(compte.CptCode, "DOUBLE_FACTEUR", actif ? "activé par l'utilisateur" : "désactivé par l'utilisateur", o, compte.CptCode));
        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> DoubleFacteurChoisiAsync(long cptId, CancellationToken ct) =>
        await db.Comptes.Where(c => c.CptId == cptId).Select(c => c.CptDoubleFacteur).FirstOrDefaultAsync(ct);

    // ---------------------------------------------------------------- identifiants d'API (D15)

    /// <summary>
    /// Jetons d'un identifiant d'API : secret vérifié (refus générique, verrouillage et exclusion d'adresse comme une
    /// connexion), adresse permise ; session d'API (un jour au plus) ; jeton d'accès Bearer de 15 minutes.
    /// </summary>
    public async Task<(SessionLue Session, string Rafraichissement)> JetonApiAsync(DemandeJeton d, Origine o, CancellationToken ct)
    {
        var code = ReglesCompte.Normaliser(d.Identifiant);
        await ControlerAdresseAsync(code, o, ct);
        var compte = code.Length == 0 ? null : await db.Comptes.FirstOrDefaultAsync(x => x.CptCode.ToLower() == code && x.CptType == "API", ct);
        var parametres = await ParametresAsync(ct);
        var maintenant = DateTimeOffset.UtcNow;
        var verrouille = compte?.CptVerrouilleJusquAu > maintenant;
        var juste = HachageMotDePasse.Verifier(d.Secret ?? "", compte?.CptHash ?? HashFactice);
        if (compte is null || verrouille || !juste)
        {
            if (compte is not null && !verrouille && ++compte.CptEchecs >= parametres.Verrouillage.Echecs)
            {
                compte.CptVerrouilleJusquAu = maintenant.AddMinutes(parametres.Verrouillage.Minutes);
                compte.CptEchecs = 0;
            }
            await JournaliserAsync(code.Length == 0 ? "?" : code, "ECHEC", "jeton d'API refusé", o, null, ct);
            await CompterEchecAsync(o, ct);
            throw Refus();
        }
        if (!compte.CptActif || compte.CptValideJusquAu < DateOnly.FromDateTime(maintenant.UtcDateTime)
            || (compte.CptAdresses is { Length: > 0 } && !Adresses.DansPlages(o.Adresse, compte.CptAdresses)))
        {
            await JournaliserAsync(compte.CptCode, "REFUS", "identifiant d'API inactif, expiré ou adresse non permise", o, null, ct);
            throw Refus();
        }
        compte.CptEchecs = 0;
        compte.CptDerniereConnexion = maintenant;
        var r = await OuvrirAsync(compte, false, parametres, o, "", ct, api: true);
        return (r.Session!, r.Jeton!);
    }

    public async Task<CompteEtMotDePasse> CreerApiAsync(CompteApiSaisi s, Utilisateur u, Origine o, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("COMPTES");
        var code = ReglesCompte.Normaliser(s.Code);
        var erreurs = ReglesCompte.ControlerPseudo(code, (await ParametresAsync(ct)).PseudosReserves);
        if (erreurs.Count > 0) throw ErreursRegles(erreurs);
        if (await db.Comptes.AnyAsync(c => c.CptCode.ToLower() == code, ct)) throw ExceptionMetier.Conflit("PSEUDO_PRIS", $"Identifiant « {code} » déjà utilisé");
        var profils = await specialisation.ProfilsAsync(services, ct);
        if (!profils.Any(p => p.Code == s.Profil)) throw ExceptionMetier.Invalide("PROFIL_INCONNU", "Profil inconnu");
        if (await specialisation.ProfilTotalAsync(services, s.Profil!, ct)) throw ExceptionMetier.Invalide("PROFIL_INTERDIT", "Un identifiant d'API n'a jamais tous les droits");
        var adresses = (s.Adresses ?? []).Select(a => a.Trim()).Where(a => a.Length > 0).ToArray();
        if (Adresses.PlagesInvalides(adresses) is { Count: > 0 } mauvaises) throw ExceptionMetier.Invalide("ADRESSE_INVALIDE", $"Adresse illisible : {string.Join(", ", mauvaises)}");
        var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var compte = new Compte
        {
            CptCode = code, CptType = "API", CptLibelle = Tronquer(s.Libelle?.Trim(), 120), CptProfil = s.Profil!, CptHash = HachageMotDePasse.Hacher(secret),
            CptAdresses = adresses.Length > 0 ? adresses : null, CptCreePar = u.Code, CptMajPar = u.Code,
        };
        db.Comptes.Add(compte);
        db.Journal.Add(Entree(code, "COMPTE", "identifiant d'API créé", o, u.Code));
        await db.SaveChangesAsync(ct);
        return new CompteEtMotDePasse(await new ServiceComptes(db, specialisation, this, services).DetailCompteAsync(compte.CptId, ct), secret);
    }

    /// <summary>Nouveau secret d'un identifiant d'API (affiché une fois) : les sessions en cours sont fermées.</summary>
    public async Task<CompteEtMotDePasse> NouveauSecretAsync(long id, Utilisateur u, Origine o, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("COMPTES");
        var compte = await db.Comptes.FirstOrDefaultAsync(c => c.CptId == id && c.CptType == "API", ct) ?? throw ExceptionMetier.Introuvable("Identifiant d'API");
        var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        compte.CptHash = HachageMotDePasse.Hacher(secret);
        compte.CptMajPar = u.Code;
        compte.CptMajLe = DateTimeOffset.UtcNow;
        db.Journal.Add(Entree(compte.CptCode, "COMPTE", "nouveau secret d'API", o, u.Code));
        await db.SaveChangesAsync(ct);
        await db.Sessions.Where(s => s.SesCptId == id && s.SesFermeeLe == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.SesFermeeLe, DateTimeOffset.UtcNow), ct);
        OublierSessions();
        return new CompteEtMotDePasse(await new ServiceComptes(db, specialisation, this, services).DetailCompteAsync(id, ct), secret);
    }

    public async Task ModifierAdressesApiAsync(long id, List<string>? adresses, Utilisateur u, Origine o, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("COMPTES");
        var compte = await db.Comptes.FirstOrDefaultAsync(c => c.CptId == id && c.CptType == "API", ct) ?? throw ExceptionMetier.Introuvable("Identifiant d'API");
        var a = (adresses ?? []).Select(x => x.Trim()).Where(x => x.Length > 0).ToArray();
        if (Adresses.PlagesInvalides(a) is { Count: > 0 } mauvaises) throw ExceptionMetier.Invalide("ADRESSE_INVALIDE", $"Adresse illisible : {string.Join(", ", mauvaises)}");
        compte.CptAdresses = a.Length > 0 ? a : null;
        db.Journal.Add(Entree(compte.CptCode, "COMPTE", $"adresses permises : {(a.Length > 0 ? string.Join(", ", a) : "toutes")}", o, u.Code));
        await db.SaveChangesAsync(ct);
    }
}

public sealed record ChoixDoubleFacteur(bool Actif);
