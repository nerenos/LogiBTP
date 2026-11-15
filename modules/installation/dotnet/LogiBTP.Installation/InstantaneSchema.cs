using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Npgsql;

namespace LogiBTP.Installation;

/// <summary>
/// Lecture normalisée du catalogue du schéma public (plan versionnement-schema, lot 1) : une entrée par objet
/// (« table:t », « colonne:t.c », « contrainte:t.n », « index:t.i », « vue:v », « fonction:f(args) », « declencheur:t.d »)
/// et sa définition ; sérialisée en JSON stable (ordre binaire des clés). Les tables du moteur (installation_*) et les
/// objets d'extensions n'y figurent pas.
/// </summary>
public sealed class InstantaneSchema
{
    private static readonly JsonSerializerOptions OptionsJson = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public IReadOnlyDictionary<string, string> Objets { get; }

    public InstantaneSchema(IEnumerable<KeyValuePair<string, string>> objets) =>
        Objets = new SortedDictionary<string, string>(objets.ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal), StringComparer.Ordinal);

    public string ToJson() => JsonSerializer.Serialize(Objets, OptionsJson);

    public static InstantaneSchema DepuisJson(string json) =>
        new(JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? throw new FormatException("Instantané de schéma illisible"));

    public string Empreinte() => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(ToJson())));

    public static async Task<InstantaneSchema> LireAsync(string connexion, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        return await LireAsync(cnx, ct);
    }

    public static async Task<InstantaneSchema> LireAsync(NpgsqlConnection cnx, CancellationToken ct = default)
    {
        var o = new Dictionary<string, string>(StringComparer.Ordinal);
        var tables = new HashSet<string>(StringComparer.Ordinal);
        await Lire(cnx, """
            SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname NOT LIKE 'installation\_%'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
            """, r => { tables.Add(r.GetString(0)); o["table:" + r.GetString(0)] = "table"; }, ct);
        await Lire(cnx, """
            SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                   coalesce(pg_get_expr(d.adbin, d.adrelid), ''), a.attidentity::text, a.attgenerated::text
            FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
            """, r =>
            {
                if (!tables.Contains(r.GetString(0))) return;
                o[$"colonne:{r.GetString(0)}.{r.GetString(1)}"] =
                    $"{r.GetString(2)} {(r.GetBoolean(3) ? "NOT NULL" : "NULL")}"
                    + (r.GetString(4).Length > 0 ? " DEFAULT " + r.GetString(4) : "")
                    + (r.GetString(5).Trim('\0', ' ').Length > 0 ? " IDENTITY " + r.GetString(5) : "")
                    + (r.GetString(6).Trim('\0', ' ').Length > 0 ? " GENERATED " + r.GetString(6) : "");
            }, ct);
        await Lire(cnx, """
            SELECT c.relname, k.conname, pg_get_constraintdef(k.oid)
            FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND k.contype IN ('p', 'u', 'f', 'c', 'x')
            """, r => { if (tables.Contains(r.GetString(0))) o[$"contrainte:{r.GetString(0)}.{r.GetString(1)}"] = r.GetString(2); }, ct);
        await Lire(cnx, "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'",
            r => { if (tables.Contains(r.GetString(0))) o[$"index:{r.GetString(0)}.{r.GetString(1)}"] = r.GetString(2); }, ct);
        await Lire(cnx, """
            SELECT c.relname, pg_get_viewdef(c.oid, true) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') AND c.relname NOT LIKE 'installation\_%' AND c.relname <> 'v_version_module'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
            """, r => o["vue:" + r.GetString(0)] = r.GetString(1), ct);
        await Lire(cnx, """
            SELECT p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid), md5(p.prosrc)
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
            """, r => o[$"fonction:{r.GetString(0)}({r.GetString(1)})"] = $"retour {r.GetString(2)} ; source md5 {r.GetString(3)}", ct);
        await Lire(cnx, """
            SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid, true)
            FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE NOT t.tgisinternal AND n.nspname = 'public'
            """, r => { if (tables.Contains(r.GetString(0))) o[$"declencheur:{r.GetString(0)}.{r.GetString(1)}"] = r.GetString(2); }, ct);
        return new InstantaneSchema(o);
    }

    private static async Task Lire(NpgsqlConnection cnx, string sql, Action<NpgsqlDataReader> ligne, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, cnx);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) ligne(r);
    }
}
