using System.Text.Json;
using LogiBTP.Domaine;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Coordonnées figées du client (ou du fournisseur) et du payeur dans l'entête des documents (db/177) : instantané de
/// l'annuaire (raison sociale, code, SIRET, TVA, contact et sa fonction, adresse de facturation sinon principale,
/// courriel et téléphone du contact sinon de la personne, date du relevé), pour les éditions. Pris à la demande (bouton
/// de l'entête), complété à la validation s'il manque, conservé à la transformation (entête copié).
/// </summary>
public static class ContactsDocument
{
    private const string Sql = """
        WITH p AS (SELECT * FROM personne WHERE per_id = @per),
        rat AS (SELECT r.rat_id, r.rat_ind_id, r.rat_fonction, i.ind_civilite, i.ind_prenom, i.ind_nom
                FROM rattachement r JOIN individu i ON i.ind_id = r.rat_ind_id WHERE r.rat_per_id = @per AND r.rat_ind_id = @ind),
        coo AS (SELECT c.*, u.uco_usage, u.uco_principal, u.uco_per_id, u.uco_rat_id, u.uco_ind_id
                FROM usage_coordonnee u JOIN coordonnee c ON c.coo_id = u.uco_coo_id
                WHERE u.uco_per_id = @per OR u.uco_rat_id IN (SELECT rat_id FROM rat) OR (@ind IS NOT NULL AND u.uco_ind_id = @ind AND EXISTS (SELECT 1 FROM rat)))
        SELECT json_build_object(
          'per_id', p.per_id, 'code', p.per_code, 'raison_sociale', p.per_raison_sociale, 'siret', p.per_siret, 'tva_intra', p.per_tva_intra,
          'contact', (SELECT json_build_object('ind_id', rat_ind_id, 'nom', concat_ws(' ', ind_civilite, ind_prenom, ind_nom), 'fonction', rat_fonction) FROM rat),
          'adresse', (SELECT json_build_object('ligne1', coo_ligne1, 'ligne2', coo_ligne2, 'ligne3', coo_ligne3, 'code_postal', coo_code_postal,
                        'ville', coo_ville, 'pays', coo_pays)
                      FROM coo WHERE coo_nature = 'ADRESSE' AND uco_per_id IS NOT NULL
                      ORDER BY (uco_usage = 'FACTURATION') DESC, uco_principal DESC, (uco_usage IN ('PRINCIPALE', 'SIEGE')) DESC, coo_id LIMIT 1),
          'email', (SELECT coo_valeur FROM coo WHERE coo_nature = 'EMAIL'
                    ORDER BY (uco_per_id IS NULL) DESC, (uco_usage = 'FACTURATION') DESC, uco_principal DESC, coo_id LIMIT 1),
          'telephone', (SELECT coo_valeur FROM coo WHERE coo_nature = 'TELEPHONE'
                        ORDER BY (uco_per_id IS NULL) DESC, uco_principal DESC, (uco_usage IN ('STANDARD', 'FIXE', 'PRO')) DESC, coo_id LIMIT 1),
          'releve_le', current_date)::text AS "Value"
        FROM p
        """;

    /// <summary>Instantané d'une personne et de son contact (null : personne introuvable).</summary>
    public static async Task<JsonDocument?> Instantane(DbContext db, long perId, long? indId, CancellationToken ct)
    {
        var json = await db.Database.SqlQueryRaw<string>(Sql,
            new NpgsqlParameter("per", NpgsqlDbType.Bigint) { Value = perId },
            new NpgsqlParameter("ind", NpgsqlDbType.Bigint) { Value = (object?)indId ?? DBNull.Value }).ToListAsync(ct);
        return json.Count == 0 ? null : JsonDocument.Parse(json[0]);
    }

    /// <summary>
    /// Personne et contact d'un rôle d'après l'annuaire du document : CLIENT = le tiers du document (fonction CLIENT ou
    /// FOURNISSEUR), PAYEUR = l'intervenant PAYEUR seulement (sans lui, le payeur est le client : bloc vide, lot F).
    /// </summary>
    public static (long PerId, long? IndId)? Source(DocumentBtp d, string role, string famille)
    {
        var fonctionTiers = famille == "A" ? "FOURNISSEUR" : "CLIENT";
        (long, long?)? Intervenant(string fonction)
        {
            if (d.EntIntervenants is not { } j || j.RootElement.ValueKind != JsonValueKind.Array) return null;
            foreach (var x in j.RootElement.EnumerateArray())
            {
                if (x.TryGetProperty("fonction", out var f) && f.GetString() == fonction && x.TryGetProperty("per_id", out var p) && p.ValueKind == JsonValueKind.Number)
                {
                    long? ind = x.TryGetProperty("ind_id", out var i) && i.ValueKind == JsonValueKind.Number ? i.GetInt64() : null;
                    return (p.GetInt64(), ind);
                }
            }
            return null;
        }
        var client = Intervenant(fonctionTiers) ?? (d.EntTiersId is long t ? (t, null) : null);
        return role == "PAYEUR" ? Intervenant("PAYEUR") : client;
    }

    /// <summary>Coordonnées manquantes complétées (validation) : client, et payeur pour une vente.</summary>
    public static async Task Completer(DbContext db, DocumentBtp d, string famille, CancellationToken ct)
    {
        if (d.EntContactClient is null && Source(d, "CLIENT", famille) is var (perC, indC)) d.EntContactClient = await Instantane(db, perC, indC, ct);
        if (famille != "A" && d.EntContactPayeur is null && Source(d, "PAYEUR", famille) is var (perP, indP)) d.EntContactPayeur = await Instantane(db, perP, indP, ct);
    }
}
