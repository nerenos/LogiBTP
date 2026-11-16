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
| 2 | Lecteurs de source SQL Server et MariaDB (lecture seule, en flux), commande de l'installeur | `modules/import` + cœur | 1 | FAIT |
| 3 | Écran « Reprise de données » : simulation, rapport, fusions, lancement | `modules/import` + cœur | 2 | FAIT |
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
- **Réalisé (16/11/2026)** : `Reprise/Lecteurs/` : `LecteurAdo` (commun : une connexion du pool par lecture, les
  domaines peuvent donc imbriquer leurs lectures ; transaction toujours annulée ; `VerifierLecture` refuse tout ce qui
  n'est pas un seul `SELECT` / `WITH` : point-virgule, `INTO`, `INSERT`, `UPDATE` (dont `FOR UPDATE`), `EXEC`,
  `OPENROWSET`, `OUTFILE`… ; `CompterAsync` n'admet qu'une table présente dans la base), `LecteurSqlServer`
  (`ApplicationIntent=ReadOnly`, schéma `dbo`), `LecteurMariaDb` (`START TRANSACTION READ ONLY`, dates zéro → null).
  Cœur (`src/LogiBTP.Api/Reprise/`) : `CiblesReprise` (listes de cibles lues dans la base cible), `RepriseBase`
  (correspondances validées puis moteur ; commun à la commande et au futur écran), `DomainesReprise` (vide, rempli par
  les lots 4 et suivants) ; commande `installation societe importer CODE --source MDE|OPTIM [--connexion C]
  [--societes 1,2] [--reel] [--correspondances F] [--rapport F.md]`. Écarts au plan : **simulation par défaut**,
  `--reel` pour écrire (au lieu de `--simulation`) ; chaîne source aussi par `LOGIBTP_REPRISE_SOURCE` (hors historique
  du shell) ; le filtre par `SCT_ID` reste aux domaines OPTIM (`Options.Societes`). **Globalisation** : le pilote SQL
  Server refuse le mode invariant de `Directory.Build.props` ; `LogiBTP.Api` et les deux projets de tests qui
  l'utilisent passent `InvariantGlobalization` à false (ICU présent dans l'image `aspnet:10.0`), cultures fixées à
  l'invariante au démarrage (`Program.cs`, `CultureTests` des tests). Base MDE de test en `French_CI_AS`. Tests :
  `LecteursTests` (19, dont lecture des deux bases et refus d'écriture) et `RepriseBaseTests` (base neuve par le
  manifeste : cibles, refus d'une base non vide, simulation puis reprise réelle sans domaine pour les deux sources).

## Lot 3 : écran « Reprise de données »

- **Module** : `modules/import` (interface et routes) ; le cœur déclare les routes (`SpecialisationDroitsBtp.Routes`,
  `EcrituresBtp.Routes`) et le menu.
- **Contenu** : saisie de la connexion source (jamais conservée en clair), choix des sociétés OPTIM, simulation,
  rapport consultable par section, ajustement des correspondances (fichier téléchargé puis rechargé), **fusions de
  tiers proposées à cocher**, puis lancement de la reprise réelle. Écran réservé à l'administrateur
  (`u.ExigerAdmin()`), et refusé si la base contient des données métier.
- **Critère de fin** : parcours e2e simulation → rapport → reprise sur les bases de test ; aucun texte, icône ni
  couleur en dur ; fenêtres par `<dialog>` du socle.
- **Réalisé (16/11/2026)** : module : `FusionsReprise` (`Controler`, `LireAsync`, `RemplacerAsync` ; règles répliquées
  dans `js/src/fusions.js`, jeu commun `js/test/fusions-cas.json`), `ExecutionsReprise` (historique, rapport d'une
  exécution), section `doublons` du rapport (`Proposer`, remplie par l'annuaire au lot 6), codes `ERREUR_FUSION`.
  Cœur : `RoutesReprise` (`GET /api/reprise`, `GET /api/reprise/correspondances/{source}`, `POST /api/reprise/executer`,
  `GET /api/reprise/executions/{id}[/markdown]`, `PUT /api/reprise/fusions/{source}` ; `ExigerAdmin`, nœud
  paramétrage, écritures LOT et PARAMETRAGE), `RepriseBase` sur l'unité d'écriture de la requête. Client : page
  `/parametres/reprise` (menu Paramètres), textes `parametres_btp.reprise.*`, icônes `parametres_btp_reprise_*`.
  Écarts au plan : routes et page dans le cœur (comme l'écran Installation : les domaines et la base cible sont du
  cœur), le module fournit les règles et les accès ; exécution **synchrone** dans la requête (une grosse base peut
  prendre plusieurs minutes : passage en tâche de fond à voir au lot 15). Scénario e2e `e2e/reprise.spec.ts` :
  écran refusé sur une base non vide, parcours complet sur une société neuve (`E2E_REPRISE_URL`,
  `E2E_REPRISE_CONNEXION`) ; écrit mais **non joué** dans le conteneur (pas d'API complète), à jouer sur le poste.

## Lots 4 à 14 : domaines du cœur

Chaque domaine est une classe `src/LogiBTP.Api/Reprise/<Source>/<Domaine>.cs`, qui lit par le lecteur et écrit par
les services existants du cœur ou par SQL constant paramétré. Le contenu détaillé (tables et champs) est au § 4 de
l'analyse, modifié par le § 10.

- **Lot 4, société et référentiels** : identité ; compteurs repartant après le plus grand numéro (une seule
  numérotation pour les établissements regroupés, R1) ; décimales ; unités ; TVA ; modes et conditions de règlement ;
  pays ; civilités ; plan comptable ; grilles analytiques (Q11) ; natures et familles. *Critère* : référentiels des
  deux bases de test repris. **FAIT (16/11/2026).**
  - **Réalisé** : module : `Associations` (réplique de `associerUnite`, `associerTaux`, `associerOption`, jeu commun
    `js/test/associations-cas.json`, plus `CodeLibre` : suffixe `_2`, `_3`… sur collision, signalée), `PaysIso` (liste
    de cibles « PAYS »), `RegistreCorrespondances.InscrireCode` / `TrouverCode` (référentiels à code texte, en
    mémoire), `CodeAnomalie` ↔ `CODE_ANOMALIE`. Cœur : `SqlReprise`, `AnnuaireReprise` (personne, coordonnées, servira
    au lot 6), `ReferentielsCible` (rapprocher sinon créer : unité, taux, mode, condition, compte, nature ; pays),
    domaines `SOCIETE` et `REFERENTIELS` par source (`Reprise/Mde/`, `Reprise/Optim/`, clés du registre dans
    `RegistreMde` / `RegistreOptim`). Correspondances : tables `mode_paiement`, `civilite`, `pays` (MDE), `civilite`,
    `pays` (OPTIM) ; listes de cibles `MODE_REGLEMENT` et `CIVILITE` lues en base.
  - Règles : société MDE = `SYS_DEFSTE` (devise ≠ EUR bloquante, décimales signalées) ; OPTIM : SIREN différents
    bloquants, tête = société sans mère retenue, les autres en établissements (`ETABLISSEMENT`, parent = tête), fiches
    `bib_tiers` des sociétés inscrites (le lot 6 ne les reprend pas). TVA : rapprochée par taux et catégorie
    (autoliquidation à 0 % de la source → taux autoliquidé existant), comptes posés s'ils manquent ; OPTIM : taux de
    `z_parametre` retrouvés par les colonnes qui les citent (`PRM_TypeParam` propre à chaque base), catégorie lue dans
    le libellé. Conditions MDE : lignes `APIMODEREGLEMENTL` (NJ, `JOUR` → base JOUR, `MOISENTIER` → FIN_MOIS), égales à
    une condition existante sinon créées ; mode de la première ligne par `mode_paiement`. Plan comptable : type par
    classe et collectifs (comptes des tiers, `CMP_PARAMGEN`), collectifs par type de tiers, journaux et exigibilité ;
    OPTIM : plan commun et des sociétés retenues. Natures OPTIM depuis `ref_famille_type` (regroupement par
    `regroupement_nature`).
  - Écarts : **compteurs reportés au lot 10** (ils repartent après le plus grand numéro repris : il faut les pièces) ;
    **grilles analytiques** sans table cible : gardées dans le paramètre comptable `reprise_analytique` (axes, postes,
    grilles ; codes analytiques des établissements OPTIM), à exploiter par l'export ; natures MDE au lot 8 (types
    d'articles).
- **Lot 5, champs supplémentaires** : `z_dataspec_*` et `SYS_RTCINFOS` / `RTCFIELD*` deviennent des champs `x_` des
  fiches (module Fiche) (Q12). *Critère* : champs créés et valeurs reprises. **FAIT (16/11/2026).**
  - **Réalisé** : `ChampsReprise` (nom `x_` tiré du libellé, sans accents, 41 caractères, suffixe sur collision ;
    création par `fiche_champ_creer` dans la transaction du moteur ; conversion au type ; écriture sur la fiche par
    identifiants contrôlés de `ConstructeurFiche`), domaines `CHAMPS` (MDE : `SYS_RTCINFOS`, tables de fiches par la
    table de correspondance `table_fiche`, type par `type_champ` ; OPTIM : une définition `z_dataspec_bdd` par entité
    citée dans `z_dataspec_data`, table `entite`, type déduit des valeurs) et `VALEURS_CHAMPS`, **déclaré en dernier** :
    il écrit les valeurs sur les fiches que les lots 6 à 9 inscrivent au registre (clé : table source + clé primaire,
    MDE `PMECLIENT`… + CODE, OPTIM `bib_tiers`, `bib_personne`, `ref_salarie`, `bib_materiel`, `bib_article`,
    `afc_affaire`, `afc_chantier` + identifiant). Liste de cibles `TYPE_CHAMP` (types du module Fiche).
  - Les valeurs ne sont écrites qu'à partir du lot 6 (fiches absentes avant) : critère vérifié par les tests des lots
    suivants. Zones des pièces MDE ignorées ici (note CRM aux lots 10 et 12).
- **Lot 6, annuaire** : jointure MDE du § 10.2 (Q5), avec toutes les adresses et tous les contacts ; OPTIM
  `bib_tiers`, `bib_tiers_categ`, `bib_personne`, `z_adresse` ; casquettes ; payeurs ; RIB ; facturation
  électronique ; fusion des doublons retenus. *Critère* : fiches, adresses et contacts égaux à la source, moins les
  fusions. **FAIT (16/11/2026).**
  - **Réalisé** : `TiersReprise` (cœur) écrit un tiers neutre : groupes de fusion par `CleConservee` (table de fusion
    MDE `COMM_TIERS` + CODE, OPTIM `bib_tiers` + TRS_ID ; casquettes, comptes et coordonnées cumulés), doublons
    proposés (SIRET, puis nom + code postal), SIRET unique (le second est retiré, avertissement `REPRISE_SIRET_PRIS`),
    code libre (`CodeLibre`), comptes collectifs créés s'ils manquent, coordonnées dédoublonnées, contacts (individu,
    rattachement, coordonnées du rattachement), payeurs en lien `FACTURER_A` (`REPRISE_PAYEUR_INCONNU` sinon), clés
    d'origine inscrites au registre (valeurs des champs supplémentaires). `AnnuaireMde` : une requête par table de
    rôle jointe à `COMM_TIERS` (tables `type_tiers`, `tiers_payeur`), adresses `COMM_TIERSADR` (facturation,
    livraison, autres), interlocuteurs, activité en catégorie client, rôle G → individu de la société de la base.
    `AnnuaireOptim` : `bib_tiers` (`TRS_IsTiers`), casquettes par `bib_tiers_categ` ⋈ `ref_categ` (table
    `categorie_tiers`), `z_adresse`, courriels de commande et de facturation, `bib_personne`, payeurs `CompteFact` /
    `ComptePaie`, RIB `TRS_NumCpteBq` / `TRS_NumCpteBic`. Collectifs OPTIM corrigés : comptes 40 / 41 du plan hors
    comptes auxiliaires des tiers.
  - **Écarts** : notes du tiers dans `per_commentaire` (pas de note CRM) ; fabricant sans étiquette ; champs de
    facturation électronique et RIB MDE (`IDRIB`) non repris ; chargé d'affaires relié au salarié au lot 7.
- **Lot 7, ressources** : salariés, intérim, équipes, matériels, habilitations, calendriers ; valeurs forcées listées
  (Q13) ; lien des utilisateurs OPTIM aux fiches (Q20). *Critère* : fiches reprises, liste des valeurs forcées.
  **FAIT (16/11/2026).**
  - **Réalisé** : `RessourcesReprise` (cœur) : salarié = individu (rôle SALARIE ou INTERIMAIRE), rattachement à
    l'agence (société de la base ou établissement), fiche `salarie` (code libre, statut CDI / CDD / INTERIM par
    mots-clés, type de MO par la catégorie MDE), mission d'intérim (fin = sortie, sinon 31/12, listée) ; types
    d'habilitations rapprochés par code ou libellé normalisés, sinon créés (catégorie par mots-clés) ; équipes et
    compositions (début = date de reprise) ; matériels (type et énergie des listes `TYPE_MATERIEL` / `ENERGIE`
    rapprochés ou créés sous leur famille, compteur initial, loueur, générique → par nombre, visites → habilitations
    du matériel) ; calendriers rapprochés ou créés avec leurs plages. `RessourcesMde` : `PMESALARIE` ⋈
    `COMM_EMPLOYE`, adresse par la fiche `COMM_TIERS` de type E, **chargé d'affaires relié au salarié de même nom**
    (l'individu du lot 6 devient celui du salarié), `PMEEQUIPE` / `PMESALARIEEQUIPE`, `PMEMATERIEL` /
    `PMETYPEMATERIEL` (véhicule → famille Véhicules, suivi km). `RessourcesOptim` : `svhz_profil_horaire`
    (première période hors absence), `ref_salarie` des sociétés retenues (fonction = poste, `SLR_PRH_ID` →
    calendrier, agence d'intérim `SLR_TRS_ID`), `bib_habilitation` / `ref_salarie_habilitation`, `svh_equipe`,
    `bib_materiel` (famille, type, énergie lus dans `z_parametre` par identifiant), `bib_materiel_visite` ; liste
    des utilisateurs `z_utilisateur` (actifs) et `z_utilisateur_externe` avec la fiche salarié ou individu (Q20).
  - **Écarts** : `sal_salaire`, `mat_valeur_achat` et `mat_date_achat` sont devenus facultatifs dans le schéma : rien
    n'est forcé (Q13 ne vaut plus que pour le service du salarié, la famille du matériel et les dates de mission) ;
    service des salariés absent des deux sources : service CHANTIER (sinon le premier de production), listé ; coût
    horaire OPTIM (article de MO) au lot 8 ; affectation d'un matériel à un salarié (`MTR_SLR_ID`) et chantier du
    matériel (lot 9) non repris ; entretien MDE (`SUIVIENT`…) non repris ; périodes saisonnières d'un profil horaire :
    la première seule (champ perdu au rapport) ; MDE : pas de table d'utilisateurs dans le catalogue, liste vide ;
    photos (GED) au lot 16.
- **Lot 8, bibliothèque** : éléments hors sommeil (Q2), ouvrages avec la perte dans les quantités (Q9), modèles de
  texte (`TEXTE`, Q7), conversions d'unités, tarifs fournisseurs. *Critère* : PV d'un ouvrage retrouvé à 0,01 € près.
  **FAIT (16/11/2026).**
  - **Réalisé** : `Rtf.cs` (module Import) réplique de `rtfEnHtml`, jeu partagé `js/test/rtf-cas.json` (accents
    cp1252 de 0x80 à 0x9F, unicode, groupes ignorés). `BibliothequeReprise` (cœur) : bibliothèques (code au format
    `^[A-Z0-9_]{1,10}$`, renommage signalé), familles en arbre, éléments ARTICLE / OUVRAGE / TEXTE (Q7) ; prix d'un
    article par `CalculElement` (scénario FIXE), d'un ouvrage par `ElementsBibliotheque.CalculerOuvrage` sur une
    composition au format des documents ; **PV source retrouvé à 0,01 € près** dans le premier mode qui y parvient
    (MDE : déboursé D puis vente V ; OPTIM : V), sinon **PV imposé** (PV fixe, coefficient de bénéfice déduit,
    anomalie `REPRISE_PRIX_IMPOSE`) ; **perte (Q9) en `lig_coef_perte` des composantes** (multiplie la quantité ;
    précision de quantité ajustée à la quantité × perte), gardée sur l'article en donnée technique `coef_perte` ;
    unités d'achat et de vente converties (`ele_unites`), unité sans rapport non reprise (`REPRISE_CONVERSION_MANQUANTE`) ;
    nature par défaut d'un élément vendu sans nature (listée) ; tarifs fournisseurs (un seul principal, prix net,
    prix public et remises). `BibliothequeMde` : natures `PMENATUREELEMENT` (regroupement par la nouvelle table
    `regroupement_nature` de `mde.json`), `PMEBIBLIO` (par défaut : celle qui a le plus d'éléments), `PMEFAMILLE`,
    `PMEELEMENT` hors sommeil (type par la composition, sinon la nouvelle table `type_element`), `PMEELEMENTOUVCOMP`,
    `PMEELEMENTUNITEVTE`, `PMEELEMENTARTFOUR` ⋈ `PMEFOURNISSEURTARIF` ; perte d'un élément = DEBOURSE / PA.
    `BibliothequeOptim` : `bib_bibliotheque`, `bib_type_prod_prest`, `bib_article` hors désactivés,
    `bib_article_lien_ouvrage` (quantité fixe → absolue « A »), `bib_article_lien_tarif` (tarif de référence = PA net et
    PV, montant fixe → PV imposé ; tarifs d'un tiers → tarifs fournisseurs ; tarifs d'affaire non repris). Ouvrages
    repris après leurs composantes ; composante absente ou en sommeil : ligne sans lien (`REPRISE_COMPOSANTE_HORS_BIBLIOTHEQUE`).
  - **Écarts et hypothèses à confirmer sur les bases réelles** : codes `TYPEELEM` (tables `regroupement_nature` et
    `type_element` de `mde.json`, notées « à confirmer ») ; MDE : quantité d'une composante = `QUANTITEUNIT`, sinon
    `QUANTITEBASE` ; `RATIOSTOCK`, `RATIOVENTE`, `EQUIVSTOCK` et `RATIO` des tarifs lus comme « quantité en unité de stock
    pour 1 unité » ; OPTIM : prix des tarifs par unité de l'article, `ARL_Conv` / `ARL_UNT_IDConv` = unité d'achat
    déclarée ; coefficient de perte lu en fraction (< 1), coefficient (≤ 3) ou pourcentage, remises en fraction (≤ 1)
    ou pourcentage. Non repris : coefficients par défaut des natures MDE (`COEFFG`, `COEFBEN`), temps de pose et MO de
    pose MDE (`TEMPS`, `CLEMOPOSE`) hors composantes, cadence OPTIM, `ART_TypeGestion` (gestion par la présence de
    tarifs fournisseurs ; stock au lot 13), coût horaire OPTIM des salariés par l'article de MO, métrés types
    (`CLEMETRE`), images (lot 16).
- **Lot 9, structure** : projets, affaires, chantiers (internes si `CHT_IsChantier = 0`, Q14), marchés, intervenants,
  révision ; établissement d'origine en étiquette (R1). *Critère* : arborescence complète. **FAIT (16/11/2026).**
  - **Réalisé** : `StructureReprise` (projets, affaires avec le client en intervenant principal, chantiers, marchés de
    vente `M-<chantier>`, intervenants dédoublonnés, indices rapprochés par code normalisé sinon créés, valeurs
    mensuelles `IMPORT`, formules en fractions ; règles `EtatDe`, `StatutProjetDe`, `StatutChantierDe`, `Fraction`) et
    `DomainesStructure.cs` : `StructureMde` (PMEAFFAIRE close si état non modifiable ou date de clôture, PMECHANTIER
    clos / terminé par l'état ou la date de fin, marché si montant ou signature, public d'après le libellé de
    PMETYPEMARCHE, intervenants cités par colonne), `StructureOptim` (afc_dossier → projets avec maître d'œuvre,
    affaires et chantiers des sociétés retenues, états par le libellé de z_parametre, adresse z_adresse CHT, chantier
    interne si `CHT_IsChantier = 0`, marché si `CHT_TotPVT_Marche`, tiers d'affaire par le premier indicateur vrai et
    leurs contacts, vte_indice / vte_indice_valeur / vte_revision_formule). Table de correspondance
    `fonction_intervenant` (mde.json, optim.json). Tests : `VerifierStructureAsync` (deux sources),
    `StructureRepriseTests`.
  - **Écarts** : pas de table d'étiquettes pour les affaires et chantiers : établissement d'origine (société retenue
    autre que celle de la base) en propriété `etablissement` de `aff_proprietes` / `cha_proprietes` ; lien du marché à
    sa pièce (`mar_ent_id`) et formule de révision des marchés reportés au lot 10 (pièces) ; phases et lots de projet
    non repris ; affaire close sans date et marché sans signature datés du jour de la reprise ; fonctions
    `fonction_intervenant` (FOURNISSEUR → AUTRE, chargé d'affaires MDE ignoré car repris en responsable) à confirmer
    sur une base réelle.
- **Lot 10, pièces de vente** : convertisseur commun (réutilisation de `convertirOptim` côté règles, traducteur MDE de
  `eTypeLigneVente`, R3) ; pieds, TVA, versions, métrés, statuts ; ligne d'écart d'arrondi (`lig_is_ecart_arrondi`)
  pour retrouver le montant source ; PV fixe sur les pièces validées ; champs supplémentaires d'en-tête MDE en note
  CRM. *Critère* : total HT et TTC de chaque pièce égal à la source. **FAIT (16/11/2026).**
  - **Réalisé** : `PiecesReprise` (écriture d'une pièce par `PersistanceDocument` et `MoteurDevisBtp` dans la transaction
    de la reprise : statut, verrouillage, versions groupées avec indice et référence en fin de reprise, numéro source
    gardé, brouillon de facture à numérotation continue sans numéro avec le code source en `ent_notre_reference`,
    adresse de facturation libre, `document_origine` IMPORT, compteurs de numérotation au plus grand rang repris,
    lien du marché à sa pièce ; mode de calcul B : ouvrages et composantes au PVU source en PV fixe, PV fixe sur les
    lignes au montant différent et sur toutes les lignes chiffrées des pièces verrouillées ; ligne racine « Écart de
    reprise » si le total HT diffère encore, rapport `EcartsArrondi` ; écart TTC signalé `REPRISE_ECART_TTC`) et
    `DomainesPieces.cs` : `PiecesVenteMde` (DEVCLI, CDECLI, BLCLI, FACCLI par `type_facture`, état PMEETATDOCUMENT,
    versions par CODEDEVINIT, lignes par `type_ligne_vente`, marché par PMECHANTIER.CLEDOCINIT), `PiecesVenteOptim`
    (vte_doc_entete hors modèles, virtuels, sauvegardes, budgets et sociétés écartées, type par `type_document_vente`,
    statut par le libellé d'état, comptabilisé → verrouillé, versions par type et chrono, règles de `convertirOptim` :
    frais indirects exclus `REPRISE_LIGNE_NON_REPRISE`, quantité fixe absolue, coefficient de vente). Tables de
    correspondance `type_document`, `type_facture`, `type_ligne_vente`, `type_document_vente`. Tests :
    `VerifierPiecesVenteAsync` (deux sources), `PiecesRepriseTests`.
  - **Écarts** : la ligne d'écart est une ligne racine ordinaire (PV fixe, non éditée, propriété `reprise_ecart`) et
    non `lig_is_ecart_arrondi`, que le moteur ignore à la racine ; postes de pied MDE non repris (champ perdu, TTC
    source non contrôlé), métrés, note CRM des champs supplémentaires d'en-tête, liens de transformation
    (`document_lien`) et adresses de vte_doc_tiers reportés ; factures d'avancement MDE (type T) et situations OPTIM
    au lot 11 ; remises et choix du PV MDE (PVU / PVIMPOSE) à confirmer sur une base réelle.
- **Lot 11, situations** : avancement (`eTypeAvancement`), factures d'avancement, avoirs, acomptes, retenues ; chaîne
  de liens contrôlée par `eTypeEtatCalcule`. *Critère* : cumul d'avancement égal à la source. **FAIT (16/11/2026).**
  - **Réalisé** : `PiecesReprise` étendu (`AvancementSource`, `LigneAvancement`) : document d'avancement = copie des
    lignes du marché (devis repris au lot 10, lignes retrouvées par leur clé source `LignePiece.Reference`), chaque ligne
    de prix suivant sa ligne du marché (`lig_avt_source_lig_id`) en montant cumulé (mode M), en % (avancement global,
    mode P) ou au cumul précédent si la source ne la cite pas ; précédent = cumul de la dernière facture d'avancement
    reprise (pièces traitées par date, situation avant facture le même jour) ; présentation C (situation) ou P (facture
    d'avancement) ; dépassement du marché permis s'il existe dans la source ; ligne de la source sans ligne du marché en
    ligne libre (`REPRISE_AVANCEMENT_SANS_MARCHE`) ; liens TRANSFORMATION marché → document et situation → facture ;
    situation facturée au statut FACTURE. `DomainesAvancement.cs` : MDE (PMEDOCSITTX / PMEDOCSITTXLIG : CLEDEVBASE,
    MTSITUATION cumulé, TYPEAVT D par ligne, C et S global par PCAVTCUMUL sur le devis initial du chantier ; factures
    PMEDOCFACCLI de type T par CODESITTX, sinon leurs lignes en période), OPTIM (vte_situation / vte_situation_ligne :
    VSL_VDL_ID, VSL_MtHT cumulé, sinon VSI_Pct_Avct ; pièces « SIT » de vte_doc_entete en factures d'avancement par
    VDE_VSI_ID ; situations désactivées, de sauvegarde ou d'un marché non repris écartées). Table « type_document_vente » :
    SIT → V_FACTURE_AVT, code propre VSI → V_SITUATION. Tests : `VerifierAvancementAsync` (deux sources).
  - **Écarts** : sens des colonnes à confirmer sur une base réelle (MDE : MTSITUATION et PCAVT cumulés, MONTANTHT montant
    du marché ; OPTIM : VSL_MtHT et VSI_MtHT cumulés, pièce « SIT » = facture de la période) ; `document_ligne_lien`
    non écrit (le suivi passe par `lig_avt_source_lig_id`) ; retenues de garantie, acomptes déduits
    (`document_deduction`) et cautions reportés au lot 13 (règlements) ; avoirs d'avancement et reprise d'avancement
    (V_REPRISE_AVT) non traités ; avancement des postes de pied non repris (postes non repris au lot 10).
- **Lot 12, achats et sous-traitance** : `A_DEVIS` (demande de prix), commandes, réceptions, retours, factures,
  avoirs, AO, contrats et situations de sous-traitance (R2) ; ventilation par chantier ; types exclus (Q16).
  *Critère* : coûts d'achat par chantier égaux à la source. **FAIT (16/11/2026).**
  - **Réalisé** : `DomainesAchats.cs`. `SourcesAchats` : lignes au prix d'achat (coefficients à 1, remise en
    coefficient), chantier de chaque ligne (`lig_cha_id`, `LignePiece.ChantierId`), avoir aux montants négatifs rendu
    positif (le type porte le sens, rôle AVOIR_ACHAT), statut (facture → ENVOYE, autre pièce émise → VALIDE, verrouillée).
    `AchatsMde` : tables ENTETE* / LIGNE* communes (DF, CF, LF, FF, OS, CS, FS de « type_document », avoir AF si
    TYPE = A ou total négatif), lignes par « type_ligne_achat » (remise 2 : ligne au montant), CODECHT de la ligne sinon de
    l'entête, facture transférée verrouillée. `AchatsOptim` : ach_doc_entete par « type_document_achat » (sociétés
    retenues, hors sauvegardes), fournisseur ach_doc_tiers, lignes ach_ligne_achat propres ou liées
    (ach_doc_lien_ligne_achat ; réception à la quantité livrée), factures par ach_export_facture_entete / _ligne (chantier
    par ligne, régule négative en avoir), liens commande → réception → facture ; sous-traitance afc_prestation_st en
    T_COMMANDE, situations afc_prestation_st_situation en T_FACTURE_AVT (avancement du lot 11 sur les lignes de la
    commande, période = écart des cumuls PSS_MtHT), consultations en T_AO ; facture d'achat d'une situation de
    sous-traitance (FAC_PSS_ID) écartée (pas de double coût). Codes propres PST / PSS / PSC dans « type_document_achat ».
    Tests : `VerifierAchatsAsync` (coûts par chantier par `v_document_chantiers_part`), `AchatsRepriseTests`.
  - **Écarts** : `document_ligne_lien` non écrit (liens de pièces seulement) ; factures de sous-traitance MDE sans lien
    de lignes vers la commande : reprises sans suivi d'avancement (`REPRISE_AVANCEMENT_SANS_MARCHE`) ; paiement direct
    (PST_IsPaieDirect) et retenues de garantie de sous-traitance au lot 13 ; frais de port et divers des factures OPTIM
    (FAC_MntFraisPort / Divers) non repris en lignes ; partie sous-traitée des lignes de vente (`part_sous_traitance`)
    non reprise ; sens de LGA_QteLivre (réception) et de PSS_MtHT (cumul) à confirmer sur une base réelle.
- **Lot 13, règlements** : échéanciers, règlements, lettrage, cautions. *Critère* : soldes égaux à la source.
  **FAIT (16/11/2026).**
  - **Réalisé** : `DomainesReglements.cs`. `ReglementsReprise` : pièces comptables reprises (règle PIECE_COMPTABLE,
    ventes et achats, valables, avec tiers) ; échéancier de la source (montants positifs, retenue sans date, `ech_manuel`),
    sinon calculé comme à la validation (`Echeances.Calculer` : condition figée, net à payer moins la retenue de la source,
    retenue en échéance RETENUE) ; règlements E (ventes) / D (achats), pointages signés par `f_signe_reglement` et
    plafonnés au reste de l'échéance (excédent gardé non pointé, `REPRISE_POINTAGE_EXCEDENT`) ; cautions rattachées au
    marché de la pièce ; état de paiement et statut recalculés (`ApresPointageAsync`) ; sans le module Règlements :
    échéanciers seuls. `ReglementsMde` : COMM_ECHEANCE par CODELOGICIEL (pièce de FIN_DOCUMENT, TYPETIERS C / F / S),
    FLRETENUEGARANTIE → RETENUE ; un règlement par pièce du cumul DEJAREGLE (MDE ne garde pas le détail), daté
    FIN_DOCUMENT.DATEMODIF, mode MODEREG ; PMEDOCRETENUE : retenue (TYPECAUTION vide) ou caution. `ReglementsOptim` :
    vac_doc_echeance_reglement polymorphe (VDE, VSI → facture de la situation, FAC → facture d'achat ou situation de
    sous-traitance ; VER_VRG_ID → RETENUE ; groupements écartés), vac_reglement_facture_vte (un règlement par remise
    vac_reglement_lot et par tiers, sinon par ligne ; sans échéance : réparti), échéances d'achat soldées réglées à leur
    montant (OPTIM ne garde pas les paiements fournisseurs), vac_doc_retenue_caution (retenue, payée sans échéance :
    VRG_MontantPaye ; caution). Tests : `VerifierReglementsAsync` (reste signé par pièce, retenues, états, cautions).
  - **Écarts** : échéancier source d'un autre total que le net repris gardé tel quel (`REPRISE_ECHEANCIER_ECART`,
    information : acompte déduit, paiement direct) ; acomptes déduits non repris en `document_deduction` ni postes de
    pied de retenue (la retenue est une échéance RETENUE, la pièce garde son TTC en net à payer) ; compensations
    facture / avoir OPTIM (VRV_VRV_Id_Avoir) reprises en règlements ordinaires ; durée de la caution OPTIM (VRG_NbMois,
    tinyint lu en booléen) perdue ; mode d'échéance MDE (MODEPAIEMENT) remplacé par le mode de la pièce ; sens de
    CODELOGICIEL et TYPECAUTION à confirmer sur une base réelle.
- **Lot 14, exploitation** : pointage en minutes avec les indemnités (Q17), planning, inventaire d'ouverture (Q18),
  consommations non liées à un document (Q15). *Critère* : heures par salarié, chantier et mois égales à la source.
  **FAIT (16/11/2026)**, en deux parties : pointage, absences, indemnités, planning ; stock et consommations.
  - **Réalisé** : `DomainesExploitation.cs`. `ExploitationReprise` : pointages en minutes dans la couche SAISIE
    (`poi_pointage`, valorisation IMPORT avec taux et coût de la source ; type de MO = nature MO de la ligne, sinon la
    première nature MO) ; variables de paie selon l'unité de la rubrique (ZONE → `poi_zone_chantier` du chantier pour
    l'agence du salarié, numéro tiré du code ; autres → saisies du jour additionnées dans `poi_valeur`) ; rubriques par la
    table de correspondance `rubrique_pointage` (liste `RUBRIQUE_POINTAGE`), sinon code Z + chiffre → zone, sinon défaut
    ou signalé ; absences en congés VALIDE (jours consécutifs regroupés, nature rapprochée par son code sinon créée) ;
    tâches du planning sur un chantier (`pla_tache`, PREVUE / TERMINEE selon la date de reprise) et affectations
    (SALARIE / INTERIM / MATERIEL). `ExploitationMde` : PMECHTSUIVMOCHT (CODEHEURE → pointage, CODERUB → variable).
    `ExploitationOptim` : svh_rapport_journalier (heures normales + HS1–3 en un pointage, horaires gardés s'ils
    correspondent, options en commentaire ; absences, déplacements → zone ou GD, repas → PANIER), pln_planification
    (hors absences et tâches sans chantier) et pln_affectation (SAL / MAT ; sans affectation : PLA_SLR_ID).
    Tests : `VerifierExploitationAsync` (minutes par salarié, chantier et mois, variables, zones, congés, tâches).
  - **Écarts** : heures supplémentaires fondues dans un seul pointage (recalculées par les règles de paie) ;
    pointages non validés (la couche VALIDE se refait dans LogiBTP) ; heures MDE d'équipe sans salarié et
    PMECHTSUIVMO hors chantier non reprises (`REPRISE_POINTAGE_NON_REPRIS`) ; affectations OPTIM d'articles (ART)
    non reprises (information).
  - **Réalisé, partie 2** : `DomainesStock.cs` (domaine `STOCK`). `StockReprise` : inventaire d'ouverture = un
    `stk_comptage` par article et par lieu à la date de reprise (23 h 59), sans historique des mouvements (Q18), prix
    de la source sinon PA de l'article ; lieux = chantiers (dépôt sans chantier → premier dépôt géré, INT-DEPOT ;
    chantier interne → `cha_depot` ; autre chantier → `cha_stock_tenu`) ; consommations de fournitures hors pièce (Q15)
    en sorties de stock S_SORTIE validées et verrouillées (une par chantier, lieu et mois, lieu d'origine posé),
    mouvements datés du jour de la source, donc antérieurs à l'inventaire : seul le coût STOCK du chantier en
    Rentabilité les voit ; heures de matériel en `pointage_materiel` source IMPORT (`db/292` rejouable étendu).
    `StockMde` : PMESTOCKREEL (lots cumulés) par PMEDEPOT, PMECHTSUIVFO sans pièce d'origine (TYPEORIG, BLORIG,
    BRORIG, BSORIG, FACORIG, MVTORIG, CLELIGORIG ; les bons de régie en sont), PMECHTSUIVMAT (DUREE en heures).
    `StockOptim` : bib_article_stock (lieu ARS_AchatStockAtelier), svc_rapport_conso sans pièce (RCS_DOE_ID,
    RCS_TRS_ID, RCS_CPH_ID, RCS_VSI_ID, RCS_VDE_ID, RCS_VRV_ID, RCS_Document ; ni projet ni désactivée). Tests :
    `VerifierStockAsync` (stock par article et lieu, coût STOCK du chantier par mois, heures de matériel).
  - **Écarts, partie 2** : PMECHTSUIVREGIE non lu (ses lignes sont recopiées dans les tables de suivi) ; durées de
    matériel MDE dans une autre unité que l'heure non reprises (`REPRISE_CONSOMMATION_NON_REPRISE`) ; consommations
    OPTIM sans article non reprises (aucun mouvement possible) ; sens de RCS_Mouvement non exploité ; lots, tailles et
    couleurs du stock MDE cumulés ; emplacements, mini / maxi non repris ; à confirmer sur une base réelle.

## Lot 15 : recette de la phase 1

Simulation complète des deux bases de test ; documentation (`documentation/modules/IMPORT.md`, `MODULES.md`,
`JOURNAL-LOTS.md`, `TODO.md`, `modules/import/CLAUDE.md`). L'essai sur une copie des bases réelles est fait par
l'utilisateur sur son poste. *Critère* : `npm test` et `dotnet test LogiBTP.slnx` verts.
**FAIT (16/11/2026).**
- **Réalisé** : simulation puis reprise réelle des deux bases de test (`RepriseBaseTests`, une vérification par
  domaine) ; référence `documentation/modules/IMPORT.md` (chaîne, domaines et tables lues, règles, anomalies, tests) ;
  `modules/import/CLAUDE.md`, `SRC.md`, `JOURNAL-LOTS.md`, `TODO.md` tenus à chaque lot.
- **Écarts** : reprise toujours exécutée dans la requête HTTP (tâche de fond à décider sur une grosse base réelle) ;
  essai sur une copie des bases réelles et scénario `e2e/reprise.spec.ts` à faire sur le poste.

## Lots 16 et 17 : phase 2

- **Lot 16, GED et notes** : contenus base64 et binaires dédupliqués par empreinte, rangés sous le nom de la base ;
  répertoires ; rattachements polymorphes ; messages et actions vers `crm_note`. **FAIT (16/11/2026).**
  - **Réalisé** : `DomainesGed.cs` (domaine `GED`, après le stock). `GedReprise` : contenu rangé par empreinte SHA-256
    sous le répertoire de la société (`StockageGed` du module GED ; un seul fichier et un seul `contenu_ged` par
    contenu), un `document_ged` et sa version 1 par fichier et par fiche liée (indexation laissée à la nuit) ; sans fiche :
    répertoires « Reprise › conteneur › sous-dossier » de la GED globale ; notes `crm_note` + `crm_note_lien` principal ;
    simulation : empreintes calculées en mémoire, rien sur le disque. Stockage : `DemandeReprise.StockageGed` (écran :
    stockage de la société ; commande : `--ged RACINE`, documents sous le nom de la base) ; sans stockage en reprise
    réelle : fichiers non repris et signalés, notes reprises. `GedMde` : SYS_MDEIMAGES des éléments (IDIMAGE →
    `ele_image_ged`) et des salariés (IDPHOTO → `ind_image_ged`), PMEAFFACTION en notes ACTION (libellé PMEACTION,
    destinataire, descriptif et note dans le message ; terminées sauf fin prévue sans date de fin). `GedOptim` :
    ged_document (base64 lu en flux) sur chaque fiche de ged_document_entite (table « entite » et registre), sans
    contenu signalé, désactivé écarté ; msg_message_observation en notes (table « nature_message » sur le code
    MSG_Type ; message en mémo, tâche faite terminée). Anomalie `REPRISE_GED_NON_REPRISE`. Tests : `VerifierGedAsync`
    (fichiers présents par empreinte, rattachements, répertoires, notes).
  - **Écarts** : fichiers écrits avant la validation de la transaction (rangés par empreinte : un échec laisse des
    fichiers orphelins sans conséquence) ; autres images MDE (états, natures, lignes de pièces), mises en forme
    (MISEENFORME) et lettres types non reprises ; chemins PLANS / DOSSIERS des affaires MDE non suivis (texte gardé en
    commentaire) ; suivi commercial OPTIM (afc_chantier_suivico) non repris ; tâches reprises sans responsable ni service ;
    messages sans destinataire (mémos).
- **Lot 17, tables `PP_*`** : analyse courte, puis alimentation des ordres et de la synthèse par chantier (module
  Exécution).
