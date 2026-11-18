# Reprise des tables `PP_*` de MDE : analyse courte (lot 17)

Lot 17 du plan [reprise-mde-optim.md](plans/reprise-mde-optim.md). Décision Q19 de
l'[analyse de la reprise](ANALYSE-IMPORT-MDE-OPTIM.md) : les tables `PP_*` alimentent les **ordres et la synthèse
par chantier** (module Exécution).

Cette analyse ne s'appuie que sur la **structure** des tables (catalogue de la base fournie), sans aucune donnée réelle.
Le sens des codes (`ETAT`, `TYPENOTE`, `MATIERE`…) reste donc à confirmer : les questions sont au § 3.

## 1. Les huit tables

| Table | Ce qu'elle semble contenir | Clé vers MDE |
| --- | --- | --- |
| `PP_ENTETECHANTIER` | Une fiche de suivi par chantier : note libre, date de fin, échéance, rappel, couleur, état. Cases d'avancement : réservation, principe envoyé, principe validé, cotes 3D, dessin, fabrication, peinture, pose, PPSPS, DOE, réserves, terminé. | `CODE` = code du chantier (nchar 7) |
| `PP_LIGNECHANTIER` | Notes datées d'un chantier, chacune avec un type (`TYPENOTE` : achat, dessin, fabrication, pose, suivi, finition, direction d'après `PP_AUTH`), un état, une échéance et un rappel. | `CODE` = code du chantier (nchar 10) |
| `PP_PLAN` | Plans d'un chantier : repère, révision (indice), nom, CCTP, finition, date d'envoi, puis retour et validation (une lettre) de l'architecte, de l'OPC et du bureau de contrôle. | `CODECHANTIER` |
| `PP_ATELIER` | Fiches d'atelier (métallerie) : code, libellé, matière. États et opérateurs de chaque poste : débit KBS, débit KKS, débit plasma, monteur, soudeur. Finition, remarque, échéance et échéance théorique. | `CODE` (nchar 7) : probablement un chantier |
| `PP_AUTH` | Droits par utilisateur (trigramme) : modifier un chantier, une ligne, une note par type ; temps par défaut ; administration. | Utilisateurs |
| `PP_FONCTIONINTERLOC` | Rôles d'un interlocuteur : DP, commande, facture, SAV, commercial. | `ID` = interlocuteur ? |
| `PP_SALARIESFICHEHEURE` | Salariés de la fiche d'heures : trigramme, nom, groupe, commentaires, actif, imprimé. | Trigramme |
| `PP_SYS` | Version de l'outil. | — |

## 2. Correspondances proposées

| Source | Cible LogiBTP | Remarque |
| --- | --- | --- |
| `PP_ENTETECHANTIER`, cases d'avancement | **Synthèse par chantier** (module Exécution) : un parcours du chantier dont les étapes sont les cases (principe, cotes 3D, dessin, fabrication, peinture, pose, PPSPS, DOE, réserves). Case cochée → état imposé TERMINE du service de l'étape, motif « Reprise MDE ». | Il faut un **modèle de parcours** et un service par étape. Le modèle est créé par la reprise s'il n'existe pas (Q-PP1). |
| `PP_ENTETECHANTIER.NOTE`, échéance, rappel | Note du CRM sur le chantier (mémo), avec un rappel AVANT si `RAPPEL`. | Couleur ignorée. |
| `PP_LIGNECHANTIER` | Notes du CRM du chantier : type de note (`crm_type_note`) = `TYPENOTE` par une table de correspondance. Avec échéance : tâche (à faire, ou terminée selon `ETAT`) ; sans échéance : action. Rappel AVANT si `RAPPEL`. | Une tâche du CRM demande un responsable ou un service : celui du type de note (Q-PP2). |
| `PP_PLAN` | **Suivi des validations** du CRM : un plan par repère (`REPEREPLAN` + `NOM`), un indice par révision, la date d'envoi = diffusion. Un visa par intervenant (architecte, OPC, bureau de contrôle), accepté, refusé ou avec réserves selon la lettre. | C'est le module CRM, pas Exécution, qui porte les plans et les visas. Sens des lettres : Q-PP3. |
| `PP_ATELIER` | **Ordres** de la famille E (type à créer, par exemple E_ATELIER) sur le chantier, avec une étape par poste (débit KBS, KKS, plasma, montage, soudure, finition). L'état de chaque poste donne l'étape validée ou non, et l'opérateur sa ressource. L'échéance devient la date prévue de fin. | Il faut savoir si le `CODE` est un chantier et ce que valent les états (Q-PP4). Le type d'ordre et ses états se créent dans le paramétrage de l'Exécution (`exe_etat_type`). |
| `PP_AUTH` | Non repris | Les droits se refont dans LogiBTP (comme les comptes, Q20). |
| `PP_FONCTIONINTERLOC` | Fonctions d'intervenant des contacts (DP, commande, facture, SAV, commercial) | Seulement si l'`ID` est l'interlocuteur de COMM_TIERSINTERLOC (Q-PP5). |
| `PP_SALARIESFICHEHEURE` | Non repris (groupes de la fiche d'heures imprimée) | Les équipes sont déjà reprises au lot 7. |
| `PP_SYS` | Non repris | — |

## 3. Questions

- **Q-PP1. Étapes de la synthèse.** Les cases de `PP_ENTETECHANTIER` (réservation, principe envoyé ou validé, cotes 3D,
  dessin, fabrication, peinture, pose, PPSPS, DOE, réserves, terminé) sont-elles bien les étapes du suivi d'un chantier ?
  À quel service de LogiBTP chacune correspond-elle (bureau d'études, atelier, pose…) ?
- **Q-PP2. Types de notes.** Quels sont les codes réels de `TYPENOTE` et d'`ETAT` dans `PP_LIGNECHANTIER` ? Faut-il un
  type de note du CRM par code (achat, dessin, fabrication, pose, suivi, finition, direction), et quel service prend les
  tâches de chaque type ?
- **Q-PP3. Visas des plans.** Que signifient les lettres de `VALIDATIONARCHI`, `VALIDATIONOPC` et `VALIDATIONBC`
  (par exemple V = visé, R = refusé, O = avec observations) ? Qui sont l'OPC et le bureau de contrôle d'un chantier
  (intervenants de l'affaire) ?
- **Q-PP4. Atelier.** `PP_ATELIER.CODE` est-il le code du chantier ? Que valent `ETAT`, `MATIERE` et les `…ETAT` des
  postes (0 = à faire, 1 = en cours, 2 = fait ?), et les `…OP` sont-ils des trigrammes de salariés ?
- **Q-PP5. Fonctions des interlocuteurs.** `PP_FONCTIONINTERLOC.ID` est-il l'identifiant d'un interlocuteur de
  `COMM_TIERSINTERLOC` ?
- **Q-PP6. Données.** Pouvez-vous lancer sur votre base MDE la requête
  `SELECT 'ENT', count(*) FROM PP_ENTETECHANTIER UNION ALL SELECT 'LIG', count(*) FROM PP_LIGNECHANTIER UNION ALL
  SELECT 'PLAN', count(*) FROM PP_PLAN UNION ALL SELECT 'ATE', count(*) FROM PP_ATELIER`
  et me donner aussi les valeurs distinctes de `TYPENOTE` et `ETAT` ? Cela suffit pour trancher Q-PP2 et Q-PP4.

## 4. Découpage proposé (après les réponses)

1. Correspondances : tables `type_note_pp`, `etape_pp` et `visa_pp` dans `mde.json`, avec les cibles lues dans la base.
2. Notes : `PP_ENTETECHANTIER.NOTE` et `PP_LIGNECHANTIER` vers le CRM, avec les types de notes et les rappels.
3. Plans : `PP_PLAN` vers les plans, indices et visas du CRM.
4. Synthèse : parcours et états imposés depuis les cases de `PP_ENTETECHANTIER`.
5. Atelier : `PP_ATELIER` vers les ordres de la famille E et leurs étapes.

Critère de fin : sur le chantier de test, les notes, plans, visas, étapes et ordres sont cohérents avec MDE.
