using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Pointage.Web;

/// <summary>Branchement du module Pointage (facultatif : activé par société).</summary>
public static class Extensions
{
    public static IServiceCollection AddModulePointage<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationPointage
    {
        services.AddDbContext<PointageDbContext>(options);
        services.AddSingleton<SpecialisationPointage, TSpecialisation>();
        services.AddScoped<ServicePointage>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /pointage ; renvoie le groupe (filtre d'activation posé par l'application).</summary>
    public static RouteGroupBuilder MapModulePointage(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/pointage");
        g.MapGet("/parametres", (ServicePointage s, CancellationToken ct) => s.ParametresAsync(ct));
        g.MapPut("/parametres", (ParametresDto p, HttpContext http, ServicePointage s, CancellationToken ct) => s.EnregistrerParametresAsync(p, Utilisateur.Depuis(http), ct));
        g.MapGet("/sous-types", (ServicePointage s, CancellationToken ct) => s.SousTypesAsync(ct));
        g.MapPut("/sous-types", (List<SousTypeDto> l, HttpContext http, ServicePointage s, CancellationToken ct) => s.EnregistrerSousTypesAsync(l, Utilisateur.Depuis(http), ct));
        g.MapGet("/referentiels", (ServicePointage s, CancellationToken ct) => s.ReferentielsAsync(ct));
        g.MapGet("/chantiers", (string? recherche, ServicePointage s, CancellationToken ct) => s.ChantiersAsync(recherche, ct));
        g.MapGet("/salaries", (int? service, string? recherche, DateOnly? lundi, ServicePointage s, CancellationToken ct) =>
            s.SalariesAsync(service, recherche, ReglesPointage.LundiDe(lundi ?? DateOnly.FromDateTime(DateTime.Today)), ct));
        g.MapGet("/pointages/{id:long}/position", (long id, ServicePointage s, CancellationToken ct) => s.PositionAsync(id, ct));
        g.MapGet("/semaine/{salarie:int}/{lundi}", (int salarie, DateOnly lundi, HttpContext http, ServicePointage s, CancellationToken ct) =>
            s.SemaineAsync(salarie, lundi, Utilisateur.Depuis(http), ct));
        g.MapPut("/semaine/{salarie:int}/{lundi}", (int salarie, DateOnly lundi, SemaineSaisie saisie, HttpContext http, ServicePointage s, CancellationToken ct) =>
            s.EnregistrerSemaineAsync(salarie, lundi, saisie, Utilisateur.Depuis(http), ct));
        return g;
    }
}
