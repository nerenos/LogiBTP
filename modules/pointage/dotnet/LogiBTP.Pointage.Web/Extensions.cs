using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Pointage.Web;

/// <summary>Branchement du module Pointage (facultatif : activé par société).</summary>
public static class Extensions
{
    public static IServiceCollection AddModulePointage<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationPointage
    {
        services.AddDbContext<PointageDbContext>(options);
        services.AddSingleton<SpecialisationPointage, TSpecialisation>();
        services.AddScoped<ServicePointage>();
        services.AddScoped<ServiceSynthese>();
        services.AddScoped<ServicePaie>();
        services.AddSingleton<JetonsBorne>();
        services.AddScoped<ServiceBorne>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /pointage ; renvoie le groupe (filtre d'activation posé par l'application).</summary>
    public static RouteGroupBuilder MapModulePointage(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/pointage");
        g.MapGet("/parametres", (ServicePointage s, CancellationToken ct) => s.ParametresAsync(ct));
        g.MapPut("/parametres", (ParametresDto p, HttpContext http, ServicePointage s, CancellationToken ct) => s.EnregistrerParametresAsync(p, Utilisateur.Depuis(http), ct));
        g.MapGet("/sous-types", (ServicePointage s, CancellationToken ct) => s.SousTypesAsync(ct));
        g.MapPut("/sous-types", (List<SousTypeDto> l, HttpContext http, ServicePointage s, CancellationToken ct) => s.EnregistrerSousTypesAsync(l, Utilisateur.Depuis(http), ct));
        g.MapGet("/referentiels", (ServicePointage s, CancellationToken ct) => s.ReferentielsAsync(ct));
        g.MapGet("/chantiers", (string? recherche, ServicePointage s, CancellationToken ct) => s.ChantiersAsync(recherche, ct));
        g.MapGet("/chantiers/{id:int}/ordres", (int id, ServicePointage s, CancellationToken ct) => s.OrdresChantierAsync(id, ct));
        g.MapGet("/salaries", (int? service, string? recherche, DateOnly? lundi, ServicePointage s, CancellationToken ct) =>
            s.SalariesAsync(service, recherche, ReglesPointage.LundiDe(lundi ?? DateOnly.FromDateTime(DateTime.Today)), ct));
        g.MapGet("/pointages/{id:long}/position", (long id, ServicePointage s, CancellationToken ct) => s.PositionAsync(id, ct));
        g.MapGet("/semaine/{salarie:int}/{lundi}", (int salarie, DateOnly lundi, HttpContext http, ServicePointage s, CancellationToken ct) =>
            s.SemaineAsync(salarie, lundi, Utilisateur.Depuis(http), ct));
        g.MapPut("/semaine/{salarie:int}/{lundi}", (int salarie, DateOnly lundi, SemaineSaisie saisie, HttpContext http, ServicePointage s, CancellationToken ct) =>
            s.EnregistrerSemaineAsync(salarie, lundi, saisie, Utilisateur.Depuis(http), ct));
        // Synthèse et validation (lot 2).
        g.MapGet("/synthese", (int? service, string? recherche, DateOnly? lundi, HttpContext http, ServiceSynthese s, CancellationToken ct) =>
            s.SyntheseAsync(service, recherche, lundi ?? DateOnly.FromDateTime(DateTime.Today), Utilisateur.Depuis(http), ct));
        g.MapGet("/synthese/semaine/{salarie:int}/{lundi}", (int salarie, DateOnly lundi, HttpContext http, ServiceSynthese s, CancellationToken ct) =>
            s.DetailAsync(salarie, lundi, Utilisateur.Depuis(http), ct));
        g.MapPut("/synthese/semaine/{salarie:int}/{lundi}", (int salarie, DateOnly lundi, SemaineSaisie saisie, HttpContext http, ServiceSynthese s, CancellationToken ct) =>
            s.EnregistrerAsync(salarie, lundi, saisie, Utilisateur.Depuis(http), ct));
        g.MapDelete("/synthese/semaine/{salarie:int}/{lundi}", (int salarie, DateOnly lundi, HttpContext http, ServiceSynthese s, CancellationToken ct) =>
            s.RetablirAsync(salarie, lundi, Utilisateur.Depuis(http), ct));
        g.MapPost("/synthese/valider", (ActionSynthese a, HttpContext http, ServiceSynthese s, CancellationToken ct) => s.ValiderAsync(a, Utilisateur.Depuis(http), ct));
        g.MapPost("/synthese/devalider", (ActionSynthese a, HttpContext http, ServiceSynthese s, CancellationToken ct) => s.DevaliderAsync(a, Utilisateur.Depuis(http), ct));
        g.MapPost("/corrections", (CorrectionSaisie c, HttpContext http, ServiceSynthese s, CancellationToken ct) => s.DemanderCorrectionAsync(c, Utilisateur.Depuis(http), ct));
        g.MapPost("/corrections/{id:long}/appliquer", (long id, ReponseCorrection r, HttpContext http, ServiceSynthese s, CancellationToken ct) =>
            s.AppliquerCorrectionAsync(id, r, Utilisateur.Depuis(http), ct));
        g.MapPost("/corrections/{id:long}/rejeter", (long id, ReponseCorrection r, HttpContext http, ServiceSynthese s, CancellationToken ct) =>
            s.RejeterCorrectionAsync(id, r, Utilisateur.Depuis(http), ct));
        // Paie (lot 3) : profils, variables, saisies des rubriques, zones, export, valorisation.
        g.MapGet("/profils", (ServicePaie s, CancellationToken ct) => s.ProfilsAsync(ct));
        g.MapPut("/profils", (List<ProfilDto> l, HttpContext http, ServicePaie s, CancellationToken ct) => s.EnregistrerProfilsAsync(l, Utilisateur.Depuis(http), ct));
        g.MapGet("/variables/{salarie:int}/{lundi}", (int salarie, DateOnly lundi, HttpContext http, ServicePaie s, CancellationToken ct) =>
            s.VariablesAsync(salarie, lundi, Utilisateur.Depuis(http), ct));
        g.MapPut("/variables/{salarie:int}/{lundi}", (int salarie, DateOnly lundi, ValeursSaisies v, HttpContext http, ServicePaie s, CancellationToken ct) =>
            s.EnregistrerValeursAsync(salarie, lundi, v, Utilisateur.Depuis(http), ct));
        g.MapGet("/zones/{chantier:int}", (int chantier, ServicePaie s, CancellationToken ct) => s.ZonesAsync(chantier, ct));
        g.MapPut("/zones/{chantier:int}", (int chantier, List<ZoneSaisie> l, HttpContext http, ServicePaie s, CancellationToken ct) =>
            s.EnregistrerZonesAsync(chantier, l, Utilisateur.Depuis(http), ct));
        g.MapGet("/export", (DateOnly du, DateOnly au, int? service, HttpContext http, ServicePaie s, CancellationToken ct) =>
            s.ExportAsync(new DemandeExport(du, au, service), false, Utilisateur.Depuis(http), ct));
        g.MapPost("/export", (DemandeExport d, HttpContext http, ServicePaie s, CancellationToken ct) => s.ExportAsync(d, true, Utilisateur.Depuis(http), ct));
        g.MapGet("/exports", (HttpContext http, ServicePaie s, CancellationToken ct) => s.ExportsAsync(Utilisateur.Depuis(http), ct));
        g.MapGet("/exports/{id:long}/fichier", (long id, HttpContext http, ServicePaie s, CancellationToken ct) => s.FichierExportAsync(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/valoriser", (DemandeValorisation d, HttpContext http, ServicePaie s, CancellationToken ct) => s.ValoriserAsync(d, Utilisateur.Depuis(http), ct));
        // Bornes d'atelier (lot 4) : administration (session) puis routes de la borne (publiques : jeton d'appareil).
        g.MapGet("/appareils", (HttpContext http, ServiceBorne s, CancellationToken ct) => s.AppareilsAsync(Utilisateur.Depuis(http), ct));
        g.MapPost("/appareils", (AppareilSaisi a, HttpContext http, ServiceBorne s, CancellationToken ct) => s.CreerAppareilAsync(a, Utilisateur.Depuis(http), ct));
        g.MapPut("/appareils/{id:int}", async (int id, AppareilSaisi a, HttpContext http, ServiceBorne s, CancellationToken ct) =>
        {
            await s.ModifierAppareilAsync(id, a, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapGet("/pins", (int? service, HttpContext http, ServiceBorne s, CancellationToken ct) => s.PinsAsync(service, Utilisateur.Depuis(http), ct));
        g.MapPut("/pins/{salarie:int}", async (int salarie, PinSaisi p, HttpContext http, ServiceBorne s, CancellationToken ct) =>
        {
            await s.EnregistrerPinAsync(salarie, p, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapGet("/groupes/{groupe:guid}", (Guid groupe, HttpContext http, ServiceBorne s, CancellationToken ct) => s.GroupeAsync(groupe, Utilisateur.Depuis(http), ct));
        g.MapPut("/groupes/{groupe:guid}", (Guid groupe, GroupeSaisi gs, HttpContext http, ServiceBorne s, CancellationToken ct) => s.ModifierGroupeAsync(groupe, gs, Utilisateur.Depuis(http), ct));
        var b = g.MapGroup("/borne");
        b.MapGet("", (HttpContext http, ServiceBorne s, CancellationToken ct) => s.OuvrirAsync(http, ct));
        b.MapPost("/identifier", (Identification i, HttpContext http, ServiceBorne s, CancellationToken ct) => s.IdentifierAsync(http, i, ct));
        b.MapGet("/ordre", (string numero, HttpContext http, ServiceBorne s, CancellationToken ct) => s.OrdreAsync(http, numero, ct));
        b.MapPost("/pointages", (PointageBorne p, HttpContext http, ServiceBorne s, CancellationToken ct) => s.PointerAsync(http, p, ct));
        return g;
    }
}
