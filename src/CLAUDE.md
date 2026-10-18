# Serveur LogiBTP (cœur .NET)

## Rôle
- API ASP.NET Core du cœur : branche les modules (Document, Métré, Liste, Fiche, GED, Bibliothèque, Annuaire, Entreprises françaises) et les spécialise pour le BTP. Les modules ne dépendent jamais de `src/`.
- Trois projets : `LogiBTP.Domaine` (entités BTP), `LogiBTP.Calcul` (moteur de devis BTP), `LogiBTP.Api` (hôte, spécialisations, routes propres au cœur). Tests : `tests/LogiBTP.Calcul.Tests`.

## Structure
- `LogiBTP.Api/Program.cs` (branchement, dans cet ordre) :
  - `AddSocietes` / `UseSocietes` : une base par société, choisie par le sous-domaine (en-tête Host) ; contextes EF sur `SocieteCourante.Connexion` + `UseSnakeCaseNamingConvention` (fonction locale `Base`).
  - JSON : `SnakeCaseLower`, `JsonNumberHandling.AllowReadingFromString` (mêmes conventions que les jeux de test).
  - `AddModuleDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp, LogiBtpContext, SpecialisationBtp>`.
  - `AddModuleListe<SpecialisationListeBtp>`, `AddModuleFiche<SpecialisationFicheBtp>`, `AddModuleGed<SpecialisationGedBtp>`, `AddModuleBibliotheque<SpecialisationBibliothequeBtp>`, `AddModuleAnnuaire`, `AddModuleReglement<SpecialisationReglementBtp>` (facultatif), `AddModuleEntreprisesFr`.
  - `ConversionMetresBases.ConvertirAsync` (métrés en lignes → scripts), CORS `http://localhost:5173`, `UseErreursMetier` ; groupe `/api` : `MapModuleDocument<…>`, `MapModuleListe`, `MapModuleFiche`, `MapModuleGed`, `MapModuleBibliotheque`, `MapModuleAnnuaire`, `MapModuleEntreprisesFr`, `MapStructure`, `MapComptes`.
- `LogiBTP.Api.csproj` : références aux projets `*.Web` des modules + `LogiBTP.Calcul` ; paquets `Npgsql.EntityFrameworkCore.PostgreSQL`, `EFCore.NamingConventions`.
- `appsettings.json` : `ConnectionStrings:LogiBTP` (base `logibtp`, port 5433), `Societes` (`Domaines`, `Liste.demo` → base `logibtp_demo`), `Ged:Repertoire` (`stockage-ged`, un répertoire par société nommé comme sa base : `logibtp`, `logibtp_demo`), `Ged:TailleMaxDepotMo`. `Properties/launchSettings.json` : profil `http` sur `http://localhost:5080`.
- `Btp/SpecialisationBtp.cs` : `DocumentCompletBtp` (+ `Metres`, `Variables`, `Ventilations` / `VentilationsLignes` des frais annexes : `EcrireVentilations`, `PreparerValidation` et `FiltrerComplements` figent la ventilation, `FigerVentilation`) et `SpecialisationBtp : SpecialisationDocument` (`Calculer` → `MoteurDevisBtp`, `Comparateur` = `ComparateurBtp`, `ControlerValidation` NATURE_OBLIGATOIRE, `ControlerValidationAsync` : MARCHE_OBLIGATOIRE, AVANCEMENT_NON_NUMEROTE (facture d'avancement créée avant, dans le même marché, sans numéro ; factures à 0 ignorées), marché public, frais annexes, `CopierEnteteSaisie` (mode, bibliothèque, rattachement, `EntIntervenants`, rédacteur), `ChargerComplements` / `EcrireComplements` (métrés, variables), `RenumeroterComplements`, `FiltrerComplements`, `EstLigneCalculee` (écart d'arrondi), `AjusterLigneTransformee`).
- `Btp/LogiBtpContext.cs` : `LogiBtpContext : DocumentDbContext<DocumentBtp, DocumentLigneBtp>` + `Metres`, `Variables` (tables `metre`, `variable_definition`).
- `Btp/ConversionMetresBases.cs` : au démarrage (`Program.cs`), chaque base (principale et sociétés) qui a encore `metre_ligne` voit ses métrés et compositions convertis en scripts, puis la table supprimée (une transaction par base).
- `Btp/SpecialisationsElements.cs` : `SpecialisationFicheBtp` (fiches `salarie`, `materiel`, `element`, `personne`, `individu`, `projet|affaire|chantier|marche` ; `ValiderMetier`, `AvantEcritureAsync`, champs gérés `Lire/Valider/EcrireGeresAsync`, `AvantSuppressionAsync` → `SuppressionFiches.Controler` : 409 `FICHE_UTILISEE` pour les usages sans clé étrangère — tiers d'un document, intervenant, poste de marché, règlement, caution, élément d'une ligne ou d'une composition — et `FICHE_PROTEGEE` pour notre société et un individu titulaire d'un compte), `SpecialisationListeBtp` (saisie refusée si la fiche `salarie`/`materiel` est verrouillée), `SpecialisationGedBtp` (`RepertoireStockage`, `TailleMaxDepot`).
- `Btp/SpecialisationAnnuaireBtp.cs` : `ReporterFusionAsync` (fusion d'un tiers provisoire) : documents (`ent_tiers_id`, `ent_intervenants`, `per_id` des coordonnées figées), intervenants, tiers des projets / affaires / chantiers / marchés, postes de marché, tarifs, règlements et cautions (si le module est là), GED (répertoires racines renommés « (fusion) » en cas de doublon de nom, puis niveau par niveau, documents, archives, statistiques), verrou de la fiche. Branché par `AddModuleAnnuaire<SpecialisationAnnuaireBtp>`.
- `Btp/SpecialisationBibliothequeBtp.cs` : `RecalculerOuvrage` → `ElementsBibliotheque.RecalculerOuvrage`.
- `Btp/ElementsBibliotheque.cs` : `CompositionOuvrage`, `CalculerOuvrage` / `CalculerEnsemble` par le moteur de devis, `AvantEcriture` (prix recalculés avant écriture d'une fiche `element`).
- `Btp/Comptes.cs` : `MapComptes` (`GET /api/comptes-comptables` : plan de comptes minimal de `db/166`).
- `Btp/Structure.cs` : `MapStructure` (routes ci-dessous), `PerimetreStructure`, `RattachementDocument`.
- `Btp/PostesMarche.cs` : postes de pied du marché (`Lire`, `Enregistrer`, `Portee`, `Appliquer` : lignes système `lig_proprietes.poste_marche`, retenue de garantie de `mar_retenue_pct`) ; appelé par `SpecialisationBtp.CompleterValidationAsync` et la création d'un document depuis le marché. `SpecialisationBtp.ReglementTiersAsync` : délai et mode de règlement du tiers (échéancier).
- `Btp/SpecialisationReglementBtp.cs` : échéances des pièces validées non annulées (`document_echeance`, sens E ventes / D achats, objet = marché) et tiers pour le module Règlements.
- `Btp/AdressesDocument.cs` : adresse des travaux ou de livraison (`Chantier`, `Personne`, `Proposees` : chantier, dépôts, comptoirs ; `MemeAdresse`, `AdresseIdentiqueAuClient`, `PayeurIdentiqueAuClient` ↔ `client/src/app/structure/adresses.js` ; `ViderIdentiques` (ventes, appelé par `SpecialisationBtp.CopierEnteteSaisie(cible, saisie, type)`), `Completer` (validation : chantier si vide)) ; route `GET /api/structure/adresses-livraison?chantier=&fournisseur=`.
- `Btp/ContactsDocument.cs` : coordonnées figées du client (ou fournisseur) et du payeur (`Instantane` : annuaire → JSON ; `Source` : intervenant du rôle ; `Completer` : à la validation si vides) ; route `GET /api/structure/contact?per_id=&ind_id=`.
- `Btp/Acomptes.cs` : acomptes des marchés (`Mode` / `EnregistrerMode`, `Lire`, `Creer` : demande d'acompte, `Emettre` : facture ou reçu, `Montant` : règle de déduction, `Appliquer` : lignes système « A<mac_id> » des factures d'avancement, `Ecrire` : `acompte_deduction`).
- `Btp/Intervenants.cs` : `FonctionIntervenant`, `IntervenantSaisi`, `Intervenants` (`Colonnes` projet→`itv_prj_id`…, `Gere`, `Fonctions`, `Lire`, `Lus`, `Controler`, `Valider`, `Ecrire`).
- `Btp/SalariesAnnuaire.cs` : `Salarie` (champ géré `salarie` de la fiche individu), `Synchroniser` (individu repris de la fiche salarié : identité, rôle, rattachement à l'agence).
- `LogiBTP.Calcul/MoteurDevisBtp.cs` : `MoteurDevisBtp : MoteurDocument<DocumentBtp, DocumentLigneBtp>`, `Calculer(EntreeCalcul)`. `Modeles.cs` : `EntreeCalcul` (+ `Ventilations`), `ResultatCalcul` (+ `LignesSupprimees`, `Scripts` : `DiagnosticScript` par métré en script, `VentilationsLignes`, `FraisAnnexes` : `BilanFraisAnnexes`) ; `LogiBTP.Domaine/VentilationFrais.cs` (`VentilationFrais`, `VentilationFraisLigne`, tables de `db/167`), `ComparateurBtp` (ligne d'écart appariée `ecart:<parent>`).
- `LogiBTP.Domaine/DocumentBtp.cs` : `EntModeCalculOuvrage` (D/V/B bordereau), `EntCoefFa` (moyenne), `EntFaLignes`, `EntFaMode`, `EntBibId`, `EntProjetId`, `EntAffaireId`, `EntChantierId`, `EntMarcheId`, `EntIntervenants` (`JsonDocument`), `EntRedacteurId`. `DocumentLigneBtp.cs` : nature, poste, métré, quantités, PA/FG/PR/bénéfice/FA/prorata, PV affiché et blocages, écart d'arrondi, `LigPiedIsFa`, données techniques `LigPoids`… `LigLongueur` (mètres, db/165).

## Routes propres au cœur
- `GET /api/sante` (version du moteur), `GET /api/societe` (code, libellé, principale ; jamais la connexion).
- `GET /api/comptes-comptables` ([{ code, libelle, actif }]).
- `GET /api/structure/referentiels` (affaires, projets, chantiers, marchés, commandes `V_COMMANDE`, fonctions).
- `PUT /api/structure/documents/{id}/rattachement` (même validé ; marché → chantier → affaire et projet complétés).
- `GET|PUT /api/structure/marches/{id}/postes` (postes de pied du marché) ; acomptes : `GET|PUT /api/structure/acomptes/mode`, `GET|POST /api/structure/marches/{id}/acomptes`, `POST /api/structure/acomptes/{id}/emettre`.
- `GET /api/structure/intervenants/{type}/{id}` ; `POST /api/structure/documents` (documents du périmètre + liens `document_lien`, groupe d'indices `groupe_id`, `reference`) ; `GET /api/structure/documents/{id}/descendants` (le document et ses enfants par `document_lien`, à toute profondeur : arborescence de la GED).
- Le reste (`/documents`, `/fiches`, `/listes`, `/ged`, `/bibliotheque`, `/annuaire`…) vient des `MapModule…()` des modules.

## Spécialisation des modules
- Document + Métré : `SpecialisationBtp`, `LogiBtpContext`, `DocumentBtp`, `DocumentLigneBtp`, `MoteurDevisBtp`, `ComparateurBtp`.
- Liste : `SpecialisationListeBtp`. Fiche : `SpecialisationFicheBtp` (+ `Intervenants`, `SalariesAnnuaire`, `ElementsBibliotheque`). GED : `SpecialisationGedBtp`.
- Bibliothèque : `SpecialisationBibliothequeBtp`, `ElementsBibliotheque`. Annuaire : `ServiceAnnuaire` appelé par `SpecialisationFicheBtp` (`ControlerPersonne`, `Identifiants.Compacter`, champs gérés).

## Conventions et pièges
- Toute règle de `MoteurDevisBtp.cs` se reporte dans `client/src/calcul/moteur-btp.js` (cas dans `tests/cas/*.json`) ; propriétés de `DocumentBtp` / `DocumentLigneBtp` alignées sur `client/src/calcul/colonnes-btp.js` (test `Colonnes_btp_alignees_avec_le_moteur_js`).
- Répliques JS : `ControlerValidation` ↔ `controlesValidation` ; `Intervenants.Controler` ↔ `controlerIntervenants` ; `SalariesAnnuaire.Synchroniser` ↔ `synchroniserSalarie` ; `ValiderMetier` ↔ `fiches.js` / `fiche-annuaire.js`.
- Pas de migrations EF : nouvelle colonne = `ALTER TABLE` dans `db/` + propriété PascalCase (mappée en snake_case).
- SQL brut paramétré uniquement ; noms de colonnes jamais saisis (`Intervenants.Colonnes` est une liste fermée). Cache singleton dépendant du schéma : indexé par base.
- `TIERS_OBLIGATOIRE` et la plupart des contrôles de validation sont dans le module Document (`DocumentService`), pas ici.

## Commandes
- Arrêter l'API avant `dotnet build LogiBTP.slnx` (binaires verrouillés). Lancement : `dotnet run --no-build --project src\LogiBTP.Api --launch-profile http` (5080) ; Vite (5173) proxifie `/api` ; société « demo » par http://demo.localhost:5173.
- `dotnet test LogiBTP.slnx` ; parité complète : `npm run exporter-resultats` puis `dotnet test LogiBTP.slnx` (`Parite_avec_le_moteur_js` lit `tests/resultats-js`).
- `tests/LogiBTP.Calcul.Tests/CasPartagesTests.cs` : `Cas_partage`, `Stabilite_recalculer_le_resultat_ne_change_rien`, `Parite_avec_le_moteur_js` (jeux `tests/cas/*.json`, aussi rejoués par `client/test/cas-partages.test.js`), `Colonnes_btp_alignees_avec_le_moteur_js`.
- Tests d'intégration PostgreSQL (module Liste) : variable `LOGIBTP_TEST_PG` = `Host=localhost;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp`.
