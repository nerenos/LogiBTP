using LogiBTP.Installation;
using LogiBTP.Socle.Testing;
using Npgsql;
using Xunit;

namespace LogiBTP.Installation.Tests;

/// <summary>
/// Mineures, plan calculé et scripts.txt généré (plan versionnement-schema, lot 4) : unitaires sur dépôts factices, puis
/// intégration (LOGIBTP_TEST_PG_ADMIN) : ordre, base montée = base neuve, rejouables sur changement, empreinte bloquante, verrou.
/// </summary>
[Collection("PostgreSQL")]
public class MineuresTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");

    // ---------------------------------------------------------------- dépôt factice

    private sealed class DepotFactice : IDisposable
    {
        public string Racine { get; } = Path.Combine(Path.GetTempPath(), "logibtp_mineures_" + Guid.NewGuid().ToString("N")[..10]);

        public DepotFactice(string socle)
        {
            Directory.CreateDirectory(Path.Combine(Racine, "db/installation"));
            Directory.CreateDirectory(Path.Combine(Racine, "modules"));
            Ecrire("db/installation/socle-1.0.txt", socle);
        }

        public void Ecrire(string chemin, string contenu)
        {
            var f = Path.Combine(Racine, chemin);
            Directory.CreateDirectory(Path.GetDirectoryName(f)!);
            File.WriteAllText(f, contenu);
        }

        public PlanScripts Plan() => PlanScripts.Calculer(Racine);

        public void Dispose() => Directory.Delete(Racine, true);
    }

    private const string SocleDeuxModules = "modules/a/db/001_a.sql\nmodules/b/db/001_b.sql\n";

    private static DepotFactice DepotAB()
    {
        var d = new DepotFactice(SocleDeuxModules);
        d.Ecrire("modules/a/db/001_a.sql", "CREATE TABLE a_t (a_id int PRIMARY KEY);");
        d.Ecrire("modules/b/db/001_b.sql", "CREATE TABLE b_t (b_id int PRIMARY KEY);");
        return d;
    }

    private static string[] Chemins(PlanScripts p) => p.Scripts.Select(s => s.Chemin).ToArray();

    // ---------------------------------------------------------------- unitaires

    [Fact]
    public void Scripts_txt_du_depot_est_a_jour_et_le_plan_sans_cycle()
    {
        var racine = CasPartages.RacineDepot();
        Assert.True(ManifesteScripts.EstAJour(racine), "db/installation/scripts.txt n'est pas à jour : lancer « npm run manifeste »");
        var plan = PlanScripts.Calculer(racine); // lève PlanInvalideException si cycle, requiert inconnu, version en double
        Assert.Equal(ManifesteScripts.Lire(racine).Scripts.Select(s => s.Chemin), plan.Scripts.Select(s => s.Chemin));
        Assert.Empty(ManifesteScripts.Lire(racine).Ecarts(racine));
    }

    [Fact]
    public void Socle_fige_reproduit_le_manifeste_sans_mineure()
    {
        var racine = CasPartages.RacineDepot();
        // scripts.txt généré, sans les mineures publiées depuis (module Fiche 1.1…) : le reste est le socle 1.0 figé.
        var socle = ManifesteScripts.Lire(racine).Scripts.Where(s => !VersionsModules.EstMineure(s.Chemin)).ToList();
        var fige = ManifesteScripts.Analyser(File.ReadAllLines(Path.Combine(racine, PlanScripts.CheminSocle)));
        Assert.Equal(fige.Scripts, socle);
        Assert.Equal("db/176_documents_vues_types.sql", socle[^1].Chemin);
        Assert.True(socle[^1].Rejouable);
    }

    [Fact]
    public void En_tetes_requiert_et_hors_transaction_lus()
    {
        var e = EnteteMineure.Lire("x.sql", "-- Titre\n-- requiert: document 1.2, stock 1.10\n--   hors-transaction\n\nSELECT 1;\n-- requiert: ignore 9.9\n");
        Assert.True(e.HorsTransaction);
        Assert.Equal([new ExigenceModule("document", new VersionModule(1, 2)), new ExigenceModule("stock", new VersionModule(1, 10))], e.Requiert);
        var vide = EnteteMineure.Lire("x.sql", "SELECT 1;");
        Assert.Empty(vide.Requiert);
        Assert.False(vide.HorsTransaction);
        Assert.Throws<FormatException>(() => EnteteMineure.Lire("x.sql", "-- requiert: document\nSELECT 1;"));
        Assert.Throws<FormatException>(() => EnteteMineure.Lire("x.sql", "-- requiert: Document 1.x\nSELECT 1;"));
    }

    [Fact]
    public void Mineures_ordre_numerique_requiert_puis_module_puis_version_et_rejouables_de_fin_apres()
    {
        using var d = DepotAB();
        d.Ecrire("db/installation/socle-1.0.txt", SocleDeuxModules + "\n# ---- rejouables de fin du socle : x ----\nmodules/a/db/001_a.sql rejouable\n");
        d.Ecrire("modules/a/db/1.10_dix.sql", "SELECT 1;");
        d.Ecrire("modules/a/db/1.9_neuf.sql", "SELECT 1;");
        d.Ecrire("modules/b/db/1.1_b.sql", "-- requiert: a 1.10\nSELECT 1;");
        d.Ecrire("modules/c/db/001_c.sql", "SELECT 1;");
        d.Ecrire("db/installation/socle-1.0.txt", SocleDeuxModules + "modules/c/db/001_c.sql\n\n# ---- rejouables de fin du socle : x ----\nmodules/a/db/001_a.sql rejouable\n");
        d.Ecrire("modules/c/db/1.1_c.sql", "SELECT 1;");
        // a 1.9, a 1.10 (numérique), puis c 1.1 (prêt, avant b 1.1 qui attend a 1.10 : à égalité, module a < b < c mais b n'est prêt qu'après a 1.10)
        var plan = d.Plan();
        Assert.Equal(["a 1.9", "a 1.10", "b 1.1", "c 1.1"], plan.Mineures.Select(m => $"{m.Module} {m.Version}"));
        var chemins = Chemins(plan);
        Assert.Equal("modules/a/db/001_a.sql", chemins[^1]); // rejouable de fin : après toutes les mineures
        Assert.True(plan.Scripts[^1].Rejouable);
        Assert.True(Array.IndexOf(chemins, "modules/c/db/1.1_c.sql") < chemins.Length - 1);
        Assert.True(Array.IndexOf(chemins, "modules/c/db/001_c.sql") < Array.IndexOf(chemins, "modules/a/db/1.9_neuf.sql"));
    }

    [Fact]
    public void Requiert_force_un_ordre_different_de_l_ordre_des_modules()
    {
        using var d = DepotAB();
        d.Ecrire("modules/a/db/1.1_a.sql", "-- requiert: b 1.1\nSELECT 1;");
        d.Ecrire("modules/b/db/1.1_b.sql", "SELECT 1;");
        Assert.Equal(["b 1.1", "a 1.1"], d.Plan().Mineures.Select(m => $"{m.Module} {m.Version}"));
    }

    [Fact]
    public void Deux_mineures_de_meme_version_refusees()
    {
        using var d = DepotAB();
        d.Ecrire("modules/a/db/1.1_x.sql", "SELECT 1;");
        d.Ecrire("modules/a/db/1.1_y.sql", "SELECT 1;");
        var e = Assert.Throws<PlanInvalideException>(d.Plan);
        Assert.Contains("deux mineures en version 1.1", e.Message);
    }

    [Fact]
    public void Requiert_vers_module_ou_version_inexistants_refuse()
    {
        using var d = DepotAB();
        d.Ecrire("modules/a/db/1.1_x.sql", "-- requiert: fantome 1.0\nSELECT 1;");
        Assert.Contains("n'existe pas", Assert.Throws<PlanInvalideException>(d.Plan).Message);
        d.Ecrire("modules/a/db/1.1_x.sql", "-- requiert: b 1.7\nSELECT 1;");
        Assert.Contains("version inexistante", Assert.Throws<PlanInvalideException>(d.Plan).Message);
        d.Ecrire("modules/a/db/1.1_x.sql", "-- requiert: b 1.0\nSELECT 1;"); // le socle existe
        Assert.Single(d.Plan().Mineures);
    }

    [Fact]
    public void Cycle_entre_mineures_refuse()
    {
        using var d = DepotAB();
        d.Ecrire("modules/a/db/1.1_a.sql", "-- requiert: b 1.1\nSELECT 1;");
        d.Ecrire("modules/b/db/1.1_b.sql", "-- requiert: a 1.1\nSELECT 1;");
        Assert.Contains("cycle", Assert.Throws<PlanInvalideException>(d.Plan).Message);
    }

    [Fact]
    public void Version_1_0_reservee_au_socle()
    {
        using var d = DepotAB();
        d.Ecrire("modules/a/db/1.0_x.sql", "SELECT 1;");
        Assert.Contains("socle", Assert.Throws<PlanInvalideException>(d.Plan).Message);
    }

    [Fact]
    public void Generation_ecrit_socle_mineures_et_rejouables_de_fin_et_se_relit()
    {
        using var d = DepotAB();
        d.Ecrire("modules/a/db/1.1_a.sql", "SELECT 1;");
        Assert.False(ManifesteScripts.EstAJour(d.Racine));
        ManifesteScripts.Generer(d.Racine);
        Assert.True(ManifesteScripts.EstAJour(d.Racine));
        var texte = File.ReadAllText(Path.Combine(d.Racine, ManifesteScripts.CheminRelatif));
        Assert.StartsWith("# FICHIER GÉNÉRÉ", texte);
        Assert.Equal(["modules/a/db/001_a.sql", "modules/b/db/001_b.sql", "modules/a/db/1.1_a.sql"], ManifesteScripts.Lire(d.Racine).Scripts.Select(s => s.Chemin));
        Assert.Empty(ManifesteScripts.Lire(d.Racine).Ecarts(d.Racine));
    }

    // ---------------------------------------------------------------- intégration

    private static async Task<long> Compter(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private const string SocleRejouables =
        "modules/a/db/001_a.sql\nmodules/b/db/001_b.sql\nmodules/c/db/001_c.sql\n" +
        "modules/a/db/002_a_vue.sql rejouable\nmodules/b/db/002_b_vue.sql rejouable\nmodules/c/db/002_c_vue.sql rejouable\n" +
        "\n# ---- rejouables de fin du socle : x ----\ndb/010_coeur.sql rejouable\n";

    private static DepotFactice DepotRejouables()
    {
        var d = new DepotFactice(SocleRejouables);
        d.Ecrire("modules/a/db/001_a.sql", "CREATE TABLE a_t (a_id int PRIMARY KEY); CREATE TABLE installation_essai (ess_nom text);");
        d.Ecrire("modules/b/db/001_b.sql", "CREATE TABLE b_t (b_id int PRIMARY KEY);");
        d.Ecrire("modules/c/db/001_c.sql", "CREATE TABLE c_t (c_id int PRIMARY KEY);");
        foreach (var m in new[] { "a", "b", "c" })
            d.Ecrire($"modules/{m}/db/002_{m}_vue.sql", $"CREATE OR REPLACE VIEW v_{m} AS SELECT {m}_id FROM {m}_t; INSERT INTO installation_essai VALUES ('{m}');");
        d.Ecrire("db/010_coeur.sql", "CREATE OR REPLACE VIEW v_coeur AS SELECT a_id FROM a_t; INSERT INTO installation_essai VALUES ('coeur');");
        return d;
    }

    private static void AjouterMineures(DepotFactice d)
    {
        d.Ecrire("modules/a/db/1.1_a_colonne.sql", "ALTER TABLE a_t ADD COLUMN a_x text;");
        d.Ecrire("modules/b/db/1.1_b_reprise.sql", "-- requiert: a 1.1\nCREATE TABLE b_u AS SELECT a_x FROM a_t;"); // échoue si a 1.1 n'est pas passée avant
    }

    private static async Task<string> Executions(string connexion)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT coalesce(string_agg(ess_nom || ':' || n, ' ' ORDER BY ess_nom COLLATE \"C\"), '') FROM (SELECT ess_nom, count(*) n FROM installation_essai GROUP BY ess_nom) t", cnx);
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    // ---------------------------------------------------------------- migrations de code (lot 5)

    private sealed class MigrationFictive(string module, VersionModule version, string nom, string sql, List<string>? trace = null, bool echec = false) : IMigrationCode
    {
        public string Module => module;
        public VersionModule Version => version;
        public string Nom => nom;
        public async Task ExecuterAsync(NpgsqlConnection cnx, NpgsqlTransaction tx, CancellationToken ct)
        {
            trace?.Add(nom);
            await using var cmd = new NpgsqlCommand(sql, cnx, tx);
            await cmd.ExecuteNonQueryAsync(ct);
            if (echec) throw new InvalidOperationException("échec voulu");
        }
    }

    [Fact]
    public void Migration_de_code_placee_comme_mineure_et_jamais_avec_un_sql_de_meme_version()
    {
        using var d = DepotAB();
        d.Ecrire("modules/a/db/1.1_a.sql", "SELECT 1;");
        var code = new MigrationFictive("b", new VersionModule(1, 1), "reprise", "SELECT 1");
        var plan = PlanScripts.Calculer(d.Racine, [code]);
        Assert.Equal(["modules/a/db/1.1_a.sql", "code:b/1.1_reprise"], plan.Mineures.Select(m => m.Chemin));
        Assert.Equal("code:b/1.1_reprise", plan.Scripts[^1].Chemin);
        Assert.DoesNotContain("code:", plan.Contenu()); // scripts.txt ne porte que des fichiers SQL
        Assert.Equal("b", VersionsModules.ModuleDe("code:b/1.1_reprise"));
        Assert.Equal(new VersionModule(1, 1), VersionsModules.VersionDe("code:b/1.1_reprise"));
        d.Ecrire("modules/b/db/1.1_b.sql", "SELECT 1;");
        var e = Assert.Throws<PlanInvalideException>(() => PlanScripts.Calculer(d.Racine, [code]));
        Assert.Contains("déjà un script SQL en version 1.1", e.Message);
        Assert.Throws<PlanInvalideException>(() => PlanScripts.Calculer(d.Racine, [new MigrationFictive("a", new VersionModule(1, 0), "x", "SELECT 1")]));
    }

    [Fact]
    public async Task Migration_de_code_jouee_dans_l_ordre_et_dans_la_transaction_de_la_mineure()
    {
        if (Admin is null) return;
        using var d = DepotAB();
        d.Ecrire("modules/a/db/1.1_a_col.sql", "ALTER TABLE a_t ADD COLUMN a_x int;");
        var trace = new List<string>();
        var code = new MigrationFictive("a", new VersionModule(1, 2), "reprise", "INSERT INTO a_t (a_id, a_x) SELECT 1, count(*) FROM information_schema.columns WHERE table_name = 'a_t' AND column_name = 'a_x'", trace);
        var moteur = new BaseDonnees(TextWriter.Null);
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        var plan = PlanScripts.Calculer(d.Racine, [code]);
        var bilan = await moteur.AppliquerAsync(b.Connexion, d.Racine, plan.Scripts, migrations: [code]);
        Assert.Equal(4, bilan.Appliques);
        Assert.Equal(["reprise"], trace);
        Assert.Equal(1, await Compter(b.Connexion, "SELECT a_x FROM a_t")); // jouée après le SQL 1.1 (colonne présente)
        Assert.Equal("mineure", await ChaineAsync(b.Connexion, "SELECT isc_type FROM installation_script WHERE isc_chemin = 'code:a/1.2_reprise'"));
        Assert.Equal("1.2", (await VersionsModules.VersionsModulesAsync(b.Connexion)).Single(v => v.Module == "a").Version.ToString());
        Assert.Contains("MigrationFictive", await ChaineAsync(b.Connexion, "SELECT isc_empreinte FROM installation_script WHERE isc_chemin = 'code:a/1.2_reprise'"));
        // Rejeu : rien. Une migration qui échoue est annulée avec sa mineure et rien n'est inscrit.
        Assert.Equal(0, (await moteur.AppliquerAsync(b.Connexion, d.Racine, plan.Scripts, migrations: [code])).Appliques);
        Assert.Single(trace);
        var echec = new MigrationFictive("b", new VersionModule(1, 1), "casse", "CREATE TABLE b_casse (x int)", null, true);
        var plan2 = PlanScripts.Calculer(d.Racine, [code, echec]);
        await Assert.ThrowsAsync<InvalidOperationException>(() => moteur.AppliquerAsync(b.Connexion, d.Racine, plan2.Scripts, migrations: [code, echec]));
        Assert.Equal(0, await Compter(b.Connexion, "SELECT count(*) FROM information_schema.tables WHERE table_name = 'b_casse'"));
        Assert.Equal(0, await Compter(b.Connexion, "SELECT count(*) FROM installation_script WHERE isc_chemin = 'code:b/1.1_casse'"));
    }

    [Fact]
    public async Task Mineures_ordre_respecte_base_montee_egale_base_neuve_et_rejouables_sur_changement()
    {
        if (Admin is null) return;
        using var d = DepotRejouables();
        var moteur = new BaseDonnees(TextWriter.Null);
        await using var montee = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await using var neuve = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);

        // 1.0 d'abord : base neuve, tout est joué (3 scripts de socle, 4 rejouables inscrits au journal).
        var b1 = await moteur.AppliquerAsync(montee.Connexion, d.Racine, d.Plan().Scripts);
        Assert.Equal((3, 4), (b1.Appliques, b1.Rejoues)); // 3 scripts de socle ; 4 rejouables rejoués (non inscrits)
        Assert.Equal(4, await Compter(montee.Connexion, "SELECT count(*) FROM installation_script WHERE isc_type = 'rejouable'"));
        Assert.Equal("a:1 b:1 c:1 coeur:1", await Executions(montee.Connexion));

        // Rien n'a changé : aucun rejouable rejoué (compteur d'exécutions inchangé).
        var b2 = await moteur.AppliquerAsync(montee.Connexion, d.Racine, d.Plan().Scripts);
        Assert.Equal((0, 0), (b2.Appliques, b2.Rejoues));
        Assert.Equal("a:1 b:1 c:1 coeur:1", await Executions(montee.Connexion));

        // Deux mineures de deux modules (b requiert a) : ordre respecté, rejouables des modules touchés et du cœur rejoués,
        // celui du module c (non touché, non requis) non rejoué.
        AjouterMineures(d);
        var plan = d.Plan();
        Assert.Equal(["modules/a/db/1.1_a_colonne.sql", "modules/b/db/1.1_b_reprise.sql"], plan.Mineures.Select(m => m.Chemin));
        var b3 = await moteur.AppliquerAsync(montee.Connexion, d.Racine, plan.Scripts);
        Assert.Equal(2, b3.Appliques);
        Assert.Equal(3, b3.Rejoues); // a, b, coeur
        Assert.Equal("a:2 b:2 c:1 coeur:2", await Executions(montee.Connexion));
        var versions = (await VersionsModules.VersionsModulesAsync(montee.Connexion)).ToDictionary(v => v.Module, v => v.Version.ToString());
        Assert.Equal("1.1", versions["a"]);
        Assert.Equal("1.1", versions["b"]);
        Assert.Equal("mineure", await ChaineAsync(montee.Connexion, "SELECT isc_type FROM installation_script WHERE isc_chemin = 'modules/b/db/1.1_b_reprise.sql'"));

        // Base neuve avec le plan complet : même schéma que la base montée.
        await moteur.AppliquerAsync(neuve.Connexion, d.Racine, plan.Scripts);
        Assert.Equal(ScriptsBaseTests.Instantane(neuve), ScriptsBaseTests.Instantane(montee));

        // Rejouable modifié : rejoué (lui seul) ; une mineure de plus d'un module requis déclenche ceux qui en dépendent.
        d.Ecrire("modules/c/db/002_c_vue.sql", "CREATE OR REPLACE VIEW v_c AS SELECT c_id FROM c_t; INSERT INTO installation_essai VALUES ('c'); -- modifié");
        var b4 = await moteur.AppliquerAsync(montee.Connexion, d.Racine, plan.Scripts);
        Assert.Equal((0, 1), (b4.Appliques, b4.Rejoues));
        Assert.Equal("a:2 b:2 c:2 coeur:2", await Executions(montee.Connexion));
        d.Ecrire("modules/a/db/1.2_a_autre.sql", "ALTER TABLE a_t ADD COLUMN a_y text;");
        var b5 = await moteur.AppliquerAsync(montee.Connexion, d.Racine, d.Plan().Scripts);
        Assert.Equal((1, 3), (b5.Appliques, b5.Rejoues)); // a, b (requiert a), coeur ; pas c
        Assert.Equal("a:3 b:3 c:2 coeur:3", await Executions(montee.Connexion));
    }

    /// <summary>
    /// Champs supplémentaires (lot 7) : une colonne x_ ajoutée à une table de fiche (par fiche_champ_creer) survit à une mineure
    /// qui reprend une vue et modifie la table, avec sa valeur, et n'est jamais comptée comme dérive.
    /// </summary>
    [Fact]
    public async Task Colonne_x_conservee_par_une_mineure_qui_reprend_une_vue_et_modifie_la_table_temoin()
    {
        if (Admin is null) return;
        using var d = DepotRejouables();
        var moteur = new BaseDonnees(TextWriter.Null);
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts);
        await using (var cnx = new NpgsqlConnection(b.Connexion))
        {
            await cnx.OpenAsync();
            await using var cmd = new NpgsqlCommand("ALTER TABLE a_t ADD COLUMN x_badge text; INSERT INTO a_t (a_id, x_badge) VALUES (1, 'B-12')", cnx);
            await cmd.ExecuteNonQueryAsync();
        }
        Assert.Empty((await ControleSchema.ControlerAsync(b.Connexion, d.Racine, d.Plan().Scripts)).Ecarts);

        d.Ecrire("modules/a/db/1.1_a_reprise.sql", "ALTER TABLE a_t ADD COLUMN a_x text;\nDROP VIEW v_a;\nCREATE VIEW v_a AS SELECT a_id FROM a_t;\nCREATE INDEX a_t_x ON a_t (a_x);");
        var plan = d.Plan();
        Assert.Equal(1, (await moteur.AppliquerAsync(b.Connexion, d.Racine, plan.Scripts)).Appliques);
        Assert.Equal("B-12", await ChaineAsync(b.Connexion, "SELECT x_badge FROM a_t WHERE a_id = 1"));
        Assert.Equal("1", await ChaineAsync(b.Connexion, "SELECT count(*)::text FROM information_schema.columns WHERE table_name = 'a_t' AND column_name = 'x_badge'"));
        Assert.Empty((await ControleSchema.ControlerAsync(b.Connexion, d.Racine, plan.Scripts)).Ecarts);
    }

    [Fact]
    public async Task Base_installee_avant_le_lot_rejouables_non_inscrits_tous_rejoues_une_fois_puis_inscrits()
    {
        if (Admin is null) return;
        using var d = DepotRejouables();
        var moteur = new BaseDonnees(TextWriter.Null);
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts);
        await using (var cnx = new NpgsqlConnection(b.Connexion))
        {
            await cnx.OpenAsync();
            await using var del = new NpgsqlCommand("DELETE FROM installation_script WHERE isc_type = 'rejouable'", cnx);
            await del.ExecuteNonQueryAsync();
        }
        var bilan = await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts);
        Assert.Equal(4, bilan.Rejoues);
        Assert.Equal(4, await Compter(b.Connexion, "SELECT count(*) FROM installation_script WHERE isc_type = 'rejouable'"));
        Assert.Equal(0, (await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts)).Rejoues);
    }

    private static async Task<string?> ChaineAsync(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        return await cmd.ExecuteScalarAsync() as string;
    }

    [Fact]
    public async Task Empreinte_modifiee_refusee_avant_toute_application_puis_forcage_trace()
    {
        if (Admin is null) return;
        using var d = DepotAB();
        var moteur = new BaseDonnees(TextWriter.Null);
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts);

        d.Ecrire("modules/b/db/001_b.sql", "CREATE TABLE b_t (b_id int PRIMARY KEY); -- corrigé après coup");
        d.Ecrire("modules/a/db/1.1_a.sql", "CREATE TABLE a_nouvelle (n int);");
        var e = await Assert.ThrowsAsync<EmpreinteModifieeException>(() => moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts));
        Assert.Equal(["modules/b/db/001_b.sql"], e.Scripts);
        Assert.Contains("modules/b/db/001_b.sql", e.Message);
        Assert.Equal(0, await Compter(b.Connexion, "SELECT count(*) FROM pg_tables WHERE tablename = 'a_nouvelle'")); // rien d'appliqué
        await Assert.ThrowsAsync<ArgumentException>(() => moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts, forcer: true));

        var bilan = await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts, forcer: true, motif: "essai de forçage");
        Assert.Equal(["modules/b/db/001_b.sql"], bilan.Modifies);
        Assert.Equal(1, bilan.Appliques);
        Assert.Equal(1, await Compter(b.Connexion, "SELECT count(*) FROM pg_tables WHERE tablename = 'a_nouvelle'"));
        Assert.Equal("essai de forçage", await ChaineAsync(b.Connexion, "SELECT ifo_motif FROM installation_forcage"));
        Assert.Contains("script:modules/b/db/001_b.sql", await ChaineAsync(b.Connexion, "SELECT ifo_ecarts::text FROM installation_forcage") ?? "");
        // Empreinte du journal mise à jour : plus de refus ensuite.
        await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts);

        // Empreinte acceptée : pas d'erreur, journal mis à jour.
        var ancienne = BaseDonnees.Empreinte(File.ReadAllText(Path.Combine(d.Racine, "modules/a/db/001_a.sql")));
        d.Ecrire("modules/a/db/001_a.sql", "CREATE TABLE a_t (a_id int PRIMARY KEY); -- réduit");
        var acceptees = EmpreintesAcceptees.Analyser([$"modules/a/db/001_a.sql {ancienne}  # test"]);
        // l'ancienne empreinte du journal est celle d'avant la modification ci-dessus : acceptée si elle y figure
        var avant = (await BaseDonnees.ScriptsAppliquesAsync(b.Connexion)).Single(s => s.Chemin == "modules/a/db/001_a.sql").Empreinte;
        Assert.Equal(ancienne, avant);
        var ok = await moteur.AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts, acceptees: acceptees);
        Assert.Equal(["modules/a/db/001_a.sql"], ok.AcceptesOuVide);
    }

    [Fact]
    public async Task Mineure_hors_transaction_executee_hors_transaction_et_signalee()
    {
        if (Admin is null) return;
        using var d = DepotAB();
        d.Ecrire("modules/a/db/001_a.sql", "CREATE TABLE a_t (a_id int PRIMARY KEY, a_x int);");
        d.Ecrire("modules/a/db/1.1_index.sql", "-- hors-transaction\nCREATE INDEX CONCURRENTLY a_t_x ON a_t (a_x);");
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        var bilan = await new BaseDonnees(TextWriter.Null).AppliquerAsync(b.Connexion, d.Racine, d.Plan().Scripts);
        Assert.Equal(["modules/a/db/1.1_index.sql"], bilan.HorsTransaction);
        Assert.Equal(1, await Compter(b.Connexion, "SELECT count(*) FROM pg_indexes WHERE indexname = 'a_t_x'"));
    }

    [Fact]
    public async Task Deux_applications_simultanees_sont_serialisees_par_le_verrou()
    {
        if (Admin is null) return;
        using var d = DepotAB();
        d.Ecrire("modules/a/db/001_a.sql", "CREATE TABLE a_t (a_id int PRIMARY KEY); SELECT pg_sleep(1.5);");
        var plan = d.Plan();
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        var moteur = new BaseDonnees(TextWriter.Null);
        var t1 = moteur.AppliquerAsync(b.Connexion, d.Racine, plan.Scripts);
        var t2 = moteur.AppliquerAsync(b.Connexion, d.Racine, plan.Scripts);
        var bilans = await Task.WhenAll(t1, t2);
        Assert.Equal(2, bilans.Sum(x => x.Appliques)); // chaque script appliqué une seule fois, sans erreur de concurrence
        Assert.Contains(bilans, x => x.Appliques == 0);
        Assert.Equal(2, await Compter(b.Connexion, "SELECT count(*) FROM installation_script"));
    }
}
