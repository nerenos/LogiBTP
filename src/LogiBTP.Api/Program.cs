using System.Text.Json.Serialization;
using LogiBTP.Annuaire.Web;
using LogiBTP.Authentification.Web;
using LogiBTP.Api.Btp;
using LogiBTP.Bibliotheque.Web;
using LogiBTP.Calendrier.Web;
using LogiBTP.Crm.Web;
using LogiBTP.Documents.Web;
using LogiBTP.Editions.Web;
using LogiBTP.EntreprisesFr.Web;
using LogiBTP.Execution.Web;
using LogiBTP.SousTraitance.Web;
using LogiBTP.Pointage.Web;
using LogiBTP.Planning.Web;
using LogiBTP.Domaine;
using LogiBTP.Fiches.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Listes.Web;
using LogiBTP.Notifications.Web;
using LogiBTP.OAuth.Web;
using LogiBTP.Mail.Web;
using LogiBTP.Reglements.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

// Commande serveur de secours (comptes creer-admin | reinitialiser | deverrouiller | liste) : arguments retirés de la configuration.
var commande = args.Length > 0 && args[0] == "comptes" ? args[1..] : null;
var builder = WebApplication.CreateBuilder(commande is null ? args : []);
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
// Module CRM (facultatif) : notes, rappels, demandes, suivi des validations, diffusion, fil (modules/crm/db/095…).
builder.Services.AddModuleCrm<SpecialisationCrmBtp>(Base);
// Module Entreprises françaises : recherche dans l'annuaire des entreprises de l'État (API publique, sans clé).
builder.Services.AddModuleEntreprisesFr();
// Module Édition : modèles et chartes (modules/edition/db/090), aperçu (moteur JS du navigateur) et PDF (même moteur dans Jint).
builder.Services.AddModuleEdition<SpecialisationEditionBtp>(Base, builder.Configuration.GetValue("Edition:Moteurs", 2), builder.Configuration.GetSection("Edition:Production"));
// Modules activés par société (db/193, module_societe) : routes des modules facultatifs refusées s'ils sont désactivés.
builder.Services.AddScoped<ModulesSociete>();
builder.Services.AddScoped<IModulesActifs>(sp => sp.GetRequiredService<ModulesSociete>());
// Module Authentification : comptes liés aux salariés et intérimaires, session par cookie (modules/authentification/db/005) ;
// toutes les routes /api exigent une session, sauf la santé, la société et les routes publiques du module.
builder.Services.AddModuleAuthentification<SpecialisationAuthentificationBtp>(Base, builder.Configuration.GetSection("Authentification"));
// Module Exécution (facultatif) : parcours, états des services, synthèse par chantier (modules/execution/db/085, db/197-198).
builder.Services.AddModuleExecution<SpecialisationExecutionBtp>(Base);
// Module Sous-traitance (facultatif) : pièces exigées et conformité (modules/sous-traitance/db/092, db/210-212).
builder.Services.AddModuleSousTraitance<SpecialisationSousTraitanceBtp>(Base);
// Module Pointage (facultatif) : saisie des heures de main-d'œuvre par chantier (modules/pointage/db/086, db/199).
builder.Services.AddModulePointage<SpecialisationPointageBtp>(Base);
// Module Planning (facultatif) : tâches, affectations, calcul par les calendriers (modules/planning/db/089, db/201).
builder.Services.AddHttpContextAccessor();
// Diffusion en temps réel (socle) : planning, puis CRM, synthèse de l'exécution…
builder.Services.AddDiffusion();
builder.Services.AddModulePlanning<SpecialisationPlanningBtp>(Base);
// Module Calendrier : calendriers de travail, cycles, jours fériés et fermetures (modules/calendrier/db/006, db/196).
builder.Services.AddModuleCalendrier<SpecialisationCalendrierBtp>(Base);
// Module Notifications : boîte par utilisateur, préférences, planificateur de fond par base (modules/notification/db/008) ;
// sources du cœur : rappels du CRM, habilitations à renouveler.
builder.Services.AddModuleNotifications(Base, builder.Configuration.GetSection("Notifications"));
builder.Services.AddSourceNotifications<SourceRappelsCrm>();
builder.Services.AddSourceNotifications<SourceHabilitations>();
builder.Services.AddSourceNotifications<SourceEtapesExecution>();
builder.Services.AddSourceNotifications<SourcePiecesSousTraitance>();
builder.Services.AddSourceNotifications<SourcePaiementsDirects>();
builder.Services.AddCanalNotifications<CanalCourrielBtp>();
// Module OAuth : connexions sortantes OAuth 2.0 (jetons chiffrés, renouvellement, rappels d'échéance ; modules/oauth/db/004) ;
// fournisseur de jetons du socle (IFournisseurJeton) pour le module Mail ; retour des fournisseurs en route publique.
builder.Services.AddModuleOAuth<SpecialisationOAuthBtp>(Base, builder.Configuration.GetSection("OAuth"));
ServiceNotification.TypesDirects.AddRange(SpecialisationOAuthBtp.Types);
// Module Mail : comptes de messagerie système chiffrés (alias), envoi par file d'attente avec limitations et journal
// (modules/mail/db/007, db/206) ; jetons OAuth 2.0 par IFournisseurJeton (module OAuth).
builder.Services.AddModuleMail<SpecialisationMailBtp>(Base, builder.Configuration.GetSection("Mail"));
ServiceNotification.TypesDirects.AddRange(SpecialisationMailBtp.Types);
builder.Services.PostConfigure<OptionsAuthentification>(o => o.RoutesPubliques.AddRange(["/api/sante", "/api/societe", "/api/pointage/borne", LogiBTP.OAuth.Web.Extensions.RouteRetour]));
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
SpecialisationBtp.Http = app.Services.GetRequiredService<IHttpContextAccessor>();
if (commande is not null)
{
    Environment.ExitCode = await CommandeComptes.ExecuterAsync(commande, app.Services, Console.Out);
    return;
}

// Métrés saisis en lignes : convertis en scripts au démarrage, dans chaque base qui a encore la table metre_ligne.
await ConversionMetresBases.ConvertirAsync(app.Services, app.Logger);

app.UseCors();
app.UseErreursMetier();
app.UseSocietes();
app.UseAuthentificationSession();

var api = app.MapGroup("/api");
api.MapGet("/sante", (SpecialisationBtp s) => Results.Ok(new { statut = "ok", version_moteur = s.VersionMoteur }));
// Société de la requête (bandeau du client) ; jamais la chaîne de connexion.
api.MapGet("/societe", (SocieteCourante s) => Results.Ok(new { code = s.Code, libelle = s.Libelle, principale = s.Principale }));
api.MapModuleAuthentification();
api.MapModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>();
api.MapModuleListe();
api.MapModuleFiche();
api.MapModuleGed();
api.MapModuleBibliotheque();
api.MapModuleAnnuaire();
api.MapModuleEntreprisesFr();
// Modules facultatifs : sous-groupe propre, pour que le filtre d'activation ne touche que leurs routes.
api.MapGroup("").ExigeModule("reglement", "Règlements").MapModuleReglement();
api.MapModuleCrm().ExigeModule("crm", "CRM");
api.MapExecution().ExigeModule("execution", "Exécution");
api.MapModuleExecution().ExigeModule("execution", "Exécution");
api.MapModuleSousTraitance().ExigeModule("sous_traitance", "Sous-traitance");
api.MapModulePointage().ExigeModule("pointage", "Pointage MO");
api.MapModulePlanning().ExigeModule("planning", "Planning");
api.MapDiffusion();
// Liaisons croisées entre modules facultatifs (Exécution, Planning, Pointage, CRM) : portées par le cœur.
api.MapLiaisons();
// Étapes validées depuis l'atelier (page tablette, borne du Pointage) : lot 2e de l'Exécution.
api.MapAtelier().ExigeModule("execution", "Exécution");
api.MapStructure();
api.MapConsultations();
api.MapRetenuesMarche();
api.MapSousTraitanceAssistant();
api.MapIndividusStructure();
api.MapComptes();
api.MapModulesServices();
api.MapRessources();
api.MapEquipes();
api.MapModuleCalendrier();
api.MapModuleNotifications();
api.MapModuleOAuth();
api.MapModuleMail();
api.MapCalendriersBtp();
api.MapModuleEdition();
api.MapEditionsBtp();

app.Run();
