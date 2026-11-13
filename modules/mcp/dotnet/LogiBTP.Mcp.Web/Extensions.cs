using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;

namespace LogiBTP.Mcp.Web;

/// <summary>Branchement du module MCP dans une application ASP.NET Core (facultatif : l'application fonctionne sans).</summary>
public static class Extensions
{
    /// <summary>Chemin du point MCP (Streamable HTTP), servi par sous-domaine comme l'application.</summary>
    public const string Chemin = "/mcp";

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
        services.AddScoped<IPlafondAgent, PlafondMcp>();
        services.AddHttpContextAccessor();
        services.TryAddSingleton<IAppelInterne, AppelInterneHttp>();
        services.AddMcpServer(o =>
            {
                o.ServerInfo = new Implementation { Name = "LogiBTP", Version = "1.0" };
                o.Capabilities = new ServerCapabilities { Tools = new ToolsCapability { ListChanged = false } };
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

    private static Task Refuser(HttpContext http)
    {
        http.Response.StatusCode = StatusCodes.Status401Unauthorized;
        http.Response.Headers.WWWAuthenticate = "Bearer";
        return http.Response.WriteAsJsonAsync(new { status = 401, code = ErreurMcp.McpJetonRequis, title = "Jeton délégué requis" }, JsonCalcul.Options);
    }

    /// <summary>
    /// Point /mcp : exige un jeton délégué valide (401 MCP_JETON_REQUIS sinon), délégation active du même compte ; pose
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
        var point = app.MapMcp(Chemin);
        point.Add(b =>
        {
            var suite = b.RequestDelegate;
            if (suite is null) return;
            b.RequestDelegate = async http =>
            {
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
    /// paramètres (administrateur : levées par profil, quotas), journal (le mien ; tout pour l'administrateur).
    /// </summary>
    public static RouteGroupBuilder MapModuleMcp(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/mcp");
        g.MapGet("/delegations", (bool? toutes, HttpContext http, ServiceDelegations s, CancellationToken ct) =>
            s.ListerAsync(Utilisateur.Depuis(http), toutes ?? false, ct));
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
        return api;
    }
}
