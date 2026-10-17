using LogiBTP.Annuaire.Web;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Annuaire du cœur : à la fusion d'un tiers provisoire (ServiceAnnuaire.Fusionner), les références de l'application
/// passent sur la fiche conservée, dans la transaction de la fusion : documents (tiers, intervenants et coordonnées
/// figées de l'entête : identifiant et nom du tiers), intervenants et tiers de la structure (projets, affaires,
/// chantiers, marchés, postes de marché), tarifs fournisseurs, règlements et cautions (module facultatif), pièces de la
/// GED (répertoires puis documents, un répertoire de même nom renommé « (fusion) »), verrou de la fiche.
/// </summary>
public sealed class SpecialisationAnnuaireBtp : SpecialisationAnnuaire
{
    private static readonly (string Quoi, string Sql)[] Reports =
    [
        ("documents", "UPDATE document SET ent_tiers_id = @c WHERE ent_tiers_id = @s"),
        ("intervenants_documents", """
            UPDATE document d SET ent_intervenants = (
                SELECT jsonb_agg(CASE WHEN (e ->> 'per_id')::bigint = @s
                                      THEN e || jsonb_build_object('per_id', @c, 'tiers', (SELECT per_raison_sociale FROM personne WHERE per_id = @c))
                                      ELSE e END ORDER BY o)
                FROM jsonb_array_elements(d.ent_intervenants) WITH ORDINALITY AS t(e, o))
            WHERE jsonb_typeof(d.ent_intervenants) = 'array' AND jsonb_path_exists(d.ent_intervenants, '$[*] ? (@.per_id == $s)', jsonb_build_object('s', @s))
            """),
        ("contacts_documents", """
            UPDATE document SET
                ent_contact_client = CASE WHEN (ent_contact_client ->> 'per_id')::bigint = @s THEN jsonb_set(ent_contact_client, '{per_id}', to_jsonb(@c)) ELSE ent_contact_client END,
                ent_contact_payeur = CASE WHEN (ent_contact_payeur ->> 'per_id')::bigint = @s THEN jsonb_set(ent_contact_payeur, '{per_id}', to_jsonb(@c)) ELSE ent_contact_payeur END
            WHERE (ent_contact_client ->> 'per_id')::bigint = @s OR (ent_contact_payeur ->> 'per_id')::bigint = @s
            """),
        ("intervenants", "UPDATE intervenant SET itv_per_id = @c WHERE itv_per_id = @s"),
        ("projets", "UPDATE projet SET prj_tiers_id = @c WHERE prj_tiers_id = @s"),
        ("affaires", "UPDATE affaire SET aff_tiers_id = @c WHERE aff_tiers_id = @s"),
        ("chantiers", "UPDATE chantier SET cha_tiers_id = @c WHERE cha_tiers_id = @s"),
        ("marches", "UPDATE marche SET mar_tiers_id = @c WHERE mar_tiers_id = @s"),
        ("postes_marche", "UPDATE marche_poste SET mpo_per_id = @c WHERE mpo_per_id = @s"),
        ("tarifs", "UPDATE tarif_fournisseur SET tfo_tiers_id = @c WHERE tfo_tiers_id = @s"),
    ];

    /// <summary>Tables du module Règlements (facultatif) : reportées seulement si elles existent.</summary>
    private static readonly (string Quoi, string Table, string Sql)[] ReportsFacultatifs =
    [
        ("reglements", "reglement", "UPDATE reglement SET reg_tiers_id = @c WHERE reg_tiers_id = @s"),
        ("cautions", "caution", "UPDATE caution SET cau_tiers_id = @c WHERE cau_tiers_id = @s"),
    ];

    public override async Task<IReadOnlyDictionary<string, int>> ReporterFusionAsync(NpgsqlConnection cnx, NpgsqlTransaction tx, long source, long cible, CancellationToken ct)
    {
        async Task<int> Executer(string sql)
        {
            await using var cmd = new NpgsqlCommand(sql, cnx, tx);
            cmd.Parameters.Add(new NpgsqlParameter("s", source));
            cmd.Parameters.Add(new NpgsqlParameter("c", cible));
            cmd.Parameters.Add(new NpgsqlParameter("st", source.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            cmd.Parameters.Add(new NpgsqlParameter("ct", cible.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            return await cmd.ExecuteNonQueryAsync(ct);
        }
        async Task<bool> Existe(string table)
        {
            await using var cmd = new NpgsqlCommand("SELECT to_regclass(@t) IS NOT NULL", cnx, tx);
            cmd.Parameters.Add(new NpgsqlParameter("t", table));
            return await cmd.ExecuteScalarAsync(ct) is true;
        }

        var r = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var (quoi, sql) in Reports) r[quoi] = await Executer(sql);
        foreach (var (quoi, table, sql) in ReportsFacultatifs) if (await Existe(table)) r[quoi] = await Executer(sql);

        // GED : répertoires racines (renommés si la fiche conservée en a un de même nom), puis leurs sous-répertoires niveau
        // par niveau (le trigger recopie l'élément du parent), puis les documents, archives et statistiques.
        await Executer("""
            UPDATE repertoire_ged s SET rge_nom = left(s.rge_nom, 140) || ' (fusion)'
            WHERE s.rge_type_element = 'personne' AND s.rge_id_element = @st AND s.rge_parent_id IS NULL
              AND EXISTS (SELECT 1 FROM repertoire_ged k WHERE k.rge_type_element = 'personne' AND k.rge_id_element = @ct
                          AND k.rge_parent_id IS NULL AND lower(k.rge_nom) = lower(s.rge_nom))
            """);
        var repertoires = await Executer("UPDATE repertoire_ged SET rge_id_element = @ct WHERE rge_type_element = 'personne' AND rge_id_element = @st AND rge_parent_id IS NULL");
        for (int n, niveau = 0; niveau < 100 && (n = await Executer("""
            UPDATE repertoire_ged r SET rge_id_element = @ct
            WHERE r.rge_type_element = 'personne' AND r.rge_id_element = @st
              AND EXISTS (SELECT 1 FROM repertoire_ged p WHERE p.rge_id = r.rge_parent_id AND p.rge_type_element = 'personne' AND p.rge_id_element = @ct)
            """)) > 0; niveau++) repertoires += n;
        r["repertoires_ged"] = repertoires;
        r["pieces_ged"] = await Executer("UPDATE document_ged SET dge_id_element = @ct WHERE dge_type_element = 'personne' AND dge_id_element = @st");
        await Executer("UPDATE document_ged_archive SET dge_id_element = @ct WHERE dge_type_element = 'personne' AND dge_id_element = @st");
        await Executer("UPDATE statistique_ged SET sge_id_element = @ct WHERE sge_type_element = 'personne' AND sge_id_element = @st");
        await Executer("DELETE FROM verrou_fiche WHERE vef_type = 'personne' AND vef_id = @st");
        return r;
    }
}
