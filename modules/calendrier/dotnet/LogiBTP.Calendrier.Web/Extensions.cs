using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Calendrier.Web;

/// <summary>Branchement du module Calendrier.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleCalendrier<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationCalendrier
    {
        services.AddDbContext<CalendrierDbContext>(options);
        services.AddSingleton<SpecialisationCalendrier, TSpecialisation>();
        services.AddScoped<ServiceCalendrier>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /calendriers.</summary>
    public static RouteGroupBuilder MapModuleCalendrier(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/calendriers");
        g.MapGet("", (ServiceCalendrier s, CancellationToken ct) => s.ListeAsync(ct));
        g.MapPost("", (CalendrierDto c, HttpContext http, ServiceCalendrier s, CancellationToken ct) => s.EnregistrerAsync(null, c, Utilisateur.Depuis(http), ct));
        g.MapPut("/{id:int}", (int id, CalendrierDto c, HttpContext http, ServiceCalendrier s, CancellationToken ct) => s.EnregistrerAsync(id, c, Utilisateur.Depuis(http), ct));
        g.MapDelete("/{id:int}", async (int id, HttpContext http, ServiceCalendrier s, CancellationToken ct) =>
        {
            await s.SupprimerAsync(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        // Journées d'un calendrier (défaut : id 0) avec les jours fermés de la société, du calendrier et des portées (« service:7 »).
        g.MapGet("/{id:int}/journees", (int id, DateOnly du, DateOnly au, string? portee, ServiceCalendrier s, CancellationToken ct) =>
            s.JourneesAsync(id == 0 ? null : id, du, au, (portee ?? "").Split(',').Select(Portee.Lire).OfType<Portee>(), ct));
        g.MapGet("/jours-fermes", (string? portee, ServiceCalendrier s, CancellationToken ct) => s.JoursFermesAsync(Portee.Lire(portee), ct));
        g.MapPut("/jours-fermes", (JoursFermesSaisis j, HttpContext http, ServiceCalendrier s, CancellationToken ct) => s.EnregistrerJoursFermesAsync(j, Utilisateur.Depuis(http), ct));
        return g;
    }
}
