# LogiBTP – analyse du versionnement du schéma de la base (version par module)

> Analyse finalisée le 14/11/2026 avec les réponses de l'utilisateur (décisions au § 9). Le développement commencera
> après les tests e2e restants, lot par lot, chaque lot validé avant le suivant (plan au § 10).
> Point de départ : module Installation ([ANALYSE-MODULE-INSTALLATION.md](ANALYSE-MODULE-INSTALLATION.md)
> § 6.3 et § 7.2 ; `modules/installation/dotnet/LogiBTP.Installation/BaseDonnees.cs`, `ManifesteScripts.cs` ;
> `src/LogiBTP.Api/Btp/CommandeInstallation.cs`), entrée « Module de gestion des versions de la base » de `TODO.md`.

## 1. Demande

Rendre les futures mises à jour du schéma de la base **versionnables**, avec :

1. un **numéro de version par module** (et non un seul numéro global) ;
2. des mises à jour faciles, **même avec des sauts de version** (une base en document 3 qui passe directement en
   document 9) ;
3. des **zones supplémentaires** créées en plus des versions (ajouts propres à une société ou à un intégrateur, qui
   doivent survivre aux mises à jour) ;
4. le scénario **open source** : le projet (licence MIT) est repris par un autre projet, qui le fait évoluer de son
   côté, et une partie de ses évolutions est **reprise dans le nôtre** ;
5. la liste des **problèmes** que l'on rencontrera, des **limites**, et des **principes les plus utilisés**.

Reste à faire selon le TODO : scripts rejouables, numéro de version lisible, retour arrière sans restauration.

## 2. Ce qui existe

### 2.1 Mécanisme actuel

| Élément | Rôle | Où |
|---|---|---|
| Manifeste `db/installation/scripts.txt` | Ordre unique des scripts (290 lignes, ~275 scripts distincts), indicateur `rejouable` | lu par l'installeur et la base de développement |
| Journal `installation_script` | `isc_chemin` (clé), `isc_empreinte` (SHA-256, fins de ligne normalisées), `isc_applique_le` | créé par `BaseDonnees.AppliquerAsync` |
| `installation base creer` / `mettre-a-jour` | applique les scripts absents du journal, puis **rejoue tous** les scripts `rejouable` ; un script déjà appliqué dont l'empreinte a changé est **signalé, pas rejoué** | `CommandeInstallation.cs` |
| `installation base adopter --confirmer` | base créée hors installeur : tous les scripts inscrits **sans exécution** ni vérification | idem |
| Une transaction par script | atomicité du script et de son inscription | `ExecuterScriptAsync` |
| Conversions C# (`ConvertirAsync`, `ConversionMetresBases`) | reprises de données au démarrage ou à la mise à jour, avec du DDL en C# (`ALTER TABLE metre ADD COLUMN IF NOT EXISTS…`) | `src/LogiBTP.Api/Btp` |
| Sauvegarde + retour à l'image précédente | retour arrière par **restauration** | `MettreAJour-LogiBTP.ps1`, `mettre-a-jour-logibtp.sh` |
| Test `Manifeste_couvre_tous_les_scripts_du_depot` | tout `.sql` de `modules/*/db` et `db/` est au manifeste | `LogiBTP.Installation.Tests` |

### 2.2 Constats (relevés dans le dépôt le 14/11/2026)

1. **Numérotation globale partagée par tous les modules** : plages 004–099 pour 30 modules, puis 100–310 pour le cœur.
   Les plages sont épuisées, d'où les suffixes de lettres (`019b` à `019r` pour Document, `099f` à `099x` pour
   Facture électronique, Rentabilité, Relance, MCP). Le numéro ne dit ni le module, ni sa version.
2. **Rejouabilité hétérogène** : 78 scripts marqués `rejouable` ; ~170 autres disent « Rejouable » dans leur en-tête
   sans être marqués (ex. `db/121`, `db/131`, `db/236` à `db/248`, `db/288`) ; les scripts fondateurs (`010`, `100`,
   `110`, démos `116`, `141`…) ne le sont pas (`CREATE TABLE` sans `IF NOT EXISTS`, `INSERT` sans `ON CONFLICT`).
3. **Scripts modifiés après application** : `db/121`, `db/131`, `db/191` (paramétrage des listes, fiches, éditions)
   sont **générés** et réécrits à chaque évolution (6, 7 et 4 commits) ; l'installeur les signale « modifiés » et ne
   les rejoue pas, d'où les consignes manuelles « rejouer 121, 131, 191 ».
4. **Ordre différent entre la base de développement et l'installeur** : `initialiser-developpement.sh` suit l'ordre
   du manifeste ; `AppliquerAsync` applique **tous** les non-rejouables puis **tous** les rejouables. Un script
   non rejouable qui dépend d'un objet créé par un rejouable antérieur passe en développement et échoue (ou se
   comporte autrement) sur une installation neuve. Non constaté à ce jour, mais rien ne l'empêche.
5. **Bricolages d'ordre** en fin de manifeste : `019n` et `176` rejoués une seconde fois « en dernier » parce que les
   objets dont ils dépendent sont créés après eux (dépendance module → cœur à rebours de l'architecture).
6. **Données de démonstration mêlées aux données de référence** (116, 141, 161, 163, une partie de 120 et 211) :
   toute base neuve les reçoit (TODO).
7. **Bases de développement sans journal** (`logibtp`, `logibtp_demo`) : scripts appliqués à la main par
   `docker exec … psql -f`, erreurs possibles (279 passé par erreur), `adopter` impossible à vérifier.
8. **Le cœur modifie les tables des modules** (`ALTER TABLE` du cœur, règle du projet) et **les modules dépendent du
   cœur** à l'exécution des scripts (point 5) : la version d'un module ne décrit pas à elle seule le schéma de ses
   tables.
9. **Vues reprises en cascade** : 96 scripts emploient `CASCADE`, les reprises de vue doivent ajouter les colonnes en
   fin de liste (`CREATE OR REPLACE VIEW`, ex. `v_pointages_retenus` reprise de 202 dans 288).
10. **DDL hors manifeste** : conversions C# au démarrage de l'API, sous un rôle qui n'est pas propriétaire.
11. **Modules facultatifs** : leurs tables existent toujours (`module_societe`, `db/193`), l'activation est
    fonctionnelle. Bon point pour le versionnement (§ 5.9).
12. Versions des paquets JS des modules (`0.1.0` / `0.2.0`) sans lien avec le schéma ; aucune version .NET.

En résumé : le journal et les empreintes sont une bonne base (c'est déjà le cœur de Flyway), mais il manque
**l'identité par module**, **l'ordre par dépendances**, une **vraie sémantique des scripts rejouables** et la
**vérification de l'état réel** de la base.

## 3. Vocabulaire proposé

| Terme | Sens |
|---|---|
| **Migration** | script versionné, appliqué **une seule fois**, **immuable** une fois publié |
| **Script rejouable** | script idempotent (vues, fonctions, données de référence générées) **rejoué quand son empreinte change** |
| **Version d'un module** | numéro de la dernière migration appliquée du module (ex. `document 42`) ; version lisible du produit = liste des versions des modules |
| **Socle de départ** (baseline) | état de référence d'un module à une date donnée, d'où partent les migrations suivantes |
| **Zone supplémentaire** | objet (colonne, table, vue, index, donnée) ajouté hors des versions, propre à une société ou à un intégrateur |
| **Origine** | projet qui a écrit une migration (`logibtp`, un projet dérivé, une société) |
| **Dérive** | écart entre le schéma réel d'une base et celui que ses versions annoncent |

## 4. Principes et outils les plus utilisés

### 4.1 Outils de référence

| Outil | Principe | À retenir pour LogiBTP |
|---|---|---|
| **Flyway** | scripts `V<version>__nom.sql` appliqués une fois, `R__nom.sql` **rejoués quand l'empreinte change**, toujours après les `V` ; table `flyway_schema_history` (version, empreinte, durée, succès) ; `validate` refuse un script modifié ; `baseline` pour une base existante ; `outOfOrder` pour une migration insérée sous une version déjà passée ; `undo` (payant) | sémantique `V` / `R`, empreinte bloquante, baseline. Limite : **une seule séquence de versions** par historique (un historique par module = plusieurs tables ou une colonne module) |
| **Liquibase** | *changesets* identifiés par `id + auteur + fichier` (pas par un numéro), `DATABASECHANGELOG`, **préconditions** (« seulement si la colonne n'existe pas »), `runOnChange`, `contexts` / `labels` (ex. `demo`), bloc `rollback` par changeset, verrou `DATABASECHANGELOGLOCK` | identité **par nom** et non par numéro (essentiel pour les dérivés), contextes pour la démonstration, préconditions, verrou |
| **Sqitch** | fichier de plan, chaque changement a `deploy` / `revert` / `verify`, **dépendances déclarées** (`requires`, `conflicts`) y compris **entre projets** (`autre_projet:changement`), étiquettes de version, *rework* d'un changement | **graphe de dépendances entre modules** au lieu d'un ordre global, script `verify` |
| **Alembic** (Python) | révisions identifiées par un hachage, `down_revision` forme un **graphe** ; branches, **têtes multiples**, migrations de fusion, `branch_labels` par composant | identifiants non séquentiels, fusion de branches parallèles : exactement le cas du projet dérivé |
| **Django / Rails** | migrations **par application** avec dépendances entre applications ; `squashmigrations` + `replaces` (une migration compactée remplace une série, les bases qui avaient la série sont reconnues) | **compactage avec équivalences** (`replaces`) pour les sauts de version et pour reprendre les migrations d'un dérivé |
| **Drupal** | `hook_update_N` **par module**, version de schéma stockée par module, `hook_update_dependencies` entre modules, `post_update` après toutes les mises à jour, `hook_update_last_removed` : **version minimale** d'où l'on peut monter | le plus proche de la demande : version par module + version plancher pour les sauts |
| **Odoo** (ERP modulaire) | version de module `17.0.1.2.0` dans le manifeste ; scripts `pre-` / `post-` / `end-migrate` **par version** joués en chaîne lors d'un saut ; identifiants de données `module.nom` (`ir_model_data`), données `noupdate` (jamais écrasées) ; champs personnalisés préfixés **`x_`** (`x_studio_`) jamais touchés par les mises à jour | le plus proche pour les **zones supplémentaires** et la **distinction données de référence / paramétrage modifié par la société** |

### 4.2 Techniques

1. **Migrations immuables + empreinte** : une migration publiée ne change plus ; une correction est une nouvelle
   migration. L'empreinte rend la règle vérifiable (déjà en place, mais seulement en avertissement).
2. **Scripts rejouables / idempotents** : `CREATE OR REPLACE`, `IF NOT EXISTS`, `ON CONFLICT`, blocs `DO` avec test
   au catalogue. Indispensables pour les vues, fonctions, droits et données de référence générées.
3. **Expand / contract** (« changement parallèle ») : on **ajoute** d'abord (colonne nouvelle, double écriture,
   reprise des données), on **retire** l'ancien seulement dans une version **ultérieure**, quand plus aucun binaire
   ne l'emploie. Rend l'ancien binaire compatible avec le nouveau schéma : retour arrière = remettre l'image
   précédente, **sans** défaire le schéma.
4. **Baseline / compactage** : à une version donnée, les migrations d'un module sont fondues en un script de création
   (installation neuve rapide) ; les anciennes migrations restent livrées pendant une **fenêtre de saut** puis sont
   retirées (version plancher).
5. **Graphe de dépendances** : chaque migration (ou chaque module) déclare ce qu'elle requiert ; l'ordre est un **tri
   topologique** déterministe (à égalité : module puis numéro, ordre binaire).
6. **Verrou** : `pg_advisory_lock` pendant la mise à jour d'une base (deux installeurs ou une API qui démarre).
7. **Vérification de dérive** : comparer le schéma réel (catalogue, `pg_dump --schema-only` normalisé) au schéma
   attendu pour les versions annoncées ; base de l'`adopter` sûr et du contrôle avant mise à jour.
8. **Tests de chemin** : en intégration continue, « installation neuve » et « montée depuis chaque version
   supportée » doivent donner **le même schéma** ; tout rejouable joué deux fois ne change rien.
9. **Espace de noms** pour ce qui n'est pas à nous : préfixe réservé (`x_`), schéma PostgreSQL séparé, identifiants
   `origine:module:nom`.
10. **Contextes** : démonstration, développement, tests (Liquibase `contexts`), au lieu de scripts mêlés.

## 5. Problèmes que l'on rencontrera

### 5.1 Identifier et numéroter

- **P1 – Collision de numéros** : avec une séquence par module (`document/0043`), deux branches (ou deux projets)
  créent chacune `0043`. Avec un projet dérivé, c'est certain. → Identité = **module + nom** (ou hachage), le numéro
  ne sert qu'à l'ordre lisible ; le contrôle de collision se fait à la fusion (test CI).
- **P2 – Migration insérée « dans le passé »** : une branche fusionnée après une autre apporte `0042` alors que la
  base est en `0043`. Flyway le refuse sauf `outOfOrder`. → Décider : renumérotation obligatoire avant fusion, ou
  application hors ordre tolérée si les dépendances sont satisfaites.
- **P3 – Version lisible ≠ nombre de scripts** : l'utilisateur veut lire « Document 3.2 » ; un numéro de migration
  n'est pas une version produit. → Version du module = **numéro de sa dernière migration** ; versions publiées
  (étiquettes) = correspondance « LogiBTP 2026.12 = document 43, stock 12… ».
- **P4 – Reprise de l'existant** : 275 scripts au nom actuel figurent déjà dans `installation_script` des bases
  installées ; renommer ou déplacer un fichier change sa clé. → Les scripts actuels deviennent le **socle de départ**
  de chaque module, sous leur nom actuel (le chemin donne déjà le module), sans renommage.

### 5.2 Ordre et dépendances entre modules

- **P5 – Le cœur modifie les tables des modules** : une migration du module qui renomme ou retire une colonne casse
  les vues et `ALTER TABLE` du cœur. → Les migrations du cœur déclarent `requiert document >= 43` ; un module ne
  retire jamais une colonne sans phase *contract* annoncée.
- **P6 – Dépendances à rebours** (module → cœur, cas `019n`, `176` rejoués en fin de manifeste) : interdites par
  l'architecture mais réelles. → Ces scripts passent dans le cœur, ou en rejouables joués **après toutes les
  migrations**.
- **P7 – Cycles** : A requiert B 5, B 6 requiert A 3 : le graphe doit rester acyclique **au niveau des migrations**,
  pas seulement des modules (sqitch). → Test CI du graphe.
- **P8 – Ordre non déterministe** : deux migrations indépendantes de deux modules : l'ordre doit être stable sur toutes
  les machines (ordre binaire des noms, jamais celui de la locale : règle déjà appliquée au manifeste).
- **P9 – Divergence développement / installeur** (constat 4) : il faut **un seul moteur** d'application, utilisé
  partout (développement, tests, installation, CI).

### 5.3 Rejouabilité

- **P10 – Rejouer tout à chaque mise à jour** (comportement actuel) coûte de plus en plus cher et **réécrit des
  données** : 11 scripts font `ON CONFLICT … DO UPDATE` sur des données de référence que la société a pu modifier.
  → Rejouer **seulement quand l'empreinte change** (Flyway `R`), et distinguer données de référence « à nous »
  (rejouées) et paramétrage modifié par la société (jamais écrasé : Odoo `noupdate`, déjà fait pour les vues de
  liste de `121`).
- **P11 – Un rejouable dépend d'objets modifiés par une migration** : la vue doit être recréée même si son script n'a
  pas changé (colonne d'une table retypée). → Rejouer les rejouables d'un module dès qu'une migration du module (ou
  d'un module requis) a été appliquée, ou les rejouer tous mais **après** toutes les migrations.
- **P12 – Limites de `CREATE OR REPLACE VIEW`** : impossible de retirer ou retyper une colonne, colonnes ajoutées en
  fin seulement ; sinon `DROP … CASCADE`, qui détruit silencieusement les vues dépendantes, **y compris celles des
  zones supplémentaires**. → Interdire `CASCADE` dans les migrations publiées ou le contrôler (liste des
  dépendants par `pg_depend` avant/après), et recréer dans l'ordre.
- **P13 – Idempotence fausse** : un script « rejouable » qui ne l'est pas vraiment (ex. `UPDATE` de reprise qui
  s'applique deux fois). → Test « joué deux fois = même schéma, mêmes données ».
- **P14 – Scripts générés** (`121`, `131`, `191`) : ce sont des rejouables par nature ; aujourd'hui non marqués,
  donc signalés « modifiés » à chaque évolution.

### 5.4 Sauts de version

- **P15 – Migrations qui dépendent du code courant** : une conversion C# écrite pour la version 5 et jouée lors d'un
  saut 3 → 9 voit les entités et règles de la version 9. → Migrations en **SQL** autant que possible ; une migration
  C# est **figée** (aucune dépendance aux entités, services ou règles courantes) et versionnée comme un script.
- **P16 – Fenêtre de saut** : garder toutes les migrations depuis le début alourdit l'installation et les tests ;
  compacter coupe les vieilles bases. → **Version plancher** par module (Drupal `last_removed`) : en dessous,
  passer d'abord par une version intermédiaire publiée (message clair de l'installeur).
- **P17 – Durée et verrous** : un saut cumule des reprises de données lourdes (tables de pointage, lignes de
  documents) ; `ALTER TABLE` prend un verrou exclusif. Acceptable en installation sur site (API arrêtée), à
  mesurer sur une grosse base.
- **P18 – Ordre des modules lors d'un saut** : la migration 7 du cœur a été écrite quand Document était en 30 ;
  rejouée lors d'un saut, Document est peut-être déjà en 43 (si on applique module par module). → Tri topologique
  global, **migration par migration**, pas « tout Document puis tout le cœur ».

### 5.5 Retour arrière

- **P19 – Scripts « down » peu fiables** : rarement testés, impossibles quand la migration détruit (colonne
  supprimée, données fusionnées). → **Décision : pas de scripts `revert`** ; sauvegarde complète avant la mise à
  jour, retour arrière = restauration de cette sauvegarde (§ 7.8).
- **P20 – Retour partiel** : une base passée, une autre en échec (multi-société) : chaque base a sa sauvegarde ;
  l'API refuse proprement une base qui n'est pas à la version attendue (P33).

### 5.6 Zones supplémentaires

- **P21 – Collisions de noms** : une société crée `sal_badge` ; une version suivante crée `sal_badge` à son tour
  (`ADD COLUMN IF NOT EXISTS` passe alors silencieusement sur une colonne d'un autre type). → **Espace de noms
  réservé** : préfixe `x_` (colonnes, tables, vues, index) que nos migrations n'emploient jamais (test CI), ou
  schéma PostgreSQL `ext` pour les tables et vues.
- **P22 – Contraintes qui cassent nos écritures** : colonne ajoutée `NOT NULL` sans défaut, déclencheur, contrainte
  `CHECK` ou clé étrangère sur nos tables → nos `INSERT` (EF, scripts de reprise) échouent. → Règles : colonnes
  `x_` nullables ou avec défaut, pas de déclencheur ni de contrainte sur nos colonnes, contrôle avant mise à jour.
- **P23 – Dépendances sur nos objets** : une vue `x_` qui lit `v_liste_documents` bloque sa reprise, ou disparaît par
  `CASCADE`. → Zones déclarées (registre), retirées puis recréées automatiquement autour d'une mise à jour, ou
  dépendre seulement de vues publiées « stables ».
- **P24 – Où vivent leurs scripts** : hors du dépôt LogiBTP (propres à la société) mais appliqués par le même moteur
  et inscrits au même journal, avec leur origine (`societe:<code>` ou `integrateur:<nom>`) et leurs dépendances
  (`requiert document >= 43`).
- **P25 – Exposition dans l'application** : `ServiceFiche` lit `information_schema.columns` (cache par base) ;
  une colonne `x_` peut donc apparaître dans les fiches et listes si elle est déclarée, mais le cache doit être
  vidé après une mise à jour ou une création de zone. EF ignore les colonnes inconnues (bien), mais une vue reprise
  par `SELECT *` les embarquerait (à proscrire).
- **P26 – Sauvegarde / restauration** : réglé par la décision du 14/11/2026 : la base entière est sauvegardée,
  zones comprises (registre des champs dans la base). Reste à vérifier qu'une restauration suivie d'une mise à jour
  reconnaît les champs `x_` et les tables d'intégrateur (test de bout en bout).
- **P26 b – Création de colonnes depuis l'interface** : DDL déclenché par un utilisateur, alors que l'API n'est pas
  propriétaire et que le projet interdit le DDL hors du moteur. → Fonction `SECURITY DEFINER` bornée (préfixe,
  tables permises, types permis, nullable) ou file traitée par le moteur ; verrou court sur la table (à faire hors
  des heures de saisie pour les grosses tables) ; droit d'administration requis (`u.ExigerAdmin()`).

### 5.7 Projet dérivé (fork) et reprise de ses évolutions

- **P27 – Deux historiques divergents** : le dérivé ajoute ses migrations dans nos dossiers (`document/0043` chez lui
  ≠ `document/0043` chez nous). Ses bases ont son historique. → Identité par **origine + module + nom**, et
  recommandation publique : un dérivé ajoute ses migrations sous **sa propre origine** (dossier ou module
  d'extension), sans toucher nos séquences.
- **P28 – Reprendre une de leurs migrations** : on l'intègre chez nous (renommée, retouchée) ; une base du dérivé qui
  rejoint LogiBTP l'a déjà, sous un autre nom → double application. → Mécanisme **d'équivalence** (Django
  `replaces`) : notre migration déclare `remplace derive_x:document/0043` (et empreintes acceptées).
- **P29 – Même changement écrit deux fois différemment** (ils ajoutent `sal_badge TEXT`, nous `sal_badge
  VARCHAR(20)`) : l'équivalence ne suffit pas, il faut une migration de **convergence** (vérifier, retyper).
  Coût humain inévitable.
- **P30 – Leurs conventions** (préfixes, nommage, numérotation) peuvent différer : ce qu'on reprend passe par nos
  règles (CLAUDE.md : snake_case préfixé, codes, manifeste…).
- **P31 – Licence MIT** : le dérivé n'a **aucune obligation** de publier ses changements ni de suivre nos règles ;
  la reprise est volontaire, au cas par cas (attribution conservée). On ne peut garantir qu'une chose : que **notre**
  format soit simple à suivre et documenté (fichier `CONTRIBUER` / guide des migrations).
- **P32 – Retour d'une base dérivée chez nous** : possible seulement si elle n'a pas de migration contraire aux
  nôtres ; il faut un **rapport de compatibilité** (migrations inconnues, équivalences, dérive) avant toute
  adoption.

### 5.8 Plusieurs sociétés (une base par société)

- **P33 – Bases à des versions différentes** après un échec partiel : l'API doit savoir, par base, si la version
  est celle attendue par le binaire. → Versions attendues **embarquées dans l'image** ; au démarrage et par requête
  (`SocieteCourante`), une base en retard est refusée proprement (503 avec message) au lieu d'erreurs SQL.
- **P34 – Caches singleton indexés par base** (règle du projet) : à invalider après mise à jour de la base
  concernée.
- **P35 – Une société ajoutée plus tard** : base créée à la version courante (socle de départ + migrations), pas en
  rejouant l'histoire depuis 2026.

### 5.9 Modules facultatifs

- **P36** : installer le schéma d'un module seulement s'il est activé simplifierait les petites bases, mais crée des
  bases de formes différentes, des dépendances optionnelles, et une activation qui devient une migration.
  → Garder la règle actuelle : **toutes les tables existent toujours**, l'activation reste fonctionnelle.

### 5.10 Développement et exploitation

- **P37 – Bases de développement modifiées à la main** : **admis** pendant le développement et les tests internes
  (décision du 14/11/2026) ; en revanche, **au déploiement d'une version, tout changement doit être documenté**,
  c'est-à-dire porté par une migration ou un rejouable du dépôt. Risque : une modification faite à la main et
  oubliée passe en développement, puis manque chez le client. → **Contrôle de publication** : avant de publier une
  version, une base neuve construite **uniquement** par le moteur (installation neuve, et montée depuis la version
  précédente) est comparée à la base de développement (contrôle de dérive, § 4.2 point 7) ; tout écart non porté
  par un script bloque la publication. Les bases de développement peuvent ensuite être recréées ou adoptées
  après ce contrôle.
- **P38 – Migration en cours d'écriture** : sur une branche, on la retouche souvent ; l'immutabilité ne vaut qu'après
  **publication** (fusion dans `main` ou étiquette). → Empreintes publiées dans un fichier verrou
  (`db/versions.lock` ou équivalent) comparé en CI ; en développement, une migration non publiée modifiée est
  rejouée sur demande (« défaire puis rejouer » ou recréation de la base).
- **P39 – Démonstration** mêlée à la référence (constat 6) : à séparer en **contexte** `demo` (appliqué aux bases
  de démonstration et e2e seulement), sinon chaque base de client reçoit des chantiers fictifs.
- **P40 – Instructions non transactionnelles** dans PostgreSQL 17 : `CREATE INDEX CONCURRENTLY`, `VACUUM`,
  `ALTER SYSTEM`, `CREATE DATABASE`, et l'emploi dans la même transaction d'une valeur ajoutée par
  `ALTER TYPE … ADD VALUE`. → Indicateur « hors transaction » par migration, rare et revu.
- **P41 – Concurrence** : deux mises à jour simultanées, ou l'API qui démarre et convertit pendant la mise à jour.
  → Verrou consultatif, et aucune DDL au démarrage de l'API (les conversions passent dans la mise à jour, déjà
  prévu au § 7.2 de l'analyse Installation).
- **P42 – Droits** : migrations sous `logibtp_schema`, API sous `logibtp_app` ; tout nouvel objet doit recevoir ses
  droits (déjà fait par `DroitsBasesAsync`), y compris les zones supplémentaires et le schéma `ext`.
- **P43 – Dérive en production** : un intervenant corrige « vite » en SQL ; la version annonce un schéma qui n'est
  pas le vrai. → Contrôle de dérive avant chaque mise à jour, présenté **comme une fusion git** (décision du
  14/11/2026) :
  - **écarts montrés** objet par objet, en trois colonnes : attendu par la version annoncée / réel dans la base /
    ce que la mise à jour va faire ; classés en *sans conflit* (l'écart ne touche aucun objet modifié par la mise à
    jour : colonne ou index ajouté ailleurs, zone `x_`) et *en conflit* (la mise à jour touche l'objet modifié à la
    main : vue reprise, colonne retypée, contrainte) ;
  - sans conflit : la mise à jour passe, l'écart est rapporté ;
  - en conflit : arrêt par défaut, avec trois choix par écart, comme une résolution de conflit : **forcer** (la mise
    à jour écrase l'objet), **garder** (l'écart est conservé et déclaré en zone supplémentaire, si c'est possible
    sans casser la mise à jour), **abandonner** ;
  - **forcer est tracé** : décision inscrite au journal (qui, quand, base, écarts concernés avec leur définition
    avant écrasement, motif saisi obligatoire), reprise dans le rapport de mise à jour et dans `installation etat` ;
    option de ligne de commande explicite (`--forcer <écart>|--forcer-tout --motif "…"`), jamais par défaut ;
  - la définition écrasée est sauvegardée (DDL extrait du catalogue) pour pouvoir la recréer ou en faire un script.

## 6. Limites (ce qu'aucun système ne résout)

1. **Retour arrière sans restauration** n'est possible que pour des changements additifs ou conçus en
   expand/contract ; une donnée détruite ou fusionnée ne revient que par la sauvegarde.
2. **Sauts illimités** : on supporte la majeure courante et la précédente (§ 7.1) ; au-delà, montée en deux temps.
3. **Fusion automatique avec un dérivé** : l'outil détecte, l'équivalence évite la double application, mais la
   convergence de deux changements différents reste un travail humain.
4. **Zones supplémentaires sans règles** : une zone qui pose une contrainte ou un déclencheur sur nos tables peut
   toujours casser une mise à jour ; on ne peut que l'interdire, la détecter et la signaler.
5. **Idempotence** : on peut la tester, pas la prouver ; les reprises de données restent des migrations uniques.
6. **Durée** : une migration lourde sur une grosse base reste longue ; l'outil ne fait que la mesurer et l'annoncer.
7. **Compatibilité ascendante du code** : l'expand/contract impose une discipline sur deux versions (colonne
   gardée, double écriture) ; elle coûte du code temporaire.

## 7. Principe retenu

### 7.1 Versions majeur.mineur par module (décisions 2 et 4)

- Chaque module (et le cœur, module `coeur`) a une version **`majeur.mineur`** : `document 1.4`, `coeur 1.12`.
- **Le socle de départ devient la version majeure 1.0** de chaque module : tous les scripts actuels, sous leur chemin
  actuel (clés `isc_chemin` inchangées pour les bases déjà installées).
- **Une version mineure = un script de montée** (`1.1`, `1.2`…), appliqué une seule fois, immuable une fois publié.
  Une base qui saute des versions **rejoue toutes les mineures** manquantes, dans l'ordre.
- **Version majeure suivante** (`2.0`, déclenchement **manuel**, par nous, module par module) :
  les mineures `1.x` sont **fondues** dans le script de création `2.0` (installation neuve rapide), mais **restent
  livrées** pendant toute la majeure 2 : une base en `1.3` monte en `1.x` dernière puis passe en `2.0` sans
  réexécuter la création. **Version plancher = début de la majeure précédente** : une base en majeure N-2 passe par
  une version publiée intermédiaire (message clair de l'installeur).
- **Archivage** : à chaque montée de majeure, les scripts qui ne servent plus (mineures de la majeure N-2) passent
  dans `db/archive/` du module : jamais exécutés, gardés pour la trace (le journal des bases y renvoie toujours).
- Ordre des mineures : **numérique** (`1.9` avant `1.10`), jamais l'ordre alphabétique ; fin des suffixes de
  lettres.
- **Version produit** (lisible pour le client) : étiquette de publication qui liste les versions des modules
  (« LogiBTP 2026.12 : coeur 1.12, document 1.4, stock 1.2… »), affichée dans `installation etat` et
  `/parametres/installation`.

### 7.2 Organisation des fichiers

```
modules/document/db/
  module.json            ← { "module": "document", "version": "1.4", "requiert": { "socle": "1.0" } }
  1.0/…                  ← socle de départ (scripts actuels 010… 019r, sous leur chemin actuel)
  1.1_<nom>.sql          ← mineures, une par fichier, immuables une fois publiées
  rejouables/…           ← vues, fonctions, données de référence générées : rejouées quand leur empreinte change
  demo/…                 ← contexte démonstration (bases de démonstration et e2e seulement)
  archive/…              ← mineures des majeures retirées (trace, jamais exécutées)
db/ (cœur)               ← même organisation, module « coeur »
```

Le déplacement physique des scripts actuels sous `1.0/` est facultatif : le moteur peut les lire là où ils sont
(chemin = clé du journal) ; à trancher au lot 3 selon le coût pour les bases installées.

En-tête normalisé de chaque mineure, lu par le moteur : `-- requiert: document 1.4, stock 1.2`,
`-- contexte: demo`, `-- hors-transaction` (§ 7.5).

### 7.3 Ordre : plan calculé et fichier généré relu (décision 3, recommandation)

Le plus simple à **entretenir** est que personne n'écrive l'ordre à la main ; le plus simple à **contrôler** est de
le voir. Recommandation : les deux.

- Dans un module, l'ordre est celui des versions ; entre modules, il découle des `requiert` des en-têtes (tri
  topologique, à égalité ordre binaire des noms de module).
- Le moteur **génère** `db/installation/scripts.txt` (le manifeste actuel devient un fichier généré, toujours lu
  par la base de développement et l'installeur) ; il est **versionné** : chaque ajout de script se voit dans le diff
  de la PR.
- Un test CI régénère le fichier et échoue s'il diffère (oubli de génération), si le graphe a un cycle, ou si une
  version publiée a changé d'empreinte.
- Plus de bricolages en fin de manifeste (`019n`, `176` rejoués « en dernier ») : ces scripts deviennent des
  rejouables, joués après toutes les mineures.

### 7.4 Journal

Évolution de `installation_script` (clé actuelle conservée pour les bases existantes) :

| Colonne | Sens |
|---|---|
| `isc_module`, `isc_version`, `isc_nom` | identité et ordre lisible (`document`, `1.4`, `taux_tva`) |
| `isc_origine` | `logibtp` aujourd'hui ; réservé à un projet tiers ou à une société (§ 7.7) |
| `isc_type` | `socle`, `mineure`, `rejouable`, `zone`, `forcage` |
| `isc_empreinte`, `isc_applique_le`, `isc_duree_ms`, `isc_version_produit` | traçabilité |
| `isc_motif`, `isc_auteur` | forçage d'un écart (P43) : qui, pourquoi, définition écrasée |

Plus une vue `v_version_module` (module → version courante) lue par `installation etat`, `/parametres/installation`
et l'API au démarrage (base en retard refusée proprement, P33).

### 7.5 Hors transaction et migrations C# (décision 7, recommandation)

- **Hors transaction : interdit par défaut.** La mise à jour se fait API arrêtée, donc `CREATE INDEX CONCURRENTLY`
  n'apporte rien ; le projet emploie des contraintes `CHECK` plutôt que des types `ENUM` (pas d'`ALTER TYPE … ADD
  VALUE`). L'indicateur `-- hors-transaction` existe pour un cas exceptionnel, signalé en revue et dans le rapport.
- **Migrations C# : admises seulement pour une reprise de données impossible en SQL**, sous ces conditions : déclarées comme une mineure (`document 1.5 : classe ConversionXxx`), exécutées par
  le moteur à leur place dans l'ordre, sous `logibtp_schema`, dans la transaction de la mineure ; **figées** (aucune
  dépendance aux entités, services ou règles courantes, pour rester justes lors d'un saut de version).
- **Plus aucun DDL au démarrage de l'API.** Conversion des métrés en scripts (`ConversionMetresBases`) : **aucune
  base ne garde l'ancien format** (décision du 14/11/2026) ; la conversion est **archivée** (retirée du démarrage et du
  code actif, gardée pour la trace), seule la méthode actuelle reste. Les autres conversions de `ConvertirAsync`
  (empreintes de la clé des données) restent dans la commande de mise à jour.

### 7.6 Moteur (module Installation, sans métier, outil maison : décision 9)

1. Verrou consultatif ; lecture du journal ; **contrôle de dérive** (objets attendus présents, aucun objet non
   déclaré hors `x_` et préfixes d'intégrateur), écarts montrés comme une fusion git, forçage possible et tracé
   (P43) ; refus d'une version publiée modifiée (empreinte : erreur, plus avertissement).
2. **Sauvegarde complète de la base** juste avant (décision 5, § 7.8).
3. Plan : mineures manquantes, triées ; contrôle du plancher.
4. Application mineure par mineure (une transaction chacune), puis rejouables concernés, puis droits.
5. Rapport : versions avant / après par module, durées, écarts, forçages.
6. Un seul moteur pour : installation, mise à jour, développement (`logibtp`, `logibtp_demo`), e2e, CI.

### 7.7 Projet repris par un tiers (décision 6 : ne pas fermer de porte)

Rien n'est développé pour l'instant ; on garde seulement les portes ouvertes **côté base** (la reprise du code se fait
par modification de notre projet ou ajout de module) :

- Le tiers ajoutera probablement **une surcouche de modules spécifiques** pour garder nos évolutions : un module tiers
  a sa propre version `majeur.mineur` et ses `requiert` vers nos modules ; le moteur le traite comme les nôtres.
- Colonne `isc_origine` dès le lot 3 (toujours `logibtp`), identité **module + version + nom**, préfixes réservés par
  origine : de quoi ajouter plus tard les équivalences (`remplace:`) et le rapport de compatibilité (P27–P32) sans
  changer le format.

### 7.8 Retour arrière (décision 5)

- **Sauvegarde complète de chaque base avant la mise à jour** (déjà faite par `MettreAJour-LogiBTP.ps1` et
  `mettre-a-jour-logibtp.sh`), le retour arrière étant la **restauration de cette sauvegarde** avec l'image
  précédente. Pas de scripts `revert`.
- Limite à connaître : une restauration après reprise du travail perd les saisies faites depuis la mise à jour ; le
  retour se décide donc au contrôle qui suit la mise à jour (`/api/sante`, essai rapide), et le rapport le rappelle.
- L'expand/contract reste une **bonne pratique** (retrait d'une colonne dans une mineure ultérieure), sans être une
  obligation.

### 7.9 Zones supplémentaires (décision 1 : les deux sortes)

**a) Champs supplémentaires définis dans l'interface** : ils créent de **vraies colonnes dans nos tables**.
- Préfixe réservé `x_` (ex. `x_sal_badge`), que nos scripts n'emploient jamais (test CI).
- Création **par le moteur** et non par l'API directement : l'API tourne sous `logibtp_app`, qui n'est pas
  propriétaire ; la création passe par une fonction `SECURITY DEFINER` (propriétaire `logibtp_schema`) qui
  n'accepte qu'un `ADD COLUMN x_…` nullable aux types permis, sur les tables ouvertes aux champs supplémentaires
  (**seules les tables des fiches**, décision du 14/11/2026 : liste déclarée par le cœur à partir des fiches),
  droit d'administration requis ; types proposés : texte, nombre, montant, date, case à cocher, liste de valeurs.
- Registre des champs (table, colonne, type, libellé, fiche / liste où il apparaît) et inscription au journal
  (`isc_type = zone`) ; cache des colonnes par base (`ServiceFiche`, `ServiceListe`) invalidé à la création.
- Nos mises à jour **conservent** ces colonnes ; une reprise de table par nos scripts (rare : recréation, renommage)
  doit les reporter, contrôle par test (table témoin avec une colonne `x_`).
- Suppression d'un champ depuis l'interface : colonne retirée, avec confirmation (données perdues).

**b) Tables propres d'un intégrateur** (synchronisation avec un autre logiciel…) :
- Préfixe obligatoire de l'intégrateur (ex. `int_<nom>_`), déclaré, refusé s'il est déjà pris ou proche d'un préfixe
  de LogiBTP.
- **Nous n'y touchons jamais** lors des mises à jour : le contrôle de dérive les ignore, aucun script ne les lit ni
  ne les modifie.
- Seul point surveillé : **leurs dépendances vers nos objets** (clé étrangère vers nos tables, vue sur nos vues,
  déclencheur sur nos tables), listées avant la mise à jour (`pg_depend`) et traitées comme un écart en conflit
  (P43 : montrer, forcer tracé).
- Les droits de `logibtp_app` sur ces tables relèvent de l'intégrateur.

**Sauvegarde** : la **base entière** est sauvegardée, champs supplémentaires et tables d'intégrateur compris ; le
registre des champs est dans la base, il suit la sauvegarde.

### 7.10 Règles d'écriture (à ajouter au CLAUDE.md à la mise en œuvre)

- Une version publiée est immuable ; correction = nouvelle mineure.
- Tout changement de schéma déployé est porté par un script (P37) ; modifications manuelles admises en développement.
- Pas de `CASCADE` dans une mineure sans liste des dépendants vérifiée.
- Vues, fonctions, droits, données de référence générées : rejouables.
- Préfixes `x_` et d'intégrateur jamais employés par nos scripts.
- Pas de DDL en C# hors du moteur ; une migration C# est figée.

## 8. Transition (décision 8 : maintenant, le schéma est jugé sain pour une première version)

1. Chaque module reçoit la **version 1.0 = ses scripts actuels**, sous leur chemin actuel.
2. Corriger les marquages (`rejouable` des ~170 scripts qui le sont vraiment, `121` / `131` / `191` en rejouables
   générés, `019n` et `176` en rejouables de fin) et l'ordre de l'installeur.
3. Séparer la démonstration.
4. Bases de développement : contrôle de dérive contre une base construite par le moteur, puis adoption vérifiée en
   1.0 ; ensuite, modifications manuelles admises en développement, contrôle de publication à chaque version (P37).
5. Toute évolution suivante = mineure `1.x` du module concerné.

**Préalable (décision 10)** : les tests e2e restant à créer sont faits **avant** le développement de ce chantier ;
ils servent de filet pour la transition (base reconstruite par le moteur, e2e verts).

## 9. Décisions (14/11/2026) et points restants

| # | Question | Décision |
|---|---|---|
| 1 | Zones supplémentaires | Les deux : champs de l'interface en colonnes `x_` de nos tables ; tables d'intégrateur à préfixe, jamais touchées ; base entière sauvegardée (§ 7.9) |
| 2 | Format de version | `majeur.mineur` par module ; version produit qui les liste (§ 7.1) |
| 3 | Ordre | Plan calculé par le moteur + `scripts.txt` généré, versionné et contrôlé en CI (§ 7.3) |
| 4 | Sauts de version | Socle = 1.0 ; mineures rejouées en chaîne ; mineures de la majeure précédente gardées ; scripts devenus inutiles archivés (§ 7.1) |
| 5 | Retour arrière | Sauvegarde complète avant mise à jour, retour = restauration ; pas de `revert` (§ 7.8) |
| 6 | Projet repris | Pas maintenant ; portes ouvertes côté base (origine, identité, modules tiers en surcouche) (§ 7.7) |
| 7 | Hors transaction, C# | Hors transaction interdit sauf exception signalée ; C# figé pour les seules reprises de données impossibles en SQL ; conversion des métrés archivée (aucune base à l'ancien format) ; plus de DDL au démarrage de l'API (§ 7.5) |
| 11 | Champs supplémentaires | Seules les tables des fiches (§ 7.9) |
| 12 | Déclenchement d'une majeure | Manuel, par nous, module par module (§ 7.1) |
| 8 | Calendrier | Transition maintenant (§ 8) |
| 9 | Outil | Maison (module Installation) |
| 10 | Préalable | Tests e2e restants d'abord, développement ensuite |

Aucun point bloquant restant. À préciser au lot 7 : liste exacte des types de champ (proposition au § 7.9).

## 10. Plan en lots (à valider ; développement après les tests e2e)

| Lot | Contenu | Module | Critère de fin |
|---|---|---|---|
| 0 | Marquages `rejouable` corrigés (dont 121/131/191 générés, 019n et 176 en fin), installeur qui respecte l'ordre du manifeste, test « joué deux fois » des rejouables | Installation + cœur + modules (en-têtes) | base neuve par l'installeur = base de développement (schéma identique) |
| 1 | Contrôle de dérive (schéma réel ↔ base construite par le moteur), écarts présentés comme une fusion git, forçage tracé (motif, auteur, définition écrasée) ; `adopter` vérifié ; contrôle de publication (P37) | Installation | écart volontaire détecté, forçage inscrit au journal, rapport vide après ajout du script manquant |
| 2 | Séparation de la démonstration (contexte `demo`) | cœur | base de client sans données fictives, e2e verts |
| 3 | Versions `majeur.mineur` : `module.json`, socle 1.0 de chaque module, journal enrichi (`isc_module`, `isc_version`, `isc_origine`…), `v_version_module`, version produit dans `installation etat` et `/parametres/installation` ; adoption de `logibtp` et `logibtp_demo` | Installation + cœur (page) | versions par module affichées, bases existantes reconnues sans réapplication |
| 4 | Mineures : en-têtes `requiert`, plan calculé, `scripts.txt` généré et contrôlé en CI, ordre numérique, verrou, empreinte bloquante, rejouables sur changement d'empreinte ; sauvegarde avant mise à jour dans le moteur | Installation | CI : graphe acyclique, fichier généré à jour, montée 1.0 → courante = installation neuve |
| 5 | Migrations C# figées prises en charge par le moteur ; conversion des métrés archivée (retirée du démarrage, gardée pour la trace) ; plus de DDL au démarrage | Installation + cœur | API qui démarre sans DDL ; tests verts sans l'ancienne conversion |
| 6 | Versions attendues embarquées dans l'image, base en retard refusée proprement (503 explicite), caches par base invalidés | socle + cœur | base en retard → message clair, autres sociétés servies |
| 7 | Zones supplémentaires : (a) champs de l'interface en colonnes `x_` des tables des fiches (fonction bornée, registre, caches, affichage fiches et listes) ; (b) préfixes d'intégrateur déclarés, ignorés par la dérive, dépendances signalées | Installation + fiche + liste + cœur | champ créé depuis l'interface et table d'intégrateur témoin conservés après une montée avec reprise de vue et après restauration |
| 8 | Majeure et archivage : outil de passage d'un module en 2.0 (fusion des 1.x, plancher, `archive/`), essayé sur un module témoin dans une branche d'essai | Installation | montée 1.0 → 2.0 et 1.x → 2.0 vertes en CI ; refus clair depuis une majeure trop ancienne |

Le scénario du projet repris par un tiers n'a pas de lot : les portes restent ouvertes par les lots 3 et 4 (§ 7.7).
