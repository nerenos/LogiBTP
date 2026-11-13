using System.Text.Json;
using LogiBTP.Domaine;
using LogiBTP.Execution.Web;
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
/// retenus) d'une tâche du planning ; planning théorique d'un ordre par ses étapes (§ 13.5 : tâche par état TACHE,
/// tâche de durée nulle par jalon, décalage des dépendances par attente, enchaînement depuis les ordres amont du parcours).
/// </summary>
public static class LiaisonsBtp
{
    private sealed record Etape(string Code, string? Libelle, int? SrvId, string[] Amonts);
    private sealed record Ordre(long Id, string? Numero, int? ChantierId, int? SrvId, DateOnly? Debut, DateOnly? Fin, decimal? Heures, string? Objet);
    private sealed record Periode(DateTime? Debut, DateTime? Fin);

    public sealed record DemandeTheorique(string Debut);
    private sealed record OrdreAmont(long Id, string Type);
    private sealed record Attente(string Chantier, DateOnly Debut, DateOnly Prevu, string Libelle, string? Numero);

    /// <summary>Date-heure d'une tâche du planning (« yyyy-MM-ddTHH:mm », culture invariante) : ce jour à cette heure.</summary>
    public static string DateHeure(DateOnly jour, int heure = 0) => LogiBTP.Planning.Temps.Ecrire(LogiBTP.Planning.Temps.VersMinutes(jour) + heure * 60);

    /// <summary>
    /// Chantiers du jour d'un salarié (paramètre <c>@s</c>) : chantiers des tâches du planning où il est affecté ce jour-là,
    /// module Planning actif ; colonne <c>cha_id</c>. Jour : <c>current_date</c> (<see cref="SqlChantiersDuJour"/>) ou
    /// paramètre <c>@d</c> (<see cref="SqlChantiersDuJourDate"/>) ; constantes, jamais composées à l'exécution.
    /// </summary>
    private const string SqlChantiersDuJourDebut = """
        SELECT DISTINCT t.tac_id_element::int AS cha_id
        FROM pla_tache t JOIN pla_affectation a ON a.aff_tac_id = t.tac_id
        WHERE f_module_actif('planning') AND t.tac_type_element = 'chantier' AND t.tac_id_element ~ '^[0-9]+$'
          AND a.aff_res_type IN ('SALARIE', 'INTERIM') AND a.aff_res_id = @s::text
        """;

    public const string SqlChantiersDuJour = SqlChantiersDuJourDebut + "\n  AND t.tac_debut < (current_date + 1) AND t.tac_fin > current_date";

    public const string SqlChantiersDuJourDate = SqlChantiersDuJourDebut + "\n  AND t.tac_debut < (@d::date + 1) AND t.tac_fin > @d::date";

    /// <summary>Minutes d'une étape de nature tâche : heures, jours ouvrés (7 h) ; jours calendaires : null (période).</summary>
    private static int? Minutes(EtapeOrdreEntite e) => e.OreUnite switch
    {
        "H" => Math.Max(15, (int)Math.Round(e.OreDuree * 60)),
        "OUV" => Math.Max(15, (int)Math.Round(e.OreDuree * 420)),
        _ => null,
    };

    /// <summary>Affectation du planning depuis la ressource principale (salarié, matériel, sous-traitant ; les autres : aucune).</summary>
    private static List<AffectationSaisie> Affectations(string? ressource)
    {
        if (ressource is null) return [];
        var r = JsonDocument.Parse(ressource).RootElement;
        var type = r.TryGetProperty("type", out var t) ? t.GetString() : null;
        var id = r.TryGetProperty("id", out var i) ? i.ToString() : null;
        return type is TypesRessource.Salarie or TypesRessource.Materiel or TypesRessource.SousTraitant && id is not null ? [new AffectationSaisie(type, id)] : [];
    }

    public static RouteGroupBuilder MapLiaisons(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/liaisons");

        // Planning théorique d'un chantier depuis son parcours (§ 6 « Planning théorique automatique »).
        g.MapPost("/chantiers/{id:int}/planning-theorique", async (int id, DemandeTheorique d, HttpContext http, LogiBtpContext db, ModulesSociete modules,
            ServicePlanning planning, ServiceLiens liens, CancellationToken ct) =>
        {
            if (!await modules.EstActifAsync(ModulesFacultatifs.Planning, ct) || !await modules.EstActifAsync(ModulesFacultatifs.Execution, ct))
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
                // Assez de ressources théoriques pour que l'étape tienne en deux semaines (10 jours de 7 h).
                var tache = await planning.CreerIdAsync(new TacheSaisie(1, debut, null, heures, Math.Max(1, (int)Math.Ceiling(heures / 4200d)), e.SrvId, TypesFiche.Chantier, id.ToString(), e.Libelle ?? e.Code, [],
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
            if (!await modules.EstActifAsync(ModulesFacultatifs.Planning, ct)) throw ExceptionMetier.Conflit("MODULE_INACTIF", "Module Planning nécessaire");
            var o = await OrdreAsync(db, id, ct);
            if (o.ChantierId is null) throw ExceptionMetier.Invalide("EXE_CHANTIER", "Ordre sans chantier");
            var jour = o.Debut ?? DateOnly.FromDateTime(DateTime.Today.AddDays(1));
            var debut = DateHeure(jour, 8);
            var heures = Math.Max(15, (int)Math.Round((o.Heures ?? 7) * 60));
            // Dates prévues de l'ordre : charge ventilée entre elles (mode 3) ; sinon mode 1 avec assez de ressources
            // théoriques pour tenir en quatre semaines (20 jours de 7 h).
            var saisie = o.Fin is DateOnly f && f >= jour
                ? new TacheSaisie(3, debut, DateHeure(f.AddDays(1)), heures, 1, o.SrvId, TypesFiche.Chantier, o.ChantierId.ToString(), o.Numero ?? o.Objet ?? $"Ordre {id}", [], "ordre", id.ToString())
                : new TacheSaisie(1, debut, null, heures, Math.Max(1, (int)Math.Ceiling(heures / 8400d)), o.SrvId, TypesFiche.Chantier, o.ChantierId.ToString(), o.Numero ?? o.Objet ?? $"Ordre {id}", [], "ordre", id.ToString());
            var t = await planning.CreerIdAsync(saisie, Utilisateur.Depuis(http), ct);
            return await planning.TacheAsync(t, ct);
        });

        // Dates proposées par le planning à l'ordre (P15) : début le plus tôt et fin la plus tardive de ses tâches.
        g.MapGet("/ordres/{id:long}/proposition", async (long id, LogiBtpContext db, ModulesSociete modules, CancellationToken ct) =>
        {
            var o = await OrdreAsync(db, id, ct);
            if (!await modules.EstActifAsync(ModulesFacultatifs.Planning, ct)) return Results.Ok(new { taches = 0 });
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

        // Planning théorique d'un ordre par ses étapes (§ 13.5) : étapes sans tâche planifiées, attentes en décalage,
        // première étape après les dernières étapes planifiées des ordres amont (parcours du chantier).
        g.MapPost("/ordres/{id:long}/planifier-etapes", async (long id, HttpContext http, LogiBtpContext db, ModulesSociete modules, ServicePlanning planning,
            ServiceLiens liens, ServiceEtapes etapes, CancellationToken ct) =>
        {
            if (!await modules.EstActifAsync(ModulesFacultatifs.Planning, ct)) throw ExceptionMetier.Conflit("MODULE_INACTIF", "Module Planning nécessaire");
            var u = Utilisateur.Depuis(http);
            var o = await OrdreAsync(db, id, ct);
            if (o.ChantierId is null) throw ExceptionMetier.Invalide("EXE_CHANTIER", "Ordre sans chantier");
            var liste = (await etapes.EtapesOrdreAsync(id, ct)).Where(e => e.OreValideLe is null).OrderBy(e => e.OreOrdre).ToList();
            if (liste.Count == 0) throw ExceptionMetier.Invalide("ETAPES_ABSENTES", "Aucune étape à planifier");
            var ressourceOrdre = await db.Database.SqlQueryRaw<string?>("SELECT ent_ressource::text AS \"Value\" FROM document WHERE ent_id = @o",
                new NpgsqlParameter("o", id)).FirstOrDefaultAsync(ct);
            var toutes = await etapes.EtapesOrdreAsync(id, ct);
            var parCode = toutes.ToDictionary(e => e.OreCode);
            // Prédécesseurs : amonts de l'étape, sinon la précédente (même règle que ReglesEtapes).
            List<string> Preds(EtapeOrdreEntite e)
            {
                if (e.OreAmonts is { } a) return a.Where(parCode.ContainsKey).ToList();
                var prec = toutes.Where(x => x.OreOrdre < e.OreOrdre).OrderByDescending(x => x.OreOrdre).FirstOrDefault();
                return prec is null ? [] : [prec.OreCode];
            }
            // Tâches amont d'une étape à travers les attentes : (tâche, décalage cumulé en jours, unité).
            List<(long Tache, int Decalage, string Unite)> Amont(EtapeOrdreEntite e, int profondeur = 0)
            {
                var res = new List<(long, int, string)>();
                if (profondeur > 30) return res;
                foreach (var p in Preds(e).Select(c => parCode[c]))
                {
                    if (p.OreNature == "ATTENTE")
                    {
                        var jours = (int)Math.Ceiling(p.OreUnite == "H" ? p.OreDuree / 7 : p.OreDuree);
                        var unite = p.OreUnite == "CAL" ? "CAL" : "OUV";
                        res.AddRange(Amont(p, profondeur + 1).Select(x => (x.Tache, x.Decalage + jours, unite)));
                    }
                    else if (p.OreTacId is long t) res.Add((t, 0, "OUV"));
                    else res.AddRange(Amont(p, profondeur + 1));
                }
                return res;
            }
            // Ordres amont du parcours : dernière tâche d'étape de chaque ordre du chantier dont le type est en amont.
            var amontsOrdre = await db.Database.SqlQueryRaw<long>("""
                SELECT e.ore_tac_id AS "Value"
                FROM exe_parcours p
                JOIN exe_parcours_element_etape cur ON cur.pee_par_id = p.par_id AND cur.pee_type_ordre = @type
                JOIN exe_parcours_element_etape am ON am.pee_par_id = p.par_id AND am.pee_code = ANY(cur.pee_amonts)
                JOIN type_document t ON t.tyd_code = am.pee_type_ordre
                JOIN document d ON d.ent_tyd_id = t.tyd_id AND d.ent_chantier_id = @c AND d.ent_is_reference AND d.ent_id <> @o
                JOIN LATERAL (SELECT x.ore_tac_id FROM exe_ordre_etape x WHERE x.ore_ordre_id = d.ent_id AND x.ore_tac_id IS NOT NULL ORDER BY x.ore_ordre DESC LIMIT 1) e ON TRUE
                WHERE p.par_type_element = 'chantier' AND p.par_id_element = @cs
                """, new NpgsqlParameter("type", await TypesDocumentBtp.CodeAsync(db, id, ct)),
                new NpgsqlParameter("c", o.ChantierId.Value), new NpgsqlParameter("o", id), new NpgsqlParameter("cs", o.ChantierId.Value.ToString())).ToListAsync(ct);
            var creees = new List<long>();
            var premiere = true;
            foreach (var e in liste.Where(e => e.OreNature != "ATTENTE" && e.OreTacId is null))
            {
                var jour = e.OreDebutLe ?? DateOnly.FromDateTime(DateTime.Today);
                var debut = DateHeure(jour, 8);
                var libelle = $"{o.Numero ?? $"Ordre {id}"} · {e.OreLibelle}";
                var affs = Affectations(e.OreRessource ?? ressourceOrdre);
                TacheSaisie saisie;
                if (e.OreNature == "JALON") saisie = new TacheSaisie(2, debut, debut, null, 1, e.OreSrvId ?? o.SrvId, TypesFiche.Chantier, o.ChantierId.ToString(), libelle, affs, "etape", e.OreId.ToString());
                else if (Minutes(e) is int m)
                    saisie = new TacheSaisie(1, debut, null, m, 1, e.OreSrvId ?? o.SrvId, TypesFiche.Chantier, o.ChantierId.ToString(), libelle, affs, "etape", e.OreId.ToString());
                else
                    saisie = new TacheSaisie(2, debut, DateHeure(jour.AddDays((int)Math.Max(1, Math.Ceiling(e.OreDuree)))), null, 1, e.OreSrvId ?? o.SrvId,
                        TypesFiche.Chantier, o.ChantierId.ToString(), libelle, affs, "etape", e.OreId.ToString());
                var tache = await planning.CreerIdAsync(saisie with { Couleur = e.OreCouleur }, u, ct);
                e.OreTacId = tache;
                await etapes.LierTacheAsync(id, e.OreCode, tache, ct);
                creees.Add(tache);
                var deps = Amont(e).Select(x => new DependanceSaisie(x.Tache, "FD", x.Decalage, x.Unite, "FIXE")).ToList();
                if (premiere && deps.Count == 0) deps.AddRange(amontsOrdre.Select(t => new DependanceSaisie(t, "FD", 0, "OUV", "FIXE")));
                premiere = false;
                if (deps.Count > 0) await liens.EnregistrerDependancesAsync(tache, deps.DistinctBy(x => x.De).ToList(), u, ct);
            }
            return new { taches = creees };
        });

        // Avancement réel des tâches du chantier d'un marché, comparé aux situations par la fiche (T12) : moyenne pondérée
        // par les heures des tâches, une tâche sans relevé comptant pour 0. Chantier à plusieurs marchés (plan
        // terrain-suites, lot 21, TS20 a) : tâches du marché par leur origine (AvancementMarche).
        g.MapGet("/marches/{id:int}/avancement", async (int id, LogiBtpContext db, CancellationToken ct) =>
        {
            var marches = await db.Database.SqlQueryRaw<int>("""
                SELECT count(*)::int AS "Value" FROM marche x JOIN marche m ON m.mar_cha_id = x.mar_cha_id WHERE m.mar_id = @m
                """, new NpgsqlParameter("m", id)).FirstAsync(ct);
            var taches = await db.Database.SqlQueryRaw<TacheAvancement>($"""
                {AvancementMarche.SqlTachesChantier}
                SELECT tac_id AS id, tac_libelle AS libelle, heures, pourcent, le, marche FROM t ORDER BY tac_id
                """, new NpgsqlParameter("m", id)).ToListAsync(ct);
            return AvancementMarche.Calculer(taches, id, marches);
        });

        // Attentes des étapes (séchage, validation d'un tiers) d'une période : bandes hachurées sur les lignes de chantier (E34).
        g.MapGet("/attentes", async (string du, string au, LogiBtpContext db, CancellationToken ct) =>
            (await db.Database.SqlQueryRaw<Attente>($"""
                SELECT d.ent_chantier_id::text AS chantier, e.ore_debut_le AS debut, e.ore_prevu_le AS prevu, e.ore_libelle AS libelle, d.ent_numero AS numero
                FROM exe_ordre_etape e JOIN document d ON d.ent_id = e.ore_ordre_id JOIN statut_document s ON s.std_id = d.ent_std_id
                WHERE e.ore_nature = 'ATTENTE' AND e.ore_valide_le IS NULL AND e.ore_debut_le IS NOT NULL AND e.ore_prevu_le IS NOT NULL
                  AND d.ent_chantier_id IS NOT NULL AND s.std_code NOT IN ({SqlBtp.HorsVigueur})
                  AND e.ore_prevu_le >= @du AND e.ore_debut_le <= @au
                """, new NpgsqlParameter("du", DateOnly.Parse(du[..10])), new NpgsqlParameter("au", DateOnly.Parse(au[..10]))).ToListAsync(ct))
            .Select(a => new { a.Chantier, debut = DateHeure(a.Debut), fin = DateHeure(a.Prevu.AddDays(1)), a.Libelle, a.Numero }));

        // Heures réalisées d'une tâche du planning : pointages retenus de ses ressources sur son chantier pendant sa période.
        g.MapGet("/taches/{id:long}/realise", async (long id, LogiBtpContext db, ModulesSociete modules, CancellationToken ct) =>
        {
            if (!await modules.EstActifAsync(ModulesFacultatifs.Pointage, ct)) return Results.Ok(new { minutes = (int?)null });
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
