# Reprise d'une base MDE ou OptimBTP dans une nouvelle base LogiBTP

> Analyse : [ANALYSE-IMPORT-MDE-OPTIM.md](../ANALYSE-IMPORT-MDE-OPTIM.md). Les réponses de l'utilisateur sont au § 10 et
> priment sur le reste de l'analyse. Analyse validée et développement lancé le 16/11/2026 (« ok go pour le dev »).
> Branche `claude/project-thread-ivj09j`, un commit par lot ; les lots s'enchaînent.
>
> Règles communes à tous les lots :
> - **Aucune écriture vers la base source.** Les tests n'utilisent jamais les bases de l'utilisateur : ils montent des
>   bases sources de test construites par les scripts du lot 0 (conteneurs SQL Server 2022 et MariaDB 11.2).
> - Tests de base facultatifs : ils ne tournent que si `LOGIBTP_TEST_MSSQL` (MDE), `LOGIBTP_TEST_MARIADB` (OPTIM) ou
>   `LOGIBTP_TEST_PG` (cible) sont définies. Sinon ils sont ignorés, jamais en échec.
> - Le module Import reste **sans métier BTP**. Il fournit le moteur de reprise : correspondances, lecteurs de tables,
>   table de correspondance, rapport et simulation. Les correspondances vers nos codes (`TYPE_DOCUMENT`, natures,
>   casquettes) et l'écriture des domaines sont dans le cœur (`src/LogiBTP.Api/Reprise/`).
> - Codes (sources, anomalies, sorts des champs) : `modules/import/js/src/codes.js` ↔ `Codes.cs` du module, avec la
>   parité testée par `CodesTests`.
> - Nouveau SQL : une mineure du module, puis `npm run manifeste`.
> - Montants en `decimal` (C#) ; un `double` source est converti une seule fois, par l'arrondi unique.

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 0 | Correspondances par défaut, bases sources de test | `modules/import` + cœur | — | FAIT |
| 1 | Moteur de reprise : table de correspondance, rapport, simulation | `modules/import` | 0 | FAIT |
| 2 | Lecteurs de source SQL Server et MariaDB (lecture seule, en flux), commande de l'installeur | `modules/import` + cœur | 1 | À FAIRE |
| 3 | Écran « Reprise de données » : simulation, rapport, fusions, lancement | `modules/import` + cœur | 2 | À FAIRE |
| 4 | Société et référentiels | cœur | 2 | À FAIRE |
| 5 | Champs supplémentaires des fiches | cœur | 4 | À FAIRE |
| 6 | Annuaire, toutes adresses et contacts, fusion des doublons | cœur | 4 | À FAIRE |
| 7 | Ressources | cœur | 6 | À FAIRE |
| 8 | Bibliothèque | cœur | 6 | À FAIRE |
| 9 | Structure : projets, affaires, chantiers, marchés | cœur | 7, 8 | À FAIRE |
| 10 | Pièces de vente, ligne d'écart d'arrondi | cœur + `modules/import` | 9 | À FAIRE |
| 11 | Situations et avancement | cœur | 10 | À FAIRE |
| 12 | Achats et sous-traitance | cœur | 10 | À FAIRE |
| 13 | Règlements et échéances | cœur + `modules/reglement` | 11, 12 | À FAIRE |
| 14 | Exploitation : pointage, planning, stock, consommations | cœur | 12 | À FAIRE |
| 15 | Recette de la phase 1, documentation | documentation + tests | 14 | À FAIRE |
| 16 | Phase 2 : GED et notes | cœur | 15 | À FAIRE |
| 17 | Phase 2 : tables `PP_*` de MDE vers les ordres et la synthèse | cœur | 15 | À FAIRE |

---

## Lot 0 : correspondances par défaut, bases sources de test

- **Module** : `modules/import` (format et validation du fichier de correspondances) et cœur (fichiers de
  correspondances, qui citent nos codes).
- **Fichiers** :
  - `modules/import/dotnet/LogiBTP.Import/` : nouveau projet, contenant `Codes.cs`, `Reprise/Correspondances.cs`
    (modèle, chargement, validation) et `Reprise/SourceReprise.cs` (MDE, OPTIM).
  - `modules/import/dotnet/LogiBTP.Import.Tests/`.
  - `modules/import/js/src/codes.js`.
  - `src/LogiBTP.Api/Reprise/Correspondances/mde.json` et `optim.json`.
  - `tests/reprise/` : DDL des bases sources, générées depuis les catalogues des analyses ; jeux de données réduits ;
    script de montage ; générateur.
- **Contenu** :
  1. Format du fichier de correspondances. Il contient `source` (MDE | OPTIM), `version`, et des `tables` de
     correspondance nommées (types de pièces, états, types de lignes, types de tiers, tiers payeurs, factures,
     avancement, arrondis, compteurs, regroupements de natures, catégories de tiers…). Chaque table associe une valeur
     source à une cible : `{ "source": "DC", "cible": "V_DEVIS" }`, ou bien `{ "source": …, "ignorer": true,
     "motif": "…" }`. OPTIM se rapproche par `PRM_TypeParam` + `PRM_Code`, jamais par `PRM_ID`.
  2. Validation : source connue ; tables attendues présentes ; aucune valeur source en double dans une table ; une
     entrée porte une cible ou `ignorer` (jamais les deux) ; une cible appartient à la liste des cibles admises que
     fournit l'appelant (le cœur passe ses codes `TYPE_DOCUMENT`, sa liste de casquettes…). Les erreurs sont des
     codes (`ERREUR_CORRESPONDANCE`), avec l'emplacement.
  3. Fichiers par défaut : les énumérations MDE du § 10.3 de l'analyse ; pour OPTIM, les types de pièces (`VDE_Type_ID`,
     `DOE_Type`), types de pièces ignorés (Q16), regroupements des natures `ref_famille_type`, catégories de tiers
     `ref_categ`.
  4. Bases sources de test. Un générateur (`tests/reprise/generer-ddl.py`) lit les catalogues des analyses (tables,
     colonnes, types, nullabilité, identité, clé primaire) et produit `tests/reprise/mde/schema.sql` (T-SQL) et
     `tests/reprise/optim/schema.sql` (MariaDB), sans clés étrangères (l'import ne doit pas les supposer). Des jeux
     réduits `donnees.sql` sont écrits à la main pour chaque domaine : société, référentiels, deux clients dont un
     aussi fournisseur, plusieurs adresses et contacts, salariés, bibliothèque avec ouvrage, affaire, chantier,
     devis, situation, facture, achat. Le script `tests/reprise/monter.sh` lance les conteneurs (ports 14330 et
     33060) et charge schéma puis données.
- **Réalisé (16/11/2026)** : projet `LogiBTP.Import` (codes, `FichierCorrespondances`), 12 tests du module ;
  `src/LogiBTP.Api/Reprise/CorrespondancesReprise.cs` et fichiers par défaut embarqués (MDE : 12 tables, OPTIM : 6),
  validés contre les codes du dépôt (types de documents de tous les scripts SQL, `TL`, casquettes, types de liens,
  regroupements, natures de notes). Bases de test : 192 tables MDE et 195 OPTIM générées. Écart au plan : le jeu
  `donnees.sql` du lot 0 couvre société, référentiels et annuaire (doublons, adresses et contacts multiples, zones
  supplémentaires, établissements d'un même SIRET) ; **chaque lot de domaine complète le jeu** de ses tables. Codes
  inconnus des sources : `MODEP` des règlements MDE et `DTB_DataType` d'OPTIM (type déduit de la colonne de valeur
  renseignée).
- **Critère de fin** : fichiers par défaut validés par un test ; tests de validation (doublon, cible inconnue, table
  manquante) ; parité des codes ; bases de test montées sans erreur par `monter.sh` dans le conteneur cloud.

## Lot 1 : moteur de reprise

- **Module** : `modules/import` (+ `modules/installation` pour la commande).
- **Contenu** :
  1. Mineure `modules/import/db/1.1_reprise.sql` avec trois tables : `import_reprise` (une ligne par exécution :
     source, sociétés, mode simulation ou réelle, dates, auteur, état, rapport jsonb), `import_correspondance`
     (reprise, table source, clé source, table cible, id cible ; unique sur source + table + clé) et
     `import_fusion` (groupes de doublons retenus).
  2. Contrat des domaines, côté module : `IDomaineReprise` (code, dépendances, `LireAsync` → `EcrireAsync` dans l'unité
     d'écriture du socle), registre des correspondances en mémoire et en base, `RapportReprise` (volumes lus,
     écrits et écartés par table ; valeurs forcées ; écarts d'arrondi ; champs perdus avec le nombre de valeurs non
     vides ; anomalies ; utilisateurs).
  3. Ordonnancement par dépendances ; simulation dans une transaction annulée à la fin ; reprise réelle refusée si la
     base contient déjà des données métier.
  4. Commande `installation societe importer --source mde|optim --connexion <chaîne> [--societes 1,2] [--simulation]
     [--correspondances <fichier>]`, avec le rapport écrit en Markdown.
- **Critère de fin** : reprise à vide (aucun domaine) sur une base neuve, avec rapport produit ; tests du registre, de
  l'ordre et du refus sur une base non vide.
- **Réalisé (16/11/2026)** : mineure `modules/import/db/1.1_reprise.sql` (manifeste régénéré) ; `ILecteurSource` et
  `LigneSource` (vide, 0 et 01/01/1900 = absent, double → décimal par l'arrondi unique à 6 décimales),
  `RegistreCorrespondances`, `RapportReprise` (jsonb et Markdown), `IDomaineReprise`, `ContexteReprise`
  (`Correspondre`, `CleConservee` pour les fusions), `MoteurReprise` ; cœur : `BaseCibleReprise.EstVideAsync`.
  Écarts au plan : **une seule transaction** pour toute la reprise (tout ou rien : un échec laisse la base vide, le
  rapport est enregistré à part) au lieu d'une par domaine ; pas de « modèle pivot » séparé : les domaines lisent les
  `LigneSource` et écrivent directement ; la **commande de l'installeur passe au lot 2** (elle a besoin des
  lecteurs). 15 nouveaux tests, dont 4 sur une base PostgreSQL temporaire (`LOGIBTP_TEST_PG_ADMIN`).

## Lot 2 : lecteurs de source

- **Module** : `modules/import`. Dépendances NuGet `Microsoft.Data.SqlClient` et `MySqlConnector` (puis
  `npm run rapport-dependances`).
- **Contenu** : `ILecteurSource` (ouvrir, tables présentes, comptes de lignes, lecture en flux d'une requête
  constante avec paramètres) ; une implémentation SQL Server et une MariaDB, en lecture seule (transaction en lecture
  seule ou `ApplicationIntent=ReadOnly`, et refus de toute requête qui ne commence pas par `SELECT`) ; filtre par
  `SCT_ID` (OPTIM, liste de sociétés regroupées, R1) ; conversion `double` → `decimal` unique ; inventaire des tables et
  volumes dans le rapport.
  Commande `installation societe importer CODE --source mde|optim --connexion <chaîne> [--societes 1,2]
  [--simulation] [--correspondances <fichier>] [--rapport <fichier.md>]` (reportée du lot 1).
- **Critère de fin** : lecture des deux bases de test ; un test prouve qu'une écriture est refusée avant l'envoi ;
  simulation sans domaine par la commande sur une base neuve, avec rapport.

## Lot 3 : écran « Reprise de données »

- **Module** : `modules/import` (interface et routes) ; le cœur déclare les routes (`SpecialisationDroitsBtp.Routes`,
  `EcrituresBtp.Routes`) et le menu.
- **Contenu** : saisie de la connexion source (jamais conservée en clair), choix des sociétés OPTIM, simulation,
  rapport consultable par section, ajustement des correspondances (fichier téléchargé puis rechargé), **fusions de
  tiers proposées à cocher**, puis lancement de la reprise réelle. Écran réservé à l'administrateur
  (`u.ExigerAdmin()`), et refusé si la base contient des données métier.
- **Critère de fin** : parcours e2e simulation → rapport → reprise sur les bases de test ; aucun texte, icône ni
  couleur en dur ; fenêtres par `<dialog>` du socle.

## Lots 4 à 14 : domaines du cœur

Chaque domaine est une classe `src/LogiBTP.Api/Reprise/<Source>/<Domaine>.cs`, qui lit par le lecteur et écrit par
les services existants du cœur ou par SQL constant paramétré. Le contenu détaillé (tables et champs) est au § 4 de
l'analyse, modifié par le § 10.

- **Lot 4, société et référentiels** : identité ; compteurs repartant après le plus grand numéro (une seule
  numérotation pour les établissements regroupés, R1) ; décimales ; unités ; TVA ; modes et conditions de règlement ;
  pays ; civilités ; plan comptable ; grilles analytiques (Q11) ; natures et familles. *Critère* : référentiels des
  deux bases de test repris.
- **Lot 5, champs supplémentaires** : `z_dataspec_*` et `SYS_RTCINFOS` / `RTCFIELD*` deviennent des champs `x_` des
  fiches (module Fiche) (Q12). *Critère* : champs créés et valeurs reprises.
- **Lot 6, annuaire** : jointure MDE du § 10.2 (Q5), avec toutes les adresses et tous les contacts ; OPTIM
  `bib_tiers`, `bib_tiers_categ`, `bib_personne`, `z_adresse` ; casquettes ; payeurs ; RIB ; facturation
  électronique ; fusion des doublons retenus. *Critère* : fiches, adresses et contacts égaux à la source, moins les
  fusions.
- **Lot 7, ressources** : salariés, intérim, équipes, matériels, habilitations, calendriers ; valeurs forcées listées
  (Q13) ; lien des utilisateurs OPTIM aux fiches (Q20). *Critère* : fiches reprises, liste des valeurs forcées.
- **Lot 8, bibliothèque** : éléments hors sommeil (Q2), ouvrages avec la perte dans les quantités (Q9), modèles de
  texte (`TEXTE`, Q7), conversions d'unités, tarifs fournisseurs. *Critère* : PV d'un ouvrage retrouvé à 0,01 € près.
- **Lot 9, structure** : projets, affaires, chantiers (internes si `CHT_IsChantier = 0`, Q14), marchés, intervenants,
  révision ; établissement d'origine en étiquette (R1). *Critère* : arborescence complète.
- **Lot 10, pièces de vente** : convertisseur commun (réutilisation de `convertirOptim` côté règles, traducteur MDE de
  `eTypeLigneVente`, R3) ; pieds, TVA, versions, métrés, statuts ; ligne d'écart d'arrondi (`lig_is_ecart_arrondi`)
  pour retrouver le montant source ; PV fixe sur les pièces validées ; champs supplémentaires d'en-tête MDE en note
  CRM. *Critère* : total HT et TTC de chaque pièce égal à la source.
- **Lot 11, situations** : avancement (`eTypeAvancement`), factures d'avancement, avoirs, acomptes, retenues ; chaîne
  de liens contrôlée par `eTypeEtatCalcule`. *Critère* : cumul d'avancement égal à la source.
- **Lot 12, achats et sous-traitance** : `A_DEVIS` (demande de prix), commandes, réceptions, retours, factures,
  avoirs, AO, contrats et situations de sous-traitance (R2) ; ventilation par chantier ; types exclus (Q16).
  *Critère* : coûts d'achat par chantier égaux à la source.
- **Lot 13, règlements** : échéanciers, règlements, lettrage, cautions. *Critère* : soldes égaux à la source.
- **Lot 14, exploitation** : pointage en minutes avec les indemnités (Q17), planning, inventaire d'ouverture (Q18),
  consommations non liées à un document (Q15). *Critère* : heures par salarié, chantier et mois égales à la source.

## Lot 15 : recette de la phase 1

Simulation complète des deux bases de test ; documentation (`documentation/modules/IMPORT.md`, `MODULES.md`,
`JOURNAL-LOTS.md`, `TODO.md`, `modules/import/CLAUDE.md`). L'essai sur une copie des bases réelles est fait par
l'utilisateur sur son poste. *Critère* : `npm test` et `dotnet test LogiBTP.slnx` verts.

## Lots 16 et 17 : phase 2

- **Lot 16, GED et notes** : contenus base64 et binaires dédupliqués par empreinte, rangés sous le nom de la base ;
  répertoires ; rattachements polymorphes ; messages et actions vers `crm_note`.
- **Lot 17, tables `PP_*`** : analyse courte, puis alimentation des ordres et de la synthèse par chantier (module
  Exécution).
