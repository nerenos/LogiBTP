using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace LogiBTP.Installation;

/// <summary>Script appliqué à une base (table installation_script) : chemin du manifeste, empreinte SHA-256 du contenu, date.</summary>
public sealed record ScriptApplique(string Chemin, string Empreinte, DateTimeOffset AppliqueLe);

/// <summary>
/// Résultat de l'application du manifeste à une base. <paramref name="Acceptes"/> : scripts dont le journal portait une
/// ancienne empreinte acceptée (<see cref="EmpreintesAcceptees"/>), journal mis à jour.
/// </summary>
public sealed record BilanScripts(int Appliques, int Rejoues, IReadOnlyList<string> Modifies, IReadOnlyList<string>? Acceptes = null,
    IReadOnlyList<string>? HorsTransaction = null)
{
    public IReadOnlyList<string> AcceptesOuVide => Acceptes ?? [];
}

/// <summary>
/// Scripts déjà appliqués dont le contenu a changé (empreinte du journal différente) : une version publiée est immuable, la
/// correction est une nouvelle mineure. Levée avant toute application ; passer outre : forçage avec motif.
/// </summary>
public sealed class EmpreinteModifieeException(IReadOnlyList<string> scripts)
    : InvalidOperationException("Mise à jour refusée : script(s) modifié(s) après leur application (une version publiée est immuable : corriger par une nouvelle mineure ; sinon --forcer --motif \"…\") :\n  "
        + string.Join("\n  ", scripts))
{
    public IReadOnlyList<string> Scripts { get; } = scripts;
}

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
    /// Vrai si la base a déjà reçu un script de démonstration du manifeste (repérage au journal) : une mise à jour lui
    /// applique alors les scripts « demo » nouveaux ; sinon elle ne les reçoit jamais.
    /// </summary>
    public static async Task<bool> ADeLaDemoAsync(string connexion, IEnumerable<ScriptManifeste> scripts, CancellationToken ct = default)
    {
        var demo = scripts.Where(s => s.Demo).Select(s => s.Chemin).ToHashSet(StringComparer.Ordinal);
        return (await ScriptsAppliquesAsync(connexion, ct)).Any(a => demo.Contains(a.Chemin));
    }

    /// <summary>Clé du verrou consultatif PostgreSQL pris pendant l'application des scripts d'une base (« LOGIBT »).</summary>
    public const long CleVerrou = 0x4C4F47494254;

    /// <summary>
    /// Scripts du plan déjà inscrits dont le contenu a changé depuis leur application (empreinte du journal différente),
    /// hors rejouables (rejoués quand ils changent) et hors anciennes empreintes acceptées.
    /// </summary>
    public static async Task<List<string>> EmpreintesModifieesAsync(string connexion, string racine, IEnumerable<ScriptManifeste> scripts,
        EmpreintesAcceptees? acceptees = null, CancellationToken ct = default)
    {
        var deja = (await ScriptsAppliquesAsync(connexion, ct)).ToDictionary(x => x.Chemin, x => x.Empreinte, StringComparer.Ordinal);
        return Modifiees(scripts.ToList(), deja, racine, acceptees);
    }

    private static List<string> Modifiees(List<ScriptManifeste> liste, Dictionary<string, string> deja, string racine, EmpreintesAcceptees? acceptees)
    {
        var rejouables = liste.Where(x => x.Rejouable).Select(x => x.Chemin).ToHashSet(StringComparer.Ordinal);
        var res = new List<string>();
        foreach (var s in liste.Where(x => !x.Rejouable && !MigrationsCode.EstCode(x.Chemin) && !rejouables.Contains(x.Chemin)).DistinctBy(x => x.Chemin))
        {
            if (!deja.TryGetValue(s.Chemin, out var ancienne)) continue;
            if (Empreinte(File.ReadAllText(Path.Combine(racine, s.Chemin))) == ancienne) continue;
            if (acceptees?.Accepte(s.Chemin, ancienne) == true) continue;
            res.Add(s.Chemin);
        }
        return res;
    }

    /// <summary>
    /// Parcourt le plan dans son ordre sous un verrou consultatif (deux applications simultanées sont sérialisées) : un script
    /// absent du journal est appliqué à sa place ; une mineure (« majeur.mineur_nom.sql ») de même ; un « rejouable » est
    /// rejoué à sa place seulement s'il n'est pas encore inscrit comme rejouable, si son empreinte a changé, ou si une mineure
    /// de son module (ou d'un module dont il dépend : « requiert » des mineures ; le cœur dépend de tous) vient d'être
    /// appliquée dans cette exécution (les rejouables placés avant cette mineure sont alors rejoués à la fin). Les rejouables
    /// sont inscrits au journal avec leur empreinte.
    /// Un script déjà appliqué dont le contenu a changé est une erreur (<see cref="EmpreinteModifieeException"/>, avant toute
    /// application), sauf empreinte acceptée ou <paramref name="forcer"/> avec un <paramref name="motif"/> : forçage inscrit
    /// au journal des forçages, nouvelle empreinte inscrite sans exécution.
    /// <paramref name="adopter"/> : base existante créée hors de l'installeur, scripts inscrits sans être exécutés.
    /// <paramref name="scripts"/> : scripts à appliquer (l'appelant a retiré ceux de démonstration pour une base sans
    /// démonstration : <see cref="ManifesteScripts.Retenus"/>). <paramref name="acceptees"/> : anciennes empreintes
    /// acceptées ; un script déjà appliqué sous l'une d'elles n'est pas « modifié » : son journal reçoit la nouvelle
    /// empreinte, avec les scripts qui en ont été extraits (inscrits sans exécution), dans une même transaction.
    /// </summary>
    public async Task<BilanScripts> AppliquerAsync(string connexion, string racine, IEnumerable<ScriptManifeste> scripts, bool adopter = false,
        EmpreintesAcceptees? acceptees = null, bool forcer = false, string? motif = null, IReadOnlyList<IMigrationCode>? migrations = null,
        CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        await using (var verrou = new NpgsqlCommand("SELECT pg_advisory_lock(@k)", cnx) { CommandTimeout = 0 })
        {
            verrou.Parameters.AddWithValue("k", CleVerrou);
            await verrou.ExecuteNonQueryAsync(ct);
        }
        try { return await AppliquerSousVerrouAsync(cnx, racine, scripts.ToList(), adopter, acceptees, forcer, motif, migrations ?? [], ct); }
        finally
        {
            try
            {
                await using var libre = new NpgsqlCommand("SELECT pg_advisory_unlock(@k)", cnx);
                libre.Parameters.AddWithValue("k", CleVerrou);
                await libre.ExecuteNonQueryAsync(CancellationToken.None);
            }
            catch (Exception e) when (e is NpgsqlException or InvalidOperationException) { /* connexion perdue : le verrou de session tombe avec elle */ }
        }
    }

    private async Task<BilanScripts> AppliquerSousVerrouAsync(NpgsqlConnection cnx, string racine, List<ScriptManifeste> liste, bool adopter,
        EmpreintesAcceptees? acceptees, bool forcer, string? motif, IReadOnlyList<IMigrationCode> migrations, CancellationToken ct)
    {
        var codes = migrations.ToDictionary(MigrationsCode.Chemin, StringComparer.Ordinal);
        await ExecuterAsync(cnx, $"""
            CREATE TABLE IF NOT EXISTS {TableJournal} (
                isc_chemin      TEXT PRIMARY KEY,
                isc_empreinte   TEXT NOT NULL,
                isc_applique_le TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            COMMENT ON TABLE {TableJournal} IS 'Scripts SQL du manifeste appliqués à la base (module Installation)';
            """, ct);
        await JournalSchema.AssurerTablesAsync(cnx, ct);
        await VersionsModules.AssurerAsync(cnx, ct);
        var produit = VersionsModules.VersionProduit(racine);
        var deja = new Dictionary<string, string>(StringComparer.Ordinal);
        var types = new Dictionary<string, string?>(StringComparer.Ordinal);
        await using (var lecture = new NpgsqlCommand($"SELECT isc_chemin, isc_empreinte, isc_type FROM {TableJournal}", cnx))
        await using (var r = await lecture.ExecuteReaderAsync(ct))
            while (await r.ReadAsync(ct))
            {
                deja[r.GetString(0)] = r.GetString(1);
                types[r.GetString(0)] = r.IsDBNull(2) ? null : r.GetString(2);
            }
        var installee = deja.Count > 0;
        int appliques = 0, rejoues = 0;
        var modifies = new List<string>();
        var horsTransaction = new List<string>();
        var acceptes = new List<string>();
        if (!adopter && acceptees is { Lignes.Count: > 0 })
            await AccepterAnciennesEmpreintesAsync(cnx, racine, liste, deja, acceptes, acceptees, produit, ct);
        // Empreinte d'un script inscrit modifiée : refus avant toute application.
        var changes = adopter ? [] : Modifiees(liste, deja, racine, acceptees);
        if (changes.Count > 0)
        {
            if (!forcer) throw new EmpreinteModifieeException(changes);
            if (string.IsNullOrWhiteSpace(motif)) throw new ArgumentException("Forcer exige un motif (inscrit au journal des forçages)");
            await JournalSchema.EnregistrerForcageAsync(cnx, changes.Select(c => new EcartSchema("script:" + c, EcartSchema.Modifie, deja[c],
                Empreinte(File.ReadAllText(Path.Combine(racine, c))))), motif, ct);
        }
        var rejouablesChemins = liste.Where(x => x.Rejouable).Select(x => x.Chemin).ToHashSet(StringComparer.Ordinal);
        var dependances = await DependancesModulesAsync(racine, liste, ct);
        var touches = new HashSet<string>(StringComparer.Ordinal);
        var minApp = new List<(int Index, string Module)>();
        var vus = new HashSet<string>(StringComparer.Ordinal);

        async Task RejouerAsync(ScriptManifeste s, string contenu, string empreinte)
        {
            await ExecuterScriptAsync(cnx, s.Chemin, contenu, empreinte, ct, produit, VersionsModules.TypeRejouable);
            deja[s.Chemin] = empreinte;
            types[s.Chemin] = VersionsModules.TypeRejouable;
            rejoues++;
        }

        for (var i = 0; i < liste.Count; i++)
        {
            var s = liste[i];
            if (MigrationsCode.EstCode(s.Chemin))
            {
                // Migration de code : une mineure de son module, exécutée dans sa transaction et inscrite au journal.
                if (!vus.Add(s.Chemin) || deja.ContainsKey(s.Chemin)) continue;
                var migration = codes.GetValueOrDefault(s.Chemin) ?? throw new InvalidOperationException($"Migration de code {s.Chemin} absente de la liste déclarée");
                await ExecuterScriptAsync(cnx, s.Chemin, null, MigrationsCode.Empreinte(migration), ct, produit, null, false, adopter ? null : migration);
                deja[s.Chemin] = MigrationsCode.Empreinte(migration);
                types[s.Chemin] = VersionsModules.TypeMineure;
                appliques++;
                if (!adopter)
                {
                    touches.Add(migration.Module);
                    minApp.Add((i, migration.Module));
                }
                continue;
            }
            var contenu = await File.ReadAllTextAsync(Path.Combine(racine, s.Chemin), ct);
            var empreinte = Empreinte(contenu);
            if (s.Rejouable)
            {
                var aJour = deja.TryGetValue(s.Chemin, out var e0) && e0 == empreinte && types.GetValueOrDefault(s.Chemin) == VersionsModules.TypeRejouable;
                if (adopter)
                {
                    if (!aJour)
                    {
                        await ExecuterScriptAsync(cnx, s.Chemin, null, empreinte, ct, produit, VersionsModules.TypeRejouable);
                        deja[s.Chemin] = empreinte;
                        types[s.Chemin] = VersionsModules.TypeRejouable;
                    }
                    rejoues++;
                    continue;
                }
                if (aJour && !touches.Any(t => Affecte(VersionsModules.ModuleDe(s.Chemin), t, dependances))) continue;
                await RejouerAsync(s, contenu, empreinte);
                continue;
            }
            // Un chemin peut figurer deux fois (non rejouable puis rejouable) : la première occurrence seule compte ici.
            if (!vus.Add(s.Chemin)) continue;
            if (deja.TryGetValue(s.Chemin, out var e))
            {
                // Rejouable modifié : rejoué à sa place (occurrence rejouable), jamais une erreur.
                if (e != empreinte && !rejouablesChemins.Contains(s.Chemin))
                {
                    await ExecuterScriptAsync(cnx, s.Chemin, null, empreinte, ct, produit);
                    deja[s.Chemin] = empreinte;
                    modifies.Add(s.Chemin);
                }
                continue;
            }
            var mineure = VersionsModules.EstMineure(s.Chemin);
            var hors = mineure && !adopter && EnteteMineure.Lire(s.Chemin, contenu).HorsTransaction;
            // Ancien rejouable : déjà exécuté sur une base installée (jamais inscrit), seulement inscrit.
            await ExecuterScriptAsync(cnx, s.Chemin, adopter || (s.ExRejouable && installee) ? null : contenu, empreinte, ct, produit, null, hors);
            deja[s.Chemin] = empreinte;
            types[s.Chemin] = VersionsModules.TypeDe(s.Chemin);
            appliques++;
            if (hors) horsTransaction.Add(s.Chemin);
            if (mineure && !adopter)
            {
                var module = VersionsModules.ModuleDe(s.Chemin);
                touches.Add(module);
                minApp.Add((i, module));
            }
        }
        // Rejouables placés avant une mineure appliquée qui les concerne : rejoués après elle.
        if (!adopter && minApp.Count > 0)
        {
            var refaits = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < liste.Count; i++)
            {
                var s = liste[i];
                if (!s.Rejouable || refaits.Contains(s.Chemin)) continue;
                var module = VersionsModules.ModuleDe(s.Chemin);
                if (!minApp.Any(m => m.Index > i && Affecte(module, m.Module, dependances))) continue;
                var contenu = await File.ReadAllTextAsync(Path.Combine(racine, s.Chemin), ct);
                await RejouerAsync(s, contenu, Empreinte(contenu));
                refaits.Add(s.Chemin);
            }
        }
        journal.WriteLine($"{cnx.Database} : {appliques} script(s) {(adopter ? "inscrit(s) sans exécution" : "appliqué(s)")}, {rejoues} rejoué(s)"
            + (acceptes.Count > 0 ? $", {acceptes.Count} empreinte(s) acceptée(s) (script réduit depuis son application) : {string.Join(", ", acceptes)}" : "")
            + (horsTransaction.Count > 0 ? $", ATTENTION {horsTransaction.Count} script(s) exécuté(s) hors transaction (exception à relire) : {string.Join(", ", horsTransaction)}" : "")
            + (modifies.Count > 0 ? $", {modifies.Count} modifié(s) depuis leur application, forcé(s) (motif : {motif}) : {string.Join(", ", modifies)}" : ""));
        // Instantané du schéma après une application réussie (référence du prochain contrôle de dérive).
        await JournalSchema.EnregistrerInstantaneAsync(cnx, ct);
        return new BilanScripts(appliques, rejoues, modifies, acceptes, horsTransaction);
    }

    /// <summary>
    /// Modules dont chaque module dépend (fermeture transitive des « requiert » des mineures du plan) ; le cœur dépend de tous
    /// les autres.
    /// </summary>
    private static async Task<Dictionary<string, HashSet<string>>> DependancesModulesAsync(string racine, List<ScriptManifeste> liste, CancellationToken ct)
    {
        var directes = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var modules = liste.Select(s => VersionsModules.ModuleDe(s.Chemin)).ToHashSet(StringComparer.Ordinal);
        foreach (var s in liste.Where(x => VersionsModules.EstMineure(x.Chemin) && !MigrationsCode.EstCode(x.Chemin)).DistinctBy(x => x.Chemin))
        {
            var m = VersionsModules.ModuleDe(s.Chemin);
            var entete = EnteteMineure.Lire(s.Chemin, await File.ReadAllTextAsync(Path.Combine(racine, s.Chemin), ct));
            if (!directes.TryGetValue(m, out var d)) directes[m] = d = new HashSet<string>(StringComparer.Ordinal);
            foreach (var r in entete.Requiert) d.Add(r.Module);
        }
        directes[VersionsModules.Coeur] = modules.Where(x => x != VersionsModules.Coeur).ToHashSet(StringComparer.Ordinal);
        var res = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var m in directes.Keys)
        {
            var vus = new HashSet<string>(StringComparer.Ordinal);
            var pile = new Stack<string>(directes[m]);
            while (pile.Count > 0)
            {
                var x = pile.Pop();
                if (!vus.Add(x)) continue;
                if (directes.TryGetValue(x, out var suite)) foreach (var y in suite) pile.Push(y);
            }
            res[m] = vus;
        }
        return res;
    }

    /// <summary>Une mineure du module <paramref name="touche"/> concerne un rejouable du module <paramref name="module"/> : le même module ou un module dont il dépend.</summary>
    private static bool Affecte(string module, string touche, Dictionary<string, HashSet<string>> dependances) =>
        module == touche || (dependances.TryGetValue(module, out var d) && d.Contains(touche));

    /// <summary>
    /// Script déjà appliqué dont l'empreinte au journal est une ancienne empreinte acceptée : journal mis à jour, et scripts
    /// extraits de lui (« extrait-de= ») absents du journal inscrits sans exécution, en une transaction (jamais l'un sans
    /// l'autre : une reprise après interruption n'appliquerait pas deux fois les données extraites).
    /// </summary>
    private async Task AccepterAnciennesEmpreintesAsync(NpgsqlConnection cnx, string racine, List<ScriptManifeste> liste, Dictionary<string, string> deja,
        List<string> acceptes, EmpreintesAcceptees acceptees, string? produit, CancellationToken ct)
    {
        foreach (var s in liste.Where(x => !x.Rejouable && !MigrationsCode.EstCode(x.Chemin)).DistinctBy(x => x.Chemin))
        {
            if (!deja.TryGetValue(s.Chemin, out var ancienne)) continue;
            var empreinte = Empreinte(await File.ReadAllTextAsync(Path.Combine(racine, s.Chemin), ct));
            if (ancienne == empreinte || !acceptees.Accepte(s.Chemin, ancienne)) continue;
            await using var tx = await cnx.BeginTransactionAsync(ct);
            await InscrireAsync(cnx, tx, s.Chemin, empreinte, null, produit, null, ct);
            var extraits = new List<(string, string)>();
            foreach (var x in liste.Where(x => x.ExtraitDe == s.Chemin && !x.Rejouable && !deja.ContainsKey(x.Chemin)).DistinctBy(x => x.Chemin))
            {
                var e = Empreinte(await File.ReadAllTextAsync(Path.Combine(racine, x.Chemin), ct));
                await InscrireAsync(cnx, tx, x.Chemin, e, null, produit, null, ct);
                extraits.Add((x.Chemin, e));
            }
            await tx.CommitAsync(ct);
            deja[s.Chemin] = empreinte;
            foreach (var (c, e) in extraits) deja[c] = e;
            acceptes.Add(s.Chemin);
        }
    }

    private const string SqlInscription = $"""
        INSERT INTO {TableJournal} (isc_chemin, isc_empreinte, isc_module, isc_version, isc_type, isc_origine, isc_duree_ms, isc_version_produit)
        VALUES (@c, @e, @m, @v, @t, '{VersionsModules.OrigineLogiBtp}', @d, @p)
        ON CONFLICT (isc_chemin) DO UPDATE SET isc_empreinte = EXCLUDED.isc_empreinte, isc_applique_le = now(),
            isc_module = EXCLUDED.isc_module, isc_version = EXCLUDED.isc_version, isc_type = EXCLUDED.isc_type,
            isc_duree_ms = EXCLUDED.isc_duree_ms, isc_version_produit = EXCLUDED.isc_version_produit
        """;

    private static async Task InscrireAsync(NpgsqlConnection cnx, NpgsqlTransaction tx, string chemin, string empreinte, int? dureeMs, string? produit, string? type, CancellationToken ct)
    {
        await using var ins = new NpgsqlCommand(SqlInscription, cnx, tx);
        ins.Parameters.AddWithValue("c", chemin);
        ins.Parameters.AddWithValue("e", empreinte);
        ins.Parameters.AddWithValue("m", VersionsModules.ModuleDe(chemin));
        ins.Parameters.AddWithValue("v", VersionsModules.VersionDe(chemin).ToString());
        ins.Parameters.AddWithValue("t", type ?? VersionsModules.TypeDe(chemin));
        ins.Parameters.AddWithValue("d", (object?)dureeMs ?? DBNull.Value);
        ins.Parameters.AddWithValue("p", (object?)produit ?? DBNull.Value);
        await ins.ExecuteNonQueryAsync(ct);
    }

    private async Task ExecuterScriptAsync(NpgsqlConnection cnx, string chemin, string? contenu, string? empreinte, CancellationToken ct, string? produit = null,
        string? type = null, bool horsTransaction = false, IMigrationCode? migration = null)
    {
        var chrono = System.Diagnostics.Stopwatch.StartNew();
        if (horsTransaction)
        {
            // Exception signalée : exécuté sans transaction (une seule instruction SQL : Npgsql envoie un lot en un bloc implicite).
            try
            {
                if (contenu is not null)
                {
                    await using var cmd = new NpgsqlCommand(contenu, cnx) { CommandTimeout = 0 };
                    await cmd.ExecuteNonQueryAsync(ct);
                }
            }
            catch (PostgresException e)
            {
                throw new InvalidOperationException($"{cnx.Database} : échec de {chemin} (hors transaction : l'état de la base peut être partiel) : {e.MessageText}", e);
            }
            if (empreinte is not null)
            {
                await using var txi = await cnx.BeginTransactionAsync(ct);
                await InscrireAsync(cnx, txi, chemin, empreinte, contenu is null ? 0 : (int)chrono.ElapsedMilliseconds, produit, type, ct);
                await txi.CommitAsync(ct);
            }
            return;
        }
        await using var tx = await cnx.BeginTransactionAsync(ct);
        try
        {
            if (contenu is not null)
            {
                await using var cmd = new NpgsqlCommand(contenu, cnx, tx) { CommandTimeout = 0 };
                await cmd.ExecuteNonQueryAsync(ct);
            }
            if (migration is not null) await migration.ExecuterAsync(cnx, tx, ct);
            if (empreinte is not null) await InscrireAsync(cnx, tx, chemin, empreinte, contenu is null && migration is null ? 0 : (int)chrono.ElapsedMilliseconds, produit, type, ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception e) when (migration is not null && e is not PostgresException and not OperationCanceledException)
        {
            await tx.RollbackAsync(ct);
            throw new InvalidOperationException($"{cnx.Database} : échec de la migration de code {chemin} : {e.Message}", e);
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
