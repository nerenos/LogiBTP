using System.Globalization;
using LogiBTP.Crm;
using LogiBTP.Crm.Web;
using LogiBTP.Domaine;
using LogiBTP.Ged.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Plan du suivi des validations à évaluer : saisie, élément de rattachement, case « Terrain », indices dans l'ordre de création.</summary>
public sealed record PlanTerrainSource(long Id, string Repere, string Nom, string? Lot, string TypeElement, string IdElement, bool Terrain, IReadOnlyList<IndiceTerrainSource> Indices);

/// <summary>Indice d'un plan à évaluer : identifiant, lettre, date de diffusion, fichier et répertoire de la GED, visas.</summary>
public sealed record IndiceTerrainSource(long Id, string Indice, DateOnly? Date, long? DgeId, long? RgeId, IReadOnlyList<VisaAEvaluer> Visas);

/// <summary>Plan montré sur le terrain : le plan et son indice en vigueur.</summary>
public sealed record PlanEnVigueur(PlanTerrainSource Plan, IndiceTerrainSource Indice);

/// <summary>Fichier d'un plan lu par le terrain (document de la GED de l'indice en vigueur).</summary>
public sealed record FichierPlanTerrain(long Id, string Titre, string? NomFichier, string? TypeMime, long? Taille);

/// <summary>Plan lu par le terrain : repère, nom, lot, indice en vigueur, case « Terrain », type de l'élément de rattachement, fichiers.</summary>
public sealed record PlanTerrain(long Id, string Repere, string Nom, string? Lot, string Indice, bool Terrain, string Element, List<FichierPlanTerrain> Fichiers);

/// <summary>
/// Plans en vigueur sur le terrain (plan terrain-suites, lot 3 ; décisions TS1 a, TS2 b) : plans du suivi des
/// validations (module CRM) rattachés au chantier d'une tâche, à ses marchés ou à l'ordre d'origine (groupe d'indices),
/// à leur indice en vigueur seul (règle <see cref="ReglesValidation.Etat"/> du module : dernier indice bon pour
/// exécution, indices plus récents en attente ignorés) ; plan sans indice en vigueur absent ; plans cochés « Terrain »
/// en tête, les autres derrière « Voir tous les plans ». Fichiers : celui de l'indice et ceux de son répertoire de la
/// GED, jamais confidentiels, secrets ni à accès restreint, servis par <c>/api/terrain/plans/{id}</c>. Module CRM
/// inactif : aucun plan.
/// </summary>
public static partial class TerrainBtp
{
    /// <summary>Tâche, chantier et groupe d'indices de l'ordre d'origine.</summary>
    private sealed record TacheElements(long TacId, int? ChaId, long? Groupe);

    private sealed record MarcheChantier(int MarId, int MarChaId);

    /// <summary>Fichier de la GED d'un indice (document de l'indice ou de son répertoire).</summary>
    private sealed record FichierPlan(long Id, string Titre, long? RepertoireId, string? NomFichier, string? TypeMime, long? Taille);

    /// <summary>Plans en vigueur parmi les plans donnés : cochés « Terrain » d'abord, puis par lot et repère.</summary>
    public static List<PlanEnVigueur> PlansEnVigueur(IEnumerable<PlanTerrainSource> plans, IReadOnlyDictionary<string, string> effets, DateOnly aujourdhui) =>
        plans.Select(p =>
            {
                var etat = ReglesValidation.Etat(p.Indices.Select(i => new IndiceAEvaluer(i.Indice, i.Date, i.Visas)).ToList(), effets, aujourdhui);
                var indice = etat.EnVigueur is string v ? p.Indices.LastOrDefault(i => i.Indice == v) : null;
                return indice is null ? null : new PlanEnVigueur(p, indice);
            })
            .OfType<PlanEnVigueur>()
            .OrderByDescending(x => x.Plan.Terrain).ThenBy(x => x.Plan.Lot ?? "", StringComparer.Ordinal).ThenBy(x => x.Plan.Repere, StringComparer.Ordinal).ThenBy(x => x.Plan.Id)
            .ToList();

    /// <summary>Plans en vigueur de chaque tâche de la personne @s sur la période (clé : tâche) ; module CRM inactif : vide.</summary>
    private static async Task<Dictionary<long, List<PlanTerrain>>> PlansTachesAsync(IServiceProvider services, LogiBtpContext db, int salarie, DateOnly du, DateOnly au, CancellationToken ct)
    {
        var res = new Dictionary<long, List<PlanTerrain>>();
        if (!await services.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.Crm, ct)) return res;
        var taches = await db.Database.SqlQueryRaw<TacheElements>($$"""
            {{SqlTaches}}
            SELECT x.tac_id, x.cha_id, x.groupe FROM x
            """, Parametres(salarie, du, au)).ToListAsync(ct);
        var chantiers = taches.Where(t => t.ChaId is not null).Select(t => t.ChaId!.Value).Distinct().ToArray();
        var marches = chantiers.Length == 0 ? [] : await db.Database.SqlQueryRaw<MarcheChantier>(
            "SELECT mar_id, mar_cha_id FROM marche WHERE mar_cha_id = ANY(@c)", new NpgsqlParameter("c", chantiers)).ToListAsync(ct);
        // Éléments du CRM d'une tâche : son chantier, les marchés du chantier, l'ordre d'origine (« document », groupe d'indices).
        List<(string Type, string Id)> Elements(TacheElements t) =>
        [
            .. t.ChaId is int c ? [(TypesFiche.Chantier, c.ToString(CultureInfo.InvariantCulture))] : Array.Empty<(string, string)>(),
            .. marches.Where(m => m.MarChaId == t.ChaId).Select(m => (TypesFiche.Marche, m.MarId.ToString(CultureInfo.InvariantCulture))),
            .. t.Groupe is long g ? [("document", g.ToString(CultureInfo.InvariantCulture))] : Array.Empty<(string, string)>(),
        ];
        var parTache = taches.ToDictionary(t => t.TacId, Elements);
        var cles = parTache.Values.SelectMany(e => e).Distinct().ToList();
        if (cles.Count == 0) return res;

        var crm = services.GetRequiredService<CrmDbContext>();
        var types = cles.Select(c => c.Type).Distinct().ToList();
        var ids = cles.Select(c => c.Id).Distinct().ToList();
        var plans = (await crm.Plans.AsNoTracking().Where(p => p.PlaTypeElement != null && p.PlaIdElement != null && types.Contains(p.PlaTypeElement) && ids.Contains(p.PlaIdElement))
            .ToListAsync(ct)).Where(p => cles.Contains((p.PlaTypeElement!, p.PlaIdElement!))).ToList();
        if (plans.Count == 0) return res;
        var idsPlans = plans.Select(p => p.PlaId).ToList();
        var indices = await crm.Indices.AsNoTracking().Where(i => idsPlans.Contains(i.PinPlaId)).OrderBy(i => i.PinCreeLe).ThenBy(i => i.PinId).ToListAsync(ct);
        var idsIndices = indices.Select(i => i.PinId).ToList();
        var visas = await crm.Visas.AsNoTracking().Where(v => idsIndices.Contains(v.VisPinId)).ToListAsync(ct);
        var effets = await crm.StatutsVisa.AsNoTracking().ToDictionaryAsync(s => s.StvCode, s => s.StvEffet, ct);
        var sources = plans.Select(p => new PlanTerrainSource(p.PlaId, p.PlaRepere, p.PlaNom, p.PlaLot, p.PlaTypeElement!, p.PlaIdElement!, p.PlaTerrain,
            indices.Where(i => i.PinPlaId == p.PlaId).Select(i => new IndiceTerrainSource(i.PinId, i.PinIndice, i.PinDate, i.PinDgeId, i.PinRgeId,
                visas.Where(v => v.VisPinId == i.PinId).Select(v => new VisaAEvaluer(v.VisStvCode, v.VisAttenduLe)).ToList())).ToList()));
        var enVigueur = PlansEnVigueur(sources, effets, DateOnly.FromDateTime(DateTime.Today));
        if (enVigueur.Count == 0) return res;

        var documents = enVigueur.Where(x => x.Indice.DgeId is not null).Select(x => x.Indice.DgeId!.Value).ToArray();
        var repertoires = enVigueur.Where(x => x.Indice.RgeId is not null).Select(x => x.Indice.RgeId!.Value).ToArray();
        var fichiers = await db.Database.SqlQueryRaw<FichierPlan>("""
            SELECT g.dge_id AS id, g.dge_titre AS titre, g.dge_repertoire_id AS repertoire_id, v.vge_nom_fichier AS nom_fichier, v.vge_type_mime AS type_mime, v.vge_taille AS taille
            FROM document_ged g
            CROSS JOIN LATERAL (SELECT w.vge_nom_fichier, w.vge_type_mime, w.vge_taille FROM version_ged w WHERE w.vge_document = g.dge_id ORDER BY w.vge_numero DESC LIMIT 1) v
            WHERE (g.dge_id = ANY(@d) OR (g.dge_type_element = 'crm_plan' AND g.dge_repertoire_id = ANY(@r)))
              AND NOT g.dge_supprime AND NOT g.dge_archive
              AND g.dge_confidentialite IN ('PUBLIC', 'INTERNE') AND cardinality(g.dge_acces_profils) = 0 AND cardinality(g.dge_acces_utilisateurs) = 0
            ORDER BY g.dge_titre, g.dge_id
            """, new NpgsqlParameter("d", documents), new NpgsqlParameter("r", repertoires)).ToListAsync(ct);
        // Plan sans fichier visible (indice sans pièce, ou pièces confidentielles) : absent.
        var lus = enVigueur.Select(x => (Source: x.Plan, Lu: new PlanTerrain(x.Plan.Id, x.Plan.Repere, x.Plan.Nom, x.Plan.Lot, x.Indice.Indice, x.Plan.Terrain, x.Plan.TypeElement,
                fichiers.Where(f => f.Id == x.Indice.DgeId || (x.Indice.RgeId is long r && f.RepertoireId == r))
                    .Select(f => new FichierPlanTerrain(f.Id, f.Titre, f.NomFichier, f.TypeMime, f.Taille)).ToList())))
            .Where(x => x.Lu.Fichiers.Count > 0).ToList();
        foreach (var (tache, elements) in parTache)
        {
            var siens = lus.Where(x => elements.Contains((x.Source.TypeElement, x.Source.IdElement))).Select(x => x.Lu).ToList();
            if (siens.Count > 0) res[tache] = siens;
        }
        return res;
    }

    /// <summary>Contenu d'un fichier d'un plan en vigueur d'une tâche de la personne (30 jours autour d'aujourd'hui).</summary>
    private static RouteGroupBuilder MapPlansTerrain(this RouteGroupBuilder g)
    {
        g.MapGet("/plans/{id:long}", async (long id, bool? telecharger, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var s = await ComptesBtp.SalarieAsync(db, u.Code, ct) ?? throw ExceptionMetier.Introuvable($"Plan {id}");
            var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
            var plans = await PlansTachesAsync(http.RequestServices, db, s, aujourdhui.AddDays(-30), aujourdhui.AddDays(30), ct);
            if (!plans.Values.SelectMany(l => l).Any(p => p.Fichiers.Any(f => f.Id == id))) throw ExceptionMetier.Introuvable($"Plan {id}");
            var version = await db.Database.SqlQueryRaw<long?>(
                "SELECT (SELECT w.vge_id FROM version_ged w WHERE w.vge_document = @d ORDER BY w.vge_numero DESC LIMIT 1) AS \"Value\"", new NpgsqlParameter("d", id))
                .FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Plan {id}");
            return await ged.Contenu(version, telecharger == true, http, u, ct);
        });
        return g;
    }
}
