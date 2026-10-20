using System.Collections.Concurrent;
using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Activation d'un module (administrateur).</summary>
public sealed record ActivationModule(bool Actif);

/// <summary>Service saisi : code, libellé, parent (sous-service), nature, responsable, ordre, actif.</summary>
public sealed record ServiceSaisi(int? Id, string Code, string Libelle, string? ParentCode, string Nature, long? ResponsableId, int Ordre, bool Actif);

/// <summary>Membre d'un service : individu de notre société, service principal ou non.</summary>
public sealed record MembreService(long IndId, bool Principal);

/// <summary>
/// Modules activés par société (db/193 : module_societe, drapeau par base ; cache court par base) : implémente
/// <see cref="IModulesActifs"/> pour les routes des modules facultatifs (ExigeModule).
/// </summary>
public sealed class ModulesSociete(SocieteCourante societe, LogiBtpContext db) : IModulesActifs
{
    private static readonly ConcurrentDictionary<string, (DateTime Lu, Dictionary<string, bool> Actifs)> Cache = new();
    private static readonly TimeSpan Duree = TimeSpan.FromSeconds(30);

    public async Task<bool> EstActifAsync(string code, CancellationToken ct) => (await ActifsAsync(ct)).GetValueOrDefault(code, true);

    public async Task<Dictionary<string, bool>> ActifsAsync(CancellationToken ct)
    {
        if (Cache.TryGetValue(societe.Connexion, out var c) && DateTime.UtcNow - c.Lu < Duree) return c.Actifs;
        var actifs = await db.Database.SqlQueryRaw<LigneModule>("SELECT mod_code AS code, mod_actif AS actif FROM module_societe")
            .ToDictionaryAsync(x => x.Code, x => x.Actif, ct);
        Cache[societe.Connexion] = (DateTime.UtcNow, actifs);
        return actifs;
    }

    public void Oublier() => Cache.TryRemove(societe.Connexion, out _);

    private sealed record LigneModule(string Code, bool Actif);
}

/// <summary>
/// Routes du cœur pour l'activation des modules (GET /api/modules, PUT /api/modules/{code}) et le référentiel des
/// services (GET|PUT /api/services, GET|PUT /api/services/{id}/membres, GET /api/services/individu/{id}).
/// </summary>
public static class ModulesServices
{
    private const string SqlModules = """
        SELECT coalesce(json_agg(json_build_object('code', mod_code, 'libelle', mod_libelle, 'description', mod_description,
          'actif', mod_actif, 'dependances', mod_dependances, 'maj_le', mod_maj_le, 'maj_par', mod_maj_par) ORDER BY mod_ordre, mod_code), '[]') AS "Value"
        FROM module_societe
        """;

    private const string SqlServices = """
        SELECT coalesce(json_agg(json_build_object('id', s.srv_id, 'code', s.srv_code, 'libelle', s.srv_libelle,
          'parent_id', s.srv_parent_id, 'parent_code', p.srv_code, 'nature', s.srv_nature, 'responsable_id', s.srv_responsable_id,
          'responsable', CASE WHEN r.ind_id IS NULL THEN NULL ELSE concat_ws(' ', r.ind_prenom, r.ind_nom) END,
          'ordre', s.srv_ordre, 'actif', s.srv_actif,
          'nb_membres', (SELECT count(*) FROM service_membre m WHERE m.sme_srv_id = s.srv_id))
          ORDER BY coalesce(p.srv_ordre, s.srv_ordre), coalesce(p.srv_code, s.srv_code), s.srv_parent_id NULLS FIRST, s.srv_ordre, s.srv_code), '[]') AS "Value"
        FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id LEFT JOIN individu r ON r.ind_id = s.srv_responsable_id
        """;

    private const string SqlMembres = """
        SELECT coalesce(json_agg(json_build_object('ind_id', i.ind_id, 'individu', concat_ws(' ', i.ind_prenom, i.ind_nom),
          'principal', m.sme_principal, 'actif', i.ind_actif) ORDER BY lower(i.ind_nom), lower(i.ind_prenom)), '[]') AS "Value"
        FROM service_membre m JOIN individu i ON i.ind_id = m.sme_ind_id WHERE m.sme_srv_id = @srv
        """;

    private const string SqlServicesIndividu = """
        SELECT coalesce(json_agg(json_build_object('id', s.srv_id, 'code', s.srv_code, 'libelle', s.srv_libelle, 'principal', m.sme_principal)
          ORDER BY m.sme_principal DESC, s.srv_ordre), '[]') AS "Value"
        FROM service_membre m JOIN service s ON s.srv_id = m.sme_srv_id WHERE m.sme_ind_id = @ind
        """;

    private static async Task<IResult> Json(LogiBtpContext db, string sql, CancellationToken ct, params NpgsqlParameter[] p) =>
        Results.Content(await db.Database.SqlQueryRaw<string>(sql, p).FirstAsync(ct), "application/json");

    public static IEndpointRouteBuilder MapModulesServices(this IEndpointRouteBuilder api)
    {
        api.MapGet("/modules", (LogiBtpContext db, CancellationToken ct) => Json(db, SqlModules, ct));
        api.MapPut("/modules/{code}", async (string code, ActivationModule a, HttpContext http, LogiBtpContext db, ModulesSociete modules, CancellationToken ct) =>
        {
            await Activer(db, code, a.Actif, Utilisateur.Depuis(http), ct);
            modules.Oublier();
            return await Json(db, SqlModules, ct);
        });

        api.MapGet("/services", (LogiBtpContext db, CancellationToken ct) => Json(db, SqlServices, ct));
        api.MapPut("/services", async (List<ServiceSaisi> s, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerServices(db, s, Utilisateur.Depuis(http), ct);
            return await Json(db, SqlServices, ct);
        });
        api.MapGet("/services/{id:int}/membres", (int id, LogiBtpContext db, CancellationToken ct) => Json(db, SqlMembres, ct, new NpgsqlParameter("srv", id)));
        api.MapPut("/services/{id:int}/membres", async (int id, List<MembreService> m, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerMembres(db, id, m, Utilisateur.Depuis(http), ct);
            return await Json(db, SqlMembres, ct, new NpgsqlParameter("srv", id));
        });
        api.MapGet("/services/individu/{id:long}", (long id, LogiBtpContext db, CancellationToken ct) => Json(db, SqlServicesIndividu, ct, new NpgsqlParameter("ind", id)));
        return api;
    }

    /// <summary>Active ou désactive un module : ses dépendances doivent être actives, et aucun module actif ne doit dépendre de lui.</summary>
    public static async Task Activer(LogiBtpContext db, string code, bool actif, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var modules = await db.Database.SqlQueryRaw<LigneModule>(
            "SELECT mod_code AS code, mod_libelle AS libelle, mod_actif AS actif, mod_dependances::text AS dependances FROM module_societe").ToListAsync(ct);
        var m = modules.FirstOrDefault(x => x.Code == code) ?? throw ExceptionMetier.Introuvable($"Module {code}");
        var dependances = (LigneModule x) => JsonSerializer.Deserialize<List<string>>(x.Dependances) ?? [];
        if (actif)
        {
            var inactives = dependances(m).Where(d => modules.FirstOrDefault(x => x.Code == d) is not { Actif: true }).ToList();
            if (inactives.Count > 0) throw ExceptionMetier.Conflit("MODULE_DEPENDANCES", $"Activez d'abord : {string.Join(", ", inactives)}");
        }
        else
        {
            var dependants = modules.Where(x => x.Actif && dependances(x).Contains(code)).Select(x => x.Libelle).ToList();
            if (dependants.Count > 0) throw ExceptionMetier.Conflit("MODULE_UTILISE", $"Module utilisé par : {string.Join(", ", dependants)}");
        }
        await db.Database.ExecuteSqlRawAsync("UPDATE module_societe SET mod_actif = @a, mod_maj_le = now(), mod_maj_par = @u WHERE mod_code = @c",
            [new NpgsqlParameter("a", actif), new NpgsqlParameter("u", u.Code), new NpgsqlParameter("c", code)], ct);
    }

    private static readonly HashSet<string> Natures = ["PRODUCTION", "ETUDE", "LOGISTIQUE", "ADMINISTRATIF"];

    /// <summary>
    /// Enregistre la liste complète des services (administrateur) : création, modification ; un service absent de la
    /// liste est supprimé s'il n'a ni sous-service ni membre, sinon mis en sommeil (inactif).
    /// </summary>
    public static async Task EnregistrerServices(LogiBtpContext db, List<ServiceSaisi> services, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        foreach (var s in services)
        {
            if (string.IsNullOrWhiteSpace(s.Code) || string.IsNullOrWhiteSpace(s.Libelle)) throw ExceptionMetier.Invalide("SERVICE", "Code et libellé obligatoires");
            if (!Natures.Contains(s.Nature)) throw ExceptionMetier.Invalide("SERVICE", $"Nature inconnue : {s.Nature}");
        }
        var codes = services.Select(s => s.Code.Trim().ToUpperInvariant()).ToList();
        if (codes.Distinct().Count() != codes.Count) throw ExceptionMetier.Invalide("SERVICE", "Codes de service en double");
        foreach (var s in services.Where(s => s.ParentCode is not null))
        {
            var parent = services.FirstOrDefault(p => p.Code.Trim().ToUpperInvariant() == s.ParentCode!.Trim().ToUpperInvariant())
                ?? throw ExceptionMetier.Invalide("SERVICE", $"Service parent inconnu : {s.ParentCode}");
            if (parent.ParentCode is not null || parent == s) throw ExceptionMetier.Invalide("SERVICE_NIVEAUX", "Deux niveaux de services au plus (service, sous-service)");
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var gardes = services.Where(s => s.Id is not null).Select(s => s.Id!.Value).ToArray();
        // Retirés de la liste : supprimés s'ils sont libres, sinon en sommeil.
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE service s SET srv_actif = FALSE, srv_maj_le = now()
            WHERE NOT (s.srv_id = ANY(@g)) AND (EXISTS (SELECT 1 FROM service_membre m WHERE m.sme_srv_id = s.srv_id)
                                               OR EXISTS (SELECT 1 FROM service c WHERE c.srv_parent_id = s.srv_id))
            """, [new NpgsqlParameter("g", gardes)], ct);
        await db.Database.ExecuteSqlRawAsync("""
            DELETE FROM service s WHERE NOT (s.srv_id = ANY(@g)) AND s.srv_actif
              AND NOT EXISTS (SELECT 1 FROM service_membre m WHERE m.sme_srv_id = s.srv_id)
              AND NOT EXISTS (SELECT 1 FROM service c WHERE c.srv_parent_id = s.srv_id)
            """, [new NpgsqlParameter("g", gardes)], ct);
        // Parents d'abord (niveau 1), puis sous-services : le parent est résolu par son code.
        foreach (var s in services.OrderBy(s => s.ParentCode is null ? 0 : 1))
        {
            var p = new NpgsqlParameter[]
            {
                new("code", s.Code.Trim().ToUpperInvariant()), new("libelle", s.Libelle.Trim()), new("nature", s.Nature),
                new("resp", (object?)s.ResponsableId ?? DBNull.Value), new("ordre", s.Ordre), new("actif", s.Actif),
                new("parent", (object?)s.ParentCode?.Trim().ToUpperInvariant() ?? DBNull.Value),
            };
            if (s.Id is int id)
            {
                await db.Database.ExecuteSqlRawAsync("""
                    UPDATE service SET srv_code = @code, srv_libelle = @libelle, srv_nature = @nature, srv_responsable_id = @resp,
                      srv_ordre = @ordre, srv_actif = @actif, srv_maj_le = now(),
                      srv_parent_id = (SELECT x.srv_id FROM service x WHERE x.srv_code = CAST(@parent AS varchar))
                    WHERE srv_id = @id
                    """, [.. p, new NpgsqlParameter("id", id)], ct);
            }
            else
            {
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO service (srv_code, srv_libelle, srv_nature, srv_responsable_id, srv_ordre, srv_actif, srv_parent_id)
                    VALUES (@code, @libelle, @nature, @resp, @ordre, @actif, (SELECT x.srv_id FROM service x WHERE x.srv_code = CAST(@parent AS varchar)))
                    """, p, ct);
            }
        }
        await tx.CommitAsync(ct);
    }

    /// <summary>
    /// Remplace les membres d'un service (administrateur). Un membre désigné principal perd son ancien service
    /// principal (un seul principal par salarié).
    /// </summary>
    public static async Task EnregistrerMembres(LogiBtpContext db, int service, List<MembreService> membres, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        if (membres.Select(m => m.IndId).Distinct().Count() != membres.Count) throw ExceptionMetier.Invalide("SERVICE_MEMBRE", "Membre en double");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM service WHERE srv_id = @s", new NpgsqlParameter("s", service)).FirstAsync(ct) == 0)
        {
            throw ExceptionMetier.Introuvable($"Service {service}");
        }
        await db.Database.ExecuteSqlRawAsync("DELETE FROM service_membre WHERE sme_srv_id = @s", [new NpgsqlParameter("s", service)], ct);
        var principaux = membres.Where(m => m.Principal).Select(m => m.IndId).ToArray();
        await db.Database.ExecuteSqlRawAsync("UPDATE service_membre SET sme_principal = FALSE WHERE sme_ind_id = ANY(@p)", [new NpgsqlParameter("p", principaux)], ct);
        foreach (var m in membres)
        {
            await db.Database.ExecuteSqlRawAsync("INSERT INTO service_membre (sme_srv_id, sme_ind_id, sme_principal) VALUES (@s, @i, @p)",
                [new NpgsqlParameter("s", service), new NpgsqlParameter("i", m.IndId), new NpgsqlParameter("p", m.Principal)], ct);
        }
        await tx.CommitAsync(ct);
    }

    private sealed record LigneModule(string Code, string Libelle, bool Actif, string Dependances);
}
