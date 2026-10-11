using System.Text.Json.Serialization;
using LogiBTP.Api.Btp;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Fiches.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Listes.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var connexion = builder.Configuration.GetConnectionString("LogiBTP");
builder.Services.AddDbContext<LogiBtpContext>(o => o.UseNpgsql(connexion).UseSnakeCaseNamingConvention());

builder.Services.ConfigureHttpJsonOptions(o =>
{
    // Mêmes conventions que les jeux de test : noms de colonnes snake_case, décimaux acceptés en chaîne.
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.SnakeCaseLower;
    o.SerializerOptions.NumberHandling = JsonNumberHandling.AllowReadingFromString;
});

// Module Document spécialisé par le cœur BTP (moteur de devis, métrés, variables).
builder.Services.AddModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp, LogiBtpContext, SpecialisationBtp>();
// Module Liste : vues de liste paramétrables sur les sources déclarées par le cœur (db/120, 121).
builder.Services.AddModuleListe<SpecialisationListeBtp>(o => o.UseNpgsql(connexion).UseSnakeCaseNamingConvention());
// Module Fiche : fiches salarié et matériel (db/130, 131), règles métier du cœur.
builder.Services.AddModuleFiche<SpecialisationFicheBtp>(o => o.UseNpgsql(connexion).UseSnakeCaseNamingConvention());
// Module GED : documents stockés sur le serveur (Ged:Repertoire), versions, coffre-fort (modules/ged/db/050).
builder.Services.AddModuleGed<SpecialisationGedBtp>(o => o.UseNpgsql(connexion).UseSnakeCaseNamingConvention());
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseCors();
app.UseErreursMetier();

var api = app.MapGroup("/api");
api.MapGet("/sante", (SpecialisationBtp s) => Results.Ok(new { statut = "ok", version_moteur = s.VersionMoteur }));
api.MapModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>();
api.MapModuleListe();
api.MapModuleFiche();
api.MapModuleGed();

app.Run();
