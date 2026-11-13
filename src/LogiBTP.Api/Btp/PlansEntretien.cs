using System.Text.RegularExpressions;
using LogiBTP.Domaine.Ressources;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>Plan d'entretien saisi (d'un type de matériel ou d'un matériel).</summary>
public sealed record PlanSaisi(string? Code, string? Libelle, string? Operations, string? Nature, decimal? Heures, decimal? Km, int? Mois, bool Actif = true, int Ordre = 0);

/// <summary>Échéance d'un plan pour un matériel (page « à surveiller », fiche matériel, notifications).</summary>
public sealed record EcheanceMateriel(int MaterielId, string MaterielCode, string Designation, int PlanId, string Code, string? Libelle, string Nature,
    string? Operations, decimal? Heures, decimal? Km, int? Mois, string Origine, DateOnly? DernierLe, PointCompteurs? Reference, PointCompteurs Courant,
    EcheanceEntretien Echeance, string? Responsable);

/// <summary>
/// Plans et échéances d'entretien du matériel (db/235, lot 5c-4 des demandes du 25/10/2026, M6) : plans par type de
/// matériel (un type enfant hérite de son parent) et par matériel (même code = remplace, inactif = retire :
/// <see cref="ReglesEntretiens.PlansEffectifs"/>) ; échéance de chaque plan effectif depuis le dernier entretien de ce
/// plan (événement ENTRETIEN ou CONTROLE au code du plan), sinon la mise en service (ou l'entrée), avec les compteurs
/// cumulés et l'usage moyen des 90 derniers jours (<see cref="ReglesEntretiens.Echeance"/>).
/// </summary>
public static partial class PlansEntretien
{
    private const string FiltreType = "mpl_type = @t";
    private const string FiltreMateriel = "mpl_mat_id = @m";

    private sealed record PlanSql(int Id, string? Type, int? MatId, string Code, string? Libelle, string? Operations, string Nature,
        decimal? Heures, decimal? Km, int? Mois, bool Actif, int Ordre);
    private sealed record MaterielSql(int Id, string Code, string Designation, string? Famille, string? Parent, string Compteurs,
        DateOnly? MiseService, DateOnly? Entree, string? Responsable);
    private sealed record ReleveSql(int MatId, int Id, DateOnly Date, string Unite, decimal Valeur, bool Remise);
    private sealed record DernierSql(int MatId, string Code, DateOnly Date);

    public static readonly string[] Natures = ["PREVENTIF", "CURATIF", "REGLEMENTAIRE"];

    [GeneratedRegex("^[A-Z0-9_]{1,20}$")]
    private static partial Regex CodeValable();

    private static PlanEntretien Regle(PlanSql p, string origine) => new(p.Code, p.Libelle, p.Heures, p.Km, p.Mois, p.Actif, p.Id, origine);

    private static void Controler(List<PlanSaisi> plans)
    {
        foreach (var p in plans)
        {
            if (string.IsNullOrWhiteSpace(p.Code) || !CodeValable().IsMatch(p.Code.Trim().ToUpperInvariant()))
                throw ExceptionMetier.Invalide("PLAN_CODE", "Code du plan obligatoire : lettres, chiffres et _ (20 au plus)");
            if (p.Nature is not null && !Natures.Contains(p.Nature)) throw ExceptionMetier.Invalide("PLAN_NATURE", "Nature inconnue");
            if (p.Actif && p.Heures is not > 0 && p.Km is not > 0 && p.Mois is not > 0)
                throw ExceptionMetier.Invalide("PLAN_PERIODICITE", $"Plan {p.Code} : une périodicité au moins (heures, kilomètres ou mois)");
        }
        if (plans.GroupBy(p => p.Code!.Trim().ToUpperInvariant()).FirstOrDefault(g => g.Count() > 1) is { } d)
            throw ExceptionMetier.Invalide("PLAN_DOUBLON", $"Code {d.Key} en double");
    }

    /// <summary>Remplace les plans d'un type (<paramref name="type"/>) ou d'un matériel (<paramref name="materiel"/>) ; garde les identifiants par code.</summary>
    private static async Task EnregistrerAsync(LogiBtpContext db, string? type, int? materiel, List<PlanSaisi> plans, string utilisateur, CancellationToken ct)
    {
        Controler(plans);
        var parType = type is not null;
        object cle = (object?)type ?? materiel!.Value;
        var codes = plans.Select(p => p.Code!.Trim().ToUpperInvariant()).ToArray();
        await using var tx = await db.Unite().CommencerAsync(ct);
        var sql = parType
            ? "SELECT mpl_code FROM materiel_plan WHERE mpl_type = @p AND NOT (mpl_code = ANY(@codes))"
            : "SELECT mpl_code FROM materiel_plan WHERE mpl_mat_id = @p AND NOT (mpl_code = ANY(@codes))";
        await db.Database.ExecuteSqlRawAsync(sql, [new NpgsqlParameter("p", cle), new NpgsqlParameter("codes", codes)], ct);
        foreach (var p in plans)
        {
            NpgsqlParameter[] v =
            [
                new("p", cle), new("c", p.Code!.Trim().ToUpperInvariant()), SqlBtp.P("l", p.Libelle?.Trim()),
                new("o", (object?)(string.IsNullOrWhiteSpace(p.Operations) ? null : p.Operations.Trim()) ?? DBNull.Value), new("n", p.Nature ?? "PREVENTIF"),
                SqlBtp.P("h", p.Heures), SqlBtp.P("k", p.Km), SqlBtp.P("m", p.Mois),
                new("a", p.Actif), new("r", p.Ordre), new("u", utilisateur),
            ];
            var update = parType ? """
                UPDATE materiel_plan SET mpl_libelle = @l, mpl_operations = @o, mpl_nature = @n, mpl_heures = @h, mpl_km = @k, mpl_mois = @m,
                       mpl_actif = @a, mpl_ordre = @r, mpl_maj_par = @u, mpl_maj_le = now()
                WHERE mpl_type = @p AND mpl_code = @c
                """ : """
                UPDATE materiel_plan SET mpl_libelle = @l, mpl_operations = @o, mpl_nature = @n, mpl_heures = @h, mpl_km = @k, mpl_mois = @m,
                       mpl_actif = @a, mpl_ordre = @r, mpl_maj_par = @u, mpl_maj_le = now()
                WHERE mpl_mat_id = @p AND mpl_code = @c
                """;
            var n = await db.Database.ExecuteSqlRawAsync(update, v, ct);
            if (n == 0)
            {
                var insert = parType ? """
                    INSERT INTO materiel_plan (mpl_type, mpl_code, mpl_libelle, mpl_operations, mpl_nature, mpl_heures, mpl_km, mpl_mois, mpl_actif, mpl_ordre, mpl_maj_par)
                    VALUES (@p, @c, @l, @o, @n, @h, @k, @m, @a, @r, @u)
                    """ : """
                    INSERT INTO materiel_plan (mpl_mat_id, mpl_code, mpl_libelle, mpl_operations, mpl_nature, mpl_heures, mpl_km, mpl_mois, mpl_actif, mpl_ordre, mpl_maj_par)
                    VALUES (@p, @c, @l, @o, @n, @h, @k, @m, @a, @r, @u)
                    """;
                await db.Database.ExecuteSqlRawAsync(insert, v.Select(x => x.Clone()).ToArray(), ct);
            }
        }
        await tx.CommitAsync(ct);
    }

    private static Task<List<PlanSql>> PlansAsync(LogiBtpContext db, string filtre, params NpgsqlParameter[] p)
    {
        var clause = filtre switch
        {
            "TRUE" => "TRUE",
            "mpl_type IS NOT NULL" => "mpl_type IS NOT NULL",
            FiltreType => FiltreType,
            FiltreMateriel => FiltreMateriel,
            _ => throw new ArgumentOutOfRangeException(nameof(filtre), "Filtre de plans inconnu")
        };
        var sql = """
            SELECT mpl_id AS id, mpl_type AS type, mpl_mat_id AS mat_id, mpl_code AS code, mpl_libelle AS libelle,
                   mpl_operations AS operations, mpl_nature AS nature, mpl_heures AS heures, mpl_km AS km, mpl_mois AS mois, mpl_actif AS actif, mpl_ordre AS ordre
            FROM materiel_plan WHERE
            """ + clause + " ORDER BY mpl_ordre, mpl_code";
        return db.Database.SqlQueryRaw<PlanSql>(sql, p).ToListAsync();
    }

    /// <summary>Plans effectifs d'un matériel : type parent, type, matériel (origines TYPE_PARENT, TYPE, MATERIEL).</summary>
    private static List<PlanEntretien> Effectifs(MaterielSql m, List<PlanSql> plans) => ReglesEntretiens.PlansEffectifs(
    [
        plans.Where(p => m.Parent is not null && p.Type == m.Parent).Select(p => Regle(p, "TYPE_PARENT")),
        plans.Where(p => m.Famille is not null && p.Type == m.Famille).Select(p => Regle(p, "TYPE")),
        plans.Where(p => p.MatId == m.Id).Select(p => Regle(p, "MATERIEL")),
    ]);

    /// <summary>Échéances des plans effectifs d'un matériel, ou de tous les matériels utilisés (non en sommeil, non au rebut).</summary>
    public static async Task<List<EcheanceMateriel>> CalculerAsync(LogiBtpContext db, int? materiel, DateOnly date, CancellationToken ct)
    {
        var materiels = await db.Database.SqlQueryRaw<MaterielSql>("""
            SELECT m.mat_id AS id, m.mat_code AS code, m.mat_designation AS designation, m.mat_famille AS famille,
                   (SELECT l.lva_parent FROM liste_valeur l WHERE l.lva_liste = 'TYPE_MATERIEL' AND l.lva_code = m.mat_famille) AS parent,
                   m.mat_compteurs AS compteurs, m.mat_date_mise_service AS mise_service, m.mat_date_entree AS entree,
                   (SELECT r.ind_utilisateur FROM service sv JOIN individu r ON r.ind_id = sv.srv_responsable_id WHERE sv.srv_id = m.mat_srv_id) AS responsable
            FROM materiel m
            WHERE (@m::int IS NULL AND m.mat_usage <> 'S' AND m.mat_etat <> 'REBUT') OR m.mat_id = @m::int
            """, SqlBtp.P("m", materiel, NpgsqlTypes.NpgsqlDbType.Integer)).ToListAsync(ct);
        var plans = await PlansAsync(db, "TRUE");
        var effectifs = materiels.Select(m => (M: m, Plans: Effectifs(m, plans))).Where(x => x.Plans.Count > 0).ToList();
        if (effectifs.Count == 0) return [];
        var ids = effectifs.Select(x => x.M.Id).ToArray();
        var releves = (await db.Database.SqlQueryRaw<ReleveSql>("""
            SELECT mre_mat_id AS mat_id, mre_id AS id, mre_date AS date, mre_unite AS unite, mre_valeur AS valeur, mre_remise AS remise
            FROM materiel_releve WHERE mre_mat_id = ANY(@ids) ORDER BY mre_id
            """, new NpgsqlParameter("ids", ids)).ToListAsync(ct)).ToLookup(r => r.MatId);
        var derniers = (await db.Database.SqlQueryRaw<DernierSql>("""
            SELECT mev_mat_id AS mat_id, mev_plan_code AS code, max(mev_date) AS date FROM materiel_evenement
            WHERE mev_mat_id = ANY(@ids) AND mev_type IN ('ENTRETIEN', 'CONTROLE') AND mev_plan_code IS NOT NULL AND mev_date <= @d
            GROUP BY mev_mat_id, mev_plan_code
            """, new NpgsqlParameter("ids", ids), new NpgsqlParameter("d", date)).ToListAsync(ct)).ToDictionary(d => (d.MatId, d.Code), d => d.Date);
        var parId = plans.ToDictionary(p => p.Id);
        var r = new List<EcheanceMateriel>();
        foreach (var (m, liste) in effectifs)
        {
            var rel = releves[m.Id].Select(x => new ReleveCompteur(x.Unite, x.Date, x.Valeur, x.Remise)).ToList();
            var unites = ReglesCompteurs.UnitesCompteurs(m.Compteurs);
            decimal? Cumul(string u, DateOnly d) => unites.Contains(u) ? ReglesEntretiens.CumulA(rel, u, d) : null;
            var courant = new PointCompteurs(date, Cumul("H", date), Cumul("KM", date));
            var moyH = unites.Contains("H") ? ReglesEntretiens.MoyenneUsage(rel, "H", date) : null;
            var moyKm = unites.Contains("KM") ? ReglesEntretiens.MoyenneUsage(rel, "KM", date) : null;
            foreach (var p in liste)
            {
                var dernier = derniers.TryGetValue((m.Id, p.Code), out var d) ? d : (DateOnly?)null;
                var depuis = dernier ?? m.MiseService ?? m.Entree;
                var reference = depuis is { } x ? new PointCompteurs(x, Cumul("H", x), Cumul("KM", x)) : null;
                var plan = parId[p.Id!.Value];
                r.Add(new(m.Id, m.Code, m.Designation, plan.Id, plan.Code, plan.Libelle, plan.Nature, plan.Operations, plan.Heures, plan.Km, plan.Mois,
                    p.Origine!, dernier, reference, courant, ReglesEntretiens.Echeance(p, reference, courant, moyH, moyKm), m.Responsable));
            }
        }
        return r;
    }

    public static IEndpointRouteBuilder MapPlansEntretien(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/ressources");
        // Plans par type de matériel (paramétrage).
        g.MapGet("/plans-entretien/types", async (LogiBtpContext db, CancellationToken ct) =>
            Results.Ok((await PlansAsync(db, "mpl_type IS NOT NULL")).GroupBy(p => p.Type!).ToDictionary(x => x.Key, x => x.ToList())));
        g.MapPut("/plans-entretien/types/{type}", async (string type, List<PlanSaisi> plans, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerAsync(db, type, null, plans, Utilisateur.Depuis(http).Code, ct);
            return Results.Ok(await PlansAsync(db, FiltreType, new NpgsqlParameter("t", type)));
        });
        // Plans d'un matériel : hérités (type parent, type) et propres.
        g.MapGet("/materiels/{id:int}/plans", async (int id, LogiBtpContext db, CancellationToken ct) =>
        {
            var m = (await db.Database.SqlQueryRaw<string?>("SELECT mat_famille AS \"Value\" FROM materiel WHERE mat_id = @m", new NpgsqlParameter("m", id)).ToListAsync(ct))
                .FirstOrDefault() ?? throw ExceptionMetier.Introuvable("Matériel");
            var parent = await db.Database.SqlQueryRaw<string?>("SELECT lva_parent AS \"Value\" FROM liste_valeur WHERE lva_liste = 'TYPE_MATERIEL' AND lva_code = @f",
                new NpgsqlParameter("f", m)).FirstOrDefaultAsync(ct);
            var herites = ReglesEntretiens.PlansEffectifs(
            [
                (await PlansAsync(db, FiltreType, SqlBtp.P("t", parent))).Select(p => Regle(p, "TYPE_PARENT")),
                (await PlansAsync(db, FiltreType, new NpgsqlParameter("t", m))).Select(p => Regle(p, "TYPE")),
            ]);
            return Results.Ok(new { herites, propres = await PlansAsync(db, FiltreMateriel, new NpgsqlParameter("m", id)) });
        });
        g.MapPut("/materiels/{id:int}/plans", async (int id, List<PlanSaisi> plans, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            await EnregistrerAsync(db, null, id, plans, Utilisateur.Depuis(http).Code, ct);
            return Results.Ok(await PlansAsync(db, FiltreMateriel, new NpgsqlParameter("m", id)));
        });
        g.MapGet("/materiels/{id:int}/echeances", async (int id, LogiBtpContext db, CancellationToken ct) =>
            Results.Ok(await CalculerAsync(db, id, DateOnly.FromDateTime(DateTime.Today), ct)));
        // À surveiller : en retard, ou date estimée dans les prochains jours.
        g.MapGet("/entretiens/echeances", async (int? jours, LogiBtpContext db, CancellationToken ct) =>
        {
            var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
            var limite = aujourdhui.AddDays(jours ?? 60);
            return Results.Ok((await CalculerAsync(db, null, aujourdhui, ct))
                .Where(e => e.Echeance.Etat == "EN_RETARD" || e.Echeance.Date <= limite)
                .OrderBy(e => e.Echeance.Date ?? DateOnly.MaxValue).ThenBy(e => e.MaterielCode));
        });
        return api;
    }
}
