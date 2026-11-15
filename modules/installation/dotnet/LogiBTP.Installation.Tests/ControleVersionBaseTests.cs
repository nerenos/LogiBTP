using LogiBTP.Installation;
using LogiBTP.Installation.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace LogiBTP.Installation.Tests;

/// <summary>
/// Versions attendues et refus d'une base en retard (plan versionnement-schema, lot 6) : unitaires, puis intégration
/// (LOGIBTP_TEST_PG_ADMIN) sur des bases à journal minimal : en retard → 503, autre société servie, sans journal servie, Development non bloqué.
/// </summary>
[Collection("PostgreSQL")]
public class ControleVersionBaseTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");
    private const string Code = "BASE_A_METTRE_A_JOUR";

    private static readonly string[] Plan =
    [
        "db/010_a.sql", "db/1.1_b.sql", "modules/stock/db/002.sql", "modules/stock/db/1.2_x.sql", "modules/stock/db/1.3_y.sql demo",
        "modules/document/db/019p_v.sql rejouable", "db/900_demo.sql demo",
    ];

    private sealed class Env(string nom) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = nom;
        public string ApplicationName { get; set; } = "essai";
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    private sealed class Purge : IPurgeCacheBase
    {
        public List<string> Purgees { get; } = [];
        public void Purger(string connexion) => Purgees.Add(connexion);
    }

    [Fact]
    public void Versions_attendues_plus_haute_par_module_hors_demo_et_rejouables()
    {
        var a = VersionsAttendues.Depuis(Plan);
        Assert.Equal(new Dictionary<string, VersionModule> { ["coeur"] = new(1, 1), ["stock"] = new(1, 2) }, a.ParModule.ToDictionary(p => p.Key, p => p.Value));
    }

    [Fact]
    public void Manquantes_module_absent_ou_en_retard()
    {
        var a = VersionsAttendues.Depuis(Plan);
        var reelles = new List<VersionModuleBase> { new("stock", new VersionModule(1, 1), DateTimeOffset.Now) };
        Assert.Equal(["coeur 1.1 (absent)", "stock 1.2 (base en 1.1)"], a.Manquantes(reelles).Select(m => m.ToString()));
        Assert.Empty(a.Manquantes([new("coeur", new VersionModule(1, 4), DateTimeOffset.Now), new("stock", new VersionModule(1, 2), DateTimeOffset.Now)]));
    }

    private static async Task ExecuterAsync(string connexion, string sql)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, cnx);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>Base à journal minimal : un script par couple (module, version).</summary>
    private static async Task JournalAsync(string connexion, params (string Module, string Version)[] versions)
    {
        await ExecuterAsync(connexion, $"CREATE TABLE {BaseDonnees.TableJournal} (isc_chemin TEXT PRIMARY KEY, isc_empreinte TEXT NOT NULL, isc_applique_le TIMESTAMPTZ NOT NULL DEFAULT now())");
        await using (var cnx = new NpgsqlConnection(connexion))
        {
            await cnx.OpenAsync();
            await VersionsModules.AssurerAsync(cnx);
        }
        foreach (var (m, v) in versions)
            await ExecuterAsync(connexion, $"INSERT INTO {BaseDonnees.TableJournal} (isc_chemin, isc_empreinte, isc_module, isc_version, isc_type) VALUES ('{m}/{v}', 'x', '{m}', '{v}', 'socle')");
    }

    private static ControleVersionBase Controle(string environnement, Purge? purge = null) =>
        new(VersionsAttendues.Depuis(Plan), Code, purge is null ? [] : [purge], new Env(environnement), NullLogger<ControleVersionBase>.Instance) { Intervalle = TimeSpan.Zero };

    /// <summary>Requête /api/x d'une société ; renvoie (statut, corps, en-tête, suite appelée).</summary>
    private static async Task<(int Statut, string Corps, string? Entete, bool Servie)> RequeteAsync(ControleVersionBase c, SocieteCourante s, string chemin = "/api/chantiers")
    {
        var services = new ServiceCollection().AddSingleton(s).BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services };
        http.Request.Path = chemin;
        http.Response.Body = new MemoryStream();
        var servie = false;
        await c.InvoquerAsync(http, _ => { servie = true; return Task.CompletedTask; });
        http.Response.Body.Position = 0;
        return (http.Response.StatusCode, await new StreamReader(http.Response.Body).ReadToEndAsync(), http.Response.Headers[ControleVersionBase.EnteteEnRetard].ToString() is { Length: > 0 } e ? e : null, servie);
    }

    [Fact]
    public async Task Base_en_retard_refusee_en_503_et_autre_societe_servie()
    {
        if (Admin is null) return;
        await using var retard = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await using var jour = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await JournalAsync(retard.Connexion, ("coeur", "1.0"), ("stock", "1.2"));
        await JournalAsync(jour.Connexion, ("coeur", "1.1"), ("stock", "1.2"));
        var c = Controle("Production");

        var r = await RequeteAsync(c, new SocieteCourante("acme", "ACME", retard.Connexion));
        Assert.Equal(503, r.Statut);
        Assert.False(r.Servie);
        Assert.Contains($"\"code\":\"{Code}\"", r.Corps);
        Assert.Contains("coeur 1.1", r.Corps);
        Assert.Contains(ControleVersionBase.CommandeMiseAJour, r.Corps);

        var autre = await RequeteAsync(c, new SocieteCourante(null, "Principale", jour.Connexion));
        Assert.Equal(200, autre.Statut);
        Assert.True(autre.Servie);
        // La santé et la société ne dépendent pas du schéma : toujours servies.
        Assert.True((await RequeteAsync(c, new SocieteCourante("acme", "ACME", retard.Connexion), "/api/sante")).Servie);
        // Hors /api : pas de contrôle.
        Assert.True((await RequeteAsync(c, new SocieteCourante("acme", "ACME", retard.Connexion), "/parametres")).Servie);
    }

    [Fact]
    public async Task Base_sans_journal_servie()
    {
        if (Admin is null) return;
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        var r = await RequeteAsync(Controle("Production"), new SocieteCourante(null, "Dev", b.Connexion));
        Assert.True(r.Servie);
        Assert.Equal(200, r.Statut);
        // Journal présent mais vide : même traitement.
        await ExecuterAsync(b.Connexion, $"CREATE TABLE {BaseDonnees.TableJournal} (isc_chemin TEXT PRIMARY KEY, isc_empreinte TEXT NOT NULL, isc_applique_le TIMESTAMPTZ NOT NULL DEFAULT now())");
        Assert.True((await RequeteAsync(Controle("Production"), new SocieteCourante(null, "Dev", b.Connexion))).Servie);
    }

    [Fact]
    public async Task Development_signale_la_base_en_retard_sans_la_bloquer()
    {
        if (Admin is null) return;
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await JournalAsync(b.Connexion, ("coeur", "1.0"), ("stock", "1.0"));
        var r = await RequeteAsync(Controle("Development"), new SocieteCourante(null, "Dev", b.Connexion));
        Assert.True(r.Servie);
        Assert.Equal(200, r.Statut);
        Assert.Contains("coeur 1.1", r.Entete);
    }

    [Fact]
    public async Task Base_injoignable_non_bloquee_et_non_mise_en_cache()
    {
        var c = Controle("Production");
        var r = await RequeteAsync(c, new SocieteCourante(null, "Hors ligne", "Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x;Timeout=2"));
        Assert.True(r.Servie);
    }

    [Fact]
    public async Task Mise_a_jour_detectee_purge_les_caches_de_la_base_et_leve_le_refus()
    {
        if (Admin is null) return;
        await using var b = await ScriptsBaseTests.BaseEssai.CreerAsync(Admin);
        await JournalAsync(b.Connexion, ("coeur", "1.0"), ("stock", "1.2"));
        var purge = new Purge();
        var c = Controle("Production", purge);
        var s = new SocieteCourante("acme", "ACME", b.Connexion);
        Assert.Equal(503, (await RequeteAsync(c, s)).Statut);
        Assert.Empty(purge.Purgees);
        await ExecuterAsync(b.Connexion, $"INSERT INTO {BaseDonnees.TableJournal} (isc_chemin, isc_empreinte, isc_module, isc_version, isc_type) VALUES ('db/1.1_b.sql', 'x', 'coeur', '1.1', 'mineure')");
        var apres = await RequeteAsync(c, s);
        Assert.True(apres.Servie);
        Assert.Equal([b.Connexion], purge.Purgees);
        // Sans nouvelle écriture du journal, plus de purge.
        await RequeteAsync(c, s);
        Assert.Single(purge.Purgees);
    }

    [Fact]
    public void Purge_des_caches_par_base_ignore_les_autres_bases()
    {
        var cache = new System.Collections.Concurrent.ConcurrentDictionary<string, int>
        {
            ["Host=h;Database=a;Username=u|t1"] = 1,
            ["Host=h;Database=a;Username=u;Password=p|t2"] = 2,
            ["Host=h;Database=b;Username=u|t1"] = 3,
        };
        PurgeCache.Purger(cache, "Host=h;Database=a;Username=u;Password=p");
        Assert.Equal(["Host=h;Database=b;Username=u|t1"], cache.Keys);
    }
}
