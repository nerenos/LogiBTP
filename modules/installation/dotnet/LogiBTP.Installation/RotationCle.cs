using System.Text.Json.Nodes;
using LogiBTP.Socle;
using Npgsql;

namespace LogiBTP.Installation;

/// <summary>
/// Empreinte (HMAC de la clé des données) d'une valeur chiffrée, à recalculer après une rotation : table, colonne de
/// l'empreinte, colonne chiffrée d'où se lit la valeur, extraction de la valeur dans le texte déchiffré (null : aucune).
/// Déclarée par l'application (le module ignore les tables métier).
/// </summary>
public sealed record EmpreinteDeclaree(string Table, string ColonneEmpreinte, string ColonneSource, Func<string, string?> Valeur);

/// <summary>Bilan du rechiffrement d'une base.</summary>
public sealed record BilanRotation(int Valeurs, int Empreintes, IReadOnlyList<string> Tables);

/// <summary>
/// Rotation de la clé des données (ANALYSE-MODULE-INSTALLATION.md § 10, lot 4) : toutes les valeurs « chiffre:v1: » des
/// colonnes texte et des chaînes des colonnes JSON du schéma public sont déchiffrées (clé courante ou précédente) puis
/// rechiffrées par la nouvelle clé, et les empreintes déclarées recalculées, en une transaction par base. Rejouable :
/// une valeur déjà chiffrée par la nouvelle clé est simplement rechiffrée.
/// </summary>
public static class RotationCle
{
    private sealed record Colonne(string Table, string Nom, bool Json);

    public static async Task<BilanRotation> RechiffrerBaseAsync(string connexion, Chiffrement lecture, Chiffrement ecriture,
        IReadOnlyList<EmpreinteDeclaree> empreintes, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        await using var tx = await cnx.BeginTransactionAsync(ct);
        var colonnes = new List<Colonne>();
        await using (var cmd = new NpgsqlCommand("""
            SELECT c.table_name, c.column_name, c.data_type IN ('json', 'jsonb')
            FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
            ORDER BY 1, 2
            """, cnx, tx))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct)) colonnes.Add(new Colonne(r.GetString(0), r.GetString(1), r.GetBoolean(2)));
        }
        int valeurs = 0, nbEmpreintes = 0;
        var tables = new List<string>();
        foreach (var groupe in colonnes.GroupBy(c => c.Table))
        {
            var cols = groupe.ToList();
            var lus = string.Join(", ", cols.Select(c => $"{Id(c.Nom)}::text"));
            var filtre = string.Join(" OR ", cols.Select(c => $"{Id(c.Nom)}::text LIKE '%{Chiffrement.Prefixe}%'"));
            var lignes = new List<(string Ctid, string?[] Valeurs)>();
            await using (var cmd = new NpgsqlCommand($"SELECT ctid::text, {lus} FROM {Id(groupe.Key)} WHERE {filtre}", cnx, tx))
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            {
                while (await r.ReadAsync(ct))
                    lignes.Add((r.GetString(0), Enumerable.Range(1, cols.Count).Select(i => r.IsDBNull(i) ? null : r.GetString(i)).ToArray()));
            }
            if (lignes.Count == 0) continue;
            tables.Add(groupe.Key);
            foreach (var (ctid, vals) in lignes)
            {
                var nouvelles = new List<(Colonne Col, string Valeur)>();
                for (var i = 0; i < cols.Count; i++)
                {
                    if (vals[i] is not { } v || !v.Contains(Chiffrement.Prefixe, StringComparison.Ordinal)) continue;
                    var (texte, n) = cols[i].Json ? RechiffrerJson(v, lecture, ecriture) : (Chiffrement.EstChiffre(v) ? ecriture.Chiffrer(lecture.Dechiffrer(v))! : v, Chiffrement.EstChiffre(v) ? 1 : 0);
                    if (n == 0) continue;
                    valeurs += n;
                    nouvelles.Add((cols[i], texte));
                }
                if (nouvelles.Count == 0) continue;
                var sets = string.Join(", ", nouvelles.Select((x, i) => $"{Id(x.Col.Nom)} = @p{i}{(x.Col.Json ? "::" + "jsonb" : "")}"));
                await using var maj = new NpgsqlCommand($"UPDATE {Id(groupe.Key)} SET {sets} WHERE ctid = @ctid::tid", cnx, tx);
                for (var i = 0; i < nouvelles.Count; i++) maj.Parameters.AddWithValue($"p{i}", nouvelles[i].Valeur);
                maj.Parameters.AddWithValue("ctid", ctid);
                await maj.ExecuteNonQueryAsync(ct);
            }
        }
        foreach (var e in empreintes)
        {
            await using (var existe = new NpgsqlCommand("SELECT to_regclass(@t) IS NOT NULL", cnx, tx))
            {
                existe.Parameters.AddWithValue("t", e.Table);
                if (!(bool)(await existe.ExecuteScalarAsync(ct))!) continue;
            }
            var lignes = new List<(string Ctid, string Source)>();
            await using (var cmd = new NpgsqlCommand($"SELECT ctid::text, {Id(e.ColonneSource)} FROM {Id(e.Table)} WHERE {Id(e.ColonneSource)} IS NOT NULL AND {Id(e.ColonneEmpreinte)} IS NOT NULL", cnx, tx))
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            {
                while (await r.ReadAsync(ct)) lignes.Add((r.GetString(0), r.GetString(1)));
            }
            foreach (var (ctid, source) in lignes)
            {
                if (e.Valeur(ecriture.Dechiffrer(source)!) is not { } valeur) continue;
                await using var maj = new NpgsqlCommand($"UPDATE {Id(e.Table)} SET {Id(e.ColonneEmpreinte)} = @e WHERE ctid = @ctid::tid", cnx, tx);
                maj.Parameters.AddWithValue("e", ecriture.Empreinte(valeur)!);
                maj.Parameters.AddWithValue("ctid", ctid);
                nbEmpreintes += await maj.ExecuteNonQueryAsync(ct);
            }
        }
        await tx.CommitAsync(ct);
        return new BilanRotation(valeurs, nbEmpreintes, tables);
    }

    /// <summary>Chaînes chiffrées d'un JSON rechiffrées (toute profondeur) ; renvoie le JSON et leur nombre.</summary>
    public static (string Json, int Nombre) RechiffrerJson(string json, Chiffrement lecture, Chiffrement ecriture)
    {
        var racine = JsonNode.Parse(json);
        var n = 0;
        string? Nouvelle(JsonNode? noeud) =>
            noeud is JsonValue v && v.TryGetValue<string>(out var s) && Chiffrement.EstChiffre(s) ? ecriture.Chiffrer(lecture.Dechiffrer(s)) : null;
        // Parcours en place : seules les chaînes chiffrées sont remplacées (un nœud déjà rattaché ne se réaffecte pas).
        void Parcourir(JsonNode? noeud)
        {
            if (noeud is JsonObject o)
            {
                foreach (var cle in o.Select(p => p.Key).ToList())
                {
                    if (Nouvelle(o[cle]) is { } c) { o[cle] = c; n++; }
                    else Parcourir(o[cle]);
                }
            }
            else if (noeud is JsonArray a)
            {
                for (var i = 0; i < a.Count; i++)
                {
                    if (Nouvelle(a[i]) is { } c) { a[i] = c; n++; }
                    else Parcourir(a[i]);
                }
            }
        }
        if (Nouvelle(racine) is { } seule) return (System.Text.Json.JsonSerializer.Serialize(seule), 1);
        Parcourir(racine);
        return (racine?.ToJsonString() ?? "null", n);
    }

    private static string Id(string nom) => "\"" + nom.Replace("\"", "\"\"") + "\"";
}
