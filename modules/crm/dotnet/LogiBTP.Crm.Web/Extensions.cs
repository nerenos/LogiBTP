using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Crm.Web;

/// <summary>Branchement du module CRM dans une application ASP.NET Core (facultatif : activé par société).</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleCrm<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationCrm
    {
        services.AddDbContext<CrmDbContext>(options);
        services.AddSingleton<SpecialisationCrm, TSpecialisation>();
        services.AddSingleton<NettoyageHtmlCrm>();
        services.AddScoped<ServiceCrm>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /crm ; renvoie le groupe du module (filtre d'activation possible).</summary>
    public static RouteGroupBuilder MapModuleCrm(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/crm");
        g.MapGet("/contexte", (HttpContext http, ServiceCrm s, CancellationToken ct) => s.Contexte(Utilisateur.Depuis(http), ct));
        g.MapPost("/elements", (List<ElementCrm> e, ServiceCrm s, CancellationToken ct) => s.Decrire(e, ct));
        g.MapGet("/types-notes", (ServiceCrm s, CancellationToken ct) => s.TypesNotes(ct));
        g.MapPut("/types-notes", (List<TypeNoteDto> t, HttpContext http, ServiceCrm s, CancellationToken ct) => s.EnregistrerTypesNotes(t, Utilisateur.Depuis(http), ct));
        g.MapGet("/notes", (string? vue, string? type_element, string? id_element, string? nature, string? etat, int? srv, string? recherche, int? page, int? taille,
                HttpContext http, ServiceCrm s, CancellationToken ct) =>
            s.Notes(new FiltreNotes(vue, type_element, id_element, nature, etat, srv, recherche, page ?? 1, taille ?? 50), Utilisateur.Depuis(http), ct));
        g.MapGet("/notes/{id:long}", (long id, bool? reveler, HttpContext http, ServiceCrm s, CancellationToken ct) => s.Note(id, reveler ?? false, Utilisateur.Depuis(http), ct));
        g.MapPost("/notes", (NoteSaisie n, HttpContext http, ServiceCrm s, CancellationToken ct) => s.Enregistrer(null, n, Utilisateur.Depuis(http), ct));
        g.MapPut("/notes/{id:long}", (long id, NoteSaisie n, HttpContext http, ServiceCrm s, CancellationToken ct) => s.Enregistrer(id, n, Utilisateur.Depuis(http), ct));
        g.MapDelete("/notes/{id:long}", async (long id, HttpContext http, ServiceCrm s, CancellationToken ct) =>
        {
            await s.Supprimer(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/notes/{id:long}/prendre", (long id, HttpContext http, ServiceCrm s, CancellationToken ct) => s.Prendre(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/notes/{id:long}/rendre", (long id, HttpContext http, ServiceCrm s, CancellationToken ct) => s.Rendre(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/notes/{id:long}/lue", async (long id, HttpContext http, ServiceCrm s, CancellationToken ct) =>
        {
            await s.Lue(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapGet("/parametres", (ServiceCrm s, CancellationToken ct) => s.Parametres(ct));
        g.MapPut("/parametres", (ParametresCrm p, HttpContext http, ServiceCrm s, CancellationToken ct) => s.EnregistrerParametres(p, Utilisateur.Depuis(http), ct));
        g.MapGet("/rappels", (bool? tous, HttpContext http, ServiceCrm s, CancellationToken ct) => s.MesRappels(tous ?? false, Utilisateur.Depuis(http), ct));
        g.MapPost("/notes/{id:long}/rappels", (long id, RappelSaisi r, HttpContext http, ServiceCrm s, CancellationToken ct) => s.AjouterRappel(id, r, Utilisateur.Depuis(http), ct));
        g.MapPut("/rappels/{id:long}", (long id, RappelSaisi r, HttpContext http, ServiceCrm s, CancellationToken ct) => s.ModifierRappel(id, r, Utilisateur.Depuis(http), ct));
        g.MapDelete("/rappels/{id:long}", (long id, HttpContext http, ServiceCrm s, CancellationToken ct) => s.SupprimerRappel(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/rappels/{id:long}/traiter", (long id, HttpContext http, ServiceCrm s, CancellationToken ct) => s.TraiterRappel(id, Utilisateur.Depuis(http), ct));
        g.MapGet("/rechercher", (string type, string? texte, ServiceCrm s, CancellationToken ct) => s.Rechercher(type, texte ?? "", ct));
        g.MapGet("/demandes", (string? vue, string? etat, string? recherche, long? tiers, int? page, int? taille, HttpContext http, ServiceCrm s, CancellationToken ct) =>
            s.Demandes(vue, etat, recherche, tiers, page ?? 1, taille ?? 50, Utilisateur.Depuis(http), ct));
        g.MapGet("/demandes/{id:long}", (long id, HttpContext http, ServiceCrm s, CancellationToken ct) => s.Demande(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/demandes", (DemandeSaisie d, HttpContext http, ServiceCrm s, CancellationToken ct) => s.EnregistrerDemande(null, d, Utilisateur.Depuis(http), ct));
        g.MapPut("/demandes/{id:long}", (long id, DemandeSaisie d, HttpContext http, ServiceCrm s, CancellationToken ct) => s.EnregistrerDemande(id, d, Utilisateur.Depuis(http), ct));
        g.MapDelete("/demandes/{id:long}", async (long id, HttpContext http, ServiceCrm s, CancellationToken ct) =>
        {
            await s.SupprimerDemande(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/demandes/{id:long}/prendre", (long id, HttpContext http, ServiceCrm s, CancellationToken ct) => s.PrendreDemande(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/demandes/{id:long}/rendre", (long id, HttpContext http, ServiceCrm s, CancellationToken ct) => s.RendreDemande(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/demandes/{id:long}/projet", (long id, HttpContext http, ServiceCrm s, CancellationToken ct) => s.CreerProjet(id, Utilisateur.Depuis(http), ct));
        return g;
    }
}
