using System.Text.Json.Nodes;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Editions.Web;

/// <summary>Demande de PDF : édition, et impression (dernier modèle retenu) ou simple téléchargement.</summary>
public sealed record DemandePdf(DemandeEdition Edition, bool Imprimer = false);

/// <summary>Copie d'un modèle : nouveau code et libellé.</summary>
public sealed record DemandeCopie(string Code, string? Libelle);

/// <summary>Préchauffage du moteur d'édition au démarrage (script et polices chargés dans Jint, ≈ 3 s), en tâche de fond.</summary>
public sealed class PrechauffageEdition(PoolMoteursEdition pool) : Microsoft.Extensions.Hosting.BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await pool.PrechaufferAsync(stoppingToken); } catch (OperationCanceledException) { /* arrêt de l'application */ }
    }
}

/// <summary>Branchement du module Édition dans une application ASP.NET Core.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleEdition<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options, int moteurs = 2)
        where TSpecialisation : SpecialisationEdition
    {
        services.AddDbContext<EditionDbContext>(options);
        services.AddSingleton<SpecialisationEdition, TSpecialisation>();
        services.AddSingleton(new PoolMoteursEdition(moteurs));
        services.AddScoped<ServiceEdition>();
        services.AddHostedService<PrechauffageEdition>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /editions.</summary>
    public static RouteGroupBuilder MapModuleEdition(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/editions");
        g.MapGet("/sources", (SpecialisationEdition s) => s.Sources);
        g.MapGet("/sources/{source}/dictionnaire", (string source, SpecialisationEdition s) => s.Dictionnaire(source));

        g.MapGet("/modeles", (string? cible, string? source, string? type, string? genre, HttpContext http, ServiceEdition s, CancellationToken ct) =>
            s.Modeles(cible, source, type, genre, Utilisateur.Depuis(http), ct));
        g.MapGet("/modeles/{code}", (string code, HttpContext http, ServiceEdition s, CancellationToken ct) => s.Modele(code, Utilisateur.Depuis(http), ct));
        g.MapPut("/modeles/{code}", (string code, SaisieModele m, HttpContext http, ServiceEdition s, CancellationToken ct) => s.Enregistrer(code, m, Utilisateur.Depuis(http), ct));
        g.MapDelete("/modeles/{code}", async (string code, HttpContext http, ServiceEdition s, CancellationToken ct) =>
        {
            await s.Supprimer(code, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/modeles/{code}/copie", (string code, DemandeCopie c, HttpContext http, ServiceEdition s, CancellationToken ct) =>
            s.Copier(code, c.Code, c.Libelle, Utilisateur.Depuis(http), ct));
        g.MapGet("/modeles/{code}/impacts", (string code, ServiceEdition s, CancellationToken ct) => s.Impacts(code, ct));
        g.MapGet("/modeles/{code}/versions", (string code, ServiceEdition s, CancellationToken ct) => s.Versions(code, ct));
        g.MapPost("/verifier", (JsonNode contenu, ServiceEdition s, CancellationToken ct) => s.Verifier(contenu, ct));

        g.MapGet("/chartes", (ServiceEdition s, CancellationToken ct) => s.Chartes(ct));
        g.MapPut("/chartes/{code}", (string code, SaisieCharte c, HttpContext http, ServiceEdition s, CancellationToken ct) => s.EnregistrerCharte(code, c, Utilisateur.Depuis(http), ct));
        g.MapGet("/defauts", (ServiceEdition s, CancellationToken ct) => s.Defauts(ct));
        g.MapPut("/defauts", (DefautModele d, HttpContext http, ServiceEdition s, CancellationToken ct) => s.EnregistrerDefaut(d, Utilisateur.Depuis(http), ct));

        // Aperçu : tout ce qu'il faut au moteur du navigateur, en un appel. PDF : produit par le serveur (Jint).
        g.MapPost("/apercu", (DemandeEdition d, HttpContext http, ServiceEdition s, CancellationToken ct) =>
            s.Preparer(http.RequestServices, d, Utilisateur.Depuis(http), ct));
        g.MapPost("/pdf", async (DemandePdf d, HttpContext http, ServiceEdition s, CancellationToken ct) =>
        {
            var (pdf, nom, _) = await s.Pdf(http.RequestServices, d.Edition, d.Imprimer, Utilisateur.Depuis(http), ct);
            http.Response.Headers["X-Edition-Pages"] = pdf.Pages.ToString();
            http.Response.Headers["X-Edition-Alertes"] = Uri.EscapeDataString(pdf.AlertesJson);
            return Results.File(pdf.Octets, "application/pdf", nom);
        });
        return api;
    }
}
