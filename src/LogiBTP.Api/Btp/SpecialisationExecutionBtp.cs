using LogiBTP.Calendrier.Web;
using LogiBTP.Crm.Web;
using LogiBTP.Crm;
using LogiBTP.Planning.Web;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Execution;
using LogiBTP.Execution.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module Exécution par le cœur : services de l'entreprise (db/193), chantiers suivis (ayant des ordres
/// de la famille E ou un parcours) avec client, conducteur, fin prévue et dernier message du suivi (module CRM actif),
/// ordres d'un chantier (indice de référence : type, service, statut, état d'exécution, motif, fin prévue, retard) ;
/// étapes des ordres (§ 13) : ordre (document de la famille E), calendrier de son service, droits (E30, E46), suites
/// (état d'exécution, dates de l'ordre, statut documentaire déclenché, historique).
/// </summary>
public class SpecialisationExecutionBtp(IHttpContextAccessor http) : SpecialisationExecution
{
    private IServiceProvider Services => http.HttpContext?.RequestServices ?? throw new InvalidOperationException("Exécution : contexte HTTP absent");

    public override Task<List<ServiceExe>> ServicesAsync(ExecutionDbContext db, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ServiceExe>("""
            SELECT s.srv_id AS id, s.srv_code AS code, s.srv_libelle AS libelle, s.srv_parent_id AS parent_id, s.srv_ordre AS ordre, s.srv_actif AS actif
            FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id
            ORDER BY coalesce(p.srv_ordre, s.srv_ordre), coalesce(p.srv_code, s.srv_code), s.srv_parent_id NULLS FIRST, s.srv_ordre, s.srv_code
            """).ToListAsync(ct);

    public override Task<List<ElementExe>> ElementsAsync(ExecutionDbContext db, FiltreSynthese f, IReadOnlyCollection<string>? ids, CancellationToken ct) =>
        db.Database.SqlQueryRaw<ElementExe>("""
            SELECT 'chantier' AS type, c.id::text AS id, c.code, c.libelle, c.client, c.conducteur AS responsable, c.date_fin_prevue AS fin_prevue,
                   CASE WHEN f_module_actif('crm') THEN (SELECT n.not_objet FROM crm_note_lien l JOIN crm_note n ON n.not_id = l.nli_not_id
                     WHERE l.nli_type_element = 'chantier' AND l.nli_id_element = c.id::text AND NOT n.not_prive AND NOT n.not_rgpd AND n.not_parent_id IS NULL
                     ORDER BY n.not_cree_le DESC LIMIT 1) END AS dernier_message,
                   '/fiche/chantier/' || c.id AS url
            FROM v_liste_chantiers c
            WHERE (@ids IS NULL AND (EXISTS (SELECT 1 FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_chantier_id = c.id AND t.tyd_famille = 'E')
                                      OR EXISTS (SELECT 1 FROM exe_parcours p WHERE p.par_type_element = 'chantier' AND p.par_id_element = c.id::text))
                   OR c.id::text = ANY(@ids))
              AND (@r IS NULL OR c.code ILIKE @r OR c.libelle ILIKE @r OR c.client ILIKE @r)
            ORDER BY c.code DESC
            LIMIT 500
            """,
            new NpgsqlParameter("ids", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Text) { Value = (object?)ids?.ToArray() ?? DBNull.Value },
            new NpgsqlParameter("r", NpgsqlTypes.NpgsqlDbType.Text) { Value = string.IsNullOrWhiteSpace(f.Recherche) ? DBNull.Value : $"%{f.Recherche.Trim()}%" }).ToListAsync(ct);

    public override async Task<HashSet<string>> TypesInactifsAsync(ExecutionDbContext db, CancellationToken ct) =>
        [.. await db.Database.SqlQueryRaw<string>("SELECT tyd_code AS \"Value\" FROM type_document WHERE tyd_famille = 'E' AND NOT tyd_actif").ToListAsync(ct)];

    public override Task<List<OrdreExe>> OrdresAsync(ExecutionDbContext db, IReadOnlyCollection<string> ids, CancellationToken ct) =>
        db.Database.SqlQueryRaw<OrdreExe>($"""
            SELECT d.ent_chantier_id::text AS id_element, d.ent_id, d.ent_numero AS numero, d.ent_objet AS objet, t.tyd_code AS type_ordre, t.tyd_libelle AS type_libelle,
                   d.ent_srv_id AS srv_id, s.std_code AS statut, s.std_libelle AS statut_libelle, d.ent_exe_etat AS etat, m.mot_libelle AS motif, d.ent_fin_prevue AS fin_prevue,
                   coalesce(d.ent_fin_prevue < current_date AND coalesce(d.ent_exe_etat, '') <> 'TERMINE' AND s.std_code NOT IN ({SqlBtp.HorsVigueurOuSolde}), FALSE) AS en_retard,
                   '/document/' || d.ent_id AS url
            FROM document d
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN statut_document s ON s.std_id = d.ent_std_id
            LEFT JOIN motif m ON m.mot_id = d.ent_exe_motif_id
            WHERE t.tyd_famille = 'E' AND d.ent_is_reference AND d.ent_chantier_id::text = ANY(@ids)
            ORDER BY d.ent_fin_prevue NULLS LAST, d.ent_id
            """, new NpgsqlParameter("ids", ids.ToArray())).ToListAsync(ct);

    private sealed record LigneOrdre(long Id, string TypeOrdre, string? IdElement, int? SrvId, DateOnly? Debut, string? Etat, bool Clos, string? Ressource);

    public override async Task<OrdreEtapes?> OrdreAsync(ExecutionDbContext db, long id, CancellationToken ct)
    {
        var l = await db.Database.SqlQueryRaw<LigneOrdre>($"""
            SELECT d.ent_id AS id, t.tyd_code AS type_ordre, d.ent_chantier_id::text AS id_element, d.ent_srv_id AS srv_id, d.ent_debut_prevu AS debut,
                   d.ent_exe_etat AS etat, s.std_code IN ({SqlBtp.HorsVigueur}) AS clos, d.ent_ressource::text AS ressource
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE d.ent_id = @id AND t.tyd_famille = 'E'
            """, new NpgsqlParameter("id", id)).FirstOrDefaultAsync(ct);
        return l is null ? null : new OrdreEtapes(l.Id, l.TypeOrdre, l.IdElement, l.SrvId, l.Debut, l.Etat, l.Clos, l.Ressource);
    }

    public override Task<List<long>> OrdresEnCoursAsync(ExecutionDbContext db, string typeOrdre, CancellationToken ct) =>
        db.Database.SqlQueryRaw<long>($"""
            SELECT d.ent_id AS "Value" FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE t.tyd_code = @t AND d.ent_is_reference AND s.std_code NOT IN ({SqlBtp.HorsVigueurOuSolde}) AND coalesce(d.ent_exe_etat, '') <> 'TERMINE'
            """, new NpgsqlParameter("t", typeOrdre)).ToListAsync(ct);

    /// <summary>Calendrier du service de l'ordre (journées et fermetures du module Calendrier ; sans service : défaut).</summary>
    public override async Task<CalendrierEtapes?> CalendrierAsync(ExecutionDbContext db, int? srvId, DateOnly du, DateOnly au, CancellationToken ct)
    {
        var cal = srvId is int s
            ? await db.Database.SqlQueryRaw<int?>("SELECT srv_cal_id AS \"Value\" FROM service WHERE srv_id = @s", new NpgsqlParameter("s", s)).FirstOrDefaultAsync(ct)
            : null;
        var journees = await Services.GetRequiredService<ServiceCalendrier>().JourneesAsync(cal, du, au,
            srvId is int x ? [new Portee("service", x.ToString())] : [], ct);
        return new CalendrierEtapes(null, journees.ToDictionary(j => j.Date, j => j.Minutes));
    }

    private sealed record LigneTache(long TacId, DateOnly Fin, string? Ressource);

    /// <summary>Tâches du planning liées aux étapes : dernier jour, première affectation (salarié, intérimaire, matériel, sous-traitant).</summary>
    public override async Task<List<TacheEtape>> TachesAsync(ExecutionDbContext db, IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        return (await db.Database.SqlQueryRaw<LigneTache>("""
            SELECT t.tac_id, (CASE WHEN t.tac_fin > t.tac_debut THEN t.tac_fin - interval '1 minute' ELSE t.tac_fin END)::date AS fin,
                   (SELECT json_build_object('type', CASE a.aff_res_type WHEN 'INTERIM' THEN 'SALARIE' ELSE a.aff_res_type END, 'id', a.aff_res_id::bigint,
                           'libelle', (SELECT r.libelle FROM v_ressource r WHERE r.id = a.aff_res_id AND (r.type = a.aff_res_type OR r.type IN ('SALARIE', 'INTERIM') AND a.aff_res_type IN ('SALARIE', 'INTERIM'))))::text
                      FROM pla_affectation a WHERE a.aff_tac_id = t.tac_id AND a.aff_res_id ~ '^[0-9]+$' ORDER BY a.aff_id LIMIT 1) AS ressource
            FROM pla_tache t WHERE t.tac_id = ANY(@ids)
            """, new NpgsqlParameter("ids", ids.ToArray())).ToListAsync(ct)).Select(t => new TacheEtape(t.TacId, t.Fin, t.Ressource)).ToList();
    }

    private static Task<long?> IndividuAsync(ExecutionDbContext db, Utilisateur u, CancellationToken ct) => ComptesBtp.IndividuAsync(db, u.Code, ct);

    /// <summary>
    /// Validation d'une étape (E46) : administrateur, responsable de l'ordre, membre du service porteur ou de son parent,
    /// ressource principale de l'étape (salarié de l'utilisateur).
    /// </summary>
    public override async Task<bool> PeutValiderAsync(ExecutionDbContext db, OrdreEtapes o, EtapeOrdreEntite? e, Utilisateur u, CancellationToken ct)
    {
        if (u.EstAdmin) return true;
        if (await IndividuAsync(db, u, ct) is not long ind) return false;
        long? salarie = null;
        if (e?.OreRessource is string r)
        {
            var x = System.Text.Json.JsonDocument.Parse(r).RootElement;
            if (x.TryGetProperty("type", out var t) && t.GetString() == "SALARIE" && x.TryGetProperty("id", out var i) && i.TryGetInt64(out var v)) salarie = v;
        }
        return await db.Database.SqlQueryRaw<bool>("""
            SELECT (d.ent_responsable_id = @i
                    OR EXISTS (SELECT 1 FROM service_membre m JOIN service s ON s.srv_id = d.ent_srv_id
                                WHERE m.sme_ind_id = @i AND m.sme_srv_id IN (s.srv_id, s.srv_parent_id))
                    OR EXISTS (SELECT 1 FROM salarie sa WHERE sa.sal_id = @sal AND sa.sal_ind_id = @i)) IS TRUE AS "Value"
            FROM document d WHERE d.ent_id = @id
            """, new NpgsqlParameter("i", ind), new NpgsqlParameter("sal", NpgsqlDbType.Bigint) { Value = (object?)salarie ?? DBNull.Value },
            new NpgsqlParameter("id", o.Id)).FirstOrDefaultAsync(ct);
    }

    /// <summary>Contrôle du N+1 (E30) : administrateur ou responsable du service porteur de l'ordre (ou de son parent).</summary>
    public override async Task<bool> PeutControlerAsync(ExecutionDbContext db, OrdreEtapes o, Utilisateur u, CancellationToken ct)
    {
        if (u.EstAdmin) return true;
        if (await IndividuAsync(db, u, ct) is not long ind || o.SrvId is not int srv) return false;
        return await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (SELECT 1 FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id
                           WHERE s.srv_id = @s AND (s.srv_responsable_id = @i OR p.srv_responsable_id = @i)) AS "Value"
            """, new NpgsqlParameter("s", srv), new NpgsqlParameter("i", ind)).FirstAsync(ct);
    }

    /// <summary>
    /// Suites des étapes : état d'exécution déduit, dates prévues de l'ordre (première et dernière étape), historique ;
    /// statut documentaire « Transmis » ou « Pris en charge » appliqué par le cycle du document s'il le permet (sinon
    /// avertissement).
    /// </summary>
    public override async Task<List<string>> ApresEtapesAsync(ExecutionDbContext db, OrdreEtapes o, SuitesEtapes s, Utilisateur u, CancellationToken ct)
    {
        var avertissements = new List<string>();
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE document SET ent_exe_etat = coalesce(@e, ent_exe_etat), ent_debut_prevu = coalesce(@d, ent_debut_prevu), ent_fin_prevue = coalesce(@f, ent_fin_prevue)
            WHERE ent_id = @id
            """,
            [
                new NpgsqlParameter("e", NpgsqlDbType.Varchar) { Value = (object?)s.Etat ?? DBNull.Value }, new NpgsqlParameter("d", NpgsqlDbType.Date) { Value = (object?)s.Debut ?? DBNull.Value },
                new NpgsqlParameter("f", NpgsqlDbType.Date) { Value = (object?)s.Fin ?? DBNull.Value }, new NpgsqlParameter("id", o.Id),
            ], ct);
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO ordre_execution_historique (oeh_ent_id, oeh_etat, oeh_motif_id, oeh_detail, oeh_par)
            SELECT ent_id, ent_exe_etat, ent_exe_motif_id, left(@det, 300), @u FROM document WHERE ent_id = @id
            """, [new NpgsqlParameter("det", s.Detail), new NpgsqlParameter("u", u.Code), new NpgsqlParameter("id", o.Id)], ct);
        await PlanningAsync(db, s, u, avertissements, ct);
        await ControlesAsync(db, o, s, u, ct);
        if (s.Statuts.Count == 0) return avertissements;
        var documents = Services.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        foreach (var statut in new[] { "ENVOYE", "VALIDE" }.Where(s.Statuts.Contains))
        {
            try
            {
                if (statut == "ENVOYE") await documents.Envoyer(o.Id, u, ct);
                else await documents.ValiderTiers(o.Id, u, ct);
            }
            catch (ExceptionMetier e)
            {
                avertissements.Add($"Statut « {(statut == "ENVOYE" ? "Transmis" : "Pris en charge")} » non appliqué : {e.Message}");
            }
        }
        return avertissements;
    }

    private sealed record LigneDeplacement(long TacId, DateTime Debut, DateTime Fin, int Version);

    /// <summary>
    /// Étapes → planning : tâches des étapes validées terminées ; tâche d'une étape dont la date prévue change déplacée
    /// pour finir ce jour-là (durée gardée ; dépendances fixes propagées par le planning).
    /// </summary>
    private async Task PlanningAsync(ExecutionDbContext db, SuitesEtapes s, Utilisateur u, List<string> avertissements, CancellationToken ct)
    {
        if (s.Terminees.Count > 0)
        {
            await db.Database.ExecuteSqlRawAsync("""
                UPDATE pla_tache SET tac_etat = 'TERMINEE', tac_avancement = 100, tac_version = tac_version + 1, tac_maj_par = @u, tac_maj_le = now()
                WHERE tac_id = ANY(@ids) AND coalesce(tac_etat, '') <> 'TERMINEE'
                """, [new NpgsqlParameter("ids", s.Terminees.ToArray()), new NpgsqlParameter("u", u.Code)], ct);
        }
        if (s.Deplacements.Count == 0) return;
        var planning = Services.GetRequiredService<ServicePlanning>();
        var liens = Services.GetRequiredService<ServiceLiens>();
        foreach (var (tac, fin) in s.Deplacements)
        {
            try
            {
                // Dépendances fixes entrantes : le décalage absorbe l'écart (la tâche reste accrochée à la précédente) ;
                // sinon la tâche est déplacée. Le planning recalcule la fin sur les plages travaillées : quelques essais
                // pour finir le jour voulu, puis propagation aux suivantes.
                for (var essai = 0; essai < 4; essai++)
                {
                    var t = await db.Database.SqlQueryRaw<LigneDeplacement>("SELECT tac_id, tac_debut AS debut, tac_fin AS fin, tac_version AS version FROM pla_tache WHERE tac_id = @t",
                        new NpgsqlParameter("t", tac)).FirstOrDefaultAsync(ct);
                    if (t is null) break;
                    var dernier = DateOnly.FromDateTime(t.Fin > t.Debut ? t.Fin.AddMinutes(-1) : t.Fin);
                    var decalage = fin.DayNumber - dernier.DayNumber;
                    if (decalage == 0) break;
                    var accrochee = await db.Database.ExecuteSqlRawAsync(
                        "UPDATE pla_dependance SET dep_decalage = greatest(0, dep_decalage + @d) WHERE dep_vers = @t AND dep_mode = 'FIXE'",
                        [new NpgsqlParameter("d", decalage), new NpgsqlParameter("t", tac)], ct);
                    if (accrochee == 0)
                    {
                        await planning.DeplacerAsync(tac, new DeplacementSaisi(t.Debut.AddDays(decalage).ToString("yyyy-MM-ddTHH:mm"), t.Fin.AddDays(decalage).ToString("yyyy-MM-ddTHH:mm"),
                            "deplacer", null, null, false, t.Version), u, ct);
                    }
                    await liens.PropagerAsync(tac, u, ct);
                }
                var r = await db.Database.SqlQueryRaw<LigneDeplacement>("SELECT tac_id, tac_debut AS debut, tac_fin AS fin, tac_version AS version FROM pla_tache WHERE tac_id = @t",
                    new NpgsqlParameter("t", tac)).FirstOrDefaultAsync(ct);
                if (r is not null && DateOnly.FromDateTime(r.Fin > r.Debut ? r.Fin.AddMinutes(-1) : r.Fin) != fin)
                {
                    avertissements.Add($"Planning : la tâche finit le {DateOnly.FromDateTime(r.Fin > r.Debut ? r.Fin.AddMinutes(-1) : r.Fin):dd/MM/yyyy} (étapes précédentes, plages travaillées)");
                }
            }
            catch (ExceptionMetier e) { avertissements.Add($"Tâche du planning non déplacée : {e.Message}"); }
        }
    }

    /// <summary>
    /// Contrôle du N+1 attendu (E31) : tâche du CRM au responsable du service porteur de l'ordre (module CRM actif),
    /// rattachée à l'ordre et au chantier ; un échec est journalisé sans annuler la validation.
    /// </summary>
    private async Task ControlesAsync(ExecutionDbContext db, OrdreEtapes o, SuitesEtapes s, Utilisateur u, CancellationToken ct)
    {
        if (s.AControler.Count == 0 || o.SrvId is not int srv || !await Services.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.Crm, ct)) return;
        try
        {
            var responsable = await db.Database.SqlQueryRaw<long?>("""
                SELECT coalesce(s.srv_responsable_id, p.srv_responsable_id) AS "Value" FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id WHERE s.srv_id = @s
                """, new NpgsqlParameter("s", srv)).FirstOrDefaultAsync(ct);
            var numero = await db.Database.SqlQueryRaw<string?>("SELECT coalesce(ent_numero, ent_id::text) AS \"Value\" FROM document WHERE ent_id = @id",
                new NpgsqlParameter("id", o.Id)).FirstOrDefaultAsync(ct);
            var groupe = await db.Database.SqlQueryRaw<long>("SELECT coalesce(ent_groupe_id, ent_id) AS \"Value\" FROM document WHERE ent_id = @id",
                new NpgsqlParameter("id", o.Id)).FirstAsync(ct);
            var liens = new List<LienSaisi> { new("document", groupe.ToString(), true) };
            if (o.IdElement is string cha) liens.Add(new LienSaisi(TypesFiche.Chantier, cha));
            await Services.GetRequiredService<ServiceCrm>().Enregistrer(null, new NoteSaisie(NatureNote.Tache, EtatNote.AFaire, null, srv,
                $"Ordre {numero} : contrôle à faire ({string.Join(", ", s.AControler)})", null, responsable, DateTimeOffset.UtcNow.AddDays(2), null,
                false, false, false, liens, null), u, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            Services.GetRequiredService<ILoggerFactory>().CreateLogger("Execution").LogWarning(e, "Tâche du CRM (contrôle) non créée pour l'ordre {Ordre}", o.Id);
        }
    }
}
