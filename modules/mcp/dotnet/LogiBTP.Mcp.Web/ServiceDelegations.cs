using System.Security.Cryptography;
using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Mcp.Web;

/// <summary>Délégation saisie : libellé, modèle, échéance en jours, garde-fous levés, nœuds sur mesure, portée maximale, client.</summary>
public sealed record DelegationDemandee(string? Libelle, string? Modele, int? Jours = null, IReadOnlyList<string>? Leves = null,
    IReadOnlyDictionary<string, IReadOnlyList<string>>? Noeuds = null, string? Portee = null, string? Client = null);

/// <summary>Délégation décrite (jamais le secret) ; <c>Active</c> : ni révoquée, ni échue.</summary>
public sealed record DelegationDecrite(string Code, string Compte, string Libelle, string Modele, IReadOnlyDictionary<string, IReadOnlyList<string>>? Noeuds,
    string? Portee, IReadOnlyList<string> Leves, string Client, DateOnly Echeance, DateTimeOffset CreeLe, DateTimeOffset? PremierUsage,
    DateTimeOffset? RevoqueeLe, string? RevoqueePar, bool Active);

/// <summary>Délégation créée : sa description et le secret du jeton délégué, rendu une seule fois.</summary>
public sealed record DelegationCreee(DelegationDecrite Delegation, string Secret);

/// <summary>Levées d'un profil saisies par l'administrateur.</summary>
public sealed record LeveeSaisie(IReadOnlyList<string>? Levables = null, IReadOnlyList<string>? Modeles = null, int? JoursMax = null,
    int? QuotaAppel = null, int? QuotaJour = null, int? Alerte = null);

/// <summary>Levées décrites d'un profil.</summary>
public sealed record LeveeDecrite(string Profil, IReadOnlyList<string> Levables, IReadOnlyList<string>? Modeles, int? JoursMax,
    int? QuotaAppel, int? QuotaJour, int? Alerte, DateTimeOffset ModifieLe, string ModifiePar);

/// <summary>Paramètres du module : garde-fous, modèles, valeurs par défaut et levées par profil.</summary>
public sealed record ParametresMcp(IReadOnlyList<string> GardesFous, IReadOnlyList<string> Modeles, int EcheanceDefaut, int EcheanceMax,
    int QuotaAppel, int QuotaJour, int AlerteQuota, IReadOnlyList<LeveeDecrite> Profils);

/// <summary>Appel du journal des agents décrit (proposition et humain qui en a décidé : lot 10).</summary>
public sealed record AppelDecrit(long Id, DateTimeOffset Date, string Delegation, string Compte, string Client, string? Session, string Outil,
    string Classe, JsonElement? Parametres, JsonElement? Routes, JsonElement? Lus, int NbLus, JsonElement? Ecrits, JsonElement? GardesFous,
    string Statut, int DureeMs, string? Erreur, long? Proposition = null, string? Humain = null);

/// <summary>
/// Gestion des délégations, des levées par profil et lecture du journal (routes /api/mcp). Jamais pour un agent (interdit
/// absolu : un agent ne s'accorde rien) ni pendant une usurpation ; levées réservées à l'administrateur.
/// </summary>
public sealed class ServiceDelegations(McpDbContext db, IJetonsDelegues jetons, IServiceProvider services)
{
    private static readonly string[] Modeles = [ModelePlafond.Lecture, ModelePlafond.Preparation, ModelePlafond.CommeMoi, ModelePlafond.SurMesure];
    private static readonly string[] Portees = [PorteesDroits.Soi, PorteesDroits.Equipe, PorteesDroits.Service, PorteesDroits.Tout];

    /// <summary>Refus d'un agent (403 AGENT_INTERDIT) et d'une usurpation (403 MCP_USURPATION).</summary>
    public static void ExigerHumain(Utilisateur u)
    {
        if (u.Agent is not null) throw ExceptionMetier.AgentInterdit("gestion des agents");
        if (u.Usurpateur is not null) throw new ExceptionMetier(StatusCodes.Status403Forbidden, ErreurMcp.McpUsurpation, "Délégations interdites pendant une usurpation");
    }

    private static DelegationDecrite Decrire(DelegationMcp d) => new(d.MdeCode, d.MdeCompte, d.MdeLibelle, d.MdeModele,
        d.MdeNoeuds is null ? null : LecturesMcp.Noeuds(d.MdeNoeuds), d.MdePortee, LecturesMcp.Liste(d.MdeLeves), d.MdeClient, d.MdeEcheance,
        d.MdeCreeLe, d.MdePremierUsage, d.MdeRevoqueeLe, d.MdeRevoqueePar, d.Active(LecturesMcp.Aujourdhui));

    /// <summary>Profil total du délégant (module Droits s'il est branché, sinon profil ADMIN).</summary>
    private async Task<bool> TotalAsync(Utilisateur u, CancellationToken ct) =>
        services.GetService(typeof(IDroits)) is IDroits droits
            ? (await droits.ProfilsAsync(ct)).Any(p => p.Code == u.Profil && p.Total)
            : u.Profil == Profils.Admin;

    /// <summary>Mes délégations (toutes pour l'administrateur avec <paramref name="toutes"/>), les plus récentes d'abord.</summary>
    public async Task<IReadOnlyList<DelegationDecrite>> ListerAsync(Utilisateur u, bool toutes, CancellationToken ct)
    {
        ExigerHumain(u);
        var q = db.Delegations.AsNoTracking();
        if (!(toutes && u.EstAdmin)) q = q.Where(d => d.MdeCompte == u.Code);
        return (await q.OrderByDescending(d => d.MdeId).ToListAsync(ct)).Select(Decrire).ToList();
    }

    /// <summary>
    /// Crée une délégation contrôlée par ReglesDelegation (modèle permis, profil total jamais « comme moi », échéance,
    /// garde-fous levables), puis émet son jeton délégué (secret rendu une fois). 422 avec le premier code d'ERREUR_MCP.
    /// </summary>
    public async Task<DelegationCreee> CreerAsync(DelegationDemandee saisie, Utilisateur u, CancellationToken ct)
    {
        ExigerHumain(u);
        var levees = await LecturesMcp.LeveesAsync(db, u.Profil, ct);
        var leves = (saisie.Leves ?? []).Distinct().ToList();
        var erreurs = ReglesDelegation.ControlerDelegation(new DelegationSaisie(saisie.Modele, saisie.Jours, leves),
            new Delegant(await TotalAsync(u, ct), levees.Levables, levees.Modeles, levees.JoursMax)).ToList();
        if (saisie.Portee is not null && !Portees.Contains(saisie.Portee)) erreurs.Add(ErreurMcp.McpParametreInvalide);
        if (saisie.Modele == ModelePlafond.SurMesure && (saisie.Noeuds is null || saisie.Noeuds.Count == 0)) erreurs.Add(ErreurMcp.McpParametreInvalide);
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0], "Délégation refusée", erreurs);

        var aujourdhui = LecturesMcp.Aujourdhui;
        var d = new DelegationMcp
        {
            MdeCode = "D" + Convert.ToHexString(RandomNumberGenerator.GetBytes(10)),
            MdeCompte = u.Code,
            MdeLibelle = (saisie.Libelle ?? "").Trim() is { Length: > 0 } l ? l[..Math.Min(l.Length, 200)] : saisie.Modele!,
            MdeModele = saisie.Modele!,
            MdeNoeuds = saisie.Modele == ModelePlafond.SurMesure
                ? JsonSerializer.Serialize(saisie.Noeuds!.ToDictionary(kv => kv.Key, kv => kv.Value.Select(ReglesDelegation.NormaliserAction).Distinct().ToList()))
                : null,
            MdePortee = saisie.Portee,
            MdeLeves = JsonSerializer.Serialize(leves),
            MdeClient = (saisie.Client ?? "").Trim() is { Length: > 0 } c ? c[..Math.Min(c.Length, 100)] : "",
            MdeEcheance = ReglesDelegation.EcheanceDelegation(aujourdhui, saisie.Jours, levees.JoursMax),
            MdeCreeLe = DateTimeOffset.UtcNow,
        };
        var secret = await db.Unite().ExecuterAsync(async jeton =>
        {
            db.Delegations.Add(d);
            await db.SaveChangesAsync(jeton);
            return await jetons.EmettreAsync(u.Code, d.MdeCode, d.MdeClient, d.MdeEcheance.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc), jeton);
        }, ct);
        return new DelegationCreee(Decrire(d), secret);
    }

    /// <summary>Révoque une délégation (la sienne, ou toute délégation pour l'administrateur) et tous ses jetons ; cache du plafond vidé.</summary>
    public async Task RevoquerAsync(string code, Utilisateur u, CancellationToken ct)
    {
        ExigerHumain(u);
        var d = await db.Delegations.FirstOrDefaultAsync(x => x.MdeCode == code, ct);
        if (d is null || (d.MdeCompte != u.Code && !u.EstAdmin)) throw ExceptionMetier.Introuvable("Délégation");
        await db.Unite().ExecuterAsync(async jeton =>
        {
            if (d.MdeRevoqueeLe is null)
            {
                d.MdeRevoqueeLe = DateTimeOffset.UtcNow;
                d.MdeRevoqueePar = u.Code;
                await db.SaveChangesAsync(jeton);
            }
            await jetons.RevoquerDelegationAsync(d.MdeCode, jeton);
            // Propositions encore en attente de l'agent révoqué : annulées (lot 10), jamais acceptées après coup.
            var maintenant = DateTimeOffset.UtcNow;
            await db.Propositions.Where(p => p.MprDelegation == d.MdeCode && p.MprEtat == EtatProposition.EnAttente)
                .ExecuteUpdateAsync(x => x.SetProperty(p => p.MprEtat, EtatProposition.Annulee).SetProperty(p => p.MprTraiteeLe, maintenant)
                    .SetProperty(p => p.MprTraiteePar, u.Code).SetProperty(p => p.MprMotif, "Délégation révoquée"), jeton);
        }, ct);
        PlafondMcp.Oublier(d.MdeCode);
    }

    /// <summary>Paramètres du module et levées par profil (administrateur).</summary>
    public async Task<ParametresMcp> ParametresAsync(Utilisateur u, CancellationToken ct)
    {
        ExigerHumain(u);
        u.ExigerAdmin();
        var profils = await db.Levees.AsNoTracking().OrderBy(l => l.MlpProfil).ToListAsync(ct);
        return new ParametresMcp(ReglesDelegation.GardesFous, Modeles, ReglesDelegation.EcheanceDefaut, ReglesDelegation.EcheanceMax,
            ReglesDelegation.QuotaAppel, ReglesDelegation.QuotaJour, ReglesDelegation.AlerteQuota, profils.Select(DecrireLevee).ToList());
    }

    private static LeveeDecrite DecrireLevee(LeveeProfilMcp l) => new(l.MlpProfil, LecturesMcp.Liste(l.MlpLevables),
        l.MlpModeles is null ? null : LecturesMcp.Liste(l.MlpModeles), l.MlpJoursMax, l.MlpQuotaAppel, l.MlpQuotaJour, l.MlpAlerte, l.MlpModifieLe, l.MlpModifiePar);

    /// <summary>Contrôle des levées saisies : codes connus, échéance 1..90, quotas positifs, alerte 1..100.</summary>
    public static IReadOnlyList<string> ControlerLevee(LeveeSaisie s)
    {
        var invalide = (s.Levables ?? []).Any(g => !ReglesDelegation.GardesFous.Contains(g))
            || (s.Modeles ?? []).Any(m => !Modeles.Contains(m))
            || s.JoursMax is < 1 or > ReglesDelegation.EcheanceMax
            || s.QuotaAppel is < 1 || s.QuotaJour is < 1 || s.Alerte is < 1 or > 100;
        return invalide ? [ErreurMcp.McpParametreInvalide] : [];
    }

    /// <summary>Remplace les levées d'un profil (administrateur) ; cache des plafonds vidé.</summary>
    public async Task<LeveeDecrite> EnregistrerLeveeAsync(string profil, LeveeSaisie s, Utilisateur u, CancellationToken ct)
    {
        ExigerHumain(u);
        u.ExigerAdmin();
        if (string.IsNullOrWhiteSpace(profil) || profil.Length > 30 || ControlerLevee(s) is { Count: > 0 } e)
            throw ExceptionMetier.Invalide(ErreurMcp.McpParametreInvalide, "Levées invalides");
        var l = await db.Levees.FirstOrDefaultAsync(x => x.MlpProfil == profil, ct);
        if (l is null) db.Levees.Add(l = new LeveeProfilMcp { MlpProfil = profil });
        l.MlpLevables = JsonSerializer.Serialize((s.Levables ?? []).Distinct().ToList());
        l.MlpModeles = s.Modeles is null ? null : JsonSerializer.Serialize(s.Modeles.Distinct().ToList());
        l.MlpJoursMax = s.JoursMax;
        l.MlpQuotaAppel = s.QuotaAppel;
        l.MlpQuotaJour = s.QuotaJour;
        l.MlpAlerte = s.Alerte;
        l.MlpModifieLe = DateTimeOffset.UtcNow;
        l.MlpModifiePar = u.Code;
        await db.SaveChangesAsync(ct);
        PlafondMcp.Oublier();
        return DecrireLevee(l);
    }

    /// <summary>Journal des agents : le mien ; tout pour l'administrateur avec <paramref name="tous"/>. Filtres : délégation, période ; 200 lignes au plus par défaut.</summary>
    public async Task<IReadOnlyList<AppelDecrit>> JournalAsync(Utilisateur u, bool tous, string? delegation, DateOnly? du, DateOnly? au, int? limite, CancellationToken ct)
    {
        ExigerHumain(u);
        var q = db.Journal.AsNoTracking();
        if (!(tous && u.EstAdmin)) q = q.Where(j => j.AjoCompte == u.Code);
        if (!string.IsNullOrEmpty(delegation)) q = q.Where(j => j.AjoDelegation == delegation);
        if (du is { } d1) { var t = new DateTimeOffset(d1.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero); q = q.Where(j => j.AjoDate >= t); }
        if (au is { } d2) { var t = new DateTimeOffset(d2.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero); q = q.Where(j => j.AjoDate < t); }
        var lignes = await q.OrderByDescending(j => j.AjoId).Take(Math.Clamp(limite ?? 200, 1, 1000)).ToListAsync(ct);
        static JsonElement? J(string? s) => s is null ? null : JsonDocument.Parse(s).RootElement.Clone();
        return lignes.Select(j => new AppelDecrit(j.AjoId, j.AjoDate, j.AjoDelegation, j.AjoCompte, j.AjoClient, j.AjoSession, j.AjoOutil, j.AjoClasse,
            J(j.AjoParametres), J(j.AjoRoutes), J(j.AjoLus), j.AjoNbLus, J(j.AjoEcrits), J(j.AjoGardesFous), j.AjoStatut, j.AjoDureeMs, j.AjoErreur,
            j.AjoProposition, j.AjoHumain)).ToList();
    }
}
