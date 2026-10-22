using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Execution.Web;

/// <summary>Branchement du module Exécution (facultatif : activé par société).</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleExecution<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationExecution
    {
        services.AddDbContext<ExecutionDbContext>(options);
        services.AddSingleton<SpecialisationExecution, TSpecialisation>();
        services.AddScoped<ServiceExecution>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /execution ; renvoie le groupe (filtre d'activation posé par l'application).</summary>
    public static RouteGroupBuilder MapModuleExecution(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/execution");
        g.MapGet("/parcours-modeles", (ServiceExecution s, CancellationToken ct) => s.ModelesAsync(ct));
        g.MapPut("/parcours-modeles", (List<ModeleDto> l, HttpContext http, ServiceExecution s, CancellationToken ct) => s.EnregistrerModelesAsync(l, Utilisateur.Depuis(http), ct));
        g.MapGet("/synthese", (string? recherche, int? service, string? etat, ServiceExecution s, CancellationToken ct) =>
            s.SyntheseAsync(new FiltreSynthese(recherche, service, etat), ct));
        g.MapGet("/elements/{type}/{id}", (string type, string id, ServiceExecution s, CancellationToken ct) => s.DetailAsync(type, id, ct));
        g.MapPut("/elements/{type}/{id}/parcours", (string type, string id, ParcoursSaisi p, HttpContext http, ServiceExecution s, CancellationToken ct) =>
            s.EnregistrerParcoursAsync(type, id, p, Utilisateur.Depuis(http), ct));
        g.MapPut("/elements/{type}/{id}/services/{srv:int}/etat", (string type, string id, int srv, EtatManuelSaisi e, HttpContext http, ServiceExecution s, CancellationToken ct) =>
            s.EnregistrerEtatManuelAsync(type, id, srv, e, Utilisateur.Depuis(http), ct));
        return g;
    }
}
