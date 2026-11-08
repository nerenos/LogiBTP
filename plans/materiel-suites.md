# Restes du TODO : suites du matériel

> Plan autonome, index : [corrections-novembre.md](corrections-novembre.md). Analyse :
> [ANALYSE-CORRECTIONS-NOVEMBRE.md](../documentation/conception/ANALYSE-CORRECTIONS-NOVEMBRE.md) § 1 (Matériel,
> Refacturation interne). Sujets sans analyse détaillée : les questions ouvertes ci-dessous sont à trancher **au démarrage
> du plan** ; les lots suivent la recommandation.
>
> Contexte utile :
> - Affectations : table `materiel_affectation` (`maf_*`, `db/231_materiel_affectations.sql:10`), serveur
>   `src/LogiBTP.Api/Btp/AffectationsMateriel.cs` (`AffectationMaterielSaisie :10`, `EtatMateriel :70`, `EnregistrerAsync :76`,
>   routes `MapAffectationsMateriel :160`), règles `src/LogiBTP.Domaine/Ressources/ReglesAffectations.cs:25`.
> - Compteurs : `materiel_releve` (`db/233_materiel_compteurs.sql:41`, source `BORNE` déjà prévue `:48`) et
>   `materiel_evenement` (`:24`, pleins de carburant compris), serveur `src/LogiBTP.Api/Btp/CompteursMateriel.cs`
>   (`ControlerReleveAsync :58`, `InsererReleveAsync :77`, `AjouterReleveAsync :88`). Borne : `client/src/app/pages/borne.js`,
>   identification par le module Pointage (`modules/pointage/dotnet/LogiBTP.Pointage.Web/ServiceBorne.cs`, `JetonsBorne :60`).
> - Entretiens : `db/234_materiel_entretien.sql`, `src/LogiBTP.Api/Btp/EntretiensMateriel.cs`, écran
>   `client/src/app/ressources/entretiens-ui.js` ; données de démonstration : `client/src/app/demo.js`,
>   `client/scripts/generer-modules-demo.mjs`.
> - Coûts et rentabilité : `src/LogiBTP.Api/Btp/CoutsMateriel.cs` (`ChantierMaterielAsync :37`, `CoutsAsync :78`),
>   `src/LogiBTP.Api/Btp/RentabiliteBtp.cs` (carburant `:130`, `:253`), module Rentabilité
>   (`modules/rentabilite/js/src/indicateurs.js`, composantes `modules/rentabilite/js/src/codes.js:22` ↔ `Codes.cs`),
>   page `client/src/app/pages/rentabilite.js` (`#materiel :837`).
> - Import : module `modules/import/js/src/` (JS seul : `correspondances.js`, `optim.js`), dépôt du cœur
>   `client/src/app/import/depot-import.js:13`, formats `client/src/app/import/formats.js:12`.
>
> Décisions (08/11/2026) :
> - **Q7 (b)** : photo de l'état au départ **et** au retour d'une affectation, déposée dans la GED du matériel depuis la
>   ligne d'affectation et rattachée à l'affectation.
> - Les autres sujets (relevés à la borne, démonstration d'entretiens, refacturation interne, cartes carburant) font partie
>   du périmètre (Q1 : tout) ; leurs choix restent ouverts ci-dessous.

## Questions ouvertes (à trancher au démarrage)

| N° | Question | Recommandation | Statut |
|---|---|---|---|
| MO1 | Rattachement des photos : colonnes sur l'affectation ou rattachement GED par type d'élément ? | Deux colonnes `maf_ged_depart` / `maf_ged_retour` (identifiant du document GED, comme `per_image_ged`, `db/229`), document classé dans la GED du matériel. | ✔ Tranché (08/11/2026) : colonnes sur l'affectation (recommandation retenue). |
| MO2 | Relevé à la borne : qui peut saisir, pour quel matériel ? | Le salarié identifié, pour les matériels qui lui sont affectés ce jour (`materiel_affectation`) ; contrôle `ControlerReleveAsync` inchangé ; source `BORNE`. | ✔ Tranché (08/11/2026) : le salarié identifié, pour les matériels qui lui sont affectés ce jour avec une liste rapide de choix, mais aussi le reste du matériel avec validation comme pour la saisie de la main-d'œuvre (relevé sur un matériel non affecté accepté mais à valider au bureau, comme les pointages à valider). |
| MO3 | Démonstration d'entretiens : quel historique ? | Entretiens réalisés répartis sur les 12 derniers mois selon les plans d'entretien, pour qu'une partie seulement soit en retard. | ✔ Tranché (08/11/2026) : recommandation retenue. |
| MO4 | Refacturation interne : comment créditer le chantier de suivi du matériel ? | Produit interne calculé dans la Rentabilité (même montant que les heures valorisées sur les chantiers), sans pièce ni écriture comptable. | ✔ Tranché (08/11/2026) : recommandation retenue. |
| MO5 | Coût par heure de l'onglet Coûts « proposé » comme coût moyen de la fiche : automatique ou sur action ? | Sur action : bouton « Reprendre comme coût moyen » dans l'onglet Coûts, avec confirmation (`confirmer`). | ✔ Tranché (08/11/2026) : recommandation retenue. |
| MO6 | Cartes carburant : formats et rattachement d'un plein à un matériel ? | Fichier CSV par fournisseur de cartes décrit par des correspondances (modèle `correspondances.js`) ; rapprochement par numéro de carte porté par la fiche matériel, sinon immatriculation ; plein écrit en `materiel_evenement` et relevé `CARBURANT`. | ✔ Tranché (08/11/2026) : recommandation retenue. |

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Photos de départ et de retour : base et serveur | cœur | MO1 | FAIT (08/11/2026) |
| 2 | Photos de départ et de retour : ligne d'affectation | cœur | 1 | FAIT (08/11/2026) |
| 3 | Relevés de compteurs à la borne : serveur | cœur | MO2 | FAIT (08/11/2026) |
| 4 | Relevés de compteurs à la borne : écran | cœur | 3 | FAIT (08/11/2026) |
| 5 | Données de démonstration d'entretiens | cœur | MO3 | FAIT (08/11/2026) |
| 6 | Refacturation interne : composante « produit interne » | `modules/rentabilite` | MO4 | FAIT |
| 7 | Refacturation interne : crédit du chantier de suivi | cœur | 6 | FAIT (08/11/2026) |
| 8 | Coût par heure proposé comme coût moyen | cœur | MO5 | A FAIRE |
| 9 | Cartes carburant : lecture du fichier | `modules/import` | MO6 | A FAIRE |
| 10 | Cartes carburant : rapprochement et écriture des pleins | cœur | 9 | A FAIRE |

---

## Lot 1 : photos de départ et de retour, base et serveur (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : nouveau script `db/278_materiel_affectation_photos.sql` (numéro à confirmer, rejouable) et
  `db/installation/scripts.txt`, `AffectationsMateriel.cs` (`AffectationMaterielSaisie :10`, `EnregistrerAsync :76`,
  lecture des deux identifiants, routes `:160` rattachées dans `SpecialisationDroitsBtp.Routes`), tests C#.
- **Dépendances** : MO1 tranchée.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : C# : photo de départ et de retour enregistrées ; document d'un autre matériel refusé ;
  suppression du document GED → identifiant remis à vide.
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert ; script rejoué deux fois sans erreur.
- **Réalisé / écarts** : script `db/279` (et non 278, pris), appliqué aux deux bases de développement et rejoué ; colonnes
  `maf_ged_depart` / `maf_ged_retour` ; triggers sur `document_ged` (suppression logique ou physique → identifiant vide) ;
  `AffectationMaterielSaisie` reçoit `GedDepart` / `GedRetour` (vide = photo déjà enregistrée conservée, pour que le client
  actuel ne les efface pas) ; document refusé (`AFF_PHOTO`, règle `PhotosAffectation`) s'il n'est pas une pièce non supprimée de
  la GED de ce matériel ; historique JSON : `ged_depart`, `ged_retour`. Aucune nouvelle route (droits inchangés). Tests :
  `PhotosAffectationTests.cs` (règle pure ; trigger sur la base si `LOGIBTP_TEST_PG`, transaction annulée) ; le refus par la
  route n'est pas testé de bout en bout (pas de banc d'essai HTTP sur base dans les tests du cœur).

## Lot 2 : photos de départ et de retour, ligne d'affectation (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : écran des affectations du matériel (`client/src/app/ressources/`, graphify « affectations matériel
  écran »), dépôt dans la GED du matériel (module GED, appel existant), vignette et ouverture, textes et icônes
  (`texte()`, `icone()`), test client.
- **Dépendances** : lot 1.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : test client : dépôt de la photo de départ depuis la ligne ; retour → photo de retour ; vignettes.
- **Critère de fin** : `npm test` vert.
- **Réalisé / écarts** : deux colonnes « Photo au départ / au retour » dans `rendreAffectations` (vignette cliquable ouvrant l'image, bouton de dépôt par `ged.deposer`, catégorie photo, type d'élément matériel) ; photo de retour déposable une fois l'affectation terminée ; l'identifiant est enregistré avec l'affectation (`ged_depart` / `ged_retour`). Helpers `photosAffectation` / `definirPhoto` (`affectations.js`), message `AFF_PHOTO`, icône `ressources_btp_photo`. Test sur les helpers (pas de banc DOM pour l'écran). `npm test` : seuls les 2 échecs connus.

## Lot 3 : relevés de compteurs à la borne, serveur (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `CompteursMateriel.cs` (`AjouterReleveAsync :88` avec source `BORNE`, matériels affectés au salarié de
  la borne), route de borne (identification `JetonsBorne`, `ServiceBorne.cs:60`, sans changement du module Pointage),
  rattachement des droits, tests C#.
- **Précision MO2** : le salarié identifié peut relever les matériels qui lui sont affectés ce jour (liste rapide) mais aussi
  tout autre matériel ; un relevé sur un matériel non affecté est accepté mais à valider au bureau (comme les pointages à
  valider).
- **Dépendances** : MO2 tranchée. Si l'identification de borne n'est pas utilisable depuis le cœur, un lot
  `modules/pointage` (point d'accroche) passe avant : à noter ici.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : relevé accepté pour un matériel affecté ce jour ; relevé sur un autre matériel accepté mais à valider ; contrôle de valeur
  inférieure maintenu.
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert.
- **Réalisé / écarts** : script `db/280` (non appliqué aux bases) : `mre_a_valider`, `mre_sal_id`, `mre_traite_par/le` ; `CompteursBorneBtp.cs` : `GET /api/pointage/borne/materiel?jeton=` (affectés ce jour / autres), `POST /api/pointage/borne/materiel/releves` (source BORNE, contrôle inchangé, `aValider` si non affecté ; borne d'essai : rien d'écrit), `GET` et `POST /api/ressources/materiels/releves-a-valider[/{id}]` (admin ou responsable du service ; refus = suppression, motif obligatoire). Pas de changement du module Pointage. Tests : `CompteursBorneTests.cs` (règle pure et contrôle ; pas de banc HTTP sur base).

## Lot 4 : relevés de compteurs à la borne, écran (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/pages/borne.js` (nouvelle entrée « Compteurs » : matériels affectés, saisie de la
  valeur), textes, mode hors ligne si la borne le gère déjà (`client/src/app/hors-ligne/operations.js`), test client.
- **Dépendances** : lot 3.
- **Règles répliquées JS / C#** : aucune.
- **Précision MO2** : liste rapide des matériels affectés ce jour, plus accès au reste du matériel ; relevé hors affectation
  signalé « à valider au bureau ».
- **Jeux de tests** : test client : liste des matériels affectés, saisie, relevé hors affectation à valider, message de refus.
- **Critère de fin** : `npm test` vert.
- **Réalisé / écarts** : bouton « Compteurs » de l'écran chantier de la borne, écran `#compteurs` (liste rapide des affectés ce jour, bascule « Autre matériel » et recherche, saisie par unité suivie avec remise à zéro, message « à valider au bureau »), helpers `client/src/app/pointage/releves-borne.js`, test `releves-borne.test.js`. Pas de mode hors ligne (la borne n'utilise pas `hors-ligne/`). Écran de validation au bureau des relevés à valider non fait (reporté au TODO). `npm test` : seuls les 2 échecs connus.

## Lot 4b : validation au bureau des relevés de la borne (FAIT 2026-11-08)

- **Module** : cœur. **Fichiers** : `client/src/app/pages/releves-a-valider.js`, `api.js`, `pages/index.js`, `navigation/menus.js`, `personnalisation/fr.json` et `images/icones.json`.
- **Règles répliquées JS / C#** : aucune. **Critère de fin** : `npm test` vert (hors 2 échecs connus).
- **Réalisé / écarts** : page `/ressources/releves-a-valider` (menu Ressources, droit du module) : tableau matériel, salarié, date, compteur, valeur, commentaire ; acceptation, refus avec motif (`saisir`, relevé supprimé). Le serveur filtre par droit de traitement. Pas de test client dédié (écran sans règle).

## Lot 5 : données de démonstration d'entretiens (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/demo.js` et/ou `client/scripts/generer-modules-demo.mjs` (historique d'entretiens
  réalisés), éventuel script de démonstration `db/` (manifeste), test de la démo s'il existe.
- **Dépendances** : MO3 tranchée.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : la démo affiche des entretiens à jour, à échéance proche et en retard.
- **Critère de fin** : `npm test` vert ; écran des entretiens de la démo non entièrement en retard.
- **Réalisé / écarts** : fonction pure `client/scripts/entretiens-demo.mjs` (`planifierEntretiensDemo`) : pour chaque plan à périodicité en mois, dernier entretien placé à jour / à échéance proche / en retard en alternance, entretiens antérieurs à la périodicité dans les 12 derniers mois (un plan annuel en retard remonte à 12 mois + 20 jours). Étape ajoutée à `generer-modules-demo.mjs` : événements ENTRETIEN datés avec code de plan (`POST /ressources/materiels/{id}/evenements`), pas d'ordres d'entretien ; non exécutée. Plans sans mois ignorés. Test `entretiens-demo.test.js`. `npm test` : seuls les 2 échecs connus.

## Lot 6 : refacturation interne, composante « produit interne » (FAIT 08/11/2026)

- **Module** : `modules/rentabilite`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `modules/rentabilite/js/src/codes.js` (`:22`) ↔ `Codes.cs` (nouvelle composante), `indicateurs.js` ↔
  pendant C# du module (produit interne compté en produit du chantier de suivi), jeu de cas du module, `CodesTests`.
- **Dépendances** : MO4 tranchée.
- **Règles répliquées JS / C#** : marge d'un chantier avec produit interne (JS / C#, même jeu).
- **Jeux de tests** : chantier de suivi crédité du montant des heures valorisées ailleurs ; total société inchangé.
- **Critère de fin** : jeu vert en JS et en C# ; `npm test`, `dotnet test LogiBTP.slnx` verts.
- **Réalisé / écarts** : composante `PRODUIT_INTERNE` (codes.js ↔ Codes.cs, texte fr.json) ; règle `margeChantier` (`js/src/marge.js`) ↔ `Marges.Chantier` (`Marges.cs`, nouveau : le module n'avait pas de marge en C#), jeu `tests/cas/03_marge_produit_interne.json`, tests JS et `MargesTests`. `blocResultats` ajoute `produit_interne` (faits DEBOURSE de cette composante, PV seul, PA/PR nuls) au produit des marges des lignes réalisé, production, facturé et prévisionnel ; les colonnes du Détail et les coûts sont inchangés. Production des faits : lot 7. `npm test` : 2 échecs connus ; `dotnet test` vert.

## Lot 7 : refacturation interne, crédit du chantier de suivi (FAIT 08/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `RentabiliteBtp.cs` (montant des heures du matériel valorisées sur les chantiers, crédité au chantier de
  suivi), `CoutsMateriel.cs` (`ChantierMaterielAsync :37`), `client/src/app/pages/rentabilite.js` (`#materiel :837`),
  tests C#.
- **Dépendances** : lot 6.
- **Règles répliquées JS / C#** : aucune nouvelle (lot 6).
- **Jeux de tests** : matériel pointé 10 h sur deux chantiers → chantier de suivi crédité du même total.
- **Critère de fin** : `dotnet test LogiBTP.slnx` et `npm test` verts.
- **Réalisé / écarts** : `RentabiliteBtp.cs` : pour un chantier de suivi, lecture des `pointage_materiel` des matériels dont `mat_cha_id` est ce chantier pointés ailleurs, faits DEBOURSE `PRODUIT_INTERNE` (PV = heures × coût horaire effectif, 0 si loué ou sans coût ; PA/PR nuls), `MontantProduitInterne` (même arrondi que le déboursé), règle `PRODUIT_INTERNE` (texte client), `VersionRegles` 6 (recalcul). `CoutsMateriel.cs` et `rentabilite.js` inchangés (`#materiel` = paramètres, rien à y ajouter ; les coûts ne reprennent pas le produit). Tests `ProduitInterneMaterielTests` (règle pure, pas de banc base). `npm test` : 2 échecs connus ; `dotnet test` vert.

## Lot 8 : coût par heure proposé comme coût moyen (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : onglet Coûts de la fiche matériel (graphify « onglet Coûts matériel »), `CoutsMateriel.cs`
  (`CoutsAsync :78`), action de reprise (`confirmer`), test client.
- **Dépendances** : MO5 tranchée.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : reprise → coût moyen de la fiche = coût par heure affiché ; annulation → inchangé.
- **Critère de fin** : `npm test` vert.

## Lot 9 : cartes carburant, lecture du fichier (A FAIRE)

- **Module** : `modules/import`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/import/js/src/carburant.js` (nouveau : lecture CSV décrite par correspondances, sur le modèle
  de `correspondances.js`), `modules/import/js/src/index.js` (export), test du module avec un fichier d'exemple.
- **Dépendances** : MO6 tranchée.
- **Règles répliquées JS / C#** : aucune (module JS seul).
- **Jeux de tests** : fichier d'exemple → pleins (date, carte, immatriculation, litres, montant, kilométrage) ; ligne
  mal formée signalée.
- **Critère de fin** : `npm test` vert.

## Lot 10 : cartes carburant, rapprochement et écriture des pleins (A FAIRE)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `client/src/app/import/formats.js` (`:12`, format carburant), `depot-import.js` (`:13`),
  `client/src/app/import/rapport-import.js` (non repris), route serveur d'écriture en `materiel_evenement` et relevé
  `CARBURANT` (`CompteursMateriel.cs:77`), numéro de carte sur la fiche matériel si MO6 le retient (script `db/` et
  manifeste), droits, tests C# et client.
- **Dépendances** : lot 9.
- **Règles répliquées JS / C#** : aucune.
- **Jeux de tests** : plein rapproché par carte, par immatriculation, non rapproché (rapport) ; doublon ignoré.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts ; les pleins importés apparaissent dans la
  rentabilité du matériel.
