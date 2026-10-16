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
        where TSpecialisation : SpecialisationGed =>
        services.AddModuleGed<TSpecialisation>((_, o) => options(o));

    /// <summary>Options du contexte par requête (ex. base de la société courante, désignée par le sous-domaine).</summary>
    public static IServiceCollection AddModuleGed<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationGed
    {
        services.AddDbContext<GedDbContext>(options);
        services.AddSingleton<SpecialisationGed, TSpecialisation>();
        // Un répertoire par société, nommé comme sa base (logibtp, logibtp_demo…), sous le répertoire de stockage.
        services.AddScoped(sp => new StockageGed(RepertoireSociete(sp.GetRequiredService<SpecialisationGed>().RepertoireStockage, sp.GetService<SocieteCourante>())));
        services.AddScoped<ServiceGed>();
        return services;
    }

    private static readonly Lock VerrouRepertoires = new();

    /// <summary>
    /// Répertoire des documents d'une société : nom de sa base (à défaut, code de la société ou « _principale »).
    /// Un ancien répertoire nommé d'après le code de la société (« _principale », « demo »…) est renommé au premier accès.
    /// </summary>
    public static string RepertoireSociete(string racine, SocieteCourante? societe)
    {
        var ancien = societe?.Code ?? "_principale";
        var nom = societe?.Base ?? ancien;
        var dossier = Path.Combine(racine, nom);
        if (nom == ancien) return dossier;
        lock (VerrouRepertoires)
        {
            var anciennement = Path.Combine(racine, ancien);
            if (!Directory.Exists(dossier) && Directory.Exists(anciennement)) Directory.Move(anciennement, dossier);
        }
        return dossier;
    }

    public static IServiceCollection AddModuleGed(this IServiceCollection services, Action<DbContextOptionsBuilder> options) =>
        services.AddModuleGed<SpecialisationGed>(options);

    /// <summary>Routes HTTP du module, sous /ged (mêmes chemins que FournisseurGedApi).</summary>
    public static RouteGroupBuilder MapModuleGed(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/ged");
        g.MapGet("/parametres", (ServiceGed s, CancellationToken ct) => s.Parametres(ct));
        g.MapGet("/documents", (string? type_element, string? id_element, string? recherche, bool? supprimes, bool? coffre, bool? archives, bool? sans_element,
                HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.Lister(new FiltreGed
            {
                TypeElement = type_element, IdElement = id_element, Recherche = recherche, Supprimes = supprimes == true, Coffre = coffre == true,
                Archives = archives == true, SansElement = sans_element == true,
            }, Utilisateur.Depuis(http), ct));
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
        g.MapGet("/statistiques", (string? type_element, string? id_element, ServiceGed s, CancellationToken ct) => s.Statistiques(type_element, id_element, ct));

        // Répertoires de l'explorateur (sous un élément lié, ou globaux).
        g.MapGet("/repertoires", (string? type_element, string? id_element, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.Repertoires(type_element, id_element, Utilisateur.Depuis(http), ct));
        g.MapPost("/repertoires", (DemandeRepertoire r, HttpContext http, ServiceGed s, CancellationToken ct) => s.CreerRepertoire(r, Utilisateur.Depuis(http), ct));
        g.MapPut("/repertoires/{id:long}", (long id, Dictionary<string, JsonElement> r, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.ModifierRepertoire(id, r, Utilisateur.Depuis(http), ct));
        g.MapDelete("/repertoires/{id:long}", async (long id, HttpContext http, ServiceGed s, CancellationToken ct) =>
        {
            await s.SupprimerRepertoire(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });

        // Dérivations (la cible dérive du document de la route), indexation plein texte.
        g.MapPost("/documents/{id:long}/derivations", (long id, DemandeDerivation d, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.AjouterDerivation(id, d, Utilisateur.Depuis(http), ct));
        g.MapDelete("/derivations/{id:long}", async (long id, HttpContext http, ServiceGed s, CancellationToken ct) =>
        {
            await s.SupprimerDerivation(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        g.MapPost("/documents/{id:long}/indexer", (long id, HttpContext http, ServiceGed s, CancellationToken ct) => s.Indexer(id, Utilisateur.Depuis(http), ct));
        g.MapPost("/indexation", (HttpContext http, ServiceGed s, CancellationToken ct) => s.IndexerEnAttente(Utilisateur.Depuis(http), ct));

        // Rétention, archive séparée, règles (rétention et classification).
        g.MapPost("/documents/{id:long}/archiver", async (long id, DemandeArchivage d, HttpContext http, ServiceGed s, CancellationToken ct) =>
            Results.Ok(new { archives = await s.Archiver(id, d, Utilisateur.Depuis(http), ct) }));
        g.MapPost("/documents/{id:long}/desarchiver", (long id, HttpContext http, ServiceGed s, CancellationToken ct) => s.RestaurerArchive(id, Utilisateur.Depuis(http), ct));
        g.MapGet("/retention/echeances", (HttpContext http, ServiceGed s, CancellationToken ct) => s.Echeances(Utilisateur.Depuis(http), ct));
        g.MapPost("/retention/appliquer", (HttpContext http, ServiceGed s, CancellationToken ct) => s.AppliquerRetention(Utilisateur.Depuis(http), ct));
        g.MapGet("/regles", (ServiceGed s, CancellationToken ct) => s.Regles(ct));
        g.MapPut("/regles/retention", (List<RegleRetentionDto> r, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.RemplacerReglesRetention(r, Utilisateur.Depuis(http), ct));
        g.MapPut("/regles/classification", (List<RegleClassificationDto> r, HttpContext http, ServiceGed s, CancellationToken ct) =>
            s.RemplacerReglesClassification(r, Utilisateur.Depuis(http), ct));
        return api;
    }
}
