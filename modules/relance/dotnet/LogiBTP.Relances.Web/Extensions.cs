using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Relances.Web;

/// <summary>Branchement du module Relances dans une application ASP.NET Core (facultatif : l'application fonctionne sans).</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleRelance<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationRelance
    {
        services.AddDbContext<RelanceDbContext>(options);
        services.AddSingleton<SpecialisationRelance, TSpecialisation>();
        services.AddScoped<ServiceRelance>();
        return services;
    }

    /// <summary>
    /// Routes HTTP du module, sous /relances (droits rattachés par l'application : nœud « relances », lot 4 du cœur).
    /// </summary>
    public static RouteGroupBuilder MapModuleRelance(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/relances");
        g.MapGet("", (DateOnly? date, HttpContext http, ServiceRelance s, CancellationToken ct) => s.Dues(date, Utilisateur.Depuis(http), ct));
        g.MapGet("/regles", (ServiceRelance s, CancellationToken ct) => s.Regles(ct));
        g.MapPut("/regles/{nature}", (string nature, RegleRelance r, HttpContext http, ServiceRelance s, CancellationToken ct) =>
            s.EnregistrerRegle(nature, r, Utilisateur.Depuis(http), ct));
        g.MapGet("/lots", (string? etat, ServiceRelance s, CancellationToken ct) => s.Lots(etat, ct));
        g.MapPost("/lots", async (DemandePreparation? d, HttpContext http, ServiceRelance s, CancellationToken ct) =>
            await s.Preparer(d ?? new DemandePreparation(), Utilisateur.Depuis(http), ct) is LotDto lot ? Results.Ok(lot) : Results.NoContent());
        g.MapGet("/lots/{id:long}", (long id, ServiceRelance s, CancellationToken ct) => s.Lot(id, ct));
        g.MapPost("/lots/{id:long}/valider", (long id, ValidationLot v, HttpContext http, ServiceRelance s, CancellationToken ct) =>
            s.Valider(id, v, Utilisateur.Depuis(http), ct));
        g.MapPost("/lots/{id:long}/annuler", (long id, DemandeAnnulation? d, HttpContext http, ServiceRelance s, CancellationToken ct) =>
            s.Annuler(id, d ?? new DemandeAnnulation(), Utilisateur.Depuis(http), ct));
        g.MapPut("/{id:long}/recommande", (long id, NumeroRecommande n, HttpContext http, ServiceRelance s, CancellationToken ct) =>
            s.SaisirNumero(id, n, Utilisateur.Depuis(http), ct));
        g.MapPost("/notees", (RelanceNotee n, HttpContext http, ServiceRelance s, CancellationToken ct) => s.Noter(n, Utilisateur.Depuis(http), ct));
        g.MapGet("/journal", (long? piece, long? groupe, long? tiers, ServiceRelance s, CancellationToken ct) => s.Journal(piece, groupe, tiers, ct));
        g.MapGet("/suspensions", (long? piece, long? tiers, bool? actives, ServiceRelance s, CancellationToken ct) =>
            s.Suspensions(piece, tiers, actives ?? true, ct));
        g.MapPost("/suspensions", (SuspensionSaisie x, HttpContext http, ServiceRelance s, CancellationToken ct) =>
            s.EnregistrerSuspension(null, x, Utilisateur.Depuis(http), ct));
        g.MapPut("/suspensions/{id:long}", (long id, SuspensionSaisie x, HttpContext http, ServiceRelance s, CancellationToken ct) =>
            s.EnregistrerSuspension(id, x, Utilisateur.Depuis(http), ct));
        g.MapDelete("/suspensions/{id:long}", async (long id, ServiceRelance s, CancellationToken ct) => { await s.SupprimerSuspension(id, ct); return Results.NoContent(); });
        return api;
    }
}
