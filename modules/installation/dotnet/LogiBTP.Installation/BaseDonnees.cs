using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace LogiBTP.Installation;

/// <summary>Script appliqué à une base (table installation_script) : chemin du manifeste, empreinte SHA-256 du contenu, date.</summary>
public sealed record ScriptApplique(string Chemin, string Empreinte, DateTimeOffset AppliqueLe);

/// <summary>Résultat de l'application du manifeste à une base.</summary>
public sealed record BilanScripts(int Appliques, int Rejoues, IReadOnlyList<string> Modifies);

/// <summary>
/// Opérations de l'installeur sur PostgreSQL (ANALYSE-MODULE-INSTALLATION.md § 6.2) : bases, mots de passe des rôles,
/// scripts du manifeste appliqués une fois (journal installation_script) ou rejoués, script des rôles.
/// Chaque script s'applique dans sa propre transaction avec son inscription au journal.
/// </summary>
public sealed class BaseDonnees(TextWriter journal)
{
    public const string TableJournal = "installation_script";

    /// <summary>Nom d'une base : minuscules, chiffres et _ (sert aussi de dossier de la GED).</summary>
    public static string VerifierNom(string nom)
    {
        if (string.IsNullOrEmpty(nom) || nom.Length > 63 || !char.IsAsciiLetterLower(nom[0]) || !nom.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '_'))
            throw new ArgumentException($"Nom de base invalide : « {nom} » (minuscules, chiffres et _ ; commence par une lettre)");
        return nom;
    }

    public static async Task<bool> BaseExisteAsync(string connexionAdmin, string nom, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexionAdmin);
        await cnx.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = @n)", cnx);
        cmd.Parameters.AddWithValue("n", nom);
        return (bool)(await cmd.ExecuteScalarAsync(ct))!;
    }

    /// <summary>Crée les rôles s'ils manquent et fixe leur mot de passe (rejouable ; un mot de passe vide laisse le rôle inchangé).</summary>
    public async Task DefinirRolesAsync(string connexionAdmin, IReadOnlyDictionary<string, string?> motsDePasse, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexionAdmin);
        await cnx.OpenAsync(ct);
        foreach (var (role, mdp) in motsDePasse)
        {
            if (role == "postgres") continue;
            VerifierNom(role);
            await ExecuterAsync(cnx, $"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN CREATE ROLE {role} LOGIN; END IF; END $$", ct);
            if (!string.IsNullOrEmpty(mdp)) await ExecuterAsync(cnx, $"ALTER ROLE {role} WITH LOGIN PASSWORD {Litteral(mdp)}", ct);
        }
        journal.WriteLine($"Rôles à jour : {string.Join(", ", motsDePasse.Keys.Where(r => r != "postgres"))}");
    }

    /// <summary>Crée la base (propriétaire donné) si elle n'existe pas ; renvoie vrai si elle vient d'être créée.</summary>
    public async Task<bool> CreerBaseAsync(string connexionAdmin, string nom, string proprietaire, CancellationToken ct = default)
    {
        VerifierNom(nom);
        VerifierNom(proprietaire);
        if (await BaseExisteAsync(connexionAdmin, nom, ct))
        {
            journal.WriteLine($"Base {nom} : existe déjà");
            return false;
        }
        await using var cnx = new NpgsqlConnection(connexionAdmin);
        await cnx.OpenAsync(ct);
        await ExecuterAsync(cnx, $"CREATE DATABASE {nom} OWNER {proprietaire} ENCODING 'UTF8' TEMPLATE template0", ct);
        journal.WriteLine($"Base {nom} : créée (propriétaire {proprietaire})");
        return true;
    }

    /// <summary>Scripts déjà appliqués à la base (journal vide si la table n'existe pas).</summary>
    public static async Task<List<ScriptApplique>> ScriptsAppliquesAsync(string connexion, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        var res = new List<ScriptApplique>();
        await using var existe = new NpgsqlCommand($"SELECT to_regclass('{TableJournal}') IS NOT NULL", cnx);
        if (!(bool)(await existe.ExecuteScalarAsync(ct))!) return res;
        await using var cmd = new NpgsqlCommand($"SELECT isc_chemin, isc_empreinte, isc_applique_le FROM {TableJournal} ORDER BY isc_applique_le, isc_chemin", cnx);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) res.Add(new ScriptApplique(r.GetString(0), r.GetString(1), r.GetFieldValue<DateTimeOffset>(2)));
        return res;
    }

    public static string Empreinte(string contenu) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(contenu.Replace("\r\n", "\n"))));

    /// <summary>
    /// Applique les scripts du manifeste absents du journal (dans l'ordre), puis rejoue les scripts « rejouable ».
    /// Un script déjà appliqué dont le contenu a changé n'est pas rejoué : il est signalé (Modifies).
    /// <paramref name="adopter"/> : base existante créée hors de l'installeur, scripts inscrits sans être exécutés.
    /// </summary>
    public async Task<BilanScripts> AppliquerAsync(string connexion, string racine, IEnumerable<ScriptManifeste> scripts, bool adopter = false, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        await ExecuterAsync(cnx, $"""
            CREATE TABLE IF NOT EXISTS {TableJournal} (
                isc_chemin      TEXT PRIMARY KEY,
                isc_empreinte   TEXT NOT NULL,
                isc_applique_le TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            COMMENT ON TABLE {TableJournal} IS 'Scripts SQL du manifeste appliqués à la base (module Installation)';
            """, ct);
        var deja = (await ScriptsAppliquesAsync(connexion, ct)).ToDictionary(s => s.Chemin, s => s.Empreinte, StringComparer.Ordinal);
        int appliques = 0, rejoues = 0;
        var modifies = new List<string>();
        var liste = scripts.ToList();
        foreach (var s in liste.Where(s => !s.Rejouable).DistinctBy(s => s.Chemin))
        {
            var contenu = await File.ReadAllTextAsync(Path.Combine(racine, s.Chemin), ct);
            var empreinte = Empreinte(contenu);
            if (deja.TryGetValue(s.Chemin, out var e))
            {
                if (e != empreinte) modifies.Add(s.Chemin);
                continue;
            }
            await ExecuterScriptAsync(cnx, s.Chemin, adopter ? null : contenu, empreinte, ct);
            appliques++;
        }
        foreach (var s in liste.Where(s => s.Rejouable))
        {
            var contenu = await File.ReadAllTextAsync(Path.Combine(racine, s.Chemin), ct);
            if (!adopter) await ExecuterScriptAsync(cnx, s.Chemin, contenu, null, ct);
            rejoues++;
        }
        journal.WriteLine($"{cnx.Database} : {appliques} script(s) {(adopter ? "inscrit(s) sans exécution" : "appliqué(s)")}, {rejoues} rejoué(s)"
            + (modifies.Count > 0 ? $", {modifies.Count} modifié(s) depuis leur application (non rejoués) : {string.Join(", ", modifies)}" : ""));
        return new BilanScripts(appliques, rejoues, modifies);
    }

    private async Task ExecuterScriptAsync(NpgsqlConnection cnx, string chemin, string? contenu, string? empreinte, CancellationToken ct)
    {
        await using var tx = await cnx.BeginTransactionAsync(ct);
        try
        {
            if (contenu is not null)
            {
                await using var cmd = new NpgsqlCommand(contenu, cnx, tx) { CommandTimeout = 0 };
                await cmd.ExecuteNonQueryAsync(ct);
            }
            if (empreinte is not null)
            {
                await using var ins = new NpgsqlCommand($"""
                    INSERT INTO {TableJournal} (isc_chemin, isc_empreinte) VALUES (@c, @e)
                    ON CONFLICT (isc_chemin) DO UPDATE SET isc_empreinte = EXCLUDED.isc_empreinte, isc_applique_le = now()
                    """, cnx, tx);
                ins.Parameters.AddWithValue("c", chemin);
                ins.Parameters.AddWithValue("e", empreinte);
                await ins.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
        }
        catch (PostgresException e)
        {
            await tx.RollbackAsync(ct);
            throw new InvalidOperationException($"{cnx.Database} : échec de {chemin} : {e.MessageText}" + (e.Position > 0 ? $" (position {e.Position})" : ""), e);
        }
    }

    /// <summary>Script SQL exécuté tel quel (script des rôles), en une transaction.</summary>
    public async Task ExecuterFichierAsync(string connexion, string chemin, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        await ExecuterScriptAsync(cnx, Path.GetFileName(chemin), await File.ReadAllTextAsync(chemin, ct), null, ct);
        journal.WriteLine($"{cnx.Database} : {Path.GetFileName(chemin)} appliqué");
    }

    /// <summary>Littéral SQL entre apostrophes (apostrophes doublées).</summary>
    public static string Litteral(string v) => "'" + v.Replace("'", "''") + "'";

    private static async Task ExecuterAsync(NpgsqlConnection cnx, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, cnx);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
