using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Planning.Web;

public sealed record VueSaisie(string Code, string Libelle, DefinitionVue Definition, bool Globale);

/// <summary>Branchement du module Planning (facultatif : activé par société).</summary>
public static class Extensions
{
    public static IServiceCollection AddModulePlanning<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationPlanning
    {
        services.AddDbContext<PlanningDbContext>(options);
        services.AddSingleton<SpecialisationPlanning, TSpecialisation>();
        services.AddScoped<ServicePlanning>();
        services.AddScoped<ServiceCharge>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /planning ; renvoie le groupe (filtre d'activation posé par l'application).</summary>
    public static RouteGroupBuilder MapModulePlanning(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/planning");
        g.MapGet("/vues", (HttpContext http, ServicePlanning s, CancellationToken ct) => s.VuesAsync(Utilisateur.Depuis(http), ct));
        g.MapPut("/vues", (VueSaisie v, HttpContext http, ServicePlanning s, CancellationToken ct) =>
            s.EnregistrerVueAsync(v.Code, v.Libelle, v.Definition, v.Globale, Utilisateur.Depuis(http), ct));
        g.MapGet("/referentiels", (ServicePlanning s, CancellationToken ct) => s.ReferentielsAsync(ct));
        g.MapGet("/donnees", (string? vue, string du, string au, string? recherche, ServicePlanning s, CancellationToken ct) => s.DonneesAsync(vue, du, au, recherche, ct));
        g.MapGet("/ressources", (string? services, string? types, string? recherche, ServicePlanning s, CancellationToken ct) => s.RessourcesAsync(services, types, recherche, ct));
        g.MapGet("/elements", (string? recherche, ServicePlanning s, CancellationToken ct) => s.ElementsAsync(recherche, ct));
        g.MapGet("/a-planifier", (string? services, string? recherche, ServicePlanning s, CancellationToken ct) => s.APlanifierAsync(services, recherche, ct));
        g.MapPost("/calcul", (TacheSaisie t, ServicePlanning s, CancellationToken ct) => s.ApercuAsync(t, ct));
        g.MapGet("/taches/{id:long}", (long id, ServicePlanning s, CancellationToken ct) => s.TacheAsync(id, ct));
        g.MapPost("/taches", (TacheSaisie t, HttpContext http, ServicePlanning s, CancellationToken ct) => s.CreerAsync(t, Utilisateur.Depuis(http), ct));
        g.MapPut("/taches/{id:long}", (long id, TacheSaisie t, HttpContext http, ServicePlanning s, CancellationToken ct) => s.ModifierAsync(id, t, Utilisateur.Depuis(http), ct));
        g.MapDelete("/taches/{id:long}", async (long id, int version, HttpContext http, ServicePlanning s, CancellationToken ct) =>
        {
            await s.SupprimerAsync(id, version, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/taches/{id:long}/deplacer", (long id, DeplacementSaisi d, HttpContext http, ServicePlanning s, CancellationToken ct) => s.DeplacerAsync(id, d, Utilisateur.Depuis(http), ct));
        g.MapPost("/taches/{id:long}/scinder", (long id, ScissionSaisie d, HttpContext http, ServicePlanning s, CancellationToken ct) => s.ScinderAsync(id, d, Utilisateur.Depuis(http), ct));
        // Charge et contrôles (lot 4).
        g.MapGet("/charge", (string? vue, string du, string au, ServiceCharge s, CancellationToken ct) => s.ChargeAsync(vue, du, au, ct));
        g.MapGet("/notifications", (string? vue, string du, string au, ServiceCharge s, CancellationToken ct) => s.NotificationsAsync(vue, du, au, ct));
        g.MapPut("/notifications", async (EtatNotification e, HttpContext http, ServiceCharge s, CancellationToken ct) =>
        {
            await s.MarquerAsync(e, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/taches/{id:long}/equipes/{equipe:int}/appliquer", (long id, int equipe, int version, HttpContext http, ServiceCharge s, CancellationToken ct) =>
            s.AppliquerEquipeAsync(id, equipe, version, Utilisateur.Depuis(http), ct));
        g.MapGet("/creneau", (string? ressource, int? service, int heures, string apres, string? habilitations, ServiceCharge s, CancellationToken ct) =>
            s.CreneauAsync(ressource, service, heures, apres, habilitations, ct));
        g.MapGet("/parametres", (ServiceCharge s, CancellationToken ct) => s.ParametresAsync(ct));
        return g;
    }
}
