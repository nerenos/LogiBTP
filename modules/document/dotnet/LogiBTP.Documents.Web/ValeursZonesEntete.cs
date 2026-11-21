using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Donnees;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Documents.Web;

/// <summary>
/// Valeurs des zones supplémentaires d'entête (colonnes « x_ » de document, non mappées sur l'entité) lues et écrites avec
/// le document, dans la même unité d'écriture que son enregistrement. Les identifiants viennent du registre
/// (document_zone_entete) et sont contrôlés par <see cref="ZonesEntete.NomValide"/>, puis cités ; les valeurs sont toujours
/// des paramètres. Seules les zones actives qui s'appliquent au type du document sont écrites ; une zone inactive garde sa valeur.
/// </summary>
public static class ValeursZonesEntete<TDoc, TLigne>
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
{
    private static string Cite(string colonne) => NpgsqlCommandBuilderCitation.Citer(colonne);

    /// <summary>Valeurs non nulles de toutes les zones du registre pour ce document (colonne → valeur JSON).</summary>
    public static async Task<Dictionary<string, JsonNode?>> Lire(DocumentDbContext<TDoc, TLigne> db, long entId, CancellationToken ct)
    {
        var zones = (await ZonesEnteteDocument<TDoc, TLigne>.LireRegistre(db, ct)).Where(z => ZonesEntete.NomValide(z.Colonne)).ToList();
        var valeurs = new Dictionary<string, JsonNode?>();
        if (zones.Count == 0) return valeurs;
        var sql = "SELECT " + string.Join(", ", zones.Select(z => Cite(z.Colonne))) + " FROM document WHERE ent_id = @id";
        await db.Unite().LireAsync<bool>(async (cnx, tx, c) =>
        {
            await using var cmd = new NpgsqlCommand(sql, cnx, tx);
            cmd.Parameters.AddWithValue("id", entId);
            await using var rd = await cmd.ExecuteReaderAsync(c);
            if (!await rd.ReadAsync(c)) return true;
            for (var i = 0; i < zones.Count; i++)
            {
                if (rd.IsDBNull(i)) continue;
                valeurs[zones[i].Colonne] = zones[i].Type switch
                {
                    TypesZoneEntete.Nombre or TypesZoneEntete.Montant => JsonValue.Create(rd.GetFieldValue<decimal>(i)),
                    TypesZoneEntete.Date => JsonValue.Create(rd.GetFieldValue<DateOnly>(i).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
                    TypesZoneEntete.CaseACocher => JsonValue.Create(rd.GetBoolean(i)),
                    _ => JsonValue.Create(rd.GetString(i)),
                };
            }
            return true;
        }, null, ct);
        return valeurs;
    }

    /// <summary>
    /// Écrit les valeurs des zones actives du type (famille, code) : une zone absente de <paramref name="valeurs"/> est
    /// vidée (la saisie est la valeur complète). Valeurs supposées contrôlées par <see cref="ZonesEntete.ErreursSaisie"/>.
    /// </summary>
    public static async Task Ecrire(DocumentDbContext<TDoc, TLigne> db, long entId, string? famille, string? typeDocument,
        IReadOnlyDictionary<string, JsonNode?>? valeurs, CancellationToken ct)
    {
        var zones = ZonesEntete.DuType((await ZonesEnteteDocument<TDoc, TLigne>.LireRegistre(db, ct)).Where(z => ZonesEntete.NomValide(z.Colonne)), famille, typeDocument);
        if (zones.Count == 0) return;
        var sql = new StringBuilder("UPDATE document SET ");
        var unite = db.Unite();
        await unite.ExecuterAsync(async ctu =>
        {
            await using var cmd = new NpgsqlCommand { Connection = unite.Connexion, Transaction = unite.Transaction };
            for (var i = 0; i < zones.Count; i++)
            {
                if (i > 0) sql.Append(", ");
                sql.Append(Cite(zones[i].Colonne)).Append(" = @z").Append(i.ToString(CultureInfo.InvariantCulture));
                JsonNode? v = null;
                valeurs?.TryGetValue(zones[i].Colonne, out v);
                cmd.Parameters.Add(Parametre("z" + i.ToString(CultureInfo.InvariantCulture), zones[i].Type, v));
            }
            sql.Append(" WHERE ent_id = @id");
            cmd.Parameters.AddWithValue("id", entId);
            cmd.CommandText = sql.ToString();
            await cmd.ExecuteNonQueryAsync(ctu);
            return true;
        }, ct);
    }

    private static NpgsqlParameter Parametre(string nom, string type, JsonNode? v)
    {
        var vide = v is null || v.GetValueKind() == JsonValueKind.Null || (v.GetValueKind() == JsonValueKind.String && string.IsNullOrWhiteSpace(v.GetValue<string>()));
        return type switch
        {
            TypesZoneEntete.Nombre => new NpgsqlParameter(nom, NpgsqlDbType.Numeric) { Value = vide ? DBNull.Value : v!.GetValue<decimal>() },
            TypesZoneEntete.Montant => new NpgsqlParameter(nom, NpgsqlDbType.Numeric) { Value = vide ? DBNull.Value : v!.GetValue<decimal>() },
            TypesZoneEntete.Date => new NpgsqlParameter(nom, NpgsqlDbType.Date) { Value = vide ? DBNull.Value : DateOnly.ParseExact(v!.GetValue<string>(), "yyyy-MM-dd", CultureInfo.InvariantCulture) },
            TypesZoneEntete.CaseACocher => new NpgsqlParameter(nom, NpgsqlDbType.Boolean) { Value = vide ? DBNull.Value : v!.GetValue<bool>() },
            _ => new NpgsqlParameter(nom, NpgsqlDbType.Text) { Value = vide ? DBNull.Value : v!.GetValue<string>().Trim() },
        };
    }
}

/// <summary>Citation d'un identifiant SQL (guillemets doublés) par l'API d'Npgsql.</summary>
internal static class NpgsqlCommandBuilderCitation
{
    public static string Citer(string identifiant) => new NpgsqlCommandBuilder().QuoteIdentifier(identifiant);
}
