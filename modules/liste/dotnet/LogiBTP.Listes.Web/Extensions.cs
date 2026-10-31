using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Listes.Web;

/// <summary>Branchement du module Liste dans une application ASP.NET Core.</summary>
public static class Extensions
{
    /// <summary>Enregistre le module : contexte EF (options fournies par l'application), spécialisation, service.</summary>
    public static IServiceCollection AddModuleListe<TSpecialisation>(this IServiceCollection services, Action<DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationListe =>
        services.AddModuleListe<TSpecialisation>((_, o) => options(o));

    /// <summary>Options du contexte par requête (ex. base de la société courante, désignée par le sous-domaine).</summary>
    public static IServiceCollection AddModuleListe<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationListe
    {
        services.AddDbContext<ListeDbContext>(options);
        services.AddSingleton<SpecialisationListe, TSpecialisation>();
        services.AddSingleton<CacheSchemas>();
        services.AddScoped<ServiceListe>();
        return services;
    }

    public static IServiceCollection AddModuleListe(this IServiceCollection services, Action<DbContextOptionsBuilder> options) =>
        services.AddModuleListe<SpecialisationListe>(options);

    /// <summary>Routes HTTP du module, sous /listes.</summary>
    public static RouteGroupBuilder MapModuleListe(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/listes");
        g.MapGet("/themes", (ServiceListe s, CancellationToken ct) => s.Themes(ct));
        g.MapPut("/themes/{code}", (string code, ThemeListeDto t, HttpContext http, ServiceListe s, CancellationToken ct) => s.EnregistrerTheme(code, t, Utilisateur.Depuis(http), ct));
        g.MapDelete("/themes/{code}", async (string code, HttpContext http, ServiceListe s, CancellationToken ct) =>
        {
            await s.SupprimerTheme(code, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapGet("/vues", (string? contexte, string? theme, HttpContext http, ServiceListe s, CancellationToken ct) => s.Vues(contexte, theme, Utilisateur.Depuis(http), ct));
        g.MapGet("/vues/{id:long}", (long id, HttpContext http, ServiceListe s, CancellationToken ct) => s.Vue(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/vues", (VueListeDto v, HttpContext http, ServiceListe s, CancellationToken ct) => { v.VliId = null; return s.Enregistrer(v, Utilisateur.Depuis(http), ct); });
        g.MapPut("/vues/{id:long}", (long id, VueListeDto v, HttpContext http, ServiceListe s, CancellationToken ct) => { v.VliId = id; return s.Enregistrer(v, Utilisateur.Depuis(http), ct); });
        g.MapDelete("/vues/{id:long}", async (long id, HttpContext http, ServiceListe s, CancellationToken ct) =>
        {
            await s.Supprimer(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapGet("/sources", (ServiceListe s, CancellationToken ct) => s.Sources(ct));
        g.MapPost("/sources/requete", (DemandeRequete d, HttpContext http, ServiceListe s, CancellationToken ct) => s.ColonnesRequete(d.Requete, Utilisateur.Depuis(http), ct));
        g.MapPost("/lot", (DemandeListe d, HttpContext http, ServiceListe s, CancellationToken ct) => s.Lot(d, Utilisateur.Depuis(http), ct));
        g.MapPost("/segments", (DemandeListe d, HttpContext http, ServiceListe s, CancellationToken ct) => s.Segments(d, Utilisateur.Depuis(http), ct));
        g.MapPost("/agregats", (DemandeListe d, HttpContext http, ServiceListe s, CancellationToken ct) => s.Agregats(d, Utilisateur.Depuis(http), ct));
        g.MapPost("/controle", (DemandeListe d, HttpContext http, ServiceListe s, CancellationToken ct) => s.Controle(d, Utilisateur.Depuis(http), ct));
        g.MapPost("/lignes", (DemandeListe d, HttpContext http, ServiceListe s, CancellationToken ct) => s.LignesCiblees(d, Utilisateur.Depuis(http), ct));
        g.MapPost("/modifier", (DemandeModification d, HttpContext http, ServiceListe s, CancellationToken ct) => s.Modifier(d, Utilisateur.Depuis(http), ct));
        return api;
    }
}
