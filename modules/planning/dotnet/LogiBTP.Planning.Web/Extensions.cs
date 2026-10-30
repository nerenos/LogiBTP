using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Planning.Web;

public sealed record ServiceRessourceSaisi(int SrvId);
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
        g.MapGet("/donnees", (string? vue, string du, string au, string? recherche, string? services, ServicePlanning s, CancellationToken ct) => s.DonneesAsync(vue, du, au, recherche, ct, services));
        g.MapGet("/ressources", (string? services, string? types, string? recherche, ServicePlanning s, CancellationToken ct) => s.RessourcesAsync(services, types, recherche, ct));
        g.MapGet("/elements", (string? recherche, string? type, ServicePlanning s, CancellationToken ct) => s.ElementsAsync(recherche, ct, type ?? "chantier"));
        g.MapGet("/sources", async (string? type, string? recherche, PlanningDbContext db, SpecialisationPlanning sp, CancellationToken ct) => new
        {
            types = sp.TypesSources.Select(t => new { code = t.Code, libelle = t.Libelle }),
            sources = type is null ? [] : await sp.SourcesAsync(db, type, recherche, ct),
        });
        g.MapGet("/a-planifier", (string? services, string? recherche, ServicePlanning s, CancellationToken ct) => s.APlanifierAsync(services, recherche, ct));
        g.MapPut("/a-planifier/prevision", async (PrevisionSaisie p, HttpContext http, ServicePlanning s, CancellationToken ct) =>
        {
            await s.EnregistrerPrevisionAsync(p, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/calcul", (TacheSaisie t, ServicePlanning s, CancellationToken ct) => s.ApercuAsync(t, ct));
        g.MapGet("/taches/{id:long}", (long id, ServicePlanning s, CancellationToken ct) => s.TacheAsync(id, ct));
        g.MapGet("/taches/{id:long}/avancements", (long id, ServicePlanning s, CancellationToken ct) => s.AvancementsAsync(id, ct));
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
        g.MapGet("/charge", (string? vue, string du, string au, string? services, ServiceCharge s, CancellationToken ct) => s.ChargeAsync(vue, du, au, ct, services));
        g.MapGet("/notifications", (string? vue, string du, string au, string? services, ServiceCharge s, CancellationToken ct) => s.NotificationsAsync(vue, du, au, ct, services));
        g.MapPut("/notifications", async (EtatNotification e, HttpContext http, ServiceCharge s, CancellationToken ct) =>
        {
            await s.MarquerAsync(e, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/taches/{id:long}/equipes/{equipe:int}/appliquer", (long id, int equipe, int version, string? date, HttpContext http, ServiceCharge s, CancellationToken ct) =>
            s.AppliquerEquipeAsync(id, equipe, version, date, Utilisateur.Depuis(http), ct));
        g.MapPut("/ressources/{type}/{id}/service", async (string type, string id, ServiceRessourceSaisi s, HttpContext http, PlanningDbContext db, SpecialisationPlanning sp, CancellationToken ct) =>
        {
            await sp.ChangerServiceAsync(db, type, id, s.SrvId, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        // Ressources des tâches : membres d'une équipe à une date, disponibilités sur une période (information).
        g.MapGet("/equipes/{equipe:int}/membres", (int equipe, string date, PlanningDbContext db, SpecialisationPlanning sp, CancellationToken ct) =>
            RessourcesTache.MembresAsync(db, sp, equipe, DateOnly.ParseExact(date[..10], "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), ct));
        // inclure : clés « TYPE:id » toujours rendues (ressources déjà choisies), même au-delà de la limite de la liste.
        g.MapGet("/disponibilites", async (string du, string au, long? exclure, string? services, string? types, string? recherche, string? inclure, PlanningDbContext db, SpecialisationPlanning sp, CancellationToken ct) =>
        {
            var srv = services?.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(x => int.Parse(x, System.Globalization.CultureInfo.InvariantCulture)).ToList();
            return await RessourcesTache.DisponibilitesAsync(db, sp, LogiBTP.Planning.Temps.VersMinutes(du), LogiBTP.Planning.Temps.VersMinutes(au), exclure,
                new FiltreRessources(srv is { Count: > 0 } ? srv : null, types?.Split(',', StringSplitOptions.RemoveEmptyEntries), recherche), ct,
                inclure?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        });
        g.MapGet("/creneau", (string? ressource, int? service, int heures, string apres, string? habilitations, ServiceCharge s, CancellationToken ct) =>
            s.CreneauAsync(ressource, service, heures, apres, habilitations, ct));
        g.MapGet("/parametres", (ServiceCharge s, CancellationToken ct) => s.ParametresAsync(ct));
        g.MapPut("/parametres", (ParametresPlanning p, HttpContext http, ServiceCharge s, CancellationToken ct) => s.EnregistrerParametresAsync(p, Utilisateur.Depuis(http), ct));
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
