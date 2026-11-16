using System.Text.Json;
using System.Text.Json.Serialization;
using LogiBTP.Socle.Donnees;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Import.Reprise;

/// <summary>Groupe de doublons retenu : la ligne source conservée et celles fusionnées dans elle.</summary>
public sealed record GroupeFusion(
    [property: JsonPropertyName("table_source")] string TableSource,
    [property: JsonPropertyName("cle_conservee")] string CleConservee,
    [property: JsonPropertyName("cles_fusionnees")] IReadOnlyList<string> ClesFusionnees);

/// <summary>Refus d'un groupe : code <see cref="ErreurFusion"/>, rang du groupe et clé en cause.</summary>
public sealed record ErreurGroupeFusion(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("rang")] int Rang,
    [property: JsonPropertyName("cle")] string? Cle);

/// <summary>
/// Fusions de doublons choisies avant la reprise (plan reprise-mde-optim, lot 3), table <c>import_fusion</c> : lues par
/// le moteur (<see cref="ContexteReprise.CleConservee"/>), remplacées en bloc par l'écran de reprise. Règles répliquées
/// dans <c>js/src/fusions.js</c> (<c>controlerFusions</c>).
/// </summary>
public static class FusionsReprise
{
    /// <summary>
    /// Contrôle : chaque groupe fusionne au moins une clé autre que la conservée ; une clé (conservée ou fusionnée)
    /// n'apparaît qu'une fois par table source.
    /// </summary>
    public static IReadOnlyList<ErreurGroupeFusion> Controler(IReadOnlyList<GroupeFusion> groupes)
    {
        var erreurs = new List<ErreurGroupeFusion>();
        var vues = new HashSet<(string, string)>();
        for (var i = 0; i < groupes.Count; i++)
        {
            var g = groupes[i];
            var conservee = g.CleConservee.TrimEnd();
            var fusionnees = g.ClesFusionnees.Select(c => c.TrimEnd()).ToList();
            if (fusionnees.Count == 0) { erreurs.Add(new(ErreurFusion.GroupeVide, i, conservee)); continue; }
            if (fusionnees.Contains(conservee)) erreurs.Add(new(ErreurFusion.ConserveeFusionnee, i, conservee));
            foreach (var cle in fusionnees.Prepend(conservee).Distinct())
                if (!vues.Add((g.TableSource, cle))) erreurs.Add(new(ErreurFusion.CleEnDouble, i, cle));
        }
        return erreurs;
    }

    public static async Task<IReadOnlyList<GroupeFusion>> LireAsync(NpgsqlConnection connexion, NpgsqlTransaction? transaction, string source, CancellationToken ct)
    {
        var groupes = new List<GroupeFusion>();
        await using var cmd = new NpgsqlCommand(
            "SELECT ifu_table_source, ifu_cle_conservee, ifu_cles_fusionnees::text FROM import_fusion WHERE ifu_source = $1 ORDER BY ifu_id",
            connexion, transaction);
        cmd.Parameters.Add(new() { Value = source });
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            groupes.Add(new(r.GetString(0), r.GetString(1), JsonSerializer.Deserialize<List<string>>(r.GetString(2)) ?? []));
        return groupes;
    }

    /// <summary>Remplace les fusions d'une source (contrôlées avant : <see cref="Controler"/>), dans une transaction de l'unité.</summary>
    public static async Task RemplacerAsync(UniteEcriture unite, string source, IReadOnlyList<GroupeFusion> groupes, CancellationToken ct)
    {
        await using var tx = await unite.CommencerAsync(ct);
        await using (var suppression = new NpgsqlCommand("DELETE FROM import_fusion WHERE ifu_source = $1", unite.Connexion, unite.Transaction))
        {
            suppression.Parameters.Add(new() { Value = source });
            await suppression.ExecuteNonQueryAsync(ct);
        }
        foreach (var g in groupes)
        {
            await using var cmd = new NpgsqlCommand(
                "INSERT INTO import_fusion (ifu_source, ifu_table_source, ifu_cle_conservee, ifu_cles_fusionnees) VALUES ($1, $2, $3, $4)",
                unite.Connexion, unite.Transaction);
            cmd.Parameters.Add(new() { Value = source });
            cmd.Parameters.Add(new() { Value = g.TableSource });
            cmd.Parameters.Add(new() { Value = g.CleConservee.TrimEnd() });
            cmd.Parameters.Add(new() { Value = JsonSerializer.Serialize(g.ClesFusionnees.Select(c => c.TrimEnd())), NpgsqlDbType = NpgsqlDbType.Jsonb });
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }
}
