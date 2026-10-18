# Ventilation des frais annexes – analyse fonctionnelle

> Document de travail à compléter. Pour chaque question : la **proposition** est celle de l'analyse initiale ;
> renseigner **Décision** (« ok », correction ou précision). Les sections marquées _à compléter_ attendent des
> exemples ou des règles.

## 0. Contexte et existant

- Type de prix **F (frais annexes)** : ligne ou tranche (hérité par toute sa descendance), hors des totaux, toujours
  non imprimée (`modules/document/db/014`, `estFraisAnnexes` dans les deux `MoteurDocument`).
- Lignes de pied **« frais annexe ventilé »** (`lig_pied_is_fa`, saisies en montant seulement).
- Ventilation actuelle (`MoteurDevisBtp.apresPrix`, JS / C#) : **un seul coefficient global** `ent_coef_fa`, calculé sur
  toutes les lignes vendues du document. Les lignes à PV affiché fixe gardent leur PV affiché et **absorbent** les
  frais dans leur PV (équation du second degré). Les options et variantes reçoivent le même coefficient sans entrer
  dans la base. Les lignes F gardent leur prix (coefficient 1). Jeux de cas : `07a`, `07b`, `07c`, `13`, `18`.
- Onglet Analyse : `client/src/app/analyse-calcul.js` (éléments regroupés par code et libellé, natures) et
  `analyse-coefs.js` (interface).

## 1. Objectif

_À compléter : besoin métier en quelques lignes (pourquoi ventiler par portée, qui saisit les clés, à quel moment du
chiffrage)._
Le besion des frais anexe est de pouvoir ventiller un ensemble de coût fixe (Installation de chantier, déplacement, location, ...) sans créer de ligne visible au client et sans a voir à créer manuellement dans chaque ouvrage une ou plusieurs lignes de composante avec des quantités ridiculement petite. Donc on creer une tranche on ajoute tous ce qui est nécessaire, on complete la totalité du devis et on ventile les frais annexes à la fin du chiffrage. Le problème le plus courant avec les frais annexe c'est le versionning de devis suite à une demande de modification du client, le client à déjç une version du premier devis et veut ajouter une supprimer un poste, pour garder une certaine logique les prix des éléments qui ne sont pas modifié doivents rester les mêmes entre les deux versions. Dans le cas d'ajout d'élément au devis se n'est pas bloquant on peut juste ajouter un peu plus de frais sur les nouveau élément (c'est pourquoi on ne bloque pas à 100% de ventilation) mais si on supprime des postes il faut que le chifreur décide de ce qu'il veut faire s'il absorbe le cout des frais non ventilé ou s'il les repercute sur d'autre lignes.
Attention les frais annexes sont forcément regrouper dans une tranche de frais anexe on ne laisse pas des lignes de frais seule dans le devis et on ne peut pas mettre de frais annexe dans le pied.
Pour ne pas embrouiller la nuérotation les lignes de frais n'auront pas de numérotation.

## 2. Vocabulaire

| Terme | Définition proposée | Décision |
|---|---|---|
| Unité de frais | Ensemble de frais ventilé d'un bloc : une tranche F (somme de ses lignes), « frais annexe ventilé ». | |
| Portée | Ensemble des lignes de prix (pas les tranches ou sous totaux) peuvent recevoir une unité de frais à l'exeption des lignes de pied. | |
| Ligne réceptrice | Ligne de prix vendue (hors F, PV affiché fixe), avec une option pour ventiller sur les options et pour mémoire, dans la portée. | |
| Clé de ventilation | Règle saisie (% ou montant) qui oriente une part de l'unité de frais vers une cible. | |
| Montant prévu / ventilé / écart | Montant de l'unité de frais / somme des parts reçues / différence. | |

## 3. Portée de la ventilation

### Q1. Portée d'une unité de frais

**Proposition** : les frais sont ventilés sur les lignes vendues de la **tranche parente non F la plus proche**.

| Emplacement des frais | Portée |
|---|---|
| Tranche F dans le titre A | Lignes vendues de A (sous-titres compris) |
| Tranche F directement sous la section | Toute la section |

**Décision** : OK pas de frais dans le pied et forcemet dans la section ou les tranches

### Q2. Cumul de plusieurs portées

**Proposition** : une ligne peut recevoir les frais du titre A.1, du titre A, et de la section. Chaque unité est
ventilée indépendamment et la ligne reçoit **la somme de ses parts** (pas de coefficients multipliés en cascade).

**Décision** : OK

### Q3. Unité ventilée

**Proposition** : la tranche F entière est une unité.

**Décision** : OK Une unité de frais est forcément une tranche un ligne seule ne peut pas êtres de type frais annexe

### Exemple de portées combinées

_À compléter : arbre type (section, titres, tranches F) avec les montants attendus par ligne._

```
SECTION
├─ Installation de chantier (F)        1 000      → portée : toute la section
├─ A Gros œuvre
│  ├─ Frais de levage (F)                300      → portée : A
│  ├─ A.1 …
│  └─ A.2 …
└─ B Menuiseries
└─ Frais de déplacement (FA)         200      → portée : toute la section
```

## 4. Calcul de la répartition

### Q4. Base de répartition par défaut (sans clé)

**Proposition** : au prorata du montant HT hors frais (PV × quantité vendue) des lignes réceptrices de la portée.

**Décision** : OK

### Q5. Clés partielles (total des clés < 100 %)

- a) le reste est réparti automatiquement au prorata (Q4) sur les lignes réceptrices sans clé ;
- b) le reste n'est pas ventilé (écart affiché).

**Proposition** : a).

**Décision** : b) par défaut mais on ajoute un bouton pour que l'utilisateur puisse forcé  à son envie la a). Les écarts ne sont pas bloquant pour la validation.

### Q6. Clés au-delà de 100 %

**Proposition** : aucune limite ; 110 % ventile 110 % (le montant HT augmente d'autant) ; affichage prévu / ventilé /
écart ; avertissement non bloquant, y compris à la validation.

**Décision** : Ok

### Q7. Priorité entre les modes de saisie

**Proposition** : ligne (à la main) > élément (onglet Analyse) > nature d'une tranche > nature globale > prorata par
défaut. Une ligne couverte par une clé plus précise sort de la répartition des clés moins précises.

**Décision** : ok

### Q8. Sens du % et du montant

**Proposition** : % = pourcentage du montant de l'unité de frais, recalculé à chaque changement des frais ; montant =
valeur figée, inchangée si les frais changent.

**Décision** : Ok le recalcul est forcé au moment de l'enregistrement par le backoffice, comme pour le reste si le montant du backoffice diverge de celui du navigateur, on laisse la descision à la l'utilisateur.

### Q9. Répartition à l'intérieur d'une clé (nature, élément)

**Proposition** : au prorata du montant HT hors frais des lignes visées.

**Décision** : Ok

### Q10. Nature « à la tranche » ou « au global »

Interprétations possibles :

- a) « tranche » = clé de nature valable pour une unité de frais donnée ; « global » = valable pour toutes les unités
  du document ;
- b) « global » = la nature sur toute la portée de l'unité ; « tranche » = la nature limitée à une sous-tranche de
  cette portée.

**Décision** : a)

### Q19. Arrondis

**Proposition** : les parts sont arrondies au montant ; l'écart d'arrondi est absorbé par les plus fortes lignes
(comme dans l'onglet Analyse).

**Décision** : Ok

### Formules

_À compléter / valider._

- Part reçue par la ligne `l` pour l'unité `u` : `part(u, l)`.
- Coefficient de frais de la ligne : `lig_coef_fa = 1 + Σ part(u, l) / (PV × qté vendue)`.
- PV affiché = PV × `lig_coef_fa` × prorata, puis remise (ordre actuel conservé).
- Que devient `ent_coef_fa` (moyenne pondérée, supprimé, informatif) ? **Décision** : moyenne pondérée pour information
Ok pour tous

## 5. Lignes exclues ou particulières

### Q11. PV affiché fixe (« avec frais annexes »)

**Proposition** : ligne exclue de la ventilation, garde son PV affiché, coefficient 1 ; une clé qui la vise est ignorée
et signalée. (Changement par rapport à l'existant, où elle absorbe les frais.)

**Décision** : Ok

### Q12. PV fixe (« avant frais annexes et remise »)

**Proposition** : la ligne reçoit des frais (seul le PV avant frais est bloqué).

**Décision** : OK

### Q13. Ouvrages et composantes

**Proposition** : la part reçue par l'ouvrage (ligne de prix) s'applique à ses composantes avec le même coefficient ;
en mode bordereau (B), elle reste sur l'ouvrage seul.

**Décision** : Ok

### Q14. Options et variantes (quand l'option est cochée)

- a) elles entrent dans la base : les lignes vendues reçoivent moins ;
- b) elles reçoivent le coefficient des lignes vendues de leur portée, sans réduire leur part (prix de l'option
  « comme si elle était vendue »).

Option décochée : aucun frais. Lignes pour mémoire : jamais de frais.

**Proposition** : b).

**Décision** : b) par défaut avec une option pour l'utilisateur sur le document pour choisir a) ou b).

### Q15. Mémorisation de l'option « ventiler sur options et variantes »

**Proposition** : enregistrée avec le document (`ent_fa_options`), prise en compte par les deux moteurs (et non un
simple filtre du rapport).

**Décision** : OK

### Q22. Frais du pied

**Proposition** : portée « document », mêmes clés possibles, saisie en montant seulement conservée.

**Décision** : Pas de frais de pied

### Autres cas

_À compléter : frais négatifs (remise globale ventilée ?), portée sans ligne réceptrice (erreur ? report sur la portée
parente ?), lignes en erreur de calcul, remise de ligne, coefficient de prorata._
Il n'y aura pas de frais annexe négatif.
S'il n'y pas de ligne pour récéptionner les frais alors on affiche l'erreur et on ne fait rien. Mais ce n'est pas bloquant pour la validation.
Idem pour les lignes en erreurs.
Pas de sujet sur les remise de ligne, coefficient de prorata.

## 6. Saisie des clés

| Mode | Où | Cible | Unité de frais visée | Décision |
|---|---|---|---|---|
| Par nature | Onglet Analyse | Nature, dans une tranche ou au global | une unité | |
| Par élément | Onglet Analyse | Élément (code + libellé de l'analyse) | une unité | |
| À la main | Détail de la ligne | Ligne | une unité | |

### Q20. Saisie à la main dans les lignes

**Proposition** : section « Frais annexes reçus » du détail de la ligne (pour chaque unité de frais de sa portée : % ou
montant) ; colonnes facultatives « FA reçus » (montant) et « Coef. FA » dans la grille.

**Décision** : ok

### Paramètres par défaut

_À compléter : des clés par nature peuvent-elles être paramétrées hors document (par type de document, par
bibliothèque) puis reprises à la création ?_
Non c'est propre à chaque document, pas de valeur par défaut.

## 7. Rapport de l'onglet Analyse

### Q21. Contenu du rapport

**Proposition** :

- par unité de frais : portée, montant prévu, ventilé, écart, % ventilé ;
- détail par nature, par élément et par tranche, déroulable jusqu'à la ligne ;
- case « ventiler aussi sur les options et variantes » ;
- saisie des clés de nature et d'élément dans le rapport ;
- avertissements : clés orphelines, lignes à PV affiché fixe visées, portées sans ligne réceptrice.

**Décision** : OK

_À compléter : maquette (colonnes, regroupements), export, impression._
Ok pour la Maquette, pour les exports et impression on vera au moment de la création des modules (à garder en mémoire)

## 8. Données et traçabilité

### Q16. Tables

**Proposition** (cœur, `db/167`, rejouable) :

| Table | Rôle | Colonnes principales |
|---|---|---|
| `ventilation_frais` | Clés saisies | `vfr_id`, `vfr_ent_id`, unité de frais (`vfr_source_lig_id`), cible (`vfr_cible` LIGNE / ELEMENT / NATURE, `vfr_lig_id`, `vfr_element`, `vfr_nat_id`, `vfr_tranche_id`), `vfr_mode` P / M, `vfr_valeur` |
| `ventilation_frais_ligne` | Résultat calculé (traçabilité) | `vfl_ent_id`, `vfl_source_lig_id`, `vfl_lig_id`, `vfl_montant`, `vfl_vfr_id` (clé appliquée, nulle = prorata) |

Clés et résultat font partie de l'entrée et de la sortie des deux moteurs (`DocumentCompletBtp`), avec écarts
client / serveur contrôlés comme les autres montants.

**Décision** : OK

### Q17. Copie, indice, transformation

**Proposition** : clés reportées à la copie et au nouvel indice ; à la transformation, seul le détail calculé (les prix
sont déjà calculés).

**Décision** : Pour la copie et l'ajout d'une revision les les clés sont aussi copier pour pouvoir modifier chaques documents de manière autonome. pour les versions numérique il faudrai conserver les clés pour faire une récupération d'une version précédente.
à la transformation, seul le détail calculé (les prix sont déjà calculés).

### Q18. Clés orphelines

**Proposition** : conservées, ignorées, signalées dans le rapport (ligne supprimée, nature ou élément absent de la
portée, ligne sortie de la portée après un déplacement).

**Décision** : signalées dans le rapport et supprimer par l'utilisateur ou moment de la validation.

### Historique

_À compléter : faut-il historiser les changements de clés (qui, quand) au-delà de l'instantané du document ?_
oui pour garder une trace.

## 9. Contrôles et messages

| Code | Cas | Bloquant ? | Décision |
|---|---|---|---|
| `FA_ECART` | Ventilé ≠ prévu (clés < ou > 100 %) | Non | | OK
| `FA_SANS_RECEPTRICE` | Portée sans ligne réceptrice | non | | Ok
| `FA_CLE_ORPHELINE` | Clé dont la cible n'existe plus ou est hors portée | Non | | Ok
| `FA_CLE_BLOQUEE` | Clé visant une ligne à PV affiché fixe | Non | | Ok

## 10. Jeux de cas à écrire (parité JS / C#)

_À compléter avec les montants attendus._

- [ ] Frais dans un titre : ventilation limitée au titre.
- [ ] Frais dans la section + frais dans un titre : cumul sur une même ligne.
- [ ] Clés par nature (tranche et global), par élément, à la main : priorités.
- [ ] Clés < 100 % (reste au prorata) et > 100 % (110 %).
- [ ] Clé en montant inchangée quand les frais changent ; clé en % recalculée.
- [ ] Ligne à PV affiché fixe exclue ; PV fixe receveur.
- [ ] Ouvrage (composantes) et mode bordereau.
- [ ] Options et variantes avec et sans l'option.
- [ ] Arrondis absorbés par les plus fortes lignes.

## 11. Hors périmètre / plus tard

_À compléter._

## 12. Décisions prises

| Date | Point | Décision |
|---|---|---|
| | | |

## 13. Points restant à trancher (relecture du 16/10/2026)

> Contradictions ou trous relevés à la relecture des décisions ci-dessus. Même principe : **Proposition**, puis
> **Décision** à renseigner.

### 13.1 Versions du devis : garder les prix des lignes inchangées

L'objectif (§ 1) demande que les lignes non modifiées gardent leur prix d'une version à l'autre. Or la ventilation par
défaut au prorata (Q4) se recalcule : si on supprime un poste, sa part est redistribuée sur les autres lignes, dont
les prix changent.

**Proposition** : « figer la ventilation ». À la validation (ou par un bouton), la répartition calculée est convertie
en clés de ligne en montant. Le nouvel indice reprend ces clés. Une ligne supprimée laisse un écart (`FA_ECART`), une
ligne ajoutée ne reçoit rien. Le chiffreur décide ensuite (absorber l'écart ou le répartir, cf. 13.3).

**Décision** : OK.

### 13.2 Sans aucune clé : prorata ou rien ?

Q4 (prorata quand il n'y a pas de clé) et Q5 b) (le reste n'est pas ventilé) se contredisent quand une unité n'a
encore aucune clé.

**Proposition** : une unité sans aucune clé est ventilée à 100 % au prorata (Q4). Dès qu'elle a au moins une clé,
seules les clés s'appliquent et le reste devient un écart (Q5 b).

**Décision** : OK.

### 13.3 Bouton « répartir le reste » (Q5)

Deux formes possibles :

- a) action ponctuelle : le reste est réparti au prorata et **écrit en clés de ligne** (montant), puis tout est figé ;
- b) réglage permanent de l'unité (« reste au prorata »), recalculé à chaque modification.

**Proposition** : a). C'est cohérent avec 13.1, et rien ne bouge sans action du chiffreur.

**Décision** : OK (a).

### 13.4 Clé en montant : total de la ligne ou par unité ?

Si la quantité d'une ligne change, une part totale figée modifie son PV unitaire.

**Proposition** : montant total de la ligne. Une quantité modifiée, c'est une ligne modifiée : le chiffreur revoit sa
part.

**Décision** : Par unité : la clé en montant est une part **par unité de quantité** (la part totale suit la quantité).

### 13.5 Type F réservé aux tranches

Q3 : une ligne seule ne peut pas être de type F. Aujourd'hui, le choix « Frais annexes » est proposé sur les lignes de
prix.

**Proposition** :
- « Frais annexes » est proposé seulement sur un titre, ni sur une section ni sur une ligne. Les lignes de la tranche
  l'héritent.
- Une ligne F hors tranche F déclenche une erreur `FA_HORS_TRANCHE` (non bloquante ? bloquante ?).
- Une tranche F incluse dans une autre tranche F ne forme qu'une seule unité : celle de la tranche F la plus haute.

**Décision** : OK.

### 13.6 Tranche F à la racine sans section

« Forcément dans la section ou les tranches » : que se passe-t-il dans un document sans section ?

**Proposition** : une tranche F à la racine a pour portée tout le corps du document (comme une section implicite).

**Décision** : Pas de tranche F hors section : une tranche F doit être dans une section (erreur non bloquante `FA_HORS_SECTION` sinon, rien n'est ventilé).

### 13.7 Suppression des frais de pied (`lig_pied_is_fa`)

Q22 : plus de frais de pied. Or la fonction existe (colonne, case du détail, jeux `07a`, `07b`, `07c`, `13`).

**Proposition** :
- La case « frais annexe ventilé » est retirée des lignes de pied et la colonne est conservée en base.
- Au chargement d'un document existant, une ligne de pied FA est convertie en tranche F en fin de section.
- Les jeux de cas sont réécrits en tranches F.

**Décision** : OK.

### 13.8 Numérotation des tranches F

« Les lignes de frais n'auront pas de numérotation. »

**Proposition** : la tranche F elle-même n'est pas numérotée non plus, et les titres suivants ne sont pas décalés
(A, B… comme si elle n'existait pas).

**Décision** : Oui : la tranche F n'est jamais éditée pour le client.

### 13.9 Montant affiché sur la tranche F

Aujourd'hui, une tranche F affiche 0 dans la grille et dans le plan (hors total).

**Proposition** : la tranche F affiche son montant prévu, en italique hors total, avec dans le plan la demi-pastille et
l'indication « ventilé x % ».

**Décision** : OK, montant en italique.

### 13.10 Options, variantes, pour mémoire

Le vocabulaire (§ 2) parle d'une option « ventiler sur les options **et pour mémoire** », alors que Q14 dit « pour
mémoire : jamais de frais ». De plus, Q14 prévoit le choix a) / b) par document.

**Proposition** : deux réglages du document :
1. lignes concernées : aucune, options et variantes, ou options, variantes et pour mémoire ;
2. mode : b) même coefficient sans réduire la part des lignes vendues (par défaut), ou a) dans la base de répartition.

En mode b), une option reçoit, pour chaque unité, `base option × (ventilé de l'unité / base vendue de l'unité)`.

**Décision** : OK.

### 13.11 Clé d'élément sur une composante d'ouvrage

Les éléments de l'onglet Analyse sont souvent des composantes. Or Q13 dit « même coefficient pour toutes les
composantes de l'ouvrage ».

**Proposition** : une clé d'élément visant une composante est reportée sur la ligne de prix qui la contient
(l'ouvrage), au prorata du montant de la composante dans l'ouvrage. Les composantes gardent un coefficient commun.

**Décision** : OK.

### 13.12 Montant ventilé mesuré avant ou après arrondi du PV

Le PV affiché est arrondi à la précision du PV : `qté × PV affiché` diffère légèrement de `montant hors frais + part`.

**Proposition** : le « ventilé » du rapport est la différence réelle des montants HT (avant / après frais). Le petit
résidu d'arrondi du PV apparaît dans l'écart, non bloquant.

**Décision** : OK.

### 13.13 Clés orphelines supprimées à la validation (Q18)

**Proposition** : à la validation, une fenêtre liste les clés orphelines. Elles sont supprimées après confirmation, et
la suppression est tracée dans l'historique.

**Décision** : OK à la validation ; rien à l'enregistrement (les clés orphelines restent signalées).

### 13.14 Historique des clés

« Oui pour garder une trace » : deux niveaux possibles.

- a) les clés font partie de l'instantané du document (`his_instantane`), comme les lignes, ce qui permet aussi de
  récupérer une version précédente (Q17) ;
- b) un journal dédié par clé (qui, quand, avant / après).

**Proposition** : a). Faut-il aussi b) ? Et la récupération d'une version précédente existe-t-elle à l'écran, ou
est-elle à créer ?

**Décision** : a) : clés dans l'instantané du document. L'écran de récupération d'une version précédente sera fait plus tard (TACHES.md).

### 13.15 Transformation : que devient la tranche F ?

Une commande ou une facture reprend les PV avec frais.

**Proposition** : la tranche F n'est pas transformée (ni quantité à livrer ni à facturer). Le détail
`ventilation_frais_ligne` est copié pour la traçabilité.

**Décision** : Les tranches F sont conservées à la transformation (toujours hors total et non éditées) ; détail `ventilation_frais_ligne` copié.

### 13.16 Bibliothèque et import (reformulée)

Trois situations où une ligne ou une tranche passe du devis vers une autre fonction du logiciel :

**a) Bouton « 📤 Vers la bibliothèque » sur une ligne qui a reçu des frais.**
Exemple : un ouvrage « Dalle béton » a un PV de 100 €. Avec ses frais reçus, son PV affiché est de 108 €. Aujourd'hui,
l'envoi impose les coefficients de la ligne à l'élément de la bibliothèque. Quel prix l'élément doit-il garder ?
- 100 € (hors frais) : les frais sont propres à ce devis ; dans un autre devis, la dalle recevra d'autres frais.
- 108 € (avec frais) : les frais sont intégrés une fois pour toutes au prix de bibliothèque.

**Proposition** : 100 € (hors frais).

**Décision** : Les frais annexes ventilés ne vont jamais dans la bibliothèque. À l'enregistrement d'un élément en bibliothèque, on envoie les PA ; les coefficients FG et bénéfice sont ceux par défaut de la base (l'utilisateur reste libre de les forcer dans la bibliothèque). Seule exception : une ligne à **PV fixe (avant frais annexes)** envoie son PV et ses coefficients.

> Écart avec l'existant : `valeursDepuisLigne` (`client/src/app/bibliotheque/envoi.js`) impose aujourd'hui les coefficients FG et bénéfice de la ligne à l'élément (`coef_*_impose: true`) et n'envoie le PV fixe que pour un article. À modifier.

**b) Envoi d'une tranche contenant une tranche F vers la bibliothèque (type ENSEMBLE), puis insertion de cet ensemble
dans un autre devis.**
Exemple : la tranche « Salle de bains » contient une tranche F « Évacuation des gravats ». À l'insertion de l'ensemble
dans un autre devis, la tranche F devient-elle une unité de frais de ce devis, ventilée sur la tranche « Salle de
bains » insérée ?

**Proposition** : oui, la tranche F est conservée et devient une unité de frais (sans clé, donc au prorata, cf. 13.2).

**Décision** : Oui : la tranche F insérée devient une unité de frais du devis (sans clé, donc au prorata).

**c) Import d'un devis OptimBTP.**
Dans OptimBTP, des lignes marquées « globalisation » (IsFA) jouent le rôle de frais annexes. Aujourd'hui, l'import les
répartit dans le déboursé des autres lignes. Faut-il plutôt les importer en tranche F ventilée ?

**Proposition** : rien ne change pour l'instant (à revoir plus tard, § 11).

**Décision** : Rien ne change pour l'instant ; à revoir avec les imports.

### 13.17 Plus tard (à reporter au § 11)

- Export et impression du rapport de ventilation : au moment des modules Export / Impression.
- Paramétrage de clés par défaut : écarté (propre à chaque document).
- Import OptimBTP : globalisations (IsFA) en tranche F, à revoir avec les imports.

**Analyse close le 16/10/2026 : tous les points sont tranchés.**

## 14. Réalisation (16/10/2026)

- Moteurs : `ventilerFraisAnnexes` (`client/src/calcul/moteur-btp.js`) ↔ `VentilerFraisAnnexes` (`MoteurDevisBtp.cs`) ;
  résultat : `ventilations` (clés inchangées), `ventilations_lignes` (détail : tranche, ligne, montant, clé), `frais_annexes`
  (bilan : prévu, ventilé, ventilé réel, écart). Jeux : `07a`, `07b`, `07c`, `13`, `18` (réécrits en tranches F),
  `19` portées cumulées, `20` priorités des clés et orpheline, `21a`/`21b`/`21c` options (modes C et B, clé à 110 %),
  `22` bordereau, `23` contrôles (hors section, ligne isolée, frais de pied).
- Précisions : une clé en montant vaut par unité de quantité pour une ligne, en total pour un élément ou une nature ;
  les clés en % d'une tranche sont arrondies ensemble (100 % = le prévu exact) ; une clé d'élément vise le code et le
  libellé saisi sans balises (`cleElementVentilation`) ; un élément ou une nature visé dans un ouvrage reporte sa part
  sur l'ouvrage au prorata du montant de ses feuilles (quantité totale × PV) ; en mode C, une clé de ligne sur une
  option s'applique directement (sans entrer dans le ventilé).
- Données : `db/167`, `SpecialisationBtp` (écriture, copie et indice : clés reportées, orphelines écartées ;
  transformation et validation : ventilation figée en clés de ligne, `FigerVentilation`).
- Écrans : détail de la ligne (part reçue et clé de chaque tranche de sa portée ; sur une tranche F : bilan, Répartir
  le reste, Figer, Revenir au prorata), colonnes « Coef. FA » et « FA reçus », plan (« ventilé x % »), onglet Analyse
  vue « Frais annexes » (réglages `ent_fa_lignes` / `ent_fa_mode`, messages, par nature, élément, tranche), confirmation
  des clés orphelines à la validation.
- Pas de conversion des anciens frais de pied : aucune base n'en contenait (signalés par `FA_PIED` s'il en apparaît).
