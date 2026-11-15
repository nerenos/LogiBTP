using System.Diagnostics;
using System.Text;
using LogiBTP.Installation;
using LogiBTP.Socle.Testing;
using Npgsql;
using Xunit;

namespace LogiBTP.Installation.Tests;

/// <summary>
/// Application du manifeste à une vraie base (plan versionnement-schema, lot 0). Conditionné à la variable
/// LOGIBTP_TEST_PG_ADMIN (connexion Npgsql d'un superutilisateur) : sinon les tests se terminent aussitôt, jamais en échec.
/// Les bases d'essai (préfixe test_inst_) sont créées puis supprimées par le test.
/// </summary>
// Collection commune : les essais sur une vraie base ne se jouent pas en parallèle (la charge fait varier des données tirées au hasard
// par des scripts de démonstration d'avant le lot, ce que compare ScriptsBaseTests).
[Collection("PostgreSQL")]
public class ScriptsBaseTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");

    [Fact]
    public async Task Base_neuve_par_AppliquerAsync_egale_base_neuve_par_l_ordre_du_manifeste()
    {
        if (Admin is null) return;
        var racine = CasPartages.RacineDepot();
        var manifeste = ManifesteScripts.Lire(racine);
        await using var a = await BaseEssai.CreerAsync(Admin);
        await using var b = await BaseEssai.CreerAsync(Admin);

        var bilan = await new BaseDonnees(TextWriter.Null).AppliquerAsync(a.Connexion, racine, manifeste.Scripts);
        Assert.Equal(manifeste.Scripts.Where(s => !s.Rejouable).Select(s => s.Chemin).Distinct().Count(), bilan.Appliques);
        Assert.Equal(manifeste.Scripts.Count(s => s.Rejouable), bilan.Rejoues);
        Assert.Empty(bilan.Modifies);

        // Référence : chaque script du manifeste exécuté tel quel, dans l'ordre (comme initialiser-developpement.sh).
        await using (var cnx = new NpgsqlConnection(b.Connexion))
        {
            await cnx.OpenAsync();
            foreach (var s in manifeste.Scripts)
            {
                await using var cmd = new NpgsqlCommand(await File.ReadAllTextAsync(Path.Combine(racine, s.Chemin)), cnx) { CommandTimeout = 0 };
                await cmd.ExecuteNonQueryAsync();
            }
        }
        Assert.Equal(Instantane(b), Instantane(a));
    }

    [Fact]
    public async Task Seconde_application_et_rejouables_rejoues_ne_changent_rien()
    {
        if (Admin is null) return;
        var racine = CasPartages.RacineDepot();
        var manifeste = ManifesteScripts.Lire(racine);
        await using var a = await BaseEssai.CreerAsync(Admin);
        var moteur = new BaseDonnees(TextWriter.Null);

        await moteur.AppliquerAsync(a.Connexion, racine, manifeste.Scripts);
        var apres1 = Instantane(a);

        var bilan2 = await moteur.AppliquerAsync(a.Connexion, racine, manifeste.Scripts);
        Assert.Equal(0, bilan2.Appliques);
        Assert.Equal(0, bilan2.Rejoues); // rejouables inscrits avec leur empreinte : rien n'a changé, rien n'est rejoué
        Assert.Empty(bilan2.Modifies);
        var apres2 = Instantane(a);
        Assert.Equal(apres1, apres2);

        Assert.Empty((await ControleSchema.ControlerAsync(a.Connexion, racine, manifeste.Scripts)).Ecarts); // instantané stable sur le vrai schéma
        var bilan3 = await moteur.AppliquerAsync(a.Connexion, racine, manifeste.Scripts);
        Assert.Equal(0, bilan3.Appliques);
        Assert.Equal(apres2, Instantane(a));
    }

    [Fact]
    public async Task Adopter_inscrit_sans_executer()
    {
        if (Admin is null) return;
        var racine = CasPartages.RacineDepot();
        var manifeste = ManifesteScripts.Lire(racine);
        await using var a = await BaseEssai.CreerAsync(Admin);
        var bilan = await new BaseDonnees(TextWriter.Null).AppliquerAsync(a.Connexion, racine, manifeste.Scripts, adopter: true);
        Assert.Equal(manifeste.Scripts.Where(s => !s.Rejouable).Select(s => s.Chemin).Distinct().Count(), bilan.Appliques);
        Assert.Equal(manifeste.Scripts.Select(s => s.Chemin).Distinct().Count(), (await BaseDonnees.ScriptsAppliquesAsync(a.Connexion)).Count); // rejouables inscrits aussi
        await using var cnx = new NpgsqlConnection(a.Connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'installation\\_%'", cnx);
        Assert.Equal(0L, (long)(await cmd.ExecuteScalarAsync())!); // seulement les tables du moteur
    }

    /// <summary>pg_dump (schéma et données) normalisé : sans journal, valeurs de séquences, commentaires de version.</summary>
    internal static string Instantane(BaseEssai b)
    {
        var csb = new NpgsqlConnectionStringBuilder(b.Connexion);
        var psi = new ProcessStartInfo(TrouverPgDump())
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
        };
        foreach (var arg in new[] { "-h", csb.Host!, "-p", csb.Port.ToString(), "-U", csb.Username!, "-d", csb.Database!, "--no-owner", "--no-privileges", "-T", "installation_*", "-T", "v_version_module" })
            psi.ArgumentList.Add(arg);
        psi.Environment["PGPASSWORD"] = csb.Password ?? "";
        using var p = Process.Start(psi)!;
        var erreur = p.StandardError.ReadToEndAsync();
        var sortie = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        Assert.True(p.ExitCode == 0, "pg_dump : " + erreur.Result);
        var resultat = new List<string>();
        var bloc = new List<string>();
        var dansCopy = false;
        foreach (var l in sortie.Split('\n'))
        {
            if (l.Contains("pg_catalog.setval") || l.StartsWith("-- Dumped", StringComparison.Ordinal)
                || l.StartsWith("\\restrict", StringComparison.Ordinal) || l.StartsWith("\\unrestrict", StringComparison.Ordinal)) continue;
            // Données : horodatages (now()) et UUID aléatoires neutralisés, lignes d'une table triées (l'ordre physique
            // change après une réécriture sans que les données changent).
            if (dansCopy)
            {
                if (l == "\\.") { bloc.Sort(StringComparer.Ordinal); resultat.AddRange(bloc); bloc.Clear(); dansCopy = false; resultat.Add(l); }
                else bloc.Add(Uuid().Replace(Horodatage().Replace(l, "<horodatage>"), "<uuid>"));
                continue;
            }
            dansCopy = l.StartsWith("COPY ", StringComparison.Ordinal) && l.EndsWith("FROM stdin;", StringComparison.Ordinal);
            resultat.Add(l);
        }
        return string.Join('\n', resultat);
    }

    private static System.Text.RegularExpressions.Regex Uuid() => new(@"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private static System.Text.RegularExpressions.Regex Horodatage() => new(@"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?(\+\d\d)?");

    private static string TrouverPgDump()
    {
        foreach (var d in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
            if (File.Exists(Path.Combine(d, "pg_dump"))) return Path.Combine(d, "pg_dump");
        var usr = "/usr/lib/postgresql";
        if (Directory.Exists(usr))
            foreach (var v in Directory.GetDirectories(usr).OrderByDescending(x => x, StringComparer.Ordinal))
                if (File.Exists(Path.Combine(v, "bin", "pg_dump"))) return Path.Combine(v, "bin", "pg_dump");
        return "pg_dump";
    }

    /// <summary>Base d'essai créée à la demande, supprimée à la fin.</summary>
    internal sealed class BaseEssai : IAsyncDisposable
    {
        private readonly string _admin;
        private readonly string _nom;
        public string Connexion { get; }

        private BaseEssai(string admin, string nom)
        {
            _admin = admin;
            _nom = nom;
            Connexion = new NpgsqlConnectionStringBuilder(admin) { Database = nom, Pooling = false }.ConnectionString;
        }

        public static async Task<BaseEssai> CreerAsync(string admin)
        {
            var nom = "test_inst_" + Guid.NewGuid().ToString("N")[..12];
            await using var cnx = new NpgsqlConnection(admin);
            await cnx.OpenAsync();
            await using var cmd = new NpgsqlCommand($"CREATE DATABASE {nom} ENCODING 'UTF8' TEMPLATE template0", cnx);
            await cmd.ExecuteNonQueryAsync();
            return new BaseEssai(admin, nom);
        }

        public async ValueTask DisposeAsync()
        {
            NpgsqlConnection.ClearAllPools();
            await using var cnx = new NpgsqlConnection(_admin);
            await cnx.OpenAsync();
            await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS {_nom} WITH (FORCE)", cnx);
            await cmd.ExecuteNonQueryAsync();
        }
    }
}
