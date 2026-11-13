using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using System.Threading.RateLimiting;

namespace LogiBTP.Mcp.Web;

/// <summary>Branchement du module MCP dans une application ASP.NET Core (facultatif : l'application fonctionne sans).</summary>
public static class Extensions
{
    /// <summary>Chemin du point MCP (Streamable HTTP), servi par sous-domaine comme l'application.</summary>
    public const string Chemin = "/mcp";

    /// <summary>
    /// Routes /api du serveur d'autorisation OAuth (lot 12) ouvertes sans session : demande d'autorisation (navigation
    /// depuis le site du client, sans cookie) et point de jeton (client distant). L'application les déclare publiques
    /// (Authentification : RoutesPubliques ; Droits : mode Publique).
    /// </summary>
    public static readonly string[] RoutesPubliques = [ServiceOAuth.CheminAutorisation, ServiceOAuth.CheminJeton];

    /// <summary>Politique de débit des routes publiques OAuth : 30 requêtes par minute et par adresse.</summary>
    public const string PolitiqueDebitOAuth = "mcp_oauth";

    /// <summary>
    /// Services du module : contexte EF (base de la société), spécialisation, plafond des agents (contrat
    /// <see cref="IPlafondAgent"/> lu par le module Droits), appel interne (substituable : enregistrer un autre
    /// <see cref="IAppelInterne"/> avant), serveur MCP du SDK officiel (Streamable HTTP sans état, outils dynamiques).
    /// </summary>
    public static IServiceCollection AddModuleMcp<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationMcp
    {
        services.AddDbContext<McpDbContext>(options);
        services.AddSingleton<SpecialisationMcp, TSpecialisation>();
        services.AddScoped<ServiceDelegations>();
        services.AddScoped<ServiceMcp>();
        services.AddScoped<ServicePropositions>();
        services.AddScoped<IPlafondAgent, PlafondMcp>();
        services.AddScoped<ServiceOAuth>();
        services.AddScoped<ServiceRecettes>();
        services.AddHttpContextAccessor();
        services.TryAddSingleton<IAppelInterne, AppelInterneHttp>();
        services.TryAddSingleton<IDocumentsClients, DocumentsClientsHttp>();
        // Routes publiques du serveur d'autorisation : débit borné par adresse (en plus des limites de l'application).
        services.AddRateLimiter(o => o.AddPolicy(PolitiqueDebitOAuth, http => RateLimitPartition.GetFixedWindowLimiter(
            "mcp_oauth:" + (http.Connection.RemoteIpAddress?.ToString() ?? "?"),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
        services.AddMcpServer(o =>
            {
                o.ServerInfo = new Implementation { Name = "LogiBTP", Version = "1.0" };
                o.Capabilities = new ServerCapabilities
                {
                    Tools = new ToolsCapability { ListChanged = false },
                    // Recettes (lot 13) exposées comme prompts MCP : celles dont tous les outils sont permis à la délégation.
                    Prompts = new PromptsCapability { ListChanged = false },
                };
            })
            // Sans état : chaque requête porte le jeton et ouvre son propre contexte (pas de session à garder en mémoire,
            // ni de requête du serveur vers le client : R13).
            .WithHttpTransport(o => o.Stateless = true)
            .WithListToolsHandler(async (requete, ct) =>
            {
                var (ctx, service) = Agent(requete.Services);
                return new ListToolsResult { Tools = await service.OutilsAsync(ctx, ct) };
            })
            .WithCallToolHandler(async (requete, ct) =>
            {
                var (ctx, service) = Agent(requete.Services);
                var p = requete.Params ?? throw new McpProtocolException("Paramètres absents", McpErrorCode.InvalidParams);
                var r = await service.AppelerAsync(ctx, p.Name, p.Arguments?.ToDictionary(kv => kv.Key, kv => kv.Value), ct);
                return new CallToolResult { Content = [new TextContentBlock { Text = r.Texte }], IsError = r.Erreur };
            })
            .WithListPromptsHandler(async (requete, ct) =>
            {
                var (ctx, _) = Agent(requete.Services);
                return new ListPromptsResult { Prompts = await Recettes(requete.Services).PromptsAsync(ctx, ct) };
            })
            .WithGetPromptHandler(async (requete, ct) =>
            {
                var (ctx, _) = Agent(requete.Services);
                var p = requete.Params ?? throw new McpProtocolException("Paramètres absents", McpErrorCode.InvalidParams);
                return await Recettes(requete.Services).PromptAsync(ctx, p.Name,
                    p.Arguments?.ToDictionary(kv => kv.Key, kv => kv.Value), ct);
            });
        return services;
    }

    /// <summary>Agent et service de la requête HTTP en cours (posés par le contrôle du jeton du point /mcp).</summary>
    private static (ContexteAgent, ServiceMcp) Agent(IServiceProvider? services)
    {
        var http = (services ?? throw new McpProtocolException("Services absents", McpErrorCode.InternalError))
            .GetRequiredService<IHttpContextAccessor>().HttpContext;
        if (http?.Items[ServiceMcp.CleContexte] is not ContexteAgent ctx) throw new McpProtocolException("Agent non authentifié", McpErrorCode.InvalidRequest);
        return (ctx, http.RequestServices.GetRequiredService<ServiceMcp>());
    }

    /// <summary>Service des recettes de la requête HTTP en cours.</summary>
    private static ServiceRecettes Recettes(IServiceProvider? services) =>
        services!.GetRequiredService<IHttpContextAccessor>().HttpContext!.RequestServices.GetRequiredService<ServiceRecettes>();

    /// <summary>
    /// 401 du point /mcp : en-tête WWW-Authenticate avec l'adresse des métadonnées de la ressource protégée (RFC 9728 § 5.1),
    /// point de départ de la découverte du serveur d'autorisation par un client OAuth (sans consentement déclaré : « Bearer » seul).
    /// </summary>
    private static Task Refuser(HttpContext http)
    {
        http.Response.StatusCode = StatusCodes.Status401Unauthorized;
        http.Response.Headers.WWWAuthenticate = http.RequestServices.GetRequiredService<SpecialisationMcp>().AdresseConsentement is null ? "Bearer"
            : $"Bearer resource_metadata=\"{ServiceOAuth.AdresseMetadonnees(ServiceMcp.Origine(http))}\", scope=\"{ReglesOAuth.Portee}\"";
        return http.Response.WriteAsJsonAsync(new { status = 401, code = ErreurMcp.McpJetonRequis, title = "Jeton délégué requis" }, JsonCalcul.Options);
    }

    private static Task RefuserModule(HttpContext http)
    {
        http.Response.StatusCode = StatusCodes.Status403Forbidden;
        return http.Response.WriteAsJsonAsync(new { status = 403, code = ErreurMcp.McpModuleInactif, title = "Module MCP désactivé pour cette société" }, JsonCalcul.Options);
    }

    /// <summary>
    /// Point /mcp : refusé (403 MCP_MODULE_INACTIF) quand le module de l'application qui l'active
    /// (<see cref="SpecialisationMcp.Module"/>) est désactivé pour la société ; exige un jeton délégué valide (401 MCP_JETON_REQUIS sinon), délégation active du même compte ; pose
    /// l'agent sur la requête. Refuse de démarrer en mode d'authentification par en-têtes (R2) et sans contrat
    /// <see cref="IJetonsDelegues"/> (module Authentification absent).
    /// </summary>
    public static IEndpointConventionBuilder MapPointMcp(this IEndpointRouteBuilder app)
    {
        var configuration = app.ServiceProvider.GetRequiredService<IConfiguration>();
        if (string.Equals(configuration["Authentification:Mode"], "EnTetes", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("MCP : le point /mcp ne démarre pas en mode d'authentification par en-têtes (Authentification:Mode=EnTetes)");
        if (app.ServiceProvider.GetService<IServiceProviderIsService>() is { } est && !est.IsService(typeof(IJetonsDelegues)))
            throw new InvalidOperationException("MCP : le point /mcp exige le module Authentification (contrat IJetonsDelegues)");
        // Métadonnées OAuth (lot 12) à la racine du sous-domaine : ressource protégée (RFC 9728, forme simple et suffixée
        // du chemin /mcp) et serveur d'autorisation (RFC 8414) ; 404 quand le module est désactivé ou le consentement absent.
        async Task<IResult> Metadonnees(HttpContext http, SpecialisationMcp s, Func<string, System.Text.Json.Nodes.JsonObject> document)
        {
            if (s.AdresseConsentement is null) return Results.NotFound();
            if (s.Module is { } module && http.RequestServices.GetService<IModulesActifs>() is { } modules && !await modules.EstActifAsync(module, http.RequestAborted))
                return Results.NotFound();
            http.Response.Headers.CacheControl = "max-age=300";
            return Results.Json(document(ServiceMcp.Origine(http)));
        }
        app.MapGet(ServiceOAuth.CheminMetadonneesRessource, (HttpContext http, SpecialisationMcp s) => Metadonnees(http, s, ServiceOAuth.MetadonneesRessource));
        app.MapGet(ServiceOAuth.CheminMetadonneesRessource + Chemin, (HttpContext http, SpecialisationMcp s) => Metadonnees(http, s, ServiceOAuth.MetadonneesRessource));
        app.MapGet(ServiceOAuth.CheminMetadonneesServeur, (HttpContext http, SpecialisationMcp s) => Metadonnees(http, s, ServiceOAuth.MetadonneesServeur));
        var point = app.MapMcp(Chemin);
        point.Add(b =>
        {
            var suite = b.RequestDelegate;
            if (suite is null) return;
            b.RequestDelegate = async http =>
            {
                if (http.RequestServices.GetRequiredService<SpecialisationMcp>().Module is { } module
                    && http.RequestServices.GetService<IModulesActifs>() is { } modules && !await modules.EstActifAsync(module, http.RequestAborted))
                {
                    await RefuserModule(http);
                    return;
                }
                var service = http.RequestServices.GetRequiredService<ServiceMcp>();
                var ctx = await service.OuvrirAsync(http, http.RequestAborted);
                if (ctx is null)
                {
                    await Refuser(http);
                    return;
                }
                http.Items[ServiceMcp.CleContexte] = ctx;
                Utilisateur.Poser(http, ctx.Utilisateur);
                await suite(http);
            };
        });
        return point;
    }

    /// <summary>
    /// Routes de gestion, sous /mcp du groupe /api (droits rattachés par l'application : nœud de la spécialisation,
    /// « agents » ; jamais ouvertes à un agent) : mes délégations (lister, créer : secret rendu une fois, révoquer),
    /// paramètres (administrateur : levées par profil, quotas), journal (le mien ; tout pour l'administrateur), file des
    /// propositions (lister, lire, corriger, refuser, accepter : lot 10).
    /// </summary>
    public static RouteGroupBuilder MapModuleMcp(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/mcp");
        g.MapGet("/delegations", (bool? toutes, HttpContext http, ServiceDelegations s, CancellationToken ct) =>
            s.ListerAsync(Utilisateur.Depuis(http), toutes ?? false, ct));
        g.MapGet("/delegations/choix", (HttpContext http, ServiceDelegations s, CancellationToken ct) => s.ChoixAsync(Utilisateur.Depuis(http), ct));
        g.MapPost("/delegations", (DelegationDemandee d, HttpContext http, ServiceDelegations s, CancellationToken ct) =>
            s.CreerAsync(d, Utilisateur.Depuis(http), ct));
        g.MapPost("/delegations/{code}/revoquer", async (string code, HttpContext http, ServiceDelegations s, CancellationToken ct) =>
        {
            await s.RevoquerAsync(code, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapGet("/parametres", (HttpContext http, ServiceDelegations s, CancellationToken ct) => s.ParametresAsync(Utilisateur.Depuis(http), ct));
        g.MapPut("/parametres/{profil}", (string profil, LeveeSaisie l, HttpContext http, ServiceDelegations s, CancellationToken ct) =>
            s.EnregistrerLeveeAsync(profil, l, Utilisateur.Depuis(http), ct)).EnTransaction();
        g.MapGet("/journal", (bool? tous, string? delegation, DateOnly? du, DateOnly? au, int? limite, HttpContext http, ServiceDelegations s, CancellationToken ct) =>
            s.JournalAsync(Utilisateur.Depuis(http), tous ?? false, delegation, du, au, limite, ct));
        // File des propositions (lot 10) : décisions d'un humain seulement ; acceptation exécutée sous son identité, dans la
        // transaction ouverte par le service (pas de EnTransaction : l'échec est journalisé hors de la transaction annulée).
        g.MapGet("/propositions", (string? vue, string? etat, int? limite, HttpContext http, ServicePropositions s, CancellationToken ct) =>
            s.ListerAsync(Utilisateur.Depuis(http), vue, etat, limite, ct));
        g.MapGet("/propositions/{id:long}", (long id, HttpContext http, ServicePropositions s, CancellationToken ct) => s.LireAsync(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/propositions/{id:long}/accepter", (long id, HttpContext http, ServicePropositions s, CancellationToken ct) => s.AccepterAsync(id, http, ct));
        g.MapPut("/propositions/{id:long}/contenu", (long id, CorrectionProposition c, HttpContext http, ServicePropositions s, CancellationToken ct) =>
            s.CorrigerAsync(id, c, Utilisateur.Depuis(http), ct));
        g.MapPost("/propositions/{id:long}/refuser", (long id, RefusProposition r, HttpContext http, ServicePropositions s, CancellationToken ct) =>
            s.RefuserAsync(id, r, Utilisateur.Depuis(http), ct));
        // Serveur d'autorisation OAuth 2.1 (lot 12) : demande et jeton publics (débit borné) ; consentement par l'utilisateur
        // connecté (création de la délégation) ; liste blanche des clients (administrateur).
        g.MapGet("/oauth/authorize", (HttpContext http, ServiceOAuth s, CancellationToken ct) => s.AutoriserAsync(http, ct))
            .RequireRateLimiting(PolitiqueDebitOAuth);
        g.MapPost("/oauth/token", (HttpContext http, ServiceOAuth s, CancellationToken ct) => s.JetonAsync(http, ct))
            .RequireRateLimiting(PolitiqueDebitOAuth).DisableAntiforgery();
        g.MapGet("/oauth/demandes/{demande}", (string demande, HttpContext http, ServiceOAuth s, CancellationToken ct) =>
            s.DemandeAsync(demande, Utilisateur.Depuis(http), ct));
        g.MapPost("/oauth/demandes/{demande}/accepter", (string demande, DelegationDemandee d, HttpContext http, ServiceOAuth s, CancellationToken ct) =>
            s.AccepterAsync(demande, d, Utilisateur.Depuis(http), ct));
        g.MapPost("/oauth/demandes/{demande}/refuser", (string demande, HttpContext http, ServiceOAuth s, CancellationToken ct) =>
            s.RefuserAsync(demande, Utilisateur.Depuis(http), ct));
        // Recettes (lot 13) : lues par tout humain (actives ; toutes et catalogue des outils pour l'administrateur), gérées par
        // l'administrateur seul (jamais par un agent).
        g.MapGet("/recettes", (bool? toutes, HttpContext http, ServiceRecettes s, CancellationToken ct) => s.ListerAsync(Utilisateur.Depuis(http), toutes ?? false, ct));
        g.MapPut("/recettes/{code}", (string code, RecetteSaisie r, HttpContext http, ServiceRecettes s, CancellationToken ct) =>
            s.EnregistrerAsync(code, r, Utilisateur.Depuis(http), ct)).EnTransaction();
        g.MapDelete("/recettes/{code}", async (string code, HttpContext http, ServiceRecettes s, CancellationToken ct) =>
        {
            await s.SupprimerAsync(code, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        }).EnTransaction();
        g.MapGet("/clients", (HttpContext http, ServiceOAuth s, CancellationToken ct) => s.ClientsAsync(Utilisateur.Depuis(http), ct));
        g.MapPut("/clients", (IReadOnlyList<ClientOAuthSaisi> liste, HttpContext http, ServiceOAuth s, CancellationToken ct) =>
            s.EnregistrerClientsAsync(liste, Utilisateur.Depuis(http), ct)).EnTransaction();
        return api;
    }
}
