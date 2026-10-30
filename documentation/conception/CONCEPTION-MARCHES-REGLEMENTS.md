# Gestion du marché, postes globaux, acomptes, échéances et règlements – analyse fonctionnelle

> Document de travail : analyse, aucun développement engagé. Même principe que `CONCEPTION-ACHATS-MARCHES.md` : pour
> chaque question, la **Proposition** est celle de l'analyse, renseigner **Décision**. Récapitulatif au § 10.

## 0. Demande (reprise fidèle)

- **Onglet de gestion du marché** dans la fiche : liste des commandes affectées au marché (marché et TS), liste des
  situations, liste des factures, tableau récapitulatif des montants prévus, facturés et de l'avancement. On peut créer
  et modifier les situations et les factures.
- **Postes de pied globaux** du marché : retenue de garantie, retenue de compte prorata, déduction d'acomptes, paiement
  direct des sous-traitants, autres.
- **Acomptes** : demande, puis reçu ou facture d'acompte selon le paramétrage global de la société ; gérés depuis le
  marché. Déduction de l'acompte au choix : sur la première facture, sur la dernière, ou de façon linéaire sur le
  montant du marché.
- **Module Règlements** : suivi des règlements des factures, des avoirs et des retenues de garantie cautionnées ;
  pointage des règlements et des cautions pour calculer le reste à payer des factures.
- **Échéances** dans le module Document : calcul de l'échéancier, avec le mode général des ventes ou des achats par
  défaut, ou celui du tiers ; multi-échéances, avec les retenues de garantie et leurs libérations.

## 1. Existant

- **Fiche marché** : encart « Commande » et « Avenants » (`marche_document` : rôle BASE / AVENANT, rang), montant
  calculé (commandes validées), option « Dépassement autorisé », `mar_retenue_pct` (saisi, pas encore appliqué),
  boutons Nouveau BL, Nouvelle situation, Nouvelle facture d'avancement, Reprise ; onglets Marché, Intervenants, Graphe,
  Pièces jointes. Liste des marchés : montant, facturé, reste à facturer (`v_liste_marches`).
- **Documents du marché** : situations (cumul, non comptables, indices de révision, numéro de situation), factures et
  avoirs d'avancement (période), reprise d'avancement, bloc de déduction (`document_deduction`), annulation par avoir
  en cascade. Pied : une section par commande avec son pied, pied global qui consolide ; **le pied global ne reçoit
  aujourd'hui que des postes après TVA** (`PIED_GLOBAL` refuse un poste HT : la TVA est la somme de celles des
  sections).
- **Pièces comptables** : `ent_etat_compta` (à transférer, transférée, sans écriture), numérotation continue des
  factures et avoirs, `v_facturation_document` (facturé = factures − avoirs, avoir d'avancement avec son signe).
- **Paiement direct** : information seulement (`fin_paiement_direct` des fonctions d'intervenant, `itv_paiement_direct`
  dans la structure et les documents).
- **Conditions de paiement** : texte libre sur le tiers (`per_mode_reglement`, `per_delai_paiement`, annuaire) et
  propriété d'exemple `mode_reglement` des devis ; aucun échéancier, aucun règlement.
- **Paramètres globaux** : `parametre_document` (clé → JSON, module Document) ; aucun paramètre « société ».
- TACHES.md : module Comptabilité à venir (compte des lignes provisoire), gestion de la sous-traitance à venir.

## 2. Vocabulaire

| Terme | Définition proposée | Décision |
|---|---|---|
| TS | Travaux supplémentaires : commande validée ajoutée au marché après la base (aujourd'hui « avenant »). | |
| Poste global | Ligne du pied global d'un document du marché, définie une fois sur le marché (retenue, prorata, acompte…). | |
| Acompte | Somme demandée avant ou pendant les travaux, déduite ensuite des factures du marché. | |
| Échéance | Montant d'une pièce exigible à une date, avec un mode de règlement. | |
| Pointage | Rapprochement d'un règlement (ou d'une caution) avec une ou plusieurs échéances. | |
| Caution | Garantie bancaire qui remplace la retenue de garantie : la retenue n'est pas retenue, ou est libérée. | |

## 3. Onglet « Gestion » de la fiche marché

### Q1. Commandes « Marché et TS »

**Proposition** : liste des commandes du marché (`marche_document`) : rôle (Marché pour la base, TS pour les suivantes),
rang, numéro, date, objet, montant HT, avancement facturé (% et montant), reste ; lien vers la commande. Renommer
« Avenant » en « TS » à l'écran ? Ou distinguer les deux : avenant (modification du contrat) et TS (travaux
supplémentaires commandés) ?

**Décision** :

### Q2. Situations et factures

**Proposition** : deux listes chronologiques par numéro de situation : situations (référence seule, indices
accessibles), factures et avoirs d'avancement (annulés masqués, case « afficher les annulées »), avec date, montant
cumulé, montant de la période, TTC, état (brouillon, validé, annulé, réglé). Boutons Nouvelle situation, Nouvelle
facture d'avancement, Ouvrir (nouvelle fenêtre), Facturer depuis la situation, Réviser, Annuler par avoir. Les BL et
factures simples du marché : une troisième liste « Autres documents » ?

**Décision** :

### Q3. Tableau récapitulatif

**Proposition** : une ligne par commande (base, TS) et une ligne de total : montant prévu HT, avancement cumulé (% et
montant de la dernière situation de référence), facturé HT (factures − avoirs), reste à facturer, et (quand le module
Règlements existera) réglé TTC et reste à payer. En bas : postes globaux cumulés (retenue de garantie retenue et
libérée, prorata, acomptes reçus et déduits, paiements directs). Faut-il un détail par section ou par titre de commande
(avancement par lot) ?

**Décision** :

### Q4. Modification depuis l'onglet

**Proposition** : l'onglet ouvre les documents (page document, nouvelle fenêtre) ; pas de saisie d'avancement dans la
fiche. Une saisie rapide du % par commande (appliqué à toutes ses lignes) est-elle utile dans l'onglet ?

**Décision** :

## 4. Postes de pied globaux du marché

### Q5. Définition et portée

**Proposition** : table `marche_poste` (marché, type, libellé, mode % / montant, base, sens, ordre, actif, TVA du
poste, dates de début et de fin) ; chaque document d'avancement (et facture simple ?) du marché reçoit ces postes en
lignes de pied **système** du pied global (non saisissables dans le document, modifiables sur le marché). Types :
`RETENUE_GARANTIE`, `PRORATA`, `ACOMPTE` (déduction), `PAIEMENT_DIRECT`, `AUTRE`.

**Décision** :

### Q6. Postes HT du pied global (contradiction avec le lot 4)

Le compte prorata et la déduction d'acompte se déduisent en général **hors taxes** (la TVA du document change). Or le
pied global refuse un poste HT (`PIED_GLOBAL`), parce que la TVA est la somme des TVA des sections.

- a) répartir le poste HT global sur les sections au prorata de leur HT net (un poste par section, consolidé ensuite) ;
- b) recalculer la TVA globale sur les bases fusionnées après les postes HT globaux (la TVA n'est plus la somme des
  sections) ;
- c) postes globaux toujours après TVA (TTC), la TVA de l'acompte étant traitée à part.

**Proposition** : a) : la TVA reste juste par taux et par commande, aucune règle de moteur nouvelle n'est nécessaire.

**Décision** : Pied global inchangé (postes après TVA seulement). Les postes HT (compte prorata, remise…) se saisissent sur les commandes (pied de section) et sont repris par les factures.

### Q7. Retenue de garantie

**Proposition** : % du marché (`mar_retenue_pct`, 5 % au plus) appliqué au TTC de chaque facture d'avancement ;
plafond éventuel ; **cautionnée** : la retenue n'est pas appliquée (ou elle est libérée) quand une caution est
enregistrée (§ 6) ; libération : échéance de retenue (§ 7) à la date de réception + 1 an, sauf réserves. Faut-il la
date de réception des travaux sur le marché (`mar_date_reception`), et la levée des réserves ?

**Décision** :

### Q8. Compte prorata

**Proposition** : % (souvent 1 à 2 %) du montant HT de la période, retenu par le mandataire du compte prorata ;
poste HT (Q6). Le compte prorata peut aussi être une **dépense** facturée par le gestionnaire du compte : hors périmètre.

**Décision** :

### Q9. Paiement direct des sous-traitants

**Proposition** : par sous-traitant agréé (intervenant du marché avec paiement direct), montant de sa situation du mois
saisi sur la facture d'avancement (ou importé de sa situation fournisseur) ; poste de déduction TTC « Paiement direct
— <sous-traitant> » ; le reste à payer du client baisse d'autant ; le module Règlements suit le paiement fait au
sous-traitant par le maître d'ouvrage. Autoliquidation de la TVA de sous-traitance : à confirmer.

**Décision** (tranchée par l'analyse du module Sous-traitance, paiement direct réalisé à son lot 4) : marché de vente lié
facultatif, y compris en paiement direct, la déduction pouvant se faire sur une facture directe (ST5) ; marchés publics
en paiement direct, marchés privés en délégation de paiement ou caution, traitées à part du paiement direct (ST14) ;
montant déduit de notre facture = celui que le maître d'ouvrage paie au sous-traitant, le HT en autoliquidation (ST15).
Écritures comptables à préciser avec le module Comptabilité et l'expert-comptable.

## 5. Acomptes

### Q10. Pièces et paramétrage de la société

**Proposition** : paramètre société « Acompte » : `FACTURE` (facture d'acompte, pièce comptable avec TVA) ou `RECU`
(reçu non comptable, TVA à l'encaissement réglée ailleurs). Types : `V_DEMANDE_ACOMPTE` (non comptable, demande au
client) → `V_FACTURE_ACOMPTE` ou `V_RECU_ACOMPTE` (au paiement, ou dès la demande ?). Où ranger le paramètre société :
nouvelle table `parametre_societe` (cœur) ou `parametre_document` ?

**Décision** : Deux modes, au choix par une option globale de la société : **avance de trésorerie** et **chiffre d'affaires** ; l'option fixe la base de calcul des acomptes, et plus tard leurs écritures comptables (voir 11.1).

### Q11. Gestion depuis le marché

**Proposition** : liste des acomptes dans l'onglet Gestion (demandé, facturé ou reçu, réglé, déduit, reste à déduire) ;
création d'une demande en % du marché ou en montant ; transformation en facture ou reçu ; un acompte appartient au
marché (pas à une commande). Plusieurs acomptes par marché ?

**Décision** :

### Q12. Modes de déduction

**Proposition** (choisi par acompte) :

| Mode | Règle |
|---|---|
| Première facture | Déduit en entier de la première facture d'avancement suivante (plafonné à son montant, reste reporté). |
| Dernière facture | Déduit de la facture qui solde le marché (avancement 100 %), ou de la dernière déclarée comme telle. |
| Linéaire | Déduit au prorata de l'avancement : déduit cumulé = acompte × avancement cumulé du marché (en montant), moins le déjà déduit. |

Avance forfaitaire des marchés publics (remboursée entre 65 % et 80 % d'avancement) : mode supplémentaire « Entre
deux seuils » ? Une déduction se refait-elle si une facture est annulée (cascade : oui, l'avoir l'annule) ?

**Décision** :

### Q13. TVA de l'acompte

**Proposition** : facture d'acompte : TVA au taux du marché (ou par taux, au prorata) ; la déduction sur la facture
d'avancement est un poste HT avec la même TVA (Q6). Reçu : déduction TTC. À valider avec l'expert-comptable.

**Décision** : Selon l'option de la société (Q10) : voir 11.1 et 11.2.

## 6. Module Règlements

### Q14. Périmètre du module

**Proposition** : nouveau module `modules/reglement` (JS + C#, sans dépendance au module Document : le cœur fait le
lien) : règlements reçus (clients) et émis (fournisseurs, sous-traitants), cautions ; pointage ; reste à payer. Le module
Comptabilité (export des écritures, lettrage comptable) reste séparé : le module Règlements lui fournira les
encaissements.

**Décision** : Module Règlements séparé de la Comptabilité : facultatif (une société peut ne pas l'utiliser) et surchargeable plus tard. La Comptabilité attend encore des bases (plan de comptes, journaux…).

### Q15. Règlement

**Proposition** : `reglement` (tiers, sens encaissement / décaissement, date, mode : virement, chèque, LCR, espèces,
compensation, montant, référence bancaire, banque, commentaire) ; un règlement peut couvrir plusieurs échéances ou
pièces (pointage partiel), et inversement. Trop-perçu : reste non pointé du règlement, utilisable plus tard.

**Décision** :

### Q16. Pointage et reste à payer

**Proposition** : `pointage` (règlement ou caution ou avoir → échéance, montant) ; reste à payer d'une échéance =
montant − pointé ; d'une pièce = somme de ses échéances ; une pièce est **réglée** quand son reste est nul. Un avoir se
pointe sur une facture (compensation). Règle de calcul répliquée JS / C# avec un jeu (reste, statut réglé, écarts).
Écart de règlement (centimes, escompte) : seuil de solde automatique comme pour les lignes (`parametre_document`) ?

**Décision** :

### Q17. Cautions

**Proposition** : `caution` (marché, tiers, organisme, montant, date, date de fin, référence, document GED) ; une caution
couvrant la retenue de garantie : pointée sur les échéances de retenue (la retenue devient « libérée par caution ») ou
empêche la retenue sur les factures suivantes (Q7). Mainlevée de la caution à la réception + 1 an.

**Décision** :

### Q18. Écrans

**Proposition** : liste des règlements (filtres tiers, marché, période), fiche règlement avec pointage (pièces ouvertes du
tiers proposées, pointage automatique par montant et date), onglet « Règlements » de la page document (échéances,
pointages, reste), relances (plus tard), récapitulatif dans l'onglet Gestion du marché.

**Décision** :

## 7. Échéances dans le module Document

### Q19. Conditions de paiement

**Proposition** : référentiel `condition_paiement` (code, libellé, lignes : % du montant, délai en jours, base date
de facture / fin de mois / jour fixe, mode de règlement) ; paramètre général ventes et achats ; le tiers peut avoir la
sienne (remplace `per_delai_paiement` / `per_mode_reglement` texte, avec reprise des valeurs) ; le document la reprend
à la création (`ent_cpa_code`, modifiable). Contrôle des délais légaux (60 jours ou 45 jours fin de mois) :
avertissement ?

**Décision** :

### Q20. Calcul de l'échéancier

**Proposition** : à la validation d'une pièce comptable, `document_echeance` (rang, date, montant TTC, mode, nature
NORMALE / RETENUE / LIBERATION) calculé par une règle répliquée JS / C# (jeu de cas : fin de mois, jour fixe, arrondi
au centime sur la dernière échéance, montant négatif d'un avoir). Avant validation : aperçu. Échéancier modifiable à la
main après validation (dates, répartition) tant que rien n'est pointé ?

**Décision** :

### Q21. Retenue de garantie et libérations

**Proposition** : la retenue de garantie d'une facture d'avancement crée une échéance de nature RETENUE à la date de
libération (réception + 1 an ; date inconnue : échéance sans date) ; libérée par paiement, par caution, ou par
mainlevée ; une « facture de libération » n'est pas nécessaire (la retenue est déjà facturée). À confirmer.

**Décision** :

### Q22. Achats

**Proposition** : même calcul pour les factures fournisseurs (condition du fournisseur, sinon générale achats) ;
retenue de garantie subie sur les sous-traitants ; paiements émis suivis par le module Règlements.

**Décision** :

## 8. Impacts (prévisionnels)

| Partie | Contenu |
|---|---|
| Module Document | `condition_paiement`, `document_echeance`, calcul de l'échéancier (JS / C#, jeu), `ent_cpa_code`, postes système du pied global (`lig_systeme`, origine), répartition d'un poste HT global sur les sections (Q6, deux moteurs, jeu) |
| Nouveau module Règlements | `reglement`, `pointage`, `caution`, règle du reste à payer (JS / C#, jeu), écrans, fournisseur mémoire |
| Cœur | `marche_poste`, types d'acompte et leurs transformations, paramètre société « Acompte », date de réception du marché, onglet Gestion de la fiche marché (`fiche-structure.js`), récapitulatif (`v_avancement_marche`), branchement Règlements ↔ documents |
| Annuaire | condition de paiement du tiers (référence), reprise des textes existants |
| Documentation | CLAUDE.md, MODULES.md (module Règlements), TACHES.md |

## 9. Ordre de réalisation proposé

1. Onglet Gestion du marché (lecture : commandes, situations, factures, récapitulatif), sans nouvelle règle.
2. Conditions de paiement et échéancier (module Document).
3. Postes globaux du marché : retenue de garantie, compte prorata (avec Q6), paiement direct.
4. Acomptes : paramètre société, pièces, déductions.
5. Module Règlements : règlements, pointage, reste à payer, cautions ; colonnes réglé / reste dans l'onglet Gestion.

## 10. Points à approfondir et décisions à valider (récapitulatif)

1. **Q1** – « TS » = avenant actuel, ou deux notions distinctes (avenant au contrat, travaux supplémentaires) ?
2. **Q2** – Contenu des listes de situations et de factures ; place des BL et factures simples du marché.
3. **Q3** – Colonnes du récapitulatif ; détail par lot / titre de commande ?
4. **Q4** – Saisie rapide de l'avancement dans l'onglet, ou seulement ouverture des documents ?
5. **Q5** – Postes globaux définis sur le marché et posés en lignes système ; aussi sur les factures simples ?
6. **Q6** – Poste HT dans le pied global : répartition sur les sections (proposé), recalcul global de la TVA, ou postes
   TTC seulement (contredit `PIED_GLOBAL` du lot 4).
7. **Q7** – Retenue de garantie : base TTC, plafond, date de réception et levée des réserves sur le marché.
8. **Q8** – Compte prorata : poste HT en % ; dépenses du compte prorata hors périmètre ?
9. **Q9** – Paiement direct : montant par sous-traitant et par facture, source (saisie ou situation fournisseur),
   traitement de la TVA autoliquidée.
10. **Q10** – Acompte : facture ou reçu selon le paramètre société ; types de pièces ; emplacement du paramètre
    société.
11. **Q11** – Acomptes du marché : plusieurs par marché, en % ou en montant, rattachés au marché.
12. **Q12** – Modes de déduction (première, dernière, linéaire ; avance forfaitaire entre deux seuils ?) ; effet d'une
    annulation.
13. **Q13** – TVA de l'acompte et de sa déduction (avis de l'expert-comptable).
14. **Q14** – Module Règlements séparé de la Comptabilité ; dépendances.
15. **Q15** – Modèle du règlement, trop-perçu.
16. **Q16** – Pointage, reste à payer, seuil d'écart, compensation par avoir.
17. **Q17** – Cautions : effet sur la retenue (non retenue ou libérée), mainlevée.
18. **Q18** – Écrans du module Règlements ; pointage automatique ; relances plus tard.
19. **Q19** – Référentiel des conditions de paiement ; reprise des champs texte du tiers ; contrôle des délais légaux.
20. **Q20** – Échéancier : calcul répliqué, moment du calcul, modification manuelle.
21. **Q21** – Échéances de retenue de garantie et libérations (dates, caution, mainlevée).
22. **Q22** – Mêmes règles pour les achats et la sous-traitance.

## 11. Points ouverts par les décisions (17/10/2026)

> Même principe : **Proposition**, puis **Décision**.

### 11.1 Les deux modes d'acompte

« Avance de trésorerie » et « chiffre d'affaires » : il faut fixer ce que chacun change.

**Proposition** :

| | Avance de trésorerie | Chiffre d'affaires |
|---|---|---|
| Pièce | Demande d'acompte, puis reçu au paiement (non comptable) | Demande d'acompte, puis facture d'acompte (pièce comptable, numérotation continue) |
| TVA | Aucune sur l'acompte ; toute la TVA est sur les factures d'avancement | TVA sur la facture d'acompte (taux du marché, ou par taux au prorata des commandes) |
| Facturé du marché | L'acompte n'entre pas dans le facturé | La facture d'acompte entre dans le facturé ; sa déduction le retire |
| Déduction | Poste après TVA du pied global (TTC), compatible avec Q6 | Déduction HT avec sa TVA : ne tient pas dans le pied global (Q6), voir 11.2 |
| Écritures (plus tard) | Compte d'avance client (ex. 4191) | Produit et TVA collectée à la facture d'acompte, extournés à la déduction |

L'option est-elle fixée une fois pour toutes, ou modifiable seulement s'il n'y a aucun acompte en cours ? Par marché en
plus de la société (marchés publics : avance forfaitaire) ?

**Décision** :

### 11.2 Déduction d'un acompte en mode chiffre d'affaires

Q6 garde le pied global sans poste HT. En mode chiffre d'affaires, la déduction d'un acompte est HT avec sa TVA ; elle
change chaque facture (selon le mode de déduction, Q12) et ne peut donc pas être saisie une fois sur la commande.

- a) poste de pied **de section** posé par le système dans chaque commande de la facture, au prorata de l'avancement de
  la commande (HT, avec la TVA de la section) ; consolidé ensuite dans le pied global comme les autres ;
- b) déduction TTC dans le pied global, et TVA de l'acompte régularisée par une ligne de TVA à part (contraire au calcul
  par taux du moteur) ;
- c) en mode chiffre d'affaires, l'acompte se déduit par une ligne négative du corps (section « Acomptes ») avec son taux
  de TVA.

**Proposition** : a), cohérent avec Q6 (rien d'HT au pied global) et avec la TVA par commande.

**Décision** :

### 11.3 Postes HT saisis sur les commandes

Q6 : compte prorata, remise… sont des lignes de pied de la commande (déjà repris dans les pieds de section des factures,
lot 4). En facture d'avancement, un poste en % suit la période ; un poste en montant suit l'avancement (lot 6b, mode A).

- Le compte prorata en % de la commande convient-il (aucun « poste global » prorata, Q8 devient sans objet) ?
- Une commande de TS sans compte prorata saisi : faut-il le proposer par défaut (modèle de pied du marché) ?

**Proposition** : oui pour le premier point ; pour le second, un « modèle de pied » sur le marché, recopié dans le pied de
chaque commande à sa validation dans le marché (modifiable sur la commande).

**Décision** :

### 11.4 Postes globaux restants (Q5)

Après Q6, le pied global ne reçoit que des postes après TVA : retenue de garantie, paiement direct, déduction d'acompte
en mode avance de trésorerie, autres postes TTC.

**Proposition** : `marche_poste` réduit à ces postes TTC ; Q5 et Q8 sont à relire dans ce sens.

**Décision** :

### 11.5 Règlements sans le module

Q14 : le module Règlements est facultatif. Sans lui, que deviennent le reste à payer, les colonnes « réglé » du
récapitulatif (Q3) et les cautions (Q17) ?

**Proposition** : point d'accroche dans le cœur (`IReglements` / fournisseur côté client) : sans module, réglé = 0, pas de
colonne réglé ni de reste à payer, pas de cautions (la retenue de garantie s'applique toujours) ; le module, une fois
installé, remplit ces informations. « Surchargeable » : classes mères et méthode patron, comme les autres modules.

**Décision** :

### 11.6 Bases à poser avant la Comptabilité

Q14 : « il manque encore des bases ». À noter pour la suite (hors de ce chantier) : plan de comptes complet, journaux,
exercices, comptes des tiers (auxiliaires 411 / 401), comptes de TVA par taux, comptes d'acompte (selon 11.1), schéma
des écritures des factures, avoirs, acomptes et règlements, export vers un logiciel comptable.

**Proposition** : reporter dans TACHES.md (module Comptabilité) ; aucun développement dans ce chantier.

**Décision** :

## 12. Réalisation

Développement lancé le 17/10/2026 : pour les questions sans décision, la proposition est retenue par défaut.

### Lot 1 – onglet Gestion de la fiche marché

- Q1 à Q4 (propositions) : onglet « Gestion » avant le graphe (`FicheMarche.rendreGestion`, route
  `GET /api/structure/marches/{id}/gestion`) : récapitulatif par commande (« Marché » pour la base, « TS n » pour les
  suivantes) : prévu HT, travaux HT (lignes de prix, base du %), situé (dernière situation de référence), avancement,
  facturé HT (factures et avoirs d'avancement non annulés), reste ; total avec le facturé et le reste du marché ;
  situations de référence (indices, « Facturer », « Réviser ») ; factures et avoirs d'avancement (annulés masqués,
  réaffichables, « Annuler par avoir… ») ; autres documents (BL, factures simples). Création par les boutons de la fiche ;
  pas de saisie d'avancement dans l'onglet.
- Vérifié sur la base de démo (marché M-2026-005-1).

### Lot 2 – conditions de paiement et échéancier (module Document)

- `modules/document/db/019b_document_echeances.sql` : `condition_paiement` (lignes { pct, delai, base NET / FIN_MOIS / JOUR,
  jour, mode }, mêmes codes que le délai de paiement des tiers), conditions par défaut ventes / achats
  (`parametre_document.conditions_paiement`), `ent_cpa_code`, `ent_mode_reglement`, `lig_pied_retenue` (poste de pied
  retenue de garantie), `document_echeance` (rang, date, montant, mode, nature NORMALE / RETENUE, manuel).
- Règle répliquée `calculerEcheances` (`echeances.js`) ↔ `Echeances.Calculer` (jeu `tests/echeances/01_echeances.json`) :
  pourcentages du net à payer arrondis, reste sur la dernière ; FIN_MOIS = date + délai puis fin de mois ; JOUR = prochain
  jour fixe (dernier du mois s'il est plus court) ; sans ligne : comptant ; retenue : échéance RETENUE sans date.
- Validation d'une pièce à numérotation continue (factures, avoirs) : condition et mode figés (document, sinon tiers par
  `SpecialisationDocument.ReglementTiersAsync` — cœur : `per_delai_paiement`, `per_mode_reglement` —, sinon défaut), puis
  échéancier écrit (`EcheancierDocument`). Le document complet porte `echeances` et `reglement_tiers`.
- Routes : `GET|PUT /conditions-paiement`, `GET|PUT /parametres-documents/conditions-paiement`,
  `PUT /documents/{id}/echeances` (découpage manuel, totaux par nature inchangés, droit MODIFIER).
- Client : section Règlement de l'entête (combos condition et mode, aperçu de l'échéancier ou échéancier enregistré),
  case « Retenue de garantie » des postes de pied TTC, conditions et défauts dans `/parametres/documents` (échéances
  écrites « 30% 0j; 70% 30j FM »).
- Reportés : écran de modification manuelle de l'échéancier et date de libération des retenues (lot 5, Règlements) ;
  liste du délai de paiement des tiers toujours fixe (les codes ajoutés aux conditions n'y apparaissent pas).
- Vérifié sur la base de démo (facture FA2026-00002 : 30 jours par défaut, mode du tiers ; découpage manuel).

### Lot 3 – postes de pied du marché

- `db/173_marche_postes.sql` : `marche_poste` (portée G : pied global des factures, après TVA seulement — contrainte, Q6 ;
  portée C : modèle de pied des commandes, HT ou TTC ; types PAIEMENT_DIRECT, PRORATA, REMISE, AUTRE ; mode % ou montant,
  sens, sous-traitant), `mar_date_reception` (fiche marché, Q7).
- Retenue de garantie : `mar_retenue_pct` du marché, poste TTC en % du cumul (TTC net) en tête du pied global des
  factures, marqué `lig_pied_retenue` (échéance RETENUE du lot 2). La base TOTAL_TTC du moteur (TTC du corps avant
  remises) ne convient pas. Ne pas saisir aussi une retenue dans le pied des commandes (elle serait comptée deux fois).
- `PostesMarche` (cœur) : lignes système repérées par `lig_proprietes.poste_marche` ('R' : retenue, sinon `mpo_id`),
  ajoutées, mises à jour ou retirées ; HT avant la TVA de la racine, TTC à la fin ; un paiement direct garde la valeur
  saisie sur la facture. Application : à la création d'une facture depuis le marché (pied visible tout de suite) et à
  la validation (nouveau point d'accroche du module `SpecialisationDocument.CompleterValidationAsync`, avant le calcul) ;
  factures de vente du marché (hors avoirs) en portée G, commandes clients (hors intermédiaires) en portée C.
- Routes `GET|PUT /api/structure/marches/{id}/postes` ; fiche marché, onglet Gestion : section « Postes de pied »
  (combos, sous-traitant parmi les intervenants du marché).
- Vérifié sur la base de démo : facture d'avancement SI2026-00004 (retenue en échéance RETENUE, paiement direct de
  1 000 €), commande CC2026-00003 rattachée au marché 1 (compte prorata du modèle inséré avant la TVA).

### Lot 4 – acomptes

- `db/174_acomptes.sql` : types `V_DEMANDE_ACOMPTE` (non comptable), `V_FACTURE_ACOMPTE` (numérotation continue, avoir
  `V_AVOIR`), `V_RECU_ACOMPTE` (non comptable), transformations demande → facture ou reçu (étape ACOMPTE) ; mode de la
  société `parametre_document.acomptes` (TRESORERIE par défaut, ou CA ; ne change plus dès qu'un acompte existe) ;
  `marche_acompte` (rang, libellé, mode figé, % du marché HT ou montant, déduction PREMIERE / DERNIERE / LINEAIRE,
  demande, pièce) ; `acompte_deduction` (déductions des factures validées) ; `v_facturation_document` compte la facture
  d'acompte dans le facturé (sa déduction HT le retire).
- `Acomptes` (cœur) : demande au client du marché (une ligne d'acompte, PV fixe, nature OUV ; TVA du marché en mode CA,
  exonérée en trésorerie), émission (« Facturer » / « Reçu » : la demande est validée puis transformée), déductions
  posées avant le calcul de la validation des factures d'avancement (`CompleterValidationAsync`, montants de la période
  et du cumul lus sur les lignes enregistrées) une fois la pièce de l'acompte validée : PREMIERE = min(reste, période),
  DERNIERE = reste quand le cumul atteint le marché, LINEAIRE = acompte × cumul / marché − déjà déduit (une baisse
  d'avancement reprend une partie de la déduction). Trésorerie : poste TTC du pied global ; CA : poste HT dans le pied
  de chaque commande, avant sa TVA, au prorata de sa période (11.2 a). Lignes système « A<mac_id> » ;
  `acompte_deduction` écrit après la validation (facture ou avoir d'avancement) ; une pièce annulée ne compte plus.
- Routes : `GET|PUT /api/structure/acomptes/mode`, `GET|POST /api/structure/marches/{id}/acomptes`,
  `POST /api/structure/acomptes/{id}/emettre`. Fiche marché, onglet Gestion : section Acomptes (montant, déduction,
  demande, facture ou reçu, déduit, reste, nouvelle demande) ; `/parametres/documents` : mode d'acompte.
- Reportés : avance forfaitaire « entre deux seuils » (Q12), écritures comptables (11.6), aperçu des déductions avant
  la validation.
- Vérifié sur la base de démo : acompte de 10 % du marché M-2026-005-1 (reçu RAC2026-00001), déduction linéaire de
  5 084,24 TTC sur SI2026-00005 (cumul 20 %), puis en mode CA (essai) 2 × 1 271,06 HT dans les pieds des commandes.

### Lot 5 – module Règlements

- Nouveau module facultatif `modules/reglement` (JS `@logibtp/reglement`, `LogiBTP.Reglements(.Web)`, `db/080`) :
  `reglement` (tiers, sens E / D, date, mode, montant, référence), `caution` (organisme, montant, validité, mainlevée,
  objet : marché), `pointage` (règlement ou caution → échéance). Sans dépendance au module Document : les échéances
  viennent de la spécialisation (`SpecialisationReglementBtp` : `document_echeance` des pièces validées non annulées,
  ventes E, achats D) ; `db/175` ajoute la clé étrangère vers `document_echeance` (une échéance pointée ne se supprime
  plus : `ECHEANCES_POINTEES` à la modification manuelle de l'échéancier).
- Règle répliquée `reste.js` ↔ `ResteAPayer.cs` (jeu `tests/cas/01_reste.json`) : reste d'une échéance et d'une pièce
  (REGLEE / PARTIELLE / A_REGLER), non pointé d'un règlement (trop-perçu, compensation facture / avoir), proposition de
  pointage (plus ancienne d'abord, sans date en dernier, même signe). Seuil d'écart : 0 (point d'accroche `Seuil`).
- Contrôles : même tiers et sens, signe de l'échéance, échéance et source non dépassées, caution sur retenues seulement.
- Écrans : `/reglements?sens=E|D&tiers=` (menus Ventes et Achats) : échéances avec reste et saisie « à pointer »,
  règlement (Répartir, Enregistrer), règlements du tiers, cautions pointant les retenues ; onglet Gestion du marché :
  colonnes Réglé / Reste à payer des factures quand le module répond (11.5 : sans lui, pas de colonnes).
- Vérifié sur la base de démo : virement de 30 000 € pointé sur SI2026-00004 et SI2026-00005, caution de 5 000 € sur la
  retenue de SI2026-00004 (pièce réglée), refus d'un pointage au-delà de l'échéance.

