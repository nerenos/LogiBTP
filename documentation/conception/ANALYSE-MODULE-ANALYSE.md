# Analyse du module Rentabilité (suivi économique des chantiers)

Statut : **analyse validée** (01/11/2026, 15:00). Rien n'est réalisé. Les réponses du 01/11/2026 sont intégrées
dans le texte (repérées « ✔ Décision ») et récapitulées au § 14 ; la stratégie de stockage et de rafraîchissement
(§ 11, option 2) est retenue.

Nom : le module s'appelle **Rentabilité** (Q1) ; l'onglet Analyse du document garde son nom et son rôle (aide à la
saisie : modifications, prix, coefficients).

Relevé du code : branche `main`, commit `d3a3e17`.

## 1. But

Donner, pour un ou plusieurs chantiers, une lecture **juste et vérifiable** de leur économie : ce qui a été vendu,
ce qu'on prévoit d'exécuter, ce qui est engagé, déboursé, facturé, et ce qui reste. Le module ne crée aucune donnée
de gestion : il **cristallise et synthétise** ce que produisent le module Document (selon les types de pièces), le
Pointage, le Planning et le Stock. Toute valeur affichée doit pouvoir être **expliquée ligne à ligne** jusqu'aux
pièces d'origine.

Demande du 01/11/2026, reformulée :

| Sujet | Demande |
|---|---|
| Rendus | **Liste** (plusieurs origines, niveau le plus bas : le chantier, ligne de total figée en bas) et **Détail** (par regroupement et nature, total en haut, bloc de résultats sur les PV en bas) |
| Origine | Chargé d'affaires, affaire, chantier, et sous le chantier l'**ordre d'exécution** (ajout du 01/11) ; les projets sont hors de l'analyse (rien n'y est pointé, ils ne regroupent pas les chantiers) |
| Période | « Jusqu'au » ou « du … au » ; saisie au format année, mois ou jour (mois : du 1er au dernier jour) |
| Affichage | Arrondi à l'entier ou 2 décimales ; prix au **PA** ou au **PR** ; choix des colonnes et vues enregistrées |
| Indicateurs | Budget, Budget d'exécution, Engagé, Déboursé, Dépensé, Reste à dépenser, Facturé, Reste à facturer (couleurs au § 4.10) |
| Détail d'un chiffre | Double-clic sur une cellule : toutes les lignes qui composent le chiffre (type de pièce, date…), rapport complet |
| Second temps | Saisie prévisionnelle (budget d'un avenant en négociation, dépense d'une facture non parvenue…) ; prévisionnel de facturation par mois avec historique des saisies ; graphiques (marge, facturation, budget) |
| Point à discuter | Stockage des valeurs dans des tables, rafraîchissement à plusieurs niveaux (document, chantier, affaire, global), manuel, sur événement ou la nuit |

## 2. État des lieux

### 2.1 Ce qui existe déjà et que le module réutilise

| Sujet | Où | Ce qu'on en tire |
|---|---|---|
| Pièces et types | `db/110` (`V_DEVIS`, `V_COMMANDE`, `V_RECEPTION`, `V_FACTURE`, `V_FACTURE_AVT`, `V_AVOIR`, `A_COMMANDE`, `A_RECEPTION`, `A_RETOUR`, `A_FACTURE`, `A_FACTURE_AVT`, `A_AVOIR`, famille S), `V_SITUATION`, `V_REPRISE_AVT`, acomptes (`V_DEMANDE_ACOMPTE`, `V_FACTURE_ACOMPTE`, `V_RECU_ACOMPTE`), famille E (`E_OE`, `E_PO`, `E_DAP`, `E_BE`… `E_SAV`, `E_ENT`), famille T (`T_AO`, `T_COMMANDE`, `T_FACTURE_AVT`, `T_AVOIR`) | Le « sens » de chaque pièce dans l'analyse se déclare par type (§ 4.1) |
| Montants par ligne figés | `document_ligne` : `lig_qte_totale`, `lig_montant_ht`, `lig_montant_pa`, `lig_montant_pr` (`db/100`), `lig_type_prix` V/O/M/A/F, `lig_nat_id` | Un document validé affiche son **résultat enregistré** sans recalcul : l'analyse lit ces montants, jamais le moteur |
| Natures et regroupements | `nature_element` (`nat_rgn_code`, `nat_srv_id`), `regroupement_nature` (MO, MATERIAUX, ENGIN, SOUS_TRAITANCE, PRESTATION, VENTE, FABRICATION) | Axe « regroupement › nature » du Détail |
| Liens de transformation | `document_lien`, `document_ligne_lien` (`lil_qte`, `lil_montant_ht`, étape), `document_ligne_solde`, `lig_avt_source_lig_id` | Reste à livrer (engagé), facturé rattaché à la ligne de commande |
| Structure | `projet`, `affaire` (`aff_nature` C / G), `chantier` (`cha_aff_id`, `cha_charge_ind_id` chargé d'affaires, `cha_conducteur_ind_id`, `cha_interne`, `cha_depot`, `cha_stock_tenu`), `marche` (`mar_sens` V / ST) ; rattachement des pièces `ent_projet_id` … `ent_marche_id`, chantier par ligne des achats `lig_cha_id` (`db/248`) | Axe « origine » |
| Budget d'exécution | `E_OE` transformé depuis les commandes du marché, prix modifiables (E16), instantanés `ordre_budget` à chaque validation, premier = référence (`Btp/ExecutionBtp.cs` : `BudgetAsync`, `FigerBudgetAsync`) | Base du « Budget d'exécution » |
| Heures | `v_heures_lignes`, `v_heures_budget_chantier` (`db/197`) ; `v_pointages_retenus`, `v_heures_realisees_*` (`db/202`) ; `poi_cout`, `poi_taux`, `poi_valorisation` SALARIE / INTERIM / IMPORT (module Pointage `088`) | Heures et coût MO pointés |
| Planning | `pla_tache` (`tac_type_element`, `tac_id_element`, `tac_etat`, `tac_srv_id`), `pla_affectation` (`aff_heures` en minutes, ressource), calcul par les plages des calendriers (`ReglesPlanning`, `ReglesCharge`) | Heures planifiées (engagé MO) |
| Stock | `stk_mouvement` (`mvt_prix`, `mvt_pmp`, `mvt_provisoire`), revalorisation différée `stk_a_valoriser`, décision S28 : sortie vers un chantier = coût au PMP | Déboursé stock |
| Facturé et coûts | `v_facturation_document` (`db/174`), `v_cout_chantier` (`db/233`), colonnes facturé / reste des listes de marchés | À **remplacer** par la source unique du module (voir § 2.2) |
| Onglet Analyse du document | `client/src/app/analyse-calcul.js` (feuilles, déboursé, revient, PV avec frais annexes, prix client, marges), clés `analyse_btp.*` | Même logique de feuilles pour ventiler un PV par nature. ✔ Décision : l'onglet sert à la saisie du document ; le module s'appelle Rentabilité |
| Sous-traitance | Famille T (`T_AO`, `T_COMMANDE`, `T_FACTURE_AVT`, `T_AVOIR`), marchés `mar_sens` ST liés au marché de vente, `E_OST` (ordre de sous-traitance) | Source à part entière (ajout du 01/11) : engagé = commandes T, déboursé = factures T, composante « Sous-traitance » distincte des achats |
| Listes et vues | Module Liste : `vue_liste` (partage P / G / T), totaux de pied, indicateurs calculés par la base, `ConcepteurVue` | Modèle des vues enregistrées ; les sources du module Liste sont des vues SQL **sans paramètre** (pas de période) |
| Textes, icônes, couleurs | Module Personnalisation : `texte()`, `icone()`, variables du thème | Aucune couleur ni texte en dur (règle du projet) |

Décisions antérieures qui engagent déjà ce module : rentabilité continue « vendu / planifié / engagé / réalisé / reste
à dépenser, par service et par nature » (Exécution, possibilité 1, E23) ; commande de sous-traitance validée =
**engagé**, factures = **réalisé** (ST30) ; sortie de stock vers un chantier = coût au PMP (S28) ; refacturation du
matériel aux chantiers « décision de la future analyse de rentabilité » (M4, `TODO.md`) ; revalorisation des heures
après la paie (M20, valorisation IMPORT déjà prévue).

### 2.2 Anomalies relevées dans l'existant (à corriger, quel que soit le choix)

| # | Constat | Effet |
|---|---|---|
| A1 | `v_facturation_document` ne retient que `ent_verrouille`. Or une dévalidation (`DocumentService.Devalider`) passe l'ancienne version au statut REMPLACE **sans la déverrouiller** (seule la copie est déverrouillée par `Dupliquer`). | Une facture dévalidée puis revalidée compte **deux fois** dans le facturé des marchés, chantiers et affaires (listes `v_liste_marches`, …). |
| ↳ | ✔ Décision : à corriger ; la version d'origine d'une pièce dévalidée passe hors du périmètre (traitée comme annulée, voir V1 et R1). | |
| A2 | `v_cout_chantier` : même filtre (versions REMPLACE comptées), chantier de l'entête seulement (ignore `lig_cha_id` des achats), total HT de la pièce (pied compris), factures seulement (réceptions non facturées ignorées). | Coût doublé après dévalidation, coût d'un achat multi-chantiers mal imputé, livraisons non facturées absentes. |
| ↳ | ✔ Décision : à corriger ; coûts ventilés par le chantier de la ligne, pied d'une pièce d'achat en « Non ventilé » réparti entre les chantiers au prorata de leurs lignes (V11, V25) ; étudier une table des chantiers d'une pièce pour filtrer vite (§ 5.7). | |
| A3 | `analyse-calcul.js` calcule les montants en `Number` (`montantsFeuille`, `agreger`). | Contraire à la règle « jamais de `Number` pour un montant » ; à ne pas réutiliser tel quel. |
| ↳ | ✔ Décision : on laisse l'onglet tel quel (aide à la saisie) ; dans le module, de petits écarts d'arrondi sont acceptés (ex. l'option d'arrondi à l'entier). | |
| A4 | `v_heures_lignes` reconnaît les heures par l'unité (`h`, `heure`, `heures`) : une ligne MO en jours ou en forfait n'a pas d'heures. | Heures budget incomplètes si les bibliothèques mélangent les unités. |
| ↳ | ✔ Décision : le module ne somme et n'affiche que les heures (unité h) ; un jour ne vaut pas le même nombre d'heures partout (pose 39 h sur 4 jours, atelier 35 h sur 5 jours) : c'est à l'utilisateur de chiffrer en heures dans ses ouvrages ou ses métrés. | |
| A5 | Plusieurs requêtes repèrent le périmètre « pièce valable » chacune à sa façon (`ent_verrouille`, `ent_is_reference`, `NOT IN ('ANNULE','REMPLACE')`). | Risque d'écarts entre écrans. Une **fonction ou vue unique** du périmètre doit servir partout (§ 9.1). |
| ↳ | ✔ Décision : une seule fonction et une seule vue du périmètre, même méthode partout (R2). | |

## 3. Principes proposés

1. **Une donnée élémentaire = un fait** : une ligne de pièce, un pointage, une affectation du planning, un mouvement
   de stock ou une saisie prévisionnelle, avec son indicateur, sa date, son chantier, sa nature, sa quantité et ses
   montants PA, PR, PV, et la **référence de sa source**. Tout chiffre affiché est une somme de faits : le double-clic
   n'a qu'à les lister.
2. **Seules les pièces valables comptent** : validées par l'entreprise (verrouillées), indice de référence, ni
   annulées ni remplacées (sauf règle explicite d'annulation par avoir, § 9.1). Les brouillons ne comptent jamais.
3. **Montants figés lus tels quels** : on lit le résultat enregistré des pièces validées (les mêmes chiffres que
   l'édition), on ne recalcule jamais un document.
4. **Toujours en HT**, calculé en `decimal` par le serveur, arrondi à l'affichage. ✔ Décision : le module remonte
   des informations, il n'a pas la précision d'un calcul de document ; de petits écarts d'arrondi (total ≠ somme des
   valeurs arrondies) sont acceptés.
5. **Le calcul est fait par le serveur seul** (C#, une seule implémentation, jeu de cas de chantier fictif) : pas de
   réplication JS / C# des règles d'analyse, sauf la lecture des périodes (§ 5.3) qui sert aussi au client.
6. **Les axes changeants sont joints à la lecture** : un fait porte le chantier, l'ordre d'exécution et la nature ;
   l'affaire, le chargé d'affaires et le regroupement sont lus au moment de l'affichage. Changer un chantier d'affaire ou une nature de
   regroupement ne demande aucun recalcul.
7. **Indicateurs de stock et de flux** distingués (§ 5.4) : un budget ou un engagé est un **état à une date** ; un
   déboursé ou un facturé est un **cumul sur une période**.
8. ✔ Décision : **les montants anormaux sont en rouge** (§ 4.11) : chaque colonne a un sens « normal ».
9. ✔ Décision : **les quantités et les prix sont ceux des documents** ; les liens entre documents se calculent
   toujours dans l'unité de la ligne d'origine, le stock toujours dans l'unité de stock (conversions de l'article de
   la bibliothèque). Un garde-fou interdit une unité différente de l'origine ou du stock quand la conversion n'est
   pas enregistrée (V32).

## 4. Les indicateurs

Notation : *PU* = prix unitaire, *qte* = quantité totale de la ligne (composantes comprises), « feuille » = ligne
chiffrée sans composante (même définition que l'onglet Analyse du document).

### 4.1 Rôle de chaque type de pièce

| Type | Budget | Budget d'exécution | Engagé | Déboursé | Facturé |
|---|---|---|---|---|---|
| `V_DEVIS` | — | — | — | — | — |
| `V_COMMANDE` (base et avenants) | + lignes vendues | + lignes non reprises dans un OE | — | — | — |
| `V_FACTURE`, `V_AVOIR` sans commande d'origine (facture directe) | + (Q5) | + | — | — | ± |
| `V_FACTURE`, `V_FACTURE_AVT` (période), `V_AVOIR` (signe, nature AVANCEMENT gardée en négatif) | — | — | — | — | ± |
| `V_FACTURE_ACOMPTE` | — | — | — | — | selon le mode des acomptes (Q14) |
| `V_SITUATION`, `V_REPRISE_AVT`, `V_RECEPTION`, `V_RETOUR` | — | — | — | — | — (la situation sert au « réalisé PV », Q15) |
| `E_OE` | — | remplace les lignes de commande qu'il reprend, + lignes ajoutées | — | — | — |
| Autres ordres E (`E_PO`, `E_DAP`…) | — | — | — | — | — |
| `A_COMMANDE` | — | — | + reste à livrer | — | — |
| `A_RECEPTION` / `A_RETOUR` | — | — | − / + | + / − | — |
| `A_FACTURE` (avec ou sans réception), `A_AVOIR` | — | — | − (sans réception) | + écart de prix ou + total / − | — |
| `A_FACTURE_AVT` (période) | — | — | − | + | — |
| `T_COMMANDE` | — | — | + reste à facturer | — | — |
| `T_FACTURE_AVT` (période), `T_AVOIR` | — | — | − | + / − | — |
| `S_RESERVATION` | — | — | + reste à sortir (✔ Décision) | — | — |
| Famille S (sorties, transferts vers le chantier) | — | — | − réservation | + au PMP | — |
| Commandes d'intérim, de location, de sous-traitance | — | — | + (✔ Décision : l'engagé de ces ressources vient des commandes, pas du planning) | selon V43 | — |
| Situation de production (nouveau type, § 4.12) | — | — | — | — | — (sert au PCA / FAE) |
| Pointages retenus | — | — | — | + coût | — |
| Pointages du matériel (lot 2) | — | — | — | + heures × coût moyen de la fiche | — |
| Tâches du planning après la dernière saisie (OPTION comprises, théoriques comprises) | — | — | + coût | — | — |

Ce tableau doit vivre en **paramétrage** (rôle par type, comme les règles des documents) plutôt qu'en dur, pour qu'un
nouveau type (par exemple une future facture d'intérim) se déclare sans code. Le code de type reste dans `codes.js` /
`Codes.cs`.

### 4.2 Budget (bleu clair)

- **Source** : commandes clients valables du chantier (`V_COMMANDE`, base et avenants), plus les factures et avoirs
  de vente qui n'ont aucune commande d'origine (Q5). Une commande « intermédiaire » (devis facturé directement) est
  une commande comme une autre.
- **Lignes retenues** : lignes vendues (type de prix V sur toute la branche). Options et variantes non retenues,
  lignes pour mémoire : écartées. **Tranches de frais annexes (F)** : leur PV est déjà ventilé dans les autres lignes
  (`lig_coef_fa`), mais leur PA et leur PR ne sont ventilés sur aucune autre ligne : ✔ Décision, ils **entrent dans le
  budget PA / PR** du module (l'onglet Analyse du document, lui, les écarte pour ne pas ventiler deux fois le PV).
- **PA / PR** : somme des feuilles (`lig_montant_pa`, `lig_montant_pr`), donc par nature des composantes.
- **PV** : `lig_montant_ht` de la ligne vendue, **ventilé sur ses feuilles** au prorata de leur prix client (calcul
  des feuilles de l'onglet Analyse, en décimal), l'écart d'arrondi porté par la plus forte feuille, pour que le PV
  par nature retombe exactement sur le HT des lignes (V21).
- **Postes de pied HT** (remise, compte prorata, révision) : hors lignes, présentés à part dans le bloc de résultats
  (« détail des postes HT », « HT net »), jamais ventilés en douce dans les natures (V23).
- **Date** : date de la commande (Q3).

### 4.3 Budget d'exécution (bleu)

- **Règle proposée** : pour chaque ligne de commande valable,
  - si elle est reprise par un ou plusieurs OE valables (`document_ligne_lien` commande → OE), on prend les lignes
    de l'OE (quantités, PA, PR, composantes et natures telles que modifiées par le conducteur) ;
  - sinon (avenant pas encore passé en OE, chantier sans OE), on prend la ligne de commande ;
  - plus les lignes **ajoutées** dans l'OE sans ligne d'origine (« hors marché »).
- **PV** : la vente ne change pas avec l'OE (décision E10). Proposition : le PV du budget d'exécution est celui du
  budget ; une ligne ajoutée par l'OE a un PV nul (Q6).
- **Versions** : on lit l'indice de référence validé de l'OE. Le budget de **référence** (première validation,
  `ordre_budget.obu_reference`) pourrait être une colonne facultative « Budget de référence » pour mesurer les dérives
  (Q6).
- **Date** : date de validation de l'OE pour la part modifiée (Q3).

### 4.4 Engagé (saumon clair)

Ce qui est commandé ou planifié et pas encore consommé, **à la date de fin** de la période :

| Composante | Règle |
|---|---|
| Achats | Par ligne de `A_COMMANDE` valable : quantité commandée − reçue (réceptions − retours valables) − facturée sans réception (le maximum de reçu et facturé, comme `StockApprovisionnementBtp.PrevisionsAsync`) ; ligne soldée (`document_ligne_solde`) = 0 ; jamais négatif (une surlivraison est signalée, V31). Valorisé au prix net de la commande. |
| Sous-traitance | Par `T_COMMANDE` valable : montant − cumul facturé (factures d'avancement − avoirs), par ligne via l'avancement. |
| Main-d'œuvre planifiée | ✔ Décision : tâches **affectées** à des salariés : minutes après la **dernière saisie de pointage du salarié**, valorisées à son taux (`TauxAsync`) ; tâches **théoriques sans affectation** : heures après la **dernière saisie du chantier**, valorisées à un taux à définir (Q-R3) ; tâches en OPTION comprises ; tâches d'absence écartées. Réparties par jour selon le calcul du planning. |
| Matériel planifié | ✔ Décision : affectations de matériel **hors location** (le matériel loué est engagé par sa commande), heures × coût moyen de la fiche (lot 2). |
| Intérim, location, sous-traitance | ✔ Décision : engagés par leurs **commandes** (reste à livrer ou à facturer) ; leurs affectations au planning ne sont pas valorisées (pas de double compte). |
| Stock | ✔ Décision : réservations (`S_RESERVATION`) valables : quantité réservée − sorties, comme une commande en attente de livraison, au PMP. |

Le reste à solder du module Document compte les **brouillons** ; l'analyse ne peut pas le réutiliser tel quel : seules
les pièces valables réduisent l'engagé (V30).

### 4.5 Déboursé (saumon)

| Composante | Règle proposée |
|---|---|
| Achats livrés | Ligne de réception valable : quantité × prix de la commande (prix provisoire), à la date de réception. À la facture : un fait d'**écart de prix** (facturé − valeur de la réception) à la date de la facture. Facture sans réception : son montant. Retour, avoir : en négatif. Situation fournisseur : la période. (Q13) |
| Sous-traitance | Factures d'avancement T (période) et avoirs T. |
| Main-d'œuvre | Pointages retenus (couche validée si la semaine est validée, sinon saisie), coût `poi_cout` à la date du pointage ; pointages non valorisés signalés (V40). Intérimaires : selon l'option du Pointage (V43). |
| Stock | Sorties et transferts valables vers le chantier au PMP du mouvement (S28) ; réceptions faites sur un chantier qui **tient un stock** : pas de déboursé à la réception, seulement à la sortie (V45). |
| Matériel | ✔ Décision (lot 2) : heures du pointage matériel × **coût moyen horaire saisi dans la fiche matériel**, sur le **chantier pointé** (une pelle 40 h sur le chantier A : chantier A ; une visseuse pour l'entretien de la pelle : chantier de suivi de la pelle). |

**PR des coûts réels** : une pièce d'achat ou un pointage n'a qu'un prix d'achat. Pour afficher le déboursé au PR, il
faut un **coefficient de frais généraux** : à choisir (Q7).

### 4.6 Dépensé (saumon foncé) et reste à dépenser (jaune foncé)

- **Dépensé** = Engagé + Déboursé.
- La composante (achats, sous-traitance, main-d'œuvre, matériel, stock) est une colonne de détail possible de chaque
  indicateur de coût.
- **Reste à dépenser** = Budget d'exécution − Dépensé (au PA ou au PR selon le choix d'affichage). Négatif =
  dépassement, mis en évidence.

### 4.7 Facturé (vert) et reste à facturer (vert clair)

- **Facturé** : pièces de vente comptables valables (factures, factures d'avancement en période, avoirs avec leur
  signe) à leur date comptable. Au détail, chaque ligne facturée est rattachée à la ligne de commande
  (`lig_avt_source_lig_id`, liens de transformation) et donc ventilée par nature comme le budget.
- Les **postes de pied** des factures (déduction d'acompte, révision `V<commande>` / `VR<commande>`, remise, compte
  prorata) sont des faits à part : ils entrent dans le « HT net » du facturé, pas dans les natures (V23, Q14).
- **Reste à facturer** = Budget (PV) − Facturé, au niveau lignes et au niveau HT net (Q14 pour la révision et les
  acomptes).
- ✔ Décision, **acomptes en trésorerie** (hors chiffre d'affaires) : on affiche à part les montants **payés par le
  client**, **utilisés sur les factures** (déductions) et le **reste à utiliser**, dans le bloc de récapitulatif du
  Détail et en colonnes de la Liste par chantier. Sources : reçus d'acompte (`V_RECU_ACOMPTE`) et règlements, postes de
  déduction des factures d'avancement.

### 4.8 Bloc de résultats sur les PV (Détail, bas de page)

Lignes : **Budget**, **Réalisé**, **Facturé**, **Reste à facturer**, **Prévisionnel** (à terminaison).
Colonnes : HT des lignes, détail des postes HT, **HT net**, **marge brute** = (PV − PA) / PV en montant et en %,
**marge nette** = (PV − PR) / PV en montant et en %.

Chaque ligne doit dire **quel coût** elle met en face de son PV. Proposition (Q16) :

| Ligne | PV | Coût en face |
|---|---|---|
| Budget | Budget PV | Budget PA / PR |
| Réalisé | ✔ Décision (Q15) : somme des PV HT facturés de chaque facture, après déduction du précédent (période des factures d'avancement) | Déboursé |
| Facturé | Facturé | Déboursé à la même date |
| Reste à facturer | Reste à facturer | Reste à dépenser |
| Prévisionnel | Budget PV + prévisionnel de budget | Dépensé + reste à dépenser + prévisionnel de dépense |

La marge de l'onglet Analyse du document prend le « prix client » pour la marge brute et le « PV remisé sans frais
annexes ni prorata » pour la marge nette. La demande dit PV dans les deux cas : il faut choisir une seule définition
et l'écrire dans la bulle de la colonne (Q16).

### 4.9 Quantités et heures

Proposition : colonnes facultatives d'**heures** pour le regroupement MO (heures budget, budget d'exécution,
planifiées après la dernière saisie, pointées), car c'est le premier indicateur de dérive d'un chantier et elles ne
dépendent d'aucun taux. Les quantités des autres natures n'ont de sens que par élément (unités hétérogènes) : visibles
seulement dans le double-clic.

### 4.10 Couleurs des indicateurs

Variables du thème du module (clair et sombre), jamais de couleur en dur : `--rentabilite-budget` (bleu clair),
`--rentabilite-budget-execution` (bleu), `--rentabilite-engage` (saumon clair), `--rentabilite-debourse` (saumon),
`--rentabilite-depense` (saumon foncé), `--rentabilite-reste-depenser` (jaune foncé), `--rentabilite-facture` (vert),
`--rentabilite-reste-facturer` (vert clair), chacune avec sa variante `-texte` pour le contraste. La couleur teinte
l'en-tête et une bande de la colonne, pas toute la cellule, pour garder la lisibilité des montants en rouge.

### 4.11 Montants anormaux en rouge

✔ Décision : on est dans l'analyse, un montant anormal se voit. Chaque colonne déclare son **sens normal** (dans la
définition de la colonne, pas en dur dans le rendu) :

| Colonne | Noir | Rouge |
|---|---|---|
| Restes (à dépenser, à facturer), marges, budget | positif ou nul | négatif |
| Réductions (remise, déduction d'acompte, avoir) | négatif ou nul | positif |
| Écarts (budget d'exécution − budget, prix facturé − prix commandé, engagé corrigé) | selon la colonne : un surcoût est rouge | |
| Contrôles (pointages non valorisés, faits « Non ventilé », pièces rejetées à annuler) | zéro | différent de zéro |

La couleur rouge est une variable du thème (`--rentabilite-anomalie`), avec une bulle qui dit pourquoi.

### 4.12 Situations de production, PCA et FAE (ajout du 01/11)

✔ Décision : un **nouveau type de vente**, la **situation de production**, double de la situation de travaux mais
qui dit l'**avancement réel** du chantier et non l'avancement facturé.

- Même saisie que la situation (lignes du marché, % / quantité / montant cumulés), par **période** (mois), non
  comptable, sans numérotation continue, sans effet sur le facturé ni sur l'échéancier.
- **PCA / FAE de la période** = production cumulée − facturé cumulé (factures d'avancement) à la fin de la période :
  positif = **factures à établir** (FAE), négatif = **produits constatés d'avance** (PCA) ; la variation de la période
  est la différence avec la période précédente.
- **Raccourci de préchargement** entre les deux types pour une période (situation de travaux → situation de
  production, et l'inverse), pour éviter les ressaisies.
- **Colonnes d'information croisées** dans chacun des deux documents : quantité, % et montant de l'autre document de
  la même période (comme les colonnes « précédent » de l'avancement).
- Dans le module : ligne « Production » du bloc de résultats et colonnes PCA / FAE de la Liste ; la marge sur la
  production (production − déboursé) est la marge la plus juste en cours de chantier.
- C'est une évolution du module Document et du cœur (type, transformations, `ALIAS_AVANCEMENT`, vues de colonnes),
  à faire avant le bloc de résultats (lot dédié, § 13). Questions au § 14.2.

## 5. Axes et paramètres d'affichage

### 5.1 Origine

| Niveau | Source | Remarque |
|---|---|---|
| Chargé d'affaires | `chantier.cha_charge_ind_id` (individu) ; au niveau affaire, nouveau `affaire.aff_responsable_ind_id` | ✔ Décision : valeur **actuelle** (pas d'historique pour le moment, à noter dans `TODO.md`) ; le responsable de l'affaire devient un **individu** comme sur le chantier (le texte `aff_responsable` est repris puis retiré, comme `prj_responsable`) |
| Affaire | `chantier.cha_aff_id` | Affaires de gestion (`aff_nature` G), MATERIEL, STOCK, DOTATIONS, SAV : écartées par défaut (Q25) |
| Chantier | fait | Niveau le plus bas de la Liste au-dessus de l'ordre |
| Ordre d'exécution | fait (`afa_ordre_id`) | ✔ Décision : sous-niveau du chantier (§ 5.6) |
| (Marché) | fait (`ent_marche_id`) | Filtre et regroupement du Détail (Q17, proposition maintenue) |
| ~~Projet~~ | — | ✔ Décision : hors de l'analyse |

Les pièces sans chantier (rattachées à une affaire seulement) apparaissent dans une ligne « Sans chantier » de leur
affaire, jamais perdues (V12).

### 5.2 Regroupement et nature (Détail)

`regroupement_nature` › `nature_element`. Une ligne sans nature (pièce non BTP, poste de pied, acompte) va dans une
nature **« Non ventilé »** visible, jamais répartie silencieusement (V24, Q18).

### 5.3 Période

- Deux modes : **jusqu'au** (depuis l'origine) et **du … au**.
- Saisie : `AAAA` = année (01/01 → 31/12) ; `MM/AAAA` = mois (1er → dernier jour) ; `JJ/MM/AAAA` = jour ; les
  abréviations du socle restent permises (« 15 », « 15/10 »). En début de période, un mois ou une année donne le
  premier jour ; en fin, le dernier jour.
- Attention : `completerDate` du socle lit « 10/26 » comme le 10 du mois 26… et « 16/05 » comme un jour. Il faut une
  fonction dédiée `lirePeriode(texte, borne)` (début / fin) qui reconnaît l'année et le mois **avant** de déléguer au
  socle, répliquée JS / C# avec un jeu de cas (`modules/analyse/tests/cas/01_periodes.json`) : « 2026 », « 10/2026 »,
  « 1/2026 », « 31/10/2026 », « 15 », « 29/02/2025 » (refus), fin avant début (refus).
- Raccourcis proposés : mois en cours, mois précédent, exercice en cours, depuis l'origine.

### 5.4 Stock ou flux selon le mode

| Indicateur | Nature | « Jusqu'au T » | « Du D au F » (proposition, Q4) |
|---|---|---|---|
| Budget, budget d'exécution | état | état à T | variation entre D et F (avenants signés, OE modifiés) |
| Engagé | état | état à T | état à F |
| Déboursé, facturé | flux | cumul jusqu'à T | cumul entre D et F |
| Dépensé, restes | calcul | à T | à F, calculé sur les cumuls (une « reste » sur une période n'a pas de sens) |

### 5.5 PA ou PR, arrondi

- Le choix PA / PR s'applique à toutes les colonnes de coût ; le PV ne change pas.
- Arrondi : entier ou 2 décimales, à l'affichage seulement. Le total est la somme **exacte** arrondie, donc il peut
  différer de ±1 de la somme des valeurs arrondies affichées (V60). ✔ Décision : accepté.

### 5.6 Sous-niveau « ordre d'exécution » (ajout du 01/11)

Sous chaque chantier, une ligne par ordre d'exécution, plus une ligne « Sans ordre » pour ce qui ne s'y rattache pas.
Le total des ordres + « Sans ordre » = le chantier, toujours. Rattachement de chaque fait :

| Fait | Ordre retenu |
|---|---|
| Budget, budget d'exécution | L'OE qui reprend la ligne de commande ; ligne de commande pas encore reprise : « Sans ordre » |
| Pointage | `poi_ent_id` (l'ordre pointé) ; un ordre de pose, de fabrication… se rattache à son OE en remontant les transformations |
| Tâche du planning | Ordre d'origine de la tâche (liaison ordre → tâche de `LiaisonsBtp`), sinon « Sans ordre » |
| Achat, sous-traitance, réservation | Ordre d'origine trouvé en **remontant les liens de transformation** (`E_DAP` → `A_COMMANDE` → réception → facture ; `E_OST` → `T_COMMANDE` → factures T ; `E_DAP` → `S_RESERVATION` → sortie) ; pièce saisie sans ordre : « Sans ordre » |
| Facturé | Ligne de commande facturée → OE qui la reprend |

Points à décider (§ 14.2) : le niveau affiché est-il l'**OE** seulement (les autres ordres E remontant à leur OE), ou
chaque ordre E ; et faut-il permettre de **rattacher à la main** une pièce d'achat saisie sans ordre (champ ordre de
l'entête ou de la ligne des achats, comme `lig_cha_id`).

### 5.7 Chantiers d'une pièce (ajout du 01/11)

✔ Décision : les coûts se ventilent toujours par le **chantier de la ligne** ; à étudier : ne plus limiter
l'affectation de l'entête à un chantier, pour **filtrer vite** les pièces de plusieurs chantiers. Proposition : une
table `document_chantier (ent_id, cha_id, part_ht)` tenue par trigger depuis l'entête et `lig_cha_id`, lue par les
filtres des listes (`v_liste_documents.chantiers`, déjà en `ARRAY`) et par la file de recalcul ; l'entête garde
`ent_chantier_id` (chantier principal, éditions) pour ne rien casser.

## 6. Rendu Liste

- Une ligne par origine, dépliable : chargé d'affaires › affaire › chantier › ordre d'exécution (ou affaire ›
  chantier › ordre), niveau choisi par la vue ; les totaux de chaque niveau sont la somme exacte des chantiers.
- Colonnes : indicateurs de coût (PA ou PR), indicateurs PV (budget PV, facturé, reste à facturer), marges, % de
  dépensé sur budget d'exécution, % facturé, heures MO ; colonnes choisies par la vue.
- **Ligne de total figée en bas**, toujours visible (même mécanique que les totaux de pied du module Liste).
- Indicateur de fraîcheur par ligne (§ 11.5) : « calculé le … », « recalcul en attente ».
- Double-clic sur une cellule : détail du chiffre (§ 8) ; sur le libellé : ouvre le Détail du chantier.
- Export CSV et impression par le module Édition (source « liste » ou source dédiée).

Le module Liste ne convient pas tel quel : ses sources sont des vues SQL sans paramètre, sans regroupement
hiérarchique ni période. Deux voies (Q24) : une grille propre au module (arbre de la grille du socle, `GrilleArbre`)
avec des vues enregistrées sur le modèle de `vue_liste`, ou une extension du module Liste (sources paramétrées). La
première est plus simple et ne touche pas un module stable.

## 7. Rendu Détail

- Origine : un ordre d'exécution, un chantier, ou un ensemble (affaire, chargé d'affaires) consolidé.
- Liste par **regroupement › nature**, ligne de **total en haut**, colonnes des indicateurs (et heures pour la MO).
- **Bloc de résultats** en bas (§ 4.8), lignes et colonnes configurables par la vue.
- Second temps : graphiques à droite du bloc (évolution de la marge, de la facturation, du budget), qui demandent des
  **photos datées** (§ 10.3) pour être justes.

## 8. Détail d'un chiffre et rapport

- Double-clic sur une cellule (Liste ou Détail) : ✔ Décision, le détail doit **pouvoir s'ouvrir dans une autre
  fenêtre du navigateur**. C'est donc une **page** (`/rentabilite/faits?chantier=&indicateur=&nature=&du=&au=`,
  ouverte par `app.naviguer(url, { nouvelleFenetre })`, comme toute ouverture d'écran du projet), ouverte dans la même
  fenêtre par défaut et dans une nouvelle avec Ctrl ou le bouton ⧉. Elle liste les faits composant le chiffre :
  type de pièce, numéro et indice (lien vers la pièce), date, chantier, ligne (code, libellé), nature, quantité, unité,
  PU, montant PA / PR / PV, **règle appliquée** (ex. « réception valorisée au prix de la commande »,
  « écart de prix de la facture FF2026-00012 »), pour le pointage : salarié, jour, heures, taux, source du taux.
- Sous-totaux par type de pièce et par pièce ; total identique au chiffre cliqué (contrôle affiché).
- ✔ Décision : les pièces annulées et leur avoir d'annulation (qui se compensent) sont comptés mais **masqués par
  défaut** ; un bouton les affiche.
- ✔ Décision : si un type de pièce n'est pas consultable par l'utilisateur, le chiffre global reste affiché, mais pas
  le détail de ces pièces (une ligne « N pièces non consultables : montant »).
- ✔ Décision : les PA et PR peuvent être masqués **dans cette fenêtre seulement**, par droit (voir V65).
- **Rapport complet** (PDF par le module Édition) : l'ensemble des faits d'un chantier par indicateur, plus un
  **rapprochement** avec les pièces : pour chaque pièce, total HT de la pièce = somme de ses faits ventilés + postes
  de pied + lignes écartées (options, mémoire…), écart affiché s'il y en a un.

## 9. Points de vigilance pour des données justes et vérifiables

Numérotés pour pouvoir y répondre. Chaque point dit le risque et la réponse proposée.

### 9.1 Périmètre des pièces

- **V1. Versions remplacées comptées deux fois** (anomalie A1) : une version REMPLACE reste verrouillée.
  → Périmètre unique : verrouillé, `ent_is_reference`, statut ni REMPLACE ni brouillon.
  ✔ Décision : version d'origine traitée comme annulée, hors périmètre (A1).
- **V2. Pièce dévalidée pour correction** : pendant que le nouvel indice est en brouillon, la pièce sort de l'analyse
  (budget qui chute le temps d'un avenant de correction). → Proposition : garder la dernière version validée tant que
  la suivante n'est pas validée (Q2).
- **V3. Annulation par avoir** : la pièce annulée (ANNULE, verrouillée) et son avoir d'annulation se compensent. Soit on
  compte les deux, soit aucun ; jamais l'un sans l'autre. → On compte les deux (traçable : la pièce et son avoir
  apparaissent dans le détail).
  ✔ Décision : on compte les deux ; dans le détail, ils sont masqués par défaut et un bouton les affiche.
- **V4. Avoir d'avancement** (période négative, `ent_nature_avoir` AVANCEMENT) : son total est déjà négatif ; un
  avoir ordinaire est positif et doit être retourné. → Règle du signe par type et nature, testée.
- **V5. Validation par le tiers, rejet** : sans effet sur l'analyse (la pièce reste ENVOYE). Une facture rejetée « à
  annuler » compte jusqu'à son avoir. → Signalée dans le détail (alerte de `v_liste_documents`).
- **V6. Documents intermédiaires et non comptables** (commande intermédiaire, situation, reprise d'avancement, demande
  et reçu d'acompte) : rôle déclaré par type (§ 4.1), jamais déduit du nom.
- **V7. Types désactivés, module facultatif désactivé** (Exécution, Pointage, Planning, Stock, Sous-traitance) :
  l'indicateur concerné reste calculé sur les données présentes mais signalé « module inactif ».
- **V8. Pièces d'une autre famille rattachées au chantier** (E_ENT sur les chantiers de suivi du matériel, ordres E
  sans prix) : écartées par le rôle du type.

### 9.2 Rattachement à l'origine

- **V10. Rattachement modifiable sur une pièce validée** (`PUT /api/structure/documents/{id}/rattachement`) : l'ancien
  **et** le nouveau chantier doivent être recalculés.
- **V11. Chantier par ligne des achats** (`lig_cha_id`, vide = chantier de l'entête) : une facture regroupant des BL de
  plusieurs chantiers se ventile par ligne ; les postes de pied d'une telle facture (port, remise) se répartissent au
  prorata des lignes de chaque chantier (V25).
- **V12. Pièces sans chantier** (rattachées à une affaire, un projet, ou à rien) : ligne « Sans chantier » ; une
  facture de vente sur plusieurs commandes de marchés différents prend le chantier de chaque section.
  ✔ Décision : projets hors de l'analyse : seule reste la ligne « Sans chantier » de l'affaire.
- **V13. Changement d'affaire d'un chantier, de chargé d'affaires** : joint à la lecture (principe 6), donc l'historique
  « par chargé d'affaires » est celui d'aujourd'hui. À accepter ou à historiser (Q17).
  ✔ Décision : chargé d'affaires actuel, pas d'historique pour le moment (à noter dans `TODO.md`).
- **V14. Commandes fournisseur pour un dépôt** (`cha_depot`) : jamais du déboursé de chantier ; le coût arrive par la
  sortie de stock (V45).

### 9.3 Dates

- **V15. Quelle date pour chaque fait** : date du document (saisissable, antidatable), date de validation, date externe
  de la pièce fournisseur (`ent_date_externe` = date comptable des achats), mois des travaux (`ent_mois_revision`),
  date du pointage, date du mouvement. → Proposition : date comptable pour les pièces comptables, date du document
  pour commandes, réceptions et OE (Q3).
- **V16. Rétroactivité** : une pièce validée aujourd'hui avec une date du mois dernier change le passé. Un chiffre
  « au 31/10 » consulté le 02/11 et le 15/11 peut différer. → Afficher la date de calcul, et proposer des **photos**
  mensuelles figées pour l'historique et les graphiques (§ 10.3, Q21).
  ✔ Décision : photos et historique, avec un **versionnage** des calculs : une facture fournisseur reçue en retard se saisit à sa vraie date, et l'utilisateur qui avait contrôlé l'analyse voit ce qui a changé entre son dernier contrôle et maintenant (§ 10.3).
- **V17. Planning non historisé** : on ne sait pas ce qui était planifié à une date passée. L'engagé MO « au 31/10 »
  calculé le 15/11 n'est pas reconstituable. → Engagé MO toujours calculé sur le planning actuel, signalé comme tel
  pour une date passée, ou lu dans les photos.
- **V18. Revalorisation du stock** (PMP corrigé par réévaluation datée, prix provisoire d'une réception jusqu'à sa
  facture, `stk_a_valoriser`) : le coût d'une sortie déjà passée peut changer. → Recalcul du chantier quand un
  mouvement est revalorisé.

### 9.4 Montants, ouvrages, natures

- **V20. Frais annexes** : les lignes des tranches F sont hors total PV (leur prix est ventilé dans les autres lignes)
  mais leur déboursé est réel. L'onglet Analyse les écarte par défaut (`horsTotal`). → Budget PA / PR : les compter ;
  budget PV : ne pas les compter (déjà dans les PV des lignes). À valider avec un cas de test.
  ✔ Décision : PA et PR des lignes de frais annexes pris en compte dans le module (ils ne sont ventilés sur aucune autre ligne) ; l'onglet Analyse du document continue de les écarter.
- **V21. PV d'un ouvrage ventilé par nature** : le PV est porté par l'ouvrage, les natures par les composantes. En mode
  de calcul des ouvrages B (bordereau) ou avec un PV fixe, la somme des PV des composantes ne vaut pas le PV de
  l'ouvrage. → Ventilation au prorata des prix client des feuilles, écart sur la plus forte, somme garantie égale au
  HT de la ligne vendue.
- **V22. Ouvrage sans composante** : devient un élément de nature Prestation à la validation (`PRE`). Son coût est son
  PA (souvent nul) : marge apparente fausse. → Signalé dans le détail (« ouvrage sans déboursé »).
- **V23. Postes de pied** (remise, compte prorata, révision, retenue de garantie, acompte, paiement direct) : HT ou TTC,
  sur la pièce ou la section, en %, montant ou coefficient. → Postes HT en faits distincts par genre (« Postes HT » du
  bloc de résultats) ; postes TTC (retenue, paiement direct) hors analyse HT.
- **V24. Lignes sans nature** : la nature est obligatoire pour valider les lignes de prix, mais pas sur les pièces
  anciennes, les reprises ni les acomptes. → Nature « Non ventilé » visible.
- **V25. Pied d'une pièce d'achat** (remise globale, port, escompte en pied) : non porté par les lignes. → Réparti au
  prorata du HT des lignes (par chantier et nature), ou fait « Non ventilé » (Q13).
  ✔ Décision : pied d'une pièce d'achat en **« Non ventilé »** (frais généraux), comme pour les ventes ; pour l'imputer à un chantier, l'utilisateur saisit des lignes d'une nature de frais avant le bloc de pied. Pièce de plusieurs chantiers : le « Non ventilé » est réparti entre les chantiers au prorata de leurs lignes (A2).
- **V26. Coefficient de prorata et remises par ligne** : inclus dans le `lig_montant_ht` des lignes vendues ; le
  « prix client » des feuilles doit les reprendre exactement (même formule que l'onglet Analyse, en décimal).
- **V27. Écarts d'arrondi** (`lig_is_ecart_arrondi`) : lignes réelles à garder pour que les sommes tombent juste.
- **V28. Changement de regroupement d'une nature** : joint à la lecture ; mais le changement de **nature d'une ligne**
  validée est impossible : pas de risque.

### 9.5 Budget d'exécution

- **V29. Double compte commande + OE** : une ligne de commande reprise dans un OE ne doit compter qu'une fois ; une
  ligne reprise partiellement dans plusieurs OE (répartition) est remplacée par la somme des lignes d'OE et le reste de
  la commande (quantité non encore reprise) ; un OE remplacé ou annulé rend la ligne à la commande.
- **V29b. Ce que modifie le conducteur dans l'OE** : si seul le PR est retouché (coefficient FG), le PA reste celui de la
  vente et la colonne « au PA » ne montre pas la modification. À vérifier dans l'usage de l'OE (Q6).
- **V29c. Plusieurs OE par chantier** (un par marché, un par avenant) : la règle de V29 s'applique ligne par ligne,
  quel que soit l'OE.

### 9.6 Engagé

- **V30. Reste à solder du module Document** : compte les brouillons, donc inutilisable tel quel.
- **V31. Surlivraison** : reçu > commandé → engagé 0, l'excédent au déboursé, alerte.
- **V32. Unité changée entre la commande et la réception** (conversion d'unité d'une ligne liée à un article) : la
  quantité reçue doit être convertie avant d'être retranchée. À vérifier dans `document_ligne_lien` (`lil_qte` dans
  l'unité de la cible).
  ✔ Décision : quantités et prix comme dans les documents ; liens calculés dans l'unité d'origine ; stock dans l'unité de stock par les conversions de l'article ; **garde-fou** (R11) : à la saisie, les unités disponibles (origine, stock, conversions de l'article) sont proposées en priorité ; une autre unité ne s'utilise qu'après avoir ajouté sa conversion dans la fiche article (évolution du module Document et du cœur, lot 0).
- **V33. Commande soldée à la main** : engagé 0 même sans livraison : correct, mais visible dans le détail.
- **V34. Sous-traitance en avancement** : engagé = commande − cumul facturé ; un dépassement de marché ST autorisé
  donne un engagé négatif ramené à 0, alerte.
- **V35. MO planifiée** : tâches OPTION (non confirmées) comptées ou non ; tâches théoriques sans affectation ;
  affectations d'équipe développées en membres ; matériel et sous-traitants affectés (ne pas valoriser un
  sous-traitant déjà engagé par sa commande T). (Q9)
  ✔ Décision : tâches en OPTION et tâches théoriques sans affectation comptées ; matériel hors location compté ; intérim, location et sous-traitance engagés par leurs commandes, jamais par le planning.
- **V36. « Date de dernière saisie »** : par salarié (le plus juste), par chantier ou globale ; un salarié qui n'a pas
  pointé depuis deux semaines garde ses heures planifiées passées en engagé. (Q9)
  ✔ Décision : par salarié pour les tâches affectées, dernière saisie du chantier pour les tâches théoriques.

### 9.7 Déboursé

- **V40. Pointages non valorisés** (`poi_cout` vide tant que la valorisation n'a pas tourné) : déboursé MO sous-évalué.
  → Compteur « non valorisés » visible, taux de repli à décider (Q8).
- **V41. Revalorisation après la paie** (source IMPORT) : change le coût de pointages passés → recalcul.
- **V42. Couche saisie / validée** : `v_pointages_retenus` bascule sur la couche validée quand la semaine est validée ;
  une validation change donc le déboursé. → Recalcul à la validation et à la dévalidation d'une semaine.
- **V43. Intérimaires** : coût par le taux de la mission **et** facture de l'agence d'intérim (pièce d'achat de nature
  MO) : double compte certain si les deux sont retenus (Q10).
  ✔ Décision : option dans les paramètres du Pointage : soit les intérimaires sont valorisés au **taux moyen** de l'intérimaire, soit le pointage affecte les **heures sans valorisation**, le coût venant des factures de l'agence. Par défaut (R10) : heures sans valorisation (coût 0), coût par les factures.
- **V44. Réception puis facture** : compter les deux double le coût ; ne compter que les factures (comme
  `v_cout_chantier`) oublie les livraisons non facturées. → Réception à son prix provisoire + écart de prix à la
  facture (Q13).
- **V45. Stock** : article géré en stock livré sur un chantier qui tient un stock = entrée de stock, pas un coût ;
  livré sur un chantier qui n'en tient pas = consommé à la réception (déjà compté par l'achat, ne pas recompter le
  mouvement) ; sortie d'un dépôt vers le chantier = coût au PMP. Les trois cas doivent être testés.
- **V46. Matériel** : coûts sur le chantier de suivi du matériel, pas sur les chantiers où il travaille ; le
  pointage matériel du terrain (`pointage_materiel`) n'a pas de valeur (Q11).
  ✔ Décision : le pointage du matériel est valorisé sur le **chantier pointé**, au coût moyen horaire saisi dans la fiche matériel (lot 2).
- **V47. Autoliquidation, TVA** : sans effet (HT partout), à vérifier sur les sous-traitants autoliquidés.

### 9.8 Facturé

- **V50. Acomptes** : en mode chiffre d'affaires, la facture d'acompte est facturée puis déduite par un poste de pied
  des factures d'avancement ; en mode trésorerie, le reçu n'est pas une facture. → Le facturé global est juste si on
  compte la facture d'acompte et le poste de déduction ; au détail par nature, l'acompte n'a pas de nature (« Non
  ventilé ») et sa déduction non plus (Q14).
- **V51. Révision des prix** : postes `V<commande>` / `VR<commande>` dans le facturé, absents du budget : le reste à
  facturer devient faux si on compare le facturé HT net au budget HT des lignes. → Comparer lignes à lignes et
  postes à postes, révision présentée à part (Q14).
- **V52. Facture d'avancement en cumul ou en période** : la situation (présentation C) est un cumul non comptable ;
  la facture d'avancement (P) est la période. Seules les pièces P comptent au facturé.
- **V53. Factures sur plusieurs commandes** : une section par commande, le chantier et la nature viennent de chaque
  section et de la ligne de commande liée.
- **V54. Facturé au-delà du budget** (dépassement autorisé) : reste à facturer négatif, affiché comme tel.

### 9.9 Calcul, rafraîchissement, droits

- **V60. Arrondis** : total = somme exacte arrondie ; jamais de `Number` ; une seule fonction d'arrondi.
- **V61. Données en retard** : avec un recalcul asynchrone, l'écran peut montrer un état périmé de quelques secondes.
  → Horodatage et indicateur « en attente » par chantier (§ 11.5).
- **V62. Recalcul partiel incohérent** : recalculer une pièce seule laisse fausses les pièces qui en dépendent (une
  facture d'achat change l'engagé de sa commande ; un OE change le budget d'exécution des lignes de commande). → Unité
  de recalcul = le chantier (§ 11.3).
- **V63. Dérive silencieuse** : un événement oublié (nouvelle source, script SQL) laisse une table fausse. → Recalcul de
  nuit des chantiers ouverts **avec comparaison** à l'existant : tout écart est journalisé et signalé à
  l'administrateur ; c'est le filet de sécurité qui rend l'approche vérifiable.
- **V64. Version des règles** : un changement de règle change les chiffres passés. → Chaque calcul porte la version
  des règles ; une nouvelle version déclenche un recalcul global.
- **V65. Droits** : un chargé d'affaires ne voit que ses chantiers (portée SOI) ; les PA / PR sont soumis au droit de
  voir les prix (décision E2 de l'Exécution) ; le détail d'un chiffre ne doit pas révéler une pièce d'un type non
  consultable. (Q23)
  ✔ Décision : si le module est activé, il montre les données de l'utilisateur (portée SOI) ou toutes (TOUT) ; les PA / PR ne se masquent que dans la fenêtre de détail de l'origine, pas dans les autres modules ; un type de pièce non consultable : valorisation globale affichée, détail masqué.
- **V66. Une base par société** : file de recalcul et planificateur par base, comme les notifications.

## 10. Second temps

### 10.1 Saisie prévisionnelle (Détail)

- Table de saisies : chantier, indicateur (budget, budget d'exécution, engagé, déboursé, facturé), nature, date,
  montant PA / PR / PV, libellé, motif, auteur, **échéance ou pièce attendue**.
- Rendu : colonne ou ligne « Prévisionnel » distincte (jamais mélangée au réel), et indicateurs « réel + prévu ».
- **Risque principal : double compte quand la pièce réelle arrive** (la facture non parvenue est enfin saisie). →
  Une saisie prévisionnelle se **solde** : à la main (« remplacée par FF… »), ou proposée quand une pièce du même
  chantier, nature et tiers arrive ; une saisie échue est signalée.
- Historique des modifications (qui, quand, avant / après).

✔ Réalisation (lot 6, 02/11/2026) : table `rentabilite_prevision` du module (indicateur réel, composante pour un coût,
nature, ordre, date, PA / PR / PV, libellé, motif, tiers, échéance, pièce attendue ; solde : date, pièce, motif, auteur ;
suppression logique ; version) et journal `rentabilite_prevision_journal` (action, avant / après en JSON). Une saisie ni
soldée ni supprimée devient au recalcul du chantier un fait d'indicateur `PREVU_BUDGET`, `PREVU_EXECUTION`,
`PREVU_ENGAGE`, `PREVU_DEBOURSE` ou `PREVU_FACTURE` (source et règle PREVISION), écrit par le module et jamais lu par
les colonnes du réel ; chaque écriture recalcule le chantier. Le facturé n'a que du PV, l'engagé et le déboursé que des
coûts, le PR vide vaut le PA. Solde proposé (jamais automatique) quand une pièce est connue après la saisie avec le même
indicateur et la même composante, la même nature et le même tiers s'ils sont saisis ; solde manuel par une pièce ou un
motif ; réouverture. Saisie échue (échéance passée) : signalée dans le Détail et dans la Liste. Détail : case
« Prévisionnel » (colonnes prévues, restes « avec le prévu ») et panneau des saisies ; bloc de résultats : Prévisionnel à
terminaison = budget PV + budget prévu face au dépensé + dépense prévue + reste du budget d'exécution prévu, compté nul
s'il est dépassé. Droits : nœud `rentabilite/previsions` (créer, modifier, supprimer) sur les chantiers visibles.

### 10.2 Prévisionnel de facturation

- Par chantier (ou marché) et par **mois de facturation** : montant ou % facturable, au global ou au détail des lignes
  du marché (comme une situation : mêmes lignes, même saisie % / quantité / montant).
- Chaque enregistrement crée une **version** (date, auteur), les précédentes restent consultables : comparaison
  « prévu en septembre pour octobre » / « facturé en octobre ».
- Rendu : Liste (chantiers × mois) et Détail sur une période.
- Lien utile avec « Marchés à facturer » (`/marches/a-facturer`) : la prévision du mois peut pré-remplir la situation.

✔ Réalisation (lot 7, 02/11/2026) : prévision par chantier et par mois au global (montant HT ou % du budget PV),
`rentabilite_facturation_version` (une version par enregistrement : auteur, date, commentaire, budget PV du moment ;
jamais modifiée, 409 si une autre a été enregistrée depuis la dernière vue) et `rentabilite_facturation_prevue` (mois,
mode, valeur saisie, montant) ; montant et contrôle répliqués entre `facturation.js` et `Facturation.cs` (jeu
`tests/cas/02_facturation.json`). Détail : facturé du mois (faits FACTURE), prévu, écart, prévu d'une version passée,
cumuls et atterrissage (facturé des mois passés + prévu à partir du mois en cours) ; saisie d'une nouvelle version. Page
`/rentabilite/facturation` : chantiers × mois (prévu de la dernière version, facturé dessous). Droits : nœud
`rentabilite/facturation`. Reste (TODO) : saisie au détail des lignes du marché, pré-remplissage de la situation.

### 10.3 Photos et graphiques

- **Photo** : copie figée des agrégats d'un chantier (indicateurs par nature) à une date, prise chaque fin de mois et à
  la demande, jamais recalculée. Elle rend les graphiques d'évolution justes et le passé consultable tel qu'il était vu.
- Graphiques (module Graphe ou SVG du socle) : évolution de la marge à terminaison, du budget, du facturé cumulé.

✔ Réalisation (lot 8, 02/11/2026) : `GET /api/rentabilite/chantiers/{id}/evolution` rend les agrégats de chaque photo
(faits connus à son calcul, datés jusqu'à sa date ; une par jour) puis d'aujourd'hui ; le client en tire, par les calculs
du Détail et du bloc de résultats (`seriesEvolution`), budget PV, facturé cumulé, dépensé, coût et marge à terminaison
(saisies prévisionnelles comprises). Deux graphiques SVG sans bibliothèque dans le Détail : montants sur un seul axe, et
marge à terminaison à part (jamais deux échelles) ; palette catégorielle validée en clair et en sombre (contraste,
daltonisme), légende, étiquette courte en bout de courbe, réticule et bulle au survol, tableau des valeurs ; sans le
droit des coûts : budget et facturé seuls.

### 10.4 Versionnage : « qu'est-ce qui a changé depuis mon contrôle ? » (ajout du 01/11)

✔ Décision : une pièce en retard (facture fournisseur reçue après coup) se saisit **à sa vraie date** ; l'utilisateur
qui avait contrôlé l'analyse doit voir ce qui a changé entre son contrôle et maintenant.

Proposition :
- Les faits ne sont **jamais effacés** : un recalcul compare les nouveaux faits aux anciens et n'écrit que la
  différence ; un fait disparu est **clos** (calcul de fin), un fait nouveau ou modifié est ouvert par le calcul en
  cours. On sait donc reconstituer les faits « tels qu'ils étaient connus » à n'importe quel calcul.
- **Contrôle** : bouton « ✓ Contrôlé » sur un chantier (ou une sélection), qui enregistre le calcul vu, l'auteur et la
  date (`rentabilite_controle`). À la réouverture : bandeau « 3 changements depuis votre contrôle du 05/11 », colonne
  d'écart par indicateur, et page des faits ajoutés, retirés ou modifiés (pièce, date de la pièce, date de saisie,
  montant avant / après).
- La comparaison marche aussi entre deux photos mensuelles ou entre une photo et aujourd'hui.
- Volume : seules les différences s'écrivent ; une purge des faits clos au-delà d'une durée (par exemple 3 ans) est
  à prévoir.

## 11. Stockage et rafraîchissement (à discuter avant validation)

### 11.1 Ce qui pèse

Les lignes de documents grossissent vite : un devis de démonstration compte plusieurs centaines de lignes avec ses
composantes ; 500 chantiers par an × 40 pièces × 200 lignes donnent 4 millions de lignes par an. La lecture directe
reste rapide pour **un** chantier (quelques dizaines de milliers de lignes, indexées par `lig_ent_id`), mais la Liste
de tous les chantiers sur plusieurs années, avec les liens de transformation, l'engagé et la ventilation des
ouvrages, ne l'est pas.

### 11.2 Options

| Option | Principe | Pour | Contre |
|---|---|---|---|
| **1. Lecture directe** | Vues SQL et requêtes sur les lignes à chaque affichage | Toujours à jour, rien à synchroniser | Lent à l'échelle (Liste) ; règles complexes en SQL (ventilation, engagé) ; double-clic coûteux |
| **2. Table de faits + recalcul par chantier** (recommandée) | Une ligne par fait (§ 3), écrite par le serveur pour un chantier entier ; agrégée à la lecture avec la période | Détail et double-clic immédiats (les faits *sont* le détail) ; période libre (faits datés) ; recalcul ciblé ; vérifiable (rapprochement, comparaison de nuit) | Synchronisation à tenir (événements) ; volume (de l'ordre des lignes vendues et achetées, plus les pointages) |
| **3. Faits + agrégats mensuels** | Option 2 plus un cumul chantier × nature × indicateur × mois | Liste très rapide sur des années | Un niveau de plus à synchroniser ; périodes au jour à recalculer depuis les faits | 
| **4. Vues matérialisées PostgreSQL** | `REFRESH MATERIALIZED VIEW` | Simple | Tout ou rien : pas de rafraîchissement par document ou chantier ; même lenteur au rafraîchissement |
| **5. Calcul dans des triggers** | Le trigger d'une pièce recalcule ses faits | Immédiat | Alourdit chaque validation ; règles en PL/pgSQL en plus du C# ; dépendances entre pièces (V62) ; verrous et interblocages |

**Recommandation** : option 2, avec l'option 3 seulement si la Liste le demande à l'usage. Des triggers **qui ne font
que signaler** (insérer une demande de recalcul), jamais calculer.

### 11.3 Niveaux de rafraîchissement

- **Unité de calcul : le chantier.** Un recalcul calcule tous les faits d'un chantier et n'écrit que la différence
  (§ 10.4) dans une transaction : pas d'état à moitié juste (V62). Un chantier = quelques dizaines de pièces : de l'ordre de la seconde, en requêtes
  ensemblistes.
- **Document** : un événement sur une pièce demande le recalcul de **ses** chantiers (entête, lignes `lig_cha_id`,
  ancien et nouveau rattachement).
- **Affaire, chargé d'affaires** : recalcul de leurs chantiers (manuel).
- **Global** : tous les chantiers (manuel, administrateur ; ou nouvelle version des règles).

### 11.4 Déclenchement

| Mode | Quand | Comment |
|---|---|---|
| Sur événement | Validation, dévalidation, annulation, rattachement modifié, solde d'une ligne, suppression ; validation ou dévalidation d'une semaine de pointage, valorisation ; tâche ou affectation du planning ; mouvement ou revalorisation de stock ; validation d'un OE | Trigger ou point d'accroche qui insère `(chantier, raison, depuis)` dans une **file** ; un service de fond par base la vide toutes les quelques secondes, chantier par chantier, en regroupant les demandes |
| La nuit | Chaque nuit, par base | Recalcul des chantiers ouverts (et de ceux modifiés dans la journée) avec **comparaison** à l'existant (V63) ; recalcul de l'engagé MO qui dépend du jour qui passe ; photo de fin de mois |
| Manuel | Bouton « ⟳ Recalculer » dans la Liste et le Détail | Niveau choisi : chantier, sélection, affaire, chargé d'affaires, tout ; la demande passe devant la file |

Option à arbitrer (Q20) : recalcul **synchrone** du chantier dans la transaction de la validation (chiffre juste dès le
retour, validation plus lente) ou **asynchrone** (validation inchangée, chiffre juste quelques secondes après).
Recommandation : asynchrone, avec le bouton manuel synchrone pour qui veut le chiffre tout de suite.

### 11.5 Fraîcheur visible

Par chantier : date du dernier calcul, version des règles, état (à jour, en attente, en erreur avec le message). En
tête des écrans : « N chantiers en attente de recalcul ». Un chantier en erreur garde ses anciens faits, marqués.

### 11.6 Tables proposées (indicatif)

| Table | Contenu |
|---|---|
| `rentabilite_fait` | `afa_cha_id`, `afa_ordre_id`, `afa_mar_id`, `afa_indicateur`, `afa_composante` (ACHAT, ST, MO, STOCK, POSTE…), `afa_date`, `afa_nat_id`, `afa_qte`, `afa_unite`, `afa_montant_pa`, `afa_montant_pr`, `afa_montant_pv`, `afa_heures`, `afa_source_type` (DOCUMENT, POINTAGE, TACHE, MOUVEMENT, PREVISION), `afa_ent_id`, `afa_lig_id`, `afa_source_id`, `afa_regle`, `afa_calcul_debut`, `afa_calcul_fin` (versionnage, § 10.4) ; index (chantier, indicateur, date) et (chantier, calcul) |
| `rentabilite_controle` | Contrôles : chantier, calcul vu, auteur, date |
| `rentabilite_calcul` | Un calcul par chantier : début, fin, déclencheur, version des règles, état, nombre de faits, écarts trouvés à la comparaison |
| `rentabilite_a_recalculer` | File : chantier, raison, depuis, tentatives |
| `rentabilite_photo` | Agrégats figés par chantier, date, indicateur, nature |
| `rentabilite_prevision`, `rentabilite_prevision_facturation` (+ versions) (second temps) | Saisies prévisionnelles |
| `vue_rentabilite` (ou `vue_liste` avec un contexte « rentabilite », Q24) | Vues enregistrées : mode, niveau d'origine, colonnes, lignes du bloc, PA / PR, arrondi, période par défaut, partage |

## 12. Architecture

- **Module `modules/rentabilite`** (sans métier) : lecture des périodes (`lirePeriode` ↔ `Periodes.cs`, jeu de cas),
  grille arborescente avec total figé et montants anormaux en rouge (sens normal par colonne), vues enregistrées,
  page des faits d'un chiffre (ouvrable dans une nouvelle fenêtre), bloc de résultats, file de recalcul et
  planificateur par base, tables génériques des faits versionnés, contrôles et comparaison ; classe mère
  `SpecialisationRentabilite` (méthode patron) : `ChantiersAsync`, `AxesAsync`, `CalculerAsync(chantier)` → faits,
  `EvenementsAsync`, `PeutVoirAsync`. Textes `rentabilite.*`, icônes `rentabilite_*`, couleurs `--rentabilite-*`.
- **Cœur** : `Btp/RentabiliteBtp.cs` (`SpecialisationRentabiliteBtp` : règles du § 4 sur les pièces BTP, la
  sous-traitance, le pointage, le planning, le stock et le matériel ; rattachement aux ordres du § 5.6), rôle des
  types (§ 4.1), triggers de signalement (`db/2xx_rentabilite.sql`), page `/rentabilite` (Liste et Détail) et
  `/rentabilite/faits`, menus, module facultatif de `module_societe`, nœud de droits `rentabilite` (portées SOI et
  TOUT ; masquage des PA / PR dans la page des faits), textes `rentabilite_btp.*`.
- **Module Document et cœur** (hors module Rentabilité) : situation de production (§ 4.12), garde-fou des unités
  (V32), fonction unique du périmètre (A5).
- **Tests** : un **chantier fictif complet** (commande et avenant, OE qui modifie et ajoute, commandes fournisseur
  livrées en partie, réception puis facture à un autre prix, retour, réservation et sortie de stock, sous-traitance en
  avancement, intérim selon les deux options, pointages validés et non valorisés, matériel pointé, planning avec
  tâches affectées, en option et théoriques, situation, situation de production, facture d'avancement, acompte en
  trésorerie, avoir d'annulation, dévalidation, facture fournisseur saisie en retard) avec les résultats attendus par
  indicateur, nature et ordre, rejoué en C# sur une base de test ; plus le jeu des périodes en JS et en C#.

## 13. Lots proposés

| Lot | Contenu | Dépend de |
|---|---|---|
| 0 | Corrections A1, A2 ; fonction et vue uniques du périmètre ; rôle des types ; garde-fou des unités ; responsable de l'affaire en individu ; chantiers d'une pièce (§ 5.7, si retenu) ; `TODO.md` (historique du chargé d'affaires) | — |
| 1 | Faits versionnés, recalcul par chantier (file, nuit avec comparaison, manuel), Détail d'un chantier et de ses ordres (natures, total en haut), page des faits, rapprochement, montants en rouge | 0 |
| 2 | Liste multi-origine (chargé d'affaires, affaire, chantier, ordre), total figé, période, arrondi, PA / PR, vues enregistrées, droits ; acomptes en trésorerie ; contrôles « ce qui a changé » et photos mensuelles | 1 |
| 3 | Bloc de résultats PV (HT, postes, HT net, marges), heures MO | 1 |
| 4 | Situation de production (module Document et cœur : type, préchargement entre les deux situations, colonnes croisées) ; PCA / FAE dans le module | 3 |
| 5 | Valorisation du matériel (pointage matériel et planning, coût moyen de la fiche) ; option de valorisation des intérimaires | 1 |
| 6 | Saisie prévisionnelle (solde des saisies) — réalisé le 02/11/2026 (§ 10.1) | 3 |
| 7 | Prévisionnel de facturation avec versions — réalisé le 02/11/2026 (§ 10.2) | 3 |
| 8 | Graphiques — réalisé le 02/11/2026 (§ 10.3) | 2 |

## 14. Décisions et questions

### 14.1 Décisions du 01/11/2026

| Sujet | Décision |
|---|---|
| Q1 Nom | Module **Rentabilité** ; l'onglet Analyse du document reste l'aide à la saisie |
| Origine | Sous-niveau **ordre d'exécution** sous le chantier ; **projets hors** de l'analyse |
| Sources | Ajouter la **sous-traitance** comme source et composante à part entière |
| A1 / V1 | À corriger : la version d'origine d'une pièce dévalidée sort du périmètre (traitée comme annulée) |
| A2 / V11 / V25 | À corriger : coûts au chantier de la ligne ; étudier l'affectation de plusieurs chantiers à une pièce pour filtrer |
| A3 | Onglet du document inchangé ; écarts d'arrondi acceptés dans le module (Q22) |
| A4 | Heures seulement (unité h) pour les sommes et l'affichage ; conversion jour → heures à la charge de l'utilisateur |
| A5 | Une fonction et une vue uniques du périmètre |
| Acomptes en trésorerie | Payé par le client, utilisé sur les factures, reste à utiliser : bloc du Détail et colonnes de la Liste |
| Situation de production | Nouveau type de vente (avancement réel), PCA / FAE par période, préchargement entre les deux situations, colonnes croisées |
| Réservations | Dans l'engagé, comme les commandes en attente de livraison |
| Rouge | Montants anormaux en rouge selon le sens normal de la colonne |
| Responsable d'affaire | Individu, comme sur le chantier |
| Détail d'un chiffre | Ouvrable dans une autre fenêtre du navigateur |
| V3 | Pièce annulée et son avoir comptés ; masqués par défaut dans le détail, bouton pour les voir |
| Q17 | Pas d'historique du chargé d'affaires pour le moment (TODO) |
| V16 / Q21 | Photos et historique, avec versionnage pour voir ce qui a changé depuis un contrôle |
| V20 | PA / PR des frais annexes comptés dans le module |
| V25 / Q18 | Pied des achats en « Non ventilé » (frais généraux) ; lignes de nature frais pour imputer au chantier |
| V32 | Quantités et prix des documents ; unité d'origine pour les liens, unité de stock pour le stock ; garde-fou des unités |
| V35 | Tâches en option et théoriques comptées ; matériel hors location compté ; intérim, location, sous-traitance par les commandes |
| V36 / Q9 | Dernière saisie par salarié pour les tâches affectées, du chantier pour les tâches théoriques |
| V43 / Q10 | Option du Pointage : taux moyen par intérimaire, ou heures sans valorisation (coût par les factures) |
| V46 / Q11 | Pointage matériel valorisé sur le chantier pointé au coût moyen de la fiche (lot 5) |
| V65 / Q23 | Portée SOI ou TOUT ; PA / PR masquables dans la page des faits seulement ; type non consultable : global sans détail |
| Q12 | Réservations dans l'engagé ; sorties au PMP |
| Q15 | Réalisé = somme des PV HT facturés de chaque facture, après déduction du précédent |

### 14.2 Questions de la deuxième version

Toutes tranchées le 01/11/2026 à 15:00 : propositions retenues, sauf R10 et R11 (colonne Décision).

| # | Question | Décision |
|---|---|---|
| R1 | A1 : la version d'origine d'une pièce dévalidée doit-elle prendre réellement le statut ANNULE, ou garder REMPLACE (consultation de l'ancienne version) en étant exclue partout par la fonction unique du périmètre ? | Garder REMPLACE, exclu partout (ANNULE reste réservé à l'annulation par avoir) |
| Q2 | Pièce dévalidée en cours de correction : on garde sa dernière version validée jusqu'à la validation de la suivante ? | Oui |
| Q3 | Date retenue : date comptable (date externe pour les achats) pour les pièces comptables, date du document pour commandes, réceptions et OE, date du pointage, date du mouvement ? | Oui |
| Q4 | En mode « du … au » : budget = variation sur la période, engagé = état à la fin, déboursé et facturé = cumul de la période, restes = calculés à la fin ? | Oui |
| Q5 | Une facture de vente sans commande d'origine entre-t-elle au budget ? | Oui |
| Q6 | Budget d'exécution : PV nul pour une ligne ajoutée par l'OE ; colonne facultative « budget de référence » ; l'OE modifie-t-il le PA ou seulement le PR ? | PV nul ; colonne oui ; à confirmer dans l'usage |
| Q7 | PR des coûts réels : coefficient FG par nature paramétré par la société (daté), ou coefficient moyen du budget du chantier pour la même nature ? | Coefficient par nature, daté |
| Q8 | Pointage non valorisé : taux de repli (moyen du service) ou zéro signalé ? | Taux moyen du service, signalé |
| R2 | Tâches théoriques sans affectation : à quel taux les valoriser ? | Taux horaire moyen par service (celui de la tâche), paramétré |
| R3 | Niveau « ordre » : l'OE seulement (les autres ordres E remontent à leur OE), ou chaque ordre E ? | OE seulement, les autres ordres en détail |
| R4 | Achats saisis sans ordre : permettre de choisir l'ordre sur la ligne (comme `lig_cha_id`) ? | Oui, achats et sous-traitance seulement |
| R5 | Chantiers d'une pièce (§ 5.7) : table `document_chantier` tenue par trigger, l'entête gardant un chantier principal ? | Oui |
| Q13 | Achats : réception au prix de la commande, puis écart de prix à la facture (deux faits datés) ? | Oui |
| Q14 | Facturé : facture d'acompte (mode CA) et sa déduction comptées ; révision des prix présentée à part, hors du reste à facturer des lignes ? | Oui ; oui |
| R6 | Acomptes en trésorerie : « payé par le client » lu dans le module Règlements quand il est actif, sinon le montant des reçus d'acompte ? | Oui |
| R7 | Situation de production : une par marché et par mois ; mois sans situation de production : on reprend le dernier cumul connu ? | Oui |
| R8 | Situation de production : le préchargement copie le cumul de l'autre situation du même mois (sinon la dernière connue), en brouillon modifiable ? | Oui |
| Q16 | Marges : PV = HT des lignes (prix client) pour les deux marges ; coût en face de chaque ligne du bloc comme au § 4.8 ? | Oui ; oui |
| Q17 | Marché en filtre et en regroupement du Détail ? | Oui |
| R9 | Coût moyen horaire du matériel : sur la fiche, avec repli sur le type de matériel ; non daté pour commencer ? | Oui |
| R10 | Option des intérimaires : par défaut « taux moyen par intérimaire » ? | **Non** : par défaut, pointages des intérimaires valorisés à 0 (heures seules), le coût vient des factures de l'agence |
| R11 | Garde-fou des unités : refus à la validation, avertissement dès la saisie ? | **Autrement** : à la saisie, on propose en priorité les unités disponibles (origine, stock, conversions de l'article) ; pour une autre unité, l'utilisateur ajoute la conversion dans la fiche article, puis l'utilise |
| R12 | Responsable de l'affaire : reprise du texte actuel par rapprochement du nom avec les individus de notre société, les non trouvés laissés vides et listés ? | Oui |
| Q19 | Stockage : table de faits recalculée par chantier entier (différences seulement), triggers qui signalent seulement, file vidée en continu, recalcul de nuit avec comparaison, boutons manuels à tous les niveaux ? | Oui |
| Q20 | Recalcul asynchrone (quelques secondes après la validation), bouton manuel synchrone ? | Oui |
| Q24 | Vues enregistrées : table propre au module, sur le modèle de `vue_liste` ? | Oui |
| Q25 | Chantiers internes, affaires de gestion, de matériel, de stock, de dotations, SAV : exclus par défaut, affichables par un filtre ? | Oui |
| Q26 | Corriger A1 et A2 tout de suite (lot 0), avant le module ? | Oui |
