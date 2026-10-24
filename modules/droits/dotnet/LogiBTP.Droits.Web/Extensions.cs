using System.Text.RegularExpressions;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LogiBTP.Droits.Web;

/// <summary>Rattachement d'un gabarit de route à la table des routes (préfixe le plus long).</summary>
public static partial class RoutesDroits
{
    [GeneratedRegex(@"\{\*{0,2}([A-Za-z_][A-Za-z0-9_]*)[^}]*\}")]
    private static partial Regex Parametre();

    /// <summary>Gabarit sans contraintes ni options (« {id:long} » → « {id} »), avec « / » en tête.</summary>
    public static string Normaliser(string gabarit)
    {
        var g = Parametre().Replace(gabarit, "{$1}").TrimEnd('/');
        return g.StartsWith('/') ? g : "/" + g;
    }

    public static RouteDroits? Trouver(IEnumerable<RouteDroits> routes, string gabarit)
    {
        var g = Normaliser(gabarit);
        return routes.Where(r => g == r.Prefixe || g.StartsWith(r.Prefixe.TrimEnd('/') + "/", StringComparison.Ordinal))
            .OrderByDescending(r => r.Prefixe.Length).FirstOrDefault();
    }

    /// <summary>Nœud de la route avec ses valeurs ({type} → valeur de la route).</summary>
    public static string Noeud(string noeud, Func<string, string?> valeur) =>
        Parametre().Replace(noeud, m => valeur(m.Groups[1].Value) ?? m.Value);
}

/// <summary>Branchement du module Droits dans une application ASP.NET Core.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleDroits<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationDroits
    {
        services.AddDbContext<DroitsDbContext>(options);
        services.AddSingleton<SpecialisationDroits, TSpecialisation>();
        services.AddScoped<ServiceDroits>();
        services.AddScoped<IDroits>(sp => sp.GetRequiredService<ServiceDroits>());
        return services;
    }

    private static Task Refuser(HttpContext http, string code, string titre)
    {
        http.Response.StatusCode = StatusCodes.Status403Forbidden;
        return http.Response.WriteAsJsonAsync(new { status = 403, code, title = titre }, JsonCalcul.Options);
    }

    /// <summary>
    /// Intergiciel des droits, après l'authentification : chaque route /api est rattachée à un nœud par la table de la
    /// spécialisation ; une route absente de la table est refusée (403 DROIT_NON_DECLARE : refus par défaut).
    /// </summary>
    public static IApplicationBuilder UseDroits(this IApplicationBuilder app)
    {
        var routes = app.ApplicationServices.GetRequiredService<SpecialisationDroits>().Routes;
        return app.Use(async (http, next) =>
        {
            if (!http.Request.Path.StartsWithSegments("/api") || HttpMethods.IsOptions(http.Request.Method)
                || http.GetEndpoint() is not RouteEndpoint ep || ep.RoutePattern.RawText is not { } gabarit)
            {
                await next(http);
                return;
            }
            var r = RoutesDroits.Trouver(routes, gabarit);
            if (r is null)
            {
                await Refuser(http, "DROIT_NON_DECLARE", "Route sans droit déclaré : accès refusé");
                return;
            }
            if (r.Mode is ModeRoute.Module or ModeRoute.Action)
            {
                var u = Utilisateur.Depuis(http);
                var droits = await http.RequestServices.GetRequiredService<ServiceDroits>().DroitsAsync(u.Profil, http.RequestAborted);
                var noeud = RoutesDroits.Noeud(r.Noeud!, n => http.Request.RouteValues.TryGetValue(n, out var v) ? v?.ToString() : null);
                var ecriture = !HttpMethods.IsGet(http.Request.Method) && !HttpMethods.IsHead(http.Request.Method);
                var permis = r.Mode == ModeRoute.Module ? ReglesDroits.AccesSousArbre(droits, noeud, ecriture) : ReglesDroits.Autorise(droits, noeud, r.Action!);
                if (!permis)
                {
                    await Refuser(http, "ACCES_REFUSE", $"Droit refusé : {noeud}");
                    return;
                }
            }
            await next(http);
        });
    }

    /// <summary>
    /// Routes /api sans droit déclaré (test de démarrage) : erreur au démarrage en développement, journal ailleurs.
    /// </summary>
    public static IReadOnlyList<string> VerifierRoutesDroits(this WebApplication app)
    {
        var routes = app.Services.GetRequiredService<SpecialisationDroits>().Routes;
        var manquantes = ((IEndpointRouteBuilder)app).DataSources.SelectMany(d => d.Endpoints).OfType<RouteEndpoint>()
            .Select(e => RoutesDroits.Normaliser(e.RoutePattern.RawText ?? ""))
            .Where(g => g.StartsWith("/api/", StringComparison.Ordinal) && RoutesDroits.Trouver(routes, g) is null)
            .Distinct().Order(StringComparer.Ordinal).ToList();
        if (manquantes.Count > 0)
        {
            var message = $"Droits : {manquantes.Count} route(s) sans droit déclaré (refusées) : {string.Join(", ", manquantes)}";
            if (app.Environment.IsDevelopment()) throw new InvalidOperationException(message);
            app.Logger.LogError("{Message}", message);
        }
        return manquantes;
    }

    /// <summary>Routes HTTP du module, sous /droits (gestion : nœud administration/profils, posé par la table des routes).</summary>
    public static RouteGroupBuilder MapModuleDroits(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/droits");
        g.MapGet("/moi", (HttpContext http, ServiceDroits s, CancellationToken ct) => s.MoiAsync(Utilisateur.Depuis(http), ct));
        g.MapGet("/catalogue", (ServiceDroits s, CancellationToken ct) => s.CatalogueAsync(ct));
        g.MapGet("/profils", (ServiceDroits s, CancellationToken ct) => s.ListeAsync(ct));
        g.MapPost("/profils", (ProfilSaisi p, HttpContext http, ServiceDroits s, CancellationToken ct) => s.CreerAsync(p, Utilisateur.Depuis(http), ct));
        g.MapPut("/profils/{id:guid}", (Guid id, ProfilSaisi p, HttpContext http, ServiceDroits s, CancellationToken ct) => s.ModifierAsync(id, p, Utilisateur.Depuis(http), ct));
        g.MapDelete("/profils/{id:guid}", async (Guid id, HttpContext http, ServiceDroits s, CancellationToken ct) =>
        {
            await s.SupprimerAsync(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapGet("/profils/{id:guid}/droits", (Guid id, ServiceDroits s, CancellationToken ct) => s.LignesAsync(id, ct));
        g.MapPut("/profils/{id:guid}/droits", (Guid id, DroitsSaisis d, HttpContext http, ServiceDroits s, CancellationToken ct) => s.RemplacerAsync(id, d, Utilisateur.Depuis(http), ct));
        g.MapGet("/journal", (string? profil, ServiceDroits s, CancellationToken ct) => s.JournalAsync(profil, ct));
        return g;
    }
}
