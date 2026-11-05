using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>« Pas d'avancement » d'un marché pour un mois (premier jour du mois ou n'importe quel jour du mois).</summary>
public sealed record SansAvancement(DateOnly Mois, bool Sans, string? Commentaire);

/// <summary>
/// Marchés à facturer pour un mois civil (CONCEPTION-ACHATS-MARCHES.md 13.9, décision du 31/10/2026, lot E) : marchés de
/// vente en cours, avec une commande validée, non soldés (facturé &lt; montant), sans pièce d'avancement (situation ou
/// facture d'avancement) validée non annulée datée du mois. Chaque marché porte la dernière pièce d'avancement validée,
/// un brouillon d'avancement en cours (à ouvrir plutôt qu'à recréer), le type à créer (celui de la dernière pièce, sinon
/// la situation) et le « pas d'avancement » du mois (<c>marche_sans_avancement</c>, db/249 : le marché reste listé, marqué).
/// </summary>
public static class MarchesAFacturer
{
    /// <summary>Date d'une pièce créée pour le mois (MoisFacturation.DatePiece) ; mois à venir refusé (MOIS_A_VENIR).</summary>
    public static DateOnly DatePiece(DateOnly mois, DateOnly aujourdhui) =>
        MoisFacturation.DatePiece(mois, aujourdhui) ?? throw ExceptionMetier.Invalide("MOIS_A_VENIR", "Mois à venir : rien à facturer");

    private const string SqlListe = $"""
        WITH avt AS (
            SELECT d.ent_id, d.ent_marche_id, d.ent_numero, d.ent_date, d.ent_rang_avancement, d.ent_total_ht, d.ent_verrouille,
                   t.tyd_code, t.tyd_avancement, s.std_code
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE d.ent_marche_id IS NOT NULL AND t.tyd_avancement IN ('S', 'F') AND d.ent_is_reference AND s.std_code <> '{StatutsDocument.Annule}'),
        m AS (
            SELECT m.*, c.cha_code, c.cha_libelle, p.per_raison_sociale AS client,
                   (SELECT coalesce(sum(f.facture_ht), 0) FROM v_facturation_document f WHERE f.ent_marche_id = m.mar_id) AS facture_ht
            FROM marche m JOIN chantier c ON c.cha_id = m.mar_cha_id LEFT JOIN personne p ON p.per_id = m.mar_tiers_id
            WHERE m.mar_sens = 'V' AND m.mar_statut = 'EN_COURS'
              AND EXISTS (SELECT 1 FROM marche_document x JOIN document k ON k.ent_id = x.mdo_ent_id WHERE x.mdo_mar_id = m.mar_id AND f_document_valable(k.ent_id, FALSE)))
        SELECT coalesce(json_agg(json_build_object(
                 'mar_id', m.mar_id, 'code', m.mar_code, 'libelle', m.mar_libelle, 'chantier', m.cha_code, 'chantier_libelle', m.cha_libelle,
                 'client', m.client, 'montant_ht', m.mar_montant_ht, 'facture_ht', m.facture_ht,
                 'derniere', (SELECT json_build_object('ent_id', a.ent_id, 'numero', a.ent_numero, 'date', a.ent_date, 'rang', a.ent_rang_avancement,
                                'type', a.tyd_code, 'total_ht', a.ent_total_ht)
                              FROM avt a WHERE a.ent_marche_id = m.mar_id AND a.ent_verrouille
                              ORDER BY a.ent_date DESC, a.ent_rang_avancement DESC NULLS LAST, a.ent_id DESC LIMIT 1),
                 'brouillon', (SELECT json_build_object('ent_id', a.ent_id, 'numero', a.ent_numero, 'date', a.ent_date, 'type', a.tyd_code)
                               FROM avt a WHERE a.ent_marche_id = m.mar_id AND NOT a.ent_verrouille ORDER BY a.ent_id DESC LIMIT 1),
                 'type', coalesce((SELECT CASE a.tyd_avancement WHEN 'F' THEN 'V_FACTURE_AVT' ELSE 'V_SITUATION' END
                                   FROM avt a WHERE a.ent_marche_id = m.mar_id AND a.ent_verrouille
                                   ORDER BY a.ent_date DESC, a.ent_id DESC LIMIT 1), 'V_SITUATION'),
                 'sans_avancement', (SELECT json_build_object('par', s.msa_par, 'le', s.msa_le, 'commentaire', s.msa_commentaire)
                                     FROM marche_sans_avancement s WHERE s.msa_mar_id = m.mar_id AND s.msa_mois = @mois))
                 ORDER BY m.cha_code, m.mar_code), '[]')::text AS "Value"
        FROM m
        WHERE (m.mar_montant_ht IS NULL OR m.facture_ht < m.mar_montant_ht)
          AND NOT EXISTS (SELECT 1 FROM avt a WHERE a.ent_marche_id = m.mar_id AND a.ent_verrouille
                          AND a.ent_date >= @mois AND a.ent_date < (@mois + interval '1 month'))
        """;

    /// <summary>Marchés à facturer du mois (n'importe quel jour du mois).</summary>
    public static Task<IResult> ListeAsync(LogiBtpContext db, DateOnly mois, CancellationToken ct) =>
        db.JsonAsync(SqlListe, ct, SqlBtp.P("mois", MoisFacturation.Debut(mois), NpgsqlDbType.Date));

    /// <summary>Pose ou retire le « pas d'avancement » d'un marché pour un mois (marché de vente seulement).</summary>
    public static async Task<IResult> EnregistrerSansAvancementAsync(LogiBtpContext db, int marche, SansAvancement s, Utilisateur u, CancellationToken ct)
    {
        var sens = await db.Database.SqlQuery<string>($"SELECT mar_sens AS \"Value\" FROM marche WHERE mar_id = {marche}").FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Introuvable($"Marché {marche}");
        if (sens != "V") throw ExceptionMetier.Invalide("MARCHE_VENTE", "Seul un marché de vente se facture par avancement");
        var mois = MoisFacturation.Debut(s.Mois);
        if (s.Sans)
        {
            var commentaire = string.IsNullOrWhiteSpace(s.Commentaire) ? null : s.Commentaire.Trim();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO marche_sans_avancement (msa_mar_id, msa_mois, msa_commentaire, msa_par) VALUES ({marche}, {mois}, {commentaire}, {u.Code})
                ON CONFLICT (msa_mar_id, msa_mois) DO UPDATE SET msa_commentaire = EXCLUDED.msa_commentaire, msa_par = EXCLUDED.msa_par, msa_le = now()
                """, ct);
        }
        else
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM marche_sans_avancement WHERE msa_mar_id = {marche} AND msa_mois = {mois}", ct);
        }
        return Results.Ok(new { mar_id = marche, mois, sans = s.Sans });
    }
}
