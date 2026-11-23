# Métrés de tranche et métré du document : questions ouvertes avant le plan par lots

> Demande du 23/11/2026 : « dans les documents, on peut activer des métrés sur les lignes de type tranche, et il faut un
> métré global au document comme sur MDE ». Décision déjà prise (23/11/2026) : le métré d'une tranche calcule des
> variables **et une quantité** de tranche qui multiplie ses lignes.
> Plan : [metres-tranches-document.md](metres-tranches-document.md).
> 18 questions, dont 9 bloquantes (B). Toutes répondues le 23/11/2026.

## Constat (code au 23/11/2026)

- Un métré (`metre`, module Métré) est attaché à **une ligne** (`mtr_lig_id NOT NULL`) et ne s'ouvre que sur une ligne
  chiffrée : `EditeurBtp.peutAvoirMetre` = `estChiffree(l)` (ouvrage, élément). F4 sur une tranche → message
  `document_btp.editeur.metre_chiffrees`.
- Les variables de tranche (`$`) et du document (`$$`) existent déjà, mais seulement en **définitions** saisies en grille
  (`variable_definition`, `var_lig_id` = tranche, ou null = document ; panneau métré d'une SECTION = grille des `$$`).
  Les `$$` sont évaluées en premier (`avantQuantites`), les `$` de tranche après la ligne de tranche (`apresLigne`).
- Une tranche n'a **aucune quantité** : `calculerQuantite` (`moteur-document.js` et son jumeau C#) ne traite que les
  lignes chiffrées et ne multiplie la quantité totale que par un parent chiffré (ouvrage → composantes).
- Reprise MDE (`MetresMde.cs`) : le métré de la ligne **récapitulative** (TYPELIG R, non reprise) et les variables
  `GLOBALE` deviennent des **définitions** `$$NOM` ; un `CLEMETRE` porté par une tranche (T) n'est pas exploité.

## A. Quantité de tranche

| N° | Question | Options | Recommandation | Décision |
|---|---|---|---|---|
| Q1 (B) | Que signifie la quantité d'une tranche ? | (a) multiplicateur : les quantités totales des lignes de la tranche sont multipliées (comme un ouvrage pour ses composantes « R »), montant de la tranche = somme de ses lignes ; (b) a + la tranche s'affiche comme une ligne de prix : contenu pour **1** unité, PU de tranche = total pour 1, Qté, Montant = PU × Qté | **(b)** : c'est la lecture MDE (« tranche × 3 étages ») et elle se voit dans la grille et à l'édition ; le calcul est celui de (a) | ✔ (b) (23/11/2026) |
| Q2 (B) | Une tranche sans métré a-t-elle une quantité ? | (a) non, seul un métré la donne ; (b) oui, colonne Qté saisissable sur la tranche, vide = 1 | **(b)** : même règle que les lignes (saisie ou métré, `lig_qte_source` S / M) ; vide = 1, donc aucun document existant ne change | ✔ (b) (23/11/2026) |
| Q3 | Tranches imbriquées ? | (a) quantités cumulées (sous-tranche × tranche) ; (b) seule la tranche la plus proche compte | **(a)** : cohérent avec ouvrages imbriqués | ✔ (a) (23/11/2026) |
| Q4 (B) | Quelles lignes de tranche peuvent avoir une quantité ? | (a) TITRE seul ; (b) a + SECTION | **(a)** : la SECTION porte déjà les variables du document et ses pieds ; une quantité de section changerait la TVA et les pieds | ✔ (a) (23/11/2026) |
| Q5 (B) | Cas particuliers | Tranche de frais annexes (`lig_type_prix` F), ensemble de la bibliothèque (tranche racine), avancement (% saisi sur une tranche), lignes hors total / options / variantes, sous-totaux | Frais annexes : quantité interdite (avertissement, quantité 1) ; ensemble : sa tranche racine reçoit la quantité d'appel ; avancement : sur les quantités totales des lignes, inchangé ; options et variantes : multipliées comme les autres ; sous-total : somme des montants déjà multipliés | ✔ recommandation (23/11/2026) |
| Q6 | Ordre d'évaluation | Le métré de tranche est évalué **avant** les lignes de la tranche (il donne `$` et la quantité qu'elles lisent) : il ne peut donc pas lire les quantités ni les montants de ses lignes | Accepter cette limite ; pour un récapitulatif sur les lignes, passer par le métré du document ou une variable `+=` | ✔ recommandation (23/11/2026) |
| Q7 | Variables `$` déjà saisies en grille sur une tranche | (a) gardées, évaluées **avant** le métré de la tranche (qui peut les lire et les réécrire) ; (b) converties dans le script du métré à sa création | **(a)** + proposer (b) à la création du métré (bouton « Reprendre les variables »), sans conversion forcée | ✔ (b) : variables `$` de la tranche converties dans le script à la création du métré (23/11/2026) |

## B. Métré du document

| N° | Question | Options | Recommandation | Décision |
|---|---|---|---|---|
| Q8 (B) | Que produit le métré du document ? | (a) des variables `$$` seulement (aucune quantité) ; (b) a + un résultat affiché (total récapitulatif) | **(a)** : `Renvoyer` y est refusé (avertissement) ; le métré du document sert aux données communes (hauteur sous plafond, surfaces, nombre de logements…) | ✔ (a) (23/11/2026) |
| Q9 (B) | Où se saisit-il ? | (a) bouton « Métré du document » (barre d'outils de la page document) qui ouvre le panneau métré en mode document ; (b) sur la ligne SECTION (à la place de la grille `$$`) ; (c) a + raccourci depuis la grille `$$` de la section | **(c)** : un document sans section doit y accéder ; le panneau garde la grille des `$$` en dessous de l'éditeur | ✔ (c) (23/11/2026) |
| Q10 | Un seul métré du document, ou plusieurs (un par sujet) ? | (a) un seul ; (b) plusieurs, évalués dans l'ordre | **(a)** : MDE n'a qu'un récapitulatif ; un script se découpe par commentaires et fonctions | ✔ (a) (23/11/2026) |
| Q11 | Ordre avec les définitions `$$` de la grille | (a) définitions puis métré du document (qui peut les lire et les réécrire) ; (b) métré puis définitions | **(a)** : même règle que Q7 | ✔ (b) : métré du document puis définitions `$$` de la grille (23/11/2026) |
| Q12 | Données lisibles par le métré du document | (a) variables `$$` ; (b) a + entête (`ent_*`, zones `x_`), chantier, client | **(b)** par le résolveur existant (sans ligne) ; pas de lecture des lignes (elles ne sont pas encore calculées) | ✔ (b) (23/11/2026) |

## C. Modèle, copies, éditions

| N° | Question | Options | Recommandation | Décision |
|---|---|---|---|---|
| Q13 (B) | Rattachement du métré du document | (a) `metre.mtr_ent_id` + `mtr_lig_id` facultatif (un métré a l'un ou l'autre) ; (b) colonne `document.ent_mtr_id` ; (c) ligne technique cachée | **(a)** : le module Métré reste sans connaissance de l'hôte (FK posées par `db/100_btp.sql`), contrainte « un seul métré sans ligne par document » | ✔ (a) (23/11/2026) |
| Q14 | Copie, transformation, version, modèle de document | Le métré du document et ceux des tranches suivent-ils ? | **Oui partout** comme les métrés de ligne ; ensemble de la bibliothèque : le métré de sa tranche racine est stocké dans la composition | ✔ oui partout (23/11/2026) |
| Q15 | Éditions PDF | (a) quantité et PU de tranche imprimés quand Qté ≠ 1, variables `$$` disponibles au catalogue ; (b) a + édition du détail des métrés (document, tranches, lignes) | **(a)** dans ce plan, (b) en suite si besoin | ✔ (a) (23/11/2026) |

## D. Reprise MDE

| N° | Question | Options | Recommandation | Décision |
|---|---|---|---|---|
| Q16 (B) | Ligne récapitulative R et variables `GLOBALE` | (a) garder des définitions `$$` (actuel) ; (b) un **métré du document** dont le script reprend les affectations du récapitulatif et déclare les globales | **(b)** : c'est l'équivalent direct ; le rapport compare toujours les quantités | ✔ (b) (23/11/2026) |
| Q17 | Tranches MDE (T) avec `CLEMETRE` ou une quantité ≠ 1 | Reprendre en métré de tranche et en quantité de tranche | Oui ; **à vérifier sur une base réelle** : `SELECT TYPELIG, COUNT(*), SUM(CASE WHEN CLEMETRE IS NOT NULL THEN 1 END), SUM(CASE WHEN QTE <> 1 THEN 1 END) FROM PMEDOCDEVCLILIG GROUP BY TYPELIG` (et les autres tables `…LIG`) | ✔ recommandation (requête sur la base réelle avant le lot 7) (23/11/2026) |
| Q18 | OPTIM (`vte_metre`) | Même traitement si un métré y est attaché à une phase ou au document | Hors périmètre sauf si la requête équivalente en trouve | ✔ hors périmètre (23/11/2026) |
