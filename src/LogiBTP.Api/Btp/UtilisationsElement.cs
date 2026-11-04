using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Utilisations d'un élément de bibliothèque (lot 7 des demandes du 25/10/2026, A18g, A18h) : ouvrages et ensembles dont
/// la composition le contient (<c>v_element_utilisations</c>, db/237) ; lignes des pièces d'achat (familles d'achat,
/// indice de référence, hors annulées et remplacées) qui l'appellent, sur une période, en cours seulement (pièce non
/// terminée et ligne non soldée) ou toutes.
/// </summary>
public static class UtilisationsElement
{

    private const string SqlComposes = """
        SELECT coalesce(json_agg(json_build_object('id', x.compose_id, 'code', x.compose_code, 'type', x.compose_type, 'libelle', x.compose_libelle,
               'bib_code', b.bib_code, 'quantite', x.quantite, 'unite', x.unite) ORDER BY x.compose_code), '[]') AS "Value"
        FROM (SELECT DISTINCT ON (u.compose_id) u.* FROM v_element_utilisations u WHERE u.ele_id = @e ORDER BY u.compose_id) x
        JOIN bibliotheque b ON b.bib_id = x.compose_bib_id
        """;

    private const string SqlAchats = $"""
        SELECT coalesce(json_agg(json_build_object('ent_id', d.ent_id, 'numero', d.ent_numero, 'date', d.ent_date, 'type', t.tyd_libelle,
               'statut', s.std_libelle, 'tiers', p.per_raison_sociale, 'qte', l.lig_qte, 'unite', l.lig_unt_code,
               'pu', coalesce(l.lig_pv_remise, l.lig_pv), 'montant', l.lig_montant_ht, 'solde', coalesce(l.lig_solde, FALSE),
               'en_cours', NOT s.std_terminal AND NOT coalesce(l.lig_solde, FALSE)) ORDER BY d.ent_date DESC, d.ent_id DESC), '[]') AS "Value"
        FROM document_ligne l
        JOIN document d ON d.ent_id = l.lig_ent_id
        JOIN type_document t ON t.tyd_id = d.ent_tyd_id
        JOIN statut_document s ON s.std_id = d.ent_std_id
        LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
        WHERE l.lig_art_id = @e AND f_famille_achat(t.tyd_famille) AND d.ent_is_reference AND s.std_code NOT IN ({SqlBtp.HorsVigueur})
          AND (@du::date IS NULL OR d.ent_date >= @du::date) AND (@au::date IS NULL OR d.ent_date <= @au::date)
          AND (NOT @encours OR (NOT s.std_terminal AND NOT coalesce(l.lig_solde, FALSE)))
        """;

    public static IEndpointRouteBuilder MapUtilisationsElement(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/bibliotheque/elements/{id:long}");
        g.MapGet("/composes", (long id, LogiBtpContext db, CancellationToken ct) => db.JsonAsync(SqlComposes, ct, new NpgsqlParameter("e", id)));
        g.MapGet("/achats", (long id, DateOnly? du, DateOnly? au, bool? encours, LogiBtpContext db, CancellationToken ct) =>
            db.JsonAsync(SqlAchats, ct, new NpgsqlParameter("e", id),
                SqlBtp.P("du", du, NpgsqlTypes.NpgsqlDbType.Date),
                SqlBtp.P("au", au, NpgsqlTypes.NpgsqlDbType.Date),
                new NpgsqlParameter("encours", encours ?? false)));
        return api;
    }
}
