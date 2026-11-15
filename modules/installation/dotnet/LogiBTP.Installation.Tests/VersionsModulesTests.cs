using LogiBTP.Installation;
using LogiBTP.Socle.Testing;
using Npgsql;
using Xunit;

namespace LogiBTP.Installation.Tests;

/// <summary>Versions par module (plan versionnement-schema, lot 3) : unitaires (module, VersionModule) puis intégration (LOGIBTP_TEST_PG).</summary>
[Collection("PostgreSQL")]
public class VersionsModulesTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");

    [Theory]
    [InlineData("db/010_x.sql", "coeur")]
    [InlineData("modules/document/db/019p_valable.sql", "document")]
    [InlineData("modules/stock/db/002.sql", "stock")]
    public void Module_deduit_du_chemin(string chemin, string attendu) => Assert.Equal(attendu, VersionsModules.ModuleDe(chemin));

    [Theory]
    [InlineData("script.sql")]
    [InlineData("modules/document/js/x.sql")]
    [InlineData("modules/db/x.sql")]
    public void Chemin_hors_dossiers_db_refuse(string chemin) => Assert.Throws<ArgumentException>(() => VersionsModules.ModuleDe(chemin));

    [Fact]
    public void Scripts_actuels_en_version_1_0_socle_et_mineure_reconnue_par_son_nom()
    {
        Assert.Equal(VersionModule.Socle, VersionsModules.VersionDe("db/121_x.sql"));
        Assert.Equal(VersionsModules.TypeSocle, VersionsModules.TypeDe("db/121_x.sql"));
        Assert.Equal(new VersionModule(1, 10), VersionsModules.VersionDe("modules/document/db/1.10_taux.sql"));
        Assert.Equal(VersionsModules.TypeMineure, VersionsModules.TypeDe("modules/document/db/1.10_taux.sql"));
    }

    [Fact]
    public void Tous_les_scripts_du_manifeste_ont_un_module()
    {
        foreach (var s in ManifesteScripts.Lire(CasPartages.RacineDepot()).Scripts) Assert.NotEmpty(VersionsModules.ModuleDe(s.Chemin));
    }

    [Fact]
    public void Version_1_9_avant_1_10_comparaison_numerique()
    {
        Assert.True(VersionModule.Analyser("1.9") < VersionModule.Analyser("1.10"));
        Assert.True(VersionModule.Analyser("2.0") > VersionModule.Analyser("1.99"));
        Assert.Equal(new VersionModule(1, 10), VersionModule.Analyser("1.10"));
        Assert.Equal("1.10", VersionModule.Analyser("1.10").ToString());
        var tri = new[] { "1.10", "1.2", "1.9", "2.0", "1.0" }.Select(VersionModule.Analyser).Order().Select(v => v.ToString());
        Assert.Equal(["1.0", "1.2", "1.9", "1.10", "2.0"], tri);
    }

    [Theory]
    [InlineData("")]
    [InlineData("1")]
    [InlineData("1.")]
    [InlineData("1.2.3")]
    [InlineData("a.b")]
    [InlineData("-1.0")]
    [InlineData("1.01")]
    [InlineData("1,2")]
    public void Version_invalide_refusee(string texte)
    {
        Assert.False(VersionModule.TryAnalyser(texte, out _));
        Assert.Throws<FormatException>(() => VersionModule.Analyser(texte));
    }

    [Fact]
    public void Version_produit_du_depot_lue()
    {
        var v = VersionsModules.VersionProduit(CasPartages.RacineDepot());
        Assert.Matches(@"^\d{4}\.\d+$", v);
    }

    private static async Task ExecuterAsync(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        await cmd.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task Base_d_avant_le_lot_reconnue_en_1_0_sans_reapplication_et_vue_complete()
    {
        if (Admin is null) return;
        var racine = CasPartages.RacineDepot();
        var m = ManifesteScripts.Lire(racine);
        var scripts = m.Retenus(false);
        await using var a = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        var bd = new BaseDonnees(TextWriter.Null);
        await bd.AppliquerAsync(a.Connexion, racine, scripts, acceptees: EmpreintesAcceptees.Lire(racine));
        // Simule l'ancien journal à trois colonnes, où aucun rejouable n'était inscrit (hors première occurrence des doubles).
        var rejouables = scripts.Where(x => x.Rejouable).Select(x => x.Chemin).ToHashSet();
        var seuls = scripts.Where(x => x.Rejouable).Select(x => x.Chemin).Except(scripts.Where(x => !x.Rejouable).Select(x => x.Chemin)).ToArray();
        await using (var cnx0 = new NpgsqlConnection(a.Connexion))
        {
            await cnx0.OpenAsync();
            await using var del = new NpgsqlCommand("DELETE FROM installation_script WHERE isc_chemin = ANY(@c)", cnx0);
            del.Parameters.AddWithValue("c", seuls);
            await del.ExecuteNonQueryAsync();
        }
        await ExecuterAsync(a.Connexion, """
            DROP VIEW v_version_module;
            ALTER TABLE installation_script DROP COLUMN isc_module, DROP COLUMN isc_version, DROP COLUMN isc_type, DROP COLUMN isc_origine, DROP COLUMN isc_duree_ms, DROP COLUMN isc_version_produit;
            """);
        var avant = (await BaseDonnees.ScriptsAppliquesAsync(a.Connexion)).Where(s => !rejouables.Contains(s.Chemin)).ToDictionary(s => s.Chemin, s => (s.Empreinte, s.AppliqueLe));
        await using (var cnx = new NpgsqlConnection(a.Connexion))
        {
            await cnx.OpenAsync();
            Assert.Empty(await VersionsModules.VersionsModulesAsync(cnx));
        }
        var instantaneAvant = await Instantane(a.Connexion);

        var bilan = await bd.AppliquerAsync(a.Connexion, racine, scripts, acceptees: EmpreintesAcceptees.Lire(racine));
        Assert.Equal(0, bilan.Appliques);
        Assert.Empty(bilan.Modifies);
        Assert.Equal(scripts.Count(x => x.Rejouable), bilan.Rejoues); // tous les rejouables sont rejoués une fois (non inscrits)
        var apres = (await BaseDonnees.ScriptsAppliquesAsync(a.Connexion)).Where(s => !rejouables.Contains(s.Chemin)).ToDictionary(s => s.Chemin, s => (s.Empreinte, s.AppliqueLe));
        Assert.Equal(avant, apres); // aucune ligne de script non rejouable réécrite : empreintes et dates inchangées
        Assert.Equal(instantaneAvant, await Instantane(a.Connexion));

        await using var c2 = new NpgsqlConnection(a.Connexion);
        await c2.OpenAsync();
        var versions = await VersionsModules.VersionsModulesAsync(c2);
        var attendus = scripts.Select(s => VersionsModules.ModuleDe(s.Chemin)).Distinct().Order(StringComparer.Ordinal).ToList();
        Assert.Equal(attendus, versions.Select(v => v.Module));
        Assert.All(versions, v => Assert.Equal(VersionModule.Socle, v.Version));
        await using var cmd = new NpgsqlCommand("SELECT count(*) FROM installation_script WHERE isc_module IS NULL OR isc_version <> '1.0' OR isc_type NOT IN ('socle', 'rejouable') OR isc_origine <> 'logibtp'", c2);
        Assert.Equal(0L, Convert.ToInt64(await cmd.ExecuteScalarAsync()));
    }

    private static async Task<string> Instantane(string connexion)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        return (await InstantaneSchema.LireAsync(cnx)).ToJson();
    }

    [Fact]
    public async Task Base_neuve_journal_renseigne_et_version_produit_inscrite()
    {
        if (Admin is null) return;
        var racine = CasPartages.RacineDepot();
        var scripts = ManifesteScripts.Lire(racine).Retenus(false);
        await using var a = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await new BaseDonnees(TextWriter.Null).AppliquerAsync(a.Connexion, racine, scripts, acceptees: EmpreintesAcceptees.Lire(racine));
        await using var cnx = new NpgsqlConnection(a.Connexion);
        await cnx.OpenAsync();
        Assert.Equal(VersionsModules.VersionProduit(racine), await VersionsModules.VersionProduitBaseAsync(cnx));
        await using var cmd = new NpgsqlCommand("SELECT count(*) FROM installation_script WHERE isc_duree_ms IS NULL OR isc_version_produit IS NULL OR isc_module IS NULL", cnx);
        Assert.Equal(0L, Convert.ToInt64(await cmd.ExecuteScalarAsync()));
        var modules = (await VersionsModules.VersionsModulesAsync(cnx)).Select(v => v.Module).ToList();
        Assert.Contains("coeur", modules);
        Assert.Contains("document", modules);
    }
}
