using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace LogiBTP.Rentabilite.Web;

/// <summary>Branchement du module Rentabilité (facultatif : activé par société).</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleRentabilite<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options,
        IConfiguration? section = null)
        where TSpecialisation : SpecialisationRentabilite
    {
        services.AddDbContext<RentabiliteDbContext>(options);
        services.AddSingleton<SpecialisationRentabilite, TSpecialisation>();
        services.AddScoped<ServiceRentabilite>();
        services.TryAddSingleton(TimeProvider.System);
        if (section is not null) services.Configure<OptionsRentabilite>(section);
        services.AddSingleton<PlanificateurRentabilite>();
        services.AddHostedService(sp => sp.GetRequiredService<PlanificateurRentabilite>());
        return services;
    }

    /// <summary>Routes HTTP du module, sous /rentabilite ; renvoie le groupe (filtre d'activation posé par l'application).</summary>
    public static RouteGroupBuilder MapModuleRentabilite(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/rentabilite");
        g.MapGet("/file", (ServiceRentabilite s, CancellationToken ct) => s.FileAsync(ct));
        g.MapPost("/recalculer-tout", (HttpContext http, ServiceRentabilite s, CancellationToken ct) => s.RecalculerToutAsync(Utilisateur.Depuis(http), ct));
        g.MapGet("/chantiers/{id:int}", (int id, DateOnly? au, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.DetailAsync(http.RequestServices, Utilisateur.Depuis(http), id, au, ct));
        g.MapPost("/chantiers/{id:int}/recalculer", (int id, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.RecalculerManuelAsync(http.RequestServices, Utilisateur.Depuis(http), id, ct));
        g.MapGet("/chantiers/{id:int}/faits", (int id, string? indicateur, string? nature, long? ordre, string? composante, long? piece, DateOnly? du, DateOnly? au,
            HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.FaitsAsync(http.RequestServices, Utilisateur.Depuis(http), id, FiltreFaits.Lire(indicateur, nature, ordre, composante, piece, du, au), ct));
        g.MapGet("/chantiers/{id:int}/rapprochement", (int id, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.RapprochementAsync(http.RequestServices, Utilisateur.Depuis(http), id, ct));
        return g;
    }
}
