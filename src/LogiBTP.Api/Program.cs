using System.Text.Json.Serialization;
using LogiBTP.Annuaire.Web;
using LogiBTP.Api.Btp;
using LogiBTP.Bibliotheque.Web;
using LogiBTP.Documents.Web;
using LogiBTP.EntreprisesFr.Web;
using LogiBTP.Domaine;
using LogiBTP.Fiches.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Listes.Web;
using LogiBTP.Reglements.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
// Secrets de l'installation (.env hors du dépôt) : chaîne de chiffrement des valeurs secrètes (mots de passe des fiches).
builder.Configuration.AjouterFichierEnv(builder.Environment.ContentRootPath);
builder.Services.AddChiffrement(builder.Configuration);

// Une base par société, choisie par le sous-domaine (section Societes ; sans sous-domaine : ConnectionStrings:LogiBTP).
builder.Services.AddSocietes(builder.Configuration);
void Base(IServiceProvider sp, DbContextOptionsBuilder o) => o.UseNpgsql(sp.GetRequiredService<SocieteCourante>().Connexion).UseSnakeCaseNamingConvention();
builder.Services.AddDbContext<LogiBtpContext>(Base);

builder.Services.ConfigureHttpJsonOptions(o =>
{
    // Mêmes conventions que les jeux de test : noms de colonnes snake_case, décimaux acceptés en chaîne.
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.SnakeCaseLower;
    o.SerializerOptions.NumberHandling = JsonNumberHandling.AllowReadingFromString;
});

// Module Document spécialisé par le cœur BTP (moteur de devis, métrés, variables).
builder.Services.AddModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp, LogiBtpContext, SpecialisationBtp>();
// Module Liste : vues de liste paramétrables sur les sources déclarées par le cœur (db/120, 121).
builder.Services.AddModuleListe<SpecialisationListeBtp>(Base);
// Module Fiche : fiches salarié et matériel (db/130, 131), règles métier du cœur.
builder.Services.AddModuleFiche<SpecialisationFicheBtp>(Base);
// Module GED : documents stockés sur le serveur (Ged:Repertoire), versions, coffre-fort (modules/ged/db/050).
builder.Services.AddModuleGed<SpecialisationGedBtp>(Base);
// Archivage automatique de la GED chaque nuit, pour chaque base de société (Ged:Archivage, désactivable).
builder.Services.AddArchivageGed(builder.Configuration.GetSection("Ged:Archivage"));
// Module Bibliothèque : bibliothèques, familles, natures, tarifs fournisseurs, historique des prix (modules/bibliotheque/db/060).
builder.Services.AddModuleBibliotheque<SpecialisationBibliothequeBtp>(Base);
// Module Annuaire : personnes, individus, rattachements, liens, coordonnées partagées (modules/annuaire/db/070) ;
// fiches personne et individu par le module Fiche (champs gérés délégués à ServiceAnnuaire).
builder.Services.AddModuleAnnuaire<SpecialisationAnnuaireBtp>(Base);
// Module Règlements (facultatif) : règlements, cautions, pointage des échéances des pièces (modules/reglement/db/080, db/175).
builder.Services.AddModuleReglement<SpecialisationReglementBtp>(Base);
// Module Entreprises françaises : recherche dans l'annuaire des entreprises de l'État (API publique, sans clé).
builder.Services.AddModuleEntreprisesFr();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// Métrés saisis en lignes : convertis en scripts au démarrage, dans chaque base qui a encore la table metre_ligne.
await ConversionMetresBases.ConvertirAsync(app.Services, app.Logger);

app.UseCors();
app.UseErreursMetier();
app.UseSocietes();

var api = app.MapGroup("/api");
api.MapGet("/sante", (SpecialisationBtp s) => Results.Ok(new { statut = "ok", version_moteur = s.VersionMoteur }));
// Société de la requête (bandeau du client) ; jamais la chaîne de connexion.
api.MapGet("/societe", (SocieteCourante s) => Results.Ok(new { code = s.Code, libelle = s.Libelle, principale = s.Principale }));
api.MapModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>();
api.MapModuleListe();
api.MapModuleFiche();
api.MapModuleGed();
api.MapModuleBibliotheque();
api.MapModuleAnnuaire();
api.MapModuleEntreprisesFr();
api.MapModuleReglement();
api.MapStructure();
api.MapComptes();

app.Run();
