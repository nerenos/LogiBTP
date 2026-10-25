# LogiBTP – analyse du module Comptabilité (base)

> Analyse préalable (25/10/2026) à partir de la note « Module de compta Base ». Le module se fait en deux temps : la
> **base** (ce document : référentiels comptables, ventilation, export des pièces) puis le **complet** (journaux tenus,
> exercices, lettrage, règlements, déclarations…), qui réutilisera la base sans la modifier (méthode patron).
> Liens : [Marchés et règlements](CONCEPTION-MARCHES-REGLEMENTS.md) (11.6, Q13, Q14) ·
> [Sous-traitance](ANALYSE-MODULE-SOUS-TRAITANCE.md) (ST14, ST15 : autoliquidation, paiement direct) ·
> [Règles des documents](CONCEPTION-REGLES-DOCUMENTS.md) (P9, P22 : pièce comptable, état comptable) · TODO.md § Comptabilité.
>
> **État** : questions C1 à C14 tranchées le 25/10/2026 (§ 7) : propositions retenues, complétées pour C2, C3, C4, C12
> et C13 (export Sage en CSV seulement dans la base, FEC reporté au module complet).
>
> **Réalisation** : lot 1 réalisé le 25/10/2026 (`modules/comptabilite` : `comptes.js` ↔ `ReglesComptes.cs`, jeu
> `01_comptes.json`, `094` ; cœur `db/223`, `Btp/ComptabiliteBtp.cs` ; pages `/comptabilite/plan`,
> `/comptabilite/tiers`, `/parametres/comptabilite`, champs de la fiche personne) ; écarts : longueur par défaut des
> comptes généraux 6 (comptes déjà en place) au lieu de 8 ; le plan n'est pas converti quand la longueur change (comptes
> « hors longueur » signalés) ; la mention d'une catégorie est recopiée dans le taux qui n'en a pas (la pièce imprime
> la mention du taux) ; les comptes de tiers saisis dans la fiche personne ne sont pas normalisés (seulement dans la
> page des tiers par compte). Lot 2 réalisé le 25/10/2026 (`ventilation.js` ↔ `ReglesVentilation.cs`, jeu
> `02_ventilation.json`, `094b` ; cœur `db/224` ; page `/comptabilite/ventilation`, types comptables et types de
> documents dans `/parametres/comptabilite` ; grille des documents) ; écarts : clés désignant natures et taux par leur
> code ; un type hérite aussi des clés de son parent avant de prendre son propre compte par défaut (la sous-traitance
> prend les clés « nature » des achats) ; les comptes des natures sont repris une fois puis ne sont plus saisis dans la
> fiche nature (colonnes conservées dans la table du module Bibliothèque).

## 1. Note d'origine (résumé)

- Liste du plan comptable, avec un paramètre qui limite la longueur des comptes.
- Liste des tiers indexée par compte de tiers.
- Un compte collectif par type (client professionnel, client particulier, fournisseur, sous-traitant), surchargeable dans
  la fiche du tiers.
- Rapprochement nature + TVA → compte comptable, pour la ventilation.
- Gestion des TVA et des catégories de TVA, avec les textes d'indication réglementaire.
- Gestion des comptes par type comptable Vente et Achat.
- Fichier d'export CSV ; analyser ce qui manque pour transférer les écritures des documents de vente, d'achat et de
  sous-traitance vers un logiciel comptable.

## 2. Ce qui existe déjà

| Élément | Où | Constat |
|---|---|---|
| Plan de comptes minimal | `db/166` : `compte_comptable` (code, libellé, actif), 13 comptes | Sans écran, sans type ni longueur ; « le module Comptabilité pourra la remplacer » |
| Compte d'une ligne | `document_ligne.lig_cpt_code` (module Document) | Saisi ou vide |
| Compte hérité | `client/src/app/comptes.js` (`compteHeriteParDefaut`, `definirRegleCompte`) | Règle provisoire, **JS seulement** : nature (vente / achat selon la famille), sinon compte du tiers (incorrect : c'est un compte auxiliaire) |
| Natures | `nature_element` (module Bibliothèque) : `nat_compte_vente`, `nat_compte_achat`, `nat_axe_analytique` | Un compte par sens, sans distinction de TVA |
| Comptes des tiers | `per_cli_compte`, `per_fou_compte` (`db/140`) | Saisis à la main, aucun collectif, rien pour le sous-traitant, pas d'unicité |
| Particulier / professionnel | `niveau_personne.niv_morale` (FALSE = particulier) | Suffit pour choisir le collectif client pro / privé |
| Taux de TVA | `taux_tva` (module Document) : code, taux, catégorie `N` normale / `A` autoliquidation / `I` intracom / `E` exonérée, mention | Catégorie figée (CHECK, comportement du calcul), aucun compte de TVA |
| TVA d'une pièce | `document_tva` : base, montant (0 en autoliquidation), annulation (intracom), mention | Source directe des lignes de TVA de l'écriture |
| Pièce comptable | règle `PIECE_COMPTABLE` (`db/178`) ; `ent_etat_compta` A à transférer / T transférée / S sans écriture, posé à la validation | Prêt pour l'export ; les types T (sous-traitance) reprennent les règles de leur modèle d'achat (`db/211`) |
| Familles | V vente, A achat, T sous-traitance (`f_famille_achat`, `estFamilleAchat`) | Le module ne doit jamais tester la famille en dur |
| Échéances | `document_echeance` (module Document) | Date d'échéance des lignes de tiers de l'écriture |
| Postes de pied | retenue de garantie, prorata, remise, paiement direct (`marche_poste`, `POSTE_PIED`) | Ne sont pas tous des produits / charges : voir § 6 |

## 3. Décisions structurantes proposées

### 3.1 Un module, une base réutilisable

- `modules/comptabilite` : JS (règles seules), .NET `LogiBTP.Comptabilite(.Web)`, SQL `modules/comptabilite/db/094`.
  Sans métier BTP : il connaît des comptes, des tiers comptables, des catégories et des taux de TVA, des clés de
  ventilation et des « pièces à exporter » que le cœur lui fournit par `SpecialisationComptabilite` (méthode patron :
  `PiecesAsync`, `TiersAsync`, `NaturesAsync`). Il ne lit ni `document` ni `personne`.
- Le cœur (`db/223_comptabilite.sql`, `Btp/ComptabiliteBtp.cs`, `client/src/app/comptabilite/`) relie : natures,
  tiers, taux de TVA, documents.
- Le module complet (plus tard) ajoutera journaux tenus, exercices, saisie d'écritures, lettrage, en réutilisant les
  mêmes tables et la même règle de ventilation.

### 3.2 Une seule règle de ventilation, répliquée JS ↔ C#

Le compte d'une ligne devient une règle du module, répliquée entre `modules/comptabilite/js/src/ventilation.js` et
`ReglesVentilation.cs` (jeu `tests/cas/01_ventilation.json`), branchée dans le client par `definirRegleCompte` et
utilisée côté serveur par l'export. Ordre de recherche (le plus précis gagne) :

1. compte saisi sur la ligne (`lig_cpt_code`) ;
2. clé de ventilation **nature + TVA** du sens (vente ou achat) ;
3. clé **nature** seule (reprend `nat_compte_vente` / `nat_compte_achat`) ;
4. clé **TVA** seule (ex. ventes en autoliquidation → 704…) ;
5. compte par défaut du **type comptable** (vente, achat, sous-traitance) ;
6. sinon : erreur `COMPTE_INTROUVABLE` (bloque l'export, pas la saisie).

Le compte du tiers n'est plus jamais un compte de produit ou de charge.

### 3.3 Longueur des comptes

Paramètres `longueur_comptes_generaux` (ex. 8) et `longueur_comptes_tiers` (ex. 8 ou libre), et option
`completer_zeros` (C2) : si elle est active, un compte général saisi plus court est complété par des zéros à droite
(704 → 70400000) ; sinon la longueur est un maximum (certains logiciels n'acceptent qu'une longueur maximale). Plus
long : refusé. Règle répliquée (jeu
`02_comptes.json`). Changer la longueur propose de convertir le plan existant (les comptes restent uniques).

## 4. Synthèse fonctionnelle

### 4.1 Plan comptable (`/comptabilite/plan`)

`compte_comptable` étendue (pas remplacée, pour garder les codes en place) : classe (déduite du premier chiffre), type
(`GENERAL`, `COLLECTIF`, `TVA`, `TRESORERIE`), sens d'usage (`VENTE`, `ACHAT`, `LES_DEUX`, `AUCUN`), libellé court
pour l'export, lettrable (pour le module complet), actif. Liste du module Liste (recherche, segments par classe et
type), saisie dans la liste ou fiche courte. Plan de départ : comptes usuels du PCG pour le BTP (classes 4, 6, 7 et
TVA). Les combos de compte ne proposent que les comptes du sens attendu (vente sur une pièce de vente, achat sur une
pièce d'achat ou de sous-traitance).

### 4.2 Collectifs et comptes des tiers

- Collectifs paramétrés par type de tiers : `CLIENT_PRO` (411…), `CLIENT_PRIVE` (411…), `FOURNISSEUR` (401…),
  `SOUS_TRAITANT` (401… ou 404…). Client pro ou privé selon `niv_morale` du niveau de la personne.
- Surcharge dans la fiche du tiers, groupe de chaque relation : `per_cli_collectif`, `per_fou_collectif`,
  `per_st_collectif` (vide = collectif par défaut).
- Compte auxiliaire : `per_cli_compte`, `per_fou_compte` existants ; le sous-traitant prend celui du fournisseur, sauf
  surcharge par `per_st_compte` (C4) ; proposé à la création selon un modèle (préfixe paramétrable par type + code du
  tiers, ex. `C` + `000123`, C3), unique par sens (index), à la longueur des
  comptes de tiers.
- **Liste des tiers par compte** (`/comptabilite/tiers`) : une ligne par (tiers, type) avec compte auxiliaire,
  collectif effectif (et s'il est surchargé), raison sociale, SIRET, TVA intracom, mode et délai de règlement ;
  segments « sans compte », « compte en double » ; action « Générer les comptes manquants ».

### 4.3 TVA et catégories de TVA (`/comptabilite/tva`)

- `categorie_tva` (module) : code, libellé, **comportement** du calcul (N, A, I, E : celui que les moteurs connaissent
  déjà, aucune règle de calcul ne change), **mention réglementaire** par défaut, exigibilité (débits ou encaissements),
  autoliquidée (oui / non). Catégories de départ : taux normal, taux réduit rénovation (10 %, attestation), taux réduit
  énergie (5,5 %), autoliquidation sous-traitance BTP (art. 283-2 nonies), intracommunautaire, export, exonérée,
  hors champ.
- `taux_tva` (module Document) reçoit par le cœur : `ttv_ctv_code` (catégorie), comptes de TVA collectée, collectée à
  encaisser, déductible sur biens et services, déductible autoliquidée et autoliquidée due. Mention du taux = mention
  saisie, sinon celle de la catégorie (`document_tva.tva_mention` figée à la validation comme aujourd'hui).
- Textes : modifiables, avec rappel de l'article du CGI ; repris par les éditions (déjà par `tva_mention`).

### 4.4 Ventilation (`/comptabilite/ventilation`)

Tableau des natures (lignes) × taux de TVA (colonnes) par sens (onglets Vente / Achat / Sous-traitance) : chaque case
est un compte, vide = hérité (affiché atténué avec son origine, comme le compte hérité de la grille aujourd'hui).
Colonne « tous taux » = compte de la nature, ligne « toutes natures » = compte du taux. Table `ventilation_compte`
(sens, `nat_id` nullable, `ttv_id` nullable, compte), unique par (sens, nature, taux). Aperçu : « quel compte pour
nature X, TVA Y ? » avec l'étape de la règle qui a répondu.

### 4.5 Types comptables Vente et Achat

`type_comptable` : `VENTE`, `ACHAT`, `SOUS_TRAITANCE` (C10), rattaché aux types de documents par la famille (V → VENTE,
A → ACHAT, T → SOUS_TRAITANCE, surchargeable par type de document) ; porte le **journal** (code et libellé : VT, HA,
ST), le compte de produit ou de charge par défaut (étape 5 de la règle), les comptes des postes particuliers (remise
de pied, retenue de garantie, acompte déduit, paiement direct, écart d'arrondi) et le collectif utilisé. Retenue de
garantie : compte distinct (4117 / 4017) par défaut, option « compte du tiers » (C12). C'est le
« schéma comptable » de chaque sens, dont le module complet tirera ses journaux.

### 4.6 Export CSV (`/comptabilite/export`)

Lot 3 de la base, volontairement simple (le reste est au § 6) :

- sélection : pièces `ent_etat_compta = 'A'`, par période (date de la pièce, date externe pour les achats) et par
  type comptable ; aperçu des écritures avec contrôles (équilibre, compte introuvable, tiers sans compte) ;
- écriture d'une pièce : une ligne par compte de produit ou charge (HT ventilé, cumulé par compte), une par taux de TVA
  (`document_tva`), une ou plusieurs lignes de tiers (TTC, une par échéance de `document_echeance`) ; avoirs : sens
  inversé ;
- fichier CSV (séparateur, décimale, encodage, colonnes et en-tête paramétrés, colonnes de base : journal, date, n° de
  pièce, compte général, compte auxiliaire, libellé, débit, crédit, échéance, référence, analytique = code chantier) ;
- lot d'export enregistré (`comptabilite_export` : date, auteur, période, pièces, fichier rangé en GED) ; les pièces
  passent à T ; un lot s'annule (pièces remises à A) tant que le comptable ne l'a pas importé ;
- modèle de colonnes « Sage » (import paramétrable de Sage, C13) livré avec la base ; FEC et autres logiciels : module
  complet.

## 5. Liens avec les autres modules

| Module | Lien | Par |
|---|---|---|
| Document | Pièces comptables, lignes, `document_tva`, échéances, `ent_etat_compta` | Cœur (`SpecialisationComptabiliteBtp.PiecesAsync`) |
| Bibliothèque | Natures (`nat_compte_*` deviennent les clés « nature » de la ventilation) | Cœur (`db/223` reprend les comptes) |
| Annuaire | Collectifs, comptes auxiliaires, pro / particulier | Cœur (`db/223`, fiche personne) |
| Règlements | Plus tard (complet) : écritures de règlement, TVA sur encaissements | — |
| Droits | Nœuds `comptabilite/parametres`, `comptabilite/export` | `SpecialisationDroitsBtp` |
| Installation | `094` et `223` au manifeste `db/installation/scripts.txt` | — |

## 6. Ce qui manque pour transférer les écritures (analyse du dernier point)

Classés du plus bloquant au plus confortable. **B** = traité par la base, **C** = module complet, **?** = avis de
l'expert-comptable.

| # | Manque | Pourquoi | Proposition |
|---|---|---|---|
| M1 | Compte effectif côté serveur | La règle n'existe qu'en JS ; l'export doit être calculé par le serveur | B : règle répliquée (§ 3.2) |
| M2 | Comptes de TVA par taux | `taux_tva` n'en a aucun | B : § 4.3 |
| M3 | Collectifs et auxiliaires fiables | Saisie libre, ni unicité ni sous-traitant | B : § 4.2 |
| M4 | Journaux | Aucun code journal | B : par type comptable (§ 4.5) ; journaux tenus : C |
| M5 | Numéro des pièces d'achat | Achats sans numérotation continue ; la pièce du fournisseur est sa référence | B : n° interne de LogiBTP + référence externe (`ent_reference_externe`) et date externe (`ent_date_externe`) en colonnes |
| M6 | Postes de pied qui ne sont pas des produits | Retenue de garantie (créance 4117 / dette 4017 : ne diminue pas le CA), paiement direct (le client paie le sous-traitant : compte de tiers), acompte déduit (4191 avances reçues), remise de pied (709 / 609 ou répartie), prorata (charge ou produit) | B : un compte par type de poste dans le type comptable ; ? pour retenue et paiement direct (ST14, ST15) |
| M7 | Factures d'avancement | La période (cumul − précédent) doit être ventilée ligne à ligne ; la retenue et la déduction d'acompte suivent | B : écriture sur les montants de période déjà calculés ; jeu de cas dédié |
| M8 | Autoliquidation | Sous-traitance reçue : TVA nulle sur la pièce mais à déclarer (déductible 44566 / due 4452) ; ventes en autoliquidation : mention seulement | B : lignes de TVA calculées sur la base de `document_tva` (taux connu, montant nul) |
| M9 | TVA sur les encaissements | Travaux immobiliers = prestations : TVA exigible à l'encaissement sauf option sur les débits ; la vente passe en 44574 puis en 44571 au règlement | B : compte « à encaisser » ; virement au règlement : C (module Règlements) ; ? option débits de la société |
| M10 | Arrondis | Somme des HT ventilés arrondis ≠ total HT de la pièce | B : l'écart va sur la plus forte ligne (comme les moteurs), sinon compte d'écart |
| M11 | Équilibre et contrôles | Une pièce déséquilibrée ne doit jamais partir | B : contrôle bloquant de l'aperçu |
| M12 | Pièces modifiées après transfert | P22 : une pièce transférée dévalidée reste T | B : signalée « modifiée depuis l'export » (empreinte), le comptable corrige ; contre-passation : C |
| M13 | Analytique | Chantier, affaire, nature (`nat_axe_analytique`) | B : colonnes analytiques facultatives |
| M14 | Exercices, périodes clôturées | Ne pas exporter dans une période close | C (en base : simple date de verrouillage) |
| M15 | Formats des logiciels | Chaque logiciel a son import (Sage, Cegid, Quadra, EBP, ACD…) | B : CSV paramétrable, modèle Sage ; FEC et autres logiciels : C |
| M16 | Inventaire, stock | Écriture de variation de stock (TODO Stock) | C |
| M17 | Règlements, lettrage, relances | Encaissements et décaissements | C |
| M18 | Facturation électronique | Les écritures d'achat viendront des factures reçues | Hors module (TODO) |

## 7. Questions et propositions

| # | Question | Proposition | Décision (25/10/2026) |
|---|---|---|---|
| C1 | Module facultatif (activé par société) ou toujours présent ? | Base toujours présente (la ventilation sert à la saisie) ; le complet sera facultatif | Ok
| C2 | Longueur des comptes : complétion par des zéros à droite ? Longueur distincte pour les comptes de tiers ? | Oui aux deux : généraux 8 par défaut, tiers libre (max 17) | Ok mais option pour la completion par zéro car certain logiciel accepte des longueurs max seulement
| C3 | Modèle des comptes auxiliaires créés automatiquement ? | Préfixe par type (`C`, `F`, `S`) + code du tiers sans le `T` ; modifiable | OK et préfixe modifiable en paramétrage
| C4 | Sous-traitant : son propre compte auxiliaire ou celui du fournisseur ? | Le même auxiliaire que le fournisseur (`per_fou_compte`) avec le collectif sous-traitant ; un tiers fournisseur et sous-traitant a donc un seul compte | Ok par défaut mais on peut surchargé pour les sous-traitant
| C5 | Client pro / privé : par le niveau (particulier) seulement ? | Oui (`niv_morale`), surcharge dans la fiche | Ok
| C6 | Les clés de ventilation dépendent-elles aussi du type de document (ex. facture d'acompte → 4191) ? | Non par la ventilation ; par le type comptable (§ 4.5) | Ok
| C7 | `nat_compte_vente` / `nat_compte_achat` : gardés ou repris dans `ventilation_compte` ? | Repris en clés « nature » puis retirés de la fiche nature (un seul endroit) | Ok
| C8 | Sens d'usage des comptes : filtrer les combos ou seulement avertir ? | Filtrer, avec « Tous les comptes » à cocher | Ok
| C9 | Catégories de TVA de départ et textes réglementaires | Liste du § 4.3, textes à faire relire par l'expert-comptable | Ok
| C10 | Sous-traitance : type comptable propre (journal ST) ou dans les achats (HA) ? | Type propre, journal par défaut HA (modifiable) | Ok
| C11 | Exigibilité : TVA sur les encaissements par défaut pour les travaux ? | Oui, paramètre société « TVA sur les débits » pour l'option | Ok
| C12 | Retenue de garantie : compte distinct ou dans le compte client ? | Compte distinct (4117 / 4017), échéance RETENUE | Ok avec surcharge possible pour utiliser le compte du client.
| C13 | Logiciel comptable cible pour le premier modèle d'export ? | CSV générique + FEC ; dites-moi votre logiciel pour un modèle dédié | Sage parton seulement sur CSV pour la base
| C14 | Le compte de la ligne (`lig_cpt_code`) reste-t-il saisissable ? | Oui, il prime sur tout (étape 1) | Oui mais s'il est nulle on utilise les règles par défaut

## 8. Découpage en lots proposé

| Lot | Contenu |
|---|---|
| 1 | Module et paramètres : plan comptable (types, sens, longueur, écran), catégories et taux de TVA (comptes, mentions), collectifs par type, surcharge et comptes auxiliaires des tiers, liste des tiers par compte, droits, manifeste |
| 2 | Ventilation : types comptables (journaux, comptes par défaut et des postes), `ventilation_compte` et écran natures × TVA, règle répliquée JS ↔ C# (jeux), branchement de la grille (`definirRegleCompte`) |
| 3 | Export : écritures calculées par le serveur (M1 à M13), aperçu et contrôles, CSV paramétrable (modèle Sage), lots d'export (GED, annulation), état T |
