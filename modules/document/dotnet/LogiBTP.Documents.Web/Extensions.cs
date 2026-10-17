using LogiBTP.Socle.Web;
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
        services.AddScoped<VerrouDocumentService<TDoc, TLigne, TComplet>>();
        services.AddScoped<TracabiliteService<TDoc, TLigne, TComplet>>();
        services.AddScoped<AffichageDocumentService<TDoc, TLigne>>();
        return services;
    }

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

        // Affichage de la saisie : étiquettes de lignes, couleurs des modes de vente, modèles, vues de colonnes.
        api.MapGet("/etiquettes-ligne", (AffichageDocumentService<TDoc, TLigne> s, CancellationToken ct) => s.Etiquettes(ct));
        api.MapPut("/etiquettes-ligne", (List<EtiquetteDto> l, HttpContext http, AffichageDocumentService<TDoc, TLigne> s, CancellationToken ct) => s.EnregistrerEtiquettes(l, Utilisateur.Depuis(http), ct));
        api.MapGet("/couleurs-type-prix", (AffichageDocumentService<TDoc, TLigne> s, CancellationToken ct) => s.CouleursTypePrix(ct));
        api.MapPut("/couleurs-type-prix", (List<CouleurTypePrixDto> l, HttpContext http, AffichageDocumentService<TDoc, TLigne> s, CancellationToken ct) => s.EnregistrerCouleurs(l, Utilisateur.Depuis(http), ct));
        api.MapGet("/modeles-document", (AffichageDocumentService<TDoc, TLigne> s, CancellationToken ct) => s.Modeles(ct));
        api.MapGet("/vues-document", (string? type, HttpContext http, AffichageDocumentService<TDoc, TLigne> s, CancellationToken ct) => s.Vues(type, Utilisateur.Depuis(http), ct));
        api.MapPut("/vues-document", (VueDocumentDto v, HttpContext http, AffichageDocumentService<TDoc, TLigne> s, CancellationToken ct) => s.EnregistrerVue(v, Utilisateur.Depuis(http), ct));
        api.MapDelete("/vues-document/{id:int}", async (int id, HttpContext http, AffichageDocumentService<TDoc, TLigne> s, CancellationToken ct) =>
        {
            await s.SupprimerVue(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });

        // Documents
        api.MapGet("/documents", (string? type, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Lister(type, ct));
        api.MapGet("/documents/{id:long}", (long id, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Charger(id, ct));
        api.MapPost("/documents", async (CreationDocument c, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
        {
            var d = await s.Creer(c, Utilisateur.Depuis(http), ct);
            return Results.Created($"/api/documents/{d.Document.EntId}", d);
        });
        api.MapPut("/documents/{id:long}", async (long id, TComplet d, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, VerrouDocumentService<TDoc, TLigne, TComplet> v, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            await v.Controler(id, u, ct);
            return await s.Enregistrer(id, d, u, ct);
        });
        // Verrou de modification (sans expiration) : état, prise, libération, déverrouillage manuel.
        api.MapGet("/documents/{id:long}/verrou", (long id, Guid? jeton, HttpContext http, VerrouDocumentService<TDoc, TLigne, TComplet> v, CancellationToken ct) =>
            v.Etat(id, jeton, Utilisateur.Depuis(http), ct));
        api.MapPost("/documents/{id:long}/verrou", (long id, DemandeVerrouDocument d, HttpContext http, VerrouDocumentService<TDoc, TLigne, TComplet> v, CancellationToken ct) =>
            v.Verrouiller(id, d, Utilisateur.Depuis(http), ct));
        api.MapDelete("/documents/{id:long}/verrou", async (long id, Guid jeton, VerrouDocumentService<TDoc, TLigne, TComplet> v, CancellationToken ct) =>
        {
            await v.Deverrouiller(id, jeton, ct);
            return Results.NoContent();
        });
        api.MapDelete("/documents/{id:long}/verrou/force", async (long id, HttpContext http, VerrouDocumentService<TDoc, TLigne, TComplet> v, CancellationToken ct) =>
        {
            await v.Forcer(id, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
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
        // Traçabilité : origine d'un import, documents liés, historique.
        api.MapGet("/documents/{id:long}/tracabilite", (long id, TracabiliteService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Lire(id, ct));
        api.MapPut("/documents/{id:long}/origine", async (long id, OrigineDocumentDto o, HttpContext http, TracabiliteService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
        {
            await s.EnregistrerOrigine(id, o, Utilisateur.Depuis(http), ct);
            return Results.NoContent();
        });
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
        // Plusieurs documents sources : création (une section par source), ajout à un brouillon, documents en attente.
        api.MapPost("/documents/plusieurs", (DemandeTransformationMultiple d, HttpContext http, TransformationService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.TransformerPlusieurs(d, Utilisateur.Depuis(http), ct));
        api.MapPost("/documents/{id:long}/sources", (long id, DemandeSources d, HttpContext http, TransformationService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.AjouterSources(id, d.Sources, Utilisateur.Depuis(http), ct));
        api.MapGet("/documents/en-attente", (int cible, long? tiers, TransformationService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.EnAttente(cible, tiers, ct));
        api.MapGet("/documents/{id:long}/restes", (long id, TransformationService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Restes(id, ct));
        api.MapGet("/parametres-documents/seuils-solde", (DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.LireSeuilsSolde(ct));
        api.MapPut("/parametres-documents/seuils-solde", (SeuilsSolde v, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.EnregistrerSeuilsSolde(v, Utilisateur.Depuis(http), ct));
        // Règles des documents à trois niveaux (écriture : administrateur).
        api.MapGet("/regles-documents", (DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Regles.Lire(ct));
        api.MapPut("/regles-documents", (List<RegleSaisie> v, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.Regles.Enregistrer(v, Utilisateur.Depuis(http), ct));
        // Conditions de paiement (écriture : administrateur) et échéancier des pièces.
        api.MapGet("/conditions-paiement", (DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Echeancier.Conditions(true, ct));
        api.MapPut("/conditions-paiement", (List<ConditionPaiementDto> v, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.Echeancier.EnregistrerConditions(v, Utilisateur.Depuis(http), ct));
        api.MapGet("/parametres-documents/conditions-paiement", (DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Echeancier.Defauts(ct));
        api.MapPut("/parametres-documents/conditions-paiement", (ConditionsDefaut v, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.Echeancier.EnregistrerDefauts(v, Utilisateur.Depuis(http), ct));
        api.MapPut("/documents/{id:long}/echeances", (long id, List<EcheanceSaisie> v, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            s.ModifierEcheances(id, v, Utilisateur.Depuis(http), ct));
        api.MapGet("/documents/{id:long}/lot-archivage", (long id, TransformationService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.LotArchivage(id, ct));

        // Calcul serveur sans enregistrement et arbitrage des écarts
        api.MapPost("/calcul", (TComplet d, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.Recalculer(d, ct));
        api.MapPost("/cas-test", async (ArbitrageEcarts a, HttpContext http, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) =>
            Results.Ok(new { cas_id = await s.EnregistrerCasTest(a, Utilisateur.Depuis(http), ct) }));
        api.MapGet("/cas-test/{id:long}/export", (long id, DocumentService<TDoc, TLigne, TComplet> s, CancellationToken ct) => s.ExporterCasTest(id, ct));
        return api;
    }
}
