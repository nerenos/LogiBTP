# Serveur LogiBTP (cœur .NET)

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [SRC.md](../documentation/modules/SRC.md).

## Rôle
- API ASP.NET Core du cœur : branche les modules (Document, Métré, Liste, Fiche, GED, Bibliothèque, Annuaire, Entreprises françaises) et les spécialise pour le BTP. Les modules ne dépendent jamais de `src/`.
- Trois projets : `LogiBTP.Domaine` (entités BTP), `LogiBTP.Calcul` (moteur de devis BTP), `LogiBTP.Api` (hôte, spécialisations, routes propres au cœur). Tests : `tests/LogiBTP.Calcul.Tests`.

## Repères
- Inventaire de `Program.cs` (ordre du branchement), des fichiers `Btp/*.cs` par module et lot, et des routes propres au cœur : [SRC.md](../documentation/modules/SRC.md).
- Toute nouvelle route `/api` se rattache à un nœud de droits dans `SpecialisationDroitsBtp.Routes` (sinon 403 `DROIT_NON_DECLARE`, exception au démarrage en développement).
- Modules facultatifs : groupe de routes sous `ExigeModule(code, libellé)` ; drapeaux de `module_societe` lus par `ModulesSociete` (cache de 30 s par base).
- Règles du cœur répliquées avec le client : ressources (`ReglesRessources`, `ReglesCompteurs`, `ReglesEntretiens`, `ReglesAffectations` ↔ `client/src/app/ressources/*.js`, jeux `tests/ressources`), adresses (`AdressesDocument` ↔ `structure/adresses.js`), révision des prix (`ReglesRevision` ↔ `structure/revision.js`).
- Aides communes : `Btp/SqlBtp.cs` (paramètres nullables, statuts hors vigueur) et vues de `db/240` ; individus de notre structure par `Btp/IndividusStructure.cs`.

## Spécialisation des modules
- Document + Métré : `SpecialisationBtp`, `LogiBtpContext`, `DocumentBtp`, `DocumentLigneBtp`, `MoteurDevisBtp`, `ComparateurBtp`.
- Liste : `SpecialisationListeBtp`. Fiche : `SpecialisationFicheBtp` (+ `Intervenants`, `SalariesAnnuaire`, `ElementsBibliotheque`). GED : `SpecialisationGedBtp`.
- Relances : `SpecialisationRelanceBtp` (pièces relancées par le rôle `type_document.tyd_role_relance`, `db/283`, jamais par code de type ; reste par `ServiceReglement` si Règlements est actif ; nœud `relances`).
- Bibliothèque : `SpecialisationBibliothequeBtp`, `ElementsBibliotheque`. Annuaire : `ServiceAnnuaire` appelé par `SpecialisationFicheBtp` (`ControlerPersonne`, `Identifiants.Compacter`, champs gérés).

## Conventions et pièges
- Toute règle de `MoteurDevisBtp.cs` se reporte dans `client/src/calcul/moteur-btp.js` (cas dans `tests/cas/*.json`) ; propriétés de `DocumentBtp` / `DocumentLigneBtp` alignées sur `client/src/calcul/colonnes-btp.js` (test `Colonnes_btp_alignees_avec_le_moteur_js`).
- Répliques JS : `ControlerValidation` ↔ `controlesValidation` ; `Intervenants.Controler` ↔ `controlerIntervenants` ; `SalariesAnnuaire.Synchroniser` ↔ `synchroniserSalarie` ; `ValiderMetier` ↔ `fiches.js` / `fiche-annuaire.js`.
- Pas de migrations EF : nouvelle colonne = `ALTER TABLE` dans `db/` + propriété PascalCase (mappée en snake_case).
- SQL brut paramétré uniquement ; noms de colonnes jamais saisis (`Intervenants.Colonnes` est une liste fermée). Cache singleton dépendant du schéma : indexé par base.
- `TIERS_OBLIGATOIRE` et la plupart des contrôles de validation sont dans le module Document (`DocumentService`), pas ici.

## Commandes
- Comptes (module Authentification) : `dotnet run --no-build --project src\LogiBTP.Api --launch-profile http -- comptes creer-admin <pseudo> [--libelle "…"] [--societe demo]` (mot de passe provisoire affiché une fois), `reinitialiser <pseudo>`, `deverrouiller <pseudo>`, `liste`.
- Arrêter l'API avant `dotnet build LogiBTP.slnx` (binaires verrouillés). Lancement : `dotnet run --no-build --project src\LogiBTP.Api --launch-profile http` (5080) ; Vite (5173) proxifie `/api` ; société « demo » par http://demo.localhost:5173.
- `dotnet test LogiBTP.slnx` ; parité complète : `npm run exporter-resultats` puis `dotnet test LogiBTP.slnx` (`Parite_avec_le_moteur_js` lit `tests/resultats-js`).
- `tests/LogiBTP.Calcul.Tests/CasPartagesTests.cs` : `Cas_partage`, `Stabilite_recalculer_le_resultat_ne_change_rien`, `Parite_avec_le_moteur_js` (jeux `tests/cas/*.json`, aussi rejoués par `client/test/cas-partages.test.js`), `Colonnes_btp_alignees_avec_le_moteur_js`.
- Tests d'intégration PostgreSQL (module Liste) : variable `LOGIBTP_TEST_PG` = `Host=localhost;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp`.

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Liaisons croisées (cœur, `Btp/LiaisonsBtp.cs`, `db/202`, routes `/api/liaisons`) : planning théorique d'un chantier depuis son parcours d'exécution (une tâche par étape, heures budget du service, dépendances fin → début fixes), ordre → tâche du planning (mode charge entre ses dates prévues) et dates proposées à l'ordre, acceptées ou non (P15), heures réalisées = pointages retenus (`v_pointages_retenus`, `v_heures_realisees_ordre|chantier`) dans l'exécution d'un ordre et le détail d'une tâche du planning, chantiers du jour de la borne = tâches du planning, non-conformité de la borne → tâche du CRM au service du motif, tâches du CRM à échéance sur un chantier = jalons du planning.
