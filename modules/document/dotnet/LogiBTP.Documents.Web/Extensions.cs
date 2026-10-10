using LogiBTP.Socle;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Documents.Web;

/// <summary>Branchement du module Document dans une application ASP.NET Core.</summary>
public static class Extensions
{
    /// <summary>
    /// Enregistre les services du module pour une spécialisation donnée : contexte EF, spécialisation,
    /// handlers (standard et facture d'avancement), persistance, services de documents et de transformations.
    /// Le contexte doit déjà être enregistré (AddDbContext) sous son type concret.
    /// </summary>
    public static IServiceCollection AddModuleDocument<TDoc, TLigne, TComplet, TContexte, TSpecialisation>(this IServiceCollection services)
        where TDoc : Document, new()
        where TLigne : DocumentLigne, new()
        where TComplet : DocumentComplet<TDoc, TLigne>, new()
        where TContexte : DocumentDbContext<TDoc, TLigne>
        where TSpecialisation : SpecialisationDocument<TDoc, TLigne, TComplet>, new()
    {
        services.AddScoped<DocumentDbContext<TDoc, TLigne>>(sp => sp.GetRequiredService<TContexte>());
        services.AddSingleton<TSpecialisation>();
        services.AddSingleton<SpecialisationDocument<TDoc, TLigne, TComplet>>(sp => sp.GetRequiredService<TSpecialisation>());
        services.AddSingleton<NettoyageHtml>();
        services.AddSingleton<IDocumentHandler<TDoc, TLigne>>(sp =>
            new HandlerStandard<TDoc, TLigne>(sp.GetRequiredService<TSpecialisation>().Calculer));
        services.AddSingleton<IDocumentHandler<TDoc, TLigne>>(sp =>
            new HandlerFactureAvancement<TDoc, TLigne>(sp.GetRequiredService<TSpecialisation>().Calculer));
        services.AddSingleton<RegistreHandlers<TDoc, TLigne>>();
        services.AddScoped<PersistanceDocument<TDoc, TLigne, TComplet>>();
        services.AddScoped<DocumentService<TDoc, TLigne, TComplet>>();
        services.AddScoped<TransformationService<TDoc, TLigne, TComplet>>();
        return services;
    }

    /// <summary>Traduit les erreurs métier en réponses JSON avec un code stable exploitable par le client.</summary>
    public static IApplicationBuilder UseErreursMetier(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        try
        {
            await next(http);
        }
        catch (ExceptionMetier e)
        {
            http.Response.StatusCode = e.Statut;
            await http.Response.WriteAsJsonAsync(new { status = e.Statut, code = e.Code, title = e.Message, details = e.Details },
                JsonCalcul.Options);
        }
    });

    /// <summary>Routes HTTP du module Document (paramétrage, documents, transformations, cas de test).</summary>
    public static RouteGroupBuilder MapModuleDocument<TDoc, TLigne, TComplet>(this RouteGroupBuilder api)
        where TDoc : Document, new()
        where TLigne : DocumentLigne, new()
        where TComplet : DocumentComplet<TDoc, TLigne>, new()
    {
        // Paramétrage : le client construit l'écran à partir de la définition du type.
        api.MapGet("/types-document", async (DocumentDbContext<TDoc, TLigne> db, CancellationToken ct) =>
            await db.TypesDocument.AsNoTracking().Where(t => t.TydActif).OrderBy(t => t.TydFamille).ThenBy(t => t.TydId).ToListAsync(ct));
        api.MapGet("/types-document/{code}/definition", (string code, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.Definition(code, Utilisateur.Depuis(http), ct));
        api.MapGet("/unites", async (DocumentDbContext<TDoc, TLigne> db, CancellationToken ct) =>
            await db.Unites.AsNoTracking().Where(x => x.UntActif).OrderBy(x => x.UntOrdre).ThenBy(x => x.UntCode).ToListAsync(ct));

        // Documents
        api.MapGet("/documents", (string? type, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Lister(type, ct));
        api.MapGet("/documents/{id:long}", (long id, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Charger(id, ct));
        api.MapPost("/documents", async (CreationDocument c, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
        {
            var d = await s.Creer(c, Utilisateur.Depuis(http), ct);
            return Results.Created($"/api/documents/{d.Document.EntId}", d);
        });
        api.MapPut("/documents/{id:long}", (long id, TComplet d, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.Enregistrer(id, d, Utilisateur.Depuis(http), ct));
        api.MapDelete("/documents/{id:long}", async (long id, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
        {
            await s.Supprimer(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        api.MapPost("/documents/{id:long}/valider", (long id, DemandeVersion v, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.Valider(id, v, Utilisateur.Depuis(http), ct));
        api.MapPost("/documents/{id:long}/indices", (long id, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.CreerIndice(id, Utilisateur.Depuis(http), ct));
        api.MapPost("/documents/{id:long}/reference", (long id, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.DesignerReference(id, Utilisateur.Depuis(http), ct));
        api.MapPost("/documents/{id:long}/copie", (long id, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.Copier(id, Utilisateur.Depuis(http), ct));
        api.MapGet("/documents/{id:long}/historique", async (long id, DocumentDbContext<TDoc, TLigne> db, CancellationToken ct) =>
            await db.Historiques.AsNoTracking().Where(h => h.HisEntId == id).OrderByDescending(h => h.HisId)
                .Select(h => new { h.HisId, h.HisVersion, h.HisAction, h.HisDate, h.HisUtilisateur }).ToListAsync(ct));
        api.MapGet("/historique/{hisId:long}", async (long hisId, DocumentDbContext<TDoc, TLigne> db, CancellationToken ct) =>
            await db.Historiques.AsNoTracking().FirstOrDefaultAsync(h => h.HisId == hisId, ct) is { } h
                ? Results.Ok(h) : Results.NotFound());

        // Transformations, suivi des reliquats, soldes, archivage
        api.MapPost("/documents/{id:long}/transformer", (long id, DemandeTransformation d, HttpContext http, TransformationService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.Transformer(id, d, Utilisateur.Depuis(http), ct));
        api.MapGet("/documents/{id:long}/suivi", async (long id, DocumentService<TDoc, TLigne, TComplet> docs, TransformationService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            await s.Suivi(await docs.Charger(id, ct), ct));
        api.MapPost("/lignes/{ligId:long}/soldes", async (long ligId, DemandeSolde d, HttpContext http, TransformationService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
        {
            await s.Solder(ligId, d, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
        api.MapGet("/documents/{id:long}/lot-archivage", (long id, TransformationService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.LotArchivage(id, ct));

        // Calcul serveur sans enregistrement et arbitrage des écarts
        api.MapPost("/calcul", (TComplet d, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Recalculer(d, ct));
        api.MapPost("/cas-test", async (ArbitrageEcarts a, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            Results.Ok(new { cas_id = await s.EnregistrerCasTest(a, Utilisateur.Depuis(http), ct) }));
        api.MapGet("/cas-test/{id:long}/export", (long id, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.ExporterCasTest(id, ct));
        return api;
    }
}
