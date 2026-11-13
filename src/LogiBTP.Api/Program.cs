using System.Text.Json.Serialization;
using LogiBTP.Annuaire.Web;
using LogiBTP.Authentification.Web;
using LogiBTP.Api;
using LogiBTP.Api.Btp;
using LogiBTP.Bibliotheque.Web;
using LogiBTP.Calendrier.Web;
using LogiBTP.Crm.Web;
using LogiBTP.Documents.Web;
using LogiBTP.Editions.Web;
using LogiBTP.EntreprisesFr.Web;
using LogiBTP.Personnalisation.Web;
using LogiBTP.Execution.Web;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Rentabilite.Web;
using LogiBTP.SousTraitance.Web;
using LogiBTP.Sav.Web;
using LogiBTP.Stock.Web;
using LogiBTP.Comptabilite.Web;
using LogiBTP.Pointage.Web;
using LogiBTP.Planning.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle.Donnees;
using LogiBTP.Droits.Web;
using LogiBTP.Fiches.Web;
using LogiBTP.Installation.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Listes.Web;
using LogiBTP.Notifications.Web;
using LogiBTP.OAuth.Web;
using LogiBTP.Mail.Web;
using LogiBTP.Reglements.Web;
using LogiBTP.Relances.Web;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

// Dossier de la configuration de l'installation (.env, societes.json) : LOGIBTP_CONFIG (/app/config dans l'image Docker),
// sinon le dossier courant ou celui de l'application et ses parents (développement).
var dossierConfig = Environment.GetEnvironmentVariable(VariablesEnv.Config);
// Commande du fichier .env (env initialiser | chiffrer | verifier) : sans démarrer l'application.
if (args.Length > 0 && args[0] == "env")
{
    Environment.ExitCode = CommandeEnv.Executer(args[1..], dossierConfig ?? Directory.GetCurrentDirectory(), Console.Out);
    return;
}
// Commandes de l'installeur (installation preparer | base creer | societe ajouter | scripts verifier | conversions…) :
// ANALYSE-MODULE-INSTALLATION.md § 6.
if (args.Length > 0 && args[0] == "installation")
{
    Environment.ExitCode = await CommandeInstallation.ExecuterAsync(args[1..], dossierConfig ?? Directory.GetCurrentDirectory(), Console.Out);
    return;
}
// Commande serveur de secours (comptes creer-admin | reinitialiser | deverrouiller | liste) : arguments retirés de la configuration.
var commande = args.Length > 0 && args[0] == "comptes" ? args[1..] : null;
var builder = WebApplication.CreateBuilder(commande is null ? args : []);
// Secrets de l'installation (.env hors du dépôt, valeurs sensibles chiffrées par la clé de construction des binaires) :
// chaîne de chiffrement des valeurs secrètes en base (mots de passe des fiches), réglages de sécurité.
// Sociétés déclarées par l'installeur (societes.json : domaines, codes et libellés) ; connexions déduites du modèle de
// l'installation (LOGIBTP_BASE_HOTE…) quand elles ne sont pas écrites.
builder.Configuration.AddJsonFile(Path.Combine(dossierConfig ?? builder.Environment.ContentRootPath, CommandeInstallation.FichierSocietes), optional: true);
builder.Configuration.AjouterFichierEnv(dossierConfig ?? builder.Environment.ContentRootPath, cleEnv: CleConstruction.Valeur);
builder.Configuration.AjouterConnexionsModele();
// HTTPS de l'installation : certificat du volume LOGIBTP_CERTIFICATS (Kestrel 8443, HTTP 8080 pour la redirection et
// l'amorçage du certificat), rechargé à chaud ; sans certificat, HTTP seul (développement).
builder.AddHttpsInstallation();
builder.Services.AddChiffrement(builder.Configuration);
// Sécurité web (§ 10) : déploiement, proxys déclarés, origines CORS, adresses de confiance, limites de débit.
var securite = OptionsSecurite.Lire(builder.Configuration);
builder.Services.AddSecurite(securite);
// Journal technique (niveau LOGIBTP_JOURNAL_NIVEAU, masqué) dans la base principale, repli sur fichier ; purge nocturne.
builder.Logging.AddProvider(new JournalTechnique(builder.Configuration.GetConnectionString("LogiBTP"),
    Path.Combine(builder.Environment.ContentRootPath, "journaux"), JournalTechnique.Niveau(builder.Configuration[VariablesEnv.JournalNiveau])));
builder.Services.AddHostedService<PurgeJournaux>();
builder.Services.AddHostedService<CopiesCertificatsLots>();
builder.Services.AddHostedService<PassageAnnuaireFe>();
// Facturation électronique, lot 24 : pièces validées à émettre (Btp/EnvoiFactureBtp.cs).
builder.Services.AddHostedService<PassageEnvoiFe>();

// Une base par société, choisie par le sous-domaine (section Societes ; sans sous-domaine : ConnectionStrings:LogiBTP).
builder.Services.AddSocietes(builder.Configuration);
// Les requêtes SQL brutes à une ligne (SqlQuery(...).FirstAsync()) sont voulues : l'avertissement EF « First sans OrderBy » n'y apporte rien.
// Connexion unique et unité d'écriture par requête (socle Donnees) : tous les contextes écrivent dans la même transaction.
builder.Services.AddUniteEcriture();
void Base(IServiceProvider sp, DbContextOptionsBuilder o) => o.ConfigurerBase(sp).UseSnakeCaseNamingConvention()
    .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.CoreEventId.RowLimitingOperationWithoutOrderByWarning));
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
// « Ne plus utiliser » : le cœur spécialise les points d'accroche FiltreChoix (dernier enregistrement retenu).
builder.Services.AddScoped<ServiceAnnuaire, ServiceAnnuaireBtp>();
builder.Services.AddScoped<ServiceBibliotheque, ServiceBibliothequeBtp>();
// Module Règlements (facultatif) : règlements, cautions, pointage des échéances des pièces (modules/reglement/db/080, db/175).
builder.Services.AddModuleReglement<SpecialisationReglementBtp>(Base);
// Module Relances (facultatif) : règle des niveaux, journal, suspensions, lots validés (modules/relance/db/099t, db/283) ;
// pièces en attente, tiers payeur, chargé et portée par Btp/SpecialisationRelanceBtp.cs.
builder.Services.AddModuleRelance<SpecialisationRelanceBtp>(Base);
// Module Facturation électronique (facultatif, désactivé à la création : db/295) : file des flux, relève par base, journal
// chaîné, plateforme simulée et dépôt manuel tenus en base (modules/facture-electronique/db/099f) ; jeton de la plateforme
// par IFournisseurJeton (module OAuth) ; GED, signaux et activation par Btp/FactureElectroniqueBtp.cs.
builder.Services.AddModuleFactureElectronique<SpecialisationFactureElectroniqueBtp>(Base, builder.Configuration);
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
// Module Droits : profils et arbre des droits (modules/droits/db/009, db/221) ; chaque route /api est rattachée à un nœud
// (SpecialisationDroitsBtp.Routes), une route non déclarée est refusée.
builder.Services.AddModuleDroits<SpecialisationDroitsBtp>(Base);
// Module Exécution (facultatif) : parcours, états des services, synthèse par chantier (modules/execution/db/085, db/197-198).
builder.Services.AddModuleExecution<SpecialisationExecutionBtp>(Base);
// Module Rentabilité (facultatif) : faits versionnés par chantier, file de recalcul et recalcul de nuit avec comparaison
// (modules/rentabilite/db/099r, db/258) ; règles des pièces BTP dans Btp/RentabiliteBtp.cs.
builder.Services.AddModuleRentabilite<SpecialisationRentabiliteBtp>(Base, builder.Configuration.GetSection("Rentabilite"));
// Module Sous-traitance (facultatif) : pièces exigées et conformité (modules/sous-traitance/db/092, db/210-212).
builder.Services.AddModuleSousTraitance<SpecialisationSousTraitanceBtp>(Base);
// Module Comptabilité (base) : plan comptable, collectifs, comptes des tiers, TVA (modules/comptabilite/db/094, db/223).
builder.Services.AddModuleComptabilite<SpecialisationComptabiliteBtp>(Base);
// Module Stock (facultatif) : mouvements, stock à une date-heure, valorisation, emplacements (modules/stock/db/093, db/216).
builder.Services.AddModuleStock<SpecialisationStockBtp>(Base);
// Module SAV (facultatif) : équipements installés chez les clients, nés des numéros de série sortis du stock (modules/sav/db/093s, db/273).
builder.Services.AddModuleSav<SpecialisationSavBtp>(Base);
// Module Pointage (facultatif) : saisie des heures de main-d'œuvre par chantier (modules/pointage/db/086, db/199).
builder.Services.AddModulePointage<SpecialisationPointageBtp>(Base);
// Géocodage des adresses (restaurants proches du chantier, lot 10, A29) : API Adresse, section Geocodage.
builder.Services.AddHttpClient<Geocodage>(c =>
{
    c.Timeout = TimeSpan.FromSeconds(5);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("LogiBTP/0.1");
});
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
builder.Services.AddSourceNotifications<SourceEntretiens>();
builder.Services.AddSourceNotifications<SourceEtapesExecution>();
builder.Services.AddSourceNotifications<SourcePiecesSousTraitance>();
builder.Services.AddSourceNotifications<SourceStockBtp>();
builder.Services.AddSourceNotifications<SourcePaiementsDirects>();
builder.Services.AddSourceNotifications<SourceCertificat>();
builder.Services.AddSourceNotifications<SourceRelancesAPreparer>();
builder.Services.AddCanalNotifications<CanalCourrielBtp>();
// Module OAuth : connexions sortantes OAuth 2.0 (jetons chiffrés, renouvellement, rappels d'échéance ; modules/oauth/db/004) ;
// fournisseur de jetons du socle (IFournisseurJeton) pour le module Mail ; retour des fournisseurs en route publique.
builder.Services.AddModuleOAuth<SpecialisationOAuthBtp>(Base, builder.Configuration.GetSection("OAuth"));
ServiceNotification.TypesDirects.AddRange(SpecialisationOAuthBtp.Types);
// Module Mail : comptes de messagerie système chiffrés (alias), envoi par file d'attente avec limitations et journal
// (modules/mail/db/007, db/206) ; jetons OAuth 2.0 par IFournisseurJeton (module OAuth).
builder.Services.AddModuleMail<SpecialisationMailBtp>(Base, builder.Configuration.GetSection("Mail"));
ServiceNotification.TypesDirects.AddRange(SpecialisationMailBtp.Types);
ServiceNotification.TypesDirects.AddRange(SpecialisationAuthentificationBtp.Types);
ServiceNotification.TypesDirects.AddRange(SpecialisationFactureElectroniqueBtp.Types);
ServiceNotification.TypesDirects.Add(new("ressources", "MATERIEL_RETOUR", "Matériel rendu endommagé ou hors service"));
builder.Services.PostConfigure<OptionsAuthentification>(o =>
{
    o.RoutesPubliques.AddRange(["/api/sante", "/api/societe", "/api/pointage/borne", LogiBTP.OAuth.Web.Extensions.RouteRetour]);
    o.AdressesConfiance.AddRange(securite.AdressesConfiance);
});

var app = builder.Build();
SpecialisationBtp.Http = app.Services.GetRequiredService<IHttpContextAccessor>();
if (commande is not null)
{
    Environment.ExitCode = await CommandeComptes.ExecuterAsync(commande, app.Services, Console.Out);
    return;
}

// Métrés saisis en lignes : convertis en scripts au démarrage en développement (compte propriétaire des bases) ; une
// installation les convertit sous le rôle de schéma (« installation conversions », mise à jour).
if (app.Environment.IsDevelopment()) await ConversionMetresBases.ConvertirAsync(app.Services, app.Logger);

app.UseSecurite();
app.UseHttpsInstallation();
// Textes, thème et images du client (module Personnalisation) avec la surcharge de l'installation, puis client web
// construit (wwwroot de l'image Docker) : fichiers statiques et CSP bloquante ; en développement, Vite sert les deux.
app.UsePersonnalisation();
app.UseClientWeb();
app.UseErreursMetier();
// Refus de la base traduits (DOUBLON, UTILISE, VALEUR), puis effets après validation lancés en fin de requête.
app.UseErreursBase();
app.UseUniteEcriture();
app.UseSocietes();
app.UseAuthentificationSession();
app.UseDroits();

var api = app.MapGroup("/api");
api.MapGet("/sante", (SpecialisationBtp s) => Results.Ok(new { statut = "ok", version_moteur = s.VersionMoteur }));
// Société de la requête (bandeau du client) ; jamais la chaîne de connexion.
api.MapGet("/societe", (SocieteCourante s) => Results.Ok(new { code = s.Code, libelle = s.Libelle, principale = s.Principale }));
api.MapModuleAuthentification();
api.MapModuleDroits();
api.MapModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>();
api.MapModuleListe();
api.MapModuleFiche();
api.MapModuleGed();
api.MapModuleBibliotheque();
api.MapModuleAnnuaire();
api.MapModuleEntreprisesFr();
// Modules facultatifs : sous-groupe propre, pour que le filtre d'activation ne touche que leurs routes.
api.MapGroup("").ExigeModule(ModulesFacultatifs.Reglement, "Règlements").MapModuleReglement();
api.MapGroup("").ExigeModule(ModulesFacultatifs.Relance, "Relances").DroitsRelances().MapModuleRelance().MapLibellesRelances();
api.MapGroup("").ExigeModule(ModulesFacultatifs.FactureElectronique, "Facturation électronique").MapModuleFactureElectronique().MapReceptionHorsPlateforme().MapAnnuaireFe().MapEmissionFe().MapEnvoiFe().MapRejetFe().MapEncaisseeFe().MapEreportingFe();
api.MapModuleCrm().ExigeModule(ModulesFacultatifs.Crm, "CRM");
api.MapExecution().ExigeModule(ModulesFacultatifs.Execution, "Exécution");
api.MapModuleExecution().ExigeModule(ModulesFacultatifs.Execution, "Exécution");
api.MapModuleSousTraitance().ExigeModule(ModulesFacultatifs.SousTraitance, "Sous-traitance");
api.MapModuleStock().ExigeModule(ModulesFacultatifs.Stock, "Stock");
api.MapModuleSav().ExigeModule(ModulesFacultatifs.Sav, "SAV");
api.MapInterventionsEquipement().ExigeModule(ModulesFacultatifs.Sav, "SAV");
api.MapGroup("").ExigeModule(ModulesFacultatifs.Stock, "Stock").MapMagasinStock();
api.MapGroup("").ExigeModule(ModulesFacultatifs.Stock, "Stock").MapStockBorne();
api.MapGroup("").ExigeModule(ModulesFacultatifs.Stock, "Stock").MapDotationFiche();
api.MapGroup("").ExigeModule(ModulesFacultatifs.Stock, "Stock").MapLotsStock();
api.MapGroup("").ExigeModule(ModulesFacultatifs.Stock, "Stock").MapClotureStock();
api.MapModulePointage().ExigeModule(ModulesFacultatifs.Pointage, "Pointage MO");
api.MapModulePlanning().ExigeModule(ModulesFacultatifs.Planning, "Planning");
api.MapModuleRentabilite().ExigeModule(ModulesFacultatifs.Rentabilite, "Rentabilité");
api.MapGroup("").ExigeModule(ModulesFacultatifs.Rentabilite, "Rentabilité").MapParametresRentabilite();
api.MapDiffusion();
// Liaisons croisées entre modules facultatifs (Exécution, Planning, Pointage, CRM) : portées par le cœur.
api.MapLiaisons();
// Étapes validées depuis l'atelier (page tablette, borne du Pointage) : lot 2e de l'Exécution.
api.MapAtelier().ExigeModule(ModulesFacultatifs.Execution, "Exécution");
// Application de terrain (ANALYSE-TERRAIN.md) : tâches du planning de la personne connectée, partie mobile, pièces « Terrain ».
api.MapGroup("").ExigeModule(ModulesFacultatifs.Planning, "Planning").MapTerrain();
api.MapStructure();
api.MapConsultations();
api.MapRetenuesMarche();
api.MapSousTraitanceAssistant();
api.MapIndividusStructure();
api.MapComptes();
// Préférences du compte connecté qui le suivent d'un poste à l'autre (accueil : raccourcis et widgets).
api.MapPreferencesCompte();
api.MapGroup("").MapModuleComptabilite();
api.MapModulesServices();
api.MapListesValeurs();
api.MapRessources();
api.MapAffectationsMateriel();
api.MapCoutsMateriel();
api.MapCompteursMateriel();
api.MapCompteursBorne();
api.MapEntretiensMateriel();
api.MapPlansEntretien();
api.MapReglementsStructure();
api.MapUtilisationsElement();
api.MapEquipes();
api.MapModuleCalendrier();
api.MapModuleNotifications();
// État de l'installation (certificat, bases, sauvegarde, disques) : page /parametres/installation.
api.MapModuleInstallation();
api.MapModuleOAuth();
api.MapModuleMail();
api.MapCalendriersBtp();
api.MapModuleEdition();
api.MapEditionsBtp();

// Page d'amorçage du certificat (publique, HTTP et HTTPS) : autorité, script des postes, profil iPad.
app.MapAmorcage();
// Routes du client (toute adresse hors /api → index.html), en dernier recours.
app.MapClientWeb();

// Refus par défaut : toute route /api doit être rattachée à un nœud de droits (erreur au démarrage en développement).
app.VerifierRoutesDroits();
// Format d'échange et de contrôle : toute route d'écriture déclare son type (EcrituresBtp.Routes).
app.VerifierRoutesEcriture(EcrituresBtp.Routes);

app.Run();
