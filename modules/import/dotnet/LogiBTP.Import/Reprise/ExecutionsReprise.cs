using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;

namespace LogiBTP.Import.Reprise;

/// <summary>Exécution d'une reprise (simulation ou réelle), résumée pour l'historique de l'écran.</summary>
public sealed record ExecutionReprise(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("societes")] IReadOnlyList<string> Societes,
    [property: JsonPropertyName("simulation")] bool Simulation,
    [property: JsonPropertyName("etat")] string Etat,
    [property: JsonPropertyName("debut")] DateTimeOffset Debut,
    [property: JsonPropertyName("fin")] DateTimeOffset? Fin,
    [property: JsonPropertyName("auteur")] string? Auteur,
    [property: JsonPropertyName("bloquantes")] int Bloquantes,
    [property: JsonPropertyName("avertissements")] int Avertissements);

/// <summary>Historique des reprises (<c>import_reprise</c>) et rapport d'une exécution.</summary>
public static class ExecutionsReprise
{
    private const string Requete = """
        SELECT irp_id, irp_source, irp_societes::text, irp_simulation, irp_etat, irp_debut, irp_fin, irp_auteur,
               (SELECT count(*) FROM jsonb_array_elements(coalesce(irp_rapport -> 'anomalies', '[]'::jsonb)) a WHERE a ->> 'niveau' = 'BLOQUANT')::int,
               (SELECT count(*) FROM jsonb_array_elements(coalesce(irp_rapport -> 'anomalies', '[]'::jsonb)) a WHERE a ->> 'niveau' = 'AVERTISSEMENT')::int
        FROM import_reprise ORDER BY irp_id DESC LIMIT $1
        """;

    public static async Task<IReadOnlyList<ExecutionReprise>> ListerAsync(NpgsqlConnection connexion, NpgsqlTransaction? transaction, int nombre, CancellationToken ct)
    {
        var liste = new List<ExecutionReprise>();
        await using var cmd = new NpgsqlCommand(Requete, connexion, transaction);
        cmd.Parameters.Add(new() { Value = nombre });
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            liste.Add(new(r.GetInt64(0), r.GetString(1), JsonSerializer.Deserialize<List<string>>(r.GetString(2)) ?? [], r.GetBoolean(3),
                r.GetString(4), r.GetFieldValue<DateTimeOffset>(5), r.IsDBNull(6) ? null : r.GetFieldValue<DateTimeOffset>(6),
                r.IsDBNull(7) ? null : r.GetString(7), r.GetInt32(8), r.GetInt32(9)));
        return liste;
    }

    /// <summary>Rapport d'une exécution, null si elle n'existe pas.</summary>
    public static async Task<RapportReprise?> RapportAsync(NpgsqlConnection connexion, NpgsqlTransaction? transaction, long id, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("SELECT irp_rapport::text FROM import_reprise WHERE irp_id = $1", connexion, transaction);
        cmd.Parameters.Add(new() { Value = id });
        return await cmd.ExecuteScalarAsync(ct) is string json ? RapportReprise.DepuisJson(json) : null;
    }
}
