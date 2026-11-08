# Application de terrain : écarts et suites, questions ouvertes

> Phase 1 de la procédure `analyse-lots` (08/11/2026). Source : TODO.md § « Application de terrain (poseurs, chefs
> d'équipe) » et [ANALYSE-TERRAIN.md](../documentation/conception/ANALYSE-TERRAIN.md) (écarts des lots 1 à 7, § 9).
> Une question sans réponse reste `OUVERT` dans le plan. **B** = bloquante (change la découpe ou le modèle de données).

## Décisions du 08/11/2026

Réponses de l'utilisateur : **TS1 a** (dernier indice diffusé visé ACCEPTE, indices plus récents ignorés) ; **TS2 b, avec
les autres** (case « Terrain » par plan : plans cochés en tête, les autres plans validés accessibles par « Voir tous les
plans ») ; **TS3 b** (budget hors ligne à part pour les plans) ; **TS4 a + b** (menu simplifié par défaut sur les pages
du terrain, raccourci vers le menu classique ; bandeau adaptatif pour toute l'application) ; **TS8 a** (conversion par
l'iPhone seulement, pas de bibliothèque de secours) ; **TS10 b** (tous les chantiers ouverts du service de la personne).
Toutes les autres questions : recommandation retenue. Plan : [terrain-suites.md](terrain-suites.md).

## 0. Points déjà levés par d'autres chantiers (à confirmer, puis à cocher dans TODO.md)

| Point du TODO | Constat dans le code |
|---|---|
| Lot 7 : heures de matériel non valorisées (aucun coût horaire) | Fait par le module Rentabilité, lot 5 : `materiel.mat_cout_horaire`, coût par type `rentabilite_cout_materiel`, heures de `pointage_materiel` comptées en déboursé du chantier pointé (`db/261_rentabilite_materiel.sql`). Les heures pointées du terrain y entrent donc déjà. |
| Lot 7 : relevés de matériel à la borne | Faits par [materiel-suites.md](materiel-suites.md), lots 3 et 4 (source `BORNE`, MO2). Reste seulement le **pointage des heures** de matériel à la borne (TS14). |

## 1. Lot 1 : pièces et gabarit

| N° | Question | Options | Recommandation | B |
|---|---|---|---|---|
| TS1 | Quels plans du suivi des validations (CRM, `crm_plan` / `crm_plan_indice`) montrer sur le terrain ? | a) le dernier indice **diffusé** dont un visa a l'effet ACCEPTE (BPE, VAO), en ignorant les indices plus récents en attente ; b) le dernier indice diffusé quel que soit le visa, avec une pastille du visa ; c) a, plus la mention « indice X en cours de visa » quand il y en a un plus récent | **c** : le poseur ne pose que sur un plan bon pour exécution, mais sait qu'un indice arrive. Indice refusé (REF) jamais montré | ✔ |
| TS2 | Quels plans : tous ceux de l'élément, ou seulement ceux qu'on coche ? | a) tous les plans rattachés au chantier, à ses marchés et à ses ordres (même périmètre que `dge_terrain`) ; b) case « Terrain » par plan dans le suivi des validations | **a** : la validation vaut déjà tri ; pas de nouvelle colonne | |
| TS3 | Plans gardés hors ligne : dans le budget de 25 Mo des pièces « Terrain » ? | a) même budget, plans d'abord ; b) budget à part | **a** | |
| TS4 | Bandeau trop large sur un téléphone : où corriger ? Le lot 2 a déjà fait défiler les menus sous 700 px. | a) gabarit tactile propre aux pages du terrain (bandeau réduit : retour, titre, cloche, menu) ; b) bandeau adaptatif pour toute l'application sous 700 px (navigation du cœur) | **b** : le défaut est commun ; un seul bandeau à maintenir. Il faut d'abord noter sur un téléphone ce qui déborde encore (largeur testée : 360 px) | ✔ |

## 2. Lot 2 : pointage à la ligne d'ordre (T8)

| N° | Question | Options | Recommandation | B |
|---|---|---|---|---|
| TS5 | Tâche d'origine `ligne` (`tac_origine_type`) : que porte le pointage ? | a) `poi_lig_id` = la ligne, `poi_ent_id` = son document, chantier de la ligne (`v_document_chantiers_part`) ; b) a, mais seulement quand la ligne est sur un ordre (E_PO), sinon niveau ordre | **a** : le niveau planifié est repris tel quel (décision T8) | |
| TS6 | Pointages déjà enregistrés au niveau ordre sur une tâche d'origine ligne : reprendre ? | a) script SQL rejouable qui renseigne `poi_lig_id` d'après la tâche ; b) non, seulement les nouveaux | **a** si aucune journée validée n'est touchée, sinon b | |
| TS7 | Saisie libre : proposer aussi le niveau ligne ? | a) non (chantier puis ordres, T8) ; b) oui, lignes de l'ordre choisi | **a** | |

## 3. Lot 3 : photos HEIC

| N° | Question | Options | Recommandation | B |
|---|---|---|---|---|
| TS8 | Comment convertir les photos HEIC (iPhone) ? | a) laisser l'iPhone convertir : Safari transcode en JPEG quand le champ fichier n'accepte pas `image/heic` (à vérifier sur un iPhone) ; b) conversion dans le navigateur par une bibliothèque WebAssembly (libheif, environ 1 à 2 Mo, chargée à la demande) ; c) conversion par le serveur au dépôt (Magick.NET, dépendance native) | **a**, puis **b** en secours si l'essai sur iPhone échoue ; c écarté (dépendance native lourde sur le serveur) | ✔ |
| TS9 | « Qualité d'origine » sur une photo HEIC : garder le HEIC ? | a) HEIC gardé tel quel en GED, plus un JPEG d'aperçu ; b) toujours converti en JPEG pleine taille | **b** : un seul format lisible partout (bureau, édition) | |

## 4. Lot 4 : hors ligne

| N° | Question | Options | Recommandation | B |
|---|---|---|---|---|
| TS10 | Saisie libre hors ligne : quels chantiers et ordres proposer ? | a) chantiers du planning de la personne à un mois près (même règle que le serveur) et leurs ordres ouverts, préchargés chaque jour ; b) tous les chantiers ouverts de son service ; c) inchangé | **a** : cohérent avec le refus du serveur | |
| TS11 | Ordre cherché par son numéro sans réseau | a) numéro saisi tel quel, gardé, résolu à l'envoi (refus signalé, règle T9) ; b) index des numéros des ordres préchargés (TS10) ; c) a et b | **c** : b trouve les ordres connus, a couvre le reste | |
| TS12 | Taille des photos gardées | Contrôle à la prise de vue contre la limite de dépôt de la GED (`TailleMaxDepot`, exposée au client) : photo réduite si besoin, « qualité d'origine » trop lourde refusée tout de suite avec la limite | **retenir** | |

## 5. Lot 5 : réception de pose

| N° | Question | Options | Recommandation | B |
|---|---|---|---|---|
| TS13 | Valeur juridique de la signature simple | Question pour votre conseil, pas pour le code. a) garder la signature simple (règlement eIDAS : recevable, la preuve repose sur l'horodatage serveur, l'empreinte SHA-256 et la conservation en GED) ; b) prestataire de signature avancée (connecteur externe, coût par signature) | **a**, avec une mention de la forme de signature sur le PV ; à confirmer de votre côté | |
| TS14 | Levée des réserves : suivre chaque réserve ? | a) table des réserves de la réception (libellé, photo, état levée, date, par qui), levée depuis le terrain avec photo, PV de levée signé ; la tâche du CRM reste comme alerte ; b) inchangé (une tâche du CRM, levée = tâche close) | **a** : la levée est une étape contractuelle (garantie de parfait achèvement) | ✔ |
| TS15 | Demande d'approvisionnement : articles de la bibliothèque | a) choix d'articles dans la bibliothèque simplifiée (TS17), ligne en texte libre toujours possible ; b) inchangé | **a**, dans le même lot que TS17 | |
| TS16 | Réception gardée hors ligne : quelle heure ? | a) heure de l'appareil gardée en plus de celle du serveur (comme `poi_hors_ligne_le`), les deux imprimées sur le PV (« signé le…, reçu le… ») ; b) inchangé | **a** | |

## 6. Lot 7 : second temps

| N° | Question | Options | Recommandation | B |
|---|---|---|---|---|
| TS17 | « Bibliothèque simplifiée » (T18) : pour quoi faire ? | a) choisir des articles pour une demande d'approvisionnement (recherche, favoris du chantier) ; b) a plus consultation de la fiche (photo, fiche technique, conditionnement) ; c) b plus ouvrages | **b** ; articles du chantier (lignes de ses marchés) gardés hors ligne | ✔ |
| TS18 | Pointage des heures de matériel à la borne | a) après la saisie des heures, durée sur les matériels affectés du jour (comme le terrain), source BORNE ; b) non | **a** | |
| TS19 | Réception d'une commande à options ou variantes (refusée aujourd'hui) | a) accepter, en ne proposant que les lignes retenues (options acceptées, variante choisie) ; b) garder le refus avec un message plus clair | **a** si la commande sait quelles lignes sont retenues, sinon **b** (à vérifier dans le module Document) | |
| TS20 | Avancement réel par marché quand un chantier en porte plusieurs | a) tâche rattachée au marché par son origine (ordre, ligne) ; tâches de niveau chantier exclues de la moyenne quand il y a plusieurs marchés, avec la mention ; b) inchangé (tout le chantier) | **a** | |

## 7. Lot 6 : SAV

| N° | Question | Options | Recommandation | B |
|---|---|---|---|---|
| TS21 | Temps et fournitures du bon de SAV dans la facture | a) bouton « Facturer » au bureau : facture **brouillon** préremplie (temps au taux horaire SAV, fournitures du bon) ; b) inchangé (transformation au bureau) | **a** ; jamais validée automatiquement | ✔ |
| TS22 | Si a : quel taux horaire ? | a) paramètre SAV de la société ; b) a, remplacé par un taux de la fiche client ; c) tarif de la bibliothèque (article de main-d'œuvre) | **c** : un article « Main-d'œuvre SAV » garde le prix, la TVA et le compte | |
| TS23 | Création d'une intervention hors ligne | a) ordre SAV créé sur l'appareil avec un numéro provisoire, créé à l'envoi (comme les documents hors ligne), clients limités à ceux déjà lus ; b) inchangé (en ligne seulement) | **a** | |
| TS24 | Chantier « Entretien et dépannage » : chrono des chantiers ? | a) chrono des chantiers pour les nouveaux, codes `SAV-<client>` existants gardés ; b) inchangé | **a** | |
| TS25 | Contrats d'entretien (Exécution, second temps) | a) analyse à part (`ANALYSE-CONTRATS-ENTRETIEN.md`), hors de ce plan ; b) dans ce plan | **a** : nouveau sujet (échéancier, visites planifiées, facturation périodique), trop gros pour un lot | ✔ |
