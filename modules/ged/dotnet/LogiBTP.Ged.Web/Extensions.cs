using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Ged.Web;

/// <summary>Branchement du module GED dans une application ASP.NET Core.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleGed<TSpecialisation>(this IServiceCollection services, Action<DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationGed
    {
        services.AddDbContext<GedDbContext>(options);
        services.AddSingleton<SpecialisationGed, TSpecialisation>();
        services.AddSingleton(sp => new StockageGed(sp.GetRequiredService<SpecialisationGed>().RepertoireStockage));
        services.AddScoped<ServiceGed>();
        return services;
    }

    public static IServiceCollection AddModuleGed(this IServiceCollection services, Action<DbContextOptionsBuilder> options) =>
        services.AddModuleGed<SpecialisationGed>(options);

    /// <summary>Routes HTTP du module, sous /ged (mêmes chemins que FournisseurGedApi).</summary>
    public static RouteGroupBuilder MapModuleGed(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/ged");
        g.MapGet("/parametres", (ServiceGed s, CancellationToken ct) => s.Parametres(ct));
        g.MapGet("/documents", (string? type_element, string? id_element, string? recherche, bool? supprimes, bool? coffre, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.Lister(new FiltreGed { TypeElement = type_element, IdElement = id_element, Recherche = recherche, Supprimes = supprimes == true, Coffre = coffre == true },
                Utilisateur.Depuis(http), ct));
        // Dépôts en multipart (champ « fichier » + champ « donnees » JSON), lus par le service : pas de liaison IFormFile.
        g.MapPost("/documents", (HttpContext http, ServiceGed s, CancellationToken ct) => s.Deposer(http.Request, Utilisateur.Depuis(http), ct)).DisableAntiforgery();
        g.MapGet("/documents/{id:long}", (long id, HttpContext http, ServiceGed s, CancellationToken ct) => s.Document(id, Utilisateur.Depuis(http), ct));
        g.MapPut("/documents/{id:long}", (long id, Dictionary<string, JsonElement> meta, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.Modifier(id, meta, Utilisateur.Depuis(http), ct));
        g.MapPost("/documents/{id:long}/versions", (long id, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.NouvelleVersion(id, http.Request, Utilisateur.Depuis(http), ct)).DisableAntiforgery();
        g.MapPost("/documents/{id:long}/etapes", (long id, DemandeEtape e, HttpContext http, ServiceGed s, CancellationToken ct) => s.Etape(id, e, Utilisateur.Depuis(http), ct));
        g.MapPost("/documents/{id:long}/coffre", (long id, DemandeCoffre d, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.MettreAuCoffre(id, d, Utilisateur.Depuis(http), ct));
        g.MapGet("/documents/{id:long}/verification", (long id, HttpContext http, ServiceGed s, CancellationToken ct) => s.Verifier(id, Utilisateur.Depuis(http), ct));
        g.MapDelete("/documents/{id:long}", (long id, HttpContext http, ServiceGed s, CancellationToken ct) => s.Supprimer(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/documents/{id:long}/restaurer", (long id, HttpContext http, ServiceGed s, CancellationToken ct) => s.Restaurer(id, Utilisateur.Depuis(http), ct));
        g.MapDelete("/documents/{id:long}/definitif", async (long id, HttpContext http, ServiceGed s, CancellationToken ct) =>
        {
            await s.Purger(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapGet("/versions/{versionId:long}/contenu", (long versionId, bool? telecharger, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.Contenu(versionId, telecharger == true, http, Utilisateur.Depuis(http), ct));
        g.MapGet("/coffre/verification", (ServiceGed s, CancellationToken ct) => s.VerifierCoffre(ct));
        return api;
    }
}
