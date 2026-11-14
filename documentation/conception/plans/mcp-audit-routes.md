# Module MCP : audit des routes d'écriture pour les agents (lot 0)

> Plan : [mcp.md](mcp.md), lot 0 ; analyse : [ANALYSE-MODULE-MCP.md](../ANALYSE-MODULE-MCP.md). Audit du 13/11/2026, en lecture
> seule (aucun code modifié, aucun test lancé). Périmètre : documents (module Document et cœur), structure des affaires,
> bibliothèque, stock, exécution. Hors périmètre (lots ultérieurs) : terrain, pointage, CRM, GED, mail, relances,
> facturation électronique, comptabilité, rentabilité, sous-traitance, SAV hors facturation.

## 1. Lecture du dispositif actuel

- **Mode de droits d'une route** (`src/LogiBTP.Api/Btp/SpecialisationDroitsBtp.cs:103-232`, appliqué par
  `modules/droits/dotnet/LogiBTP.Droits.Web/Extensions.cs:62-113`) :
  - `Module` : une écriture passe dès que le profil a **une action autre que Consulter** sur le nœud ou l'un de ses
    descendants (`ReglesDroits.AccesSousArbre`, `modules/droits/dotnet/LogiBTP.Droits/ReglesDroits.cs:90-97`). Le contrôle
    de la route ne dit rien de l'action réellement portée : elle dépend du service appelé.
  - `Action` : une action précise du nœud (`ReglesDroits.Autorise`).
  - `Parametrage` : nœud `parametres`, Consulter en lecture, Modifier en écriture, ou administrateur (`Extensions.cs:89-97`).
- **Type d'écriture** (`src/LogiBTP.Api/Btp/EcrituresBtp.cs:21-98`) : format d'échange et de contrôle, sans effet sur les
  droits ; la déclaration la plus longue l'emporte.
- **Droit métier d'un document** : `DocumentService.VerifierDroit` (`modules/document/dotnet/LogiBTP.Documents.Web/DocumentService.cs:83-86`)
  passe par `IDroits.AutoriseAsync` sur le nœud `documents/{famille}/{code}` (`DocumentService.cs:71-74`) : c'est le seul
  point où le plafond d'un agent s'appliquera naturellement au lot 3.
- **Contrôles par identité, hors `IDroits`** (un plafond d'agent ne les voit pas) : `u.EstAdmin`, `u.ExigerParametres()`,
  `SpecialisationDroits`/`PeutGererAsync` du stock (`StockBtp.cs:163`, `ServiceStock.cs:216`, `MagasinBtp.cs:43-46`),
  `PeutValiderAsync` / `PeutControlerAsync` de l'exécution (`SpecialisationExecutionBtp.cs:122-147`),
  `PeutParametrer` de la bibliothèque (`ServiceBibliotheque.cs:16`), `PeutDeverrouiller` du document.

Légende des verdicts : **O** = outil possible (brouillon) ; **P** = proposition (validation humaine) ; **I** = interdit.
Fichiers abrégés : `Doc.Ext` = `modules/document/dotnet/LogiBTP.Documents.Web/Extensions.cs`, `DocSvc` = `DocumentService.cs`
du même dossier, `TrSvc` = `TransformationService.cs`, `Btp/` = `src/LogiBTP.Api/Btp/`.

## 2. Documents (module Document, groupe `/api`)

Mode de droits commun : `/api/documents`, `/api/lignes`, `/api/calcul`, `/api/cas-test`, `/api/historique` en **Module sur le nœud
`documents`** (`SpecialisationDroitsBtp.cs:159-163`) ; droit réel posé par le service sur le type de la pièce.

| Route | Définition | Droit réel (service) | Type d'écriture | Action réelle portée | Verdict |
|---|---|---|---|---|---|
| `POST /documents` | Doc.Ext:96 | CREER sur le type (DocSvc:297) | Document (Ecritures:38) | Crée un document au statut BROUILLON (DocSvc:310), numéro selon la numérotation du type | O |
| `POST /documents/avec-contenu` | Doc.Ext:102 | CREER puis MODIFIER (DocSvc:336-344, 365) | Document | Création + contenu complet en une transaction | O |
| `PUT /documents/{id}` | Doc.Ext:104 | MODIFIER (DocSvc:365), refus si statut non modifiable ou verrouillé (DocSvc:437-441), verrou et version contrôlés (Doc.Ext:107, DocSvc:366-370) | Document | Remplace entête et lignes, recalcul serveur. **Le statut n'est pas porté par le corps** : le serveur clone l'entête existant (DocSvc:376) et ne reprend que les champs listés (DocSvc:377-401 et `SpecialisationBtp.CopierEnteteSaisie`, SpecialisationBtp.cs:595-622) ; `ent_std_id`, `ent_verrouille`, numéro, indice restent côté serveur. Mais le corps peut changer tiers, rattachement (projet, affaire, chantier, marché), rédacteur, modèle, intervenants, dates de besoin/livraison | O (limité aux lignes et champs prévus) |
| `POST /documents/{id}/verrou` | Doc.Ext:113 | aucun droit propre (Module) | Action (Ecritures:40) | Prend ou renouvelle le verrou de modification | O (technique, lié au PUT) |
| `DELETE /documents/{id}/verrou` | Doc.Ext:115 | détenteur du jeton | Action | Libère le verrou | O (technique) |
| `DELETE /documents/{id}/verrou/force` | Doc.Ext:120 | `PeutDeverrouiller` (DocSvc, VerrouDocument.cs:65-69) | Action | Reprend la main sur le verrou d'un autre | I |
| `DELETE /documents/{id}` | Doc.Ext:125 | SUPPRIMER (DocSvc:1062), brouillon seulement (DocSvc:1063), pas si déjà transformé (DocSvc:1066) | Document | Suppression définitive et de ses liens | P |
| `POST /documents/{id}/envoyer` | Doc.Ext:131 | **VALIDER** (`Etape`, DocSvc:745) | Action | Pose `ent_envoye_le` (statut ENVOYE, DocSvc:840-846) ; **aucun courriel** (l'envoi réel passe par `/api/mail`), mais devient la validation de l'entreprise si pas d'approbation | I |
| `POST /documents/{id}/valider-tiers` | Doc.Ext:133 | VALIDER (DocSvc:745) | Action | Marque « accepté par le tiers » (devis accepté, situation visée), statut recalculé | I |
| `POST /documents/{id}/rejeter` | Doc.Ext:139 | VALIDER (DocSvc:745) | Action | Marque un rejet et son motif | I |
| `POST /documents/{id}/valider` | Doc.Ext:144 | VALIDER (DocSvc:486) + limite de montant (DocSvc:483, 497-519) | Action | **Validation** : numéro attribué (DocSvc:575-577), statut VALIDE, verrou, échéancier figé, soldes, point d'accroche de la spécialisation (mouvements de stock, comptabilité, marché) | P |
| `POST /documents/{id}/devalider` | Doc.Ext:137 | DEVALIDER ou FORCER (DocSvc:781) | Action | Nouvel indice en brouillon, ancienne version REMPLACE | I |
| `PUT /documents/{id}/numero` | Doc.Ext:135 | `PeutDeverrouiller` (DocSvc:169), FORCER en numérotation continue (DocSvc:173) | Action | Renumérote tout le groupe d'indices | I |
| `POST /documents/{id}/indices` | Doc.Ext:146 | CREER (DocSvc:1086) | Document (Ecritures:39) | Nouvel indice ; sur une situation validée, devient la référence et remplace l'ancienne (DocSvc:1090-1118) | P |
| `POST /documents/{id}/reference` | Doc.Ext:148 | MODIFIER (DocSvc:1132) | Action | Change l'indice de référence du groupe : modifie toutes les sommes « pièces valables » | P |
| `POST /documents/{id}/copie` | Doc.Ext:150 | CREER (DocSvc:1146) | Document | Copie en BROUILLON (DocSvc:1187), lien COPIE | O |
| `PUT /documents/{id}/origine` | Doc.Ext:162 | CREER (TracabiliteDocument.cs:78) | Action | Trace d'un import (format, fichier) | I (sans usage agent) |
| `POST /documents/{id}/transformer` | Doc.Ext:179 | TRANSFORMER sur la source et CREER sur la cible (TrSvc:178-179), source **validée** (TrSvc:183) | Document (Ecritures:39) | Crée la cible en brouillon, liens et reliquats. **Si la règle porte un type intermédiaire** (devis → facture : commande créée puis **validée d'office**, `db/169_transformations_ventes.sql:8-12`), `ValiderDans` (TrSvc:44-45) valide sans droit VALIDER | O pour les cibles sans intermédiaire ; P pour devis → facture |
| `POST /documents/plusieurs` | Doc.Ext:189 | TRANSFORMER + CREER (TrSvc:370-390, via `Preparer`) | Lot (Ecritures:41) | Une cible brouillon à partir de plusieurs sources (une section par source) | O |
| `POST /documents/{id}/sources` | Doc.Ext:191 | TRANSFORMER + CREER + MODIFIER (TrSvc:394-436, `EnregistrerDans`) | Action | Ajoute des sources à un brouillon | O |
| `POST /lignes/{ligId}/soldes` | Doc.Ext:183 | TRANSFORMER (TrSvc:812) | Action (Ecritures:42) | Solde un reliquat sans document (irréversible par l'interface) | P |
| `PUT /documents/{id}/echeances` | Doc.Ext:210 | MODIFIER (DocSvc:1047) | Action | Réécrit l'échéancier d'une pièce | P |
| `POST /documents/{id}/echeances/recalculer` | Doc.Ext:212 | MODIFIER (DocSvc:1055) | Action | Recalcule l'échéancier | P |
| `POST /calcul` | Doc.Ext:217 | aucun | Lecture (Ecritures:29) | Recalcul sans écriture | O (lecture) |
| `POST /cas-test` | Doc.Ext:218 | **aucun droit propre** | **Lecture** (Ecritures:29) | **Écrit réellement** dans `calcul_cas_test` (DocSvc:1234-1256) : le type déclaré est faux | I |

Paramétrage du module Document, tous en écriture réservée à l'administrateur ou à `parametres/Modifier` : `PUT /types-document/{code}/textes`
(Doc.Ext:56), `/unites/parametrage` (65), `/modes-reglement` (68), `/types-document/{code}/numerotation` (71), `/etiquettes-ligne`
(76), `/couleurs-type-prix` (78), `/vues-document` et `DELETE /vues-document/{id}` (81-82), `/parametres-documents/seuils-solde` (197),
`/regles-documents` (201), `/conditions-paiement` (205), `/parametres-documents/conditions-paiement` (208). Droits :
`SpecialisationDroitsBtp.cs:128-131, 164-174` (Parametrage ou Module `documents` avec garde de service). **Verdict : I.**

### Statut et validation implicite : repérage

1. **Changement de statut par `PUT` du document complet** : non reproductible tel quel (DocSvc:376-401, statut jamais repris du
   corps), mais **aucun test ne le fige** (recherche `EntStdId` dans les tests du module sans résultat) ; le même mécanisme
   s'applique à `POST /documents/avec-contenu` (DocSvc:343, `EnregistrerDans`) et à `AjouterSources` (TrSvc:431).
   Les changements de statut passent par des routes dédiées (valider, envoyer, valider-tiers, rejeter, devalider) et par du SQL direct
   (voir § 3, § 5 : `Consultations.RetenirAsync`, annulation d'une saisie du magasin, annulation d'une clôture).
2. **`ValiderDans`** (DocSvc:527) valide **sans contrôler VALIDER** ni la limite de montant (commentaire DocSvc:522-526) ; appelée par :
   `Valider` après contrôle (DocSvc:488), `Transformer` pour le document intermédiaire (TrSvc:45) et
   `AnnulerParAvoirDans` (TrSvc:466), elle-même appelée par `POST /structure/documents/{id}/annulation` (`Btp/Structure.cs:324`) et
   `RejetFactureBtp.cs:137`.
3. **Autres validations implicites côté cœur**, exécutées sous l'identité de l'appelant avec son droit VALIDER (donc contrôlées par
   `VerifierDroit`, mais **déclenchées par une route qui ne s'annonce pas comme une validation**) : `Acomptes.Emettre` (`Btp/Acomptes.cs:166`),
   pièces du magasin (`MagasinBtp.cs:105`), pièce d'écarts d'une clôture (`InventaireComptableBtp.cs:120`). `ApresEtapesAsync`
   appelle `Envoyer` / `ValiderTiers` (`SpecialisationExecutionBtp.cs:193-194`) avec le droit VALIDER de l'appelant, l'échec étant
   rendu en avertissement.
4. **Envoi réel vers l'extérieur** : `Envoyer` du document ne fait que dater. Les courriels partent de `/api/mail`, de
   `Btp/Consultations.cs:141` (voir § 3) et de `MailBtp.cs:262` ; la plateforme de facturation électronique et les relances sont hors
   périmètre de ce lot mais sont **I** par défaut.

## 3. Structure des affaires

Droits : `/api/structure` Module sur le nœud `structure` (`SpecialisationDroitsBtp.cs:183`), type d'écriture Action par défaut
(`EcrituresBtp.cs:97`), Document pour `/structure/documents` et `/structure/marches/{id}/documents` (`EcrituresBtp.cs:41-42`), Parametrage
pour la révision (`EcrituresBtp.cs:78, 97`). **Aucun droit métier n'est vérifié par la route elle-même** sauf mention contraire : un
profil avec n'importe quelle écriture sur `structure` passe.

| Route | Définition | Contrôle réel | Action réelle portée | Verdict |
|---|---|---|---|---|
| `PUT /structure/documents/{id}/rattachement` | Btp/Structure.cs:90 | aucun (pas de `VerifierDroit`, pas de `VerifierModifiable`) | Change projet, affaire, chantier, marché d'un document **même validé**, puis `f_marche_commande` (base ou avenant du marché, montants recalculés) | P |
| `PUT /structure/documents/{id}/arc` | Structure.cs:119 | aucun ; seulement commandes fournisseur et sous-traitance (Structure.cs:122) | Accusé de réception d'une commande validée, historisé | P |
| `PUT /structure/documents/{id}/lignes/{ligId}/livraison` | Structure.cs:150 | `ControlerLivraisonLigne` (Structure.cs:68) | Date de livraison d'une ligne de commande validée, repris par les prévisions d'approvisionnement | P |
| `POST /structure/marches/{id}/documents` | Structure.cs:174 | TRANSFORMER + CREER via `TransformerPlusieurs`, puis MODIFIER (Structure.cs:205) | BL, facture ou situation du marché en brouillon ; **numéro de situation attribué dès la création** (Structure.cs:197) et révision des prix appliquée (Structure.cs:204) | O pour un BL ; P pour facture et situation |
| `PUT /structure/marches/{id}/sans-avancement` | Structure.cs:212 | aucun | Marque « pas d'avancement » d'un mois (sort le marché des marchés à facturer) | P |
| `PUT /structure/acomptes/mode` | Structure.cs:224 | administrateur (commentaire Structure.cs:223) | Mode d'acomptes de la société | I |
| `POST /structure/marches/{id}/acomptes` | Structure.cs:226 | CREER/MODIFIER du type (via `documents.Creer` / `Enregistrer`, `Btp/Acomptes.cs:84-148`) | Demande d'acompte en brouillon + ligne `marche_acompte` | P |
| `POST /structure/acomptes/{id}/emettre` | Structure.cs:230 | VALIDER (via `Valider`, Acomptes.cs:166) puis TRANSFORMER (Acomptes.cs:169) | **Valide** la demande et crée la facture ou le reçu d'acompte (pièce comptable) | I |
| `PUT /structure/marches/{id}/revision` | Structure.cs:241 | aucun repéré | Paramètres de révision de prix du marché | P |
| `POST /structure/marches/{id}/revision/facture` | Structure.cs:243 | CREER (`RevisionPrix.CreerFactureAsync`, RevisionPrix.cs:545) | Facture de régularisation en brouillon | P |
| `PUT /structure/revision/index`, `/valeurs`, `/formules` | Structure.cs:247-253 | Parametrage (droits : `EcrituresBtp.cs:78, 97`) | Catalogue des index et formules | I |
| `PUT /structure/marches/{id}/postes` | Structure.cs:256 | droit MODIFIER de la fiche marché, vérifié par la fiche (commentaire Structure.cs:215) | Postes de pied du marché (retenue de garantie, etc.) | P |
| `POST /structure/documents/{id}/annulation` | Structure.cs:312 | CREER du type d'avoir (TrSvc:451) ; **VALIDER non contrôlé** (`ValiderDans`, TrSvc:466) | **Annule en cascade** la pièce et les suivantes du marché par avoirs **validés d'office**, statut Annulé, nouvel indice de situation | I |
| `POST /structure/documents` | Structure.cs:335 | aucun | **Lecture** (graphe des documents d'un périmètre) déclarée `Document` à l'écriture (`EcrituresBtp.cs:41`) : type inexact | O (lecture) |
| `POST /structure/documents/{id}/consultation` | `Btp/Consultations.cs:139` | aucun repéré dans la route ; copie via `documents` | Copie d'une demande de prix pour consulter d'autres fournisseurs | P |
| `POST /structure/documents/{id}/consultation/envoyer` | Consultations.cs:141 | aucun repéré | **Courriel envoyé à des fournisseurs** (`mail.EnvoyerAsync`, Consultations.cs:106), confirmation massive posée par le code | I |
| `POST /structure/documents/{id}/consultation/retenir` | Consultations.cs:143 | aucun | SQL : les autres offres du lot passent NON_RETENU (Consultations.cs:127-132) sans historique ni droit de type | P |
| `POST /structure/marches/{id}/retenue/liberer` | `Btp/RetenuesMarche.cs:114` | aucun (règle métier seulement, RetenuesMarche.cs:93-99) | Libère la retenue de garantie : modifie les dates d'échéances (RetenuesMarche.cs:101-105) | I |

Fiches de la structure (module Fiche, `/api/fiches/{type}`, types `projet`, `affaire`, `chantier`, `marche` : `src/LogiBTP.Domaine/Codes.cs:13-16`) :
mode **Module** sur `fiches/{type}` (`SpecialisationDroitsBtp.cs:175`), type Fiche (`EcrituresBtp.cs:34`), droit réel par `ServiceFiche.Exiger` sur
`fiches/{type}` (`modules/fiche/dotnet/LogiBTP.Fiches.Web/ServiceFiche.cs:44-56`).

| Route | Définition | Droit réel | Verdict |
|---|---|---|---|
| `POST /fiches/{type}` | `modules/fiche/.../Extensions.cs:43` | MODIFIER (ServiceFiche.cs:481) | P (affaire, chantier, marché) ; I pour `personne`, `individu`, `salarie` (RGPD, garde-fous) |
| `PUT /fiches/{type}/{id}` | Fiches Extensions.cs:48 | MODIFIER (ServiceFiche.cs:415) ; changement de code : MODIFIER_CODE | P ; I si le code change |
| `DELETE /fiches/{type}/{id}` | Fiches Extensions.cs:49 | SUPPRIMER (ServiceFiche.cs:520) | I |
| `POST /fiches/{type}/{id}/confidentiel`, `/secret` | Fiches Extensions.cs:55-56 | VOIR + CONFIDENTIEL (ServiceFiche.cs:287) | I : **lecture de données masquées par POST** (type Action, `EcrituresBtp.cs:35`) |
| `POST /fiches/{type}/{id}/verrou`, `DELETE …/verrou` | Fiches Extensions.cs:57-58 | MODIFIER, DEBLOQUER si reprise forcée (ServiceFiche.cs:331-332) | O (technique) ; I avec `forcer` |
| `PUT /fiches/{type}/parametrage`, `/chrono` | Fiches Extensions.cs:42, 46 | Parametrage (`SpecialisationDroitsBtp.cs:132-133`) | I |
| `POST /fiches/{type}/code` | Fiches Extensions.cs:44 | VOIR | O (lecture, type Lecture, `EcrituresBtp.cs:36`) |

## 4. Bibliothèque

Droits : `/api/bibliotheque` Module sur le nœud `bibliotheque` (`SpecialisationDroitsBtp.cs:186`) ; type Parametrage par défaut, Action
pour `/elements`, Lot pour `/recalcul`, Fichier pour `/tarifs/import` (`EcrituresBtp.cs:47-48`). Groupe en transaction (`Extensions.cs:30`,
`modules/bibliotheque/dotnet/LogiBTP.Bibliotheque.Web/Extensions.cs`, abrégé `Bib.Ext`). Les **éléments** eux-mêmes (articles, ouvrages) sont
des fiches de type `element` : `POST/PUT/DELETE /api/fiches/element` (§ 3, droit MODIFIER ou SUPPRIMER sur `fiches/element`).

| Route | Définition | Contrôle réel | Action réelle portée | Verdict |
|---|---|---|---|---|
| `PUT /bibliotheque/parametres` | Bib.Ext:32 | `PeutParametrer` = administrateur (`ServiceBibliotheque.cs:16, 38, 62`) | Scénarios de calcul, coefficients par défaut | I |
| `PUT/DELETE /bibliotheque/bibliotheques`, `/familles`, `/regroupements`, `/natures`, `/periodes` | Bib.Ext:35-52 | administrateur (`Parametrage(u)`, ServiceBibliotheque.cs:92-257) | Référentiels de la bibliothèque (une période peut changer les coefficients de tout le chiffrage) | I |
| `POST /bibliotheque/recalcul` | Bib.Ext:53 | **aucun** contrôle de service (ServiceBibliotheque.cs:269-285) ; seul le mode Module `bibliotheque` | Recalcule les coefficients puis les prix de **tous** les éléments non imposés | I |
| `POST /bibliotheque/elements/{id}/tarifs` | Bib.Ext:60 | `PeutModifierTarifs`, **vrai par défaut et non surchargé** par le cœur (ServiceBibliotheque.cs:18, 403 ; aucune surcharge dans `src/`) | Tarif fournisseur ; peut changer le PA de l'élément et le prix des ouvrages qui l'emploient | P |
| `DELETE /bibliotheque/elements/{id}/tarifs/{tarif}` | Bib.Ext:61 | idem (ServiceBibliotheque.cs:536) | Suppression d'un tarif, PA recalculé | P |
| `POST /bibliotheque/tarifs/import` | Bib.Ext:63 | idem (ServiceBibliotheque.cs:442) | Import en masse de tarifs d'un fournisseur | P |

## 5. Stock (module Stock et cœur)

Droits : `/api/stock` Module sur le nœud `stock` (`SpecialisationDroitsBtp.cs:223`) ; Parametrage pour `/stock/parametres` et
`/stock/clotures` (146-147) ; `/api/stock/bornes` Module sur `pointage/bornes` (229). Type d'écriture : Action par défaut, Parametrage pour
`marques` et `parametres`, Lot pour `revaloriser`, `marquer`, `inventaires/{id}/generer` et `…/valider`, Fichier pour les certificats
(`EcrituresBtp.cs:77, 94-96`). Dans le module, **le contrôle réel est `ExigerGestion` = `PeutGererAsync`** : administrateur ou membre d'un
service de nature LOGISTIQUE (`Btp/StockBtp.cs:163-171`), c'est-à-dire un contrôle par identité, étranger au module Droits.
Fichiers abrégés : `Stk` = `modules/stock/dotnet/LogiBTP.Stock.Web/`.

| Route | Définition | Contrôle réel | Action réelle portée | Verdict |
|---|---|---|---|---|
| `PUT /stock/parametres` | Stk/ServiceStock.cs:537 | Parametrage | Paramètres du stock (dont future `proche_mini`) | I |
| `PUT /stock/lieux/{id}/emplacements` | ServiceStock.cs:540 | gestionnaire | Emplacements d'un dépôt | I |
| `POST /stock/articles/{id}/pmp` | ServiceStock.cs:548 | gestionnaire (ServiceStock.cs:359) | Réévaluation du PMP (valorisation) | I |
| `PUT /stock/articles/{id}/emplacements` | ServiceStock.cs:550 | gestionnaire | Emplacements d'un article | P |
| `POST /stock/revaloriser` | ServiceStock.cs:558 | gestionnaire (ServiceStock.cs:350) | Revalorise tous les articles | I |
| `PUT /stock/lieux/{id}/parametres` | Stk/ServiceApprovisionnement.cs:189 | gestionnaire (ServiceApprovisionnement.cs:70) | Paramètres d'approvisionnement du lieu | I |
| `PUT /stock/lieux/{id}/seuils` | ServiceApprovisionnement.cs:191 | gestionnaire (ServiceApprovisionnement.cs:91) | Mini / maxi par article | P |
| `POST /stock/lieux/{id}/commander` | ServiceApprovisionnement.cs:194 | gestionnaire (ServiceApprovisionnement.cs:175) puis CREER et MODIFIER sur A_COMMANDE (`Btp/StockApprovisionnementBtp.cs:106-139`) | **Commandes fournisseur en BROUILLON**, une par fournisseur, sans validation ni envoi | O (base de la demande de réappro, Q10) |
| `POST /stock/inventaires`, `PUT/DELETE /stock/inventaires/{id}` | Stk/ServiceInventaire.cs:598-601 | gestionnaire | Lot d'inventaire (non validé) | P |
| `POST /stock/inventaires/{id}/bordereaux`, `PUT/DELETE /stock/bordereaux/{id}` | ServiceInventaire.cs:606, 611-612 | gestionnaire | Saisie de comptage | P |
| `POST /stock/inventaires/{id}/generer` | ServiceInventaire.cs:607 | gestionnaire (Lot) | Génère les lignes du lot | P |
| `POST /stock/inventaires/{id}/valider` | ServiceInventaire.cs:609 (service 414-460) | gestionnaire | **Comptages datés écrits**, réévaluation du PMP : le stock change | I |
| `POST /stock/inventaires/{id}/annuler` | ServiceInventaire.cs:610 | gestionnaire | Annule un lot | I |
| `POST /stock/articles/{id}/corriger` | ServiceInventaire.cs:613 (service 485-497) | gestionnaire | **Crée un lot et le valide** (`ValiderLotAsync`, ServiceInventaire.cs:497) | I |
| `PUT /stock/articles/{id}/dotation` | ServiceInventaire.cs:617 | gestionnaire | Dotation d'un article | P |
| `PUT /stock/marques` | ServiceInventaire.cs:620 | gestionnaire, type Parametrage | Marques | I |
| `POST /stock/marquer` | ServiceInventaire.cs:621 (service 536) | gestionnaire (Lot) | Marquage d'articles | P |
| `PUT /stock/articles/{id}/suivi`, `PUT /stock/lots/{id}` | Stk/ServiceTracabilite.cs:243, 249 | gestionnaire (ServiceTracabilite.cs:138, 221) | Mode de suivi (lot, série) et lot | P |
| `POST /stock/magasin/sorties`, `/retours` | `Btp/MagasinBtp.cs:132, 144` | magasinier ou administrateur (MagasinBtp.cs:43-46) | Crée la pièce S_TRANSFERT / S_SORTIE **et la valide** (`documents.Valider`, MagasinBtp.cs:105) : mouvements de stock immédiats, dotation marquée | P |
| `POST /stock/magasin/a-valider/{id}` | `Btp/StockBorneBtp.cs:74` | `PeutTraiterAsync` (identité, StockBorneBtp.cs:80) | Accepte ou **refuse** une saisie de borne ; le refus passe la pièce à Annulé par SQL (StockBorneBtp.cs:84-86) | I |
| `PUT /stock/bornes/{id}/depot` | StockBorneBtp.cs:50 | `EstAdmin` (StockBorneBtp.cs:52) | Dépôt d'une borne | I |
| `POST /pointage/borne/stock` | StockBorneBtp.cs:104 | route publique, jeton d'appareil et PIN | Sortie ou retour saisi à la borne | I |
| `POST /stock/clotures` | `Btp/ClotureStockBtp.cs:119` | Parametrage (`SpecialisationDroitsBtp.cs:147`) | Clôture : crée une pièce d'écarts comptable **validée** (`InventaireComptableBtp.cs:120`) | I |
| `POST /stock/clotures/{id}/annulation` | ClotureStockBtp.cs:158 | Parametrage, refus si transférée en comptabilité (ClotureStockBtp.cs:164) | Passe la pièce à Annulé par SQL (ClotureStockBtp.cs:168) | I |
| `POST /stock/lots/{id}/certificats` | `Btp/LotsStockBtp.cs:161` | aucun repéré (Module `stock`) | Dépôt d'un fichier dans la GED du lot | I |

`StockApprovisionnementBtp.cs` ne déclare aucune route : il fournit `CreerCommandesAsync` (ligne 106) au module.

## 6. Exécution (module Execution et cœur)

Droits : `/api/execution` Module sur le nœud `execution` (`SpecialisationDroitsBtp.cs:220`) ; Parametrage pour `/execution/parcours-modeles` et
`/execution/sav-parametres` (151-152) ; type d'écriture Action par défaut, Parametrage pour `delegations`, `etats`, `etats-types`,
`parcours-modeles`, `sav-parametres`, `types`, Lot pour `etats-types/{type}/appliquer` (`EcrituresBtp.cs:60-62, 81`).
Fichiers abrégés : `Exe` = `modules/execution/dotnet/LogiBTP.Execution.Web/`.

| Route | Définition | Contrôle réel | Action réelle portée | Verdict |
|---|---|---|---|---|
| `PUT /execution/parcours-modeles` | Exe/Extensions.cs:28 | `ExigerParametres` (Exe/ServiceExecution.cs:159) | Modèles de parcours | I |
| `PUT /execution/elements/{type}/{id}/parcours` | Exe/Extensions.cs:32 | aucun droit propre repéré | Parcours d'un élément (services et amonts) | P |
| `PUT /execution/elements/{type}/{id}/services/{srv}/etat` | Exe/Extensions.cs:34 | aucun droit propre repéré | État **manuel** d'un service, qui supplante l'état calculé | P |
| `PUT /execution/etats`, `PUT /execution/etats-types/{type}`, `POST …/appliquer` | Exe/Extensions.cs:38-42 | `ExigerParametres` (Exe/ServiceEtapes.cs:113) | Catalogue des états et états par type | I |
| `POST /execution/ordres/{id}/etapes/recalculer` | Exe/Extensions.cs:44 | `PeutValiderAsync` (Exe/ServiceEtapes.cs:399) | Rend la main au calcul des dates imposées | P |
| `PUT /execution/ordres/{id}/etapes/{code}` (actions PREVOIR, RESSOURCE, DUREE) | Exe/Extensions.cs:45 ; Exe/ServiceEtapes.cs:470-481 | `PeutValiderAsync` (responsable de l'ordre, membre du service ou administrateur ; SpecialisationExecutionBtp.cs:122-) | Planification d'une étape : dates prévues, ressource, durée ; déplace des tâches du planning | P |
| `PUT /execution/ordres/{id}/etapes/{code}` (actions VALIDER, ANNULER, CONTROLER, DECONTROLER) | Exe/ServiceEtapes.cs:428-460 | `PeutValiderAsync` (ServiceEtapes.cs:430, 449), `PeutControlerAsync` (460) | **Validation métier d'étape** : état d'exécution déduit, tâches du planning TERMINEE, **statuts documentaires Transmis / Pris en charge** par `Envoyer` / `ValiderTiers` (`SpecialisationExecutionBtp.cs:171-205`) | I |
| `PUT /execution/types/{code}` | `Btp/ExecutionBtp.cs:259` | `EstAdmin` (ExecutionBtp.cs:228) | Activation d'un type d'ordre | I |
| `PUT /execution/documents/{id}` | ExecutionBtp.cs:262 (service 95-135) | **aucun droit sur le type d'ordre** ; ordre ni annulé ni remplacé | SQL direct : état d'exécution, motif, service, responsable, dates prévues, ressource, historique ; un blocage crée une **tâche CRM** au service du motif | P |
| `PUT /execution/delegations/{srv}` | `Btp/DelegationsControle.cs:39` | responsable du service, administrateur ou `PeutModifierParametres` (DelegationsControle.cs:67) | Délégations du contrôle N+1 | I |
| `PUT /execution/sav-parametres` | `Btp/FacturationSavBtp.cs:151` | `ExigerParametres` | Paramètres de facturation SAV | I |
| `POST /execution/documents/{id}/facturation-sav` | FacturationSavBtp.cs:187 | CREER du type facture | Facture **brouillon** du bon de SAV | P |

Création des ordres : il n'existe pas de route dédiée, elle passe par `POST /documents/{id}/transformer` (§ 2) avec les règles
`transformation_autorisee` (par exemple E_OE → E_BE, E_DAP… : `db/208_execution_types.sql:47-58`) ; ces transformations n'ont pas
d'intermédiaire validé, donc **O**. Les routes du terrain (`/api/terrain/*`, réserves, réceptions) sont hors périmètre du lot.

## 7. Points à traiter

### Lot 3 : plafond appliqué par le module Droits

1. **Refus des écritures en mode Module pour un agent** : le contrôle se fait dans l'intergiciel,
   `modules/droits/dotnet/LogiBTP.Droits.Web/Extensions.cs:98-110` (branche `Module`/`Action`) et `ReglesDroits.AccesSousArbre`
   (`ReglesDroits.cs:90-97`). Une liste blanche **doit** laisser passer au moins les routes du module Document dont le service applique
   `VerifierDroit` : `/api/documents` (`SpecialisationDroitsBtp.cs:159`), `/api/lignes` (163), `/api/calcul` (160) et `/api/fiches/{type}`
   (175, droit par `ServiceFiche.Exiger`), sinon les outils du lot 7 sont inutilisables. Toute autre route `Module` (notamment
   `/api/structure` 183, `/api/bibliotheque` 186, `/api/stock` 223, `/api/execution` 220) reste refusée en écriture, car elles n'ont
   **pas de droit métier propre** (§ 3 à 6).
2. **`ValiderDans` ignoré sans VALIDER** : `DocumentService.cs:527` ne vérifie rien. Ajouter la lecture de
   `IDroits.AutoriseAsync(u, noeud, VALIDER)` quand `u.Agent` est posé, avec comportement défini pour chaque appelant :
   `TransformationService.cs:44-45` (document intermédiaire devis → facture ; refuser la transformation plutôt que de créer un
   intermédiaire non validé), `TransformationService.cs:466` (avoir d'annulation ; refuser), appels de `AnnulerParAvoirDans`
   (`Btp/Structure.cs:324`, `Btp/RejetFactureBtp.cs:137`). Un agent sans VALIDER ne doit jamais atteindre ces chemins.
3. **Contrôles par identité hors `IDroits`** : un agent qui porte le compte d'un administrateur ou d'un magasinier les franchit tous.
   Prévoir qu'`Utilisateur.EstAdmin` soit faux pour un agent et que `ExigerParametres` le refuse (`socle`), et rendre `PeutGererAsync`
   (`StockBtp.cs:163`), `MagasinBtp.Exiger` (`MagasinBtp.cs:43-46`), `PeutTraiterAsync` (`StockBorneBtp.cs:80`), `PeutValiderAsync` /
   `PeutControlerAsync` (`SpecialisationExecutionBtp.cs:122-147`), `DelegationsControle.cs:67` et `PeutDeverrouiller` (`VerrouDocument.cs:67`,
   `DocumentService.cs:169`) sensibles à `Utilisateur.Agent`.
4. **Routes sans contrôle métier propre, à protéger par le refus du point 1** (écriture réelle derrière un simple mode Module) :
   `Structure.cs:90, 119, 150, 212, 241, 256`, `Consultations.cs:139-143` (dont l'envoi de courriels), `RetenuesMarche.cs:114`,
   `ExecutionBtp.cs:262`, `LotsStockBtp.cs:161`, `ServiceBibliotheque.cs:269` (recalcul), tarifs (`ServiceBibliotheque.cs:18`,
   `PeutModifierTarifs` toujours vrai).
5. **Routes qui valident ou annulent sous un autre nom** (à classer I pour un agent, le plafond VALIDER ne suffit pas à les repérer) :
   `Structure.cs:230` (émission d'acompte, `Acomptes.cs:166`), `Structure.cs:312` (annulation par avoirs), `MagasinBtp.cs:132, 144`,
   `ServiceInventaire.cs:609, 613`, `ClotureStockBtp.cs:119, 158`, `StockBorneBtp.cs:74`, `Consultations.cs:143` (changement de statut
   NON_RETENU par SQL).
6. **Lecture par POST de données masquées** : `/api/fiches/{type}/{id}/confidentiel` et `/secret` (`Fiches Extensions.cs:55-56`) sont
   déclarées Action (`EcrituresBtp.cs:35`) mais lèvent le masquage RGPD : à refuser pour un agent même avec une liste blanche de
   `/api/fiches/{type}`. Même remarque pour `POST /cas-test` (`Doc.Ext:218`, déclaré Lecture alors qu'il écrit) : retirer de la liste
   blanche de `/api/documents`.
7. **Type d'écriture inexact** à corriger au passage (sans effet sur les droits, mais l'agent classe ses outils d'après le type) :
   `/api/cas-test` (`EcrituresBtp.cs:29`, Lecture alors que la route écrit) et `/api/structure/documents` (`EcrituresBtp.cs:41`, Document
   alors que la route lit).

### Lot 7 : outils d'écriture des devis

1. **Refus du changement de statut par `PUT`** : le corps du `PUT /documents/{id}` ne porte pas le statut (`DocumentService.cs:376-401`),
   mais **aucun test ne le prouve**. Ajouter au jeu du cœur un cas : `PUT` avec `ent_std_id`, `ent_verrouille`, `ent_numero`, `ent_indice`
   modifiés, sans effet ; et, côté outil `modifier_lignes`, comparer le document renvoyé au document lu et refuser toute différence sur
   ces champs (outil construit à partir du document lu, jamais d'un corps libre).
2. **Champs d'entête modifiables par le même `PUT`** : tiers (`EntTiersId`, `DocumentService.cs:393`), rattachement `EntProjetId`,
   `EntAffaireId`, `EntChantierId`, `EntMarcheId`, rédacteur, intervenants (`SpecialisationBtp.cs:597-604`). Les opérations de
   `modifier_lignes` ne touchent que les lignes ; tout changement d'entête doit passer par un outil distinct (tiers désigné à la
   création seulement, rattachement refusé : il n'existe pas de droit propre sur `PUT /structure/documents/{id}/rattachement`).
3. **Empreinte de version et verrou** : le `PUT` exige `ent_version` identique (`DocumentService.cs:366-370`) et refuse si un autre
   détient le verrou (`Doc.Ext:107`). L'outil prend le verrou (`POST /documents/{id}/verrou`), applique, enregistre, puis libère
   (`DELETE …/verrou`) ; ne jamais appeler `…/verrou/force` (`Doc.Ext:120`).
4. **`transformer` : cibles permises** : uniquement les règles **sans type intermédiaire**. Devis → facture valide une commande
   intermédiaire d'office (`db/169_transformations_ventes.sql:8-12`, `TransformationService.cs:44-45`) : à refuser dans l'outil ou
   à ne rendre qu'en proposition. Devis → commande reste brouillon, la source devant être validée (`TransformationService.cs:183`).
5. **`creer_devis`** : s'appuie sur `POST /documents/avec-contenu` (`Doc.Ext:102`) ou `POST /documents/{id}/copie` (`Doc.Ext:150`) ; les
   deux créent un brouillon sans numéro définitif pour les numérotations continues (numéro attribué à la validation, `DocumentService.cs:575-577`).
6. **Routes à ne pas exposer en outil** : toutes les lignes **I** et **P** des § 2 à 6 ; en particulier `valider`, `envoyer`,
   `valider-tiers`, `rejeter`, `devalider`, `numero`, `reference`, `soldes`, `plusieurs` côté structure (`Structure.cs:174` crée des numéros de
   situation dès la création) et `rattachement`.
7. **Origine des écritures** : l'historique des documents est écrit par `Historiser` (`DocumentService.cs`, actions MODIFICATION, VALIDATION,
   ENVOI, REJET, DEVALIDATION, NUMERO) ; les écritures SQL directes de la structure (`Structure.cs:119-170`, `Consultations.cs:127`,
   `StockBorneBtp.cs:84`, `ClotureStockBtp.cs:168`) n'écrivent pas toutes dans `document_historique` : l'origine AGENT n'y sera pas
   tracée, d'où leur exclusion des outils.
