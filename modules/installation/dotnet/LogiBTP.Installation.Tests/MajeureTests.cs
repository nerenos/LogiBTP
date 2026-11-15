using LogiBTP.Installation;
using Npgsql;
using Xunit;

namespace LogiBTP.Installation.Tests;

/// <summary>
/// Passage d'un module en majeure, archivage, contrôle de publication (plan versionnement-schema, lot 9), sur un module témoin fictif
/// « t » (dépôt temporaire) : 1.0 + 1.1 + 1.2, puis 2.0, 2.1, 3.0. Aucun module réel du dépôt n'est touché.
/// </summary>
[Collection("PostgreSQL")]
public class MajeureTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");

    private sealed class Depot : IDisposable
    {
        public string Racine { get; } = Path.Combine(Path.GetTempPath(), "logibtp_majeure_" + Guid.NewGuid().ToString("N")[..10]);

        public Depot()
        {
            Ecrire("db/installation/socle-1.0.txt",
                "modules/t/db/001_t.sql\nmodules/b/db/001_b.sql\nmodules/t/db/002_t_vue.sql rejouable\n\n# ---- rejouables de fin du socle : x ----\ndb/010_coeur.sql rejouable\n");
            Ecrire("modules/t/db/001_t.sql", "CREATE TABLE t_t (t_id int PRIMARY KEY);");
            Ecrire("modules/b/db/001_b.sql", "CREATE TABLE b_t (b_id int PRIMARY KEY);");
            Ecrire("modules/t/db/002_t_vue.sql", "CREATE OR REPLACE VIEW v_t AS SELECT t_id FROM t_t;");
            Ecrire("db/010_coeur.sql", "CREATE OR REPLACE VIEW v_coeur AS SELECT b_id FROM b_t;");
            Ecrire("modules/t/db/1.1_colonne.sql", "ALTER TABLE t_t ADD COLUMN t_x text;");
            Ecrire("modules/b/db/1.1_reprise.sql", "-- requiert: t 1.1\nCREATE TABLE b_u AS SELECT t_x FROM t_t;");
        }

        public void Ecrire(string chemin, string contenu)
        {
            var f = Path.Combine(Racine, chemin);
            Directory.CreateDirectory(Path.GetDirectoryName(f)!);
            File.WriteAllText(f, contenu);
        }

        public PlanScripts Plan() => PlanScripts.Calculer(Racine);

        public string Copie()
        {
            var cible = Racine + "_copie_" + Guid.NewGuid().ToString("N")[..6];
            foreach (var f in Directory.GetFiles(Racine, "*", SearchOption.AllDirectories))
            {
                var c = Path.Combine(cible, Path.GetRelativePath(Racine, f));
                Directory.CreateDirectory(Path.GetDirectoryName(c)!);
                File.Copy(f, c);
            }
            return cible;
        }

        public void Dispose()
        {
            Directory.Delete(Racine, true);
            foreach (var c in Directory.GetDirectories(Path.GetDirectoryName(Racine)!, Path.GetFileName(Racine) + "_copie_*")) Directory.Delete(c, true);
        }
    }

    private static string[] Chemins(PlanScripts p) => p.Scripts.Select(s => s.Chemin).ToArray();

    private static async Task<string?> Chaine(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        return (await cmd.ExecuteScalarAsync())?.ToString();
    }

    private static string VersionT(IEnumerable<VersionModuleBase> versions) => versions.Single(v => v.Module == "t").Version.ToString();

    // ---------------------------------------------------------------- unitaires

    [Fact]
    public void Passage_en_majeure_ecrit_la_creation_remplace_le_socle_dans_le_plan_et_garde_les_mineures()
    {
        using var d = new Depot();
        d.Ecrire("modules/t/db/1.2_index.sql", "ALTER TABLE t_t ADD COLUMN t_y text;");
        ManifesteScripts.Generer(d.Racine);
        var avant = Chemins(d.Plan());
        Assert.Contains("modules/t/db/001_t.sql", avant);

        var r = PassageMajeure.Executer(d.Racine, "t");
        Assert.Equal("2.0", r.Nouvelle.ToString());
        Assert.Equal("modules/t/db/2.0_creation.sql", r.Creation);
        Assert.Equal(["modules/t/db/001_t.sql", "modules/t/db/1.1_colonne.sql", "modules/t/db/1.2_index.sql"], r.Sources);
        Assert.Empty(r.Archives); // la majeure précédente (1) reste prise en charge : rien à archiver
        var contenu = File.ReadAllText(Path.Combine(d.Racine, r.Creation));
        Assert.Contains("SQUELETTE", contenu);
        Assert.Contains("CREATE TABLE t_t", contenu);
        Assert.Contains("ADD COLUMN t_y", contenu);

        // Base neuve : création à la place du socle et des mineures 1.x du module ; les autres modules et les rejouables inchangés.
        var plan = Chemins(d.Plan());
        Assert.Equal(["modules/t/db/2.0_creation.sql", "modules/b/db/001_b.sql", "modules/t/db/002_t_vue.sql", "modules/b/db/1.1_reprise.sql", "db/010_coeur.sql"], plan);
        Assert.True(ManifesteScripts.EstAJour(d.Racine));
        Assert.Equal(plan, ManifesteScripts.Lire(d.Racine).Scripts.Select(s => s.Chemin));
        Assert.Empty(ManifesteScripts.Lire(d.Racine).Ecarts(d.Racine)); // mineures gardées et socle figé : couverts hors manifeste

        // Base en 1.1 : mineures manquantes puis création inscrite sans exécution ; base en 2.0 : création déjà appliquée (plan neuf).
        var enUnUn = PlanScripts.CalculerPour(d.Racine, new Dictionary<string, VersionModule> { ["t"] = new(1, 1) });
        Assert.Equal(["modules/t/db/001_t.sql", "modules/b/db/001_b.sql", "modules/t/db/002_t_vue.sql", "modules/t/db/1.1_colonne.sql", "modules/b/db/1.1_reprise.sql",
            "modules/t/db/1.2_index.sql", "modules/t/db/2.0_creation.sql", "db/010_coeur.sql"], Chemins(enUnUn));
        Assert.True(enUnUn.Scripts.Single(s => s.Chemin == "modules/t/db/2.0_creation.sql").SansExecution);
        Assert.Equal(plan, Chemins(PlanScripts.CalculerPour(d.Racine, new Dictionary<string, VersionModule> { ["t"] = new(2, 0) })));
        Assert.Equal(plan, Chemins(d.Plan())); // le plan neuf ne marque rien « sans exécution »
        Assert.DoesNotContain(d.Plan().Scripts, s => s.SansExecution);
        Assert.Equal("majeure", VersionsModules.TypeDe(r.Creation));
    }

    [Fact]
    public void Base_trop_ancienne_refusee_avec_message_et_archivage_a_la_majeure_suivante()
    {
        using var d = new Depot();
        PassageMajeure.Executer(d.Racine, "t");
        // 0.x : sous le plancher 1.0.
        var e = Assert.Throws<BaseTropAncienneException>(() => PlanScripts.CalculerPour(d.Racine, new Dictionary<string, VersionModule> { ["t"] = new(0, 5) }));
        Assert.Contains("version publiée intermédiaire", e.Message);
        Assert.Contains("0.5", e.Message);
        Assert.Equal(new VersionModule(1, 0), e.Plancher);

        d.Ecrire("modules/t/db/2.1_colonne.sql", "ALTER TABLE t_t ADD COLUMN t_z text;");
        var r = PassageMajeure.Executer(d.Racine, "t");
        Assert.Equal("3.0", r.Nouvelle.ToString());
        Assert.Equal(["modules/t/db/001_t.sql", "modules/t/db/1.1_colonne.sql"], r.Archives.Order(StringComparer.Ordinal).ToArray());
        Assert.True(File.Exists(Path.Combine(d.Racine, "modules/t/db/archive/001_t.sql")));
        Assert.True(File.Exists(Path.Combine(d.Racine, "modules/t/db/archive/1.1_colonne.sql")));
        Assert.False(File.Exists(Path.Combine(d.Racine, "modules/t/db/001_t.sql")));
        Assert.True(File.Exists(Path.Combine(d.Racine, "modules/t/db/2.0_creation.sql"))); // la majeure précédente (2) est gardée
        // Jamais dans un plan, quel que soit l'état de la base ; hors manifeste sans écart.
        foreach (var v in new VersionModule?[] { null, new VersionModule(2, 0), new VersionModule(2, 1) })
        {
            var versions = v is null ? null : new Dictionary<string, VersionModule> { ["t"] = v.Value };
            Assert.DoesNotContain(Chemins(PlanScripts.CalculerPour(d.Racine, versions)), c => c.Contains("archive/") || c.Contains("1.1_colonne") || c.EndsWith("/001_t.sql"));
        }
        Assert.Empty(ManifesteScripts.Lire(d.Racine).Ecarts(d.Racine));
        d.Ecrire("modules/t/db/archive/9.9_autre.sql", "SELECT 1;");
        Assert.Empty(ManifesteScripts.Lire(d.Racine).Ecarts(d.Racine)); // archive/ jamais parcouru
        d.Ecrire("modules/t/db/zzz_oublie.sql", "SELECT 1;");
        Assert.Single(ManifesteScripts.Lire(d.Racine).Ecarts(d.Racine)); // un script oublié, lui, est signalé
        // 1.x : sous le plancher 2.0.
        var trop = Assert.Throws<BaseTropAncienneException>(() => PlanScripts.CalculerPour(d.Racine, new Dictionary<string, VersionModule> { ["t"] = new(1, 2) }));
        Assert.Equal(new VersionModule(2, 0), trop.Plancher);
    }

    [Fact]
    public void Majeure_refusee_quand_une_source_est_hors_transaction_ou_la_version_existe()
    {
        using var d = new Depot();
        d.Ecrire("modules/t/db/1.2_index.sql", "-- hors-transaction\nCREATE INDEX CONCURRENTLY t_t_x ON t_t (t_x);");
        Assert.Contains("hors transaction", Assert.Throws<InvalidOperationException>(() => PassageMajeure.Executer(d.Racine, "t")).Message);
        File.Delete(Path.Combine(d.Racine, "modules/t/db/1.2_index.sql"));
        PassageMajeure.Executer(d.Racine, "t");
        Assert.Throws<ArgumentException>(() => PassageMajeure.Executer(d.Racine, "T/../x"));
        Assert.Throws<InvalidOperationException>(() => PassageMajeure.Executer(d.Racine, "inconnu"));
    }

    // ---------------------------------------------------------------- intégration

    [Fact]
    public async Task Montee_1x_vers_2_0_et_installation_neuve_donnent_le_meme_instantane_et_les_scripts_archives_ne_sont_jamais_joues()
    {
        if (Admin is null) return;
        using var d = new Depot();
        var moteur = new BaseDonnees(TextWriter.Null);
        await using var a = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);   // en 1.1
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);   // en 1.2 (puis 2.1)
        await using var g = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);   // en 1.2, jamais mise à jour
        await using var c = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);   // neuve 2.0
        await using var f = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);   // neuve 3.0

        var plan11 = d.Plan();
        await moteur.AppliquerAsync(a.Connexion, d.Racine, plan11.Scripts);
        await moteur.AppliquerAsync(b.Connexion, d.Racine, plan11.Scripts);
        d.Ecrire("modules/t/db/1.2_index.sql", "ALTER TABLE t_t ADD COLUMN t_y text;\nCREATE INDEX t_t_y ON t_t (t_y);");
        await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts);
        await moteur.AppliquerAsync(g.Connexion, d.Racine, d.Plan().Scripts);
        Assert.Equal("1.1", VersionT(await VersionsModules.VersionsModulesAsync(a.Connexion)));
        Assert.Equal("1.2", VersionT(await VersionsModules.VersionsModulesAsync(b.Connexion)));

        // Passage en 2.0.
        PassageMajeure.Executer(d.Racine, "t");
        var plan2 = d.Plan();
        var bilanA = await moteur.AppliquerAsync(a.Connexion, d.Racine, plan2.Scripts);
        Assert.Equal(2, bilanA.Appliques); // 1.2 appliquée, 2.0 inscrite sans exécution (une exécution échouerait : t_t existe)
        var bilanB = await moteur.AppliquerAsync(b.Connexion, d.Racine, plan2.Scripts);
        Assert.Equal(1, bilanB.Appliques);
        await moteur.AppliquerAsync(c.Connexion, d.Racine, plan2.Scripts);
        Assert.Equal("2.0", VersionT(await VersionsModules.VersionsModulesAsync(a.Connexion)));
        Assert.Equal("2.0", VersionT(await VersionsModules.VersionsModulesAsync(c.Connexion)));
        Assert.Equal("majeure", await Chaine(a.Connexion, "SELECT isc_type FROM installation_script WHERE isc_chemin = 'modules/t/db/2.0_creation.sql'"));
        Assert.Equal("majeure", await Chaine(c.Connexion, "SELECT isc_type FROM installation_script WHERE isc_chemin = 'modules/t/db/2.0_creation.sql'"));
        Assert.Equal(ScriptsBaseTests.Instantane(c), ScriptsBaseTests.Instantane(a));
        Assert.Equal(ScriptsBaseTests.Instantane(c), ScriptsBaseTests.Instantane(b));
        Assert.Empty((await ControleSchema.ControlerAsync(a.Connexion, d.Racine, d.Plan().Scripts)).Ecarts);
        Assert.Equal(0, (await moteur.AppliquerAsync(a.Connexion, d.Racine, d.Plan().Scripts)).Appliques); // rien de plus

        // Une mineure 2.1, puis passage en 3.0 : 1.x archivé, plancher 2.0.
        d.Ecrire("modules/t/db/2.1_colonne.sql", "ALTER TABLE t_t ADD COLUMN t_z text;");
        await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts);
        var r = PassageMajeure.Executer(d.Racine, "t");
        Assert.Equal("3.0", r.Nouvelle.ToString());
        Assert.Contains("modules/t/db/001_t.sql", r.Archives);
        var plan3 = d.Plan();
        Assert.DoesNotContain(Chemins(plan3), x => x.Contains("archive/") || x.Contains("1.2_index") || x.EndsWith("/001_t.sql"));

        // g (1.2) : refusée avant toute application, journal inchangé.
        var avant = await Chaine(g.Connexion, "SELECT count(*) FROM installation_script");
        var e = await Assert.ThrowsAsync<BaseTropAncienneException>(() => moteur.AppliquerAsync(g.Connexion, d.Racine, plan3.Scripts));
        Assert.Contains("version publiée intermédiaire", e.Message);
        Assert.Equal(avant, await Chaine(g.Connexion, "SELECT count(*) FROM installation_script"));

        // a (2.0 : 2.1 manquante) et b (2.1) montent ; f est neuve : tout identique.
        Assert.Equal(2, (await moteur.AppliquerAsync(a.Connexion, d.Racine, plan3.Scripts)).Appliques);
        Assert.Equal(1, (await moteur.AppliquerAsync(b.Connexion, d.Racine, plan3.Scripts)).Appliques);
        await moteur.AppliquerAsync(f.Connexion, d.Racine, plan3.Scripts);
        Assert.Equal("3.0", VersionT(await VersionsModules.VersionsModulesAsync(a.Connexion)));
        Assert.Equal(ScriptsBaseTests.Instantane(f), ScriptsBaseTests.Instantane(a));
        Assert.Equal(ScriptsBaseTests.Instantane(f), ScriptsBaseTests.Instantane(b));
        // Aucun script archivé au journal des bases neuves.
        Assert.Equal("0", await Chaine(f.Connexion, "SELECT count(*) FROM installation_script WHERE isc_chemin LIKE '%archive%' OR isc_chemin LIKE '%1.1_colonne%' OR isc_chemin LIKE '%/001_t.sql'"));
    }

    private static string Connexion(string nom) => new NpgsqlConnectionStringBuilder(Admin!) { Database = nom, Pooling = false }.ConnectionString;

    [Fact]
    public async Task Controle_de_publication_conforme_puis_ecart_manuel_puis_creation_incomplete_puis_base_trop_ancienne()
    {
        if (Admin is null) return;
        using var d = new Depot();
        d.Ecrire("modules/t/db/1.2_index.sql", "ALTER TABLE t_t ADD COLUMN t_y text;");
        var ancien = d.Copie(); // version précédente publiée : 1.0 + 1.1 + 1.2
        PassageMajeure.Executer(d.Racine, "t");
        var moteur = new BaseDonnees(TextWriter.Null);
        var proprietaire = new NpgsqlConnectionStringBuilder(Admin).Username!;
        await using var dev = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await moteur.AppliquerAsync(dev.Connexion, d.Racine, d.Plan().Scripts);
        var nomDev = new NpgsqlConnectionStringBuilder(dev.Connexion).Database!;

        Task<RapportPublication> Verifier(string? depuis) => ControlePublication.VerifierAsync(Admin!, proprietaire, Connexion, nomDev, d.Racine, depuis, false, TextWriter.Null);

        // Conforme : depuis le socle 1.0 (mineures 1.x gardées) et depuis la version précédente publiée.
        var r1 = await Verifier(null);
        Assert.True(r1.Conforme, r1.Formater());
        Assert.True((await Verifier(ancien)).Conforme);

        // Modification manuelle de la base de développement : écart signalé.
        await using (var cnx = new NpgsqlConnection(dev.Connexion))
        {
            await cnx.OpenAsync();
            await using var cmd = new NpgsqlCommand("ALTER TABLE t_t ADD COLUMN t_manuel int", cnx);
            await cmd.ExecuteNonQueryAsync();
        }
        var r2 = await Verifier(null);
        Assert.False(r2.Conforme);
        Assert.Empty(r2.NeuveContreMontee);
        Assert.Contains(r2.DeveloppementContreNeuve, e => e.Objet.Contains("t_manuel"));
        Assert.Contains("NON CONFORME", r2.Formater());
        await using (var cnx = new NpgsqlConnection(dev.Connexion))
        {
            await cnx.OpenAsync();
            await using var cmd = new NpgsqlCommand("ALTER TABLE t_t DROP COLUMN t_manuel", cnx);
            await cmd.ExecuteNonQueryAsync();
        }

        // Création incomplète (colonne t_y oubliée) : la base neuve et la base montée diffèrent.
        var creation = Path.Combine(d.Racine, "modules/t/db/2.0_creation.sql");
        File.WriteAllText(creation, File.ReadAllText(creation).Replace("ALTER TABLE t_t ADD COLUMN t_y text;", "-- oubli"));
        var r3 = await Verifier(null);
        Assert.False(r3.Conforme);
        Assert.Contains(r3.NeuveContreMontee, e => e.Objet.Contains("t_y"));

        // Montée depuis une version trop ancienne : refus rapporté, non conforme.
        File.WriteAllText(creation, File.ReadAllText(creation).Replace("-- oubli", "ALTER TABLE t_t ADD COLUMN t_y text;"));
        d.Ecrire("modules/t/db/2.1_colonne.sql", "ALTER TABLE t_t ADD COLUMN t_z text;");
        PassageMajeure.Executer(d.Racine, "t"); // 3.0 : plancher 2.0 ; le socle 1.0 est archivé
        var r4 = await Verifier(null);
        Assert.False(r4.Conforme);
        Assert.NotNull(r4.Refus);
        Assert.Contains("--depuis", r4.Refus);
        var r5 = await Verifier(ancien);
        Assert.False(r5.Conforme);
        Assert.Contains("version publiée intermédiaire", r5.Refus);
    }
}
