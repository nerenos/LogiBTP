namespace LogiBTP.Api.Btp;

/// <summary>Tâche du chantier d'un marché : heures, dernier avancement réel, marché de son origine (null : niveau chantier).</summary>
public sealed record TacheAvancement(long Id, string Libelle, decimal Heures, decimal? Pourcent, DateOnly? Le, int? Marche);

/// <summary>
/// Avancement réel d'un marché (terrain T12 ; plan terrain-suites, lot 21, TS20 a), affiché dans l'onglet Gestion du
/// marché à côté de l'avancement situé : moyenne des tâches du chantier pondérée par leurs heures, une tâche sans relevé
/// comptant pour 0. Chantier à un seul marché : toutes ses tâches (inchangé). Chantier à plusieurs marchés : tâches
/// rattachées au marché par leur origine (ordre, ligne d'un document ou étape d'un ordre → document → son marché
/// <c>ent_marche_id</c>, sa place dans <c>marche_document</c> ou la commande du marché dont il est issu) ; tâches de niveau
/// chantier (sans marché d'origine) exclues et comptées à part, tâches d'un autre marché ignorées.
/// </summary>
public static class AvancementMarche
{
    /// <summary>CTE <c>t</c> des tâches du chantier du marché @m, avec le marché résolu par leur origine.</summary>
    public const string SqlTachesChantier = """
        WITH t AS (
          SELECT ta.tac_id, ta.tac_libelle, coalesce(ta.tac_heures, 0)::numeric AS heures, a.pav_pourcent::numeric AS pourcent, a.pav_le AS le,
                 coalesce(d.ent_marche_id, md.mdo_mar_id, ml.mdo_mar_id) AS marche
          FROM marche m JOIN pla_tache ta ON ta.tac_type_element = 'chantier' AND ta.tac_id_element = m.mar_cha_id::text
          LEFT JOIN LATERAL (SELECT x.pav_pourcent, x.pav_le FROM pla_avancement x WHERE x.pav_tac_id = ta.tac_id ORDER BY x.pav_le DESC, x.pav_id DESC LIMIT 1) a ON TRUE
          LEFT JOIN document_ligne lo ON lo.lig_id = CASE WHEN ta.tac_origine_type = 'ligne' AND ta.tac_origine_id ~ '^[0-9]+$' THEN ta.tac_origine_id::bigint END
          LEFT JOIN exe_ordre_etape e ON ta.tac_origine_type = 'etape' AND e.ore_id::text = ta.tac_origine_id
          LEFT JOIN document d ON d.ent_id = CASE WHEN ta.tac_origine_type = 'ordre' AND ta.tac_origine_id ~ '^[0-9]+$' THEN ta.tac_origine_id::bigint
                                                  WHEN lo.lig_id IS NOT NULL THEN lo.lig_ent_id ELSE e.ore_ordre_id END
          LEFT JOIN marche_document md ON md.mdo_ent_id = d.ent_id
          LEFT JOIN LATERAL (SELECT x.mdo_mar_id FROM document_lien l JOIN marche_document x ON x.mdo_ent_id = l.lie_source_ent_id
                             WHERE l.lie_cible_ent_id = d.ent_id ORDER BY x.mdo_rang LIMIT 1) ml ON TRUE
          WHERE m.mar_id = @m)
        """;

    /// <summary>Tâches retenues pour le marché et tâches de niveau chantier exclues (chantier à plusieurs marchés).</summary>
    public static (List<TacheAvancement> Retenues, List<TacheAvancement> Exclues) Repartir(IReadOnlyCollection<TacheAvancement> taches, int marche, int marchesDuChantier)
    {
        if (marchesDuChantier <= 1) return ([.. taches], []);
        return ([.. taches.Where(t => t.Marche == marche)], [.. taches.Where(t => t.Marche is null)]);
    }

    /// <summary>Moyenne pondérée par les heures, au dixième (demi vers l'infini) ; null sans heures.</summary>
    public static decimal? Reel(IEnumerable<TacheAvancement> taches)
    {
        var l = taches.ToList();
        var heures = l.Sum(t => t.Heures);
        return heures == 0 ? null : Math.Round(l.Sum(t => t.Heures * (t.Pourcent ?? 0)) / heures, 1, MidpointRounding.AwayFromZero);
    }

    public static object Calculer(IReadOnlyCollection<TacheAvancement> taches, int marche, int marchesDuChantier)
    {
        var (retenues, exclues) = Repartir(taches, marche, marchesDuChantier);
        static object Vue(TacheAvancement t) => new { id = t.Id, libelle = t.Libelle, heures = t.Heures, pourcent = t.Pourcent, le = t.Le };
        return new
        {
            reel = Reel(retenues),
            dernier = retenues.Max(t => t.Le),
            plusieurs = marchesDuChantier > 1,
            taches = retenues.Select(Vue).ToList(),
            exclues = exclues.Select(Vue).ToList(),
        };
    }
}
