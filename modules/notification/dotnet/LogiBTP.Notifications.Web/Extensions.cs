using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace LogiBTP.Notifications.Web;

/// <summary>Branchement du module Notifications.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleNotifications(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options, IConfiguration section)
    {
        services.Configure<OptionsNotifications>(section);
        services.AddDbContext<NotificationDbContext>(options);
        services.AddScoped<ServiceNotification>();
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<PlanificateurNotifications>();
        services.AddHostedService(sp => sp.GetRequiredService<PlanificateurNotifications>());
        return services;
    }

    /// <summary>Source de notifications du planificateur (portée par base de société).</summary>
    public static IServiceCollection AddSourceNotifications<TSource>(this IServiceCollection services) where TSource : class, ISourceNotifications =>
        services.AddScoped<ISourceNotifications, TSource>();

    /// <summary>Routes HTTP du module, sous /notifications (boîte de l'utilisateur de la session).</summary>
    public static RouteGroupBuilder MapModuleNotifications(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/notifications");
        g.MapGet("", (string? etat, string? module, int? page, int? taille, HttpContext http, ServiceNotification s, CancellationToken ct) =>
            s.BoiteAsync(Utilisateur.Depuis(http), etat, module, page ?? 1, taille ?? 50, ct));
        g.MapGet("/compteur", (HttpContext http, ServiceNotification s, CancellationToken ct) => s.CompteurAsync(Utilisateur.Depuis(http), ct));
        g.MapPost("/lues", (Marquage m, HttpContext http, ServiceNotification s, CancellationToken ct) => s.MarquerAsync(Utilisateur.Depuis(http), m, false, ct));
        g.MapPost("/traitees", (Marquage m, HttpContext http, ServiceNotification s, CancellationToken ct) => s.MarquerAsync(Utilisateur.Depuis(http), m, true, ct));
        g.MapGet("/preferences", (HttpContext http, ServiceNotification s, CancellationToken ct) => s.PreferencesAsync(Utilisateur.Depuis(http), ct));
        g.MapPut("/preferences", async (List<PreferenceNotification> l, HttpContext http, ServiceNotification s, CancellationToken ct) =>
        {
            await s.EnregistrerPreferencesAsync(Utilisateur.Depuis(http), l, ct);
            return await s.PreferencesAsync(Utilisateur.Depuis(http), ct);
        });
        // Exécution immédiate des sources de la base courante (administrateur) : contrôle et démonstration.
        g.MapPost("/executer", async (HttpContext http, PlanificateurNotifications p, CancellationToken ct) =>
        {
            if (!Utilisateur.Depuis(http).EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
            await p.ExecuterBaseAsync(http.RequestServices, ct);
            return Results.NoContent();
        });
        return g;
    }
}
