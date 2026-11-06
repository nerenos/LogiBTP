# Module Fiche – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [FICHE.md](../../documentation/modules/FICHE.md).

## Rôle
- Fiche d'un élément ouverte par type + ID, sans métier : modes (consultation, modification, création, copie), droits par profil, verrou de modification (battement, reprise de la main, expiration), champs obligatoires (programme `*` / paramétrage `◆`), confidentiels (masqués, révélés et journalisés RGPD ; un champ du logiciel peut être rendu confidentiel par le paramétrage), champs supplémentaires (JSONB ; onglet, groupe et ordre paramétrés ; liste de valeurs saisies ou par requête SQL), mots de passe (type `motdepasse`, chiffrés en base), champs gérés (hors table), suppression, onglet Pièces jointes (GED injectée), code à chrono (code prévisionnel à la création, contrôle « déjà utilisé », code suivant proposé, droit de modifier le code).
- Chaque type décrit sa table, sa clé, ses champs et sa colonne JSONB (`type_fiche`) : le module ne connaît pas les tables de l'hôte.

## Dépendances
- Dépend de : `@logibtp/socle` (`echapper`, `formatLibre`, `htmlSur`, `editerLibelle`, `creerCombo`), `LogiBTP.Socle` (`Chiffrement`), `LogiBTP.Socle.Web` (`Utilisateur`, `ExceptionMetier`, `JsonCalcul`), `LogiBTP.Socle.Testing`. Jamais du cœur ni d'un autre module (la GED arrive par l'option `ged`).
- Utilisations par le cœur : voir le détail.

## Repères
- Mots de passe (type `motdepasse`) : jamais envoyés au client (valeur null, liste `FicheDto.Secrets`), révélés par `POST /{id}/secret` (journalisé), jamais copiés ; chiffrés `chiffre:v1:` juste avant l'écriture (`Chiffrement` du socle ; sans clé : 422 `CHIFFREMENT`).
- Listes par requête SQL : exécutées côté serveur en lecture seule (`READ ONLY`, `statement_timeout`, 1 000 valeurs) ; la requête n'est jamais envoyée au client.
- Champs gérés (`gere`, sans colonne) : `LireGeresAsync` / `ValiderGeresAsync` / `EcrireGeresAsync` de `SpecialisationFiche` ; champs `html` nettoyés par `NettoyerHtml` avant écriture.
- Code à chrono : `chrono.js` ↔ `ChronoFiche.cs` ; le prévisionnel n'avance pas le compteur ; `CODE_PRIS` → prochain code libre proposé ; code modifié après la création : droit `MODIFIER_CODE`.
- Raccourcis : groupe `fiche` (`declarerRaccourcis` du socle) ; une action de l'hôte porte `raccourci`.

## Règles répliquées JS / C# et jeux de cas
- `tests/cas/01_validation.json` : `validerChamp` (`validation.js`) ↔ `ValidationFiche.Valider` (codes OBLIGATOIRE, LONGUEUR, NOMBRE, DATE, LISTE, BOOLEEN, FORMAT ; un mot de passe se valide comme un texte, en clair).
- Requête d'une liste : `erreurRequete` ↔ `ValidationFiche.ErreurRequete` (une instruction SELECT ou WITH ; tests de chaque côté).
- `tests/cas/02_chrono.json` : `chrono.js` ↔ `ChronoFiche` (formater, lire, début, contrôler, suivant) ; le chrono du fournisseur mémoire suit `ServiceFiche.Chrono.cs` (`js/test/chrono.test.js`).
- Règles métier du cœur : `validerMetier` des fiches JS (`fiches.js`, `fiche-annuaire.js`) ↔ `SpecialisationFicheBtp.ValiderMetier` (code `METIER`).
- `FournisseurFicheMemoire` applique les mêmes contrôles que `ServiceFiche` (droits, verrou, empreinte, validation, gérés).

## Conventions et pièges
- Enregistrement : verrou détenu par ce jeton (sinon 409 `VERROU_PERDU`), empreinte `h` inchangée, validation de la ligne complète après modification (confidentiel compris), JSONB fusionné (saisie vide = clé à null). Champ `lecture_seule` ou `saisie: 'creation'` refusé en modification.
- `EcrireGeresAsync` s'exécute après la transaction de la ligne (pas atomique avec elle) : valider dans `ValiderGeresAsync`.
- Verrou : battement JS toutes les 30 s ; `PurgerVerrous` supprime les verrous expirés ; `forcer` exige DEBLOQUER ; une saisie dans une liste salaries/materiels est refusée si la fiche est verrouillée.
- Identifiants SQL tirés de la définition du type (contrôlés, entre guillemets), valeurs en paramètres converties au type `information_schema` (`CacheTypesColonnes`, indexé par base).
- Types, droits et paramétrage du cœur : modifier `client/src/app/fiches/definitions.js` puis `npm run generer-vues-liste --workspace client` (régénère `db/131_fiches_parametrage.sql` avec `db/121`, 116, 141, 150, 161, 163) ; ne jamais éditer `db/131` à la main.
- Colonnes métier ajoutées par `ALTER TABLE` dans le cœur ; noms DDL snake_case préfixés.
- Affichage des champs supplémentaires (`FicheBase.sections`) : regroupés par `groupe` dans l'ordre paramétré, après les groupes de l'onglet `section`, sinon dans Informations complémentaires ; chaque onglet porte `champs` (programme) et `supplementairesSection` (erreurs, navigation). Une fiche fille qui filtre les groupes garde ceux marqués `supplementaire` (`fiche-annuaire.js`).
- Champs `liste` : `creerCombo` du socle (valeur lue par `valeurCombo`, événement `change` ; en lecture, champ en lecture seule sans flèche).
- Dans `SpecialisationFiche.cs`, le commentaire de `AvantEcritureAsync` est mal placé (au-dessus de `AvantSuppressionAsync`).

## Textes, icônes et couleurs (module Personnalisation, lot P3e)
- Textes, icônes et couleurs par `js/personnalisation/` (règles et exceptions gardées en littéraux : voir le détail).

## Tests
- `npm test --workspace modules/fiche/js` (vitest : jeu partagé + fournisseur mémoire) ; `dotnet test LogiBTP.slnx` (projet `LogiBTP.Fiches.Tests`).
- Toute règle de validation modifiée : JS + C# + cas dans `01_validation.json`.

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Module Fiche : validation des champs répliquée entre `modules/fiche/js/src/validation.js` et `ValidationFiche.cs` (jeu `modules/fiche/tests/cas` ; `erreurRequete` ↔ `ErreurRequete` pour les listes par requête SQL) ; paramétrage : RGPD des champs du logiciel (`pcf_confidentiel`), champs supplémentaires par onglet / groupe / ordre, liste de valeurs par SELECT (lecture seule, côté serveur), type mot de passe chiffré (`POST /{id}/secret`, journalisé) ; types de fiches dans `client/src/app/fiches/definitions.js` (puis `npm run generer-vues-liste --workspace client`) ; les règles métier des fiches du cœur existent en JS (`fiches.js`) et en C# (`SpecialisationFicheBtp`). Champs supplémentaires : colonne JSONB par table. Champs gérés (`gere: true`, sans colonne) : lus et écrits par `SpecialisationFiche.LireGeresAsync / ValiderGeresAsync / EcrireGeresAsync` (mémoire : `types.<type>.geres`). Code à chrono (`definition.chrono` des types, `modules/fiche/js/src/chrono.js` ↔ `ChronoFiche.cs`, jeu `02_chrono.json`) : code prévisionnel en italique à la création (le compteur n'avance qu'à l'enregistrement d'un code calculé, rang pris sauté), code saisi contrôlé en direct, déjà pris → prochain code libre proposé (`CODE_PRIS`) ; code modifié après la création : droit `MODIFIER_CODE` ; formats dans `/parametres/referentiels` (Codes des fiches) ; marché : `{PARENT}` = code du chantier (`CodeParentChronoAsync`), suffixe saisissable ; élément : compteur par bibliothèque ; créations hors fiche par `IChronosFiches` du socle (tiers provisoire, projet du CRM ; trigger T + identifiant en secours, `modules/annuaire/db/072`) ; synthèse en tête de fiche et compteurs d'onglets par `SpecialisationFiche.SyntheseAsync` (`GET /api/fiches/{type}/{id}/synthese`, cœur : `Btp/SynthesesFiches.cs`), exemple de saisie `exemple` du champ, « — » des champs vides en consultation, booléens jamais obligatoires.
