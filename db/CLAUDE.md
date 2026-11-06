# Scripts SQL du cœur LogiBTP

## Rôle
- Schéma et données du cœur, appliqués **après** les scripts des modules (`modules/*/db` : 004 OAuth, 005 Authentification, 006 Calendrier, 007–007c Mail, 008 Notifications, 010–019b Document, 020–021 Métré, 030–032 Liste, 040 Fiche, 050–051 GED, 060–062 Bibliothèque, 070 Annuaire, 080 Règlements, 090 Édition, 095 CRM, 085 Exécution, 086–088 Pointage, 089–089d Planning, 092–092b Sous-traitance, 093–093d Stock, 094–094c Comptabilité). Pas de migrations EF : le cœur ajoute ses colonnes métier par `ALTER TABLE` sur les tables des modules.
- PostgreSQL 17 (`docker-compose.yml`, conteneur `logibtp-postgres`, port hôte 5433, utilisateur / mot de passe `logibtp`). Une base par société : `logibtp` (principale) et `logibtp_demo` (sous-domaine `demo`).

## Repères
- Catalogue des scripts du cœur (rôle de chacun, de 100 à 271, rôles d'installation) : [DB.md](../documentation/modules/DB.md) ; l'ordre d'exécution est celui du manifeste `installation/scripts.txt`, jamais celui de ce catalogue.
- `v_liste_documents` : toute nouvelle reprise part de `267_devis_relance.sql` (dernière définition).
- `installation/roles.sql` : rôles d'une installation (`logibtp_schema` propriétaire, `logibtp_app` pour l'API : données seulement, ni schéma ni triggers, coffre de la GED sans UPDATE / DELETE / TRUNCATE ; `logibtp_lecture`) ; jamais appliqué aux bases de développement.
- Colonnes ajoutées par le cœur hors entité C# (ex. `ent_stk_*`, `ent_mat_id`) : lues et écrites en SQL par le cœur.

## Spécialisation des modules
- Document / Métré : 100, 110, 150, 160 (types et transformations), 162 (`ent_intervenants`, `ent_redacteur_id`). Liste : 120, 121 (+ vues de 115, 140, 160). Fiche : 130, 131. GED : catégories dans 115, 140 (`parametre_ged`). Bibliothèque : 115, 116. Annuaire : 140, 141, 142, 162.

## Conventions et pièges
- Fichiers **générés** (116, 121, 131, 141, 150, 161, 163, 176) : ne jamais les modifier ; changer la source JS puis `npm run generer-vues-liste --workspace client`. 131 est rejouable (types de fiches mis à jour, droits et paramétrage ajoutés s'ils manquent) : le rejouer sur les bases existantes après un changement de `fiches/definitions.js` ; 121 aussi (sources et thèmes mis à jour, vues par défaut ajoutées si elles manquent, remplacées tant qu'elles n'ont jamais été modifiées ; nouvelles vues par défaut : identifiants 1000 et suivants, jamais en conflit avec les vues des utilisateurs).
- Noms de colonnes snake_case préfixés (`ent_`, `lig_`, `prj_`, `aff_`, `cha_`, `mar_`, `itv_`, `fin_`) ; mêmes noms dans `client/src/calcul/colonnes-btp.js` et les entités C#.
- `FONCTIONS_INTERVENANT` (`structure/donnees.js`) doit refléter les `INSERT` de 162 (test `client/test/structure.test.js`).
- Scripts majoritairement **non idempotents** (`CREATE TABLE`, `ADD COLUMN` sans `IF NOT EXISTS`) : n'appliquer un script qu'une fois par base.
- `docker-compose.yml` monte le dépôt et applique le manifeste `installation/scripts.txt` aux deux bases, seulement à la création du volume (`docker compose down -v` pour repartir de zéro). Sur les bases existantes, un nouveau script s'applique à la main (développement) ou par `installation base mettre-a-jour` (installation).
- Nouveau script du cœur : numéro après le dernier, en-tête de commentaire (rôle, source si généré), **ajouté au manifeste** `installation/scripts.txt` (test du module Installation), à appliquer aux deux bases de développement ; un script appliqué ne se modifie plus (empreinte suivie par `installation_script`) : une correction est un nouveau script.
- Vues de liste : une nouvelle colonne de liste se déclare dans `client/src/app/vues-liste.js` (source `SOURCES_LISTE`) et dans la vue SQL ; `v_liste_documents` est redéfinie par 160, 182 puis 185 (`CREATE OR REPLACE`, nouvelles colonnes à la fin).
- 161 / 163 référencent les tiers et individus de démonstration (141) et le devis de démo ; jamais contourner les triggers du coffre GED (`modules/ged/db/050`).

## Commandes
- Appliquer un script à une base existante (**les deux** bases, depuis la racine du dépôt) :
  - `docker compose exec -T postgres psql -U logibtp -d logibtp -v ON_ERROR_STOP=1 < db/160_structure.sql`
  - `docker compose exec -T postgres psql -U logibtp -d logibtp_demo -v ON_ERROR_STOP=1 < db/160_structure.sql`
  - Respecter l'ordre (160 → 161 → 162 → 163) ; un fichier généré déjà appliqué ne se rejoue en général pas tel quel (`INSERT` à identifiants fixes ; seul 150 a `ON CONFLICT DO NOTHING`).
- Vérifier une base : `docker compose exec -T postgres psql -U logibtp -d logibtp -c "\dt"` (ou `\dv` pour les vues `v_liste_*`).
- L'API sert la base `logibtp` sur http://localhost:5173 et `logibtp_demo` sur http://demo.localhost:5173 (`appsettings.json`, section `Societes`).
- Régénérer les fichiers générés : `npm run generer-vues-liste --workspace client` (écrit 116, 121, 131, 141, 150, 161, 163).
- Base neuve : `docker compose up -d` (manifeste appliqué à `logibtp` puis `logibtp_demo`).
- Démo : API `dotnet run --no-build --project src\LogiBTP.Api --launch-profile http` (5080), `npm run dev` (5173), société demo par http://demo.localhost:5173 ; documents de démo : `node client/scripts/generer-documents-demo.mjs <host> <id du devis de démo>` (structure et annuaire de démo en base).
- Tests sur la base : `LOGIBTP_TEST_PG=Host=localhost;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp` puis `dotnet test LogiBTP.slnx`.
