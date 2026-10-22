using LogiBTP.Calendrier;
using LogiBTP.Calendrier.Web;
using LogiBTP.Planning;
using LogiBTP.Planning.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module Planning par le cœur : ressources (salariés et intérimaires actifs par service principal,
/// matériels — sans capacité de travail, quantité s'ils sont gérés par nombre —, sous-traitants sans capacité),
/// plages travaillées par les calendriers effectifs (<see cref="CalendriersBtp"/>, module Calendrier), équipes et
/// membres à une date (`equipe_composition`), chantiers, budgets d'heures par chantier et service
/// (`v_heures_budget_chantier` : commandes validées), services. Services de la requête lus par l'accès au contexte HTTP
/// (la spécialisation est un singleton).
/// </summary>
public class SpecialisationPlanningBtp(IHttpContextAccessor http) : SpecialisationPlanning
{
    private IServiceProvider Services => http.HttpContext?.RequestServices ?? throw new InvalidOperationException("Planning : contexte HTTP absent");

    private static readonly string[] TypesConnus = ["SALARIE", "INTERIM", "MATERIEL", "SOUS_TRAITANT"];

    public override Task<List<RessourcePlanning>> RessourcesAsync(PlanningDbContext db, FiltreRessources f, CancellationToken ct)
    {
        var types = f.Types is { Count: > 0 } ? f.Types.ToArray() : TypesConnus;
        return db.Database.SqlQueryRaw<RessourcePlanning>("""
            SELECT r.type, r.id, r.libelle, r.srv_id, r.service, r.capacite, r.quantite FROM (
              SELECT CASE WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM' ELSE 'SALARIE' END AS type, s.sal_id::text AS id, s.sal_nom || ' ' || s.sal_prenom AS libelle,
                     sv.srv_id, sv.srv_libelle AS service, TRUE AS capacite, NULL::numeric AS quantite, sv.srv_parent_id AS parent
              FROM salarie s
              LEFT JOIN service_membre sm ON sm.sme_ind_id = s.sal_ind_id AND sm.sme_principal
              LEFT JOIN service sv ON sv.srv_id = sm.sme_srv_id
              WHERE s.sal_actif
              UNION ALL
              SELECT 'MATERIEL', m.mat_id::text, m.mat_code || ' ' || m.mat_designation, sv.srv_id, sv.srv_libelle, FALSE,
                     CASE WHEN m.mat_mode = 'NOMBRE' THEN m.mat_quantite END, sv.srv_parent_id
              FROM materiel m LEFT JOIN service sv ON sv.srv_id = m.mat_srv_id
              UNION ALL
              SELECT 'SOUS_TRAITANT', t.sst_id::text, t.sst_raison || ' (' || t.sst_metier || ')', NULL::int, NULL, FALSE, NULL::numeric, NULL::int
              FROM demo_sous_traitant t
            ) r
            WHERE (@cles IS NULL AND r.type = ANY(@types) AND (@srv IS NULL OR r.srv_id = ANY(@srv) OR r.parent = ANY(@srv))
                   AND (@q IS NULL OR r.libelle ILIKE @q)
                   OR r.type || ':' || r.id = ANY(@cles))
            ORDER BY r.libelle
            LIMIT 10000
            """,
            new NpgsqlParameter("cles", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Text) { Value = (object?)f.Cles?.ToArray() ?? DBNull.Value },
            new NpgsqlParameter("types", types),
            new NpgsqlParameter("srv", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)f.Services?.ToArray() ?? DBNull.Value },
            new NpgsqlParameter("q", NpgsqlTypes.NpgsqlDbType.Text) { Value = string.IsNullOrWhiteSpace(f.Recherche) ? DBNull.Value : $"%{f.Recherche.Trim()}%" })
            .ToListAsync(ct);
    }

    private static List<(long, long)> Plages(IEnumerable<Journee> journees) =>
        journees.SelectMany(j => j.Plages.Select(p => (Temps.VersMinutes(j.Date) + p.Debut, Temps.VersMinutes(j.Date) + p.Fin))).ToList();

    private sealed record CalendrierRessource(string Cle, int? CalId, int? SrvId);

    /// <summary>
    /// Plages des ressources : calendrier effectif (salarié : le sien, sinon celui de son service ; matériel : idem ;
    /// sous-traitant : défaut) et fermetures du service ; une seule lecture des journées par couple (calendrier, service).
    /// </summary>
    public override async Task<Dictionary<string, List<(long Debut, long Fin)>>> PlagesAsync(PlanningDbContext db, IReadOnlyCollection<RessourcePlanning> ressources, DateOnly du, DateOnly au, CancellationToken ct)
    {
        var calendriers = Services.GetRequiredService<ServiceCalendrier>();
        var cles = ressources.Select(r => r.Cle).ToArray();
        var lignes = await db.Database.SqlQueryRaw<CalendrierRessource>("""
            SELECT CASE WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM' ELSE 'SALARIE' END || ':' || s.sal_id AS cle, coalesce(s.sal_cal_id, v.srv_cal_id) AS cal_id, v.srv_id
            FROM salarie s
            LEFT JOIN LATERAL (SELECT sv.srv_id, sv.srv_cal_id FROM service_membre m JOIN service sv ON sv.srv_id = m.sme_srv_id
                               WHERE m.sme_ind_id = s.sal_ind_id ORDER BY m.sme_principal DESC, sv.srv_ordre LIMIT 1) v ON TRUE
            WHERE (CASE WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM' ELSE 'SALARIE' END || ':' || s.sal_id) = ANY(@cles)
            UNION ALL
            SELECT 'MATERIEL:' || m.mat_id, coalesce(m.mat_cal_id, sv.srv_cal_id), m.mat_srv_id
            FROM materiel m LEFT JOIN service sv ON sv.srv_id = m.mat_srv_id WHERE ('MATERIEL:' || m.mat_id) = ANY(@cles)
            """, new NpgsqlParameter("cles", cles)).ToListAsync(ct);
        var parCle = lignes.ToDictionary(l => l.Cle);
        var cache = new Dictionary<(int?, int?), List<(long, long)>>();
        var r = new Dictionary<string, List<(long, long)>>();
        foreach (var x in ressources)
        {
            var (cal, srv) = parCle.TryGetValue(x.Cle, out var l) ? (l.CalId, l.SrvId) : ((int?)null, (int?)null);
            if (!cache.TryGetValue((cal, srv), out var p))
            {
                p = Plages(await calendriers.JourneesAsync(cal, du, au, srv is int s ? [new Portee("service", s.ToString())] : [], ct));
                cache[(cal, srv)] = p;
            }
            r[x.Cle] = p;
        }
        return r;
    }

    private sealed record HabilitationValide(string Cle, string Code);

    public override async Task<Dictionary<string, HashSet<string>>> HabilitationsAsync(PlanningDbContext db, IReadOnlyCollection<string> ressources, DateOnly date, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<HabilitationValide>("""
            SELECT CASE WHEN h.hab_type_element = 'materiel' THEN 'MATERIEL:' || h.hab_id_element
                        WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM:' || s.sal_id ELSE 'SALARIE:' || s.sal_id END AS cle, h.hab_tha_code AS code
            FROM habilitation h
            LEFT JOIN salarie s ON h.hab_type_element = 'salarie' AND s.sal_id = h.hab_id_element
            WHERE (h.hab_obtenue_le IS NULL OR h.hab_obtenue_le <= @d) AND (h.hab_valide_jusqu_au IS NULL OR h.hab_valide_jusqu_au >= @d)
            """, new NpgsqlParameter("d", date)).ToListAsync(ct))
        .Where(h => ressources.Contains(h.Cle)).GroupBy(h => h.Cle).ToDictionary(g => g.Key, g => g.Select(h => h.Code).ToHashSet());

    private sealed record TypeHabilitation(string Code, string Libelle);

    public override async Task<List<(string Code, string Libelle)>> TypesHabilitationAsync(PlanningDbContext db, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<TypeHabilitation>("SELECT tha_code AS code, tha_libelle AS libelle FROM type_habilitation WHERE tha_actif ORDER BY tha_libelle").ToListAsync(ct))
        .Select(t => (t.Code, t.Libelle)).ToList();

    public override async Task<List<(long Debut, long Fin)>> PlagesServiceAsync(PlanningDbContext db, int? service, DateOnly du, DateOnly au, CancellationToken ct)
    {
        var cal = service is int s
            ? await db.Database.SqlQueryRaw<int?>("SELECT srv_cal_id AS \"Value\" FROM service WHERE srv_id = @s", new NpgsqlParameter("s", s)).FirstOrDefaultAsync(ct)
            : null;
        var journees = await Services.GetRequiredService<ServiceCalendrier>().JourneesAsync(cal, du, au, service is int x ? [new Portee("service", x.ToString())] : [], ct);
        return Plages(journees);
    }

    public override Task<List<EquipePlanning>> EquipesAsync(PlanningDbContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<EquipePlanning>("""
            SELECT equ_id AS id, equ_code AS code, equ_libelle AS libelle, equ_srv_id AS srv_id FROM equipe WHERE equ_active ORDER BY equ_libelle
            """).ToListAsync(ct);

    private sealed record Membre(string Type, string Id);

    public override async Task<List<(string Type, string Id)>> MembresAsync(PlanningDbContext db, int equipe, DateOnly date, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<Membre>("""
            SELECT CASE WHEN s.sal_statut = 'INTERIM' THEN 'INTERIM' ELSE 'SALARIE' END AS type, s.sal_id::text AS id
            FROM equipe_composition c JOIN salarie s ON s.sal_id = c.eqc_sal_id
            WHERE c.eqc_equ_id = @e AND c.eqc_du <= @d AND (c.eqc_au IS NULL OR c.eqc_au >= @d)
            ORDER BY c.eqc_chef DESC, s.sal_nom
            """, new NpgsqlParameter("e", equipe), new NpgsqlParameter("d", date)).ToListAsync(ct)).Select(m => (m.Type, m.Id)).ToList();

    public override Task<List<ElementPlanning>> ElementsAsync(PlanningDbContext db, string type, IReadOnlyCollection<string>? ids, string? recherche, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ElementPlanning>("""
            SELECT 'chantier' AS type, c.cha_id::text AS id, c.cha_code AS code, c.cha_libelle AS libelle, '/fiche/chantier/' || c.cha_id AS url
            FROM chantier c
            WHERE (@ids IS NULL AND (c.cha_statut = 'OUVERT' OR c.cha_interne) AND (@q IS NULL OR c.cha_code ILIKE @q OR c.cha_libelle ILIKE @q)
                   OR c.cha_id::text = ANY(@ids))
            ORDER BY c.cha_interne, c.cha_code
            LIMIT 500
            """,
            new NpgsqlParameter("ids", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Text) { Value = (object?)ids?.ToArray() ?? DBNull.Value },
            new NpgsqlParameter("q", NpgsqlTypes.NpgsqlDbType.Text) { Value = string.IsNullOrWhiteSpace(recherche) ? DBNull.Value : $"%{recherche.Trim()}%" }).ToListAsync(ct);

    public override Task<List<BudgetPlanning>> BudgetsAsync(PlanningDbContext db, IReadOnlyCollection<int>? services, string? recherche, CancellationToken ct) =>
        db.Database.SqlQueryRaw<BudgetPlanning>("""
            SELECT 'chantier' AS type, b.chantier_id::text AS id, b.srv_id, round(b.heures * 60)::int AS minutes
            FROM v_heures_budget_chantier b JOIN chantier c ON c.cha_id = b.chantier_id
            WHERE b.srv_id IS NOT NULL AND c.cha_statut = 'OUVERT' AND (@srv IS NULL OR b.srv_id = ANY(@srv))
              AND (@q IS NULL OR c.cha_code ILIKE @q OR c.cha_libelle ILIKE @q)
            """,
            new NpgsqlParameter("srv", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)services?.ToArray() ?? DBNull.Value },
            new NpgsqlParameter("q", NpgsqlTypes.NpgsqlDbType.Text) { Value = string.IsNullOrWhiteSpace(recherche) ? DBNull.Value : $"%{recherche.Trim()}%" }).ToListAsync(ct);

    public override Task<List<ServicePlanningDto>> ServicesAsync(PlanningDbContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ServicePlanningDto>("""
            SELECT s.srv_id AS id, s.srv_code AS code, s.srv_libelle AS libelle, s.srv_parent_id AS parent_id
            FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id
            WHERE s.srv_actif
            ORDER BY coalesce(p.srv_ordre, s.srv_ordre), coalesce(p.srv_code, s.srv_code), s.srv_parent_id NULLS FIRST, s.srv_ordre
            """).ToListAsync(ct);
}
