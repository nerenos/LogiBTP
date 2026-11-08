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
| 1 | Ménage du TODO (points déjà faits) | documentation | — | A FAIRE |
| 2 | Case « Terrain » d'un plan du suivi des validations | `modules/crm` | — | A FAIRE |
| 3 | Plans en vigueur sur le terrain | cœur | 2 | A FAIRE |
| 4 | Plans gardés hors ligne, budget à part | cœur | 3 | A FAIRE |
| 5 | Bandeau adaptatif sur téléphone | `modules/navigation` | — | A FAIRE |
| 6 | Menu simplifié du terrain et raccourci vers le menu classique | cœur | 5 | A FAIRE |
| 7 | Pointage à la ligne d'ordre | cœur | — | A FAIRE |
| 8 | Photos HEIC converties par l'iPhone | cœur | — | A FAIRE |
| 9 | Hors ligne : chantiers et ordres ouverts du service | cœur | — | A FAIRE |
| 10 | Hors ligne : ordre saisi par son numéro, résolu à l'envoi | cœur | 9 | A FAIRE |
| 11 | Limite de dépôt de la GED exposée au client | `modules/ged` | — | A FAIRE |
| 12 | Contrôle de taille des photos à la prise de vue | cœur | 11 | A FAIRE |
| 13 | PV de réception : forme de signature et heure de l'appareil | cœur | — | A FAIRE |
| 14 | Réserves suivies : base et serveur | cœur | 13 | A FAIRE |
| 15 | Réserves suivies : levée depuis le terrain et suivi au bureau | cœur | 14 | A FAIRE |
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

## Lot 1 : ménage du TODO

- **Module** : documentation. **Agent** : `lot-dev`. **Modèle** : haiku.
- **Fichiers** : `TODO.md` (§ Application de terrain), `documentation/TACHES.md` n'est pas touché (réservé aux humains).
- **Contenu** : retirer de la ligne « Lot 7, suites » les heures de matériel non valorisées et les relevés à la borne
  (avec le renvoi vers `db/261` et materiel-suites), garder le pointage des heures à la borne ; lien vers ce plan ;
  contrats d'entretien renvoyés à une analyse à part.
- **Règles répliquées** : aucune. **Tests** : aucun.
- **Critère de fin** : TODO.md relu, liens valides.

## Lot 2 : case « Terrain » d'un plan du suivi des validations (TS2)

- **Module** : `modules/crm`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : nouveau script `modules/crm/db/098b_crm_plan_terrain.sql` (`crm_plan.pla_terrain BOOLEAN NOT NULL
  DEFAULT FALSE`), `db/installation/scripts.txt`, `LogiBTP.Crm.Web/Donnees.cs`, `ServiceCrm.Validations.cs` (lecture et
  écriture), `js/src/plans.js` (case dans la fiche du plan), tests du module.
- **Dépendances** : aucune.
- **Règles répliquées** : aucune (l'indice en vigueur reste `etatPlan` / `ReglesValidation`, inchangé).
- **Tests** : C# : case enregistrée et relue ; JS : rendu de la case.
- **Critère de fin** : `npm test` vert ; script rejoué deux fois sans erreur ; case visible et gardée dans le suivi des
  validations.

## Lot 3 : plans en vigueur sur le terrain (TS1, TS2)

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

## Lot 4 : plans gardés hors ligne, budget à part (TS3)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/pwa/sw.js` (cache des plans séparé de celui des pièces « Terrain », 25 Mo par défaut),
  `client/src/app/terrain/operations-terrain.js` (préchargement des plans **cochés**), tests JS.
- **Dépendances** : lot 3.
- **Points ouverts** : taille du budget des plans (25 Mo proposés, comme les pièces) : `OUVERT`, à confirmer au démarrage.
- **Tests** : JS : budget atteint → plans les plus anciens non gardés, pièces « Terrain » intactes.
- **Critère de fin** : `npm test` vert ; plan coché ouvert sans réseau après une ouverture en ligne de « Mon terrain ».

## Lot 5 : bandeau adaptatif sur téléphone (TS4 b)

- **Module** : `modules/navigation`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/navigation/js/ui/bandeau.js`, sa feuille de style, tests du module.
- **Contenu** : sous 700 px, le bandeau tient sur la largeur (360 px) : menus regroupés derrière un bouton, infos
  (société, API, cloche, pastille hors ligne) en icônes ; option `simplifie` acceptée par le bandeau (liste de menus
  réduite fournie par l'application, bouton pour basculer vers les menus complets), utilisée par le lot 6.
- **Dépendances** : aucune.
- **Règles répliquées** : aucune.
- **Tests** : JS : bascule simplifié / complet ; capture à 360 px sans défilement horizontal (Playwright).
- **Critère de fin** : `npm test` vert ; aucune page ne déborde horizontalement à 360 px à cause du bandeau.

## Lot 6 : menu simplifié du terrain et raccourci vers le menu classique (TS4 a)

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

## Lot 7 : pointage à la ligne d'ordre (TS5 a, TS6 a, TS7 a)

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

## Lot 8 : photos HEIC converties par l'iPhone (TS8 a, TS9 b)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : haiku.
- **Fichiers** : `client/src/app/terrain/actions-tache.js` (champs fichier `accept="image/jpeg,image/png"` au lieu de
  `image/*`, pour que Safari transcode en JPEG), mêmes champs des pages réception et SAV, `terrain/terrain.js`
  (réduction : HEIC reçu malgré tout envoyé tel quel, comme aujourd'hui).
- **Dépendances** : aucune.
- **Tests** : JS : attribut `accept` des champs photo.
- **Critère de fin** : `npm test` vert ; **essai sur un iPhone par l'utilisateur** : photo de l'appareil et de la
  galerie arrivées en JPEG réduit dans la GED. Si l'essai échoue, le point revient en question (pas de secours prévu).

## Lot 9 : hors ligne, chantiers et ordres ouverts du service (TS10 b, TS11 b)

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

## Lot 10 : hors ligne, ordre saisi par son numéro, résolu à l'envoi (TS11 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/terrain/pointage-terrain.js` (numéro inconnu de l'appareil accepté, marqué « à
  vérifier »), `client/src/app/hors-ligne/operations.js` (type d'opération de journée : numéro à résoudre),
  `TerrainPointageBtp.cs` (résolution à l'envoi, refus `ORDRE_INCONNU` signalé selon T9), codes `client/src/app/codes.js`
  ↔ `src/LogiBTP.Domaine/Codes.cs`, tests.
- **Dépendances** : lot 9.
- **Tests** : C# : numéro résolu, numéro inconnu refusé ; JS : saisie gardée puis marquée refusée.
- **Critère de fin** : `npm test` vert ; `CodesTests` du cœur vert.

## Lot 11 : limite de dépôt de la GED exposée au client (TS12)

- **Module** : `modules/ged`. **Agent** : `lot-dev`. **Modèle** : haiku.
- **Fichiers** : `LogiBTP.Ged.Web/ServiceGed.cs` (route de lecture de `TailleMaxDepot`, ou champ ajouté à une lecture
  existante des paramètres), `modules/ged/js/src` (lecture côté client), tests du module.
- **Dépendances** : aucune.
- **Tests** : C# : valeur renvoyée = spécialisation.
- **Critère de fin** : `npm test` vert.

## Lot 12 : contrôle de taille des photos à la prise de vue (TS12)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/terrain/terrain.js` (réduction forcée au-delà de la limite ; « qualité d'origine » trop
  lourde refusée tout de suite avec la limite en Mo), `operations-terrain.js` (limite gardée pour le hors ligne),
  textes `terrain_btp.*`, tests JS.
- **Dépendances** : lot 11.
- **Tests** : JS : photo trop lourde refusée avant d'être gardée.
- **Critère de fin** : `npm test` vert.

## Lot 13 : PV de réception, forme de signature et heure de l'appareil (TS13 a, TS16 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : nouveau script `db/2xx_reception_appareil.sql` (heure de signature sur l'appareil dans la réception),
  `src/LogiBTP.Api/Btp/TerrainReceptionBtp.cs`, `client/src/app/pages/terrain-reception.js` et l'opération hors ligne
  de réception (heure de l'appareil envoyée), modèle d'édition `PV_RECEPTION` (« Signature électronique simple, signée
  sur l'appareil le…, reçue le… »), tests C#.
- **Dépendances** : aucune. Confirmation juridique de la signature simple : **de votre côté**, hors code.
- **Tests** : C# : les deux heures enregistrées et imprimées ; réception en ligne : une seule heure.
- **Critère de fin** : `npm test` vert ; script rejoué deux fois sans erreur.

## Lot 14 : réserves suivies, base et serveur (TS14 a)

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

## Lot 15 : réserves suivies, levée depuis le terrain et suivi au bureau (TS14 a)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/pages/terrain-reception.js` (liste des réserves de l'ordre, levée avec photo, gardée
  hors ligne), `client/src/app/hors-ligne/operations.js` (type d'opération levée), panneau de l'ordre au bureau (réserves
  et leur état), textes, tests JS.
- **Dépendances** : lot 14.
- **Tests** : JS : levée gardée hors ligne puis envoyée.
- **Critère de fin** : `npm test` vert ; une réserve levée sur le terrain apparaît levée au bureau.

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
