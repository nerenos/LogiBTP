# LogiBTP – analyse du module Stock

> Analyse préalable (24/10/2026) à partir de la note « Module Stock ». Socle commun :
> [ANALYSE-MODULES-TRANSVERSE.md](ANALYSE-MODULES-TRANSVERSE.md) (§ Stock : « réservation, colisage, emplacements »).
> Analyses liées : [Exécution](ANALYSE-MODULE-EXECUTION.md) (E14, E21 : demande d'approvisionnement → réservation) ·
> [Pointage](ANALYSE-MODULE-POINTAGE.md) (borne d'atelier) · [Règles des documents](CONCEPTION-REGLES-DOCUMENTS.md)
> (F7, I5, I7, P6, P8) · [Achats et marchés](CONCEPTION-ACHATS-MARCHES.md) (restes, soldes).
>
> **État** : questions S1 à S31 tranchées le 24/10/2026 (§ 8), propositions retenues sauf S4, S22, S29 (complétées)
> et S24 (lots et numéros de série : reportée, analyse à mener pour les certificats matière et le SAV).

## 1. Note d'origine (résumé)

- **Articles stockés** définis dans la bibliothèque ; **marquage** des articles pour en sortir rapidement des listes.
- **Plusieurs dépôts** (créés comme un chantier) et des **emplacements** (zone, rack, étagère…).
- Les **BL** et les **factures sans BL** mouvementent le stock quand ils portent sur un dépôt.
- **Document de transfert** à origine et destination : sans origine = entrée, sans destination = sortie ; transfert
  possible entre deux chantiers sans passer par un dépôt.
- **Inventaires** : bordereaux générés par zone ou type d'article, regroupés en **lots** (même date-heure exigée) ;
  **micro-inventaire** (correction directe d'un article) ; jamais bloquants : le comptage vaut à sa date-heure, les
  mouvements antérieurs n'y changent rien, les postérieurs partent de la quantité comptée ; un article non saisi n'est
  **pas** mis à 0 ; un article saisi plusieurs fois dans un lot est cumulé (avertissement s'il est au même endroit).
- **Réservations**, quantités **mini / maxi**, **propositions de commande** ; les commandes fournisseur viennent en
  déduction des réservations, avec un aperçu à l'instant T **et** dans le temps (rupture entre deux dates : réservation
  de 100 u demain, 25 u en stock, 200 u livrées la semaine prochaine → réservation non honorée demain).
- **Borne d'atelier** : sortie de stock de l'atelier par les transferts.
- **EPI** (non identifiés) et **outillage consommable** (mètre, crayon…) : sorties par salarié avec historique, une
  affaire et **un chantier par salarié** créé à la première sortie ; **retours** ; saisie par le salarié (borne, validée
  par le chef de service ou le magasinier) ou par le magasinier (interface propre) ; **visuel** des dotations par
  salarié sur une période (dates, nombres).

## 2. Ce qui existe déjà

| Besoin | Déjà dans l'application |
|---|---|
| Famille de documents stock | Famille S (`tyd_sens` 3) : `S_DEMANDE` (« Demande de stock »), `S_RESERVATION`, `S_ENTREE`, `S_SORTIE`, `S_TRANSFERT`, `S_INVENTAIRE` (`db/110`) ; `tyd_mouvemente_stock` posé sur BL, retours, ES, SS, TS, BI mais **lu nulle part** (I7) ; `S_INVENTAIRE` est une pièce comptable (`db/178`) ; éditions « pièce interne » (`db/191`) |
| Tiers d'un document de stock | Notre société, posée à la validation (P6) |
| Article stocké | `element.ele_gestion` = `STOCK` (avec ACHAT, SOUS_TRAITANCE, NON_GERE), unité de stock obligatoire `ele_unt_stock`, unités d'achat / de vente et conversions par formule (`ele_unites`), `ele_dernier_pa` et `ele_pmp` prévus « alimentés par les modules Achats et Stock » |
| Fournisseurs de l'article | `tarif_fournisseur` (plusieurs, un principal, unité, prix, période) |
| Réservation en amont | Transformations `E_DAP`, `E_DAC`, `E_BE`, `E_BM` → `S_RESERVATION` (étape RESERVATION), `E_DAP` → `S_DEMANDE` (`db/197`, `208`) |
| Restes et soldes | Restes par ligne (`GET /documents/{id}/restes`), solde à la validation, seuils par famille (`parametre_document`) |
| Chantiers internes | `chantier.cha_interne` (frais généraux, atelier, formation, dépôt ; `db/199`) |
| Dépôt dans l'annuaire | Niveau de personne « dépôt » sous notre société ; adresse de livraison d'achat d'origine `DEPOT` (`AdressesDocument.cs`) |
| Borne d'atelier | Module Pointage lot 4 : appareil enregistré, PIN, salarié → chantier proposé par le planning → saisie ; paramétrage par borne (`/parametres/bornes`) |
| Services | `service.srv_nature` dont `LOGISTIQUE` (`db/193`), responsable de service, membres |
| Colonnes multivaluées | Module Liste : colonnes `ARRAY` (recherche, segments) |
| GED | Famille « Stock » dans l'arborescence des documents du chantier |
| Matériel | Table `materiel` (ressource identifiée du planning, capacité en unités P5) : hors stock |

**Ce qui manque** : le dépôt comme lieu de stock, les emplacements, le **journal des mouvements**, le calcul du stock
à une date-heure avec les inventaires, la valorisation (PMP), les lots d'inventaire, la date de besoin des
réservations et la date de livraison prévue des commandes, la projection de disponibilité, les mini / maxi, les
dotations par salarié, les marques d'articles.

## 3. Décisions structurantes proposées

### 3.1 Un journal des mouvements, un stock calculé

Le stock n'est **jamais saisi** : il se calcule à partir de deux tables.

- `stock_mouvement` : un mouvement par ligne de document qui mouvemente le stock et par lieu touché (un transfert en
  donne deux : sortie de l'origine, entrée de la destination) : article, lieu, emplacement (facultatif), **date-heure**,
  quantité signée en unité de stock, valeur, document et ligne d'origine, salarié (dotations).
- `stock_comptage` : une quantité comptée par article, lieu (et emplacement, S3) et date-heure, issue d'un bordereau
  d'inventaire validé (ou d'un micro-inventaire).

**Règle du stock à une date-heure T** (répliquée entre `modules/stock/js/src/stock.js` et `ReglesStock.cs`, jeu
`01_stock.json`) :

```
dernier comptage C de date-heure ≤ T (pour l'article et le lieu)
stock(T) = C.quantite + Σ mouvements de date-heure ∈ ]C.date, T]
           (sans comptage : Σ mouvements ≤ T)
```

Conséquences, conformes à la note : un inventaire ne bloque rien ; un mouvement saisi après coup mais daté avant le
comptage ne change pas le stock postérieur au comptage (l'écart d'inventaire, lui, change) ; un article non compté
garde son calcul ; un comptage saisi plus tard à une date passée s'applique rétroactivement. L'**écart d'inventaire**
= quantité comptée − stock calculé juste avant le comptage ; il est affiché et valorisé, jamais stocké comme mouvement
(il se recalcule si un mouvement antidaté arrive).

### 3.2 Lieu de stock = chantier

Un **dépôt** est un chantier (la note : « création comme un chantier »), marqué dépôt de stock, dans une affaire de
gestion « Stock » ; il porte ses emplacements, ses mini / maxi, ses inventaires. Tout document se rattache déjà à un
chantier : le lieu d'un mouvement se déduit du rattachement (S1, S2, S12). Le transfert entre deux chantiers fonctionne
alors naturellement ; les dotations des salariés aussi (un chantier par salarié, § 5.6).

### 3.3 Le module et le cœur

| Module `modules/stock` (sans métier BTP) | Cœur |
|---|---|
| Schéma : lieux (identifiant fourni par le cœur), emplacements, mouvements, comptages, lots et bordereaux, mini / maxi, marques ; règles répliquées (stock à date, PMP, projection, propositions, contrôles d'inventaire) et jeux de cas ; composants d'interface (fiche de stock d'un article, grille de comptage, frise de projection) | Lieux = chantiers (`SpecialisationStockBtp`), mouvements issus des documents (BL, réceptions, factures, transferts), dotations des salariés (affaire et chantiers), borne, droits (magasinier, chef de service), pages |

Le module Stock s'appuie sur le module Document (lignes, restes) et la bibliothèque (article, unités) comme le module
Sous-traitance ; il ne dépend pas du cœur. Activation par société (`module_societe` : `stock`) ; désactivé : aucun
mouvement, pages masquées.

## 4. Documents

| Type | Rôle dans le module | Mouvement |
|---|---|---|
| `A_RECEPTION` (réception fournisseur) | Livraison d'un fournisseur sur un dépôt | Entrée au PA de la ligne (PMP recalculé) |
| `A_FACTURE` sans réception | Facture directe d'articles livrés sur un dépôt | Entrée (seulement les lignes non issues d'une réception, S11) |
| `A_RETOUR` | Retour au fournisseur depuis un dépôt | Sortie |
| `V_RECEPTION` (bon de livraison client) | Livraison au client depuis un dépôt | Sortie |
| `V_RETOUR` | Retour client vers un dépôt | Entrée |
| `S_TRANSFERT` (**le** document de transfert) | Origine et destination dans l'entête (S9) : sans origine = entrée, sans destination = sortie, deux chantiers = transfert direct | Une sortie et / ou une entrée |
| `S_ENTREE`, `S_SORTIE` | Raccourcis du transfert (destination seule, origine seule) ou retirés (S9) | idem |
| `S_RESERVATION` | Réservation d'articles d'un dépôt pour un chantier, **date de besoin** par ligne ; consommée par le transfert issu de la réservation (reste), libérée au solde ou à l'annulation | Aucun |
| `S_DEMANDE` | Demande de stock (depuis la DAP), transformée en réservation ou en transfert | Aucun |
| `S_INVENTAIRE` | Bordereau d'inventaire (§ 5.3) | Comptage (pas de mouvement) |
| `A_COMMANDE` | **Date de livraison prévue** (entête, modifiable par ligne) et reste à recevoir : entrées attendues de la projection | Aucun |

Le mouvement naît à la **validation** du document et disparaît à son annulation (avoir, annulation) ; sa date-heure
est la date de mouvement du document (`ent_date_mouvement`, par défaut l'instant de la validation, modifiable : S10).
Seules les lignes d'un article géré en stock (`ele_gestion = 'STOCK'`) mouvementent ; la quantité est convertie dans
l'unité de stock par les conversions de l'article.

## 5. Synthèse fonctionnelle

### 5.1 Articles et marques

- Article stocké = élément `ele_gestion = 'STOCK'` ; onglet **Stock** de la fiche élément : stock par lieu à
  maintenant, réservé, attendu, disponible, mini / maxi, emplacements habituels, derniers mouvements, PMP.
- **Marques** paramétrables (code, libellé, couleur ; ex. EPI, Outillage consommable, Visserie, Zone A tournante),
  plusieurs par article (colonne multivaluée de l'élément) : filtres des listes de la bibliothèque et du stock, choix
  rapide à la borne et au magasin, génération des bordereaux d'inventaire (S20).

### 5.2 Dépôts et emplacements

- Dépôt = chantier marqué dépôt (fiche chantier, liste « Dépôts ») ; emplacements en arbre libre (zone › rack ›
  étagère › case…, code composé `A-03-2`), propres à chaque dépôt.
- Emplacement habituel d'un article dans un dépôt (un ou plusieurs) : proposé dans les mouvements et les bordereaux.

### 5.3 Inventaires

- **Bordereau** (`S_INVENTAIRE`) : un dépôt, une date-heure de comptage, des lignes article / emplacement / quantité
  comptée ; généré par zone (emplacements), par famille, nature ou marque, ou vide (saisie libre) ; édition papier du
  bordereau (sans les quantités théoriques, au choix).
- **Lot d'inventaire** : regroupe des bordereaux d'un même dépôt et d'une **même date-heure** (imposée par le lot) ;
  un article présent dans plusieurs bordereaux du lot est **cumulé** ; deux fois au même emplacement → avertissement
  (pas de refus) ; rapport d'écarts du lot (quantités et valeurs).
- **Validation** : les comptages du lot (cumulés par article) deviennent des `stock_comptage` à la date-heure du lot
  (S5) ; un article absent est inchangé.
- **Micro-inventaire** : depuis la fiche de stock d'un article ou le magasin, « Corriger le stock » = bordereau d'un
  article validé d'office à l'instant présent (motif, journalisé ; S8).

### 5.4 Réservations, mini / maxi, propositions

- Réservation : depuis l'Exécution (DAP, DAC, BE, BM) ou saisie directe ; date de besoin ; reste = réservé − transféré.
- **Disponible à T** = stock(T) − réservations restantes de besoin ≤ T ; **attendu** = reste à recevoir des commandes
  fournisseur sur le dépôt.
- **Projection** (règle répliquée, jeu `03_projection.json`) : à partir du stock présent, événements datés (entrées
  attendues à leur date de livraison prévue, réservations à leur date de besoin) cumulés dans l'ordre : courbe du
  disponible, **première date négative**, et pour chaque réservation la quantité **non honorée à sa date**
  (allocation dans l'ordre des dates de besoin). Exemple de la note : stock 25, réservation 100 demain, commande 200
  dans 7 jours → réservation servie 25 / 100 demain, manque 75 jusqu'à la livraison, puis disponible 125.
- Mini / maxi par article et dépôt ; **proposition de commande** : articles dont le disponible projeté à l'horizon
  (S15) passe sous le mini → quantité = maxi − disponible projeté, arrondie à l'unité d'achat, regroupée par
  fournisseur principal → demandes de prix ou commandes fournisseur en brouillon (rattachées au dépôt, adresse de
  livraison du dépôt).

### 5.5 Magasin et borne

- **Magasin** (`/stock/magasin`, magasinier) : comptoir de sortie (salarié ou chantier → articles par code, marque ou
  recherche → quantités), retours, réception rapide, demandes à valider, micro-inventaire.
- **Borne** : après le choix du salarié, « Sortie de stock » (et « Retour ») : chantier proposé par le planning du jour
  (ou dotation personnelle), articles par marques et recherche ; dépôt = celui de la borne (paramétrage de la borne).
  Crée un transfert **à valider** par le chef de service du salarié ou un magasinier (S17).

### 5.6 EPI et outillage consommable

- Articles marqués EPI ou outillage (marques S20, ou propriété « dotation » de l'article, S16), non identifiés.
- **Sortie à un salarié** = transfert du dépôt vers le chantier personnel du salarié, dans l'affaire de gestion
  « Dotations des salariés » ; le chantier (code = code du salarié) est créé à la **première sortie**. **Retour** =
  transfert inverse vers le dépôt (réutilisable) ou sortie sans destination (rebut).
- Historique des dotations par salarié ; onglet **Dotations** de la fiche salarié ; **visuel** `/stock/dotations` :
  tableau salariés × articles (quantités sorties, retournées, nettes) sur une période, avec la frise des dates par
  salarié ; filtres service, marque ; export CSV.

## 6. Liens avec les autres modules

| Module | Lien |
|---|---|
| Bibliothèque | Article stocké, unités et conversions, marques, `ele_pmp` et `ele_dernier_pa` alimentés |
| Document | Mouvements des types à `tyd_mouvemente_stock` (I7 enfin utilisé), restes des réservations et des commandes, transformations |
| Exécution | DAP / DAC / BE / BM → réservation ; coût des sorties imputé au chantier (rentabilité) |
| Achats | Date de livraison prévue des commandes, propositions de commande → demandes de prix / commandes |
| Pointage (borne) | Sorties et retours depuis la borne, dépôt de la borne |
| Planning | Chantier du jour proposé à la borne ; matériel identifié hors stock |
| Ressources | Salarié → chantier de dotation, service (validation par le chef) |
| CRM / Notifications | Demandes de la borne à valider (notification au chef et au magasin), ruptures projetées, articles sous le mini |
| GED | Bordereaux et lots d'inventaire édités, famille « Stock » des chantiers |
| Édition | Bordereau d'inventaire, rapport d'écarts, bon de sortie, état du stock valorisé, fiche de dotation EPI signée |
| Comptabilité (à venir) | Valorisation à date, écarts d'inventaire (pièce comptable `S_INVENTAIRE`) |

## 7. Ajouts au schéma (esquisse)

Module (`modules/stock/db/1xx`) : `stk_lieu` (identifiant du cœur, dépôt géré ou non, horizon de proposition),
`stk_emplacement` (arbre, code), `stk_article_emplacement`, `stk_mouvement` (`mvt_ele_id`, `mvt_lieu_id`,
`mvt_emp_id`, `mvt_date`, `mvt_quantite`, `mvt_valeur`, `mvt_ent_id`, `mvt_lig_id`, `mvt_sens`, `mvt_tracabilite` (réservée aux lots et numéros de série, S24), `mvt_ind_id`
salarié), `stk_comptage` (avec prix et commentaire de valorisation saisis, S30), `stk_reevaluation` (PMP corrigé, S4),
provenance du dernier PA connu (`ele_dernier_pa_date`, `ele_dernier_pa_tiers_id`, `ele_dernier_pa_ent_id`, pour
l'affichage ; le prix à une date est recherché dans les pièces d'achat, S29, S31), méthode de valorisation (paramètre
de la société, S29), `stk_lot_inventaire`, `stk_seuil` (mini / maxi par article et lieu), `stk_marque` et
`element.ele_marques`. Module Document : `ent_date_mouvement`, `ent_stock_origine_id`, `ent_stock_destination_id`,
`ent_date_livraison` et `lig_date_livraison` (commandes), `lig_date_besoin` (réservations), `lig_emplacement_id`.
Cœur (`db/2xx`) : `chantier.cha_depot`, affaires de gestion « Stock » et « Dotations des salariés », chantier de
dotation du salarié (`sal_cha_dotation_id`), vues de liste (stock par lieu, mouvements, dotations), activation.

## 8. Questions et propositions

| N° | Question | Proposition |
|---|---|---|
| S1 | Comment crée-t-on un dépôt ? | Fiche chantier marquée **dépôt** (`cha_depot`, chantier interne) dans une affaire de gestion « Stock » ; lié au besoin à la personne de niveau dépôt de l'annuaire (adresse de livraison `DEPOT` → ce chantier). **✔ Retenue (24/10/2026).** |
| S2 | Un chantier non dépôt tient-il un stock ? | Oui, mais **sans gestion** (ni inventaire, ni mini / maxi) : ce qui y entre y reste jusqu'à un transfert ou une sortie, ce qui permet le transfert entre deux chantiers ; option du chantier « consommé à la réception » (par défaut **oui** : une entrée sur un chantier client est consommée aussitôt, coût imputé). **✔ Retenue (24/10/2026).** |
| S3 | Le stock est-il tenu par emplacement ? | **Non** : tenu par article et lieu ; l'emplacement est une adresse de rangement (habituelle, ou portée par le mouvement et la ligne de comptage) qui sert aux bordereaux et à l'avertissement de doublon. Variante plus lourde : stock et comptages par emplacement. **✔ Retenue (24/10/2026).** |
| S4 | Valorisation ? | **PMP par article** (toutes les entrées valorisées, tous lieux), recalculé dans l'ordre des dates à chaque entrée ; sorties, transferts et écarts au PMP du moment ; `ele_pmp` et `ele_dernier_pa` mis à jour. Règle répliquée (jeu `02_pmp.json`). **✔ Décidé (24/10/2026)**, complété : (1) le **PMP est modifiable** dans la fiche article : la correction est une réévaluation datée (`stk_reevaluation` : article, date-heure, ancien et nouveau PMP, auteur, commentaire), point de départ du PMP des entrées suivantes, reprise dans l'historique des prix ; (2) valorisation au choix au **PMP** ou au **dernier prix d'achat** (S29), le dernier PA portant sa provenance : date, fournisseur, pièce (réception ou facture, lien vers le document) ; (3) dans un bordereau d'inventaire, **prix saisissable par ligne** avec commentaire (stock lent, obsolète, invendable : montant jugé par l'utilisateur), par défaut la valeur de la méthode retenue (S30). |
| S29 | Choix de la méthode PMP / dernier PA : où ? | Paramètre de la société (défaut PMP), modifiable par article ; l'état du stock valorisé peut aussi être édité selon l'autre méthode pour comparaison. Dernier PA = dernière entrée valorisée **à la date** (une facture qui suit sa réception remplace le prix de la réception). **✔ Décidé (24/10/2026)** : méthode **globale à la société** (pas de choix par article). Le prix n'est pas une valeur figée de l'article : il est **recherché à la date demandée** (date de valorisation, d'inventaire ou de sortie) parmi les pièces d'achat selon leurs dates de facture (règle répliquée `prix.js` ↔ `ReglesPrixStock.cs`, jeu `02_prix.json` ; précisions S31). `ele_dernier_pa` ne garde que la dernière valeur connue, pour l'affichage. |
| S31 | Recherche du dernier PA à une date D : quelles pièces, quel ordre ? | Candidats : les entrées valorisées de l'article (factures fournisseur sans réception, réceptions) ; la **date retenue est celle de la facture** quand la pièce est facturée, celle de la réception sinon (prix de la commande, **provisoire**, signalé) ; on prend la plus récente de date ≤ D, à égalité la dernière validée. Cas d'une réception avant D facturée après D : la date de facture la place après D, donc la valorisation à D prend le prix précédent, sauf demande faite après l'arrivée de la facture, où le **prix facturé** remplace celui de la réception (la marchandise était en stock à D) ; même règle pour le PMP, recalculé depuis la date de réception quand la facture corrige le prix. Avoir ou remise sur facture : prix net de la ligne. Aucun achat ≤ D : PA de la bibliothèque (`ele_pa`), signalé. **✔ Retenue (24/10/2026).** |
| S30 | Le prix saisi à l'inventaire change-t-il le PMP ? | **Non par défaut** : c'est la valeur d'inventaire de l'article à cette date (dépréciation : valeur comptée au prix saisi, écart de valeur avec la méthode retenue affiché dans le rapport d'écarts du lot, `cpt_prix`, `cpt_commentaire`) ; case « Appliquer au PMP » sur la ligne pour en faire une réévaluation (S4, 1) à la date du lot. **✔ Retenue (24/10/2026).** |
| S5 | Un mouvement daté exactement à l'heure du comptage ? Granularité ? | Date-heure **à la minute** ; un mouvement de la même minute est réputé **déjà compté**. **✔ Retenue (24/10/2026).** |
| S6 | Quand un comptage compte-t-il : bordereau par bordereau ou à la validation du lot ? | À la **validation du lot** (le lot cumule ses bordereaux) ; un bordereau hors lot (micro-inventaire) compte seul. Deux lots validés à la même date-heure sur un même article et lieu : refusé. **✔ Retenue (24/10/2026).** |
| S7 | Un lot couvre-t-il un seul dépôt ? | Oui. **✔ Retenue (24/10/2026).** |
| S8 | Micro-inventaire : motif obligatoire ? Droit ? | Motif facultatif, toujours journalisé ; magasinier, responsable du service logistique ou administrateur. **✔ Retenue (24/10/2026).** |
| S9 | `S_ENTREE` et `S_SORTIE` : gardés ? | Gardés comme **raccourcis** du même document (destination seule, origine seule) pour les listes et les éditions ; `S_TRANSFERT` porte origine et destination. **✔ Retenue (24/10/2026).** |
| S10 | Date-heure d'un mouvement ? | `ent_date_mouvement` du document, par défaut l'instant de la validation, modifiable (antidatée possible, futur refusé). **✔ Retenue (24/10/2026).** |
| S11 | « Facture sans BL » : comment la reconnaître ? | Ligne de facture fournisseur **non issue** d'une réception (pas de ligne source qui mouvemente) : elle mouvemente ; une facture issue d'une réception ne remouvemente pas. Même règle côté ventes (facture sans BL client → sortie). **✔ Retenue (24/10/2026).** |
| S12 | Lieu d'un document de vente ou d'achat ? | Achats : chantier rattaché s'il est un dépôt, sinon adresse de livraison `DEPOT` ; ventes : dépôt de départ dans l'entête (`ent_stock_origine_id`), proposé par le dépôt par défaut de la société. Sans dépôt : aucun mouvement. **✔ Retenue (24/10/2026).** |
| S13 | Date des commandes fournisseur ? | Date de livraison prévue dans l'entête, modifiable par ligne ; une commande en retard (date passée, reste à recevoir) compte à **aujourd'hui** dans la projection et est signalée en retard. **✔ Retenue (24/10/2026).** |
| S14 | Projection : quel horizon d'affichage ? | Frise de 8 semaines par défaut (réglable), par article et dépôt ; synthèse « ruptures à venir » de tous les articles d'un dépôt. **✔ Retenue (24/10/2026).** |
| S15 | Proposition de commande : horizon ? Arrondi ? | Horizon = délai de réapprovisionnement (par article, sinon par dépôt, défaut 7 jours) ; arrondi à l'unité d'achat (conditionnement) ; fournisseur principal, sinon à choisir. **✔ Retenue (24/10/2026).** |
| S16 | EPI / outillage : marque ou propriété de l'article ? | Une propriété de l'article « **dotation** » (EPI, OUTILLAGE) qui active l'historique par salarié et les retours ; les marques restent libres pour les listes. Un article par taille (pas de variantes). **✔ Retenue (24/10/2026).** |
| S17 | Saisie à la borne : le stock bouge-t-il avant la validation ? | **Oui** (la sortie physique a eu lieu) : le transfert est créé « à valider », compté dans le stock ; le valideur confirme, corrige les quantités ou refuse (refus : mouvement annulé, alerte au magasin). **✔ Retenue (24/10/2026).** |
| S18 | Qui valide une sortie saisie par un salarié ? | Le responsable du service du salarié **ou** un magasinier (membre d'un service de nature LOGISTIQUE) ; notification aux deux. **✔ Retenue (24/10/2026).** |
| S19 | Retour d'un EPI : état ? | Au retour, choix **réutilisable** (retour au dépôt) ou **rebut** (sortie) ; le net doté du salarié diminue dans les deux cas. **✔ Retenue (24/10/2026).** |
| S20 | Marques : paramétrage ? | Table de marques (code, libellé, couleur, actif), plusieurs par article, colonne `ARRAY` filtrable dans les listes ; saisie dans la fiche élément et en masse depuis la liste (sélection multiple). **✔ Retenue (24/10/2026).** |
| S21 | Visuel des dotations ? | Tableau salariés × articles (quantités nettes, détail au survol : dates) et frise par salarié ; filtres période, service, marque ; export CSV. **✔ Retenue (24/10/2026).** |
| S22 | Précision des quantités ? | 3 décimales en unité de stock ; arrondi demi vers l'infini (comme les moteurs). **✔ Décidé (24/10/2026)** : nombre de décimales **paramétré par unité** (`unite.unt_precision_qte` du module Document, déjà présent) appliqué à l'unité de stock de l'article ; arrondi demi vers l'infini ; la conversion depuis l'unité de la ligne est arrondie à la précision de l'unité de stock. |
| S23 | Stock négatif ? | **Autorisé**, avertissement à la saisie (jamais bloquant : antidatation et inventaire non bloquant l'exigent) ; liste « Stocks négatifs ». **✔ Retenue (24/10/2026).** |
| S24 | Lots, numéros de série, péremption ? | Hors périmètre (EPI non identifiés) ; matériel identifié = `materiel` des ressources. **⏸ Reportée, à approfondir (24/10/2026)** : lots et numéros de série nécessaires aux **certificats matière** (acier : numéro de coulée, certificat 3.1 rangé en GED et suivi jusqu'au chantier) et au futur **module SAV** (traçabilité des articles vendus, posés et entretenus). Hors des lots 1 à 5 ; le journal des mouvements devra pouvoir porter un lot ou un numéro de série (colonne réservée `mvt_tracabilite` à prévoir dès le lot 1). Analyse propre à mener (TODO). |
| S25 | Sortie depuis une réservation : obligatoire ? | Non : un transfert vers un chantier consomme d'abord ses réservations du même article et dépôt (plus ancienne date de besoin) ; la transformation réservation → transfert reste possible. **✔ Retenue (24/10/2026).** |
| S26 | Fiche de dotation EPI signée ? | Édition « Fiche de dotation » par salarié et période, signée sur la borne ou le papier (lot ultérieur). **✔ Retenue (24/10/2026).** |
| S27 | Renouvellement des EPI (durée de vie) ? | Durée de vie par article (mois) facultative → alerte de renouvellement au chef de service (lot ultérieur). **✔ Retenue (24/10/2026).** |
| S28 | Coût des sorties : imputation ? | Sortie / transfert vers un chantier = coût au PMP imputé au chantier (vue `v_cout_stock_chantier`, réutilisée par la rentabilité de l'Exécution). **✔ Retenue (24/10/2026).** |

## 9. Faisabilité

- Le calcul « dernier comptage + mouvements postérieurs » se fait en SQL (index `article, lieu, date`) pour les listes
  et en mémoire pour la projection ; volumes : quelques centaines de milliers de mouvements par base, sans difficulté.
- Le PMP dépend de l'ordre chronologique : un mouvement antidaté oblige à recalculer le PMP depuis sa date (même règle
  côté serveur à chaque écriture ; mémorisation par article d'un PMP à date pour éviter de tout reprendre).
- Les mouvements issus des documents passent par les points d'accroche existants (`ApresValidationAsync`, annulation)
  de la spécialisation BTP, en une transaction avec la validation.

## 10. Découpage en lots proposé

| Lot | Contenu |
|---|---|
| 1 | Module `modules/stock` : lieux (chantier dépôt), emplacements, marques, journal des mouvements, stock à date (règle répliquée + jeu), PMP ; transferts `S_TRANSFERT` / `S_ENTREE` / `S_SORTIE` ; mouvements des réceptions, factures sans réception, BL, retours ; onglet Stock de l'élément ; listes stock par lieu et mouvements ; activation |
| 2 | Inventaires : bordereaux générés (zone, famille, marque), lots à date-heure unique, cumul et avertissements, validation, écarts valorisés, micro-inventaire, éditions |
| 3 | Réservations (date de besoin, consommation), dates de livraison des commandes, projection et ruptures, mini / maxi, propositions de commande |
| 4 | Magasin et dotations : interface magasinier, EPI / outillage (chantier par salarié, retours), validation des saisies, visuel des dotations, onglet Dotations du salarié |
| 5 | Borne : sorties et retours de l'atelier, dépôt de la borne, saisies à valider ; fiche de dotation, renouvellement (S26, S27) |
