# Module Stock : plan des lots restants (S24-d et clôture)

> Analyse : [ANALYSE-MODULE-STOCK.md](../documentation/conception/ANALYSE-MODULE-STOCK.md) ; questions :
> [stock-questions.md](stock-questions.md) (Q1 à Q10 retenues le 06/11/2026). Périmètre (Q1) : S24-d (numéros de série →
> équipements installés) et clôture du stock (état valorisé, variation, dépréciation) ; les ouvrages fabriqués par
> l'atelier restent hors plan (analyse propre). Ordre : socle (rien ici), modules, puis cœur.

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Analyse et TODO à jour de S24-c | documentation | — | FAIT |
| 2 | Module SAV : équipements installés | `modules/sav` (nouveau) | — | FAIT (C# à compiler) |
| 3 | Durée de garantie des articles suivis | `modules/stock` | — | FAIT |
| 4 | Équipements créés par les mouvements de stock | cœur | 2, 3 | FAIT (C# à compiler) |
| 5 | Écrans des équipements | cœur | 4 | FAIT |
| 6 | Interventions SAV rattachées aux équipements | cœur | 5 | FAIT |
| 7 | Stock valorisé à date de tous les lieux | `modules/stock` | — | FAIT |
| 8 | État du stock valorisé (page, CSV, édition) | cœur | 7 | PARTIEL |
| 9 | Écritures de variation et de dépréciation | `modules/comptabilite` | — | FAIT |
| 10 | Clôture du stock : variation de fin d'exercice | cœur | 7, 9 | FAIT |
| 11 | Clôture du stock : provision pour dépréciation | cœur | 10 | FAIT |

---

## Lot 1 : analyse et TODO à jour de S24-c (FAIT, 06/11/2026)

- **Module** : documentation. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `documentation/conception/ANALYSE-MODULE-STOCK.md` (en-tête « Réalisation » : S24-c, ses écarts relevés
  dans le commit f93dff5b ; § 11.5), `TODO.md` (section Stock : S24-c fait, S24-d et clôture planifiés par ce plan),
  `documentation/TACHES.md` n'est pas touché (réservé aux humains). Aucun CLAUDE.md (Q10).
- **Règles répliquées** : aucune. **Jeux** : aucun.
- **Critère de fin** : l'en-tête de l'analyse et le TODO citent S24-c et renvoient à `plans/stock.md`.

## Lot 2 : module SAV, équipements installés (FAIT, 06/11/2026)

- **Réalisé** : script `modules/sav/db/093s_sav.sql` (après `093h` dans le manifeste), couche de textes déclarée dans
  `client/personnalisation/couches.js`, projets ajoutés à `LogiBTP.slnx` et au `package.json` racine ; `npm test` du module
  vert (27 cas), SQL rejoué deux fois ; **C# non compilé dans la session** (pas de .NET) : `dotnet test LogiBTP.slnx` à
  lancer. Échecs préexistants de `client/test/personnalisation.test.js` (clé de `menus.js`, message `STK_HORIZON`).

- **Module** : `modules/sav` (nouveau, dépend du socle seul ; ne dépend ni du Stock ni du cœur, Q2).
  **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `modules/sav/db/<numéro>_sav.sql` (table `equipement_installe` : article, numéro de série, lot
  `stk_lot` facultatif par identifiant sans clé étrangère vers le Stock, chantier, client, date de pose, fin de
  garantie, état, origine — pièce et ligne —, `remplace_id`, commentaire ; rejouable), `db/installation/scripts.txt`,
  `modules/sav/js/src/codes.js` ↔ `modules/sav/dotnet/LogiBTP.Sav/Codes.cs` (`ETAT_EQUIPEMENT` : INSTALLE, RETIRE,
  REMPLACE ; `ORIGINE_EQUIPEMENT` : MOUVEMENT, MANUEL), `garantie.js` ↔ `ReglesGarantie.cs` (fin de garantie = pose +
  durée en mois, état de garantie à une date), `modules/sav/tests/cas/01_garantie.json`, `CodesTests.cs`,
  `LogiBTP.Sav.Web/ServiceEquipements.cs` (lecture, création, retrait, remplacement), `modules/sav/CLAUDE.md` court
  (créé à la demande de l'utilisateur, 06/11/2026 : seule exception à la règle des CLAUDE.md de la procédure).
- **Règles répliquées** : fin et état de garantie (jeu `01_garantie.json`) ; parité des codes.
- **Critère de fin** : `npm test` et `dotnet test LogiBTP.slnx` verts, le jeu `01_garantie.json` passe en JS et en C#.

## Lot 3 : durée de garantie des articles suivis (FAIT, 06/11/2026)

- **Réalisé** : `093i_stock_garantie.sql` (`sas_garantie_mois`, 1 à 600, rejoué deux fois), `ServiceTracabilite.cs`
  (`GarantieMois` du DTO, erreur `STK_GARANTIE`, conservée seulement si l'article est suivi), champ « Garantie » de la
  section Lots et numéros de série, textes `stock_btp.lots.garantie*`, ligne dans `modules/stock/CLAUDE.md`. C# non compilé.

- **Module** : `modules/stock`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `modules/stock/db/093i_stock_garantie.sql` (`stk_article_suivi.sas_garantie_mois`, facultatif, Q4),
  `db/installation/scripts.txt`, `LogiBTP.Stock.Web/ServiceTracabilite.cs` (lecture et écriture du suivi),
  `client/src/app/stock/lots-article.js` (champ dans la section « Lots et numéros de série »), textes `stock_btp.*`.
- **Règles répliquées** : aucune. **Jeux** : aucun.
- **Critère de fin** : la durée se saisit dans l'onglet Stock de l'article et se relit ; `npm test` vert.

## Lot 4 : équipements créés par les mouvements de stock (FAIT, 06/11/2026)

- **Réalisé** : `db/273_sav_equipements.sql` (module `sav`, clés étrangères, droits copiés du nœud `stock`, trigger
  `f_sav_piece_retiree` ; testé sur schéma minimal), `Btp/EquipementsSavBtp.cs` (création, retrait, `SpecialisationSavBtp`),
  appel dans `ApresValidationAsync`, routes `/api/sav` et nœud `sav` déclarés, `Sav` dans `ModulesFacultatifs` ↔ `MODULE_FACULTATIF`.
- **Écarts** : pose = date du mouvement (la réception de pose E_PO vient après la livraison ; affinage possible plus tard) ;
  un numéro non saisi sur la ligne ne crée rien (Q5) ; pas de test automatisé du cœur (aucune base de test) ; **C# non compilé**.

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `db/273_sav_equipements.sql` (module `sav` dans `module_societe`, retrait des équipements à la
  dévalidation ou l'annulation de la pièce comme les mouvements), `src/LogiBTP.Api/Btp/EquipementsSavBtp.cs` (à la
  validation : article SERIE avec numéro, mouvement vers un chantier client — ni dépôt, ni interne, ni dotation —, BL,
  facture sans BL, entrée consommée sur un chantier client, Q3 ; sans numéro : aucun équipement, avertissement
  `STK_LOTS_MANQUANTS`, Q5 ; date de pose = réception E_PO du chantier sinon date du mouvement, garantie de l'article,
  Q4 ; `V_RETOUR` ou transfert inverse → RETIRE, Q6), `MouvementsStockBtp` ou `LotsStockBtp.cs` (point d'appel),
  `Program.cs` (enregistrement), `SpecialisationDroitsBtp` (routes), tests du cœur.
- **Règles répliquées** : aucune nouvelle (garantie du lot 2). **Jeux** : cas du cœur sur une base de test (BL d'un
  article SERIE → équipement ; dévalidation → retiré).
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert ; un BL validé d'un article suivi par numéro de série crée un
  équipement, sa dévalidation le retire.

## Lot 5 : écrans des équipements

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/fiches/definitions.js` (type de fiche `equipement`), `client/src/app/vues-liste.js`
  (liste `equipements` : numéro, article, client, chantier, pose, fin de garantie, état ; recherche par numéro, Q8),
  `npm run generer-vues-liste --workspace client`, `client/src/app/stock/lot.js` (lien vers les équipements du lot),
  fiche chantier (onglet ou raccourci « Équipements », création manuelle, remplacement), `navigation/menus.js`,
  `client/personnalisation/fr.json` (`sav_btp.*`), `SpecialisationFicheBtp`.
- **Règles répliquées** : aucune. **Jeux** : tests de parité des colonnes de liste.
- **Critère de fin** : liste et fiche ouvertes depuis le menu et depuis la page du lot ; `npm test` vert.
- **FAIT le 06/11/2026** (non commité). Écarts : page `/sav/equipement/:id` (`client/src/app/sav/equipement.js`) et non fiche
  de structure (`definitions.js`, `SpecialisationFicheBtp` inchangés) ; vue SQL `db/274_sav_liste.sql` (colonne `chantier`
  filtrée par `?chantier=CODE`) ; menu « SAV » propre au module ; fiche chantier : raccourci de liste + lien « Nouvel équipement » ;
  page du lot : numéros d'équipements trouvés par `GET /sav/equipements?numero&article` (aucun C# du cœur touché). Remplacement :
  même article et chantier, nouveau numéro saisi. `npm test` : seuls les 2 échecs déjà connus. Pas testé dans le navigateur.

## Lot 6 : interventions SAV rattachées aux équipements

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `db/274_sav_interventions_equipement.sql` (équipement de l'intervention E_SAV), `Btp/TerrainSavBtp.cs`,
  `client/src/app/terrain/sav-terrain.js` et `pages/terrain-sav.js` (choix par numéro ou code-barres), fiche
  équipement (historique des interventions), opération hors ligne `terrain-sav` (équipement transmis), textes.
- **Règles répliquées** : aucune. **Jeux** : aucun nouveau.
- **Critère de fin** : une intervention saisie au terrain sur un numéro de série apparaît dans l'historique de
  l'équipement ; `npm test` et `dotnet test LogiBTP.slnx` verts.
- **FAIT le 06/11/2026** (non commité ; C# non compilé). Écarts : script `db/275_sav_interventions_equipement.sql` (274 pris au lot 5) ;
  colonne `isv_eqi_id` ; `TerrainSavBtp.cs` (champ `Equipement` du compte rendu, `GET /api/terrain/sav/equipements`) ;
  `EquipementsSavBtp.MapInterventionsEquipement` (`GET /api/sav/equipements/{id}/interventions`, mappé dans `Program.cs`) ;
  `pages/terrain-sav.js` (recherche par numéro ou code-barres saisi au clavier, ni caméra ni écran dédié `sav-terrain.js`) ;
  historique sur la page de l'équipement. Opération hors ligne inchangée (le compte rendu porte l'équipement). Pas de test
  automatisé du terrain (C# et écran non essayés).

## Lot 7 : stock valorisé à date de tous les lieux

- **Module** : `modules/stock`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `valorisation.js` ↔ `ReglesValorisation.cs` (valeur d'un lieu et d'un article à une date : quantité à
  T × prix de la méthode à T, prix d'inventaire saisi S30 gardé à part comme valeur d'inventaire),
  `modules/stock/tests/cas/02_prix.json` (cas ajoutés) ou `06_valorisation_date.json`, `ServiceStock.cs`
  (`EtatValoriseAsync(date, lieux)`), `093j_stock_etat.sql` si une vue ensembliste est nécessaire.
- **Règles répliquées** : valeur à date et valeur d'inventaire (jeu ci-dessus).
- **Critère de fin** : le jeu passe en JS et en C# ; `npm test`, `dotnet test LogiBTP.slnx` verts.
- **FAIT le 07/11/2026** (non commité ; C# non compilé). Écarts : jeu `06_valorisation_date.json` (9 cas, JS vert) ; règle
  `valoriserEtat` ↔ `ValoriserEtat` (valeur d'inventaire = prix du dernier comptage chiffré de l'article à la date × quantité du lieu) ;
  `ComptageLieu` reçoit `Prix` ; `ServiceStock.EtatValoriseAsync` et route `GET /api/stock/etat-valorise` ; aucun SQL (pas de `093j`),
  tout l'historique ≤ date est rejoué en mémoire (à surveiller sur un gros stock).

## Lot 8 : état du stock valorisé

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `client/src/app/pages/` (page `/stock/etat-valorise?date=` : lieux, articles, quantités, PMP ou dernier
  PA, valeur d'inventaire, écart), `pages/index.js`, `navigation/menus.js`, export CSV, modèle d'édition
  `ETAT_STOCK_VALORISE` (`client/src/app/editions/modeles.js`, `db/191`), route dans `Btp/StockBtp.cs`,
  `SpecialisationDroitsBtp`, textes `stock_btp.*`.
- **Règles répliquées** : aucune (lot 7). **Critère de fin** : page, CSV et PDF donnent le même total à une date donnée.
- **PARTIEL, 07/11/2026** (non commité). Fait : page `/stock/etat-valorise` (`client/src/app/stock/etat-valorise.js`, tous lieux ou un seul, date-heure,
  articles à zéro, recherche), totaux par lieu, valeur d'inventaire et écart, export CSV, menu Stock, textes `stock_btp.valorise.*`,
  `api.stock.etatValorise` ; aucune route de plus (celle du lot 7 sert) ; `npm test` : seuls les 2 échecs connus. PDF fait le
  07/11/2026 : modèle `ETAT_STOCK_VALORISE` (`modeles.js`, `db/191` régénéré), source « liste » d'identifiant
  `stock_etat|date|lieu|zéros` (`SourcesFicheListeEdition.DonneesEtatStock`, mêmes calculs que la page), bouton PDF de la page ;
  C# non compilé, aucun droit propre au stock vérifié sur cette source, écran, CSV et PDF non essayés dans un navigateur.

## Lot 9 : écritures de variation et de dépréciation

- **Module** : `modules/comptabilite`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `modules/comptabilite/db/094f_comptabilite_stock.sql` (comptes de variation et de provision par type
  comptable STOCK), `ReglesEcritures.cs` (OD de variation stock initial / final ; dotation et reprise de provision),
  `modules/comptabilite/tests/cas/03_ecritures.json` (cas ajoutés), page `/parametres/comptabilite` du module si les
  comptes s'y saisissent.
- **Règles répliquées** : écritures calculées par le serveur seul (C#, comme le lot 3 du module) ; jeu étendu.
- **Ventilation** : un compte par nature d'article (clés de ventilation du type STOCK, décision du 06/11/2026).
- **Point OUVERT** : comptes par défaut (603x / 31x–37x, 6817 / 7817 / 39x).
- **Critère de fin** : `dotnet test LogiBTP.slnx` vert avec les nouveaux cas.
- **FAIT le 07/11/2026** (non commité ; C# non compilé). Écarts : règle `ReglesStockCompta.Cloturer` (nouveau fichier) et jeu à part
  `04_stock_compta.json` (12 cas, test `ReglesStockComptaTests`) ; `db/094f` (dotation et reprise sur le type comptable, saisis dans
  Paramètres › Comptabilité, route et DTO `types-comptables` étendus) ; cœur `db/276` : types `STOCK_VARIATION` et `STOCK_PROVISION`
  créés sans compte, comptes par nature en clés de ventilation (page existante). **Point ouvert tranché par le paramétrage** : aucun
  compte par défaut imposé, une nature sans compte est écartée et signalée ; à titre indicatif 603x (variation), 39x (provision),
  6817 (dotation), 7817 (reprise). L'opération n'est pas encore produite de bout en bout (pièce, export, calcul des valeurs initiale
  et finale) : c'est le lot 10.

## Lot 10 : clôture du stock, variation de fin d'exercice

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `db/275_stock_cloture.sql` (clôture datée : stock de début et de fin par compte, lien vers la pièce),
  `Btp/ClotureStockBtp.cs` (pièce de variation exportée en OD comme `InventaireComptableBtp`, annulable),
  `Btp/ComptabiliteExportBtp.cs`, page de clôture (dans `/stock/etat-valorise` ou `/comptabilite/export`), droits,
  textes.
- **Critère de fin** : une clôture produit une OD équilibrée égale à la différence entre deux états valorisés ;
  annulée, la pièce disparaît de l'export ; `dotnet test LogiBTP.slnx` vert.
- **FAIT le 07/11/2026** (non commité ; C# jamais compilé ni exécuté, y compris cette chaîne de bout en bout). Écarts : script
  `db/277_stock_cloture.sql` (275 et 276 pris ; `stk_cloture` + `stk_cloture_nature`, colonnes de provision prêtes pour le lot 11) ;
  `Btp/ClotureStockBtp.cs` (aperçu, création, liste, annulation sous `/api/stock/clotures`, droit de paramétrage donc administrateur) ;
  `InventaireComptableBtp.PieceEcartsAsync` rendue `internal`, lieu facultatif ; pièce S_INVENTAIRE à une ligne par article (± 1 × variation
  de sa valeur) ; `ComptabiliteExportBtp` : une pièce de clôture est écrite par nature avec `ReglesStockCompta` (comptes des clés de
  ventilation des types STOCK, STOCK_VARIATION, STOCK_PROVISION), compte manquant = pièce en erreur ; page `/stock/clotures` (menu Stock).
  Départ par défaut = clôture précédente active, sinon stock initial nul. Annulation refusée (`CLOTURE_TRANSFEREE`) si la pièce est déjà
  transférée : pas de contre-passation. Le critère « OD égale à la différence entre deux états valorisés » n'a pas de test automatisé.

## Lot 11 : clôture du stock, provision pour dépréciation (FAIT, 07/11/2026)

- **Module** : cœur. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `Btp/ClotureStockBtp.cs` (provision = valeur à la méthode − valeur d'inventaire saisie, S30 ; reprise
  de la provision de la clôture précédente), page de clôture, textes, `TODO.md` (item Clôture fait).
- **Critère de fin** : une valeur d'inventaire inférieure au PMP produit la dotation, la clôture suivante la reprend ;
  `dotnet test LogiBTP.slnx` vert.
- **FAIT le 07/11/2026** (non commité ; C# jamais compilé ni exécuté). Écarts : provision par article = valeur à la méthode −
  valeur d'inventaire (S30) quand celle-ci est inférieure, cumulée par nature ; provision de départ = `cln_provision_finale`
  de la clôture active datée du départ (reprise), nature reprise même si absente de l'état ; clôture sans variation de
  valeur mais avec provision acceptée (lignes à zéro) ; colonnes de provision de l'aperçu et de la page ; la pièce créée est
  supprimée si sa création échoue. Aucun test automatique de la chaîne (règle `ReglesStockCompta` testée au lot 9).

## Points ouverts

- Lot 2 : numéro du script SQL du module SAV (prochain libre du manifeste).
- Lot 9 : comptes par défaut de la variation et de la provision.
