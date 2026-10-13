using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Fiches.Web;

/// <summary>Branchement du module Fiche dans une application ASP.NET Core.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleFiche<TSpecialisation>(this IServiceCollection services, Action<DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationFiche =>
        services.AddModuleFiche<TSpecialisation>((_, o) => options(o));

    /// <summary>Options du contexte par requête (ex. base de la société courante, désignée par le sous-domaine).</summary>
    public static IServiceCollection AddModuleFiche<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationFiche
    {
        services.AddDbContext<FicheDbContext>(options);
        services.AddSingleton<SpecialisationFiche, TSpecialisation>();
        services.AddSingleton<CacheTypesColonnes>();
        services.AddScoped<ServiceFiche>();
        return services;
    }

    public static IServiceCollection AddModuleFiche(this IServiceCollection services, Action<DbContextOptionsBuilder> options) =>
        services.AddModuleFiche<SpecialisationFiche>(options);

    /// <summary>Routes HTTP du module, sous /fiches/{type}.</summary>
    public static RouteGroupBuilder MapModuleFiche(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/fiches/{type}");
        g.MapGet("/definition", (string type, HttpContext http, ServiceFiche s, CancellationToken ct) => s.Definition(type, Utilisateur.Depuis(http), ct));
        g.MapGet("/parametrage", (string type, HttpContext http, ServiceFiche s, CancellationToken ct) => s.Parametrage(type, Utilisateur.Depuis(http), ct));
        g.MapPut("/parametrage", (string type, ParametrageFicheDto p, HttpContext http, ServiceFiche s, CancellationToken ct) => s.EnregistrerParametrage(type, p, Utilisateur.Depuis(http), ct));
        g.MapPost("", (string type, DemandeEnregistrement d, HttpContext http, ServiceFiche s, CancellationToken ct) => s.Creer(type, d, Utilisateur.Depuis(http), ct));
        g.MapGet("/{id}", (string type, string id, bool? confidentiel, HttpContext http, ServiceFiche s, CancellationToken ct) => s.Charger(type, id, confidentiel == true, Utilisateur.Depuis(http), ct));
        g.MapPut("/{id}", (string type, string id, DemandeEnregistrement d, HttpContext http, ServiceFiche s, CancellationToken ct) => s.Enregistrer(type, id, d, Utilisateur.Depuis(http), ct));
        g.MapDelete("/{id}", async (string type, string id, HttpContext http, ServiceFiche s, CancellationToken ct) =>
        {
            await s.Supprimer(type, id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/{id}/confidentiel", (string type, string id, HttpContext http, ServiceFiche s, CancellationToken ct) => s.Reveler(type, id, Utilisateur.Depuis(http), ct));
        g.MapPost("/{id}/verrou", (string type, string id, DemandeVerrou d, HttpContext http, ServiceFiche s, CancellationToken ct) => s.Verrouiller(type, id, d, Utilisateur.Depuis(http), ct));
        g.MapDelete("/{id}/verrou", async (string type, string id, Guid jeton, ServiceFiche s, CancellationToken ct) =>
        {
            await s.Deverrouiller(type, id, jeton, ct);
            return Results.NoContent();
        });
        return api;
    }
}
