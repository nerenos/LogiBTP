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
        services.AddScoped<ServiceLiens>();
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
        g.MapPut("/taches/{id:long}", async (long id, TacheSaisie t, HttpContext http, ServicePlanning s, ServiceLiens l, CancellationToken ct) =>
        {
            await s.ModifierAsync(id, t, Utilisateur.Depuis(http), ct);
            await l.PropagerAsync(id, Utilisateur.Depuis(http), ct);
            return await s.TacheAsync(id, ct);
        });
        g.MapDelete("/taches/{id:long}", async (long id, int version, HttpContext http, ServicePlanning s, CancellationToken ct) =>
        {
            await s.SupprimerAsync(id, version, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/taches/{id:long}/deplacer", async (long id, DeplacementSaisi d, HttpContext http, ServicePlanning s, ServiceLiens l, CancellationToken ct) =>
        {
            var r = await s.DeplacerAsync(id, d, Utilisateur.Depuis(http), ct);
            if (d.Copie) return r;
            await l.PropagerAsync(id, Utilisateur.Depuis(http), ct);
            return await s.TacheAsync(id, ct);
        });
        g.MapPost("/taches/{id:long}/scinder", async (long id, ScissionSaisie d, HttpContext http, ServicePlanning s, ServiceLiens l, CancellationToken ct) =>
        {
            var r = await s.ScinderAsync(id, d, Utilisateur.Depuis(http), ct);
            await l.PropagerAsync(id, Utilisateur.Depuis(http), ct);
            return r;
        });
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
        // Liens (lot 5) : dépendances, répétitions, jalons.
        g.MapGet("/taches/{id:long}/dependances", (long id, ServiceLiens s, CancellationToken ct) => s.DependancesAsync(id, ct));
        g.MapPut("/taches/{id:long}/dependances", (long id, List<DependanceSaisie> l, HttpContext http, ServiceLiens s, CancellationToken ct) =>
            s.EnregistrerDependancesAsync(id, l, Utilisateur.Depuis(http), ct));
        g.MapPost("/taches/{id:long}/repeter", (long id, RepetitionSaisie r, HttpContext http, ServiceLiens s, CancellationToken ct) => s.RepeterAsync(id, r, Utilisateur.Depuis(http), ct));
        g.MapDelete("/series/{serie:guid}", (Guid serie, string? depuis, ServiceLiens s, CancellationToken ct) => s.SupprimerSerieAsync(serie, depuis, ct));
        g.MapGet("/jalons", (string du, string au, ServiceLiens s, CancellationToken ct) => s.JalonsAsync(du, au, ct));
        g.MapPost("/jalons", (JalonSaisi j, HttpContext http, ServiceLiens s, CancellationToken ct) => s.CreerJalonAsync(j, Utilisateur.Depuis(http), ct));
        g.MapDelete("/jalons/{id:long}", async (long id, ServiceLiens s, CancellationToken ct) =>
        {
            await s.SupprimerJalonAsync(id, ct);
            return Results.NoContent();
        });
        return g;
    }
}
