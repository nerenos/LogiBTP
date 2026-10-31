# Révision et actualisation des prix des marchés par index BT – analyse fonctionnelle

> Document de travail (31/10/2026, lot G) : décisions du 31/10/2026 renseignées, lot G1 réalisé (voir § 10). Même principe que
> `CONCEPTION-MARCHES-REGLEMENTS.md` : pour chaque question, la **Proposition** est celle de l'analyse, renseigner
> **Décision**. Récapitulatif au § 9.

## 0. Demande (reprise du TODO)

« Révision de prix par index BT (formule, index provisoires puis définitifs) : à concevoir avant de coder. »

## 1. Rappel du métier

- **Prix ferme** : le prix ne bouge pas, sauf l'**actualisation** quand les travaux commencent plus de trois mois après
  le mois d'établissement des prix (mois zéro, M0) : coefficient unique Ca = I(d − 3) / I0, où d est le mois de début
  des travaux. Une seule fois, appliqué à tout le marché.
- **Prix révisable** : chaque période facturée est révisée par une formule paramétrique, en général
  Cn = a + b × In / I0 (une partie fixe a, souvent 0,125 ou 0,15, et b = 1 − a), ou à plusieurs index :
  Cn = a + Σ bi × In,i / I0,i (Σ bi = 1 − a). In = index du mois n (mois d'exécution de la période, ou mois n − k selon le
  contrat), I0 = index du mois zéro.
- **Montant de révision** d'une période = montant HT de la période × (Cn − 1). Il est soumis à la TVA du marché.
- **Index BT** (BT01 tous corps d'état, BT02 à BT53 par corps d'état) publiés chaque mois par l'INSEE, avec environ trois
  mois de décalage ; ils sont publiés **provisoires** puis deviennent **définitifs** quelques mois plus tard. Une
  facture émise avant la publication de In se révise avec le dernier index connu (révision provisoire) ; l'écart est
  régularisé quand l'index définitif est publié.
- **Changement de base** des séries (base 2010 depuis 2014) : un coefficient de raccordement relie l'ancienne série
  à la nouvelle.
- Arrondi du coefficient : fixé par le contrat (en pratique au millième, parfois au millième supérieur).

## 2. Existant

- Marchés (`marche`, `db/170`) : commande de base et avenants (`marche_document`), montant calculé, postes de pied
  (`marche_poste`, `db/173`) : portée G (pied global, après TVA seulement : `PIED_GLOBAL`) ou C (modèle de pied des
  commandes). Lignes système repérées par `lig_proprietes.poste_marche` (R : retenue de garantie, A<n> : acompte, sinon
  l'identifiant du poste), reprises par l'export comptable (genre par marqueur).
- Avancement : situations (cumul) et factures d'avancement (période = cumul − précédent), une section par commande avec
  son pied, numéro de situation, indices de révision d'une situation, annulation par avoir en cascade.
- Lot E : marchés à facturer **par mois** (une pièce d'avancement par marché et par mois, `MoisFacturation`) ; le mois
  d'une pièce est donc connu.
- Aucun index, aucune formule, aucun type de prix sur le marché.

## 3. Paramétrage du marché

### Q1. Type de prix

**Proposition** : `mar_type_prix` FERME (défaut) / ACTUALISABLE / REVISABLE ; mois zéro `mar_mois_zero` (mois
d'établissement des prix, défaut : mois de la date du marché) ; pour ACTUALISABLE, mois de début des travaux (défaut :
date de début réelle du chantier, `db/236`, sinon prévue).

**Décision** : Proposition retenue (paramètres dans `marche_revision`).

### Q2. Formule

**Proposition** : formule par marché : partie fixe a et termes (index, poids bi) dans `marche_revision_terme`
(contrôle : a + Σ bi = 1) ; décalage k en mois (In = index du mois n − k, défaut 0) ; précision et mode d'arrondi du
coefficient (défaut 3 décimales, au plus proche ; option « supérieur ») ; modèles de formules réutilisables
(`/parametres/revision` : « BT01 – 0,15 », « Gros œuvre BT01 50 % + BT06 35 % »…) recopiés dans le marché.

**Décision** : Proposition retenue (termes en JSONB de `marche_revision`, modèles `formule_revision`).

### Q3. Avenants et TS

**Proposition** : une commande ajoutée au marché hérite du mois zéro et de la formule du marché ; un mois zéro propre
peut être saisi sur la commande (prix nouveaux établis plus tard), la formule restant celle du marché.

**Décision** : Proposition retenue (`marche_document.mdo_mois_zero`).

### Q4. Marchés de sous-traitance (sens ST)

**Proposition** : mêmes paramètres (souvent la formule du marché de vente lié, proposée par défaut) ; calcul sur les
factures d'avancement de sous-traitance. À faire dans un second temps (lot G2) ?

**Décision** : Proposition retenue : lot G3.

## 4. Index

### Q5. Référentiel des index

**Proposition** : `index_prix` (code BT01…, libellé, identifiant de série INSEE, base, coefficient de raccordement vers
la base suivante) et `index_valeur` (index, mois, valeur, état PROVISOIRE / DEFINITIF, publié le, source SAISIE /
IMPORT / INSEE) ; historique des corrections (une valeur provisoire remplacée par la définitive reste tracée). Catalogue
des BT livré (codes et libellés), valeurs vides. Page `/parametres/index` : grille mois × index, saisie et import CSV.

**Décision** : Proposition retenue ; page `/parametres/revision`.

### Q6. Récupération automatique

**Proposition** : relève mensuelle par le planificateur de fond, depuis le service de séries de l'INSEE (BDM, SDMX,
sans clé), pour les index utilisés par au moins un marché ; une valeur relevée marquée provisoire tant que l'INSEE
la publie comme telle ; notification « index publiés » aux personnes du service Facturation. Faut-il ce lot dès le
début, ou la saisie et l'import CSV suffisent-ils pour commencer ?

**Décision** : Pas de relève automatique de l'INSEE : saisie et import CSV seulement.

### Q7. Index non publié

**Proposition** : In manquant → dernier index connu de la série (révision **provisoire**, signalée sur la pièce) ;
aucun index connu depuis I0 → pas de révision sur la pièce (avertissement), elle sera rattrapée par la suivante.

**Décision** : Proposition retenue.

## 5. Calcul et facturation

### Q8. Période révisée

**Proposition** : la révision porte sur le montant HT de la **période** de chaque pièce d'avancement (cumul − précédent,
par commande / section), hors postes de pied ; mois n = mois de la pièce (lot E), modifiable sur la pièce (travaux
d'un autre mois). Les situations (non comptables) affichent la révision pour information ; seules les factures
d'avancement la facturent.

**Décision** : Proposition retenue (`document.ent_mois_revision`) ; situations : pas de révision affichée au lot G1.

### Q9. Régularisation (provisoire → définitif)

**Proposition** : révision **cumulée**, comme l'avancement : à chaque facture, révision due sur toutes les périodes
facturées avec les meilleurs index connus à ce jour, moins la révision déjà facturée ; une période révisée
provisoirement est donc régularisée d'office sur la facture suivante dès que l'index définitif est connu. Détail par
période figé à la validation (`document_revision` : mois, montant de la période, I0, In, état de l'index, Cn,
révision) ; la dernière facture (décompte) régularise tout ce qui est connu.

**Décision** : Proposition retenue, avec une option : facture simple de la régularisation (bouton de l'onglet Révision du marché).

### Q10. Ligne de révision sur la pièce

**Proposition** : poste de pied HT système « Révision de prix » dans le pied de **chaque section** (commande), marqueur
`poste_marche` = V, montant calculé par le serveur à la création et à la validation (non saisissable, recalcul par ⟳) ;
il porte la TVA de la section et passe dans l'export comptable (genre « révision », compte paramétrable par le type
comptable comme les autres postes). Le pied global n'est pas touché (`PIED_GLOBAL` respecté).

**Décision** : Proposition retenue.

### Q11. Actualisation (prix ferme actualisable)

**Proposition** : coefficient unique Ca calculé une fois connus I(d − 3) et I0, appliqué comme une révision (même poste V)
à chaque période facturée ; Ca ≤ 1 → pas d'actualisation (selon le contrat : option « à la baisse aussi »).

**Décision** : Proposition retenue (option `mre_baisse`).

### Q12. Avoirs, annulations, retenue et acomptes

**Proposition** : une facture annulée par avoir annule sa révision (l'avoir reprend la pièce, poste V compris) ; la
révision entre dans la base de la retenue de garantie (cumul TTC) ; les acomptes ne sont pas révisés.

**Décision** : Proposition retenue.

## 6. Écrans

- Fiche marché, onglet Marché : groupe « Prix » (type de prix, mois zéro, formule, décalage, arrondi) ; onglet Gestion :
  tableau de révision par période (mois, montant, index, coefficient, provisoire / définitif, facturé, à régulariser).
- Pièce d'avancement : poste « Révision de prix » dans chaque pied de section, détail dans l'onglet Analyse ou le
  détail de la ligne (périodes, index, coefficients), pastille « provisoire ».
- `/parametres/index` (valeurs) et `/parametres/revision` (modèles de formules).
- Éditions : bloc « Révision » du dictionnaire (périodes, index, coefficients) pour la facture et le décompte.

## 7. Réalisation (prévisionnelle)

- Règle répliquée JS ↔ C# (coefficient, arrondi, index de repli, raccordement de base, révision cumulée et
  régularisation) : `client/src/app/structure/revision.js` ↔ `src/LogiBTP.Domaine/ReglesRevision.cs`, jeu
  `tests/revision/01_revision.json`.
- Script `db/250` (index, valeurs, formule du marché, `document_revision`, poste V) ; `Btp/RevisionPrix.cs` (calcul à la
  création et à la validation, route de recalcul) ; écrans ci-dessus.
- Lots : G1 révision et actualisation des marchés de vente, saisie et import des index ; G2 relève INSEE et
  notifications ; G3 marchés de sous-traitance.

## 8. Hors périmètre

Clause de sauvegarde ou butoir, révision des prix unitaires de la bibliothèque, révision des devis hors marché.

## 9. Décisions à valider (récapitulatif)

1. **Q1** – Types de prix FERME / ACTUALISABLE / REVISABLE, mois zéro.
2. **Q2** – Formule à plusieurs index, décalage, arrondi, modèles.
3. **Q3** – Avenants : héritent, mois zéro propre possible.
4. **Q4** – Sous-traitance en second temps.
5. **Q5** – Référentiel des index, valeurs provisoires / définitives tracées.
6. **Q6** – Relève INSEE automatique : tout de suite ou plus tard.
7. **Q7** – Index manquant : dernier connu, sinon rattrapage.
8. **Q8** – Révision de la période, mois de la pièce ; situations pour information.
9. **Q9** – Révision cumulée, régularisation d'office.
10. **Q10** – Poste HT V dans le pied de chaque section.
11. **Q11** – Actualisation par le même mécanisme.
12. **Q12** – Avoirs, retenue, acomptes.

## 10. Réalisation du lot G1

- Règle : `client/src/app/structure/revision.js` ↔ `src/LogiBTP.Domaine/ReglesRevision.cs`, jeu `tests/revision/01_revision.json`.
- Base : `db/250_revision_prix.sql` (index, raccordements, valeurs et historique, modèles, `marche_revision`, mois zéro des
  commandes, mois des travaux d'une pièce, `document_revision`).
- Serveur : `src/LogiBTP.Api/Btp/RevisionPrix.cs`. Pièce d'avancement (factures et avoirs, présentation P) : poste HT
  `V<commande>` en mode C (coefficient de la période sur le total HT de la section, calculé en direct par le moteur ;
  absent si le coefficient vaut 1 ou s'il manque un index) et `VR<commande>` (régularisation des périodes précédentes, en
  montant), posés à la création depuis le marché et à la validation, avant la TVA du pied de la section (deux sections
  ou plus) ou de la racine ; détail figé à la validation. Facture simple de régularisation : lignes d'élément `VR<commande>`
  au taux de TVA principal de la commande, recalculées à la validation. Routes `/api/structure/marches/{id}/revision`
  (+ `/facture`), `/api/structure/revision/index|valeurs|formules`.
- Écrans : onglet Révision de la fiche marché (vente), page `/parametres/revision` (menu Affaires).
- G3 (sous-traitance) : le calcul s'applique tel quel aux factures et avoirs d'avancement de sous-traitance (présentation P,
  commandes T inscrites au marché) ; onglet Révision du marché de sous-traitance, formule du marché de vente lié proposée
  tant que le marché n'a pas ses propres paramètres ; pas de facture simple (la régularisation passe sur la facture suivante).
- Éditions : bloc `revision` du dictionnaire (type de prix, formule, périodes du détail figé, total), guide § 10.5.
- Reste : révision affichée sur les situations (information) ; bloc à placer dans les modèles de facture si souhaité.
