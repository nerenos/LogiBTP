using System.Text.RegularExpressions;
using Npgsql;

namespace LogiBTP.Installation;

/// <summary>Version courante d'un module dans une base : plus haute version appliquée et date de dernière application.</summary>
public sealed record VersionModuleBase(string Module, VersionModule Version, DateTimeOffset AppliqueLe);

/// <summary>
/// Versions par module (plan versionnement-schema, lot 3) : module et version d'un script déduits de son chemin, colonnes
/// ajoutées au journal et vue v_version_module (créées par le code, jamais par un script du manifeste), version produit.
/// </summary>
public static partial class VersionsModules
{
    public const string Coeur = "coeur";
    public const string Vue = "v_version_module";
    public const string OrigineLogiBtp = "logibtp";
    public const string FichierVersionProduit = "db/installation/version.txt";

    public const string TypeSocle = "socle";
    public const string TypeMineure = "mineure";
    public const string TypeRejouable = "rejouable";
    public const string TypeZone = "zone";

    [GeneratedRegex(@"^(\d+\.\d+)_[^/]+\.sql$")]
    private static partial Regex FormeMineure();

    /// <summary>Module d'un script : modules/&lt;m&gt;/db/… → m ; db/… → coeur.</summary>
    public static string ModuleDe(string chemin)
    {
        var p = chemin.Split('/');
        if (p.Length >= 4 && p[0] == "modules" && p[2] == "db" && p[1].Length > 0) return p[1];
        if (p.Length >= 2 && p[0] == "db") return Coeur;
        throw new ArgumentException($"Chemin de script hors db/ et modules/<module>/db/ : « {chemin} »");
    }

    /// <summary>Version d'un script : 1.0 (socle) ; une mineure « &lt;majeur&gt;.&lt;mineur&gt;_&lt;nom&gt;.sql » porte sa version (lot 4).</summary>
    public static VersionModule VersionDe(string chemin) =>
        FormeMineure().Match(Path.GetFileName(chemin)) is { Success: true } m ? VersionModule.Analyser(m.Groups[1].Value) : VersionModule.Socle;

    /// <summary>Type au journal d'un script non rejouable : socle (1.0) ou mineure.</summary>
    public static string TypeDe(string chemin) => VersionDe(chemin) == VersionModule.Socle && !FormeMineure().IsMatch(Path.GetFileName(chemin)) ? TypeSocle : TypeMineure;

    /// <summary>Version produit (db/installation/version.txt, première ligne non vide), ou null.</summary>
    public static string? VersionProduit(string racine)
    {
        var f = Path.Combine(racine, FichierVersionProduit);
        return File.Exists(f) ? File.ReadLines(f).Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0 && !l.StartsWith('#')) : null;
    }

    /// <summary>Colonnes du journal et vue des versions (rejouable) ; lignes d'avant le lot complétées (module, version, type déduits du chemin).</summary>
    public static async Task AssurerAsync(NpgsqlConnection cnx, CancellationToken ct = default)
    {
        await Executer(cnx, $"""
            ALTER TABLE {BaseDonnees.TableJournal}
                ADD COLUMN IF NOT EXISTS isc_module          TEXT,
                ADD COLUMN IF NOT EXISTS isc_version         TEXT,
                ADD COLUMN IF NOT EXISTS isc_type            TEXT,
                ADD COLUMN IF NOT EXISTS isc_origine         TEXT NOT NULL DEFAULT '{OrigineLogiBtp}',
                ADD COLUMN IF NOT EXISTS isc_duree_ms        INTEGER,
                ADD COLUMN IF NOT EXISTS isc_version_produit TEXT;
            CREATE OR REPLACE VIEW {Vue} AS
            SELECT isc_module AS vmo_module,
                   (array_agg(isc_version ORDER BY split_part(isc_version, '.', 1)::int DESC, split_part(isc_version, '.', 2)::int DESC))[1] AS vmo_version,
                   max(isc_applique_le) AS vmo_applique_le
              FROM {BaseDonnees.TableJournal}
             WHERE isc_module IS NOT NULL AND isc_version IS NOT NULL
             GROUP BY isc_module;
            """, ct);
        var chemins = new List<string>();
        await using (var cmd = new NpgsqlCommand($"SELECT isc_chemin FROM {BaseDonnees.TableJournal} WHERE isc_module IS NULL OR isc_version IS NULL OR isc_type IS NULL", cnx))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
            while (await r.ReadAsync(ct)) chemins.Add(r.GetString(0));
        if (chemins.Count == 0) return;
        await using var tx = await cnx.BeginTransactionAsync(ct);
        foreach (var c in chemins)
        {
            string module;
            try { module = ModuleDe(c); } catch (ArgumentException) { continue; }
            await using var upd = new NpgsqlCommand($"UPDATE {BaseDonnees.TableJournal} SET isc_module = @m, isc_version = @v, isc_type = @t WHERE isc_chemin = @c", cnx, tx);
            upd.Parameters.AddWithValue("m", module);
            upd.Parameters.AddWithValue("v", VersionDe(c).ToString());
            upd.Parameters.AddWithValue("t", TypeDe(c));
            upd.Parameters.AddWithValue("c", c);
            await upd.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }

    /// <summary>Versions courantes par module (vue v_version_module) ; vide si la base n'a pas encore reçu le lot (vue absente).</summary>
    public static async Task<List<VersionModuleBase>> VersionsModulesAsync(NpgsqlConnection cnx, CancellationToken ct = default)
    {
        var res = new List<VersionModuleBase>();
        await using (var existe = new NpgsqlCommand("SELECT to_regclass(@v) IS NOT NULL", cnx))
        {
            existe.Parameters.AddWithValue("v", Vue);
            if (!(bool)(await existe.ExecuteScalarAsync(ct))!) return res;
        }
        await using var cmd = new NpgsqlCommand($"SELECT vmo_module, vmo_version, vmo_applique_le FROM {Vue} ORDER BY vmo_module COLLATE \"C\"", cnx);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) res.Add(new VersionModuleBase(r.GetString(0), VersionModule.Analyser(r.GetString(1)), r.GetFieldValue<DateTimeOffset>(2)));
        return res;
    }

    /// <summary>Idem avec une chaîne de connexion.</summary>
    public static async Task<List<VersionModuleBase>> VersionsModulesAsync(string connexion, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        return await VersionsModulesAsync(cnx, ct);
    }

    /// <summary>Version produit de la dernière application inscrite au journal, ou null.</summary>
    public static async Task<string?> VersionProduitBaseAsync(NpgsqlConnection cnx, CancellationToken ct = default)
    {
        await using var existe = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = @t AND column_name = 'isc_version_produit' AND table_schema = current_schema())", cnx);
        existe.Parameters.AddWithValue("t", BaseDonnees.TableJournal);
        if (!(bool)(await existe.ExecuteScalarAsync(ct))!) return null;
        await using var cmd = new NpgsqlCommand($"SELECT isc_version_produit FROM {BaseDonnees.TableJournal} WHERE isc_version_produit IS NOT NULL ORDER BY isc_applique_le DESC, isc_chemin DESC LIMIT 1", cnx);
        return await cmd.ExecuteScalarAsync(ct) as string;
    }

    private static async Task Executer(NpgsqlConnection cnx, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, cnx);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
