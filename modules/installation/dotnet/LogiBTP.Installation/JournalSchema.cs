using System.Text.Encodings.Web;
using System.Text.Json;
using Npgsql;

namespace LogiBTP.Installation;

/// <summary>
/// Tables du moteur de versionnement du schéma (créées par le code, jamais par un script du manifeste) : instantanés
/// (installation_schema), préfixes d'intégrateur (installation_prefixe), forçages tracés (installation_forcage).
/// </summary>
public static class JournalSchema
{
    public const string TableSchema = "installation_schema";
    public const string TablePrefixe = "installation_prefixe";
    public const string TableForcage = "installation_forcage";

    private static readonly JsonSerializerOptions OptionsJson = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, WriteIndented = true };

    public static async Task AssurerTablesAsync(NpgsqlConnection cnx, CancellationToken ct = default)
    {
        await Executer(cnx, $"""
            CREATE TABLE IF NOT EXISTS {TableSchema} (
                ins_id         BIGSERIAL PRIMARY KEY,
                ins_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
                ins_empreinte  TEXT NOT NULL,
                ins_instantane TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS {TablePrefixe} (
                ipr_prefixe     TEXT PRIMARY KEY,
                ipr_integrateur TEXT NOT NULL,
                ipr_date        TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS {TableForcage} (
                ifo_id          BIGSERIAL PRIMARY KEY,
                ifo_utilisateur TEXT NOT NULL,
                ifo_date        TIMESTAMPTZ NOT NULL DEFAULT now(),
                ifo_base        TEXT NOT NULL,
                ifo_ecarts      TEXT NOT NULL,
                ifo_motif       TEXT NOT NULL
            );
            """, ct);
    }

    /// <summary>Inscrit l'instantané courant (après une application réussie).</summary>
    public static async Task EnregistrerInstantaneAsync(NpgsqlConnection cnx, CancellationToken ct = default)
    {
        await AssurerTablesAsync(cnx, ct);
        var inst = await InstantaneSchema.LireAsync(cnx, ct);
        await using var cmd = new NpgsqlCommand($"INSERT INTO {TableSchema} (ins_empreinte, ins_instantane) VALUES (@e, @i)", cnx);
        cmd.Parameters.AddWithValue("e", inst.Empreinte());
        cmd.Parameters.AddWithValue("i", inst.ToJson());
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Dernier instantané stocké, ou null (base d'avant le lot 1).</summary>
    public static async Task<InstantaneSchema?> DernierInstantaneAsync(NpgsqlConnection cnx, CancellationToken ct = default)
    {
        await AssurerTablesAsync(cnx, ct);
        await using var cmd = new NpgsqlCommand($"SELECT ins_instantane FROM {TableSchema} ORDER BY ins_id DESC LIMIT 1", cnx);
        return await cmd.ExecuteScalarAsync(ct) is string json ? InstantaneSchema.DepuisJson(json) : null;
    }

    public static async Task<List<string>> PrefixesAsync(NpgsqlConnection cnx, CancellationToken ct = default)
    {
        await AssurerTablesAsync(cnx, ct);
        var res = new List<string>();
        await using var cmd = new NpgsqlCommand($"SELECT ipr_prefixe FROM {TablePrefixe} ORDER BY ipr_prefixe", cnx);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) res.Add(r.GetString(0));
        return res;
    }

    /// <summary>
    /// Déclare un préfixe d'intégrateur. Refus : forme invalide (minuscules, chiffres, _ ; 3 caractères au moins ; finit par _),
    /// préfixe déjà pris ou qui en recouvre un, préfixe qui recouvre un nom de LogiBTP (tables et colonnes existantes :
    /// nom qui commence par le préfixe, ou préfixe qui commence par la famille « mot_ » d'un de nos noms).
    /// </summary>
    public static async Task AjouterPrefixeAsync(NpgsqlConnection cnx, string prefixe, string integrateur, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(integrateur)) throw new ArgumentException("--integrateur obligatoire");
        if (prefixe.Length < 3 || !char.IsAsciiLetterLower(prefixe[0]) || !prefixe.EndsWith('_')
            || !prefixe.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '_'))
            throw new ArgumentException($"Préfixe invalide : « {prefixe} » (minuscules, chiffres et _ ; 3 caractères au moins ; finit par _)");
        var existants = await PrefixesAsync(cnx, ct);
        if (existants.FirstOrDefault(p => p.StartsWith(prefixe, StringComparison.Ordinal) || prefixe.StartsWith(p, StringComparison.Ordinal)) is { } pris)
            throw new ArgumentException($"Préfixe {prefixe} refusé : il recouvre le préfixe déjà déclaré {pris}");
        var inst = await InstantaneSchema.LireAsync(cnx, ct);
        var noms = inst.Objets.Keys.Where(k => k.StartsWith("table:", StringComparison.Ordinal) || k.StartsWith("colonne:", StringComparison.Ordinal))
            .Select(k => DeriveSchema.Noms(k).Last())
            .Where(n => !n.StartsWith("x_", StringComparison.Ordinal) && !existants.Any(p => n.StartsWith(p, StringComparison.Ordinal)))
            .Distinct(StringComparer.Ordinal).ToList();
        if (noms.FirstOrDefault(n => n.StartsWith(prefixe, StringComparison.Ordinal)) is { } n1)
            throw new ArgumentException($"Préfixe {prefixe} refusé : il recouvre le nom LogiBTP « {n1} »");
        var famille = noms.Where(n => n.Contains('_')).Select(n => n[..(n.IndexOf('_') + 1)]).Concat(noms.Select(n => n + "_")).Distinct(StringComparer.Ordinal)
            .FirstOrDefault(f => prefixe.StartsWith(f, StringComparison.Ordinal));
        if (famille is not null) throw new ArgumentException($"Préfixe {prefixe} refusé : il commence par {famille}, préfixe de noms LogiBTP");
        await using var cmd = new NpgsqlCommand($"INSERT INTO {TablePrefixe} (ipr_prefixe, ipr_integrateur) VALUES (@p, @i)", cnx);
        cmd.Parameters.AddWithValue("p", prefixe);
        cmd.Parameters.AddWithValue("i", integrateur);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Objets préfixés (vues, clés étrangères) qui dépendent d'un objet LogiBTP (pg_depend) : écarts en conflit, car une
    /// mise à jour qui modifie l'objet peut les casser.
    /// </summary>
    public static async Task<List<EcartSchema>> DependancesAsync(NpgsqlConnection cnx, IReadOnlyCollection<string> prefixes, CancellationToken ct = default)
    {
        var res = new List<EcartSchema>();
        if (prefixes.Count == 0) return res;
        bool Prefixe(string n) => prefixes.Any(p => n.StartsWith(p, StringComparison.Ordinal));
        void Ajouter(string de, string vers, string nature)
        {
            if (Prefixe(de) && !Prefixe(vers) && !vers.StartsWith("x_", StringComparison.Ordinal))
                res.Add(new($"dependance:{de}->{vers}", EcartSchema.Dependance, null, $"{nature} {de} dépend de {vers}"));
        }
        await using (var cmd = new NpgsqlCommand("""
            SELECT DISTINCT v.relname, t.relname FROM pg_depend d
            JOIN pg_rewrite rw ON rw.oid = d.objid JOIN pg_class v ON v.oid = rw.ev_class JOIN pg_class t ON t.oid = d.refobjid
            JOIN pg_namespace nv ON nv.oid = v.relnamespace JOIN pg_namespace nt ON nt.oid = t.relnamespace
            WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass AND v.oid <> t.oid
              AND nv.nspname = 'public' AND nt.nspname = 'public'
            """, cnx))
        {
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) Ajouter(r.GetString(0), r.GetString(1), "vue");
        }
        await using (var cmd = new NpgsqlCommand("""
            SELECT DISTINCT c.relname, f.relname FROM pg_constraint k
            JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class f ON f.oid = k.confrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE k.contype = 'f' AND n.nspname = 'public'
            """, cnx))
        {
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) Ajouter(r.GetString(0), r.GetString(1), "clé étrangère de la table");
        }
        return res.OrderBy(e => e.Objet, StringComparer.Ordinal).ToList();
    }

    /// <summary>Inscrit un forçage : utilisateur système, date, base, écarts (avec définitions) et motif.</summary>
    public static async Task EnregistrerForcageAsync(NpgsqlConnection cnx, IEnumerable<EcartSchema> ecarts, string motif, CancellationToken ct = default)
    {
        await AssurerTablesAsync(cnx, ct);
        await using var cmd = new NpgsqlCommand($"INSERT INTO {TableForcage} (ifo_utilisateur, ifo_base, ifo_ecarts, ifo_motif) VALUES (@u, @b, @e, @m)", cnx);
        cmd.Parameters.AddWithValue("u", Environment.UserName);
        cmd.Parameters.AddWithValue("b", cnx.Database!);
        cmd.Parameters.AddWithValue("e", JsonSerializer.Serialize(ecarts.Select(e => new { objet = e.Objet, type = e.Type, attendu = e.Attendu, reel = e.Reel }), OptionsJson));
        cmd.Parameters.AddWithValue("m", motif);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task Executer(NpgsqlConnection cnx, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, cnx);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
