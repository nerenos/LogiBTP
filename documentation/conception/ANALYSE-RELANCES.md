# LogiBTP – analyse des relances (devis et factures)

> Analyse préalable (05/11/2026), à valider avant tout développement. Points de départ : CRM C22 et C27
> ([ANALYSE-MODULE-CRM.md](ANALYSE-MODULE-CRM.md)), lot 5 du module Mail ([ANALYSE-MODULE-MAIL.md](ANALYSE-MODULE-MAIL.md)),
> Q18 du module Règlements ([CONCEPTION-MARCHES-REGLEMENTS.md](CONCEPTION-MARCHES-REGLEMENTS.md) : « relances plus
> tard »), ergonomie Q5 (indicateur « Devis à relancer », [ANALYSE-ERGONOMIE.md](ANALYSE-ERGONOMIE.md)).
>
> **État** : réalisé le 08/11/2026 en neuf lots (module `modules/relance`, cœur) ; décisions dans
> [relances-questions.md](plans/relances-questions.md), déroulé et écarts dans [relances.md](plans/relances.md) ; reports au TODO
> (pénalités calculées, pastille dans l'entête des pièces, blocage du client). Le texte qui suit est l'analyse d'origine.

## 1. Demande

Relancer les clients :

- **devis** envoyés restés sans réponse (ni accepté, ni refusé) ;
- **factures** échues non payées (factures, factures d'avancement, factures d'acompte ; reste à payer non nul).

Décisions déjà prises au CRM (C22, C27, 22/10/2026) :

| Sujet | Décision |
|---|---|
| Durée | On relance tant que le devis attend une réponse ou que la facture attend son paiement. |
| Départ | Devis : date d'envoi (statut ENVOYE) ; facture : date de l'échéance. |
| Arrêt | Devis : acceptation, refus ou fin de validité ; facture : reste à payer nul (module Règlements ; sans lui, statut de paiement du document). |
| Règle | Globale (paramètres des documents), surchargeable par tiers (fiche personne) : 1re relance à 15 jours, 2e à 1 mois, 3e à 2 mois. |
| Modes | Courriel (module Mail), courrier postal, lettre recommandée avec accusé de réception (numéro saisi à la main). |
| Lettres | Module Édition, un modèle par niveau. |
| Contrôle | Toujours une liste proposée et validée par un utilisateur avant l'envoi. |
| Trace | Chaque relance = note du CRM sur le document (sinon historique du document). |

## 2. Ce qui existe

| Brique | Ce qu'elle apporte | Manque pour les relances |
|---|---|---|
| Module Document | Statuts (ENVOYE, VALIDE = accepté par le client, FACTURE, PAYE…), état affiché REFUSE / EXPIRE (`db/253`), fin de validité `ent_date_validite`, échéancier `document_echeance` | Aucune notion de relance |
| Module Règlements (facultatif) | Reste à payer par échéance et par pièce (`reste.js` ↔ `ResteAPayer.cs`), pointages, imputations | Rien sur l'ancienneté de l'impayé |
| Module Mail | File d'envoi, lots (`mail_lot`, priorité basse), modèles à variables, élément `document` (destinataires, pièces), envoi automatique par usage | Usage « relance », modèles par niveau |
| Module Édition | Modèles de lettres, PDF rangés en GED | Modèles de relance |
| Module CRM (facultatif) | Notes typées (type RELANCE déjà connu : `db/267` le lit pour l'indicateur des devis), tâches, rappels | Note écrite automatiquement par une relance |
| Liste des devis | Indicateur « Devis à relancer » (`jours_envoye`, remis à zéro par une note RELANCE) | Liste de travail et envoi |
| Notifications | Planificateur par base, sources du cœur | Source « relances à préparer » |

## 3. Principe proposé

1. **Calcul des relances dues** (chaque nuit et à la demande) : pour chaque pièce en attente, niveau atteint selon la
   règle (globale ou du tiers) et la dernière relance faite ; une pièce n'est proposée qu'au niveau suivant.
2. **Liste de travail** (`/relances`) : relances proposées regroupées par tiers, cochées par défaut, mode d'envoi
   proposé par niveau ; l'utilisateur décoche, change le mode, ajoute un commentaire, puis valide.
3. **Envoi** : courriel par la file du module Mail (lot de priorité basse, une relance par tiers regroupant ses pièces) ;
   courrier et recommandé : PDF produits par le module Édition, imprimés par l'utilisateur, numéro de recommandé saisi.
4. **Trace** : journal des relances (pièce, niveau, mode, date, auteur, courriel ou PDF) et note RELANCE du CRM sur la
   pièce si le module est actif ; la relance remet à zéro le délai de l'indicateur des devis (déjà fait par `db/267`).

## 4. Schéma (esquisse)

| Table | Contenu |
|---|---|
| `relance_regle` | Règle globale par nature (DEVIS, FACTURE) : niveaux { rang, délai en jours, mode proposé, modèle de courriel, modèle d'édition } |
| `personne` (`ALTER TABLE` du cœur) | Surcharge par tiers : règle propre ou « ne pas relancer », contact de relance (individu), commentaire |
| `relance` | Relance faite : pièce (`ent_id`, groupe d'indices), niveau, mode, date, auteur, montant relancé (facture : reste à la date), message du module Mail, document GED (PDF), numéro de recommandé, lot |
| `relance_lot` | Préparation validée : date, auteur, nombre de relances, état (préparé, envoyé, en partie) |
| `relance_suspension` | Pièce ou tiers suspendu jusqu'à une date (litige, promesse de paiement), motif |

## 5. Architecture proposée

Module facultatif **Relances** (`modules/relance`, activé par société dans `module_societe`), sans métier BTP : règle
des niveaux et calcul des relances dues répliqués JS ↔ C# (`regles.js` ↔ `ReglesRelance.cs`, jeu de cas), journal,
préparation et validation de la liste. Le cœur le spécialise (`SpecialisationRelanceBtp`) : pièces en attente (devis
ENVOYE non expirés, échéances des pièces de vente avec leur reste), contacts, envoi par le module Mail, lettres par le
module Édition, notes du CRM. Le module ne dépend ni du module Document ni du module Règlements (contrats du socle,
comme le module Règlements reçoit les échéances de la spécialisation).

## 6. Questions et propositions

| N° | Question | Proposition | Décision |
|---|---|---|---|
| R1 | Module à part ou fonction du cœur ? | Module facultatif « Relances » (§ 5), activé par société. | Ok à ajouter au menu vente |
| R2 | Pièces relancées ? | Devis de vente (`V_DEVIS`) ; factures de vente à reste positif (factures, factures d'avancement, factures d'acompte). Jamais les avoirs, les reçus d'acompte ni les achats. Liste fermée par un rôle du type de document (comme `ROLE_RENTABILITE`), pas de code de type en dur. | ok |
| R3 | Factures : relance par pièce ou par échéance ? | Par pièce : niveau calculé sur l'échéance échue la plus ancienne ; montant relancé = reste échu à la date (échéances futures citées pour information). La retenue de garantie n'est relancée qu'après sa date de libération. | Ok |
| R4 | Nombre de niveaux et délais par défaut ? | Trois niveaux (C22) : 15 jours, 1 mois, 2 mois après le départ ; jusqu'à cinq niveaux paramétrables ; le dernier niveau se répète ou non (case « répéter »). | OK |
| R5 | Délai compté depuis le départ ou depuis la relance précédente ? | Depuis le départ (date d'envoi du devis, date de l'échéance) : les niveaux restent datés même si une relance a été faite en retard ; une relance manquée n'est pas rattrapée deux fois (seul le niveau atteint est proposé). | Ok |
| R6 | Surcharge par tiers ? | Sur la fiche personne (onglet Facturation et règlement, groupe Relances) : règle propre, « ne pas relancer » (administration, grands comptes), contact de relance ; un client payeur distinct reçoit la relance de la facture (intervenant PAYEUR). | Ok |
| R7 | Arrêts et suspensions ? | Arrêts de C27, plus : document annulé, remplacé par un indice, devis transformé en commande ; suspension datée par pièce ou par tiers avec motif (litige, promesse de paiement, plan d'échelonnement) : la pièce sort de la liste jusqu'à la date. | Ok |
| R8 | Sans le module Règlements ? | Factures : relance possible seulement si le statut de la pièce n'est pas PAYE ; reste relancé = net à payer (sans pointage). Le module Relances le signale dans ses paramètres. | Ok |
| R9 | Qui prépare et valide ? | Droit propre (nœud `relances`, CONSULTER / CREER pour préparer, VALIDER pour envoyer) ; portée par le chargé d'affaires du client ou du chantier (SOI, EQUIPE, SERVICE, TOUT) ; administratif : TOUT. | Ok |
| R10 | Regroupement ? | Une relance par tiers et par mode, regroupant toutes ses pièces du même niveau ; un tiers à plusieurs niveaux reçoit le plus élevé avec la liste de toutes ses pièces. | Ok |
| R11 | Courriel : destinataire et contenu ? | Contact de relance du tiers, sinon courriel du contact figé de la pièce (`ent_contact_client` / payeur), sinon de l'intervenant ; modèle par niveau et nature (module Mail, variables : tiers, pièces, montants, échéances, jours de retard) ; pièces jointes : PDF des factures relancées (dernière édition rangée en GED) ; expéditeur de l'usage RELANCE. | Ok |
| R12 | Courrier et recommandé ? | PDF par le module Édition (modèle par niveau : « Relance 1 », « Relance 2 », « Mise en demeure »), une lettre par tiers, rangé en GED de chaque pièce (catégorie `relance`) ; recommandé : numéro saisi après coup (envoi « en attente de numéro »). | Ok |
| R13 | Mise en demeure et pénalités ? | Dernier niveau des factures = mise en demeure (modèle propre, recommandé par défaut) citant les pénalités de retard et l'indemnité forfaitaire de 40 € (mentions de la société, Paramètres › Éditions) ; calcul des pénalités affiché pour information, jamais facturé automatiquement. | Ok |
| R14 | Trace ? | Journal `relance` (toujours) et note RELANCE du CRM sur la pièce si le module est actif (texte : niveau, mode, montant ; courriel lié). Onglet Suivi de la page document et de la fiche tiers ; colonne « Dernière relance » des listes de devis et de factures. | Ok |
| R15 | Préparation automatique ? | Calcul chaque nuit ; notification « N relances à préparer » aux personnes qui ont le droit (module Notifications) ; jamais d'envoi sans validation (C22). | Ok |
| R16 | Devis : relance commerciale ou tâche ? | Même circuit (courriel ou lettre), plus une option « tâche du CRM » : la relance d'un devis peut être un appel du chargé d'affaires (tâche à échéance du jour, rattachée au devis), sans envoi. | Ok |
| R17 | Blocage du client ? | Pour information : pastille « relancé N » sur la fiche tiers et dans l'entête des nouvelles pièces ; dépassement de l'encours autorisé déjà signalé à la validation (contrôle de gestion existant). Pas de blocage automatique. | Ok blocage manuel |
| R18 | Écritures comptables ? | Aucune (une relance n'écrit rien) ; les pénalités éventuelles se facturent par une facture ordinaire. | Ok |

## 7. Liens avec les autres modules

- **Document** : statuts et état affiché des devis, échéancier, coordonnées figées, contact du payeur.
- **Règlements** : reste à payer par échéance (sans lui : R8).
- **Mail** : usage RELANCE, modèles par niveau, lots de priorité basse, courriel rangé en GED et lié à la pièce ; c'est
  le lot 5 du module Mail.
- **Édition** : modèles de lettres par niveau, PDF rangés en GED.
- **CRM** : note RELANCE (indicateur des devis déjà branché), tâche d'appel (R16).
- **Notifications** : relances à préparer (R15).
- **Droits** : nœud `relances` et portée (R9).

## 8. Découpage en lots proposé

| Lot | Contenu |
|---|---|
| 1 | Module : règle des niveaux et calcul des relances dues (JS ↔ C#, jeu de cas), paramétrage global et par tiers, suspensions, liste de travail `/relances` en lecture (pièces dues, niveau, montant), droits. |
| 2 | Validation et envoi par courriel (module Mail : usage, modèles, lot), journal, note du CRM, colonne « Dernière relance ». |
| 3 | Lettres et recommandés (module Édition : modèles par niveau, PDF en GED, numéro de recommandé), mise en demeure. |
| 4 | Préparation de nuit et notification, tâche d'appel pour les devis, pastille du tiers. |
