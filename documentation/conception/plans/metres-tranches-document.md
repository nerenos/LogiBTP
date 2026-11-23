# Métrés de tranche et métré du document : plan par lots

> Questions et décisions du 23/11/2026 : [metres-tranches-document-questions.md](metres-tranches-document-questions.md)
> (toutes répondues).
> Ordre : module Métré, module Document, cœur (moteurs BTP, interface, éditions), puis reprise. Un commit par lot,
> lots enchaînés, une PR.
> Tout nouveau script SQL : mineure `<majeur>.<mineur>_<nom>.sql` du dossier `db` de son module, puis `npm run manifeste`.
> Aucun texte, icône ni couleur en dur (module Personnalisation). Toute règle de calcul : JS + C# + jeux de cas, puis
> `npm test`, `npm run exporter-resultats`, `dotnet test LogiBTP.slnx`.

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| 1 | Métré sans ligne : modèle et portée du document | `modules/metre` | — | FAIT (23/11/2026) |
| 2 | Quantité de tranche dans le moteur de document | `modules/document` | — | FAIT (23/11/2026) |
| 3 | Moteurs BTP : métré de tranche et métré du document | cœur | 1, 2 | FAIT (23/11/2026) |
| 4 | Saisie : quantité et métré de tranche, métré du document | cœur (+ `modules/metre/js/ui`) | 3 | FAIT (23/11/2026) |
| 5 | Copies, transformations, ensembles de la bibliothèque | cœur | 3 | FAIT (23/11/2026) |
| 6 | Éditions | cœur | 3 | FAIT (23/11/2026) |
| 7 | Reprise MDE : récapitulatif et tranches | cœur (`src/LogiBTP.Api/Reprise`) | 3 | FAIT (23/11/2026) |
| 8 | Tests e2e et documentation | cœur | 4 à 7 | FAIT (23/11/2026) |

---

## Lot 1 : métré sans ligne, modèle et portée du document (module Métré)

- **Fichiers** : `modules/metre/db/1.x_metre_document.sql` (nouveau), `js/src/script-metre.js`, `js/src/portees.js`,
  `dotnet/LogiBTP.Metres/Domaine.cs`, `Script/ScriptMetre.cs`, `Portees.cs`, `tests/scripts/*.json`,
  `documentation/modules/METRE.md`.
- **Contenu** :
  - `metre.mtr_ent_id BIGINT` (document de l'hôte) ; `mtr_lig_id` devient facultatif ; contrainte : l'un des deux
    renseigné ; index unique « un métré sans ligne par document » (Q10, Q13). FK posées par le cœur (lot 3).
  - Évaluation sans ligne (`ligneId` null) : écriture `@` / `@@` / `$` refusée (`PORTEE`), `$$` permise ; `Renvoyer`
    → avertissement `METRE_DOCUMENT_RESULTAT`, résultat ignoré (Q8). Variables non locales publiées en `$$`.
- **Critère de fin** : `npm test --workspace modules/metre/js`, `dotnet test modules/metre/dotnet/LogiBTP.Metres.Tests`
  (cas : script de document qui écrit `$$`, refus de `$` et `@`, `Renvoyer` averti).

## Lot 2 : quantité de tranche dans le moteur de document (module Document)

- **Fichiers** : `modules/document/js/src/moteur-document.js`, `dotnet/LogiBTP.Documents/Calcul/MoteurDocument.cs`,
  `js/src/types.js` / `TypesLigne.cs`, jeux `modules/document/tests/cas/25_quantite_tranche*.json`.
- **Contenu** :
  - `calculerQuantite` aussi pour les TITRE : `lig_qte` vide = 1 (Q2), quantité totale = quantité × quantité totale du
    titre parent (Q3) ; les lignes d'un titre prennent pour parent multiplicateur le premier ancêtre chiffré **ou titre**.
  - Tranche : PU pour 1 = somme des montants des lignes ÷ quantité, montant = somme (Q1 b) ; SECTION exclue (Q4).
  - Avancement, sous-totaux, hors total : sur les montants multipliés (Q5) ; aucun changement sans quantité saisie.
- **Critère de fin** : jeux de cas JS = C# (tranche × 3, tranches imbriquées 2 × 3, option dans une tranche × 2,
  situation à 50 % d'une tranche × 2) ; tous les jeux existants inchangés.

## Lot 3 : moteurs BTP, métré de tranche et métré du document (cœur)

- **Fichiers** : `client/src/calcul/moteur-btp.js`, `src/LogiBTP.Calcul/MoteurDevisBtp.cs`, `db/100_btp.sql`
  (FK `mtr_ent_id`), `LogiBtpContext.cs`, enregistrement des métrés du document, jeux `tests/cas/25_metre_tranche.json`,
  `26_metre_document.json`.
- **Contenu** :
  - `avantQuantites` : métré du document, puis définitions `$$` de la grille, qui peuvent lire et réécrire ses variables
    (Q11 b, Q12 : résolveur sans ligne, entête).
  - Tranche : script du métré de la tranche **avant** ses lignes (Q6) ; une tranche sans métré garde ses définitions `$`
    de la grille (après le métré, Q7 b : une tranche à métré n'en a plus) ;
    `lig_qte_source` M → quantité de tranche = résultat ; frais annexes F : quantité refusée (`QTE_TRANCHE_FA`) (Q5).
  - `peutAvoirMetre` : lignes chiffrées et TITRE (hors F). Erreurs et avertissements dans `scripts` et les notifications.
- **Critère de fin** : jeux 25 et 26 identiques JS / C# ; jeux 03, 04, 12, 15, 16 inchangés.

## Lot 4 : saisie (cœur, panneau du module Métré)

- **Fichiers** : `client/src/app/editeur-btp.js`, `pages/document.js`, `modules/metre/js/ui/panneau-metre.js`,
  colonnes de la grille (`modules/document/js/ui/editeur-document.js`), textes `document_btp.*` et `metre.*`.
- **Contenu** : colonne Qté éditable sur les tranches (affichée quand ≠ 1 ou saisie) ; F4 sur une tranche crée son
  métré : les définitions `$` de la tranche sont converties dans le script (déclarations et affectations dans leur
  ordre, `+=` gardés) puis retirées de la grille, en une seule étape d'annulation (Q7 b), script terminé par
  `Renvoyer 1` ; bouton
  « Métré du document » de la barre d'outils et raccourci depuis la grille `$$` de la section (Q9) ; panneau en mode
  document (éditeur + grille des `$$`) ; plan des tranches : quantité affichée.
- **Critère de fin** : `npm test --workspace client`, `npm test --workspace modules/metre/js` (conversion : variables
  numériques, chaînes, `+=`, formules citant d'autres variables ; même résultat de calcul avant et après) ; annulation
  d'une étape pour chaque création ou modification.

## Lot 5 : copies, transformations, ensembles (cœur)

- **Contenu** : le métré du document et les métrés de tranche suivent la copie, la transformation, la version et le
  modèle de document (Q14) ; ensemble de la bibliothèque : métré de la tranche racine stocké dans la composition et
  quantité d'appel posée sur la tranche ; « Actualiser depuis la bibliothèque » inchangé pour les prix.
- **Critère de fin** : tests serveur de transformation devis → commande → facture avec métré du document et tranche × 2.

## Lot 6 : éditions (cœur)

- **Contenu** : quantité et PU de tranche dans le modèle de données des éditions (imprimés quand Qté ≠ 1), variables
  `$$` au catalogue (Q15 a). Le détail des métrés imprimé reste hors plan (Q15 b).
- **Critère de fin** : jeu d'édition d'un devis avec tranche × 3 (totaux égaux au moteur).

## Lot 7 : reprise MDE (cœur)

- **Fichiers** : `src/LogiBTP.Api/Reprise/MetresMde.cs`, `PiecesReprise.cs`, `tests/reprise/mde/donnees.sql`,
  `tests/LogiBTP.Calcul.Tests/RepriseBaseTests.cs`, `documentation/modules/IMPORT.md`.
- **Contenu** : récapitulatif R et `GLOBALE` → métré du document (Q16 b) ; tranches T : `CLEMETRE` → métré de tranche,
  quantité ≠ 1 → quantité de tranche (Q17 : lancer d'abord la requête de la question sur la base réelle) ; contrôle des totaux par pièce inchangé.
- **Critère de fin** : test de reprise : pièce avec récapitulatif → un métré du document, tranche × 2 → total HT
  égal à la source.

## Lot 8 : tests e2e et documentation

- **Contenu** : scénario e2e (métré du document `$$hsp`, tranche « Étage » × 3 par métré, lignes qui lisent `$$hsp`) ;
  `documentation/modules/METRE.md`, `DOCUMENT.md`, `CLAUDE.md` des modules concernés, `JOURNAL-LOTS.md`.
