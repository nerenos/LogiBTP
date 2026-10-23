using System.Text.Json;
using LogiBTP.Reglements.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Règlements spécialisé par le cœur : échéances des pièces validées non annulées (document_echeance du module
/// Document) ; sens E pour les ventes, D pour les achats ; objet = marché de la pièce ; tiers de l'annuaire.
/// </summary>
public sealed class SpecialisationReglementBtp : SpecialisationReglement
{
    private const string SqlEcheances = """
        SELECT coalesce(json_agg(json_build_object(
          'id', e.ech_id, 'piece_id', d.ent_id, 'piece', d.ent_numero, 'type', t.tyd_libelle, 'tiers_id', d.ent_tiers_id, 'tiers', p.per_raison_sociale,
          'sens', CASE WHEN f_famille_achat(t.tyd_famille) THEN 'D' ELSE 'E' END, 'date', e.ech_date, 'montant', e.ech_montant, 'nature', e.ech_nature,
          'objet_id', d.ent_marche_id) ORDER BY e.ech_date NULLS LAST, d.ent_id, e.ech_rang), '[]') AS "Value"
        FROM document_echeance e
        JOIN document d ON d.ent_id = e.ech_ent_id
        JOIN type_document t ON t.tyd_id = d.ent_tyd_id
        JOIN statut_document s ON s.std_id = d.ent_std_id
        LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
        WHERE d.ent_verrouille AND s.std_code <> 'ANNULE' AND d.ent_tiers_id IS NOT NULL
          AND (@tiers IS NULL OR d.ent_tiers_id = @tiers)
          AND (@sens IS NULL OR (CASE WHEN f_famille_achat(t.tyd_famille) THEN 'D' ELSE 'E' END) = @sens)
          AND (@ids IS NULL OR e.ech_id = ANY(@ids))
          AND (@pieces IS NULL OR d.ent_id = ANY(@pieces))
          AND (@objet IS NULL OR d.ent_marche_id = @objet)
        """;

    private const string SqlTiers = """
        SELECT coalesce(json_agg(json_build_object('id', x.per_id, 'nom', x.nom, 'sens', x.sens) ORDER BY x.nom), '[]') AS "Value"
        FROM (SELECT DISTINCT p.per_id, coalesce(p.per_raison_sociale, '#' || p.per_id) AS nom, CASE WHEN f_famille_achat(t.tyd_famille) THEN 'D' ELSE 'E' END AS sens
              FROM document_echeance e JOIN document d ON d.ent_id = e.ech_ent_id JOIN type_document t ON t.tyd_id = d.ent_tyd_id
              JOIN personne p ON p.per_id = d.ent_tiers_id) x
        """;

    public override async Task<List<EcheanceSource>> EcheancesAsync(ReglementDbContext db, FiltreEcheances f, CancellationToken ct)
    {
        NpgsqlParameter P(string nom, object? v, NpgsqlDbType type) => new(nom, type) { Value = v ?? DBNull.Value };
        var json = await db.Database.SqlQueryRaw<string>(SqlEcheances,
            P("tiers", f.TiersId, NpgsqlDbType.Bigint), P("sens", f.Sens, NpgsqlDbType.Text),
            P("ids", f.Ids?.ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Bigint), P("pieces", f.Pieces?.ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Bigint),
            P("objet", f.ObjetId, NpgsqlDbType.Bigint)).FirstAsync(ct);
        return JsonSerializer.Deserialize<List<EcheanceSource>>(json, JsonCalcul.Options) ?? [];
    }

    /// <summary>
    /// État de paiement des pièces des échéances touchées (P19) : T quand toutes les échéances hors retenue de garantie
    /// sont réglées, P quand l'une est pointée, sinon aucun ; statut recalculé (PAYE, PAYE_PARTIEL).
    /// </summary>
    public override async Task ApresPointageAsync(ReglementDbContext db, IReadOnlyCollection<long> echeances, CancellationToken ct)
    {
        if (echeances.Count == 0) return;
        var ids = echeances.Distinct().ToArray();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            WITH pieces AS (SELECT DISTINCT ech_ent_id AS ent_id FROM document_echeance WHERE ech_id = ANY({ids})),
            etat AS (
                SELECT e.ech_ent_id AS ent_id,
                       bool_and(abs(e.ech_montant - coalesce(p.pointe, 0)) <= 0) AS regle,
                       bool_or(coalesce(p.pointe, 0) <> 0) AS entame
                FROM document_echeance e
                LEFT JOIN (SELECT poi_echeance_id, sum(poi_montant) AS pointe FROM pointage GROUP BY 1) p ON p.poi_echeance_id = e.ech_id
                WHERE e.ech_ent_id IN (SELECT ent_id FROM pieces) AND e.ech_nature = 'NORMALE'
                GROUP BY 1)
            UPDATE document d SET ent_etat_paiement = CASE WHEN etat.regle THEN 'T' WHEN etat.entame THEN 'P' END
            FROM etat WHERE d.ent_id = etat.ent_id
            """, ct);
        await db.Database.SqlQuery<string>($"""
            SELECT coalesce(f_document_statut(ech_ent_id), '') AS "Value" FROM (SELECT DISTINCT ech_ent_id FROM document_echeance WHERE ech_id = ANY({ids})) x
            """).ToListAsync(ct);
    }

    public override async Task<List<TiersReglement>> TiersAsync(ReglementDbContext db, CancellationToken ct)
    {
        var json = await db.Database.SqlQueryRaw<string>(SqlTiers).FirstAsync(ct);
        return JsonSerializer.Deserialize<List<TiersReglement>>(json, JsonCalcul.Options) ?? [];
    }
}
