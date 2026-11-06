# Module Document – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes, mécanique de l'avancement, des pieds, des sources multiples, de la numérotation et des textes) : [DOCUMENT.md](../../documentation/modules/DOCUMENT.md).
- Décisions et alternatives écartées : [CONCEPTION-REGLES-DOCUMENTS.md](../../documentation/conception/CONCEPTION-REGLES-DOCUMENTS.md) (P1 à P25, Q1 à Q7 ; règles globales, par famille et par type), [CONCEPTION-ACHATS-MARCHES.md](../../documentation/conception/CONCEPTION-ACHATS-MARCHES.md) (Q1 à Q32, § 13), [CONCEPTION-MARCHES-REGLEMENTS.md](../../documentation/conception/CONCEPTION-MARCHES-REGLEMENTS.md) (Q1 à Q22, § 11).

## Rôle et dépendances
- Document commercial générique (sans métier BTP) : entête, arbre de lignes, pied en tranches, TVA par catégorie, numérotation, statuts, indices, copies, transformations, verrou, historique, traçabilité, affichage de la saisie. Classes mères (méthode patron) spécialisées par le cœur ; moteur de calcul répliqué JS / C#.
- Cycle : BROUILLON → (APPROUVE facultatif) → ENVOYE (validé par l'entreprise, numéroté, verrouillé) → VALIDE (validé par le tiers) ; indices A, B… d'un même groupe (un seul de référence) ; copie = nouveau document, indice A, lien COPIE.
- Dépend du socle seul (JS `@logibtp/socle`, C# `LogiBTP.Socle` / `LogiBTP.Socle.Web`), jamais du cœur. Utilisé par le cœur seul (`MoteurDevisBtp`, `EditeurDevisBtp`, `PanneauxBtp`, `SpecialisationBtp`…) ; aucun autre module n'importe Document, Métré est indépendant.

## Cycle de vie, statuts, droits
- Validation entreprise (ENVOYE, ou APPROUVE si la règle du type l'active) : verrouillage, numérotation, échéancier, soldes, inscription au marché. Validation du tiers (VALIDE) : bouton « validé par le client / fournisseur ». **Pas de statut REJETE** : un rejet est tracé dans l'historique avec son motif, la pièce reste ENVOYE (une facture aussi : plateforme ou tiers).
- Correction après envoi ou validation = nouvel indice ; le précédent devient REMPLACE (terminal, consultation seule, hors facturé et échéances).
- Un seul statut porté, le plus avancé affiché. Statuts automatiques (`f_document_statut`) recalculés après validation d'une pièce aval, solde, avoir ou annulation : FACTURATION prime sur SOLDE ; un devis garde VALIDE sauf facturation directe ; commandes et BL prennent les statuts automatiques ; PAYE_PARTIEL / PAYE viennent du module Règlements.
- Document validé : affichage du **résultat enregistré**, sans recalcul (le moteur ne sert qu'à comparer en débogage).
- Dévalidation (droit DEVALIDER, motif obligatoire) : toute pièce, comptable comprise ; crée toujours l'indice suivant, nouvelle référence, numéro conservé ; retire soldes, inscription au marché, déductions et échéances. Pièce transférée en comptabilité (état T) : reste T, intouchable même forcée.
- Droits par le module Droits s'il est branché (`IDroits`, nœud `documents/{famille}/{code}`), sinon `droit_document` ; APPROUVER, DEVALIDER, FORCER (ADMIN par défaut ; FORCER exige un motif, trace FORCAGE) ; montant de validation contrôlé avant la validation (422 `MONTANT_VALIDATION`).
- Pièces comptables (`tyd_comptable`) : factures, avoirs, factures d'avancement et d'acompte, inventaire. Échéancier et règlements : ventes et achats. Numérotation continue : ventes seulement ; achats : compteur interne, référence externe = numéro du fournisseur, `ent_date_externe` = date comptable (départ de l'échéancier, jamais dans le futur).
- Stock (famille S) : tiers = notre société, seuils de solde propres. Frais annexes et prorata : ventes seulement.
- Contrôles de gestion : référence externe en double (même type, même tiers) = avertissement ; seuils de base (`-1` = pas de seuil) dans les règles du catalogue ; jamais bloquants sauf les refus de `ControlerRegles`.

## Lignes et transformation
- Aucune ligne de prix sans nature ; un ouvrage sans composante devient à la validation un élément de nature Prestation (`PRE`), PV fixe conservé.
- Colonnes modifiables des lignes teintées, jamais le libellé. Remise : seul `lig_coef_remise` est enregistré (saisie en % convertie).
- Reste à solder = quantité du parent − transformé (brouillons compris) ; solde par case ou seuil par famille ; tout le reliquat reprend toutes les lignes de prix. Tiers figé à la transformation (`TIERS_FIGE`).
- Composantes dans un BL ou une facture : quantités unitaires × quantité du parent, jamais absolues. Options et variantes : chaque unité retenue ou non (`OPTION_NON_TRAITEE`) ; pour mémoire et tranches F reprises.
- Achats : avoir seulement pour une erreur de quantité ; ni correction de quantité ni avenant (nouvelles commandes) ; facture fournisseur : prix modifiables avec avertissement et marqueur.
- Plusieurs sources : une section par document source, tranches par commande pour les BL, un pied de section par source, chantier ventilé par ligne (`lig_cha_id`).
- Devis facturé directement : commande intermédiaire créée et validée (sans marché ni chantier).
- Annulation par avoir en cascade (avoir d'avancement → avoir d'avoir) ; seule la dernière situation est remise en cours ; une pièce sans ses suivantes ne s'annule que si elle est la dernière.
- Suppression refusée pour la source d'une TRANSFORMATION ; un brouillon cible part avec ses liens.

## Marchés, avancement, acomptes
- Commande client : marché obligatoire (sauf devis facturé directement), avenants pour les modifications.
- Situation (S, cumul) et facture d'avancement (F, période = cumul − précédent) ; saisie en %, quantité ou montant cumulés. Dépassement du marché refusé sauf option du marché. Précédent et sommes : toujours par le périmètre des pièces valables (`v_document_valable`, `PerimetreDocuments`), jamais `ent_verrouille` seul.
- Document d'avancement : lignes du parent verrouillées sauf l'avancement, le commentaire, l'étiquette et l'impression ; ajout de texte ou de pied seulement.
- Acomptes (`parametre_document.acomptes`) : trésorerie (sans TVA) ou chiffre d'affaires (facture d'acompte comptable, déduite au prorata de l'avancement par un poste de pied de section système).

## Personnalisation (lot P3b)
- Aucun texte, icône ni couleur en dur dans `js/src` et `js/ui` : `js/personnalisation/` (`document.*` de `fr.json`, icônes `document_*`, couleurs `--document-*`) ; messages des moteurs gardés en littéraux (parité C#), traduits par `erreurs.<CODE>`. Détail : [DOCUMENT.md](../../documentation/modules/DOCUMENT.md).

## Parité JS / C#
- Toute règle de `MoteurDocument` / `Numerotation` / `TL` existe dans les deux langages, avec un cas dans `tests/cas`. Autres paires : `soldes.js` ↔ `Soldes.cs`, `options.js` ↔ `Options.cs`, `echeances.js` ↔ `Echeances.cs`, `TYPE_AVANCEMENT` ↔ `TypesAvancement` (jeux `tests/soldes`, `tests/options`, `tests/echeances`).
- Codes d'erreur des moteurs et des services identiques dans les deux langages (liste dans le détail).

## Pièges
- Ne jamais comparer `lig_tyl_id` numériquement : prédicats `estPied`, `estTranche`, `estTypeNumerote`, `accepteEnfants`. SECTION : racine seulement (`SECTION_RACINE`) ; pied à la racine ou dans une section à la racine (`PIED_RACINE`).
- Familles d'achat (A, T) : `FamillesDocument.EstAchat` / `estFamilleAchat` / `f_famille_achat`, jamais la famille A en dur.
- Lignes virtuelles du pied (`_virtuelle`, `ID_PIED`, identifiants ≤ −10¹²) : affichage seulement, jamais saisissables.
- Enregistrement : l'entête est recopié champ par champ (champs métier dans `CopierEnteteSaisie`) ; identifiants négatifs temporaires → `CorrespondanceLignes`.
- `f_document_statut` : toute nouvelle modification part de `019m`.
- Verrou sans expiration (seul `PeutDeverrouiller` force). `Disposition` cherche dans `racine` (deux pages coexistent pendant une ouverture).
- Colonnes métier : `ALTER TABLE` dans `db/` du cœur, entités C# étendues par héritage (`DocumentBtp`, `DocumentLigneBtp`).

## Tests
- `npm test --workspace modules/document/js`, puis `npm run exporter-resultats --workspace modules/document/js`, puis `dotnet test LogiBTP.slnx` (ou `modules/document/dotnet/LogiBTP.Documents.Tests`).
