# Versionnement du schéma de la base par module

> Plan issu de l'[analyse](../ANALYSE-VERSIONNEMENT-SCHEMA.md) validée le 14/11/2026 (décisions au § 9), développement
> lancé le 15/11/2026 (« OK pour l'analyse lance le dev »). Branche `claude/project-thread-w3l2s7`, un commit par lot,
> lots enchaînés sans validation intermédiaire.
>
> Base d'essai dans le conteneur cloud : PostgreSQL 16 local (`localhost:5433`, rôle `logibtp` / `logibtp`,
> superutilisateur) ; la production est en PostgreSQL 17. Les tests qui demandent une base se lancent seulement si la
> variable `LOGIBTP_TEST_PG` (chaîne de connexion Npgsql d'un superutilisateur) est définie ; sinon ils sont ignorés
> (jamais en échec), pour ne pas casser `dotnet test LogiBTP.slnx` sur un poste sans base.

## Rappel des décisions

- Version `majeur.mineur` par module (et `coeur` pour `db/`) ; socle actuel = **1.0** de chaque module, sous les
  chemins actuels (clés `isc_chemin` inchangées).
- Une mineure = un script `<majeur>.<mineur>_<nom>.sql` du dossier `db` du module, appliqué une fois, immuable une fois
  publié ; une base en retard rejoue toutes les mineures manquantes. Majeure : déclenchement manuel ; mineures de la
  majeure précédente gardées ; scripts devenus inutiles archivés (`db/archive/`).
- Ordre calculé par le moteur ; `db/installation/scripts.txt` **généré**, versionné, contrôlé en CI.
- Rejouables rejoués quand leur empreinte change (et après toute mineure du module ou d'un module requis).
- Dérive montrée comme une fusion git, mise à jour forçable avec motif, décision tracée au journal.
- Modifications manuelles admises en développement ; contrôle de publication avant chaque version.
- Retour arrière = sauvegarde complète avant mise à jour puis restauration ; pas de `revert`.
- Pas de DDL au démarrage de l'API ; conversion des métrés archivée ; migration C# figée seulement pour une reprise
  impossible en SQL ; hors transaction interdit sauf exception signalée.
- Champs supplémentaires : seules les tables des fiches, colonnes `x_` ; tables d'intégrateur à préfixe déclaré,
  jamais touchées.
- Outil maison (module Installation, sans métier).

Précision apportée par le plan (lot 1) : la dérive est classée **en conflit** quand un objet attendu est modifié ou
absent (nos scripts peuvent le supposer), **sans conflit** quand un objet est seulement ajouté (colonne, table, index,
vue). Détecter précisément les objets touchés par chaque script demanderait d'analyser le SQL : écarté.

## Lots

| Lot | État | Titre |
|---|---|---|
| 0 | FAIT | Ordre de l'installeur, marquages `rejouable`, rejeu vérifié |
| 1 | FAIT | Instantané du schéma, dérive, forçage tracé, préfixes d'intégrateur |
| 2 | À FAIRE | Données de démonstration séparées (indicateur `demo`) |
| 3 | À FAIRE | Versions par module : socle 1.0, journal enrichi, `v_version_module`, `installation etat` |
| 4 | À FAIRE | Mineures, plan calculé, `scripts.txt` généré, verrou, empreinte bloquante, rejouables sur changement |
| 5 | À FAIRE | Fin du DDL au démarrage ; conversion des métrés archivée ; migrations C# figées |
| 6 | À FAIRE | Version attendue par l'API, base en retard refusée proprement, page Installation |
| 7 | À FAIRE | Champs supplémentaires des fiches (`x_`) : base et serveur |
| 8 | À FAIRE | Champs supplémentaires : écran d'administration et affichage dans les fiches |
| 9 | À FAIRE | Passage d'un module en majeure, archivage, contrôle de publication |

(États tenus à jour à la fin de chaque lot.)

### Lot 0 – Ordre de l'installeur, marquages `rejouable`, rejeu vérifié

- **Module** : Installation (+ en-têtes et manifeste du cœur).
- **Fichiers** : `modules/installation/dotnet/LogiBTP.Installation/BaseDonnees.cs`, `ManifesteScripts.cs`,
  `db/installation/scripts.txt`, tests `LogiBTP.Installation.Tests`.
- **Contenu** :
  1. `AppliquerAsync` parcourt le manifeste **dans son ordre** : un non-rejouable absent du journal est appliqué à sa
     place, un rejouable est joué à sa place (et non plus « tous les non-rejouables puis tous les rejouables »). Même
     ordre que `initialiser-developpement.sh`.
  2. Repérage **empirique** des scripts réellement rejouables : sur une base neuve construite par le manifeste, chaque
     script non marqué est rejoué deux fois ; il devient `rejouable` s'il passe sans erreur, ne change ni le schéma ni
     les données (comparaison `pg_dump` normalisé) **et** ne contient pas d'`ON CONFLICT … DO UPDATE` sur des données
     que la société peut modifier (revue de chaque cas). Les scripts générés `db/121`, `db/131`, `db/191` deviennent
     `rejouable` (leur réécriture est voulue). Les en-têtes « Rejouable » des scripts qui ne le sont pas sont
     corrigés.
  3. Test d'intégration (`LOGIBTP_TEST_PG`) : base neuve par `AppliquerAsync` = base neuve par l'ordre du manifeste
     (même schéma) ; une seconde application ne change rien ; tout rejouable joué deux fois ne change rien.
- **Critère de fin** : `dotnet test modules/installation/dotnet/LogiBTP.Installation.Tests` vert, tests d'intégration
  verts avec `LOGIBTP_TEST_PG`.
- **Réalisé** : 61 scripts nouvellement `rejouable` (58 de pur DDL + 121, 131, 191) ; les en-têtes des scripts déjà
  appliqués ne sont **pas** retouchés (leur empreinte au journal changerait) : le manifeste fait foi. 267 et 287,
  anciens rejouables dont le rejeu à leur place échoue, prennent l'indicateur `ex-rejouable` (inscrits sans exécution
  sur une base déjà installée, appliqués sur une base neuve).

### Lot 1 – Instantané du schéma, dérive, forçage tracé, préfixes d'intégrateur

- **Module** : Installation.
- **Contenu** :
  1. `InstantaneSchema` : lecture normalisée du catalogue du schéma `public` (tables, colonnes : type, nullabilité,
     défaut ; contraintes : `pg_get_constraintdef` ; index : `pg_get_indexdef` ; vues : `pg_get_viewdef` ; fonctions :
     signature + empreinte de la source ; déclencheurs), sérialisée en JSON stable (ordre binaire).
  2. Table `installation_schema` (une ligne par mise à jour : date, instantané, empreinte) écrite par le moteur après
     chaque application réussie.
  3. `Derive` : comparaison de deux instantanés → écarts `ajoute` (sans conflit) / `modifie` / `supprime` (en conflit),
     objet par objet, avec définition attendue et réelle ; objets `x_` et préfixes déclarés ignorés.
  4. Table `installation_prefixe` (préfixe, intégrateur, date) ; commande `installation prefixe ajouter <prefixe>
     --integrateur <nom>` (refus d'un préfixe pris, trop court ou qui recouvre un préfixe de LogiBTP : liste tirée des
     tables existantes) ; dépendances d'objets préfixés vers nos objets (`pg_depend`) rapportées comme écarts en
     conflit.
  5. `installation base mettre-a-jour` : contrôle de dérive avant d'appliquer (instantané stocké ↔ catalogue réel) ;
     écarts en conflit → arrêt avec rapport en trois colonnes (attendu / réel / effet de la mise à jour : « script à
     appliquer » ou « inchangé ») ; `--forcer --motif "…"` passe outre et inscrit au journal (`installation_forcage` :
     qui — utilisateur système —, quand, base, écarts JSON avec définitions écrasées, motif).
  6. `installation base comparer --base A --reference B` (développement, contrôle de publication) et `adopter`
     vérifié : sans `--confirmer-sans-controle`, `adopter` construit une base de référence temporaire par le manifeste,
     compare et refuse en cas d'écart.
- **Critère de fin** : tests unitaires de `Derive` (ajout, modification, suppression, préfixes ignorés) ; test
  d'intégration : colonne ajoutée à la main → sans conflit ; vue modifiée → refus, puis forçage inscrit au journal.
- **Réalisé** : `InstantaneSchema`, `DeriveSchema`, `JournalSchema` (tables `installation_schema`, `installation_prefixe`,
  `installation_forcage` créées par le code), `ControleSchema` (contrôle, comparaison, base de référence temporaire) ;
  l'instantané est inscrit à la fin de chaque `AppliquerAsync` (adoption comprise). Commandes `base mettre-a-jour
  [--forcer --motif]` (code 2 si arrêt), `base comparer`, `base adopter [--confirmer-sans-controle]` (l'ancien
  `--confirmer` disparaît), `prefixe ajouter`. Préfixe : minuscules, chiffres, `_`, 3 caractères au moins, finit par `_`.
  Effet d'un écart en conflit : « script à appliquer » si un script en attente ou rejouable cite le nom de l'objet,
  sinon « inchangé » (repérage par texte, sans analyse SQL).

### Lot 2 – Données de démonstration séparées

- **Module** : cœur (`db/`) + Installation (indicateur).
- **Contenu** : nouvel indicateur de manifeste `demo` ; les scripts de démonstration (116, 141, 161, 163, et la partie
  démonstration de 120 et 211 extraite dans des scripts `*_demo.sql`) ne sont appliqués qu'avec `--demo` (base de
  démonstration, e2e) et toujours par `initialiser-developpement.sh` ; les données de référence dont dépendent les
  scripts suivants restent hors démonstration (211 ne dépend plus de 141). TODO « séparer la démonstration » soldé.
- **Critère de fin** : base neuve sans `--demo` construite sans erreur et sans tiers, chantier ni salarié fictif ;
  base avec `--demo` identique à l'actuelle (instantané du lot 1).

### Lot 3 – Versions par module

- **Module** : Installation.
- **Contenu** :
  1. Module d'un script déduit de son chemin (`modules/<m>/db/…` → `m`, `db/…` → `coeur`) ; tous les scripts actuels
     = version `1.0` de leur module.
  2. Journal enrichi (`ALTER TABLE installation_script ADD COLUMN IF NOT EXISTS`) : `isc_module`, `isc_version`,
     `isc_type` (`socle`, `mineure`, `rejouable`, `zone`), `isc_origine` (`logibtp`), `isc_duree_ms`,
     `isc_version_produit` ; lignes existantes complétées à la première mise à jour.
  3. Vue `v_version_module` (module, version courante = plus haute version appliquée) ; `installation etat` affiche
     les versions par module de chaque base ; version produit tirée de `Directory.Build.props` (ou d'un fichier
     `db/installation/version.txt`).
- **Critère de fin** : bases existantes reconnues en 1.0 sans réapplication (test d'intégration) ; `installation etat`
  liste les versions.

### Lot 4 – Mineures, plan calculé, `scripts.txt` généré

- **Module** : Installation.
- **Contenu** :
  1. Mineure : fichier `modules/<m>/db/<majeur>.<mineur>_<nom>.sql` (ou `db/…` pour le cœur), en-tête
     `-- requiert: document 1.2, stock 1.1` facultatif, `-- hors-transaction` exceptionnel ; ordre numérique dans le
     module.
  2. Ordre du socle 1.0 figé dans `db/installation/socle-1.0.txt` (copie du manifeste actuel) ; plan = socle, puis
     mineures en tri topologique (`requiert`, à égalité module puis version, ordre binaire), puis rejouables de fin.
  3. Commande `installation manifeste generer` (et `npm run manifeste`) qui écrit `scripts.txt` ; test CI : le fichier
     généré est à jour, graphe sans cycle, `requiert` vers une version existante.
  4. Verrou consultatif (`pg_advisory_lock`) pendant la mise à jour d'une base ; empreinte d'un script publié
     modifiée = **erreur** (fin de l'avertissement) ; rejouables rejoués seulement si leur empreinte a changé ou si
     une mineure de leur module (ou d'un module requis) vient d'être appliquée (empreinte des rejouables au journal).
  5. Règles d'écriture ajoutées au `CLAUDE.md` du module Installation et à `db/CLAUDE.md`.
- **Critère de fin** : test d'intégration avec deux mineures fictives de deux modules (dont un `requiert`) : ordre
  respecté, base montée = base neuve ; rejouable non rejoué sans changement.

### Lot 5 – Fin du DDL au démarrage ; conversion des métrés archivée ; migrations C# figées

- **Module** : cœur (`src/LogiBTP.Api`) + Installation.
- **Contenu** : `ConversionMetresBases` retiré de `Program.cs` et de la commande `conversions` (aucune base ne garde
  l'ancien format), fichier déplacé dans `documentation/archive/` (hors compilation) avec une note ; type
  `MigrationCode` (interface du module Installation : version, module, `ExecuterAsync(NpgsqlConnection, transaction)`)
  joué par le moteur à sa place dans le plan ; règle « figée » documentée. Les conversions d'empreintes restent dans la
  mise à jour.
- **Critère de fin** : API qui démarre sans DDL ; `dotnet test LogiBTP.slnx` vert.

### Lot 6 – Version attendue par l'API, base en retard refusée, page Installation

- **Module** : socle / cœur (`src/`, `client/`).
- **Contenu** : versions attendues par module générées dans l'image (ressource embarquée depuis le plan) ; au
  démarrage et à la première requête d'une société, comparaison avec `v_version_module` : base en retard → 503
  `BASE_A_METTRE_A_JOUR` (code dans `Codes.cs` / `codes.js`) pour cette société seulement ; caches par base vidés
  après mise à jour ; page `/parametres/installation` : versions par module, dernière mise à jour, forçages.
- **Critère de fin** : test serveur : base en retard → 503 explicite, autre société servie ; page affichée (textes par
  `texte()`).

### Lot 7 – Champs supplémentaires des fiches : base et serveur

- **Module** : Fiche (+ cœur pour la liste des tables).
- **Contenu** : registre `fiche_champ_supplementaire` (table, colonne `x_…`, type, libellé, ordre, actif) ; fonction
  `SECURITY DEFINER` (propriétaire `logibtp_schema`) qui ajoute ou retire une colonne `x_` nullable, seulement sur les
  tables des fiches déclarées, aux types permis (texte, nombre, montant, date, case à cocher, liste de valeurs) ;
  routes d'administration (`u.ExigerAdmin()`, nœud de droits, type d'écriture déclarés) ; cache des colonnes de
  `ServiceFiche` / `ServiceListe` invalidé ; les colonnes `x_` sont ignorées par la dérive et conservées par les
  mises à jour (test : table témoin reprise par une mineure fictive).
- **Critère de fin** : champ créé par la route, visible dans la définition de la fiche, conservé après une mise à jour.

### Lot 8 – Champs supplémentaires : écran et affichage

- **Module** : cœur (`client/`).
- **Contenu** : écran d'administration des champs supplémentaires par fiche (création, libellé, type, ordre,
  suppression avec `confirmer`) ; affichage et saisie dans les fiches ; colonnes disponibles dans les listes. Règles
  d'interface du projet (`texte()`, `icone()`, `creerCombo`, `activerDates`).
- **Critère de fin** : `npm test` vert ; essai e2e ou manuel décrit.

### Lot 9 – Majeure, archivage, contrôle de publication

- **Module** : Installation.
- **Contenu** : commande `installation module majeure <module>` (développement) : fusion des mineures `N.x` dans un
  script de création `N+1.0` pour les bases neuves, mineures `N.x` gardées pour les bases existantes, mineures `N-1.x`
  déplacées dans `db/archive/`, plancher = `N.0` (refus clair d'une base plus ancienne) ; commande `installation
  publier --verifier --base <dev>` : base neuve construite par le moteur + montée depuis la version précédente,
  comparées entre elles et à la base de développement (P37) ; documentation `documentation/modules/INSTALLATION.md`.
- **Critère de fin** : test d'intégration sur un module témoin : montée 1.x → 2.0 et installation neuve 2.0 donnent le
  même instantané ; base en 0.x refusée avec message.
