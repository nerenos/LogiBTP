using System.Collections.Concurrent;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Authentification.Web;

/// <summary>Jeton délégué ouvert (en cache court par base) : jeton, session de l'agent (compte, délégation, client), échéance.</summary>
public sealed record JetonDelegueOuvert(long JdeId, SessionLue Session, string Delegation, string Client, DateTimeOffset ExpireLe);

/// <summary>
/// Jetons délégués aux agents IA (plan MCP, lot 4) : émission (secret rendu une fois, empreinte seule en base), ouverture
/// par l'en-tête Bearer (compte contrôlé à chaque lecture en base, cache de 30 s vidé à toute révocation et à toute
/// modification de compte), révocation d'un jeton, d'une délégation ou de tout le compte.
/// </summary>
public sealed partial class ServiceAuthentification
{
    private static readonly ConcurrentDictionary<(string Base, string Empreinte), (DateTimeOffset Lu, JetonDelegueOuvert Jeton)> CacheJetons = new();

    /// <summary>Émet un jeton délégué pour un compte de personne utilisable ; échéance bornée (<see cref="ReglesJetonsDelegues.JoursMax"/> jours).</summary>
    public async Task<string> EmettreJetonDelegueAsync(string compte, string delegation, string client, DateTime? expiration, CancellationToken ct)
    {
        var code = ReglesCompte.Normaliser(compte);
        delegation = delegation?.Trim() ?? "";
        client = client?.Trim() ?? "";
        if (delegation.Length is 0 or > 64) throw ExceptionMetier.Invalide("DELEGATION_INVALIDE", "Délégation absente ou trop longue (64 caractères au plus)");
        if (client.Length == 0) throw ExceptionMetier.Invalide("CLIENT_INVALIDE", "Client de l'agent absent");
        var maintenant = DateTimeOffset.UtcNow;
        var echeance = ReglesJetonsDelegues.Echeance(expiration, maintenant) ?? throw ExceptionMetier.Invalide("ECHEANCE_PASSEE", "Échéance du jeton déjà passée");
        var c = code.Length == 0 ? null : await db.Comptes.AsNoTracking().FirstOrDefaultAsync(x => x.CptCode.ToLower() == code, ct);
        if (c is null || ReglesJetonsDelegues.Refus(null, echeance, c.AEvaluer(), maintenant) is not null || !await PersonneAutoriseeAsync(c, ct))
        {
            throw ExceptionMetier.Invalide("COMPTE_INACTIF", "Compte introuvable ou inutilisable : aucun jeton délégué ne peut être émis");
        }
        var (secret, empreinte) = ReglesJetonsDelegues.Nouveau();
        db.JetonsDelegues.Add(new JetonDelegueEntite
        {
            JdeCptId = c.CptId, JdeDelegation = delegation, JdeEmpreinte = empreinte, JdeClient = Tronquer(client, 120)!, JdeCreeLe = maintenant, JdeExpireLe = echeance,
        });
        db.Journal.Add(Entree(c.CptCode, "JETON_DELEGUE", $"émis : délégation {delegation}, client {client}, échéance {echeance:dd/MM/yyyy HH:mm}", new Origine(null, null), c.CptCode));
        await db.SaveChangesAsync(ct);
        return secret;
    }

    private async Task<bool> PersonneAutoriseeAsync(Compte c, CancellationToken ct) =>
        c.CptTypeElement is null || c.CptIdElement is null || (await specialisation.PersonneAsync(db, c.CptTypeElement, c.CptIdElement, ct)) is { Autorisee: true };

    /// <summary>
    /// Ouvre un secret : jeton connu, non révoqué, non échu, compte de personne actif (ni désactivé, ni expiré, ni à mot de
    /// passe provisoire) et personne autorisée. Rend le jeton ouvert ou le motif du refus (<see cref="ReglesJetonsDelegues"/>,
    /// ou l'état du compte) ; dernier usage noté au plus une fois par minute.
    /// </summary>
    public async Task<(JetonDelegueOuvert? Jeton, string? Refus, string? Compte)> OuvrirJetonDelegueAsync(string secret, Origine? o, CancellationToken ct)
    {
        if (!ReglesJetonsDelegues.EstJetonDelegue(secret)) return (null, ReglesJetonsDelegues.Inconnu, null);
        var empreinte = HachageMotDePasse.Empreinte(secret);
        var cle = (societe.Connexion, empreinte);
        var maintenant = DateTimeOffset.UtcNow;
        if (CacheJetons.TryGetValue(cle, out var c) && maintenant - c.Lu < DureeCache && c.Jeton.ExpireLe > maintenant) return (c.Jeton, null, c.Jeton.Session.Code);
        CacheJetons.TryRemove(cle, out _);
        var jeton = await db.JetonsDelegues.FirstOrDefaultAsync(x => x.JdeEmpreinte == empreinte, ct);
        if (jeton is null) return (null, ReglesJetonsDelegues.Inconnu, null);
        var compte = await db.Comptes.AsNoTracking().FirstAsync(x => x.CptId == jeton.JdeCptId, ct);
        var refus = ReglesJetonsDelegues.Refus(jeton.JdeRevoqueLe, jeton.JdeExpireLe, compte.AEvaluer(), maintenant);
        if (refus is null && !await PersonneAutoriseeAsync(compte, ct)) refus = "PERSONNE_NON_AUTORISEE";
        if (refus is not null) return (null, refus, compte.CptCode);
        if (jeton.JdeUtiliseLe is null || maintenant - jeton.JdeUtiliseLe > TimeSpan.FromMinutes(1))
        {
            jeton.JdeUtiliseLe = maintenant;
            if (o?.Adresse is not null) jeton.JdeAdresse = Tronquer(o.Adresse, 64);
            await db.SaveChangesAsync(ct);
        }
        var session = new SessionLue(0, compte.CptId, compte.CptCode, compte.CptLibelle, compte.CptProfil, false, compte.CptTypeElement, compte.CptIdElement,
            jeton.JdeExpireLe, false, maintenant, Agent: new AgentRequete(jeton.JdeDelegation, jeton.JdeClient));
        var ouvert = new JetonDelegueOuvert(jeton.JdeId, session, jeton.JdeDelegation, jeton.JdeClient, jeton.JdeExpireLe);
        CacheJetons[cle] = (maintenant, ouvert);
        return (ouvert, null, compte.CptCode);
    }

    /// <summary>
    /// Session d'un agent pour l'intergiciel (en-tête Bearer d'un jeton délégué) : adresse exclue, jeton inconnu (échec
    /// compté pour l'exclusion d'adresse, comme un identifiant d'API), révoqué, échu ou compte inutilisable (refus
    /// journalisé) ⇒ null. Jamais d'usurpation : la session porte le compte lui-même et l'agent.
    /// </summary>
    public async Task<SessionLue?> SessionDelegueeAsync(string secret, Origine o, CancellationToken ct)
    {
        try
        {
            await ControlerAdresseAsync("?", o, ct);
        }
        catch (ExceptionMetier)
        {
            return null;
        }
        var (jeton, refus, compte) = await OuvrirJetonDelegueAsync(secret, o, ct);
        if (jeton is not null) return jeton.Session;
        if (refus == ReglesJetonsDelegues.Inconnu)
        {
            await JournaliserAsync("?", "ECHEC", "jeton délégué inconnu", o, null, ct);
            await CompterEchecAsync(o, ct);
        }
        else
        {
            await JournaliserAsync(compte ?? "?", "REFUS", $"jeton délégué refusé : {refus}", o, null, ct);
        }
        return null;
    }

    /// <summary>Révoque un jeton par son secret ; faux si inconnu ou déjà révoqué.</summary>
    public async Task<bool> RevoquerJetonDelegueAsync(string secret, CancellationToken ct)
    {
        if (!ReglesJetonsDelegues.EstJetonDelegue(secret)) return false;
        var empreinte = HachageMotDePasse.Empreinte(secret);
        var jeton = await db.JetonsDelegues.FirstOrDefaultAsync(x => x.JdeEmpreinte == empreinte && x.JdeRevoqueLe == null, ct);
        if (jeton is null) return false;
        jeton.JdeRevoqueLe = DateTimeOffset.UtcNow;
        var code = await db.Comptes.Where(c => c.CptId == jeton.JdeCptId).Select(c => c.CptCode).FirstAsync(ct);
        db.Journal.Add(Entree(code, "JETON_DELEGUE", $"révoqué : délégation {jeton.JdeDelegation}, client {jeton.JdeClient}", new Origine(null, null), null));
        await db.SaveChangesAsync(ct);
        OublierJetonsDelegues();
        return true;
    }

    /// <summary>Révoque tous les jetons d'une délégation (délégation révoquée ou modifiée par le module MCP) ; rend le nombre révoqué.</summary>
    public async Task<int> RevoquerDelegationAsync(string delegation, CancellationToken ct)
    {
        var n = await db.JetonsDelegues.Where(x => x.JdeDelegation == delegation && x.JdeRevoqueLe == null)
            .ExecuteUpdateAsync(x => x.SetProperty(y => y.JdeRevoqueLe, DateTimeOffset.UtcNow), ct);
        OublierJetonsDelegues();
        return n;
    }

    /// <summary>Révoque tous les jetons délégués du compte (par son code) ; journalisé ; rend le nombre révoqué.</summary>
    public async Task<int> RevoquerJetonsDuCompteAsync(string compte, CancellationToken ct)
    {
        var code = ReglesCompte.Normaliser(compte);
        var c = await db.Comptes.AsNoTracking().FirstOrDefaultAsync(x => x.CptCode.ToLower() == code, ct);
        if (c is null) return 0;
        var n = await RevoquerJetonsAsync(db, c.CptId, ct);
        if (n > 0) await JournaliserAsync(c.CptCode, "JETON_DELEGUE", $"{n} jeton(s) délégué(s) révoqué(s)", new Origine(null, null), null, ct);
        return n;
    }

    /// <summary>Révoque les jetons délégués d'un compte (désactivation, sessions fermées, mot de passe réinitialisé) et vide le cache.</summary>
    internal static async Task<int> RevoquerJetonsAsync(AuthDbContext db, long cptId, CancellationToken ct)
    {
        var n = await db.JetonsDelegues.Where(x => x.JdeCptId == cptId && x.JdeRevoqueLe == null)
            .ExecuteUpdateAsync(x => x.SetProperty(y => y.JdeRevoqueLe, DateTimeOffset.UtcNow), ct);
        OublierJetonsDelegues();
        return n;
    }

    /// <summary>Cache des jetons délégués ouverts vidé : relus en base au prochain appel.</summary>
    public static void OublierJetonsDelegues() => CacheJetons.Clear();
}

/// <summary>Contrat du socle <see cref="IJetonsDelegues"/> (utilisé par le module MCP), porté par <see cref="ServiceAuthentification"/>.</summary>
public sealed class ServiceJetonsDelegues(ServiceAuthentification auth) : IJetonsDelegues
{
    public Task<string> EmettreAsync(string compte, string delegation, string client, DateTime? expiration, CancellationToken ct) =>
        auth.EmettreJetonDelegueAsync(compte, delegation, client, expiration, ct);

    public Task<bool> RevoquerAsync(string secret, CancellationToken ct) => auth.RevoquerJetonDelegueAsync(secret, ct);

    public Task<int> RevoquerPourCompteAsync(string compte, CancellationToken ct) => auth.RevoquerJetonsDuCompteAsync(compte, ct);

    public async Task<JetonDelegue?> OuvrirAsync(string secret, CancellationToken ct) =>
        (await auth.OuvrirJetonDelegueAsync(secret, null, ct)).Jeton is { } j ? new JetonDelegue(j.Session.Code, j.Delegation, j.Client) : null;
}
