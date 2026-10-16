# Scripts SQL du cœur LogiBTP

## Rôle
- Schéma et données du cœur, appliqués **après** les scripts des modules (`modules/*/db` : 010–013 Document, 020 Métré, 030–032 Liste, 040 Fiche, 050–051 GED, 060–062 Bibliothèque, 070 Annuaire). Pas de migrations EF : le cœur ajoute ses colonnes métier par `ALTER TABLE` sur les tables des modules.
- PostgreSQL 17 (`docker-compose.yml`, conteneur `logibtp-postgres`, port hôte 5433, utilisateur / mot de passe `logibtp`). Une base par société : `logibtp` (principale) et `logibtp_demo` (sous-domaine `demo`).

## Structure (ordre d'exécution)
- `100_btp.sql` : colonnes BTP de `document` (`ent_mode_calcul_ouvrage`, `ent_coef_fa`) et `document_ligne` (nature, poste, métré, perte, PA/FG/PR/bénéfice/FA/prorata, PV affiché, blocages, écart d'arrondi, `lig_pied_is_fa`), `ck_lig_un_seul_blocage`, `ux_lig_ecart_arrondi`, clés étrangères du Métré vers le document.
- `110_reference.sql` : types de documents (familles V/A/S), statuts, taux de TVA, transformations autorisées, droits ADMIN, propriétés, unités, `tyd_validite_jours`.
- `115_bibliotheque.sql` : `ent_bib_id`, unités complémentaires, vue `v_liste_elements`, catégorie GED `notice_technique`.
- `116_bibliotheque_demo.sql` : **généré** (`client/src/app/bibliotheque/donnees.js`).
- `120_listes.sql` : vue `v_liste_documents`, tables de démo `demo_salarie`, `demo_materiel`, `demo_equipe`, `demo_sous_traitant`, vues `v_liste_salaries|materiels|ressources`, données volumineuses.
- `121_listes_parametrage.sql` : **généré** (`client/src/app/vues-liste.js`) : `source_liste`, `theme_liste`, `vue_liste`.
- `130_fiches.sql` : colonnes des fiches salarié / matériel, JSONB des champs supplémentaires.
- `131_fiches_parametrage.sql` : **généré** (`client/src/app/fiches/definitions.js`) : `type_fiche`, `droit_fiche`, `parametre_champ_fiche`, `champ_supplementaire`.
- `140_annuaire.sql` : champs des casquettes de `personne`, vues `v_liste_personnes|individus`, catégories GED des tiers, `demo_salarie.sal_ind_id`, `tarif_fournisseur.tfo_tiers_id` → `personne`.
- `141_annuaire_demo.sql` : **généré** (`client/src/app/annuaire/donnees.js`).
- `142_annuaire_salaries.sql` : un individu par salarié (individu et rattachement = 1000 + `sal_id`, coordonnées = 100000 + 2 × `sal_id` (+1)) ; réplique de `annuaireDesSalaries`.
- `150_documents_vues.sql` : **généré** (`client/src/app/vues-document.js`) : vues de colonnes (`ON CONFLICT (vdo_id) DO NOTHING`).
- `160_structure.sql` : tables `affaire`, `projet`, `chantier`, `marche` ; `ent_projet_id|affaire_id|chantier_id|marche_id` ; vues `v_facturation_document`, `v_liste_projets|affaires|chantiers|marches`, `v_liste_documents` (remplacée) ; type `V_SITUATION`, libellés de types, statuts, transformations, droits.
- `161_structure_demo.sql` : **généré** (`client/src/app/structure/donnees.js`) ; rattache le devis de démo s'il existe (`UPDATE document … WHERE ent_objet = 'Extension maison individuelle'`).
- `162_intervenants.sql` : `fonction_intervenant` (portée S/D/T), `intervenant` (une colonne `itv_prj_id|aff_id|cha_id|mar_id` renseignée), `ent_intervenants` (JSONB), `ent_redacteur_id` → `individu`, vue `v_intervenants`.
- `163_intervenants_demo.sql` : **généré** (`client/src/app/structure/donnees.js`).
- `900_societe_demo.sh` : crée `logibtp_demo` et y rejoue tous les `*.sql` de `/docker-entrypoint-initdb.d`.

## Spécialisation des modules
- Document / Métré : 100, 110, 150, 160 (types et transformations), 162 (`ent_intervenants`, `ent_redacteur_id`). Liste : 120, 121 (+ vues de 115, 140, 160). Fiche : 130, 131. GED : catégories dans 115, 140 (`parametre_ged`). Bibliothèque : 115, 116. Annuaire : 140, 141, 142, 162.

## Conventions et pièges
- Fichiers **générés** (116, 121, 131, 141, 150, 161, 163) : ne jamais les modifier ; changer la source JS puis `npm run generer-vues-liste --workspace client`.
- Noms de colonnes snake_case préfixés (`ent_`, `lig_`, `prj_`, `aff_`, `cha_`, `mar_`, `itv_`, `fin_`) ; mêmes noms dans `client/src/calcul/colonnes-btp.js` et les entités C#.
- `FONCTIONS_INTERVENANT` (`structure/donnees.js`) doit refléter les `INSERT` de 162 (test `client/test/structure.test.js`).
- Scripts majoritairement **non idempotents** (`CREATE TABLE`, `ADD COLUMN` sans `IF NOT EXISTS`) : n'appliquer un script qu'une fois par base.
- `docker-compose.yml` monte tous les scripts des modules et du cœur (jusqu'à 163, + `900` qui rejoue les mêmes `.sql` pour `logibtp_demo`) ; ils ne tournent qu'à la création du volume (`docker compose down -v` pour repartir de zéro). Sur les bases existantes, un nouveau script s'applique à la main.
- Nouveau script du cœur : numéro après le dernier (≥ 164), en-tête de commentaire (rôle, source si généré), à appliquer aux deux bases ; s'il doit faire partie d'une base neuve, l'ajouter aux volumes de `docker-compose.yml`.
- Vues de liste : une nouvelle colonne de liste se déclare dans `client/src/app/vues-liste.js` (source `SOURCES_LISTE`) et dans la vue SQL ; `v_liste_documents` est redéfinie par 160 (`CREATE OR REPLACE`).
- 161 / 163 référencent les tiers et individus de démonstration (141) et le devis de démo ; jamais contourner les triggers du coffre GED (`modules/ged/db/050`).

## Commandes
- Appliquer un script à une base existante (**les deux** bases, depuis la racine du dépôt) :
  - `docker compose exec -T postgres psql -U logibtp -d logibtp -v ON_ERROR_STOP=1 < db/160_structure.sql`
  - `docker compose exec -T postgres psql -U logibtp -d logibtp_demo -v ON_ERROR_STOP=1 < db/160_structure.sql`
  - Respecter l'ordre (160 → 161 → 162 → 163) ; un fichier généré déjà appliqué ne se rejoue en général pas tel quel (`INSERT` à identifiants fixes ; seul 150 a `ON CONFLICT DO NOTHING`).
- Vérifier une base : `docker compose exec -T postgres psql -U logibtp -d logibtp -c "\dt"` (ou `\dv` pour les vues `v_liste_*`).
- L'API sert la base `logibtp` sur http://localhost:5173 et `logibtp_demo` sur http://demo.localhost:5173 (`appsettings.json`, section `Societes`).
- Régénérer les fichiers générés : `npm run generer-vues-liste --workspace client` (écrit 116, 121, 131, 141, 150, 161, 163).
- Base neuve : `docker compose up -d` (exécute modules puis cœur, puis `900_societe_demo.sh`).
- Démo : API `dotnet run --no-build --project src\LogiBTP.Api --launch-profile http` (5080), `npm run dev` (5173), société demo par http://demo.localhost:5173 ; documents de démo : `node client/scripts/generer-documents-demo.mjs <host> <id du devis de démo>` (structure et annuaire de démo en base).
- Tests sur la base : `LOGIBTP_TEST_PG=Host=localhost;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp` puis `dotnet test LogiBTP.slnx`.
