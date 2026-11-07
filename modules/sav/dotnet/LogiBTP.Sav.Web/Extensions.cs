using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Sav.Web;

/// <summary>Branchement du module SAV.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleSav<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationSav
    {
        services.AddDbContext<SavDbContext>(options);
        services.AddSingleton<SpecialisationSav, TSpecialisation>();
        services.AddScoped<ServiceEquipements>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /sav (nœuds de droits déclarés par l'application).</summary>
    public static RouteGroupBuilder MapModuleSav(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/sav");
        g.MapGet("/equipements", (string? numero, long? article, long? lieu, long? tiers, string? etat, int? limite, ServiceEquipements s, CancellationToken ct) =>
            s.ListeAsync(new FiltreEquipements(numero, article, lieu, tiers, etat, limite), ct));
        g.MapGet("/equipements/{id:long}", (long id, ServiceEquipements s, CancellationToken ct) => s.ChargerAsync(id, ct));
        g.MapPost("/equipements", (EquipementSaisi e, HttpContext http, ServiceEquipements s, CancellationToken ct) => s.CreerAsync(e, Utilisateur.Depuis(http), ct));
        g.MapPut("/equipements/{id:long}", (long id, EquipementSaisi e, HttpContext http, ServiceEquipements s, CancellationToken ct) =>
            s.ModifierAsync(id, e, Utilisateur.Depuis(http), ct));
        g.MapPost("/equipements/{id:long}/retrait", (long id, RetraitEquipement r, HttpContext http, ServiceEquipements s, CancellationToken ct) =>
            s.RetirerAsync(id, r, Utilisateur.Depuis(http), ct));
        g.MapPost("/equipements/{id:long}/remplacement", (long id, EquipementSaisi e, HttpContext http, ServiceEquipements s, CancellationToken ct) =>
            s.RemplacerAsync(id, e, Utilisateur.Depuis(http), ct));
        return g;
    }
}
