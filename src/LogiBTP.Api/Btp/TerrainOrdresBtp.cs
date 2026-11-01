using System.Globalization;
using LogiBTP.Domaine;
using LogiBTP.Execution.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Planning.Web;
using LogiBTP.Pointage.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

public sealed record ValidationEtapeTerrain(long EntId, string Code);
public sealed record NonConformiteTerrain(string Motif, string? Commentaire);

/// <summary>
/// Application de terrain, lot 3 (ANALYSE-TERRAIN.md, T12, T13, T17) : ordres et étapes de la personne connectée
/// (mêmes ordres et même règle de validation que l'atelier, E46 et E51 ; jamais de contrôle du N+1), étape proposée après
/// un pointage sur un ordre (E52), avancement réel daté d'une tâche (module Planning, <c>pla_avancement</c>),
/// non-conformité signalée sur une tâche (tâche du CRM au service du motif, comme à la borne), photos d'une tâche
/// déposées dans la GED de son ordre, sinon de son chantier (catégorie photo, visibles dans le fil). Une tâche ne se
/// renseigne que par une personne qui y est affectée.
/// </summary>
public static partial class TerrainBtp
{
    private sealed record TacheTerrain(long Id, string Libelle, int? ChaId, long? EntId, string? TydCode, long? Groupe);

    /// <summary>Tâche @t à laquelle la personne @s est affectée, avec son chantier et son ordre d'origine (ordre ou étape).</summary>
    private const string SqlTacheAffectee = """
        SELECT t.tac_id AS id, t.tac_libelle AS libelle, c.cha_id, d.ent_id, ty.tyd_code, coalesce(d.ent_groupe_id, d.ent_id) AS groupe
        FROM pla_tache t
        LEFT JOIN chantier c ON t.tac_type_element = 'chantier' AND t.tac_id_element ~ '^[0-9]+$' AND c.cha_id = t.tac_id_element::int
        LEFT JOIN exe_ordre_etape e ON t.tac_origine_type = 'etape' AND e.ore_id::text = t.tac_origine_id
        LEFT JOIN document d ON d.ent_id = CASE WHEN t.tac_origine_type = 'ordre' AND t.tac_origine_id ~ '^[0-9]+$' THEN t.tac_origine_id::bigint ELSE e.ore_ordre_id END
        LEFT JOIN type_document ty ON ty.tyd_id = d.ent_tyd_id
        WHERE t.tac_id = @t AND EXISTS (SELECT 1 FROM pla_affectation a WHERE a.aff_tac_id = t.tac_id AND a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text)
        """;

    private static async Task<(int Salarie, TacheTerrain Tache)> TacheAsync(LogiBtpContext db, Utilisateur u, long id, CancellationToken ct)
    {
        var s = await ComptesBtp.SalarieAsync(db, u.Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
        var t = await db.Database.SqlQueryRaw<TacheTerrain>(SqlTacheAffectee, new NpgsqlParameter("t", id), new NpgsqlParameter("s", s)).FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Introuvable($"Tâche {id} de votre planning");
        return (s, t);
    }

    private static RouteGroupBuilder MapOrdresTerrain(this RouteGroupBuilder g)
    {
        // Ordres et étapes à valider (module Exécution actif) ; ?ordres=1,2 : ces ordres seulement (E52).
        g.MapGet("/etapes", async (string? numero, string? ordres, HttpContext http, LogiBtpContext db, ModulesSociete modules, ServiceEtapes etapes, CancellationToken ct) =>
        {
            if (!await modules.EstActifAsync(ModulesFacultatifs.Execution, ct)) return new { ordres = new List<object>() } as object;
            var s = await ComptesBtp.SalarieAsync(db, Utilisateur.Depuis(http).Code, ct) ?? throw ExceptionMetier.Invalide("TERRAIN_PERSONNE", "Compte sans salarié lié");
            var ids = (ordres ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(x => long.TryParse(x, out var v) ? v : 0).Where(v => v > 0).ToArray();
            var liste = ids.Length > 0 ? await AtelierBtp.OrdresParIdsAsync(db, s, ids, ct)
                : await AtelierBtp.OrdresAsync(db, s, string.IsNullOrWhiteSpace(numero) ? null : numero.Trim(), ct);
            return await AtelierBtp.ReponseAsync(etapes, liste, ct);
        });
        g.MapPost("/etapes/valider", async (ValidationEtapeTerrain v, HttpContext http, ModulesSociete modules, ServiceEtapes etapes, CancellationToken ct) =>
        {
            if (!await modules.EstActifAsync(ModulesFacultatifs.Execution, ct)) throw ExceptionMetier.Conflit("MODULE_INACTIF", "Module Exécution inactif");
            return await etapes.ActionAsync(v.EntId, v.Code, new ActionEtape("VALIDER"), Utilisateur.Depuis(http), ct);
        });

        // Avancement réel daté d'une tâche (T12) : relevés, saisie du jour.
        g.MapGet("/taches/{id:long}/avancements", async (long id, HttpContext http, LogiBtpContext db, ServicePlanning planning, CancellationToken ct) =>
        {
            await TacheAsync(db, Utilisateur.Depuis(http), id, ct);
            return await planning.AvancementsAsync(id, ct);
        });
        g.MapPost("/taches/{id:long}/avancement", async (long id, AvancementSaisi a, HttpContext http, LogiBtpContext db, ServicePlanning planning, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            await TacheAsync(db, u, id, ct);
            if (a.Date > DateOnly.FromDateTime(DateTime.Today)) throw ExceptionMetier.Invalide("TERRAIN_DATE", "Avancement d'un jour à venir");
            return await planning.EnregistrerAvancementAsync(id, a, u, ct);
        }).ExigeDroit("terrain/avancement", ActionsDroits.Creer);

        // Non-conformité signalée sur une tâche : tâche du CRM au service du motif (sinon de la personne).
        g.MapPost("/taches/{id:long}/non-conformite", async (long id, NonConformiteTerrain n, HttpContext http, LogiBtpContext db, IServiceProvider services, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var (s, t) = await TacheAsync(db, u, id, ct);
            if (string.IsNullOrWhiteSpace(n.Motif)) throw ExceptionMetier.Invalide("TERRAIN_MOTIF", "Motif de la non-conformité obligatoire");
            if (t.ChaId is not int cha) throw ExceptionMetier.Invalide("TERRAIN_CHANTIER", "Tâche sans chantier");
            var pdb = services.GetRequiredService<PointageDbContext>();
            var specialisation = services.GetRequiredService<SpecialisationPointage>();
            var salarie = (await specialisation.SalariesAsync(pdb, new FiltreSalaries(null, null, [s]), ct)).First();
            var motif = string.IsNullOrWhiteSpace(n.Commentaire) ? n.Motif.Trim() : $"{n.Motif.Trim()} — {n.Commentaire.Trim()}";
            await specialisation.ApresNonConformiteAsync(pdb, services, u, salarie, cha, t.EntId, motif, ct);
            return new { crm = await services.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.Crm, ct) };
        });

        // Photos d'une tâche (T17) : réduites ou non par l'appareil, déposées dans la GED de l'ordre, sinon du chantier.
        g.MapPost("/taches/{id:long}/photos", async (long id, HttpContext http, LogiBtpContext db, ServiceGed ged, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var (_, t) = await TacheAsync(db, u, id, ct);
            var (type, element) = t.EntId is not null && t.TydCode is not null ? (t.TydCode, t.Groupe!.Value.ToString(CultureInfo.InvariantCulture))
                : t.ChaId is int cha ? (TypesFiche.Chantier, cha.ToString(CultureInfo.InvariantCulture)) : throw ExceptionMetier.Invalide("TERRAIN_CHANTIER", "Tâche sans chantier");
            var form = await http.Request.ReadFormAsync(ct);
            var fichiers = form.Files.GetFiles("fichiers");
            if (fichiers.Count == 0) throw ExceptionMetier.Invalide("FICHIER", "Aucune photo");
            if (fichiers.Any(f => !(f.ContentType ?? "").StartsWith("image/", StringComparison.OrdinalIgnoreCase))) throw ExceptionMetier.Invalide("TERRAIN_PHOTO", "Images seulement");
            var commentaire = form["commentaire"].ToString();
            var deposees = new List<long>();
            foreach (var f in fichiers)
            {
                var d = await ged.DeposerFichier(f, new MetaDepot
                {
                    Titre = $"Photo · {t.Libelle} · {DateTime.Now:dd/MM/yyyy HH:mm}", Categorie = CategoriesGed.Photo, TypeElement = type, IdElement = element,
                    Resume = string.IsNullOrWhiteSpace(commentaire) ? null : commentaire.Trim(),
                }, u, ct);
                deposees.Add(d.Id);
            }
            return new { deposees };
        }).DisableAntiforgery();
        return g;
    }
}
