using LogiBTP.Planning.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Liaisons croisées entre modules facultatifs (étape 6 de l'analyse transverse), portées par le cœur qui les connaît
/// tous : planning théorique d'un chantier depuis son parcours d'exécution (une tâche par étape, heures budget du
/// service, dépendances fin → début depuis les étapes amont), tâche du planning depuis un ordre et proposition de dates à
/// l'ordre (P15 : l'ordre garde ses dates tant que la proposition n'est pas acceptée), heures réalisées (pointages
/// retenus) d'une tâche du planning.
/// </summary>
public static class LiaisonsBtp
{
    private sealed record Etape(string Code, string? Libelle, int? SrvId, string[] Amonts);
    private sealed record Ordre(long Id, string? Numero, int? ChantierId, int? SrvId, DateOnly? Debut, DateOnly? Fin, decimal? Heures, string? Objet);
    private sealed record Periode(DateTime? Debut, DateTime? Fin);

    public sealed record DemandeTheorique(string Debut);

    public static RouteGroupBuilder MapLiaisons(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/liaisons");

        // Planning théorique d'un chantier depuis son parcours (§ 6 « Planning théorique automatique »).
        g.MapPost("/chantiers/{id:int}/planning-theorique", async (int id, DemandeTheorique d, HttpContext http, LogiBtpContext db, ModulesSociete modules,
            ServicePlanning planning, ServiceLiens liens, CancellationToken ct) =>
        {
            if (!await modules.EstActifAsync("planning", ct) || !await modules.EstActifAsync("execution", ct))
                throw ExceptionMetier.Conflit("MODULE_INACTIF", "Modules Planning et Exécution nécessaires");
            var u = Utilisateur.Depuis(http);
            var etapes = await db.Database.SqlQueryRaw<Etape>("""
                SELECT e.pee_code AS code, e.pee_libelle AS libelle, e.pee_srv_id AS srv_id, e.pee_amonts AS amonts
                FROM exe_parcours p JOIN exe_parcours_element_etape e ON e.pee_par_id = p.par_id
                WHERE p.par_type_element = 'chantier' AND p.par_id_element = @c
                ORDER BY e.pee_ordre
                """, new NpgsqlParameter("c", id.ToString())).ToListAsync(ct);
            if (etapes.Count == 0) throw ExceptionMetier.Invalide("PARCOURS_ABSENT", "Le chantier n'a pas de parcours d'exécution");
            var budgets = await db.Database.SqlQueryRaw<BudgetPlanning>("""
                SELECT 'chantier' AS type, chantier_id::text AS id, srv_id, round(heures * 60)::int AS minutes FROM v_heures_budget_chantier WHERE chantier_id = @c AND srv_id IS NOT NULL
                """, new NpgsqlParameter("c", id)).ToListAsync(ct);
            var parCode = new Dictionary<string, long>();
            var debut = d.Debut;
            foreach (var e in etapes)
            {
                var heures = budgets.FirstOrDefault(b => b.SrvId == e.SrvId)?.Minutes is int m && m > 0 ? m : 420;
                var tache = await planning.CreerIdAsync(new TacheSaisie(1, debut, null, heures, 1, e.SrvId, "chantier", id.ToString(), e.Libelle ?? e.Code, [],
                    "parcours", e.Code), u, ct);
                parCode[e.Code] = tache;
                var amonts = e.Amonts.Where(parCode.ContainsKey).Select(a => new DependanceSaisie(parCode[a], "FD", 0, "OUV", "FIXE")).ToList();
                if (amonts.Count > 0) await liens.EnregistrerDependancesAsync(tache, amonts, u, ct);
            }
            return new { taches = parCode.Values };
        });

        // Ordre → tâche théorique du planning (origine ordre : heures MO de l'ordre, service et dates prévues de l'ordre).
        g.MapPost("/ordres/{id:long}/planifier", async (long id, HttpContext http, LogiBtpContext db, ModulesSociete modules, ServicePlanning planning, CancellationToken ct) =>
        {
            if (!await modules.EstActifAsync("planning", ct)) throw ExceptionMetier.Conflit("MODULE_INACTIF", "Module Planning nécessaire");
            var o = await OrdreAsync(db, id, ct);
            if (o.ChantierId is null) throw ExceptionMetier.Invalide("EXE_CHANTIER", "Ordre sans chantier");
            var jour = o.Debut ?? DateOnly.FromDateTime(DateTime.Today.AddDays(1));
            var debut = jour.ToString("yyyy-MM-dd") + "T08:00";
            var heures = Math.Max(15, (int)Math.Round((o.Heures ?? 7) * 60));
            // Dates prévues de l'ordre : charge ventilée entre elles (mode 3) ; sinon mode 1 avec assez de ressources
            // théoriques pour tenir en quatre semaines (20 jours de 7 h).
            var saisie = o.Fin is DateOnly f && f >= jour
                ? new TacheSaisie(3, debut, f.AddDays(1).ToString("yyyy-MM-dd") + "T00:00", heures, 1, o.SrvId, "chantier", o.ChantierId.ToString(), o.Numero ?? o.Objet ?? $"Ordre {id}", [], "ordre", id.ToString())
                : new TacheSaisie(1, debut, null, heures, Math.Max(1, (int)Math.Ceiling(heures / 8400d)), o.SrvId, "chantier", o.ChantierId.ToString(), o.Numero ?? o.Objet ?? $"Ordre {id}", [], "ordre", id.ToString());
            var t = await planning.CreerIdAsync(saisie, Utilisateur.Depuis(http), ct);
            return await planning.TacheAsync(t, ct);
        });

        // Dates proposées par le planning à l'ordre (P15) : début le plus tôt et fin la plus tardive de ses tâches.
        g.MapGet("/ordres/{id:long}/proposition", async (long id, LogiBtpContext db, ModulesSociete modules, CancellationToken ct) =>
        {
            var o = await OrdreAsync(db, id, ct);
            if (!await modules.EstActifAsync("planning", ct)) return Results.Ok(new { taches = 0 });
            var p = await db.Database.SqlQueryRaw<Periode>("""
                SELECT min(tac_debut) AS debut, max(tac_fin) AS fin FROM pla_tache WHERE tac_origine_type = 'ordre' AND tac_origine_id = @o
                """, new NpgsqlParameter("o", id.ToString())).FirstAsync(ct);
            var n = await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM pla_tache WHERE tac_origine_type = 'ordre' AND tac_origine_id = @o",
                new NpgsqlParameter("o", id.ToString())).FirstAsync(ct);
            var debut = p.Debut is DateTime a ? DateOnly.FromDateTime(a) : (DateOnly?)null;
            var fin = p.Fin is DateTime b ? DateOnly.FromDateTime(b.AddMinutes(-1)) : (DateOnly?)null;
            return Results.Ok(new { taches = n, debut, fin, debut_ordre = o.Debut, fin_ordre = o.Fin, ecart = n > 0 && (debut != o.Debut || fin != o.Fin) });
        });

        // Acceptation de la proposition : dates prévues de l'ordre mises à jour (historique de l'exécution).
        g.MapPost("/ordres/{id:long}/proposition/accepter", async (long id, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var p = await db.Database.SqlQueryRaw<Periode>("""
                SELECT min(tac_debut) AS debut, max(tac_fin) AS fin FROM pla_tache WHERE tac_origine_type = 'ordre' AND tac_origine_id = @o
                """, new NpgsqlParameter("o", id.ToString())).FirstAsync(ct);
            if (p.Debut is not DateTime debut || p.Fin is not DateTime fin) throw ExceptionMetier.Invalide("PLANNING_SANS_TACHE", "Aucune tâche du planning pour cet ordre");
            await db.Database.ExecuteSqlRawAsync("""
                UPDATE document SET ent_debut_prevu = @d, ent_fin_prevue = @f WHERE ent_id = @o;
                INSERT INTO ordre_execution_historique (oeh_ent_id, oeh_etat, oeh_detail, oeh_par) SELECT ent_id, coalesce(ent_exe_etat, 'A_FAIRE'), 'dates proposées par le planning acceptées', @u FROM document WHERE ent_id = @o
                """, [new NpgsqlParameter("d", DateOnly.FromDateTime(debut)), new NpgsqlParameter("f", DateOnly.FromDateTime(fin.AddMinutes(-1))),
                new NpgsqlParameter("o", id), new NpgsqlParameter("u", Utilisateur.Depuis(http).Code)], ct);
            return Results.NoContent();
        });

        // Heures réalisées d'une tâche du planning : pointages retenus de ses ressources sur son chantier pendant sa période.
        g.MapGet("/taches/{id:long}/realise", async (long id, LogiBtpContext db, ModulesSociete modules, CancellationToken ct) =>
        {
            if (!await modules.EstActifAsync("pointage", ct)) return Results.Ok(new { minutes = (int?)null });
            var m = await db.Database.SqlQueryRaw<int?>("""
                SELECT sum(p.minutes)::int AS "Value"
                FROM pla_tache t
                JOIN pla_affectation a ON a.aff_tac_id = t.tac_id AND a.aff_res_type IN ('SALARIE', 'INTERIM')
                JOIN v_pointages_retenus p ON p.sal_id::text = a.aff_res_id AND p.chantier_id::text = t.tac_id_element
                     AND p.date_pointage >= t.tac_debut::date AND p.date_pointage <= t.tac_fin::date
                WHERE t.tac_id = @t AND t.tac_type_element = 'chantier'
                """, new NpgsqlParameter("t", id)).FirstOrDefaultAsync(ct);
            return Results.Ok(new { minutes = m ?? 0 });
        });
        return g;
    }

    private static async Task<Ordre> OrdreAsync(LogiBtpContext db, long id, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<Ordre>("""
            SELECT d.ent_id AS id, d.ent_numero AS numero, d.ent_chantier_id AS chantier_id, d.ent_srv_id AS srv_id, d.ent_debut_prevu AS debut, d.ent_fin_prevue AS fin,
                   (SELECT sum(h.heures) FROM v_heures_lignes h WHERE h.ent_id = d.ent_id) AS heures, d.ent_objet AS objet
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @o AND t.tyd_famille = 'E'
            """, new NpgsqlParameter("o", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Ordre {id}");
}
