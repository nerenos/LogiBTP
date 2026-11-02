using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace LogiBTP.Rentabilite.Web;

/// <summary>Branchement du module Rentabilité (facultatif : activé par société).</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleRentabilite<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options,
        IConfiguration? section = null)
        where TSpecialisation : SpecialisationRentabilite
    {
        services.AddDbContext<RentabiliteDbContext>(options);
        services.AddSingleton<SpecialisationRentabilite, TSpecialisation>();
        services.AddScoped<ServiceRentabilite>();
        services.TryAddSingleton(TimeProvider.System);
        if (section is not null) services.Configure<OptionsRentabilite>(section);
        services.AddSingleton<PlanificateurRentabilite>();
        services.AddHostedService(sp => sp.GetRequiredService<PlanificateurRentabilite>());
        return services;
    }

    /// <summary>Routes HTTP du module, sous /rentabilite ; renvoie le groupe (filtre d'activation posé par l'application).</summary>
    public static RouteGroupBuilder MapModuleRentabilite(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/rentabilite");
        g.MapGet("/file", (ServiceRentabilite s, CancellationToken ct) => s.FileAsync(ct));
        g.MapPost("/recalculer-tout", (HttpContext http, ServiceRentabilite s, CancellationToken ct) => s.RecalculerToutAsync(Utilisateur.Depuis(http), ct));
        g.MapGet("/chantiers", (DateOnly? du, DateOnly? au, bool? exclus, bool? clos, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.ListeAsync(http.RequestServices, Utilisateur.Depuis(http), new FiltreListe(du, au, exclus ?? false, clos ?? false), ct));
        g.MapGet("/chantiers/{id:int}", (int id, DateOnly? du, DateOnly? au, string? reference, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.DetailAsync(http.RequestServices, Utilisateur.Depuis(http), id, du, au, reference, ct));
        g.MapPost("/controles", async (ChantiersDemandes d, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            new { chantiers = await s.ControlerAsync(http.RequestServices, Utilisateur.Depuis(http), d.Chantiers, ct) });
        g.MapGet("/chantiers/{id:int}/changements", (int id, long? calcul, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.ChangementsAsync(http.RequestServices, Utilisateur.Depuis(http), id, calcul, ct));
        g.MapPost("/chantiers/{id:int}/photos", (int id, PhotoDemandee d, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.PhotographierAsync(http.RequestServices, Utilisateur.Depuis(http), id, d.Date, d.Libelle, ct));
        g.MapDelete("/photos/{id:long}", async (long id, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
        {
            await s.SupprimerPhotoAsync(Utilisateur.Depuis(http), id, ct);
            return Results.NoContent();
        });
        g.MapGet("/vues", (HttpContext http, ServiceRentabilite s, CancellationToken ct) => s.VuesAsync(Utilisateur.Depuis(http), ct));
        g.MapPost("/vues", (VueSaisie v, HttpContext http, ServiceRentabilite s, CancellationToken ct) => s.EnregistrerVueAsync(Utilisateur.Depuis(http), v, ct));
        g.MapDelete("/vues/{id:int}", async (int id, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
        {
            await s.SupprimerVueAsync(Utilisateur.Depuis(http), id, ct);
            return Results.NoContent();
        });
        g.MapPost("/chantiers/{id:int}/recalculer", (int id, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.RecalculerManuelAsync(http.RequestServices, Utilisateur.Depuis(http), id, ct));
        g.MapGet("/chantiers/{id:int}/faits", (int id, string? indicateur, string? nature, long? ordre, string? composante, long? piece, DateOnly? du, DateOnly? au,
            HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.FaitsAsync(http.RequestServices, Utilisateur.Depuis(http), id, FiltreFaits.Lire(indicateur, nature, ordre, composante, piece, du, au), ct));
        g.MapGet("/chantiers/{id:int}/rapprochement", (int id, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.RapprochementAsync(http.RequestServices, Utilisateur.Depuis(http), id, ct));
        // Saisies prévisionnelles (lot 6, § 10.1).
        g.MapGet("/previsions", (int chantier, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.PrevisionsAsync(http.RequestServices, Utilisateur.Depuis(http), chantier, ct));
        g.MapPost("/previsions", (int chantier, SaisiePrevision d, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.CreerPrevisionAsync(http.RequestServices, Utilisateur.Depuis(http), chantier, d, ct));
        g.MapPut("/previsions/{id:long}", (long id, SaisiePrevision d, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.ModifierPrevisionAsync(http.RequestServices, Utilisateur.Depuis(http), id, d, ct));
        g.MapPost("/previsions/{id:long}/solde", (long id, SoldeDemande d, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.SolderPrevisionAsync(http.RequestServices, Utilisateur.Depuis(http), id, d, ct));
        g.MapPost("/previsions/{id:long}/rouvrir", (long id, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.RouvrirPrevisionAsync(http.RequestServices, Utilisateur.Depuis(http), id, ct));
        g.MapDelete("/previsions/{id:long}", async (long id, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
        {
            await s.SupprimerPrevisionAsync(http.RequestServices, Utilisateur.Depuis(http), id, ct);
            return Results.NoContent();
        });
        g.MapGet("/previsions/{id:long}/journal", (long id, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.JournalPrevisionAsync(http.RequestServices, Utilisateur.Depuis(http), id, ct));
        // Prévisionnel de facturation (lot 7, § 10.2).
        g.MapGet("/facturation", (int chantier, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.FacturationAsync(http.RequestServices, Utilisateur.Depuis(http), chantier, ct));
        g.MapPost("/facturation", (int chantier, SaisieFacturation d, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.EnregistrerFacturationAsync(http.RequestServices, Utilisateur.Depuis(http), chantier, d, ct));
        g.MapGet("/facturation/liste", (DateOnly? du, DateOnly? au, bool? exclus, bool? clos, HttpContext http, ServiceRentabilite s, CancellationToken ct) =>
            s.FacturationListeAsync(http.RequestServices, Utilisateur.Depuis(http), du, au, exclus ?? false, clos ?? false, ct));
        return g;
    }
}

/// <summary>Chantiers visés par une action (contrôle d'une sélection).</summary>
public sealed record ChantiersDemandes(int[] Chantiers);

/// <summary>Photo à la demande : date (aujourd'hui par défaut) et libellé.</summary>
public sealed record PhotoDemandee(DateOnly? Date, string? Libelle);
