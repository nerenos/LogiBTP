using System.Text.Json.Serialization;
using LogiBTP.Api.Documents;
using LogiBTP.Api.Donnees;
using LogiBTP.Api.Infrastructure;
using LogiBTP.Calcul;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<LogiBtpContext>(o => o
    .UseNpgsql(builder.Configuration.GetConnectionString("LogiBTP"))
    .UseSnakeCaseNamingConvention());

builder.Services.ConfigureHttpJsonOptions(o =>
{
    // Mêmes conventions que les jeux de test : noms de colonnes snake_case, décimaux acceptés en chaîne.
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.SnakeCaseLower;
    o.SerializerOptions.NumberHandling = JsonNumberHandling.AllowReadingFromString;
});

builder.Services.AddSingleton<NettoyageHtml>();
builder.Services.AddSingleton<IDocumentHandler, HandlerStandard>();
builder.Services.AddSingleton<IDocumentHandler, HandlerFactureAvancement>();
builder.Services.AddSingleton<RegistreHandlers>();
builder.Services.AddScoped<PersistanceDocument>();
builder.Services.AddScoped<DocumentService>();
builder.Services.AddScoped<TransformationService>();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseCors();

// Erreurs métier → réponse JSON avec un code stable exploitable par le client.
app.Use(async (http, next) =>
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

var api = app.MapGroup("/api");

api.MapGet("/sante", () => Results.Ok(new { statut = "ok", version_moteur = MoteurCalcul.Version }));

// Paramétrage : le client construit l'écran à partir de la définition du type.
api.MapGet("/types-document", async (LogiBtpContext db, CancellationToken ct) =>
    await db.TypesDocument.AsNoTracking().Where(t => t.TydActif).OrderBy(t => t.TydFamille).ThenBy(t => t.TydId).ToListAsync(ct));
api.MapGet("/types-document/{code}/definition", (string code, HttpContext http, DocumentService s, CancellationToken ct) =>
    s.Definition(code, Utilisateur.Depuis(http), ct));

api.MapGet("/unites", async (LogiBtpContext db, CancellationToken ct) =>
    await db.Unites.AsNoTracking().Where(x => x.UntActif).OrderBy(x => x.UntOrdre).ThenBy(x => x.UntCode).ToListAsync(ct));

// Documents
api.MapGet("/documents", (string? type, DocumentService s, CancellationToken ct) => s.Lister(type, ct));
api.MapGet("/documents/{id:long}", (long id, DocumentService s, CancellationToken ct) => s.Charger(id, ct));
api.MapPost("/documents", async (CreationDocument c, HttpContext http, DocumentService s, CancellationToken ct) =>
{
    var d = await s.Creer(c, Utilisateur.Depuis(http), ct);
    return Results.Created($"/api/documents/{d.Document.EntId}", d);
});
api.MapPut("/documents/{id:long}", (long id, EnregistrementDocument d, HttpContext http, DocumentService s, CancellationToken ct) =>
    s.Enregistrer(id, d, Utilisateur.Depuis(http), ct));
api.MapDelete("/documents/{id:long}", async (long id, HttpContext http, DocumentService s, CancellationToken ct) =>
{
    await s.Supprimer(id, Utilisateur.Depuis(http), ct);
    return Results.NoContent();
});
api.MapPost("/documents/{id:long}/valider", (long id, DemandeVersion v, HttpContext http, DocumentService s, CancellationToken ct) =>
    s.Valider(id, v, Utilisateur.Depuis(http), ct));
api.MapPost("/documents/{id:long}/indices", (long id, HttpContext http, DocumentService s, CancellationToken ct) =>
    s.CreerIndice(id, Utilisateur.Depuis(http), ct));
api.MapPost("/documents/{id:long}/reference", (long id, HttpContext http, DocumentService s, CancellationToken ct) =>
    s.DesignerReference(id, Utilisateur.Depuis(http), ct));
api.MapPost("/documents/{id:long}/copie", (long id, HttpContext http, DocumentService s, CancellationToken ct) =>
    s.Copier(id, Utilisateur.Depuis(http), ct));
api.MapGet("/documents/{id:long}/historique", async (long id, LogiBtpContext db, CancellationToken ct) =>
    await db.Historiques.AsNoTracking().Where(h => h.HisEntId == id).OrderByDescending(h => h.HisId)
        .Select(h => new { h.HisId, h.HisVersion, h.HisAction, h.HisDate, h.HisUtilisateur }).ToListAsync(ct));
api.MapGet("/historique/{hisId:long}", async (long hisId, LogiBtpContext db, CancellationToken ct) =>
    await db.Historiques.AsNoTracking().FirstOrDefaultAsync(h => h.HisId == hisId, ct) is { } h
        ? Results.Ok(h) : Results.NotFound());

// Transformations, suivi des reliquats, soldes, archivage
api.MapPost("/documents/{id:long}/transformer", (long id, DemandeTransformation d, HttpContext http, TransformationService s, CancellationToken ct) =>
    s.Transformer(id, d, Utilisateur.Depuis(http), ct));
api.MapGet("/documents/{id:long}/suivi", async (long id, DocumentService docs, TransformationService s, CancellationToken ct) =>
    await s.Suivi(await docs.Charger(id, ct), ct));
api.MapPost("/lignes/{ligId:long}/soldes", async (long ligId, DemandeSolde d, HttpContext http, TransformationService s, CancellationToken ct) =>
{
    await s.Solder(ligId, d, Utilisateur.Depuis(http), ct);
    return Results.NoContent();
});
api.MapGet("/documents/{id:long}/lot-archivage", (long id, TransformationService s, CancellationToken ct) => s.LotArchivage(id, ct));

// Calcul serveur sans enregistrement et arbitrage des écarts
api.MapPost("/calcul", (EnregistrementDocument d, DocumentService s, CancellationToken ct) => s.Recalculer(d, ct));
api.MapPost("/cas-test", async (ArbitrageEcarts a, HttpContext http, DocumentService s, CancellationToken ct) =>
    Results.Ok(new { cas_id = await s.EnregistrerCasTest(a, Utilisateur.Depuis(http), ct) }));
api.MapGet("/cas-test/{id:long}/export", (long id, DocumentService s, CancellationToken ct) => s.ExporterCasTest(id, ct));

app.Run();
