using System.Text;
using LogiBTP.Authentification.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Xunit;

namespace LogiBTP.Authentification.Tests;

/// <summary>Règles des jetons délégués aux agents (sans base) : secret, échéance, refus, routes du module ouvertes à un agent.</summary>
public class ReglesJetonsDeleguesTests
{
    private static readonly DateTimeOffset Maintenant = new(2026, 11, 13, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Secret_prefixe_aleatoire_et_seule_empreinte_gardee()
    {
        var (secret, empreinte) = ReglesJetonsDelegues.Nouveau();
        var (autre, _) = ReglesJetonsDelegues.Nouveau();
        Assert.StartsWith(ReglesJetonsDelegues.Prefixe, secret);
        Assert.Equal(ReglesJetonsDelegues.Prefixe.Length + 43, secret.Length); // 32 octets en base64 URL
        Assert.NotEqual(secret, autre);
        Assert.Equal(64, empreinte.Length);
        Assert.Equal(HachageMotDePasse.Empreinte(secret), empreinte);
        Assert.DoesNotContain(secret[ReglesJetonsDelegues.Prefixe.Length..], empreinte);
        Assert.True(ReglesJetonsDelegues.EstJetonDelegue(secret));
        Assert.False(ReglesJetonsDelegues.EstJetonDelegue("eyJhbGciOiJIUzI1NiJ9.e30.x"));
        Assert.False(ReglesJetonsDelegues.EstJetonDelegue(null));
    }

    [Fact]
    public void Echeance_par_defaut_bornee_et_jamais_passee()
    {
        Assert.Equal(Maintenant.AddDays(ReglesJetonsDelegues.JoursMax), ReglesJetonsDelegues.Echeance(null, Maintenant));
        Assert.Equal(Maintenant.AddDays(ReglesJetonsDelegues.JoursMax), ReglesJetonsDelegues.Echeance(Maintenant.UtcDateTime.AddDays(400), Maintenant));
        Assert.Equal(Maintenant.AddDays(30), ReglesJetonsDelegues.Echeance(Maintenant.UtcDateTime.AddDays(30), Maintenant));
        Assert.Null(ReglesJetonsDelegues.Echeance(Maintenant.UtcDateTime.AddMinutes(-1), Maintenant));
    }

    private static CompteAEvaluer Compte(bool actif = true, bool provisoire = false, DateOnly? fin = null, string type = "PERSONNE", DateTimeOffset? verrou = null) =>
        new(type, actif, true, provisoire, fin, verrou);

    [Fact]
    public void Refus_revoque_echu_ou_compte_inutilisable()
    {
        var echeance = Maintenant.AddDays(1);
        Assert.Null(ReglesJetonsDelegues.Refus(null, echeance, Compte(), Maintenant));
        Assert.Null(ReglesJetonsDelegues.Refus(null, echeance, Compte(verrou: Maintenant.AddMinutes(5)), Maintenant));
        Assert.Equal(ReglesJetonsDelegues.Revoque, ReglesJetonsDelegues.Refus(Maintenant.AddHours(-1), echeance, Compte(), Maintenant));
        Assert.Equal(ReglesJetonsDelegues.Echu, ReglesJetonsDelegues.Refus(null, Maintenant, Compte(), Maintenant));
        Assert.Equal("INACTIF", ReglesJetonsDelegues.Refus(null, echeance, Compte(actif: false), Maintenant));
        Assert.Equal("EXPIRE", ReglesJetonsDelegues.Refus(null, echeance, Compte(fin: new DateOnly(2026, 11, 12)), Maintenant));
        Assert.Equal("A_CHANGER", ReglesJetonsDelegues.Refus(null, echeance, Compte(provisoire: true), Maintenant));
        Assert.Equal("SERVICE", ReglesJetonsDelegues.Refus(null, echeance, Compte(type: "API"), Maintenant));
    }

    [Theory]
    [InlineData("GET", "/api/auth/session", true)]
    [InlineData("POST", "/api/auth/session", false)]
    [InlineData("POST", "/api/auth/mot-de-passe", false)]
    [InlineData("POST", "/api/auth/usurper", false)]
    [InlineData("GET", "/api/auth/comptes", false)]
    [InlineData("POST", "/api/auth/jeton", false)]
    [InlineData("GET", "/api/AUTH/sessions", false)]
    [InlineData("GET", "/api/documents/12", true)]
    [InlineData("GET", "/api/authentique", true)]
    public void Routes_du_module_ouvertes_a_un_agent(string methode, string chemin, bool permise) =>
        Assert.Equal(permise, ReglesJetonsDelegues.RouteAuthPermise(methode, chemin));

    [Fact]
    public void Utilisateur_d_un_agent_jamais_administrateur_ni_usurpation()
    {
        var s = new SessionLue(0, 1, "admin.x", null, Profils.Admin, false, null, null, Maintenant, false, Maintenant,
            new UsurpationLue(2, "autre", null, "SAISIE", Maintenant, "test"), new AgentRequete("D1", "Claude Code"));
        var u = s.Utilisateur;
        Assert.Equal("admin.x", u.Code);
        Assert.Null(u.Usurpateur);
        Assert.Equal(new AgentRequete("D1", "Claude Code"), u.Agent);
        Assert.False(u.EstAdmin);
    }
}

/// <summary>
/// Jetons délégués en base : secret jamais en clair, ouverture, échéance, révocation (jeton, compte, sessions fermées),
/// compte désactivé, intergiciel (agent posé, /api/auth refusé, 401 JETON_INVALIDE). Base PostgreSQL où les scripts 005,
/// 005b et 005c sont chargés : variable LOGIBTP_TEST_PG, sinon les tests ne font rien.
/// </summary>
public sealed class JetonsDeleguesTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private readonly string _code = $"t{Guid.NewGuid():N}"[..20];

    private sealed class Specialisation : SpecialisationAuthentification
    {
        public override Task<PersonneCompte?> PersonneAsync(AuthDbContext db, string type, string id, CancellationToken ct) => Task.FromResult<PersonneCompte?>(null);
    }

    private sealed class Environnement : IWebHostEnvironment
    {
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "essai";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Production";
    }

    private ServiceProvider? _services;

    private ServiceProvider Services() => _services ??= new ServiceCollection()
        .AddDbContext<AuthDbContext>(o => o.UseNpgsql(Connexion).UseSnakeCaseNamingConvention())
        .AddSingleton<SpecialisationAuthentification, Specialisation>()
        .AddSingleton(new SocieteCourante(null, "Test", Connexion!))
        .Configure<OptionsAuthentification>(_ => { })
        .AddScoped<ServiceAuthentification>()
        .AddScoped<IJetonsDelegues, ServiceJetonsDelegues>()
        .AddSingleton(new JetonsAcces(new Chiffrement("chaine de test de l'installation")))
        .AddSingleton<IWebHostEnvironment, Environnement>()
        .BuildServiceProvider();

    public async Task InitializeAsync()
    {
        if (Connexion is null) return;
        using var scope = Services().CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
        db.Comptes.Add(new Compte { CptCode = _code, CptProfil = "SAISIE", CptHash = HachageMotDePasse.Hacher("mot de passe d'essai"), CptCreePar = "essai" });
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        if (Connexion is null) return;
        using (var scope = Services().CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            await db.Comptes.Where(c => c.CptCode == _code).ExecuteDeleteAsync();
            await db.Journal.Where(j => j.JcoCode == _code).ExecuteDeleteAsync();
        }
        await _services!.DisposeAsync();
    }

    private async Task<T> Avec<T>(Func<IServiceProvider, Task<T>> f)
    {
        using var scope = Services().CreateScope();
        return await f(scope.ServiceProvider);
    }

    private Task<int> Modifier(Func<AuthDbContext, Task<int>> f) => Avec(sp => f(sp.GetRequiredService<AuthDbContext>()));

    [Fact]
    public async Task Secret_jamais_en_clair_ouvert_puis_revoque()
    {
        if (Connexion is null) return;
        var secret = await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().EmettreAsync(_code.ToUpperInvariant(), "D-ESSAI", "Claude Code", null, default));
        Assert.StartsWith(ReglesJetonsDelegues.Prefixe, secret);
        var ligne = await Avec(sp => sp.GetRequiredService<AuthDbContext>().JetonsDelegues.AsNoTracking().SingleAsync(j => j.JdeDelegation == "D-ESSAI" && j.JdeCptId ==
            sp.GetRequiredService<AuthDbContext>().Comptes.Where(c => c.CptCode == _code).Select(c => c.CptId).First()));
        Assert.Equal(HachageMotDePasse.Empreinte(secret), ligne.JdeEmpreinte);
        Assert.NotEqual(secret, ligne.JdeEmpreinte);
        Assert.InRange(ligne.JdeExpireLe, DateTimeOffset.UtcNow.AddDays(89), DateTimeOffset.UtcNow.AddDays(91));

        var ouvert = await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(secret, default));
        Assert.Equal(new JetonDelegue(_code, "D-ESSAI", "Claude Code"), ouvert);
        Assert.Null(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(secret + "x", default)));
        Assert.Null(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(ligne.JdeEmpreinte, default)));

        Assert.True(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().RevoquerAsync(secret, default)));
        Assert.False(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().RevoquerAsync(secret, default)));
        Assert.Null(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(secret, default)));
    }

    [Fact]
    public async Task Echeance_depassee_refusee()
    {
        if (Connexion is null) return;
        await Assert.ThrowsAsync<ExceptionMetier>(() => Avec(sp => sp.GetRequiredService<IJetonsDelegues>().EmettreAsync(_code, "D-ECH", "c", DateTime.UtcNow.AddMinutes(-1), default)));
        var secret = await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().EmettreAsync(_code, "D-ECH", "c", DateTime.UtcNow.AddDays(2), default));
        Assert.NotNull(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(secret, default)));
        var empreinte = HachageMotDePasse.Empreinte(secret);
        await Modifier(db => db.JetonsDelegues.Where(j => j.JdeEmpreinte == empreinte).ExecuteUpdateAsync(j => j.SetProperty(x => x.JdeExpireLe, DateTimeOffset.UtcNow.AddSeconds(-1))));
        ServiceAuthentification.OublierJetonsDelegues();
        Assert.Null(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(secret, default)));
    }

    [Fact]
    public async Task Compte_desactive_ou_sessions_fermees()
    {
        if (Connexion is null) return;
        var a = await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().EmettreAsync(_code, "D-CPT", "c", null, default));
        var b = await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().EmettreAsync(_code, "D-CPT", "c2", null, default));
        // Compte désactivé : refusé à la lecture même sans révocation, et aucun nouveau jeton.
        await Modifier(db => db.Comptes.Where(c => c.CptCode == _code).ExecuteUpdateAsync(c => c.SetProperty(x => x.CptActif, false)));
        ServiceAuthentification.OublierSessions();
        Assert.Null(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(a, default)));
        await Assert.ThrowsAsync<ExceptionMetier>(() => Avec(sp => sp.GetRequiredService<IJetonsDelegues>().EmettreAsync(_code, "D-CPT", "c", null, default)));
        await Modifier(db => db.Comptes.Where(c => c.CptCode == _code).ExecuteUpdateAsync(c => c.SetProperty(x => x.CptActif, true)));
        ServiceAuthentification.OublierSessions();
        Assert.NotNull(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(a, default)));

        // Toutes les sessions fermées : jetons révoqués (cache vidé).
        var cptId = await Avec(sp => sp.GetRequiredService<AuthDbContext>().Comptes.Where(c => c.CptCode == _code).Select(c => c.CptId).FirstAsync());
        await Avec(async sp =>
        {
            await sp.GetRequiredService<ServiceAuthentification>().FermerSessionsAsync(cptId, null, null, new ServiceAuthentification.Origine(null, null), "admin", default);
            return 0;
        });
        Assert.Null(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(a, default)));
        Assert.Null(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(b, default)));

        var c = await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().EmettreAsync(_code, "D-CPT", "c3", null, default));
        Assert.Equal(1, await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().RevoquerPourCompteAsync(_code, default)));
        Assert.Null(await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().OuvrirAsync(c, default)));
    }

    private async Task<(int Statut, Utilisateur? Utilisateur, string Corps)> Appeler(string methode, string chemin, string bearer)
    {
        using var scope = Services().CreateScope();
        var app = new ApplicationBuilder(Services());
        Utilisateur? vu = null;
        app.UseAuthentificationSession();
        app.Run(http =>
        {
            vu = Utilisateur.Depuis(http);
            return Task.CompletedTask;
        });
        var http = new DefaultHttpContext { RequestServices = scope.ServiceProvider };
        http.Request.Method = methode;
        http.Request.Path = chemin;
        http.Request.Headers.Authorization = $"Bearer {bearer}";
        http.Response.Body = new MemoryStream();
        await app.Build()(http);
        return (http.Response.StatusCode, vu, Encoding.UTF8.GetString(((MemoryStream)http.Response.Body).ToArray()));
    }

    [Fact]
    public async Task Intergiciel_agent_pose_et_routes_auth_refusees()
    {
        if (Connexion is null) return;
        var secret = await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().EmettreAsync(_code, "D-WEB", "Claude Desktop", null, default));

        var (statut, u, _) = await Appeler("GET", "/api/documents", secret);
        Assert.Equal(200, statut);
        Assert.Equal(_code, u!.Code);
        Assert.Equal(new AgentRequete("D-WEB", "Claude Desktop"), u.Agent);
        Assert.Null(u.Usurpateur);

        Assert.Equal(200, (await Appeler("GET", "/api/auth/session", secret)).Statut);
        var refus = await Appeler("POST", "/api/auth/mot-de-passe", secret);
        Assert.Equal(403, refus.Statut);
        Assert.Contains(ErreursAgent.AgentInterdit, refus.Corps);
        Assert.Equal(403, (await Appeler("POST", "/api/auth/usurper", secret)).Statut);
        Assert.Equal(403, (await Appeler("GET", "/api/auth/comptes", secret)).Statut);

        var inconnu = await Appeler("GET", "/api/documents", ReglesJetonsDelegues.Prefixe + "inconnu");
        Assert.Equal(401, inconnu.Statut);
        Assert.Contains(ErreursAuthentification.JetonInvalide, inconnu.Corps);

        await Avec(sp => sp.GetRequiredService<IJetonsDelegues>().RevoquerAsync(secret, default));
        Assert.Equal(401, (await Appeler("GET", "/api/documents", secret)).Statut);
        Assert.True(await Avec(sp => sp.GetRequiredService<AuthDbContext>().Journal.AnyAsync(j => j.JcoCode == _code && j.JcoEvenement == "REFUS" && j.JcoDetail!.Contains("REVOQUE"))));
    }
}
