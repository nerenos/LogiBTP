using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Annuaire.Web;

/// <summary>Branchement du module Annuaire dans une application ASP.NET Core.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleAnnuaire<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationAnnuaire
    {
        services.AddDbContext<AnnuaireDbContext>(options);
        services.AddSingleton<SpecialisationAnnuaire, TSpecialisation>();
        services.AddScoped<ServiceAnnuaire>();
        return services;
    }

    public static IServiceCollection AddModuleAnnuaire(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options) =>
        services.AddModuleAnnuaire<SpecialisationAnnuaire>(options);

    /// <summary>Routes HTTP du module, sous /annuaire (les fiches passent par le module Fiche).</summary>
    public static RouteGroupBuilder MapModuleAnnuaire(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/annuaire");
        g.MapGet("/referentiels", (ServiceAnnuaire s, CancellationToken ct) => s.Referentiels(ct));
        foreach (var genre in new[] { "niveaux", "casquettes", "types-lien", "roles" })
        {
            g.MapPut($"/{genre}", (ReferentielDto r, HttpContext http, ServiceAnnuaire s, CancellationToken ct) => s.EnregistrerReferentiel(genre, r, Utilisateur.Depuis(http), ct));
            g.MapDelete($"/{genre}/{{code}}", (string code, HttpContext http, ServiceAnnuaire s, CancellationToken ct) => s.SupprimerReferentiel(genre, code, Utilisateur.Depuis(http), ct));
        }
        g.MapGet("/personnes", (string? recherche, string? casquette, int? limite, ServiceAnnuaire s, CancellationToken ct) => s.RechercherPersonnes(recherche, casquette, limite ?? 30, ct));
        g.MapGet("/personnes/{id:long}", (long id, ServiceAnnuaire s, CancellationToken ct) => s.Personne(id, ct));
        g.MapGet("/individus", (string? recherche, int? limite, ServiceAnnuaire s, CancellationToken ct) => s.RechercherIndividus(recherche, limite ?? 30, ct));
        g.MapGet("/individus/{id:long}", (long id, ServiceAnnuaire s, CancellationToken ct) => s.Individu(id, ct));
        g.MapPost("/individus/{id:long}/particulier", (long id, HttpContext http, ServiceAnnuaire s, CancellationToken ct) => s.CreerParticulier(id, Utilisateur.Depuis(http), ct));
        g.MapGet("/societe", async (ServiceAnnuaire s, CancellationToken ct) => await s.SocieteBase(ct) is { } p ? Results.Ok(p) : Results.Ok());
        g.MapGet("/siret/{siret}", async (string siret, ServiceAnnuaire s, CancellationToken ct) => await s.ParSiret(siret, ct) is { } p ? Results.Ok(p) : Results.Ok());
        g.MapGet("/coordonnees/proposees", (string type, long? id, ServiceAnnuaire s, CancellationToken ct) => s.CoordonneesProposees(type, id, ct));
        g.MapGet("/coordonnees/{id:long}/historique", (long id, ServiceAnnuaire s, CancellationToken ct) => s.HistoriqueCoordonnee(id, ct));
        return api;
    }
}
