# Module Fiche – contexte

## Rôle
- Fiche d'un élément ouverte par type + ID, sans métier : modes (consultation, modification, création, copie), droits par profil, verrou de modification (battement, reprise de la main, expiration), champs obligatoires (programme `*` / paramétrage `◆`), confidentiels (masqués, révélés et journalisés RGPD ; un champ du logiciel peut être rendu confidentiel par le paramétrage), champs supplémentaires (JSONB ; onglet, groupe et ordre paramétrés ; liste de valeurs saisies ou par requête SQL), mots de passe (type `motdepasse`, chiffrés en base), champs gérés (hors table), suppression, onglet Pièces jointes (GED injectée).
- Chaque type décrit sa table, sa clé, ses champs et sa colonne JSONB (`type_fiche`) : le module ne connaît pas les tables de l'hôte.

## Dépendances
- Dépend de : `@logibtp/socle` (`echapper`, `formatLibre`, `htmlSur`, `editerLibelle`, `creerCombo`), `LogiBTP.Socle` (`Chiffrement`), `LogiBTP.Socle.Web` (`Utilisateur`, `ExceptionMetier`, `JsonCalcul`), `LogiBTP.Socle.Testing`. Jamais du cœur ni d'un autre module (la GED arrive par l'option `ged`).
- Utilisé par : cœur C# (`SpecialisationFicheBtp` dans `src/LogiBTP.Api/Btp/SpecialisationsElements.cs`, `AddModuleFiche<SpecialisationFicheBtp>`, `api.MapModuleFiche()` ; `SpecialisationListeBtp` lit `ServiceFiche.Verrou`) ; client : `FicheLogiBTP extends FicheBase` (`client/src/app/fiches/fiches.js` : `FicheSalarie`, `FicheMateriel`), `fiche-element.js` (`FicheElement`), `fiche-annuaire.js` (`FichePersonne`, `FicheIndividu`), `fiche-structure.js` (`FicheProjet`, `FicheAffaire`, `FicheChantier`, `FicheMarche`) ; page `/fiche/:type/:id` (`pages/fiche.js`, `?copie=1` = copie).

## Structure
- `db/040_fiche_schema.sql` : toutes les tables du module ; `041_fiche_parametrage.sql` : colonnes ajoutées depuis (rejouable, pour les bases existantes).
- `js/src/validation.js` : `validerChamp`, `validerFiche`, `nombreSaisi`, `erreurRequete`, `MESSAGES`, `FORMATS_PREDEFINIS` ; `modes.js` : `MODES`, `LIBELLES_MODES`, `enSaisie`, `titreFiche` (modèle « [prenom] [nom] »).
- `js/src/fournisseurs.js` : `FournisseurFicheApi` (base `/api/fiches`), `FournisseurFicheMemoire` (mêmes règles ; `simulerVerrouAutre` pour la démo), `ErreurFiche`, `convertir`.
- `js/ui/fiche.js` : `FicheBase` (classe mère), `confidentielSession` / `definirConfidentielSession` (sessionStorage) ; `parametrage.js` : `ParametrageFiche` (obligations et RGPD des champs du logiciel, champs supplémentaires : type, onglet, groupe, ordre ↑↓, détail ▸ format / longueur / aide / valeurs / requête SQL).
- `dotnet/LogiBTP.Fiches` : `Modeles.cs` (`DefinitionFiche`, `SectionFiche`, `GroupeChamps`, `ChampFiche`, `ErreurChamp`, `TypeFicheResolu`, `ErreurFiche`), `ValidationFiche.cs`, `ConstructeurFiche.cs` (SQL `Lire`, `Verrou`, `MiseAJour`, `Insertion`, `Suppression`).
- `dotnet/LogiBTP.Fiches.Web` : `ServiceFiche.cs`, `SpecialisationFiche.cs`, `Donnees.cs` (`FicheDbContext`, DTO `FicheDto`, `DemandeEnregistrement`, `DroitsFiche`, `EtatVerrou`…), `Extensions.cs`.

## Modèle de données
- `type_fiche` (`tyf_code`, `tyf_libelle`, `tyf_table`, `tyf_cle`, `tyf_colonne_proprietes`, `tyf_definition` JSONB : titre, sous_titre, sections/groupes, champs).
- `droit_fiche` (`drf_profil`, `drf_type`, `drf_action` ∈ VOIR, MODIFIER, DEBLOQUER, CONFIDENTIEL, SUPPRIMER).
- `parametre_champ_fiche` (`pcf_obligatoire` : rendre obligatoire un champ facultatif ; `pcf_confidentiel` : rendre confidentiel un champ du logiciel, hors champs gérés) ; `champ_supplementaire` (`chs_type_donnee` texte/nombre/booleen/date/liste/motdepasse, `chs_format`, `chs_options`, `chs_requete` (liste par SELECT), `chs_section` (onglet de la définition, sinon Informations complémentaires), `chs_groupe` (cadre titré), `chs_ordre`…).
- `verrou_fiche` (`vef_type`, `vef_id`, `vef_utilisateur`, `vef_jeton` UUID par onglet, `vef_depuis`, `vef_renouvele`) ; `journal_confidentiel` (`jcf_champs` TEXT[]).
- Types du cœur (`TYPES_FICHE` dans `client/src/app/fiches/definitions.js`) : salarie (`salarie`), materiel (`materiel`), element, personne, individu, projet, affaire, chantier, marche ; `DROITS_FICHE`, `PARAMETRAGE_FICHE`, `ficheDeLigne({ type, id })` (ligne de liste → fiche).
- Champ : `code`, `colonne` (programme) ou supplémentaire, `type` (texte, zone, html, json, nombre, booleen, date, liste, motdepasse), `format` (email, telephone, code_postal, 999.99, regex:…), `longueur`, `obligatoire`, `confidentiel` (+ `confidentiel_parametre`), `lecture_seule`, `saisie: 'creation'`, `non_copie`, `options`, `requete`, `section`, `groupe`, `reference`, `defaut`, `gere`.

## Points de spécialisation
- C# `SpecialisationFiche` : `NettoyerHtml(html)` (champs de type html nettoyés avant écriture ; cœur : liste blanche du module Document, aucun script), `ExpirationVerrou` (2 min), `DelaiRequeteMs`, `DroitsSupplementaires`, `ValiderMetier` (→ `ErreurChamp`), `AvantEcriture` / `AvantEcritureAsync` (`aEcrire` reçoit des colonnes calculées), `AvantSuppressionAsync`, `Constructeur(type)`, `LireGeresAsync`, `ValiderGeresAsync` (avant écriture, id null en création), `EcrireGeresAsync` (après la ligne ; par défaut refuse tout champ géré).
- Cœur : `SpecialisationFicheBtp` délègue element → `ElementsBibliotheque.AvantEcriture`, salarie → `SalariesAnnuaire.Synchroniser`, personne/individu → `ServiceAnnuaire` (`LireGeres`, `ValiderGeres`, `EcrireGeres`, `ControlerPersonne`), projet/affaire/chantier/marche → `Intervenants` (champ géré `intervenants`). `AvantSuppressionAsync` non surchargé à ce jour.
- JS `FicheBase` : `sousTitre`, `champsNonCopies` (non_copie + gérés), `valeursCreation`, `validerMetier`, `rendreInformations`, `actionsSupplementaires` → `[{ libelle, titre, action, visible }]`, `ongletsSpecifiques` → `[{ code, titre, rendre(corps, { modifiable }), dans? }]`, `rendreChamp(champ, valeur)`, `groupeVisible(groupe, section)` (groupe affiché ; tous par défaut), `apresChargement`, `definirValeur(code, valeur)`. Options : `conteneur`, `fournisseur`, `type`, `id`, `mode`, `message`, `ged`, `peutParametrer`, `actions` (boutons de l'hôte dans la barre, hors saisie : imprimer…), `surEnregistre`, `surFerme`, `surSupprime`.
- Barre de la fiche : boutons courants en icône seule (`icone` ; libellé et explication dans la bulle `title`, `aria-label`) ; Enregistrer et Annuler gardent leur libellé.
- Méthodes de `FicheBase` : `ouvrir`, `recharger`, `rendre`, `modifier({ forcer })`, `controlerVerrou`, `annuler`, `copier`, `reveler`, `enregistrer`, `parametrer`, `supprimer`, `fermer({ sansConfirmation })` ; lecture : `valeur`, `propriete`, `valeurs()`, `proprietes()`, `modifiee`, `masques`.
- Définition renvoyée au client (`DefinitionFicheDto`) : `type`, `libelle`, `titre`, `sous_titre`, `sections`, `champs` (obligations du paramétrage incluses), `supplementaires` (onglet « Informations complémentaires », code `+supplementaires`), `droits { voir, modifier, debloquer, confidentiel, supprimer }`.
- Masques confidentiels : `FicheDto.Masques` = code (programme) ou `+code` (supplémentaire). Mots de passe : jamais envoyés (valeur null), `FicheDto.Secrets` liste ceux qui sont enregistrés (code ou `+code`) ; 👁 de la fiche → `revelerSecret` (droit VOIR, et CONFIDENTIEL si le champ l'est), journalisé ; jamais copiés, ni journalisés par `Reveler`.
- Listes par requête des champs du logiciel (`requete` de la définition du type) comme des champs supplémentaires : options résolues par `ResoudreOptions`, requête jamais envoyée au client.
- Listes par requête : `ServiceFiche.OptionsRequete` (transaction READ ONLY annulée, `statement_timeout`, 1 000 valeurs, colonne 1 = valeur, 2 = libellé), essayée à l'enregistrement du paramétrage, résolue dans `Definition`, `Enregistrer`, `Creer` (`ResoudreOptions`) ; la définition envoyée ne contient jamais la requête. Hors ligne : option `requete(sql)` du fournisseur mémoire (sinon options saisies).
- Chiffrement : `Chiffrement` du socle (injecté ; `AddChiffrement` dans `Program.cs`, sinon non configuré) ; valeur `chiffre:v1:…` en base, déchiffrée dans `LigneComplete` (validation et révélation en clair, en mémoire), chiffrée juste avant l'écriture (`ChiffrerSecrets`, `ProprietesJson`). Sans chaîne : paramétrer un mot de passe est refusé (422 `CHIFFREMENT`).
- `FournisseurFicheMemoire` : types `{ definition, lignes, cle, proprietes, derivees(ligne), geres: { lire, valider, ecrire } }` (mémoire : `types.<type>.geres`).

## Routes HTTP (sous `/api/fiches/{type}`)
- `GET /definition` ; `GET|PUT /parametrage` (PUT : ADMIN).
- `POST ""` (créer), `GET /{id}?confidentiel=`, `PUT /{id}` (`DemandeEnregistrement` : `jeton`, `h`, `valeurs`, `proprietes`, `confidentiel`), `DELETE /{id}` (droit SUPPRIMER).
- `POST /{id}/confidentiel` (révéler, journalisé) ; `POST /{id}/secret` (`{ champ }` → `{ valeur }` : mot de passe en clair, journalisé) ; `POST /{id}/verrou` (`{ jeton, forcer }`), `DELETE /{id}/verrou?jeton=`.
- Erreurs : 422 `VALIDATION` (liste d'`ErreurChamp`), `CHAMP`, `VALEUR` (23505 = doublon), `REQUETE` (liste par SQL), `CHIFFREMENT` ; 409 `VERROU_PERDU`, `FICHE_MODIFIEE`, `FICHE_EN_MODIFICATION`, `FICHE_UTILISEE` (clé étrangère).

## Règles répliquées JS / C# et jeux de cas
- `tests/cas/01_validation.json` : `validerChamp` (`validation.js`) ↔ `ValidationFiche.Valider` (codes OBLIGATOIRE, LONGUEUR, NOMBRE, DATE, LISTE, BOOLEEN, FORMAT ; un mot de passe se valide comme un texte, en clair).
- Requête d'une liste : `erreurRequete` ↔ `ValidationFiche.ErreurRequete` (une instruction SELECT ou WITH ; tests de chaque côté).
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

## Tests
- `npm test --workspace modules/fiche/js` (vitest : jeu partagé + fournisseur mémoire) ; `dotnet test LogiBTP.slnx` (projet `LogiBTP.Fiches.Tests`).
- Toute règle de validation modifiée : JS + C# + cas dans `01_validation.json`.
