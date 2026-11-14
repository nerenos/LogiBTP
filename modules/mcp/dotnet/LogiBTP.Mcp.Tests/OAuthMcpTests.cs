using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Mcp.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Client;
using Xunit;

namespace LogiBTP.Mcp.Tests;

/// <summary>Règles du serveur d'autorisation sans base : identifiant de client, document, retour exact, PKCE, audience, durées.</summary>
public class ReglesOAuthTests
{
    [Theory]
    [InlineData("https://claude.ai/oauth/mcp-oauth-client-metadata", true)]
    [InlineData("https://client.exemple/meta.json?v=1", true)]
    [InlineData("http://client.exemple/meta.json", false)]
    [InlineData("https://client.exemple/", false)]
    [InlineData("https://client.exemple", false)]
    [InlineData("https://client.exemple/a#b", false)]
    [InlineData("https://moi:secret@client.exemple/a", false)]
    [InlineData("https://client.exemple/a/../b", false)]
    [InlineData("client-statique", false)]
    [InlineData(null, false)]
    public void Identifiant_de_client_cimd(string? clientId, bool valide) => Assert.Equal(valide, ReglesOAuth.ClientIdValide(clientId));

    [Fact]
    public void Document_du_client_controle()
    {
        const string id = "https://client.exemple/meta";
        Assert.Null(ReglesOAuth.ControlerDocument(id, new DocumentClient(id, "C", ["https://client.exemple/retour", "http://127.0.0.1:3118/callback", "http://localhost/cb"])));
        Assert.NotNull(ReglesOAuth.ControlerDocument(id, null));
        Assert.NotNull(ReglesOAuth.ControlerDocument(id, new DocumentClient("https://autre.exemple/meta", "C", ["https://client.exemple/retour"])));
        Assert.NotNull(ReglesOAuth.ControlerDocument(id, new DocumentClient(id, "C", [])));
        Assert.NotNull(ReglesOAuth.ControlerDocument(id, new DocumentClient(id, "C", ["http://client.exemple/retour"])));
        Assert.NotNull(ReglesOAuth.ControlerDocument(id, new DocumentClient(id, "C", ["https://client.exemple/retour"], "client_secret_basic")));
        Assert.NotNull(ReglesOAuth.ControlerDocument(id, new DocumentClient(id, "C", ["https://client.exemple/retour"], Octrois: ["client_credentials"])));
        Assert.NotNull(ReglesOAuth.ControlerDocument(id, new DocumentClient(id, "C", ["https://client.exemple/retour"], Reponses: ["token"])));
        var lu = DocumentsClientsHttp.Analyser(Encoding.UTF8.GetBytes(
            """{"client_id":"https://client.exemple/meta","client_name":"Client","redirect_uris":["https://client.exemple/retour"],"token_endpoint_auth_method":"none"}"""));
        Assert.Equal(new[] { "https://client.exemple/retour" }, lu!.Redirections);
        Assert.Null(ReglesOAuth.ControlerDocument(id, lu));
    }

    [Fact]
    public void Adresse_de_retour_exacte()
    {
        string[] permises = ["https://client.exemple/retour", "http://127.0.0.1:3118/callback"];
        Assert.True(ReglesOAuth.RedirectionPermise("https://client.exemple/retour", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("https://client.exemple/retour/", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("https://client.exemple/Retour", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("https://client.exemple/retour?x=1", permises));
        Assert.False(ReglesOAuth.RedirectionPermise(null, permises));
        Assert.Equal("https://c/r?code=a%20b&state=s", ReglesOAuth.Redirection("https://c/r", [new("code", "a b"), new("state", "s"), new("vide", null)]));
        Assert.Equal("https://c/r?x=1&code=c", ReglesOAuth.Redirection("https://c/r?x=1", [new("code", "c")]));
    }

    [Fact]
    public void Boucle_locale_a_port_variable()
    {
        // RFC 8252 § 7.3 : l'application native choisit son port à chaque connexion ; schéma, hôte, chemin et requête identiques.
        string[] permises = ["http://127.0.0.1:3118/callback", "http://[::1]/cb", "http://localhost:8080/retour?x=1", "https://client.exemple:8443/retour"];
        Assert.True(ReglesOAuth.RedirectionPermise("http://127.0.0.1:3119/callback", permises));
        Assert.True(ReglesOAuth.RedirectionPermise("http://127.0.0.1:54321/callback", permises));
        Assert.True(ReglesOAuth.RedirectionPermise("http://127.0.0.1/callback", permises));
        Assert.True(ReglesOAuth.RedirectionPermise("http://[::1]:61000/cb", permises));
        Assert.True(ReglesOAuth.RedirectionPermise("http://localhost:9999/retour?x=1", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("http://127.0.0.1:3119/autre", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("http://127.0.0.1:3119/callback/", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("http://127.0.0.1:3119/callback?x=1", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("http://127.0.0.1:3119/callback#f", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("http://localhost:3119/callback", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("http://127.0.0.2:3119/callback", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("http://u@127.0.0.1:3119/callback", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("https://127.0.0.1:3119/callback", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("http://localhost:9999/retour?x=2", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("https://client.exemple:9443/retour", permises));
        Assert.False(ReglesOAuth.RedirectionPermise("http://client.exemple:3118/callback", ["http://client.exemple:3000/callback"]));
    }

    [Fact]
    public void Pkce_s256_seulement()
    {
        // Exemple de la RFC 7636, annexe B.
        const string verificateur = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        const string defi = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        Assert.Equal(defi, ReglesOAuth.Defi(verificateur));
        Assert.True(ReglesOAuth.DefiValide(defi));
        Assert.True(ReglesOAuth.PkceValide(verificateur, defi));
        Assert.False(ReglesOAuth.PkceValide(verificateur[..^1] + "l", defi));
        Assert.False(ReglesOAuth.PkceValide("court", ReglesOAuth.Defi("court")));
        Assert.False(ReglesOAuth.PkceValide(null, defi));
        Assert.False(ReglesOAuth.DefiValide("plain"));
    }

    [Fact]
    public void Audience_du_point_mcp_de_la_societe()
    {
        var attendue = ReglesOAuth.Ressource("https://demo.exemple.fr/");
        Assert.Equal("https://demo.exemple.fr/mcp", attendue);
        Assert.True(ReglesOAuth.RessourceEgale("https://DEMO.exemple.fr/mcp/", attendue));
        Assert.True(ReglesOAuth.RessourceEgale("https://demo.exemple.fr:443/mcp", attendue));
        Assert.False(ReglesOAuth.RessourceEgale("https://autre.exemple.fr/mcp", attendue));
        Assert.False(ReglesOAuth.RessourceEgale("http://demo.exemple.fr/mcp", attendue));
        Assert.False(ReglesOAuth.RessourceEgale("https://demo.exemple.fr/api", attendue));
        Assert.False(ReglesOAuth.RessourceEgale("https://demo.exemple.fr/mcp?x=1", attendue));
        Assert.False(ReglesOAuth.RessourceEgale(null, attendue));
    }

    [Fact]
    public void Jeton_d_acces_court_borne_a_la_delegation()
    {
        var t = new DateTimeOffset(2026, 11, 13, 10, 0, 0, TimeSpan.Zero);
        Assert.Equal(t.AddMinutes(ReglesOAuth.MinutesAcces), ReglesOAuth.EcheanceAcces(t, t.AddDays(3)));
        Assert.Equal(t.AddMinutes(5), ReglesOAuth.EcheanceAcces(t, t.AddMinutes(5)));
        Assert.StartsWith(ReglesOAuth.PrefixeRafraichissement, ReglesOAuth.Nouveau(ReglesOAuth.PrefixeRafraichissement));
        Assert.Equal(64, ReglesOAuth.Empreinte("x").Length);
    }
}

/// <summary>Documents de clients de l'essai (aucune requête sortante) : adresse → document.</summary>
public sealed class DocumentsEssai : IDocumentsClients
{
    public Dictionary<string, DocumentClient> Documents { get; } = new();

    public Task<DocumentClient?> LireAsync(string clientId, CancellationToken ct) => Task.FromResult(Documents.GetValueOrDefault(clientId));
}

/// <summary>
/// Flux OAuth 2.1 de bout en bout sur Kestrel (127.0.0.1) : métadonnées, 401 avec resource_metadata, demande → consentement
/// (délégation créée par l'humain connecté) → code + PKCE → jeton délégué accepté par /mcp (même agent, même journal),
/// refus (PKCE faux, client hors liste blanche ou désactivé, retour différent, audience d'une autre société), rafraîchissement
/// rotatif et rejeu → délégation révoquée. Base LOGIBTP_TEST_PG où 099u, 099v et 099w sont chargés ; sinon rien.
/// </summary>
[Collection(PointMcpTests.Collection)]
public sealed class OAuthMcpTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private readonly string _compte = $"o{Guid.NewGuid():N}"[..20];
    private readonly string _profil = $"P{Guid.NewGuid():N}"[..20].ToUpperInvariant();
    private readonly string _client = $"https://client-{Guid.NewGuid():N}.essai/oauth/meta";
    private readonly string _inactif = $"https://inactif-{Guid.NewGuid():N}.essai/oauth/meta";
    private const string Retour = "https://client.essai/retour";
    private const string Verificateur = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    private const string EnteteHumain = "X-Essai-Humain";
    private readonly JetonsEnMemoire _jetons = new();
    private readonly DocumentsEssai _documents = new();
    private WebApplication? _app;
    private string _adresse = "";
    private HttpClient _http = new();

    public async Task InitializeAsync()
    {
        if (Connexion is null) return;
        _jetons.Profils[_compte] = _profil;
        foreach (var c in new[] { _client, _inactif }) _documents.Documents[c] = new DocumentClient(c, "Client d'essai", [Retour, "http://127.0.0.1:3118/callback"]);
        var b = WebApplication.CreateSlimBuilder();
        b.WebHost.UseUrls("http://127.0.0.1:0");
        b.Logging.ClearProviders();
        b.Services.AddSingleton(new SocieteCourante(null, "Essai", Connexion));
        b.Services.AddSingleton<IJetonsDelegues>(_jetons);
        b.Services.AddSingleton<IDroits, DroitsEssai>();
        b.Services.AddSingleton<IModulesActifs, ModulesEssai>();
        b.Services.AddSingleton<IDocumentsClients>(_documents);
        b.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower);
        b.Services.AddModuleMcp<SpecialisationEssai>((_, o) => o.UseNpgsql(Connexion).UseSnakeCaseNamingConvention());
        var app = b.Build();
        app.UseErreursMetier();
        // Authentification simulée : humain connecté par en-tête, routes publiques OAuth sans utilisateur, sinon jeton délégué.
        app.Use(async (http, suite) =>
        {
            var p = http.Request.Path;
            if (p.StartsWithSegments("/api") && http.Request.Headers[EnteteHumain].ToString() is { Length: > 0 } humain)
                Utilisateur.Poser(http, new Utilisateur(humain.Split('|')[0], humain.Split('|')[1]));
            else if (p.StartsWithSegments("/api") && !Extensions.RoutesPubliques.Any(r => p.StartsWithSegments(r)))
            {
                var e = http.Request.Headers.Authorization.ToString();
                var j = e.StartsWith("Bearer ") ? await _jetons.OuvrirAsync(e[7..], http.RequestAborted) : null;
                if (j is null)
                {
                    http.Response.StatusCode = 401;
                    return;
                }
                Utilisateur.Poser(http, new Utilisateur(j.Compte, j.Profil) { Agent = new AgentRequete(j.Delegation, j.Client) });
            }
            await suite(http);
        });
        app.MapPointMcp();
        var api = app.MapGroup("/api");
        api.MapModuleMcp();
        api.MapGet("/essai/elements", (int? limite, HttpContext http) =>
            Enumerable.Range(1, limite ?? 3).Select(i => new { id = i, nom = $"E{i}", agent = Utilisateur.Depuis(http).Agent?.Delegation }));
        await app.StartAsync();
        _app = app;
        _adresse = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First().TrimEnd('/');
        _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { BaseAddress = new Uri(_adresse) };
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<McpDbContext>();
        db.ClientsOAuth.Add(new ClientOAuthMcp { MclClientId = _client, MclLibelle = "Essai", MclActif = true, MclModifieLe = DateTimeOffset.UtcNow, MclModifiePar = "essai" });
        db.ClientsOAuth.Add(new ClientOAuthMcp { MclClientId = _inactif, MclLibelle = "Inactif", MclActif = false, MclModifieLe = DateTimeOffset.UtcNow, MclModifiePar = "essai" });
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        if (_app is null) return;
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<McpDbContext>();
            var codes = await db.Delegations.Where(d => d.MdeCompte == _compte).Select(d => d.MdeCode).ToListAsync();
            string[] clients = [_client, _inactif];
            await db.RafraichissementsOAuth.Where(r => codes.Contains(r.MraDelegation) || clients.Contains(r.MraClientId)).ExecuteDeleteAsync();
            await db.AutorisationsOAuth.Where(a => clients.Contains(a.MauClientId)).ExecuteDeleteAsync();
            await db.ClientsOAuth.Where(c => clients.Contains(c.MclClientId)).ExecuteDeleteAsync();
            await db.Journal.Where(j => j.AjoCompte == _compte).ExecuteDeleteAsync();
            await db.Compteurs.Where(c => codes.Contains(c.McoDelegation)).ExecuteDeleteAsync();
            await db.Delegations.Where(d => d.MdeCompte == _compte).ExecuteDeleteAsync();
        }
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    private string Ressource => _adresse + "/mcp";

    private string Demande(string? client = null, string? retour = null, string? ressource = null, string? defi = null, string methode = "S256",
        string reponse = "code") =>
        "/api/mcp/oauth/authorize?" + string.Join("&", new Dictionary<string, string>
        {
            ["response_type"] = reponse, ["client_id"] = client ?? _client, ["redirect_uri"] = retour ?? Retour,
            ["code_challenge"] = defi ?? ReglesOAuth.Defi(Verificateur), ["code_challenge_method"] = methode, ["state"] = "etat-123",
            ["resource"] = ressource ?? Ressource, ["scope"] = "mcp",
        }.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"));

    private static Dictionary<string, string> Requete(Uri u) => u.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
        .Select(p => p.Split('=', 2)).ToDictionary(p => Uri.UnescapeDataString(p[0]), p => Uri.UnescapeDataString(p.Length > 1 ? p[1] : ""));

    /// <summary>Demande d'autorisation suivie jusqu'à la page de consentement ; rend le paramètre de la page (demande ou erreur).</summary>
    private async Task<(string Cle, string Valeur)> PageAsync(string chemin)
    {
        using var r = await _http.GetAsync(chemin);
        Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
        var l = r.Headers.Location!.ToString();
        Assert.StartsWith("/agents/autoriser?", l);
        var p = Requete(new Uri("http://x" + l)).Single();
        return (p.Key, p.Value);
    }

    private async Task<JsonNode> HumainAsync(HttpMethod m, string chemin, object? corps = null, HttpStatusCode attendu = HttpStatusCode.OK)
    {
        using var q = new HttpRequestMessage(m, chemin);
        q.Headers.Add(EnteteHumain, $"{_compte}|{_profil}");
        if (corps is not null) q.Content = new StringContent(JsonSerializer.Serialize(corps), Encoding.UTF8, "application/json");
        using var r = await _http.SendAsync(q);
        var texte = await r.Content.ReadAsStringAsync();
        Assert.True(attendu == r.StatusCode, $"{r.StatusCode} : {texte}");
        return JsonNode.Parse(texte)!;
    }

    /// <summary>Demande, consentement (délégation LECTURE), code rendu au client.</summary>
    private async Task<string> CodeAsync()
    {
        var (cle, demande) = await PageAsync(Demande());
        Assert.Equal("demande", cle);
        var presentee = await HumainAsync(HttpMethod.Get, $"/api/mcp/oauth/demandes/{demande}");
        Assert.Equal("Client d'essai", presentee["client_nom"]!.GetValue<string>());
        Assert.Equal("https://client.essai", presentee["retour"]!.GetValue<string>());
        Assert.Contains(ModelePlafond.Lecture, presentee["choix"]!["modeles"]!.AsArray().Select(x => x!.GetValue<string>()));
        var decision = await HumainAsync(HttpMethod.Post, $"/api/mcp/oauth/demandes/{demande}/accepter", new { modele = ModelePlafond.Lecture, jours = 10 });
        var retour = new Uri(decision["redirection"]!.GetValue<string>());
        Assert.StartsWith(Retour + "?", retour.ToString());
        var p = Requete(retour);
        Assert.Equal("etat-123", p["state"]);
        Assert.Equal(_adresse, p["iss"]);
        // Demande décidée : ni relue, ni décidée une seconde fois.
        await HumainAsync(HttpMethod.Get, $"/api/mcp/oauth/demandes/{demande}", attendu: HttpStatusCode.UnprocessableEntity);
        return p["code"];
    }

    private async Task<(HttpStatusCode Statut, JsonNode Corps)> JetonAsync(Dictionary<string, string> formulaire)
    {
        using var r = await _http.PostAsync("/api/mcp/oauth/token", new FormUrlEncodedContent(formulaire));
        Assert.Equal("no-store", r.Headers.CacheControl?.ToString());
        return (r.StatusCode, JsonNode.Parse(await r.Content.ReadAsStringAsync())!);
    }

    private Dictionary<string, string> Code(string code, string? verificateur = null, string? retour = null, string? ressource = null) => new()
    {
        ["grant_type"] = "authorization_code", ["code"] = code, ["client_id"] = _client, ["redirect_uri"] = retour ?? Retour,
        ["code_verifier"] = verificateur ?? Verificateur, ["resource"] = ressource ?? Ressource,
    };

    private Dictionary<string, string> Rafraichir(string jeton) => new()
    {
        ["grant_type"] = "refresh_token", ["refresh_token"] = jeton, ["client_id"] = _client, ["resource"] = Ressource,
    };

    private Task<McpClient> ClientMcp(string jeton) => McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
    {
        Endpoint = new Uri(Ressource),
        TransportMode = HttpTransportMode.StreamableHttp,
        AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = "Bearer " + jeton },
    }));

    private async Task<HttpStatusCode> StatutMcpAsync(string jeton)
    {
        using var m = new HttpRequestMessage(HttpMethod.Post, "/mcp") { Content = new StringContent("""{"jsonrpc":"2.0","id":1,"method":"tools/list"}""", Encoding.UTF8, "application/json") };
        m.Headers.Accept.ParseAdd("application/json");
        m.Headers.Accept.ParseAdd("text/event-stream");
        m.Headers.Authorization = new("Bearer", jeton);
        using var r = await _http.SendAsync(m);
        return r.StatusCode;
    }

    [Fact]
    public async Task Metadonnees_servies_et_401_avec_resource_metadata()
    {
        if (Connexion is null) return;
        foreach (var chemin in new[] { "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp" })
        {
            var prm = JsonNode.Parse(await _http.GetStringAsync(chemin))!;
            Assert.Equal(Ressource, prm["resource"]!.GetValue<string>());
            Assert.Equal(_adresse, prm["authorization_servers"]![0]!.GetValue<string>());
        }
        var asm = JsonNode.Parse(await _http.GetStringAsync("/.well-known/oauth-authorization-server"))!;
        Assert.Equal(_adresse, asm["issuer"]!.GetValue<string>());
        Assert.Equal(_adresse + "/api/mcp/oauth/authorize", asm["authorization_endpoint"]!.GetValue<string>());
        Assert.Equal(_adresse + "/api/mcp/oauth/token", asm["token_endpoint"]!.GetValue<string>());
        Assert.Equal(["S256"], asm["code_challenge_methods_supported"]!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.Equal(["authorization_code", "refresh_token"], asm["grant_types_supported"]!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.Equal(["code"], asm["response_types_supported"]!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.True(asm["client_id_metadata_document_supported"]!.GetValue<bool>());

        using var m = new HttpRequestMessage(HttpMethod.Post, "/mcp") { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
        using var r = await _http.SendAsync(m);
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        Assert.Contains($"resource_metadata=\"{_adresse}/.well-known/oauth-protected-resource/mcp\"", r.Headers.WwwAuthenticate.ToString());

        // Module désactivé : métadonnées absentes.
        ModulesEssai.Actif = false;
        try
        {
            using var absent = await _http.GetAsync("/.well-known/oauth-authorization-server");
            Assert.Equal(HttpStatusCode.NotFound, absent.StatusCode);
        }
        finally
        {
            ModulesEssai.Actif = true;
        }
    }

    [Fact]
    public async Task Code_et_pkce_valides_jeton_accepte_par_mcp_sous_la_delegation()
    {
        if (Connexion is null) return;
        var code = await CodeAsync();
        // PKCE faux : refusé, le code reste utilisable par le vrai client.
        var (statut, corps) = await JetonAsync(Code(code, verificateur: Verificateur[..^1] + "A"));
        Assert.Equal(HttpStatusCode.BadRequest, statut);
        Assert.Equal(ErreurOAuth.OctroiInvalide, corps["error"]!.GetValue<string>());
        // Adresse de retour différente de celle de la demande : refusée.
        (statut, corps) = await JetonAsync(Code(code, retour: "http://127.0.0.1:3118/callback"));
        Assert.Equal(ErreurOAuth.OctroiInvalide, corps["error"]!.GetValue<string>());
        // Audience d'une autre société : refusée.
        (statut, corps) = await JetonAsync(Code(code, ressource: "http://autre.localhost/mcp"));
        Assert.Equal(ErreurOAuth.CibleInvalide, corps["error"]!.GetValue<string>());

        (statut, corps) = await JetonAsync(Code(code));
        Assert.Equal(HttpStatusCode.OK, statut);
        Assert.Equal("Bearer", corps["token_type"]!.GetValue<string>());
        Assert.InRange(corps["expires_in"]!.GetValue<int>(), 1, ReglesOAuth.MinutesAcces * 60);
        var acces = corps["access_token"]!.GetValue<string>();
        Assert.StartsWith("lbtp_agent_", acces);
        Assert.StartsWith(ReglesOAuth.PrefixeRafraichissement, corps["refresh_token"]!.GetValue<string>());

        // Délégation créée par le consentement : celle du jeton (même agent, même plafond, même journal).
        var delegation = await Avec(db => db.Delegations.AsNoTracking().SingleAsync(d => d.MdeCompte == _compte));
        Assert.Equal(_client, delegation.MdeClientOauth);
        Assert.Equal("Client d'essai", delegation.MdeClient);
        Assert.Equal(ModelePlafond.Lecture, delegation.MdeModele);
        Assert.Equal(delegation.MdeCode, _jetons.Jetons[acces].Jeton.Delegation);

        await using (var client = await ClientMcp(acces))
        {
            var outil = Assert.Single(await client.ListToolsAsync());
            Assert.Equal("lister_elements", outil.Name);
            var r = await client.CallToolAsync("lister_elements", new Dictionary<string, object?> { ["limite"] = 1 });
            Assert.NotEqual(true, r.IsError);
        }
        var journal = await Avec(db => db.Journal.AsNoTracking().Where(j => j.AjoCompte == _compte).ToListAsync());
        Assert.Equal(delegation.MdeCode, Assert.Single(journal).AjoDelegation);

        // Code rejoué : refusé et délégation révoquée (vol présumé).
        (statut, corps) = await JetonAsync(Code(code));
        Assert.Equal(ErreurOAuth.OctroiInvalide, corps["error"]!.GetValue<string>());
        Assert.NotNull((await Avec(db => db.Delegations.AsNoTracking().SingleAsync(d => d.MdeCode == delegation.MdeCode))).MdeRevoqueeLe);
        Assert.Equal(HttpStatusCode.Unauthorized, await StatutMcpAsync(acces));
    }

    [Fact]
    public async Task Rafraichissement_rotatif_et_rejeu_revoque_la_delegation()
    {
        if (Connexion is null) return;
        var (_, premier) = await JetonAsync(Code(await CodeAsync()));
        var ancien = premier["refresh_token"]!.GetValue<string>();
        var (statut, second) = await JetonAsync(Rafraichir(ancien));
        Assert.Equal(HttpStatusCode.OK, statut);
        var nouveau = second["refresh_token"]!.GetValue<string>();
        var acces = second["access_token"]!.GetValue<string>();
        Assert.NotEqual(ancien, nouveau);
        Assert.NotEqual(premier["access_token"]!.GetValue<string>(), acces);
        Assert.Equal(HttpStatusCode.OK, await StatutMcpAsync(acces));

        // Ancien jeton rejoué : refus, délégation révoquée avec tous ses jetons, rejeu au journal.
        var (refus, corps) = await JetonAsync(Rafraichir(ancien));
        Assert.Equal(HttpStatusCode.BadRequest, refus);
        Assert.Equal(ErreurOAuth.OctroiInvalide, corps["error"]!.GetValue<string>());
        var d = await Avec(db => db.Delegations.AsNoTracking().SingleAsync(x => x.MdeCompte == _compte));
        Assert.NotNull(d.MdeRevoqueeLe);
        Assert.Equal(ServiceOAuth.RevoqueurOAuth, d.MdeRevoqueePar);
        Assert.Equal(HttpStatusCode.Unauthorized, await StatutMcpAsync(acces));
        (refus, corps) = await JetonAsync(Rafraichir(nouveau));
        Assert.Equal(ErreurOAuth.OctroiInvalide, corps["error"]!.GetValue<string>());
        Assert.Contains(await Avec(db => db.Journal.AsNoTracking().Where(j => j.AjoCompte == _compte).Select(j => j.AjoErreur).ToListAsync()),
            e => e == ErreurMcp.McpOauthRejeu);
    }

    [Fact]
    public async Task Demandes_refusees_client_retour_pkce_audience()
    {
        if (Connexion is null) return;
        // Client hors liste blanche, désactivé, ou document absent : page d'erreur, jamais de redirection vers le client.
        Assert.Equal(("erreur", ErreurMcp.McpOauthClient), await PageAsync(Demande(client: "https://inconnu.essai/oauth/meta")));
        Assert.Equal(("erreur", ErreurMcp.McpOauthClient), await PageAsync(Demande(client: _inactif)));
        Assert.Equal(("erreur", ErreurMcp.McpOauthClient), await PageAsync(Demande(client: "http://client.essai/meta")));
        // Adresse de retour absente du document du client (même à une barre près).
        Assert.Equal(("erreur", ErreurMcp.McpOauthRedirection), await PageAsync(Demande(retour: Retour + "/")));
        Assert.Equal(("erreur", ErreurMcp.McpOauthRedirection), await PageAsync(Demande(retour: "https://pirate.essai/retour")));
        // Boucle locale déclarée (http://127.0.0.1:3118/callback) : tout port accepté (RFC 8252 § 7.3), jamais un autre chemin ni hôte.
        Assert.Equal("demande", (await PageAsync(Demande(retour: "http://127.0.0.1:53682/callback"))).Cle);
        Assert.Equal(("erreur", ErreurMcp.McpOauthRedirection), await PageAsync(Demande(retour: "http://127.0.0.1:53682/autre")));
        Assert.Equal(("erreur", ErreurMcp.McpOauthRedirection), await PageAsync(Demande(retour: "http://localhost:53682/callback")));

        // Erreurs rendues au client vérifié : PKCE absent ou « plain », réponse autre que code, audience d'une autre société.
        async Task<string> ErreurClient(string chemin)
        {
            using var r = await _http.GetAsync(chemin);
            Assert.Equal(HttpStatusCode.Redirect, r.StatusCode);
            Assert.StartsWith(Retour + "?", r.Headers.Location!.ToString());
            var p = Requete(r.Headers.Location!);
            Assert.Equal("etat-123", p["state"]);
            return p["error"];
        }
        Assert.Equal(ErreurOAuth.RequeteInvalide, await ErreurClient(Demande(methode: "plain", defi: Verificateur)));
        Assert.Equal(ErreurOAuth.ReponseNonPrise, await ErreurClient(Demande(reponse: "token")));
        Assert.Equal(ErreurOAuth.CibleInvalide, await ErreurClient(Demande(ressource: "http://autre.localhost/mcp")));

        // Point de jeton : octroi par mot de passe refusé, client confidentiel refusé, code inconnu refusé.
        var (_, c1) = await JetonAsync(new() { ["grant_type"] = "password", ["client_id"] = _client, ["username"] = "a", ["password"] = "b" });
        Assert.Equal(ErreurOAuth.OctroiNonPris, c1["error"]!.GetValue<string>());
        var (s2, c2) = await JetonAsync(new() { ["grant_type"] = "authorization_code", ["client_id"] = _client, ["client_secret"] = "x", ["code"] = "c" });
        Assert.Equal(HttpStatusCode.Unauthorized, s2);
        Assert.Equal(ErreurOAuth.ClientInvalide, c2["error"]!.GetValue<string>());
        var (_, c3) = await JetonAsync(Code("lbtp_code_inconnu"));
        Assert.Equal(ErreurOAuth.OctroiInvalide, c3["error"]!.GetValue<string>());

        // Refus de l'utilisateur : retour au client avec access_denied ; demande close.
        var (_, demande) = await PageAsync(Demande());
        var refus = await HumainAsync(HttpMethod.Post, $"/api/mcp/oauth/demandes/{demande}/refuser");
        var p = Requete(new Uri(refus["redirection"]!.GetValue<string>()));
        Assert.Equal(ErreurOAuth.AccesRefuse, p["error"]);
        Assert.Equal("etat-123", p["state"]);
        await HumainAsync(HttpMethod.Post, $"/api/mcp/oauth/demandes/{demande}/accepter", new { modele = ModelePlafond.Lecture },
            HttpStatusCode.UnprocessableEntity);

        // Client désactivé après la demande : consentement refusé.
        var (_, autre) = await PageAsync(Demande());
        await Avec(db => db.ClientsOAuth.Where(c => c.MclClientId == _client).ExecuteUpdateAsync(x => x.SetProperty(c => c.MclActif, false)));
        try
        {
            var e = await HumainAsync(HttpMethod.Post, $"/api/mcp/oauth/demandes/{autre}/accepter", new { modele = ModelePlafond.Lecture },
                HttpStatusCode.UnprocessableEntity);
            Assert.Equal(ErreurMcp.McpOauthClient, e["code"]!.GetValue<string>());
        }
        finally
        {
            await Avec(db => db.ClientsOAuth.Where(c => c.MclClientId == _client).ExecuteUpdateAsync(x => x.SetProperty(c => c.MclActif, true)));
        }
    }

    [Fact]
    public async Task Liste_blanche_reservee_a_l_administrateur_et_controlee()
    {
        if (Connexion is null) return;
        using var q = new HttpRequestMessage(HttpMethod.Get, "/api/mcp/clients");
        q.Headers.Add(EnteteHumain, $"{_compte}|{_profil}");
        using var r = await _http.SendAsync(q);
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.NotEmpty(ServiceOAuth.ControlerClients([new ClientOAuthSaisi("http://client.essai/meta", "x")]));
        Assert.Empty(ServiceOAuth.ControlerClients([new ClientOAuthSaisi(_client, "Essai", false)]));
        var admin = new Utilisateur("admin_essai", Profils.Admin);
        var liste = await AvecServices(async sp =>
        {
            var s = sp.GetRequiredService<ServiceOAuth>();
            var avant = await s.ClientsAsync(admin, default);
            Assert.Contains(avant, c => c.ClientId == _client && c.Actif);
            return avant;
        });
        Assert.Contains(liste, c => c.ClientId == _inactif && !c.Actif);
    }

    private async Task<T> Avec<T>(Func<McpDbContext, Task<T>> f)
    {
        using var scope = _app!.Services.CreateScope();
        return await f(scope.ServiceProvider.GetRequiredService<McpDbContext>());
    }

    private async Task<T> AvecServices<T>(Func<IServiceProvider, Task<T>> f)
    {
        using var scope = _app!.Services.CreateScope();
        return await f(scope.ServiceProvider);
    }
}
