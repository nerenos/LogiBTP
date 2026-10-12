using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Bibliotheque.Web;

/// <summary>Branchement du module Bibliothèque dans une application ASP.NET Core.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleBibliotheque<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationBibliotheque
    {
        services.AddDbContext<BibliothequeDbContext>(options);
        services.AddSingleton<SpecialisationBibliotheque, TSpecialisation>();
        services.AddScoped<ServiceBibliotheque>();
        return services;
    }

    public static IServiceCollection AddModuleBibliotheque(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options) =>
        services.AddModuleBibliotheque<SpecialisationBibliotheque>(options);

    /// <summary>Routes HTTP du module, sous /bibliotheque.</summary>
    public static RouteGroupBuilder MapModuleBibliotheque(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/bibliotheque");
        g.MapGet("/parametres", (ServiceBibliotheque s, CancellationToken ct) => s.Parametres(ct));
        g.MapPut("/parametres", (ParametresBibliothequeDto p, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.EnregistrerParametres(p, Utilisateur.Depuis(http), ct));

        g.MapGet("/bibliotheques", (ServiceBibliotheque s, CancellationToken ct) => s.Bibliotheques(ct));
        g.MapPut("/bibliotheques", (BibliothequeDto b, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.EnregistrerBibliotheque(b, Utilisateur.Depuis(http), ct));
        g.MapDelete("/bibliotheques/{id:int}", (int id, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.SupprimerBibliotheque(id, Utilisateur.Depuis(http), ct));

        g.MapGet("/familles", (int? bib, ServiceBibliotheque s, CancellationToken ct) => s.Familles(bib, ct));
        g.MapPut("/familles", (FamilleDto f, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.EnregistrerFamille(f, Utilisateur.Depuis(http), ct));
        g.MapDelete("/familles/{id:int}", (int id, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.SupprimerFamille(id, Utilisateur.Depuis(http), ct));

        g.MapGet("/regroupements", (ServiceBibliotheque s, CancellationToken ct) => s.Regroupements(ct));
        g.MapPut("/regroupements", (RegroupementDto r, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.EnregistrerRegroupement(r, Utilisateur.Depuis(http), ct));
        g.MapDelete("/regroupements/{code}", (string code, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.SupprimerRegroupement(code, Utilisateur.Depuis(http), ct));

        g.MapGet("/natures", (ServiceBibliotheque s, CancellationToken ct) => s.Natures(ct));
        g.MapPut("/natures", (NatureDto n, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.EnregistrerNature(n, Utilisateur.Depuis(http), ct));
        g.MapDelete("/natures/{id:int}", (int id, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.SupprimerNature(id, Utilisateur.Depuis(http), ct));

        g.MapGet("/periodes", (ServiceBibliotheque s, CancellationToken ct) => s.Periodes(ct));
        g.MapPut("/periodes", (PeriodeDto p, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.EnregistrerPeriode(p, Utilisateur.Depuis(http), ct));
        g.MapDelete("/periodes/{id:int}", (int id, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.SupprimerPeriode(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/recalcul", async (HttpContext http, ServiceBibliotheque s, CancellationToken ct) =>
            Results.Ok(new { elements_recalcules = await s.RecalculerElements("Coefficients en vigueur", Utilisateur.Depuis(http), ct) }));

        g.MapGet("/elements", (string? recherche, int? bib, string? type, ServiceBibliotheque s, CancellationToken ct) => s.Rechercher(recherche, bib, type, ct));
        g.MapGet("/elements/{id:long}", (long id, ServiceBibliotheque s, CancellationToken ct) => s.Element(id, ct));
        g.MapGet("/appel", (string code, string? bib, ServiceBibliotheque s, CancellationToken ct) => s.Appel(code, bib, ct));
        g.MapGet("/elements/{id:long}/tarifs", (long id, ServiceBibliotheque s, CancellationToken ct) => s.Tarifs(id, ct));
        g.MapPost("/elements/{id:long}/tarifs", (long id, TarifDto t, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.EnregistrerTarif(id, t, Utilisateur.Depuis(http), ct));
        g.MapDelete("/elements/{id:long}/tarifs/{tarif:long}", (long id, long tarif, HttpContext http, ServiceBibliotheque s, CancellationToken ct) => s.SupprimerTarif(id, tarif, Utilisateur.Depuis(http), ct));
        g.MapGet("/tarifs", (long tiers, ServiceBibliotheque s, CancellationToken ct) => s.TarifsTiers(tiers, ct));
        g.MapGet("/elements/{id:long}/historique", (long id, ServiceBibliotheque s, CancellationToken ct) => s.Historique(id, ct));
        return api;
    }
}
