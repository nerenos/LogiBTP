using System.Collections.Concurrent;
using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Mcp.Web;

/// <summary>Levées d'un profil lues en base (défauts sans ligne) : garde-fous levables, modèles permis, échéance maximale, quotas.</summary>
public sealed record LeveesProfil(IReadOnlyList<string> Levables, IReadOnlyList<string>? Modeles, int? JoursMax, QuotasDelegation Quotas)
{
    public static readonly LeveesProfil Defaut = new([], null, null, new QuotasDelegation());
}

/// <summary>Lectures communes du module (JSON des colonnes, délégation active, levées d'un profil).</summary>
public static class LecturesMcp
{
    public static IReadOnlyList<string> Liste(string? json) =>
        string.IsNullOrWhiteSpace(json) ? [] : JsonSerializer.Deserialize<List<string>>(json) ?? [];

    public static IReadOnlyDictionary<string, IReadOnlyList<string>> Noeuds(string? json) =>
        string.IsNullOrWhiteSpace(json) ? new Dictionary<string, IReadOnlyList<string>>()
            : (JsonSerializer.Deserialize<Dictionary<string, List<string>>>(json) ?? []).ToDictionary(kv => kv.Key, kv => (IReadOnlyList<string>)(kv.Value ?? []));

    public static DateOnly Aujourdhui => DateOnly.FromDateTime(DateTime.UtcNow);

    public static async Task<LeveesProfil> LeveesAsync(McpDbContext db, string profil, CancellationToken ct)
    {
        var l = await db.Levees.AsNoTracking().FirstOrDefaultAsync(x => x.MlpProfil == profil, ct);
        return l is null ? LeveesProfil.Defaut
            : new(Liste(l.MlpLevables), l.MlpModeles is null ? null : Liste(l.MlpModeles), l.MlpJoursMax, new QuotasDelegation(l.MlpQuotaAppel, l.MlpQuotaJour, l.MlpAlerte));
    }

    /// <summary>Délégation active (ni révoquée, ni échue) par son code (null sinon).</summary>
    public static async Task<DelegationMcp?> ActiveAsync(McpDbContext db, string code, CancellationToken ct)
    {
        var d = await db.Delegations.AsNoTracking().FirstOrDefaultAsync(x => x.MdeCode == code, ct);
        return d is not null && d.Active(Aujourdhui) ? d : null;
    }

    /// <summary>Plafond de la délégation selon ReglesDelegation (modèle, nœuds sur mesure, portée, garde-fous actifs).</summary>
    public static PlafondDelegation Plafond(DelegationMcp d) =>
        new(d.MdeModele, d.MdeModele == ModelePlafond.SurMesure ? Noeuds(d.MdeNoeuds) : null, d.MdePortee);

    /// <summary>Interdits de la délégation : ceux de la spécialisation, son propre nœud de gestion, nœuds retenus par les garde-fous actifs.</summary>
    public static IReadOnlyList<string> Interdits(SpecialisationMcp s, IEnumerable<string> actifs) =>
        s.Interdits.Append(s.Noeud).Concat(actifs.SelectMany(g => s.NoeudsRetenus.TryGetValue(g, out var n) ? n : [])).Distinct().ToList();
}

/// <summary>
/// Plafond des délégations (contrat <see cref="IPlafondAgent"/> du socle, lu par le module Droits) : modèle et nœuds sur
/// mesure de la délégation, portée maximale, garde-fous actifs (double accord : levable pour le profil et levé par la
/// délégation), liste blanche = routes d'écriture des outils du catalogue (jamais /api/mcp, /api/auth, /api/droits),
/// interdits (spécialisation, nœud de gestion du module, nœuds retenus). Cache court par base, vidé à toute révocation
/// et à toute modification des levées.
/// </summary>
public sealed class PlafondMcp(McpDbContext db, SpecialisationMcp specialisation, SocieteCourante societe, IHttpContextAccessor? acces = null) : IPlafondAgent
{
    private static readonly TimeSpan Duree = TimeSpan.FromSeconds(30);
    private static readonly ConcurrentDictionary<string, (DateTime Lu, PlafondAgent? Plafond)> Cache = new();
    private static readonly string[] Reservees = ["/api/mcp", "/api/auth", "/api/droits"];

    /// <summary>Vide le cache d'une délégation (toutes bases, tous profils), ou tout le cache (null).</summary>
    public static void Oublier(string? delegation = null)
    {
        foreach (var cle in Cache.Keys.Where(k => delegation is null || k.Split('|')[1] == delegation).ToList()) Cache.TryRemove(cle, out _);
    }

    /// <summary>Profil sans précision : celui de l'utilisateur de la requête s'il agit pour cette délégation, sinon aucun levable.</summary>
    public Task<PlafondAgent?> PlafondAsync(string delegation, CancellationToken ct)
    {
        var u = acces?.HttpContext is { } http ? Utilisateur.Depuis(http) : null;
        return PlafondAsync(delegation, u?.Agent?.Delegation == delegation ? u.Profil : "", ct);
    }

    public async Task<PlafondAgent?> PlafondAsync(string delegation, string profil, CancellationToken ct)
    {
        var cle = $"{societe.Base}|{delegation}|{profil}";
        if (Cache.TryGetValue(cle, out var c) && DateTime.UtcNow - c.Lu < Duree) return c.Plafond;
        var p = await LirePlafondAsync(delegation, profil, ct);
        Cache[cle] = (DateTime.UtcNow, p);
        return p;
    }

    private async Task<PlafondAgent?> LirePlafondAsync(string delegation, string profil, CancellationToken ct)
    {
        var d = await LecturesMcp.ActiveAsync(db, delegation, ct);
        if (d is null) return null;
        var levees = string.IsNullOrEmpty(profil) ? LeveesProfil.Defaut : await LecturesMcp.LeveesAsync(db, profil, ct);
        var actifs = ReglesDelegation.GardesFousActifs(levees.Levables, LecturesMcp.Liste(d.MdeLeves));
        var routes = specialisation.Outils
            .Where(o => !HttpMethods.IsGet(o.Methode) && !HttpMethods.IsHead(o.Methode) && o.Classe != ClasseOutil.Interdit)
            .Where(o => !Reservees.Any(r => o.Route == r || o.Route.StartsWith(r + "/", StringComparison.OrdinalIgnoreCase)))
            .Select(o => new RouteAgent(o.Methode.ToUpperInvariant(), o.Route)).Distinct().ToList();
        return new PlafondAgent(d.MdeCode, d.MdeModele, LecturesMcp.Plafond(d).Actions ?? new Dictionary<string, IReadOnlyList<string>>(),
            d.MdePortee ?? PorteesDroits.Tout, actifs, routes, LecturesMcp.Interdits(specialisation, actifs));
    }
}
