using System.Text.Json;
using LogiBTP.Crm.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>Exécution d'un ordre saisie (état, motif, commentaire, service, responsable, dates prévues).</summary>
public sealed record ExecutionSaisie(string? Etat, int? MotifId, string? Commentaire, int? SrvId, long? ResponsableId, DateOnly? DebutPrevu, DateOnly? FinPrevue);

/// <summary>
/// Module Exécution, lot 1 (db/197 ; ANALYSE-MODULE-EXECUTION.md) : ordres = documents de la famille E. État d'exécution
/// et motif de blocage (obligatoire pour bloquer ; tâche du CRM au service du motif si le module est actif), service,
/// responsable et dates prévues, modifiables même sur un ordre validé (historique) ; budget de l'ordre d'exécution (vendu,
/// référence, planifié) ; répartition des quantités d'un ordre suivant (quantité de l'ordre parent, déjà réparti dans
/// les ordres du même type, reste : E3, E17). Routes : <c>/api/execution/*</c>.
/// </summary>
public static class ExecutionBtp
{
    public static readonly string[] Etats = ["A_FAIRE", "EN_ATTENTE", "EN_COURS", "BLOQUE", "TERMINE"];

    private static NpgsqlParameter P(string nom, object? valeur, NpgsqlDbType type) => new(nom, type) { Value = valeur ?? DBNull.Value };

    private sealed record LigneOrdre(long EntId, long GroupeId, string TydCode, string Famille, string StdCode, int? ChantierId, string? Numero, string? Objet,
        string? EntExeEtat, int? EntExeMotifId);

    private static async Task<LigneOrdre> OrdreAsync(LogiBtpContext db, long id, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<LigneOrdre>("""
            SELECT d.ent_id, coalesce(d.ent_groupe_id, d.ent_id) AS groupe_id, t.tyd_code, t.tyd_famille AS famille, s.std_code, d.ent_chantier_id AS chantier_id,
                   d.ent_numero AS numero, d.ent_objet AS objet, d.ent_exe_etat, d.ent_exe_motif_id
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id WHERE d.ent_id = @id
            """, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");

    /// <summary>Exécution d'un ordre : champs, historique, heures par service ; budget pour un ordre d'exécution.</summary>
    public static async Task<IResult> LireAsync(LogiBtpContext db, long id, CancellationToken ct)
    {
        var o = await OrdreAsync(db, id, ct);
        if (o.Famille != "E") throw ExceptionMetier.Invalide("EXE_FAMILLE", "Ce document n'est pas un ordre d'exécution");
        var json = await db.Database.SqlQueryRaw<string>("""
            SELECT json_build_object(
              'etat', coalesce(d.ent_exe_etat, 'A_FAIRE'), 'motif_id', d.ent_exe_motif_id, 'commentaire', d.ent_exe_commentaire, 'srv_id', d.ent_srv_id,
              'responsable_id', d.ent_responsable_id, 'debut_prevu', d.ent_debut_prevu, 'fin_prevue', d.ent_fin_prevue,
              'historique', (SELECT coalesce(json_agg(json_build_object('etat', h.oeh_etat, 'motif', m.mot_libelle, 'commentaire', h.oeh_commentaire, 'detail', h.oeh_detail,
                                'par', h.oeh_par, 'le', h.oeh_le) ORDER BY h.oeh_le DESC), '[]')
                             FROM ordre_execution_historique h LEFT JOIN motif m ON m.mot_id = h.oeh_motif_id WHERE h.oeh_ent_id = d.ent_id),
              'heures', (SELECT coalesce(json_agg(json_build_object('srv_id', x.srv_id, 'service', sv.srv_libelle, 'heures', x.heures) ORDER BY sv.srv_ordre), '[]')
                           FROM (SELECT srv_id, sum(heures) AS heures FROM v_heures_lignes WHERE ent_id = d.ent_id GROUP BY srv_id) x LEFT JOIN service sv ON sv.srv_id = x.srv_id),
              'heures_realisees', CASE WHEN f_module_actif('pointage') THEN (SELECT sum(heures) FROM v_heures_realisees_ordre WHERE ent_id = d.ent_id)
                                       ELSE (SELECT sum(lig_heures_realisees) FROM document_ligne WHERE lig_ent_id = d.ent_id) END
            )::text AS "Value"
            FROM document d WHERE d.ent_id = @id
            """, new NpgsqlParameter("id", id)).FirstAsync(ct);
        var reponse = JsonSerializer.Deserialize<Dictionary<string, object?>>(json)!;
        if (o.TydCode == "E_OE") reponse["budget"] = await BudgetAsync(db, o, ct);
        return Results.Json(reponse);
    }

    private sealed record Totaux(decimal? Pr, decimal? Ht, decimal? Heures);

    /// <summary>
    /// Budget de l'OE (E16) : vendu (commandes sources validées : PV HT, PR, heures), planifié (l'OE tel qu'enregistré),
    /// référence (instantané de la première validation) et versions validées.
    /// </summary>
    private static async Task<object> BudgetAsync(LogiBtpContext db, LigneOrdre o, CancellationToken ct)
    {
        const string Somme = """
            SELECT sum(l.lig_montant_pr) AS pr, sum(CASE WHEN l.lig_parent_id IS NULL OR p.lig_tyl_id <> 2 THEN l.lig_montant_ht END) AS ht,
                   (SELECT sum(h.heures) FROM v_heures_lignes h WHERE h.ent_id = ANY(@ids)) AS heures
            FROM document_ligne l LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
            WHERE l.lig_ent_id = ANY(@ids) AND l.lig_tyl_id IN (2, 3) AND coalesce(l.lig_type_prix, 'V') = 'V'
              AND (l.lig_parent_id IS NULL OR p.lig_tyl_id <> 2)
            """;
        var sources = await db.Database.SqlQueryRaw<long>("""
            SELECT DISTINCT l.lie_source_ent_id AS "Value" FROM document_lien l JOIN document s ON s.ent_id = l.lie_source_ent_id
            WHERE l.lie_cible_ent_id = @id AND l.lie_type = 'TRANSFORMATION' AND s.ent_verrouille
            """, new NpgsqlParameter("id", o.EntId)).ToListAsync(ct);
        var vendu = sources.Count == 0 ? null : await db.Database.SqlQueryRaw<Totaux>(Somme, new NpgsqlParameter("ids", sources.ToArray())).FirstAsync(ct);
        var planifie = await db.Database.SqlQueryRaw<Totaux>(Somme, new NpgsqlParameter("ids", new[] { o.EntId })).FirstAsync(ct);
        var versions = await db.Database.SqlQueryRaw<string>("""
            SELECT coalesce(json_agg(json_build_object('ent_id', obu_ent_id, 'reference', obu_reference, 'pr', obu_total_pr, 'ht', obu_total_ht,
              'heures', obu_heures, 'par', obu_par, 'le', obu_le) ORDER BY obu_le), '[]')::text AS "Value"
            FROM ordre_budget WHERE obu_groupe_id = @g
            """, new NpgsqlParameter("g", o.GroupeId)).FirstAsync(ct);
        return new { vendu, planifie, versions = JsonSerializer.Deserialize<JsonElement>(versions) };
    }

    /// <summary>
    /// Modification de l'exécution d'un ordre : état connu, motif obligatoire pour bloquer (le motif n'est gardé que
    /// pour un ordre bloqué), ordre ni annulé ni remplacé ; historique ; blocage : tâche du CRM au service du motif.
    /// </summary>
    public static async Task<IResult> EnregistrerAsync(LogiBtpContext db, IServiceProvider services, long id, ExecutionSaisie s, Utilisateur u, CancellationToken ct)
    {
        var o = await OrdreAsync(db, id, ct);
        if (o.Famille != "E") throw ExceptionMetier.Invalide("EXE_FAMILLE", "Ce document n'est pas un ordre d'exécution");
        if (o.StdCode is "ANNULE" or "REMPLACE") throw ExceptionMetier.Conflit("EXE_CLOS", "Ordre annulé ou remplacé : exécution non modifiable");
        var etat = s.Etat ?? o.EntExeEtat ?? "A_FAIRE";
        if (!Etats.Contains(etat)) throw ExceptionMetier.Invalide("EXE_ETAT", $"État inconnu : {etat}");
        if (etat == "BLOQUE" && s.MotifId is null) throw ExceptionMetier.Invalide("EXE_MOTIF", "Motif obligatoire pour bloquer un ordre");
        if (s.DebutPrevu is { } d && s.FinPrevue is { } f && f < d) throw ExceptionMetier.Invalide("EXE_DATES", "Fin prévue avant le début");
        var motif = etat == "BLOQUE" ? s.MotifId : null;
        var bloque = etat == "BLOQUE" && (o.EntExeEtat != "BLOQUE" || o.EntExeMotifId != motif);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE document SET ent_exe_etat = @e, ent_exe_motif_id = @m, ent_exe_commentaire = @c, ent_srv_id = @s, ent_responsable_id = @r,
              ent_debut_prevu = @d, ent_fin_prevue = @f WHERE ent_id = @id
            """,
            [
                new NpgsqlParameter("e", etat), P("m", motif, NpgsqlDbType.Integer), P("c", s.Commentaire, NpgsqlDbType.Text), P("s", s.SrvId, NpgsqlDbType.Integer),
                P("r", s.ResponsableId, NpgsqlDbType.Bigint), P("d", s.DebutPrevu, NpgsqlDbType.Date), P("f", s.FinPrevue, NpgsqlDbType.Date), new NpgsqlParameter("id", id),
            ], ct);
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO ordre_execution_historique (oeh_ent_id, oeh_etat, oeh_motif_id, oeh_commentaire, oeh_detail, oeh_par)
            VALUES (@id, @e, @m, @c, @det, @u)
            """,
            [
                new NpgsqlParameter("id", id), new NpgsqlParameter("e", etat), P("m", motif, NpgsqlDbType.Integer), P("c", s.Commentaire, NpgsqlDbType.Text),
                P("det", etat != (o.EntExeEtat ?? "A_FAIRE") ? $"{o.EntExeEtat ?? "A_FAIRE"} → {etat}" : "affectation, dates ou commentaire", NpgsqlDbType.Varchar),
                new NpgsqlParameter("u", u.Code),
            ], ct);
        await tx.CommitAsync(ct);
        // Blocage : tâche à prendre par le service du motif (module CRM actif), rattachée à l'ordre (groupe d'indices).
        if (bloque && await services.GetRequiredService<ModulesSociete>().EstActifAsync("crm", ct))
        {
            var srv = await db.Database.SqlQueryRaw<int?>("SELECT mot_srv_id AS \"Value\" FROM motif WHERE mot_id = @m", new NpgsqlParameter("m", motif!.Value)).FirstOrDefaultAsync(ct);
            var libelle = await db.Database.SqlQueryRaw<string>("SELECT mot_libelle AS \"Value\" FROM motif WHERE mot_id = @m", new NpgsqlParameter("m", motif.Value)).FirstAsync(ct);
            if (srv is int service)
            {
                var liens = new List<LienSaisi> { new("document", o.GroupeId.ToString(), true) };
                if (o.ChantierId is int cha) liens.Add(new LienSaisi("chantier", cha.ToString()));
                // Le blocage est enregistré : une tâche impossible à créer est signalée au journal sans annuler le blocage.
                try
                {
                    await services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie("TACHE", "A_FAIRE", null, service,
                        $"Ordre {o.Numero ?? o.EntId.ToString()} bloqué : {libelle}", s.Commentaire is null ? null : $"<p>{System.Net.WebUtility.HtmlEncode(s.Commentaire)}</p>",
                        null, DateTimeOffset.UtcNow.AddDays(3), null, false, false, false, liens, null), u, ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    services.GetRequiredService<ILoggerFactory>().CreateLogger("Execution").LogWarning(e, "Tâche du CRM non créée pour l'ordre {Ordre}", o.EntId);
                }
            }
        }
        return await LireAsync(db, id, ct);
    }

    /// <summary>
    /// Répartition des lignes d'un ordre suivant (E3, E17) : pour chaque ligne reprise d'un ordre, la ligne parente
    /// (quantité, PR, heures), ce qui en est déjà réparti dans les autres ordres du même type (brouillons compris, hors
    /// annulés et remplacés), le reste et le nombre d'ordres ; dépassement signalé.
    /// </summary>
    public static async Task<IResult> RepartitionAsync(LogiBtpContext db, long id, CancellationToken ct) =>
        Results.Content(await db.Database.SqlQueryRaw<string>("""
            WITH cible AS (SELECT d.ent_id, d.ent_tyd_id FROM document d WHERE d.ent_id = @id),
            lignes AS (
                SELECT l.lig_id, x.lil_source_lig_id AS source_lig_id, coalesce(l.lig_qte_totale, l.lig_qte_vendue, 0) AS qte
                FROM document_ligne l JOIN document_ligne_lien x ON x.lil_cible_lig_id = l.lig_id
                JOIN document_ligne sl ON sl.lig_id = x.lil_source_lig_id
                -- Ligne de l'ordre parent seulement (pas les lignes d'origine plus anciennes : commande, devis).
                WHERE l.lig_ent_id = @id AND sl.lig_ent_id IN (SELECT lie_source_ent_id FROM document_lien WHERE lie_cible_ent_id = @id AND lie_type = 'TRANSFORMATION')),
            sources AS (
                SELECT s.lig_id, s.lig_ent_id, coalesce(s.lig_qte_totale, s.lig_qte_vendue, 0) AS qte, s.lig_montant_pr AS montant_pr, s.lig_unt_code AS unite,
                       ts.tyd_code AS type_source, ds.ent_numero AS numero_source,
                       (SELECT sum(h.heures) FROM v_heures_lignes h WHERE h.lig_id = s.lig_id) AS heures
                FROM document_ligne s JOIN document ds ON ds.ent_id = s.lig_ent_id JOIN type_document ts ON ts.tyd_id = ds.ent_tyd_id
                WHERE s.lig_id IN (SELECT source_lig_id FROM lignes)),
            reparti AS (
                SELECT x.lil_source_lig_id AS source_lig_id, sum(coalesce(c.lig_qte_totale, c.lig_qte_vendue, 0)) AS qte, count(DISTINCT dc.ent_id) AS nb
                FROM document_ligne_lien x
                JOIN document_ligne c ON c.lig_id = x.lil_cible_lig_id
                JOIN document dc ON dc.ent_id = c.lig_ent_id
                JOIN statut_document sc ON sc.std_id = dc.ent_std_id
                WHERE x.lil_source_lig_id IN (SELECT source_lig_id FROM lignes) AND dc.ent_tyd_id = (SELECT ent_tyd_id FROM cible)
                  AND dc.ent_id <> @id AND sc.std_code NOT IN ('ANNULE', 'REMPLACE')
                GROUP BY 1)
            SELECT coalesce(json_agg(json_build_object('lig_id', l.lig_id, 'source_lig_id', s.lig_id, 'type_source', s.type_source, 'numero_source', s.numero_source,
                     'source_ent_id', s.lig_ent_id, 'qte_source', s.qte, 'unite', s.unite, 'montant_pr_source', s.montant_pr, 'heures_source', s.heures,
                     'deja_reparti', coalesce(r.qte, 0), 'nb_ordres', coalesce(r.nb, 0), 'qte', l.qte, 'reste', s.qte - coalesce(r.qte, 0) - l.qte,
                     'depassement', s.qte - coalesce(r.qte, 0) - l.qte < 0)), '[]')::text AS "Value"
            FROM lignes l JOIN sources s ON s.lig_id = l.source_lig_id LEFT JOIN reparti r ON r.source_lig_id = s.lig_id
            """, new NpgsqlParameter("id", id)).FirstAsync(ct), "application/json");

    /// <summary>Instantané du budget planifié d'un ordre d'exécution validé (le premier du groupe est la référence).</summary>
    public static async Task FigerBudgetAsync(DbContext db, long entId, string par, CancellationToken ct) =>
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO ordre_budget (obu_ent_id, obu_groupe_id, obu_reference, obu_total_pr, obu_total_ht, obu_heures, obu_lignes, obu_par)
            SELECT d.ent_id, coalesce(d.ent_groupe_id, d.ent_id),
                   NOT EXISTS (SELECT 1 FROM ordre_budget b WHERE b.obu_groupe_id = coalesce(d.ent_groupe_id, d.ent_id) AND b.obu_reference),
                   (SELECT sum(l.lig_montant_pr) FROM document_ligne l LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
                     WHERE l.lig_ent_id = d.ent_id AND l.lig_tyl_id IN (2, 3) AND coalesce(l.lig_type_prix, 'V') = 'V' AND (l.lig_parent_id IS NULL OR p.lig_tyl_id <> 2)),
                   (SELECT sum(l.lig_montant_ht) FROM document_ligne l LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
                     WHERE l.lig_ent_id = d.ent_id AND l.lig_tyl_id IN (2, 3) AND coalesce(l.lig_type_prix, 'V') = 'V' AND (l.lig_parent_id IS NULL OR p.lig_tyl_id <> 2)),
                   (SELECT sum(h.heures) FROM v_heures_lignes h WHERE h.ent_id = d.ent_id),
                   (SELECT coalesce(jsonb_agg(jsonb_build_object('lig_id', l.lig_id, 'parent_id', l.lig_parent_id, 'libelle', l.lig_libelle_brut, 'qte', l.lig_qte_totale,
                           'unite', l.lig_unt_code, 'nat_id', l.lig_nat_id, 'pr', l.lig_pr, 'montant_pr', l.lig_montant_pr, 'montant_ht', l.lig_montant_ht) ORDER BY l.lig_chemin), '[]')
                      FROM document_ligne l WHERE l.lig_ent_id = d.ent_id AND l.lig_tyl_id IN (1, 2, 3, 11)),
                   @par
            FROM document d WHERE d.ent_id = @id
            """, [new NpgsqlParameter("id", entId), new NpgsqlParameter("par", par)], ct);

    /// <summary>Type d'ordre paramétré (E25, E39) : activation, service par défaut, ordres non terminés.</summary>
    public sealed record TypeOrdre(string Code, string Libelle, bool Actif, int? SrvId, int EnCours);
    public sealed record TypeOrdreSaisi(bool Actif, int? SrvId);

    /// <summary>Ordres d'un type non terminés : ni soldés, ni annulés, ni remplacés, ni d'état d'exécution « terminé ».</summary>
    private const string EnCours = """
        (SELECT count(*)::int FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id
          WHERE d.ent_tyd_id = t.tyd_id AND d.ent_is_reference AND s.std_code NOT IN ('SOLDE', 'ANNULE', 'REMPLACE') AND coalesce(d.ent_exe_etat, '') <> 'TERMINE')
        """;

    /// <summary>Types de la famille E, actifs ou non (le paramétrage voit aussi les types désactivés).</summary>
    public static Task<List<TypeOrdre>> TypesAsync(LogiBtpContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<TypeOrdre>($"""
            SELECT t.tyd_code AS code, t.tyd_libelle AS libelle, t.tyd_actif AS actif, t.tyd_srv_id AS srv_id, {EnCours} AS en_cours
            FROM type_document t WHERE t.tyd_famille = 'E' ORDER BY t.tyd_id
            """).ToListAsync(ct);

    /// <summary>
    /// Activation et service par défaut d'un type d'ordre (administrateur). Désactivation refusée tant qu'un ordre du
    /// type n'est pas terminé (E39 : 409 <c>TYPE_ORDRE_EN_COURS</c>).
    /// </summary>
    public static async Task<List<TypeOrdre>> EnregistrerTypeAsync(LogiBtpContext db, string code, TypeOrdreSaisi s, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER_EXECUTION");
        var t = (await TypesAsync(db, ct)).FirstOrDefault(x => x.Code == code) ?? throw ExceptionMetier.Introuvable($"Type d'ordre {code}");
        if (t.Actif && !s.Actif && t.EnCours > 0)
        {
            throw ExceptionMetier.Conflit("TYPE_ORDRE_EN_COURS", $"{t.Libelle} : {t.EnCours} ordre(s) non terminé(s), le type ne peut pas être désactivé");
        }
        await db.Database.ExecuteSqlRawAsync("UPDATE type_document SET tyd_actif = @a, tyd_srv_id = @s WHERE tyd_code = @c AND tyd_famille = 'E'",
            [new NpgsqlParameter("a", s.Actif), P("s", s.SrvId, NpgsqlDbType.Integer), new NpgsqlParameter("c", code)], ct);
        return await TypesAsync(db, ct);
    }

    public static RouteGroupBuilder MapExecution(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/execution");
        g.MapGet("/types", (LogiBtpContext db, CancellationToken ct) => TypesAsync(db, ct));
        g.MapPut("/types/{code}", (string code, TypeOrdreSaisi s, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
            EnregistrerTypeAsync(db, code, s, Utilisateur.Depuis(http), ct));
        g.MapGet("/documents/{id:long}", (long id, LogiBtpContext db, CancellationToken ct) => LireAsync(db, id, ct));
        g.MapPut("/documents/{id:long}", (long id, ExecutionSaisie s, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
            EnregistrerAsync(db, http.RequestServices, id, s, Utilisateur.Depuis(http), ct));
        g.MapGet("/documents/{id:long}/repartition", (long id, LogiBtpContext db, CancellationToken ct) => RepartitionAsync(db, id, ct));
        // Heures budget d'un chantier par service (commandes validées ; natures MO → services).
        g.MapGet("/chantiers/{id:int}/heures", async (int id, LogiBtpContext db, CancellationToken ct) => Results.Content(await db.Database.SqlQueryRaw<string>("""
            SELECT coalesce(json_agg(json_build_object('srv_id', h.srv_id, 'service', s.srv_libelle, 'heures', h.heures) ORDER BY s.srv_ordre), '[]')::text AS "Value"
            FROM v_heures_budget_chantier h LEFT JOIN service s ON s.srv_id = h.srv_id WHERE h.chantier_id = @c
            """, new NpgsqlParameter("c", id)).FirstAsync(ct), "application/json"));
        return g;
    }
}
