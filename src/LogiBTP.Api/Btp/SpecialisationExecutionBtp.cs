using LogiBTP.Execution.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module Exécution par le cœur : services de l'entreprise (db/193), chantiers suivis (ayant des ordres
/// de la famille E ou un parcours) avec client, conducteur, fin prévue et dernier message du suivi (module CRM actif),
/// ordres d'un chantier (indice de référence : type, service, statut, état d'exécution, motif, fin prévue, retard).
/// </summary>
public class SpecialisationExecutionBtp : SpecialisationExecution
{
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
        db.Database.SqlQueryRaw<OrdreExe>("""
            SELECT d.ent_chantier_id::text AS id_element, d.ent_id, d.ent_numero AS numero, d.ent_objet AS objet, t.tyd_code AS type_ordre, t.tyd_libelle AS type_libelle,
                   d.ent_srv_id AS srv_id, s.std_code AS statut, s.std_libelle AS statut_libelle, d.ent_exe_etat AS etat, m.mot_libelle AS motif, d.ent_fin_prevue AS fin_prevue,
                   coalesce(d.ent_fin_prevue < current_date AND coalesce(d.ent_exe_etat, '') <> 'TERMINE' AND s.std_code NOT IN ('ANNULE', 'REMPLACE', 'SOLDE'), FALSE) AS en_retard,
                   '/document/' || d.ent_id AS url
            FROM document d
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            JOIN statut_document s ON s.std_id = d.ent_std_id
            LEFT JOIN motif m ON m.mot_id = d.ent_exe_motif_id
            WHERE t.tyd_famille = 'E' AND d.ent_is_reference AND d.ent_chantier_id::text = ANY(@ids)
            ORDER BY d.ent_fin_prevue NULLS LAST, d.ent_id
            """, new NpgsqlParameter("ids", ids.ToArray())).ToListAsync(ct);
}
