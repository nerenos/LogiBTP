# Application de terrain : écarts et suites

> Plan de la procédure `analyse-lots`, phase 2 (08/11/2026). Questions et décisions :
> [terrain-suites-questions.md](terrain-suites-questions.md). Analyse d'origine :
> [ANALYSE-TERRAIN.md](../ANALYSE-TERRAIN.md). Source : TODO.md § « Application de terrain ».
>
> **Plan à valider par l'utilisateur avant tout développement.** Hors plan : contrats d'entretien (TS25, analyse à part).
> Points déjà faits ailleurs, cochés dans TODO.md par le lot 1 : heures de matériel valorisées (Rentabilité lot 5,
> `db/261`), relevés de matériel à la borne ([materiel-suites.md](materiel-suites.md) lots 3 et 4).
>
> Règles communes à tous les lots : textes, icônes et couleurs par `texte()` / `icone()` / thème ; tout nouveau script
> SQL rejouable et ajouté à `db/installation/scripts.txt` (numéro à prendre au démarrage, après le dernier existant) ;
> toute nouvelle route rattachée dans `SpecialisationDroitsBtp.Routes` ; `npm test` en fin de lot, `dotnet test
> LogiBTP.slnx` sur le poste de l'utilisateur (pas de SDK .NET dans le conteneur) ; ligne du TODO.md cochée ou mise à
> jour quand le point est fait ; `graphify update .` après le code.

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Ménage du TODO (points déjà faits) | documentation | — | FAIT (08/11/2026) |
| 2 | Case « Terrain » d'un plan du suivi des validations | `modules/crm` | — | FAIT (08/11/2026) |
| 3 | Plans en vigueur sur le terrain | cœur | 2 | FAIT (08/11/2026) |
| 4 | Plans gardés hors ligne, budget à part | cœur | 3 | FAIT (08/11/2026) |
| 5 | Bandeau adaptatif sur téléphone | `modules/navigation` | — | FAIT (08/11/2026) |
| 6 | Menu simplifié du terrain et raccourci vers le menu classique | cœur | 5 | FAIT (08/11/2026) |
| 7 | Pointage à la ligne d'ordre | cœur | — | FAIT (08/11/2026) |
| 8 | Photos HEIC converties par l'iPhone | cœur | — | FAIT (08/11/2026) |
| 9 | Hors ligne : chantiers et ordres ouverts du service | cœur | — | FAIT (08/11/2026) |
| 10 | Hors ligne : ordre saisi par son numéro, résolu à l'envoi | cœur | 9 | FAIT (08/11/2026) |
| 11 | Limite de dépôt de la GED exposée au client | `modules/ged` | — | FAIT (08/11/2026) |
| 12 | Contrôle de taille des photos à la prise de vue | cœur | 11 | FAIT (08/11/2026) |
| 13 | PV de réception : forme de signature et heure de l'appareil | cœur | — | FAIT (08/11/2026) |
| 14 | Réserves suivies : base et serveur | cœur | 13 | FAIT (08/11/2026) |
| 15 | Réserves suivies : levée depuis le terrain et suivi au bureau | cœur | 14 | FAIT (08/11/2026) |
| 16 | PV de levée des réserves signé | cœur | 15 | A FAIRE |
| 17 | Bibliothèque simplifiée : serveur | cœur | — | A FAIRE |
| 18 | Bibliothèque simplifiée : écran et articles des demandes d'approvisionnement | cœur | 17 | A FAIRE |
| 19 | Pointage des heures de matériel à la borne | cœur | — | A FAIRE |
| 20 | Réception d'une commande à options ou variantes | cœur | — | A FAIRE |
| 21 | Avancement réel par marché | cœur | — | A FAIRE |
| 22 | Facture brouillon depuis le bon de SAV | cœur | — | A FAIRE |
| 23 | Création d'une intervention SAV hors ligne | cœur | 9 | A FAIRE |
| 24 | Chantier « Entretien et dépannage » par le chrono des chantiers | cœur | — | A FAIRE |

Ordre proposé : 1, puis les groupes indépendants dans l'ordre du tableau (2-4, 5-6, 7, 8, 9-10, 11-12, 13-16, 17-18,
19, 20, 21, 22, 23, 24). Un commit par lot.

---

## Lot 1 : ménage du TODO (FAIT 08/11/2026)

- **Module** : documentation. **Agent** : `lot-dev`. **Modèle** : haiku.
- **Fichiers** : `TODO.md` (§ Application de terrain), `documentation/TACHES.md` n'est pas touché (réservé aux humains).
- **Contenu** : retirer de la ligne « Lot 7, suites » les heures de matériel non valorisées et les relevés à la borne
  (avec le renvoi vers `db/261` et materiel-suites), garder le pointage des heures à la borne ; lien vers ce plan ;
  contrats d'entretien renvoyés à une analyse à part.
- **Règles répliquées** : aucune. **Tests** : aucun.
- **Critère de fin** : TODO.md relu, liens valides.
- **Réalisé / écarts** : la ligne « Lot 7, suites » était cochée dans `main` alors que ses points restent à faire : décochée ;
  chaque ligne renvoie aux lots du plan ; contrats d'entretien sur une ligne à part.

## Lot 2 : case « Terrain » d'un plan du suivi des validations (TS2) (FAIT 08/11/2026)

- **Module** : `modules/crm`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : nouveau script `modules/crm/db/098b_crm_plan_terrain.sql` (`crm_plan.pla_terrain BOOLEAN NOT NULL
  DEFAULT FALSE`), `db/installation/scripts.txt`, `LogiBTP.Crm.Web/Donnees.cs`, `ServiceCrm.Validations.cs` (lecture et
  écriture), `js/src/plans.js` (case dans la fiche du plan), tests du module.
- **Dépendances** : aucune.
- **Règles répliquées** : aucune (l'indice en vigueur reste `etatPlan` / `ReglesValidation`, inchangé).
- **Tests** : C# : case enregistrée et relue ; JS : rendu de la case.
- **Critère de fin** : `npm test` vert ; script rejoué deux fois sans erreur ; case visible et gardée dans le suivi des
  validations.
- **Réalisé / écarts** : script `modules/crm/db/098b_crm_plan_terrain.sql` (rejouable, au manifeste après `098`) ;
  `CrmPlan.PlaTerrain`, `PlanSaisi.Terrain` (nul : inchangé, donc non coché à la création), `PlanDto.Terrain` ;
  recopie et lecture extraites (`ServiceCrm.RemplirPlan`, `EnPlanDto`) pour le test C# `PlanTerrainTests` (le module
  n'a pas de test sur base). Écart : la fiche du plan est dans le cœur (`client/src/app/pages/crm-plan.js`) ; le
  module fournit la case (`caseTerrainPlan` de `js/src/plans.js`, textes `crm.plans.terrain*`), testée dans
  `plans.test.js`. Script à appliquer par l'utilisateur (non rejoué ici).

## Lot 3 : plans en vigueur sur le terrain (TS1, TS2) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `src/LogiBTP.Api/Btp/TerrainBtp.cs` (plans du chantier, de ses marchés et de l'ordre d'origine : indice
  en vigueur seul, par la règle du module CRM ; plans sans indice en vigueur absents ; drapeau `terrain`),
  `client/src/app/terrain/terrain.js` (plans cochés en tête des pièces, autres plans validés sous « Voir tous les plans »),
  textes `terrain_btp.*`, tests C# du cœur.
- **Dépendances** : lot 2.
- **Règles répliquées** : aucune nouvelle (règle d'indice en vigueur du module CRM reprise, pas recopiée).
- **Tests** : C# : indice B diffusé et visé BPE montré, indice C en attente ignoré, plan refusé absent, plan coché en
  tête ; JS : affichage replié des autres plans.
- **Critère de fin** : `npm test` vert ; sur `/terrain`, un plan coché au dernier indice validé s'ouvre depuis la carte.
- **Réalisé / écarts** : nouveau `src/LogiBTP.Api/Btp/TerrainPlansBtp.cs` (partie de `TerrainBtp`, au lieu d'alourdir
  `TerrainBtp.cs`) : `PlansEnVigueur` (règle `ReglesValidation.Etat` du module reprise, cochés en tête puis lot et
  repère), `plans` ajouté à `GET /api/terrain` (clé : tâche ; plans du chantier, de ses marchés et de l'ordre d'origine,
  élément CRM `document` = groupe d'indices), route `GET /api/terrain/plans/{id}` (fichier d'un plan en vigueur d'une
  tâche à ±30 jours ; couverte par le préfixe `/api/terrain` du nœud `terrain`, aucune ligne ajoutée aux `Routes`).
  Fichiers montrés : celui de l'indice (`pin_dge_id`) et ceux de son répertoire GED (`pin_rge_id`), mêmes filtres de
  confidentialité que les pièces ; plan en vigueur sans fichier visible absent ; module CRM inactif : aucun plan.
  Client : `plansTache` / `plansTacheHtml` (`terrain/terrain.js`), bloc avant les pièces, autres plans dans un
  `<details>` replié ; textes `terrain_btp.page.plans*`, icône `terrain_btp_plan`, `api.terrain.urlPlan`. Tests :
  `PlansTerrainTests` (C#), `terrain.test.js` (JS). Aucun script SQL.

## Lot 4 : plans gardés hors ligne, budget à part (TS3) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/pwa/sw.js` (cache des plans séparé de celui des pièces « Terrain », 25 Mo par défaut),
  `client/src/app/terrain/operations-terrain.js` (préchargement des plans **cochés**), tests JS.
- **Dépendances** : lot 3.
- **Points ouverts** : taille du budget des plans (25 Mo proposés, comme les pièces) : `OUVERT`, à confirmer au démarrage.
- **Tests** : JS : budget atteint → plans les plus anciens non gardés, pièces « Terrain » intactes.
- **Critère de fin** : `npm test` vert ; plan coché ouvert sans réseau après une ouverture en ligne de « Mon terrain ».
- **Réalisé / écarts** : point OUVERT tranché par la proposition : **25 Mo** (`BUDGET_PLANS` de `client/src/pwa/regles.js`).
  Règles pures `estPlanTerrain`, `plansARetirer` (plans gardés depuis le plus longtemps retirés jusqu'à tenir dans le
  budget ; plan plus grand que le budget non gardé, rien retiré ; plan déjà gardé remplacé), `reponseAGarder` étendue ;
  `sw.js` : cache `logibtp-plans` à part (taille gardée dans l'en-tête `X-LogiBTP-Taille`, plans gardés l'un après
  l'autre), lu hors ligne, effacé à la déconnexion et au changement de compte comme les données ; pièces « Terrain »
  inchangées (cache des données, 25 Mo par pièce). Écart : le préchargement est fait par `#precharger` de
  `pages/terrain.js` (où se trouve celui des pièces), avec la règle pure `plansAPrecharger` dans `terrain/terrain.js`
  (seuls les plans cochés) ; `operations-terrain.js` non touché. Plans non cochés : gardés s'ils ont été ouverts en
  ligne, dans le même budget. Tests : `pwa.test.js`, `terrain.test.js`. Aucun script SQL.

## Lot 5 : bandeau adaptatif sur téléphone (TS4 b) (FAIT 08/11/2026)

- **Module** : `modules/navigation`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/navigation/js/ui/bandeau.js`, sa feuille de style, tests du module.
- **Contenu** : sous 700 px, le bandeau tient sur la largeur (360 px) : menus regroupés derrière un bouton, infos
  (société, API, cloche, pastille hors ligne) en icônes ; option `simplifie` acceptée par le bandeau (liste de menus
  réduite fournie par l'application, bouton pour basculer vers les menus complets), utilisée par le lot 6.
- **Dépendances** : aucune.
- **Règles répliquées** : aucune.
- **Tests** : JS : bascule simplifié / complet ; capture à 360 px sans défilement horizontal (Playwright).
- **Critère de fin** : `npm test` vert ; aucune page ne déborde horizontalement à 360 px à cause du bandeau.
- **Réalisé / écarts** : règles pures dans le nouveau `modules/navigation/js/src/menus.js` (`LARGEUR_TELEPHONE`,
  `MEDIA_TELEPHONE`, `menusAffiches`, `basculeProposee`, testées dans `navigation.test.js`). `Bandeau` : mode téléphone
  suivi par `matchMedia` (classe `bandeau-telephone`, quelle que soit la disposition : le panneau latéral n'est jamais
  pris sur téléphone, la préférence reste gardée), bouton ☰ « Menus » qui ouvre une feuille sous le bandeau, menus en
  accordéon (rendu du panneau latéral réutilisé, règles CSS communes passées en `bandeau-arbre`), message masqué, bandeau
  haut de 36 px ; options `simplifie` / `complet` / `surBascule`, méthodes `simplifier()` et `basculerMenus()`, bouton de
  bascule « Menu classique » / « Menu simplifié » en fin de menus. Textes `navigation.bandeau.menus*`, icônes
  `navigation_menus`, `navigation_bascule_menus`. Écart : « infos en icônes » demande au cœur de placer le texte des
  informations dans `.bandeau-info-texte` (masqué sur téléphone, la bulle le garde) : `client/src/app/application.js`
  (société, API, compte, usurpation) ; `client/src/styles.css` : décalage des tiroirs à 36 px sur téléphone. Ancien
  défilement horizontal des menus sous 700 px retiré. Vérifié par Playwright (application lancée par Vite, API simulée) :
  `/terrain` à 360 px sans défilement horizontal, feuille des menus ouverte comprise ; pas de test Playwright permanent
  (aucun environnement DOM dans les tests du module). Aucun script SQL.

## Lot 6 : menu simplifié du terrain et raccourci vers le menu classique (TS4 a) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/navigation/menus.js` (menu du terrain : Mon terrain, Pointage, Mes demandes, SAV selon
  les droits), `client/src/app/application.js` (menu simplifié par défaut sur `/terrain`, `/terrain/reception`,
  `/terrain/sav` ; raccourci « Menu classique » déclaré par `declarerRaccourcis`, choix gardé dans le `localStorage`),
  textes `navigation_btp.*`.
- **Dépendances** : lot 5.
- **Points ouverts** : menu simplifié aussi par défaut pour un profil MOBILE hors des pages du terrain : `OUVERT`
  (proposé : non, pages du terrain seulement).
- **Tests** : JS : menu simplifié sur `/terrain`, complet ailleurs ; raccourci qui bascule et se souvient.
- **Critère de fin** : `npm test` vert ; sur téléphone, « Mon terrain » montre le menu simplifié et le raccourci.
- **Réalisé / écarts** : point OUVERT tranché par la proposition : menu simplifié par défaut sur les pages du terrain
  seulement, quel que soit le profil. `navigation/menus.js` : `estPageTerrain` (`/terrain`, `/terrain/reception/:id`,
  `/terrain/sav/:id`) et `menusTerrain(app)` (un menu « Terrain » : Mon terrain, Pointage, Mes demandes, SAV, liens vers
  les onglets de `/terrain`, mêmes droits que ces onglets ; sans accès à Mon terrain : menus complets).
  `application.js` : `#majMenuTerrain` (appelé par `majPage`) pose ou retire la liste simplifiée du bandeau ; choix « Menu
  classique » gardé dans les préférences du navigateur (`menuClassique` de `logibtp.navigation`, `localStorage`), repris
  sur toutes les pages du terrain ; raccourci `menuClassique` du groupe `application` (`raccourcis.js`, Ctrl+Maj+M par
  défaut, personnalisable) en plus du bouton du bandeau. Module Navigation : un menu seul dans la liste simplifiée est
  déplié d'emblée dans la feuille du téléphone. Textes `navigation_btp.menus.terrain_simplifie.*`,
  `navigation_btp.raccourcis.application.menu_classique`. Tests : `client/test/menus.test.js`. Vérifié par Playwright à
  360 px (feuille du menu simplifié, sans défilement horizontal) et à 1280 px. Aucun script SQL.

## Lot 7 : pointage à la ligne d'ordre (TS5 a, TS6 a, TS7 a) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `src/LogiBTP.Api/Btp/TerrainPointageBtp.cs` (tâche d'origine `ligne` : `poi_lig_id`, `poi_ent_id` du
  document de la ligne, chantier de la ligne), `client/src/app/terrain/pointage-terrain.js` (libellé de la ligne sur la
  carte), nouveau script `db/2xx_pointage_ligne_terrain.sql` (reprise rejouable des pointages existants des tâches
  d'origine ligne, journées validées exclues), tests C#.
- **Dépendances** : aucune.
- **Règles répliquées** : aucune (ventilation par chantier inchangée : `v_document_chantiers_part`).
- **Tests** : C# : pointage d'une tâche d'origine ligne → ligne et document renseignés ; tâche d'origine ordre
  inchangée ; reprise qui saute les journées validées.
- **Critère de fin** : `npm test` vert ; script rejoué deux fois sans erreur ; pointage d'une tâche de ligne visible à
  la ligne dans la rentabilité.
- **Réalisé / écarts** : `SqlTaches` (`TerrainBtp.cs`) : tâche d'origine `ligne` → `lig_id`, libellé de la ligne,
  document de la ligne (`ent_id`) et chantier de la ligne (`lig_cha_id`, sinon entête), donc aussi pièces et plans de
  l'ordre sur la carte. `TerrainPointageBtp.cs` : règle pure `LigneDuPointage` (ligne de la tâche tant que le pointage
  reste sur son document ; saisie libre : jamais, TS7 a), posée sur la personne et les membres d'équipe ; `lig_id` et
  `ligne` lus avec les tâches et les pointages de la journée. Écart : le module Pointage ne savait pas écrire
  `poi_lig_id` : `PointageSaisi.LigId` ajouté (absent = inchangé, remis à vide quand l'ordre change ; couche validée :
  ligne du pointage d'origine resté sur le même ordre, `ServiceSynthese`). Rentabilité : `v_pointages_retenus` reçoit
  `lig_id` (reprise de 202 dans le script) et le fait d'un pointage porte `afa_lig_id` (`afa_ent_id` laissé vide pour
  ne pas ranger les heures parmi les pièces). Nouveau script `db/288_pointage_ligne_terrain.sql` (au manifeste, appliqué
  une fois, rejouable sans erreur) : clé étrangère `fk_poi_ligne` (ON DELETE SET NULL) et index, vue, reprise des
  pointages SAISIE des tâches d'origine ligne restés sur le chantier et le document de la ligne, journées validées et
  semaines corrigées exclues (TS6 a). Client : libellé de la ligne sur la carte du pointage (`ligneDuPointage` de
  `terrain/terrain.js`, icône `terrain_btp_ligne`). Tests : `PointageLigneTerrainTests` (C# ; reprise sur base si
  `LOGIBTP_TEST_PG`, non exécutée ici), `terrain.test.js`. Script à appliquer par l'utilisateur (non rejoué ici).

## Lot 8 : photos HEIC converties par l'iPhone (TS8 a, TS9 b) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : haiku.
- **Fichiers** : `client/src/app/terrain/actions-tache.js` (champs fichier `accept="image/jpeg,image/png"` au lieu de
  `image/*`, pour que Safari transcode en JPEG), mêmes champs des pages réception et SAV, `terrain/terrain.js`
  (réduction : HEIC reçu malgré tout envoyé tel quel, comme aujourd'hui).
- **Dépendances** : aucune.
- **Tests** : JS : attribut `accept` des champs photo.
- **Critère de fin** : `npm test` vert ; **essai sur un iPhone par l'utilisateur** : photo de l'appareil et de la
  galerie arrivées en JPEG réduit dans la GED. Si l'essai échoue, le point revient en question (pas de secours prévu).
- **Réalisé / écarts** : `terrain/terrain.js` : `TYPES_PHOTOS` (`image/jpeg,image/png`) et `champsPhotosHtml()` (champs
  de la prise de vue et de la galerie, repris par `selecteurPhotos` d'`actions-tache.js`, seul sélecteur des photos du
  terrain : tâche, non-conformité, livraison, page SAV ; la page de réception n'a pas de champ photo). Écart : TS9 b
  appliqué aussi au HEIC reçu malgré tout (navigateur qui ne transcode pas) : `preparerPhoto` le convertit en JPEG
  (pleine taille en « qualité d'origine ») quand le navigateur sait le lire (`estHeic`), sinon il part tel quel comme
  avant. Tests : `terrain.test.js` (attribut `accept`, `estHeic`). Essai sur iPhone à faire par l'utilisateur (TODO.md).
  Hors plan, demandé avec le lot : barre de période de `/terrain` coupée à 360 px (⚙ hors de l'écran) : la page du
  terrain, placée dans un conteneur lui-même `page-terrain`, ajoutait sa marge et sa largeur minimale de 360 px
  (débord de 24 px) : `.page-terrain .page-terrain` sans marge latérale ni largeur minimale ; sous 480 px, la période
  prend la largeur entre ◀ et ▶, « Aujourd'hui » et ⚙ passent dessous (`client/src/styles.css`). Vérifié par Playwright
  (Vite, API simulée) à 360 px (jour et semaine : barre de 336 px dans 336 px, aucun défilement horizontal), 500 px et
  1280 px (une seule rangée, inchangée). Aucun script SQL.

## Lot 9 : hors ligne, chantiers et ordres ouverts du service (TS10 b, TS11 b) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `src/LogiBTP.Api/Btp/TerrainPointageBtp.cs` (route de lecture : chantiers ouverts du service principal
  de la personne et leurs ordres ouverts, numéro et libellé), `client/src/app/terrain/operations-terrain.js`
  (préchargement quotidien), `pointage-terrain.js` (saisie libre et recherche d'un ordre par numéro sur ces données sans
  réseau), tests.
- **Dépendances** : aucune.
- **Points ouverts** : personne sans service principal : `OUVERT` (proposé : chantiers de son planning à un mois).
- **Tests** : C# : périmètre du service ; JS : recherche d'un ordre préchargé sans réseau.
- **Critère de fin** : `npm test` vert ; saisie libre sur un chantier du service jamais ouvert, sans réseau, envoyée au
  retour.
- **Réalisé / écarts** : route `GET /api/terrain/journee/chantiers` (`TerrainPointageBtp.cs`, sous le droit du pointage
  de la journée ; sans droit de saisie libre : aucun chantier) : `SqlChantiersHorsLigne`, chantiers ouverts (hors
  dotations, sauf entretien en cours) portant un ordre en vigueur non terminé ou une tâche du planning à un mois du
  service principal de la personne ou d'un service fils, plus les chantiers de son planning à un mois et les chantiers
  internes ; leurs ordres ouverts (`OrdresAsync` du pointage). Point OUVERT tranché par la proposition : personne sans
  service principal → chantiers de son planning à un mois (`PerimetreHorsLigne`, renvoyé en `perimetre`). Client :
  adresse ajoutée au préchargement quotidien (`adressesAPrecharger`) ; `terrain/terrain.js` : `completerReferentiel`
  (sans réseau, chantiers et ordres gardés ajoutés à ceux de la journée), `journeeSansReseau` (journée jamais lue :
  saisie libre seulement, `connus` vide donc aucun pointage du serveur retiré, bandeau `terrain_btp.pointage.sans_reseau`),
  `chercherOrdre` (numéro exact sans casse ni espaces, sinon le seul qui le contient) ; `pointage-terrain.js` : champ
  « N° d'ordre » de la saisie libre (chantier et ordre choisis d'un coup, en ligne comme hors ligne). Écart : la
  journée lue en ligne garde sa liste de chantiers (tous les chantiers ouverts) ; les équipiers ne sont pas proposés
  sur une journée jamais lue. Tests : `ChantiersHorsLigneTerrainTests` (C# ; périmètre sur base si `LOGIBTP_TEST_PG`,
  non exécuté ici), `terrain.test.js`. Aucun script SQL.

## Lot 10 : hors ligne, ordre saisi par son numéro, résolu à l'envoi (TS11 a) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/terrain/pointage-terrain.js` (numéro inconnu de l'appareil accepté, marqué « à
  vérifier »), `client/src/app/hors-ligne/operations.js` (type d'opération de journée : numéro à résoudre),
  `TerrainPointageBtp.cs` (résolution à l'envoi, refus `ORDRE_INCONNU` signalé selon T9), codes `client/src/app/codes.js`
  ↔ `src/LogiBTP.Domaine/Codes.cs`, tests.
- **Dépendances** : lot 9.
- **Tests** : C# : numéro résolu, numéro inconnu refusé ; JS : saisie gardée puis marquée refusée.
- **Critère de fin** : `npm test` vert ; `CodesTests` du cœur vert.
- **Réalisé / écarts** : `TerrainPointageBtp.cs` : `LigneTerrain` reçoit `Numero` et un chantier facultatif
  (`Chantier` : refus `TERRAIN_CHANTIER` s'il reste vide) ; `ResoudreNumerosAsync` au début de l'enregistrement de la
  journée (ligne nouvelle sans ordre : ordre d'exécution en vigueur non terminé, sur un chantier, de ce numéro sans
  casse ni espaces, `NumeroNormalise`) et règle pure `ResoudreNumero` (aucun ou plusieurs ordres : refus 422
  `ORDRE_INCONNU`, détail `numero`). Codes : `ErreursTerrain` (`Codes.cs`) ↔ `ERREUR_TERRAIN` (`codes.js`), ajouté à
  `CodesTests`. Écart : aucun nouveau type d'opération : la journée gardée (`terrain-journee`) porte le numéro de la
  ligne ; `hors-ligne/operations.js` garde en plus le code d'erreur du refus (`code`). Client : numéro inconnu de
  l'appareil gardé tel quel (chantier et ordre vides, ligne acceptée à l'enregistrement), état `etatNumero`
  (`terrain/terrain.js` : « à vérifier », refusé quand la journée gardée est refusée pour `ORDRE_INCONNU`) affiché
  sous la ligne ; le numéro est effacé dès qu'un chantier ou un ordre est choisi. En ligne, même résolution par le
  serveur (refus affiché tout de suite). Tests : `NumeroOrdreTerrainTests` (C#), `operations-terrain.test.js`
  (saisie gardée puis marquée refusée). Aucun script SQL.

## Lot 11 : limite de dépôt de la GED exposée au client (TS12) (FAIT 08/11/2026)

- **Module** : `modules/ged`. **Agent** : `lot-dev`. **Modèle** : haiku.
- **Fichiers** : `LogiBTP.Ged.Web/ServiceGed.cs` (route de lecture de `TailleMaxDepot`, ou champ ajouté à une lecture
  existante des paramètres), `modules/ged/js/src` (lecture côté client), tests du module.
- **Dépendances** : aucune.
- **Tests** : C# : valeur renvoyée = spécialisation.
- **Critère de fin** : `npm test` vert.
- **Réalisé / écarts** : champ ajouté à une lecture existante (pas de nouvelle route) : `taille_max_depot` (octets) de
  `GET /api/ged/parametres` (`ParametresGedDto.TailleMaxDepot`, rempli par `ServiceGed.ParametresDepuis` depuis
  `SpecialisationGed.TailleMaxDepot`, jamais depuis la base). `modules/ged/js/src/fournisseurs.js` :
  `TAILLE_MAX_DEPOT_DEFAUT`, `tailleMaxDepot(parametres)`, `depotTropLourd(taille, parametres)` (exportés par l'index) ;
  `FournisseurGedMemoire` refuse aussi un dépôt ou une version trop lourds (`TAILLE`, texte `ged.fournisseur.trop_volumineux`).
  Tests : `ParametresGedTests` (C#), `ged.test.js`. Aucun script SQL.

## Lot 12 : contrôle de taille des photos à la prise de vue (TS12) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/terrain/terrain.js` (réduction forcée au-delà de la limite ; « qualité d'origine » trop
  lourde refusée tout de suite avec la limite en Mo), `operations-terrain.js` (limite gardée pour le hors ligne),
  textes `terrain_btp.*`, tests JS.
- **Dépendances** : lot 11.
- **Tests** : JS : photo trop lourde refusée avant d'être gardée.
- **Critère de fin** : `npm test` vert.
- **Réalisé / écarts** : écart : la page du terrain ne lit pas `GET /api/ged/parametres` (route de paramétrage, refusée
  aux profils du terrain) : la limite (`SpecialisationGed.TailleMaxDepot`) est renvoyée en `taille_max_photo` par
  `GET /api/terrain` (`TerrainBtp.cs`, lecture préchargée), puis gardée sur l'appareil (`memoriserLimitePhotos` /
  `limitePhotos` d'`operations-terrain.js`, localStorage ; sinon limite par défaut `tailleMaxDepot` du module GED).
  `terrain/terrain.js` : `decisionPhoto` (garder, réduire, refuser), `preparerPhoto(…, { limite })` : photo trop lourde
  réduite de force (côté ×0,75 et qualité abaissée jusqu'à 480 px), « qualité d'origine » trop lourde ou photo qui ne
  tient pas même réduite (navigateur qui ne sait pas réduire compris) : `PhotoTropLourde`, avec la limite en Mo
  (textes `terrain_btp.actions.photos.trop_lourde*`), levée par `selecteurPhotos().photos()` avant toute garde ou
  envoi (tâche, non-conformité, demande, livraison, page SAV). Le contrôle se fait à la validation des photos
  choisies, pas à chaque prise de vue. Tests : `terrain.test.js`, `operations-terrain.test.js`. Aucun script SQL.

## Lot 13 : PV de réception, forme de signature et heure de l'appareil (TS13 a, TS16 a) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : nouveau script `db/2xx_reception_appareil.sql` (heure de signature sur l'appareil dans la réception),
  `src/LogiBTP.Api/Btp/TerrainReceptionBtp.cs`, `client/src/app/pages/terrain-reception.js` et l'opération hors ligne
  de réception (heure de l'appareil envoyée), modèle d'édition `PV_RECEPTION` (« Signature électronique simple, signée
  sur l'appareil le…, reçue le… »), tests C#.
- **Dépendances** : aucune. Confirmation juridique de la signature simple : **de votre côté**, hors code.
- **Tests** : C# : les deux heures enregistrées et imprimées ; réception en ligne : une seule heure.
- **Critère de fin** : `npm test` vert ; script rejoué deux fois sans erreur.
- **Réalisé / écarts** : `db/289_reception_appareil.sql` (rejouable, `rec_signee_appareil_le` de `reception_pose`).
  Client : `receptionGardee` d'`operations-terrain.js` joint `signee_le` (heure de l'appareil) à la seule réception
  gardée hors ligne ; envoyée en ligne, la réception n'en porte pas (une seule heure). Serveur :
  `ReceptionSaisie.SigneeLe`, `TerrainBtp.HeureAppareil` (heure en avance sur le serveur ramenée à la sienne, UTC),
  `signee_appareil_le` dans la réponse ; source annexe `reception_pose` sortie en `SpecialisationEditionBtp.SqlSourceReception`
  (`recu_le`, `signe_appareil_le`). Modèle `PV_RECEPTION` (`client/src/app/editions/modeles.js`, `db/191` régénéré par
  `npm run generer-vues-liste --workspace client`) : « Signature électronique simple, signée sur l'appareil le…, reçue
  le… » (sinon « signée et reçue le… ») ; `db/191` à rejouer (modèle fourni réécrit s'il n'est pas modifié localement).
  Tests : `ReceptionAppareilTests.cs` (rejeu du script et source du PV sur la base de développement si
  `LOGIBTP_TEST_PG`), `operations-terrain.test.js`.

## Lot 14 : réserves suivies, base et serveur (TS14 a) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : nouveau script `db/2xx_reception_reserves.sql` (table des réserves : réception, libellé, photo GED,
  état OUVERTE / LEVEE, levée le, par qui, photo de levée), `TerrainReceptionBtp.cs` (réserves écrites une par une à la
  réception, routes de lecture et de levée, contrôle de qui peut lever : mêmes règles que la réception), codes d'état
  (`codes.js` ↔ `Codes.cs`), `SpecialisationDroitsBtp.Routes`, tests C#.
- **Dépendances** : lot 13.
- **Points ouverts** : reprise des réserves déjà notées dans les tâches du CRM : `OUVERT` (proposé : non, nouvelles
  réceptions seulement).
- **Tests** : C# : réception avec deux réserves ; levée par une personne affectée ; levée refusée hors périmètre ;
  tâche du CRM toujours créée.
- **Critère de fin** : `npm test` vert ; `CodesTests` vert ; script rejoué deux fois sans erreur.
- **Réalisé / écarts** : `db/290_reception_reserves.sql` (rejouable) : table `reception_reserve` (réception, ordre,
  rang, libellé, photo GED `rre_dge_id`, état, levée le / sur l'appareil / par / commentaire / photo). Codes
  `ETAT_RESERVE` (`codes.js`) ↔ `EtatsReserve` (`Codes.cs`), `CodesTests`. Nouveau `Btp/TerrainReservesBtp.cs` :
  `ReservesSuivies` + `EcrireReservesAsync` dans la transaction de la réception (la tâche du CRM reste créée,
  `LibelleTacheReserves`), `GET /api/terrain/receptions/{ent}/reserves`, `POST …/reserves/{res}/levee` (formulaire :
  `commentaire`, `levee_le` de l'appareil, `photo` déposée dans la GED de l'ordre par le compte de service des
  éditions), `LeverReserveAsync` (contrôle `OrdreReceptionAsync`, mêmes règles que la réception ; levée rejouée sans
  effet, pour les envois de l'appareil) ; réserves aussi rendues par `GET /api/terrain/receptions/{ent}`. Routes : sous
  le préfixe déjà déclaré `/api/terrain/receptions` (commentaire ajouté dans `SpecialisationDroitsBtp.Routes`, pas de
  nouvelle entrée). Photo de la réserve à la réception : colonne prête, pas encore saisie (la réception envoie des
  libellés). Point OUVERT tranché par la proposition : pas de reprise des réserves des tâches du CRM. Tests :
  `ReservesReceptionTests.cs` (levée et refus sur la base de développement si `LOGIBTP_TEST_PG`).

## Lot 15 : réserves suivies, levée depuis le terrain et suivi au bureau (TS14 a) (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/pages/terrain-reception.js` (liste des réserves de l'ordre, levée avec photo, gardée
  hors ligne), `client/src/app/hors-ligne/operations.js` (type d'opération levée), panneau de l'ordre au bureau (réserves
  et leur état), textes, tests JS.
- **Dépendances** : lot 14.
- **Tests** : JS : levée gardée hors ligne puis envoyée.
- **Critère de fin** : `npm test` vert ; une réserve levée sur le terrain apparaît levée au bureau.
- **Réalisé / écarts** : `pages/terrain-reception.js` : carte « Réserves à lever » (état, levée, commentaire), bouton
  « Lever la réserve » (dialogue : commentaire, photo par `selecteurPhotos`, la première gardée), envoi par
  `envoyerOuGarder` ; hors ligne, levée gardée avec l'heure de l'appareil (`levee_le`) et marquée « sur l'appareil »,
  y compris à la réouverture (`lireOperation`). Écart : le type d'opération `LEVEE_RESERVE` et son envoi
  (`formulaireLevee`) sont déclarés dans `terrain/operations-terrain.js` comme les autres opérations du terrain, pas dans
  `hors-ligne/operations.js` (file générique, inchangée). API : `api.terrain.reserves` / `leverReserve`,
  `api.execution.reserves`. Bureau : panneau « Exécution » d'un ordre E_PO (`execution/execution.js`,
  `rendreReservesOrdre`, lecture seule) sur `GET /api/execution/documents/{id}/reserves` (`ExecutionBtp.cs`, préfixe
  `/api/execution` déjà déclaré). Textes `terrain_btp.reception.reserves_suivies.*`, `execution_btp.reserves.*` ; icônes
  `terrain_btp_reserve`, `terrain_btp_reserve_levee`, `execution_btp_reserve_ouverte`, `execution_btp_reserve_levee`.
  Aucun script SQL. Tests : `operations-terrain.test.js` (levée gardée puis envoyée). La vérification « levée au bureau »
  reste à faire sur la base de l'utilisateur (`db/290` appliqué).

## Lot 16 : PV de levée des réserves signé (TS14 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : nouveau modèle d'édition `PV_LEVEE_RESERVES` (données système des éditions), `TerrainReceptionBtp.cs`
  (PV édité quand toutes les réserves sont levées, signature du client par `PadSignature`, empreinte et GED comme le PV
  de réception, courriel par le module Mail), `terrain-reception.js`, tests C#.
- **Dépendances** : lot 15.
- **Tests** : C# : PV produit à la dernière levée, empreinte enregistrée.
- **Critère de fin** : `npm test` vert ; PV de levée rangé dans la GED de l'ordre.

## Lot 17 : bibliothèque simplifiée, serveur (TS17 b, TS15 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : nouveau `src/LogiBTP.Api/Btp/TerrainBibliothequeBtp.cs` (recherche d'articles par code ou libellé,
  fiche réduite : photo, fiche technique de la GED, unité, conditionnement ; articles du chantier = lignes de ses
  marchés, pour le hors ligne), `SpecialisationDroitsBtp.Routes` (nœud `terrain/bibliotheque` ou nœud existant :
  `OUVERT`, proposé : `terrain/demande` Consulter), tests C#.
- **Dépendances** : aucune.
- **Tests** : C# : recherche, articles du chantier, aucun prix d'achat renvoyé.
- **Critère de fin** : `npm test` vert.

## Lot 18 : bibliothèque simplifiée, écran et articles des demandes d'approvisionnement (TS17 b, TS15 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : nouveau `client/src/app/terrain/bibliotheque-terrain.js`, `terrain/complements-terrain.js` (ligne de
  demande E_DAP : article choisi ou texte libre), `operations-terrain.js` (articles du chantier gardés hors ligne),
  `src/LogiBTP.Api/Btp/TerrainReceptionBtp.cs` ou le service de la demande (ligne d'article dans E_DAP), textes, tests.
- **Dépendances** : lot 17.
- **Tests** : JS : choix d'un article sans réseau ; C# : ligne E_DAP portant l'article.
- **Critère de fin** : `npm test` vert ; demande avec un article de la bibliothèque visible au bureau.

## Lot 19 : pointage des heures de matériel à la borne (TS18 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/pages/borne.js` (après les heures : durée sur les matériels affectés du jour),
  `client/src/app/pointage/releves-borne.js` (liste des matériels affectés réutilisée), route de la borne côté cœur
  (écriture `pointage_materiel`, source BORNE, identification `JetonsBorne` sans changement du module Pointage), tests.
- **Dépendances** : aucune.
- **Tests** : C# : durée enregistrée pour un matériel affecté, refus d'un matériel d'un autre ; JS : écran.
- **Critère de fin** : `npm test` vert ; heures pointées à la borne visibles en déboursé du chantier (rentabilité).

## Lot 20 : réception d'une commande à options ou variantes (TS19)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `src/LogiBTP.Api/Btp/TerrainComplementsBtp.cs` (livraison), `terrain/complements-terrain.js`, tests C#.
- **Contenu** : vérifier d'abord si une commande fournisseur sait quelles options et variantes sont retenues (module
  Document). Si oui : réception acceptée avec les seules lignes retenues ; sinon : refus gardé, message qui le dit.
- **Dépendances** : aucune.
- **Tests** : C# : commande avec option retenue et option écartée → seule la retenue est proposée.
- **Critère de fin** : `npm test` vert ; écart consigné dans ce plan si le refus est gardé.

## Lot 21 : avancement réel par marché (TS20 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `src/LogiBTP.Api/Btp/TerrainComplementsBtp.cs` (comparaison de l'onglet Gestion du marché : tâches du
  marché par leur origine ordre ou ligne ; tâches de niveau chantier exclues quand le chantier a plusieurs marchés),
  l'onglet Gestion (mention des tâches exclues), textes, tests C#.
- **Dépendances** : aucune (lot 7 utile mais non requis).
- **Tests** : C# : chantier à deux marchés, avancement propre à chacun ; chantier à un marché inchangé.
- **Critère de fin** : `npm test` vert.

## Lot 22 : facture brouillon depuis le bon de SAV (TS21 a, TS22 c)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `src/LogiBTP.Api/Btp/TerrainSavBtp.cs` ou nouveau `FacturationSavBtp.cs` (facture brouillon : temps au
  prix de l'article « Main-d'œuvre SAV » de la bibliothèque, désigné en paramètre, fournitures du bon), paramètre de
  l'article (script `db/2xx_sav_facturation.sql`), bouton « Facturer » au bureau (panneau de l'ordre SAV ou tâche du CRM
  « à facturer »), textes, tests C#.
- **Dépendances** : aucune.
- **Points ouverts** : pas d'article paramétré → bouton masqué ou facture sans ligne de temps : `OUVERT` (proposé :
  bouton masqué avec l'explication).
- **Tests** : C# : bon de 2 h et deux fournitures → facture brouillon de trois lignes, non validée ; second clic refusé
  si une facture brouillon existe déjà.
- **Critère de fin** : `npm test` vert ; `dotnet test` des moteurs inchangé (aucune règle de calcul modifiée).

## Lot 23 : création d'une intervention SAV hors ligne (TS23 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `client/src/app/terrain/sav-terrain.js` (création sur l'appareil, numéro provisoire), `hors-ligne/
  operations.js` (type création d'intervention, envoyée avant son compte rendu), `operations-terrain.js` (clients déjà
  lus gardés), `TerrainSavBtp.cs` (création idempotente par identifiant de l'appareil), tests.
- **Dépendances** : lot 9.
- **Tests** : JS : création et compte rendu gardés puis envoyés dans l'ordre ; C# : renvoi en double sans doublon.
- **Critère de fin** : `npm test` vert ; intervention créée sans réseau puis visible au bureau avec son numéro définitif.

## Lot 24 : chantier « Entretien et dépannage » par le chrono des chantiers (TS24 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : haiku.
- **Fichiers** : `src/LogiBTP.Api/Btp/TerrainSavBtp.cs` (code par le chrono des chantiers au lieu de `SAV-<client>` ;
  chantier existant d'un client retrouvé par l'affaire de gestion SAV et le client, plus par son code), tests C#.
- **Dépendances** : aucune.
- **Tests** : C# : nouveau client → code du chrono ; client ayant déjà un `SAV-<client>` → chantier réutilisé.
- **Critère de fin** : `npm test` vert.
