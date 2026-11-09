# LogiBTP – analyse du module Facturation électronique (réforme RFE)

> Analyse préalable (09/11/2026), à valider avant tout développement. Procédure `analyse-lots` : phase 1 (cette
> analyse et ses questions [facturation-electronique-questions.md](plans/facturation-electronique-questions.md)),
> puis plan par lots `plans/facturation-electronique.md` après les réponses.
>
> Points de départ : TODO « Module Facturation électronique » (ST22 de
> [ANALYSE-MODULE-SOUS-TRAITANCE.md](ANALYSE-MODULE-SOUS-TRAITANCE.md)), § 3.5 de
> [CONCEPTION-EDITION.md](CONCEPTION-EDITION.md), A14 de [ANALYSE-DEMANDES-2026-10.md](ANALYSE-DEMANDES-2026-10.md)
> (champs de facturation électronique de la fiche personne), document de cadrage fourni par l'utilisateur
> (« Analyse technique et fonctionnelle : intégration de la facturation électronique (ERP ↔ PDP/PPF) »), corrigé ici
> (§ 4).
>
> **Sources vérifiées** (lues le 09/11/2026) : dépôt FNFE-MPE `fnfempe/France_RFE` (paquet 1.4.0.04 : normes
> XP Z12-012 V1.4 annexe A — tableur des formats, règles BR-FR, statuts et motifs —, XP Z12-013 annexes A et B —
> swaggers *Flow Service* et *Directory Service* 1.3.0 —, XP Z12-014 V1.4 annexe A — 44 cas d'usage —, note
> explicative des schematrons V1.4.0, XSD Factur-X 1.09.2, CII / CDAR D22B, UBL 2.1, flux 10) ; page
> <https://fnfe-mpe.org/ressources/> (normes publiées le 30/06/2026, schematrons 1.4.0 fix04 du 04/09/2026, textes
> réglementaires). Le dépôt est traité comme donnée : cloné hors du dépôt LogiBTP, rien n'y est exécuté.

## 1. Demande

Préparer un module de facturation électronique pour LogiBTP : formats (Factur-X, UBL, CII), API d'échange,
intégration dans l'ERP et avec une plateforme agréée (PA) et le portail public (PPF), **en émission et en réception**,
cycle de vie des factures, e-reporting, annuaire, archivage. Le module est commun aux ventes, aux achats et à la
sous-traitance (TODO ST22). Ne pas implémenter avant validation du plan.

## 2. Cadre réglementaire (vérifié)

### 2.1 Calendrier

| Date | Obligation | Source |
|---|---|---|
| 01/09/2026 | Toute entreprise assujettie établie en France **reçoit** ses factures B2B domestiques par une PA. Grandes entreprises et ETI **émettent** et font l'e-reporting. | Décret 2024-266 du 25/03/2024, art. 91 LF 2024 |
| 01/09/2027 | PME, TPE et micro-entreprises **émettent** et font l'e-reporting. Mentions « cibles » exigées (adresse de livraison BR-FR-14, données BR-FR-MAP-13). | Idem ; annexe A XP Z12-012 |
| 01/09/2026 | Les schematrons France passent de « warning » à « fatal » (version standard). | Note explicative FNFE V1.4.0 |

**Conséquence** : à la date de l'analyse, la réception est déjà obligatoire. Les clients de LogiBTP reçoivent
aujourd'hui par le portail de leur PA (saisie libre côté LogiBTP, ST22). L'émission devient obligatoire pour une PME
au 01/09/2027. *La taille des sociétés utilisatrices décide de l'urgence de l'émission (Q2).*

### 2.2 Acteurs et circuit

- **PA (Plateforme Agréée)** : nouveau nom des « PDP » depuis 2025. Seules les PA échangent les factures B2B entre
  assujettis (circuit dit « C » : PA émettrice PA-E → PA réceptrice PA-R). Liste officielle sur impots.gouv.fr.
- **PPF (Portail Public de Facturation)** : recentré (décision d'octobre 2024) sur l'**annuaire** et le
  **concentrateur de données** (CdD). Il ne transporte plus de factures B2B et n'offre plus de portail gratuit
  d'émission. Il reçoit des PA le flux 1 (données fiscales des factures), le flux 10 (e-reporting) et le flux 6 pour
  les seuls statuts obligatoires.
- **OD / Solution compatible (SC)** : logiciel qui produit ou consomme les factures sans être PA. **LogiBTP est un
  OD** : il ne parle qu'à la PA choisie par chaque société, jamais au PPF directement.
- **Chorus Pro** : reste la plateforme de réception des entités publiques (B2G). Un émetteur privé peut y déposer par
  sa PA.

### 2.3 Flux (numérotation des spécifications externes)

| Flux | Contenu | Concerne LogiBTP |
|---|---|---|
| 1 | Données fiscales extraites d'une facture B2B (PA → CdD PPF) | Non : produit par la PA à partir du flux 2 |
| 2 (et 3) | Facture électronique entre PA (UBL, CII ou Factur-X) | **Oui** : produite en émission, reçue en réception |
| 6 | Statuts de cycle de vie (CDAR) | **Oui** : statuts reçus (émission) et posés (réception) |
| 8 | Facture B2B internationale (e-reporting des ventes ou achats internationaux) | Oui si clients ou fournisseurs étrangers |
| 9 | Facture B2C | Facultatif (une facture PDF suffit pour un particulier) |
| 10 | E-reporting : 10.1 transactions unitaires, 10.2 paiements unitaires, 10.3 transactions B2C agrégées, 10.4 paiements B2C agrégés | **Oui** : particuliers (rénovation), international |
| 11, 13, 14 | Annuaire (PA ↔ PPF) | Non : consulté par l'API annuaire de la PA |

### 2.4 Formats et profils (socle minimum, XP Z12-012 V1.4)

- Trois syntaxes acceptées : **UBL 2.1** (Invoice et CreditNote), **UN/CEFACT CII D22B**, **Factur-X** (PDF/A-3
  avec XML CII embarqué, version 1.09.2). Le format choisi est libre : la PA-R convertit si besoin
  (`docType=Converted` de l'API).
- Profils : **EN16931** (cible normale) et **EXTENDED-CTC-FR** (sous-ensemble du profil EXTENDED de Factur-X : sous-
  lignes, multi-vendeur, références à la ligne, factures antérieures à la ligne, plusieurs détails de TVA par
  catégorie). Factur-X **BASIC WL** est toléré la première année seulement (pas de lignes). Les profils MINIMUM et
  BASIC ne sont pas du socle.
- Contrôles en quatre étapes : XSD de la syntaxe → schematron EN16931 (ou EXTENDED-CTC-FR) → schematron
  **BR-FR-Flux2** (règles françaises BR-FR-01 à 32, BR-FR-CO-01 à 17, BR-FR-DEC-01 à 04, BR-FR-MV) → B2G
  (BR-FR-CPRO, pas encore publié). Schematrons en XSLT **2.0** (licence Apache 2.0), versions « WARNING » et
  « fatal ».
- Règles françaises qui touchent les données de LogiBTP :

| Règle | Exigence | Donnée LogiBTP |
|---|---|---|
| BR-FR-01/02 | Numéro de facture ≤ 35 caractères, jeu de caractères restreint | `ent_numero` (30) : conforme, format à contrôler |
| BR-FR-04 | Types autorisés : 380, 389, 393, 501 (factures), **386** / 500 (acompte), 384 / 471–473 (rectificatives), 381, 261, 262, 396, 502, **503** (avoirs) | Type de document → code BT-3 (paramètre) |
| BR-FR-05/06 | Trois notes obligatoires : **PMT** (indemnité forfaitaire 40 €), **PMD** (pénalités), **AAB** (escompte ou absence) | Mentions pénalités et indemnité de la société (`db/190`, `EditionsBtp.cs`) |
| BR-FR-08 | **Cadre de facturation** BT-23 obligatoire : B1 / S1 / M1 (bien, service, mixte), B2 / S2 / M2 (déjà payée), S3 (sous-traitance B2G paiement direct), B4 / S4 / M4 (définitive après acompte), **S5** (sous-traitant), **S6** (cotraitant), B7 / S7 (TVA déjà collectée) | Absent : nature biens / services / mixte à porter (Q8) |
| BR-FR-10/11, 09, 32 | SIREN du vendeur obligatoire et actif dans l'annuaire ; SIREN de l'acheteur ; cohérence SIRET / SIREN | `per_siren`, `per_siret` (contrôlés) |
| BR-FR-12/13, 21–26 | **Adresses électroniques** de l'acheteur (BT-49) et du vendeur (BT-34), schéma 0225, ≤ 125 caractères ; code de routage schéma 0224 ≤ 100 | `per_fe_adresse`, `per_fe_code_routage` (fiche) ; adresse propre de la société à paramétrer |
| BR-FR-14 | Adresse de livraison si différente (biens), obligatoire au 01/09/2027 | `ent_adresse_livraison`, adresse des travaux (`db/184`) |
| BR-FR-15/16 | Catégories TVA S, E, AE, K, G, O, Z ; taux de la liste (20, 10, 5.5, 2.1, 8.5…) | `categorie_tva.ctv_comportement` (N, A, I, E) → catégorie EN16931 (Q9) |
| BR-FR-17/18 | Pièces jointes typées : LISIBLE (une seule), RIB, BON_COMMANDE, BON_LIVRAISON, ETAT_ACOMPTE, **FACTURE_PAIEMENT_DIRECT**, **RECAPITULATIF_COTRAITANCE**… ; 100 Mo maximum (BR-FR-19) | GED de la pièce |
| BR-FR-20/31 | Note BAR : B2B, B2BINT, B2C, OUTOFSCOPE, **ARCHIVEONLY** (avoir interne d'une facture rejetée ou refusée) | `per_fe_type` (B2B, B2C, B2G, INTERNATIONAL) |
| BR-FR-CO-03 à 05 | Avoir et rectificative : facture antérieure BG-3 obligatoire | Lien ANNULATION / origine de l'avoir |
| BR-FR-CO-06/08 | Acompte : date de versement BT-9 ; facture définitive B4/S4/M4 jamais de type acompte | Factures d'acompte et déductions |
| BR-FR-CO-17 | Date de livraison ou de fin d'exécution (BT-72) ou période (BG-26) si différente de la date d'émission | Période de la situation |
| BR-FR-DEC-01 à 04 | Montants 2 décimales, quantités 4, prix unitaires 6, taux 2 | Stockage `NUMERIC(18,6)` : arrondis à vérifier (R2) |
| BR-FR-MAP-03 | TVA sur les débits : BT-8 = 5 (CII) / 3 (UBL) pour les services quand la société a opté | Paramètre TVA sur les débits du module Comptabilité |

### 2.5 Cycle de vie (flux 6, message CDAR D22B)

Codes de statut (liste du schematron BR-FR-CDV-CL-06) : 200 à 214, 220, 221, 224 à 228, 250, 251, 300, 301, 400,
401, 500, 501, 601. Statuts métier courants (exemples FNFE) :

| Code | Statut | Posé par | Obligatoire (vers le PPF) |
|---|---|---|---|
| 200 | Déposée | PA-E | **Oui** |
| 201 | Émise par la plateforme | PA-E | |
| 202 | Reçue par la plateforme | PA-R | |
| 203 | Mise à disposition | PA-R | |
| 204 | Prise en charge | Acheteur | |
| 205 | Approuvée | Acheteur | |
| 206 | Approuvée partiellement | Acheteur | |
| 207 | En litige | Acheteur | |
| 208 | Suspendue | Acheteur | |
| 209 | Complétée | Vendeur | |
| 210 | **Refusée** | Acheteur (motif obligatoire) | **Oui** |
| 211 | Paiement transmis | Acheteur | |
| 212 | **Encaissée** (montant, taux de TVA) | Vendeur | **Oui** (services à TVA sur les encaissements) |
| 213 | **Rejetée** (motif) | PA-E ou PA-R | **Oui** |
| 220 | Annulée | Vendeur | |
| 224 | Demande de paiement direct (sous-traitance) | Sous-traitant | |

- Rejetée et Refusée sont **terminales** pour le PPF : aucun statut obligatoire ensuite. Le vendeur annule la facture
  dans ses comptes par un **avoir interne** non transmis (note BAR = ARCHIVEONLY) puis émet une nouvelle facture.
- Refusée n'est pas un litige : réservée à la non-conformité réglementaire, la transaction inconnue ou une référence
  contractuelle manquante. Un désaccord sur le contenu = **En litige** (207) puis avoir ou facture rectificative.
- Motifs (onglet « Tableau des motifs de STATUTS », 50 codes) : NON_TRANSMISE (Déposée sans PA destinataire),
  DOUBLON, DEST_INC, TX_TVA_ERR, CMD_ERR, SIRET_ERR, PU_ERR, QTE_ERR, LIVR_INCOMP, ST_CT_NON_DECLAR, IRR_* (contrôles
  techniques)…
- Codes d'action attendue : NOA, PIN, NIN, CNF, CNP, CNA, OTH.

### 2.6 E-reporting (flux 10)

- Transactions **B2C** (particuliers, non-assujettis) : flux 10.3 agrégé par jour et par taux ; paiements B2C des
  services : flux 10.4. **Pertinent en BTP** (rénovation chez les particuliers).
- B2B international (ventes à un client étranger, achats auprès d'un fournisseur étranger) : flux 10.1 unitaire et
  10.2 pour les paiements.
- B2B domestique : pas d'e-reporting des paiements par le flux 10 ; c'est le statut **Encaissée (212)** qui le porte,
  pour les prestations de services sans option sur les débits.
- XSD du flux 10 (`Report` → `TransactionsReport`, `PaymentsReport`) dans le dépôt FNFE. Périodicité selon le régime
  de TVA de la société (décade, mois, bimestre) : à confirmer dans les spécifications externes v3.x avant le lot
  e-reporting (R7).

### 2.7 Annuaire et adressage

- Annuaire du PPF alimenté par les PA : unité légale (SIREN), établissement (SIRET), code de routage, **ligne
  d'annuaire** = adresse électronique de facturation (identifiant d'adressage : SIREN, SIREN_SIRET,
  SIREN_SIRET_CODE-ROUTAGE ou SIREN_suffixe) + plateforme de réception.
- Consulté par l'API *Directory Service* de la PA (§ 3.2). Un destinataire absent de l'annuaire : la PA-E pose
  « Déposée » avec motif NON_TRANSMISE et la facture se transmet hors réforme (courriel, papier).
- Le choix des adresses de réception (une par société, par établissement, par service) appartient au destinataire
  (cas § 1.4 XP Z12-014). Pour les auto-factures, c'est l'adresse du vendeur qui reçoit.

### 2.8 Archivage

- La PA **n'a pas d'obligation d'archivage légal**. Le document fourni (« 10 ans si la PDP ne le propose pas ») est à
  préciser : conservation fiscale **6 ans** (LPF art. L102 B) dans le format d'origine, conservation comptable
  **10 ans** (Code de commerce L123-22). Les flux originaux (XML ou Factur-X) et leurs statuts doivent être gardés
  intègres et lisibles. La GED de LogiBTP (coffre-fort, journal chaîné, rétention) couvre ce besoin.

### 2.9 Spécificités BTP (XP Z12-014, cas 13, 14, 20, 21, 26 et § 3.2.12)

- **Marchés privés de travaux** : facture électronique classique (380). Un projet de décompte qui n'est pas encore une
  facture peut circuler en **325 (proforma)**, hors réforme (ni flux 1, ni statut au PPF), puis être référencé en BG-3
  par la facture finale.
- **Sous-traitance** : facture F1 du sous-traitant au titulaire en **autoliquidation** (catégorie AE, code
  `VATEX-FR-AE`, texte « AUTOLIQUIDATION »), facture F2 du titulaire au maître d'ouvrage pour le total avec TVA.
- **Paiement direct / délégation** (cas 13) : F1 avec cadre **S5** (ou S1) et bloc **PAYEUR** (`EXT-FR-FE-BG-02`,
  profil EXTENDED-CTC-FR) désignant le maître d'ouvrage ; demande de paiement direct par statut CDAR **224** avec la
  facture jointe, adressée au maître d'ouvrage et au titulaire. En B2G : cadre S3 par Chorus Pro.
- **Cotraitance** (cas 14) : cadre **S6**, pièce jointe RECAPITULATIF_COTRAITANCE.
- **Références de chantier** : BT-11 (projet), BT-17 (lot ou appel d'offres), BT-18 (objet facturé, schéma UNTDID
  1153) pour regrouper les factures d'un chantier.
- **Acompte** (cas 20/21) : facture d'acompte **386** (avoir 503) avec la TVA par ligne ; facture définitive avec cadre
  **B4 / S4 / M4**, facture d'acompte en BG-3 et reprise d'acompte en ligne négative (quantité −1) ou en montant déjà
  payé (BT-113).
- **Retenue de garantie** : aucune donnée EN16931 pour un échéancier sous réserve ; seulement une **note ABU** (cas 26,
  clause de réserve). La facture porte le total ; la retenue figure dans les conditions de paiement (BT-20) et
  l'échéancier reste dans LogiBTP. Pour les services à TVA sur les encaissements, un statut Encaissée par versement.
- **Situations de travaux** : la facture électronique porte les montants **de la période** ; une présentation
  cumulée (`ent_avt_presentation`) se traduit en lignes de période (quantité ou pourcentage de la période), le cumul
  restant dans le LISIBLE (PDF) et éventuellement en pièce jointe.

## 3. API d'échange : norme XP Z12-013 (swaggers 1.3.0)

La norme AFNOR définit l'API « dernier kilomètre » entre un OD (LogiBTP) et une PA. Une PA n'est pas obligée de
l'exposer, mais c'est la cible commune ; les PA ont souvent en plus leur API propre.

### 3.1 *Flow Service* (factures, statuts, e-reporting)

| Opération | Rôle |
|---|---|
| `POST /v1/flows` | Dépose un flux (`multipart/form-data` : `flowInfo` JSON + `file` ≤ 100 Mo) : facture (CII, UBL, Factur-X), statut (CDAR) ou e-reporting (FRR). Réponse 202 avec `flowId`, `submittedAt`. |
| `POST /v1/flows/search` | Recherche par critères (`updatedAfter`, `flowType`, `flowDirection`, `processingRule`, `trackingId`, `ackStatus`), pagination par curseur (`cursor` / `nextCursor`). |
| `GET /v1/flows/{flowId}?docType=` | Métadonnées (défaut) ou fichier : `Original`, `Converted`, `ReadableView` (LISIBLE). |
| `GET/POST /v1/webhooks`, `DELETE /v1/webhooks/{id}` | Abonnement à des événements (types de flux, sens, état d'accusé). |
| `GET /v1/healthcheck` | Disponibilité. |

- `flowInfo` : `trackingId` (notre identifiant, ≤ 64), `name`, `flowSyntax` (CII, UBL, Factur-X, CDAR, FRR),
  `flowProfile` (Basic, CIUS, Extended-CTC-FR), `processingRule` (B2B, B2BInt, B2C, B2G, OutOfScope, ArchiveOnly…),
  `sha256` (empreinte vérifiée par la PA).
- `flowType` : CustomerInvoice, SupplierInvoice, CustomerInvoiceLC, SupplierInvoiceLC, rapports de transactions et de
  paiements (agrégés ou unitaires)…; `flowDirection` In / Out.
- Accusé (`ackStatus`) : Pending, Ok, Error, avec détails (niveau, élément, `reasonCode` : InvalidSchema,
  AlreadyExistingFlow, ChecksumMismatch, InvoiceLCStatusError…).
- En-têtes : `Request-Id` (corrélation), **`Organization-Id`** (multi-sociétés, délégation).
- Sécurité : **OAuth 2.0 *client credentials*** (jeton Bearer JWT).

### 3.2 *Directory Service* (annuaire)

`POST /v1/siren/search`, `GET /v1/siren/code-insee:{siren}`, `POST /v1/siret/search`,
`GET /v1/siret/code-insee:{siret}`, `POST /v1/routing-code/search`,
`GET /v1/routing-code/siret:{siret}/code:{id}`, **`POST /v1/directory-line/search`**,
`GET /v1/directory-line/code:{identifiant}` : unité légale, établissement, codes de routage, lignes d'annuaire
(adresse électronique, plateforme, statut, gestion du statut de paiement, du numéro d'engagement…). Même sécurité.

## 4. Corrections du document de cadrage fourni

| Affirmation du document | Correction | Source |
|---|---|---|
| « PDP » et « PPF » comme plateformes d'échange | PDP → **PA** ; le PPF ne transporte plus de factures (annuaire et concentrateur seulement). L'ERP ne parle **qu'à sa PA**. | XP Z12-014 § 1.1 |
| Profils Factur-X : Minimum, Basic WL, Basic, EN16931, Extended | Socle : **EN16931** et **EXTENDED(-CTC-FR)** ; BASIC WL toléré la première année ; MINIMUM et BASIC exclus. | Note FNFE, § 1 |
| UBL norme ISO/IEC 19845 | Exact (UBL 2.1), mais à utiliser avec les règles EN16931 et BR-FR ; deux messages : Invoice et **CreditNote** pour les avoirs. | Note FNFE |
| Recommandation Factur-X à l'émission | Pertinente (le LISIBLE est la facture elle-même), mais le choix est libre ; CII seul est plus simple si la PA produit le LISIBLE. | XP Z12-012 |
| Contrôle local par XSD | Insuffisant : XSD + schematrons EN16931 + **BR-FR-Flux2** (XSLT 2.0) ; la PA-E rejette (213) sur ces contrôles. | Note FNFE, § 1 |
| Endpoints `POST /invoices/submit`, `GET /status`, `PUT /incoming/{id}/status` | API normalisée **XP Z12-013** : un seul objet *flow* (facture, statut, e-reporting) ; un statut se pose en **déposant un CDAR** (`POST /flows`), pas par `PUT`. | Swagger Flow 1.3.0 |
| OAuth 2.0 ou clés d'API ; certificat RGS / eIDAS | OAuth 2.0 *client credentials* dans la norme ; pas de certificat exigé de l'OD. | Swagger 1.3.0 |
| Webhooks recommandés plutôt que le *polling* | Les deux existent. Un serveur LogiBTP (une base par société, derrière un sous-domaine) doit exposer une route publique pour un webhook ; la recherche par curseur suffit pour commencer. | Swagger Flow |
| Statuts « Générée », « Déposée » ; « Approuvée, En litige, Payée » transmis au PPF | Statuts codés 200–228 ; seuls Déposée, Rejetée, Refusée, **Encaissée** vont au PPF. « Payée » côté acheteur = Paiement transmis (211), non obligatoire. | XP Z12-012, CDAR |
| E-reporting : « statuts d'encaissement pour la TVA sur les encaissements » | B2B domestique : statut **Encaissée (212)** ; flux 10 seulement pour le B2C et l'international. | XP Z12-014 cas 26, 34, 43 |
| Litige → appel API « En litige » | Exact (207), mais **Refusée** (210) n'est pas un litige ; rejet ou refus → **avoir interne** ARCHIVEONLY puis nouvelle facture. | XP Z12-014 § 2.2, 2.5 |
| Rapprochement trois voies automatique puis pré-comptabilisation | À garder comme aide : LogiBTP ne valide jamais une pièce automatiquement (comme le Mail : jamais de changement de statut automatique) ; proposition puis validation. | Règles du projet |
| Annuaire : vérifier l'assujettissement et la PDP destinataire | Vérifier la **ligne d'annuaire** (adresse électronique) ; c'est la PA-E qui route. | XP Z12-014 § 1.4 |
| Archivage 10 ans si la PDP ne le fait pas | La PA n'archive pas légalement ; 6 ans fiscal, 10 ans comptable, par LogiBTP (coffre de la GED). | LPF L102 B |
| Absent du document | Cadre de facturation BT-23, notes PMT / PMD / AAB, SIREN acheteur, catégories VATEX, autoliquidation, paiement direct (S5, statut 224), acompte (386, B4/S4/M4), proforma 325, B2G, multi-sociétés (`Organization-Id`). | § 2 |

## 5. Ce qui existe dans LogiBTP

| Brique | Ce qu'elle apporte | Manque pour la facturation électronique |
|---|---|---|
| Module Annuaire + cœur (`070`, `db/229`, fiche personne) | SIREN / SIRET contrôlés, TVA intracommunautaire, `per_fe_plateforme`, `per_fe_adresse`, `per_fe_code_routage`, `per_fe_format` (FACTURX, UBL, CII), `per_fe_code_service` et `per_fe_engagement` (Chorus Pro), `per_service_public`, **`per_fe_type`** (B2B, B2C, B2G, INTERNATIONAL), `per_assujetti_tva`, `per_st_autoliquidation` | Adresse électronique de **notre** société, date de vérification dans l'annuaire, suffixe d'adressage |
| Module Entreprises FR | Recherche SIRENE, service public → Chorus Pro | Annuaire de facturation (Directory Service) |
| Module Document | Types et familles, numérotation continue des ventes, `ent_adresse_facturation` / `ent_adresse_livraison` figées, TVA par catégorie (`document_tva`, mention, autoliquidation), avancement (situations, cumul ou période), acomptes, avoirs et **annulation par avoir** (lien ANNULATION), historique, pièces externes (`document_origine` : IMPORT, format, fichier GED) | Code BT-3 par type, cadre BT-23, nature biens / services, état de facturation électronique séparé du statut (pas de statut REJETE dans le module) |
| Module Comptabilité | Catégories de TVA (`ctv_comportement` N / A / I / E, mention, exigibilité E / D), TVA sur les débits, export Sage 100 | Correspondance catégorie → code EN16931 (S, AE, E, K, G, O, Z) et VATEX |
| Module Règlements | Règlements reçus et émis, pointages, reste à payer, cautions | Déclencheur du statut Encaissée (212) et de Paiement transmis (211) |
| Module Relances | Factures échues | Rien (une facture En litige peut suspendre la relance : Q17) |
| Module Édition | Moteur JS unique (navigateur et Jint), PDF déterministe, polices intégrées, production serveur en file, rangement GED | **PDF/A-3** (XMP, profil sRGB, fichier associé) : prévu dans CONCEPTION-EDITION § 3.5, non fait |
| Module GED | Contenus par empreinte SHA-256, étapes (ENVOI, RECEPTION), **coffre-fort** chaîné, rétention, classification | Règle de rétention des flux électroniques |
| Module OAuth | Connexions sortantes chiffrées, flux **CLIENT** (`client_credentials`), fournisseur GENERIQUE, renouvellement, rappels, `IFournisseurJeton` du socle | Vérifier le flux CLIENT pour un fournisseur GENERIQUE (aujourd'hui documenté pour Microsoft) |
| Module Mail | File d'envoi avec reprises (1 / 5 / 15 / 60 min), relève, rattachement des reçus, envoi de documents | Envoi hors réforme (destinataire NON_TRANSMISE, particulier) : déjà possible |
| Module Notification | Planificateur par base, sources et canaux | Signaux : rejet, refus, litige, facture reçue |
| Module Sous-traitance + cœur | Marchés de sous-traitance, facture reçue saisie librement (ST22), paiement direct (`092b`, lien `019j`), autoliquidation, DC4 | Import structuré de la facture reçue, statut 224 |
| Module Import | Imports de documents (OptimBTP…) | Réutilisable pour la lecture d'un XML reçu ? (Q12) |
| Module Droits | Nœuds de droits par route (`SpecialisationDroitsBtp.Routes`) | Nœuds du nouveau module |

Rien n'existe encore sur la production XML, la lecture XML, le cycle de vie ou la connexion à une PA.

## 6. Principe proposé

### 6.1 Découpage en briques

1. **Module `modules/facture-electronique`** (facultatif, `MODULE_FACULTATIF.FACTURE_ELECTRONIQUE`), sans métier BTP,
   ne dépendant que du socle (comme Règlements et Relances) :
   - **modèle sémantique EN16931** (BG / BT, extensions EXT-FR-FE utiles) et **codes** (types BT-3, cadres BT-23,
     catégories TVA, VATEX, statuts, motifs, actions, `flowType`, `processingRule`) ↔ `Codes.cs` ;
   - **contrôle de complétude** avant émission (règles BR-FR et EN16931 qu'on peut tester sans XML : SIREN, adresse
     électronique, notes, cadre, sommes, décimales), **répliqué JS ↔ C#** pour avertir dans l'éditeur ;
   - **écriture et lecture** CII D22B, UBL 2.1 (Invoice / CreditNote), CDAR D22B ; flux 10 ;
   - **validation** XSD + schematrons FNFE (version embarquée, mise à jour par lot) ;
   - **connecteur de plateforme** : contrat `ConnecteurPlateforme` (déposer, rechercher, télécharger, annuaire),
     implémentation **AFNOR XP Z12-013**, plateforme **simulée** pour les tests et la démo, extensible par PA ;
   - **file des flux** (sens, type, accusé, empreinte, reprises), **historique des statuts**, relève périodique par
     base, journal ; écrans du module (paramètres, tableau des flux, détail).
2. **Module Édition** : capacité générique « PDF/A-3 avec fichier associé » (sans savoir ce qu'est Factur-X).
3. **Module OAuth** : au besoin, flux CLIENT pour un fournisseur GENERIQUE.
4. **Cœur** (`SpecialisationFactureElectroniqueBtp`) : document → modèle sémantique (ventes, achats, sous-traitance),
   déclencheur à la validation, assemblage Factur-X (édition + XML), réception → pièce d'achat en brouillon,
   statuts posés par les actions de l'utilisateur et par les règlements, annuaire sur la fiche personne, archivage
   GED, e-reporting.

### 6.2 Émission (ventes)

1. À la **validation** (ENVOYE) d'une facture, facture d'avancement, facture d'acompte ou avoir de vente d'un tiers
   B2B ou B2G : contrôle de complétude (bloquant ou non : Q5), production du XML (format de la société ou du tiers),
   Factur-X si choisi (PDF de l'édition + XML), validation, rangement GED (étape ENVOI), mise en file.
2. Dépôt par la file (`POST /flows`, `trackingId` = identifiant LogiBTP, `sha256`), reprises en cas d'échec
   technique. Un tiers B2C ou hors annuaire : envoi habituel (courriel, PDF) et e-reporting B2C.
3. Relève des statuts (`POST /flows/search` par curseur, ou webhook plus tard) : historique, pastille sur la pièce
   (Déposée, Mise à disposition, Approuvée, En litige, Refusée, Rejetée, Encaissée), notification sur Rejetée,
   Refusée, En litige.
4. **Rejetée / Refusée** : proposition d'avoir interne d'annulation (lien ANNULATION existant, note ARCHIVEONLY,
   jamais transmis ou transmis pour archivage seul) puis nouvelle facture ; le statut du document ne change pas sans
   action de l'utilisateur.
5. **Encaissée (212)** : posée depuis les règlements pointés (montant et taux) pour les services à TVA sur les
   encaissements (proposée, puis envoyée : Q15).

### 6.3 Réception (achats, sous-traitance)

1. Relève des factures reçues (`flowDirection=In`, `SupplierInvoice`), téléchargement de l'original et du LISIBLE,
   rangement GED (étape RECEPTION), empreinte vérifiée, doublon refusé.
2. Lecture du XML (CII, UBL, Factur-X) vers le modèle ; rattachement : fournisseur par SIREN / SIRET (fiche
   provisoire sinon, comme l'annuaire `071`), commande par BT-13, marché de sous-traitance par BT-11 / BT-12 / BT-18,
   chantier par BT-11 ; création d'une **pièce d'achat en brouillon** (`A_FACTURE`, `T_FACTURE_AVT`) avec lignes,
   TVA (autoliquidation reconnue par AE), référence externe et date du fournisseur, origine IMPORT.
3. Liste « Factures reçues à traiter » ; l'utilisateur contrôle, ventile, valide. Statuts posés par ses actions :
   Prise en charge (204) à l'ouverture ou à l'import, Approuvée (205) à la validation, En litige (207) avec motif,
   Refusée (210) avec motif, Paiement transmis (211) depuis le règlement émis.
4. Écarts avec la commande ou le marché : avertissements (contrôles de gestion existants), jamais de validation
   automatique.

### 6.4 Paramètres par société (une base par société)

PA choisie et connexion OAuth (module OAuth, flux CLIENT), adresse de l'API, `Organization-Id`, notre adresse
électronique de réception, format et profil par défaut (CII, UBL, Factur-X ; EN16931 ou EXTENDED-CTC-FR), cadre par
défaut, déclencheur (validation ou bouton), fréquence de relève, mode simulation. Tout cache dépendant du schéma
indexé par base ; fichiers en GED sous le nom de la base.

### 6.5 Modèle de données envisagé (module, script `modules/facture-electronique/db/099f_*.sql`)

- `fe_parametre` (clé / valeur), `fe_plateforme` (connexion, adresses, `Organization-Id`, état).
- `fe_flux` : sens (E / R), type (`flowType`), syntaxe, profil, règle (`processingRule`), `trackingId`, `flowId`,
  empreinte, GED (original, converti, lisible), élément lié (`type_element`, `id_element`, sans clé vers le cœur),
  état de file (A_ENVOYER, ENVOYE, ERREUR…), accusé, essais, dates.
- `fe_statut` : flux, code (200–228…), motif, action, montant et taux (Encaissée), émetteur, date, sens (reçu / posé),
  CDAR en GED.
- `fe_erreur` : détails d'accusé et de validation (niveau, règle, message).
- `fe_ereporting` (période, type 10.1–10.4, état, flux).
- Cœur (`db/3xx`, `ALTER TABLE`) : code BT-3 par type de document, nature biens / services / mixte (type de document,
  ligne ou document : Q8), correspondance catégorie de TVA → code EN16931 et VATEX, adresse électronique de la
  société.

## 7. Découpage envisagé (provisoire, à figer en phase 2)

Ordre : socle (rien de prévu), modules, puis cœur. Chaque lot ≤ une dizaine de fichiers, un critère de fin vérifiable.

| N° | Lot | Module | Dépend de |
|---|---|---|---|
| 1 | Codes (BT-3, BT-23, TVA, VATEX, statuts, motifs, flux) et modèle sémantique EN16931 ; contrôle de complétude répliqué JS ↔ C# ; jeu de cas | `modules/facture-electronique` (nouveau) | — |
| 2 | Écriture CII D22B (EN16931, EXTENDED-CTC-FR) depuis le modèle ; XSD ; jeux tirés des exemples FNFE (UC1–UC5, UC13) | module | 1 |
| 3 | Écriture UBL 2.1 (Invoice, CreditNote) ; lecture CII et UBL vers le modèle (aller-retour sur les exemples FNFE) | module | 2 |
| 4 | Validation complète : schematrons EN16931 + BR-FR-Flux2 (moteur XSLT 2.0 selon Q6), artefacts FNFE versionnés, rapport d'erreurs | module | 2 |
| 5 | CDAR : écriture et lecture des statuts ; règles du cycle de vie (transitions, terminaux, motifs autorisés par statut) JS ↔ C# | module | 1 |
| 6 | PDF/A-3 et fichier associé (XMP, sRGB, AFRelationship) ; vérification veraPDF hors CI | `modules/edition` | — |
| 7 | (si nécessaire) Flux CLIENT pour un fournisseur GENERIQUE | `modules/oauth` | — |
| 8 | Connecteur : contrat, implémentation XP Z12-013 *Flow* + *Directory*, plateforme simulée, journal | module | 1, 5 |
| 9 | Schéma `099f`, file des flux (reprises), historique des statuts, relève par base, service et routes | module | 8 |
| 10 | Écrans du module : paramètres de la plateforme, tableau des flux émis et reçus, détail et erreurs | module | 9 |
| 11 | Cœur : activation, droits, paramètres BTP (BT-3 par type, nature, catégories TVA → EN16931, notre adresse) | cœur | 9 |
| 12 | Cœur : document de vente → modèle (factures, avancement en période, acompte et définitive, avoirs, notes PMT/PMD/AAB, autoliquidation, pied → remises et charges, retenue en note, références chantier) ; contrôle dans l'éditeur | cœur | 11, 1 |
| 13 | Cœur : émission à la validation, Factur-X (édition + XML), GED, pastille, rejet / refus → avoir interne | cœur | 12, 6, 10 |
| 14 | Cœur : réception → pièce d'achat ou de sous-traitance en brouillon, rattachements, liste à traiter, statuts 204/205/207/210 | cœur | 11, 3 |
| 15 | Cœur : statuts depuis les règlements (Encaissée 212, Paiement transmis 211) | cœur | 13, 14 |
| 16 | Cœur : annuaire sur la fiche personne (ligne d'annuaire, plateforme, vérification avant émission) | cœur | 11 |
| 17 | Cœur : sous-traitance (S5 / S6, bloc PAYEUR, statut 224 de paiement direct, pièces jointes typées) | cœur | 13, 14 |
| 18 | Cœur : e-reporting B2C et international (flux 10.1–10.4, périodes, envoi) | cœur | 13, 15 |
| 19 | Cœur : archivage (coffre GED, rétention), démo (plateforme simulée, jeux), documentation | cœur | 13, 14 |

Priorité possible selon Q2 : réception (lots 1, 3, 8–11, 14) avant émission si les sociétés sont des PME.

## 8. Prérequis

- Choix d'au moins une PA réelle (compte de recette, documentation de son API, support XP Z12-013 ou non) : Q1.
- Accès aux spécifications externes DGFiP / AIFE v3.x (flux 10, périodicité) et aux textes « Codelists »
  (ICD 0225 / 0224, VATEX) : téléchargés depuis les sources officielles au lot concerné.
- Validation des choix fiscaux par l'expert-comptable (TODO sous-traitance) : cadres S5 / S6, autoliquidation,
  retenue de garantie, TVA sur les encaissements des travaux.
- Module Édition : production serveur en service (déjà le cas) pour le Factur-X.
- Ne pas appliquer de SQL soi-même : scripts livrés au manifeste `db/installation/scripts.txt`, appliqués par
  l'utilisateur.

## 9. Risques

| N° | Risque | Parade |
|---|---|---|
| R1 | Schematrons en **XSLT 2.0** : .NET ne fournit que XSLT 1.0 ; Saxon pour .NET (SaxonCS) est payant | Q6 : SaxonJS (Node, gratuit) en outil, contrôle de complétude maison, validation faite par la PA de toute façon |
| R2 | Arrondis : montants stockés à 6 décimales, EN16931 exige 2 et des sommes exactes (BR-CO-10…) | Vérifier les montants de ligne arrondis par `MoteurDocument` ; tolérance EXTENDED-CTC-FR 0,01 par ligne ; cas de test sur les situations |
| R3 | Situations cumulées et pied BTP (retenue, prorata, déductions d'acompte, paiement direct) mal représentables en EN16931 | Lignes de période, remises / charges de document, note ABU, profil EXTENDED-CTC-FR si besoin (Q7) |
| R4 | Une PA n'expose pas XP Z12-013 | Contrat de connecteur extensible, plateforme simulée, export de fichiers à déposer à la main (Q1) |
| R5 | Normes qui bougent (V1.4 → révision EN16931, UBL 2.6, CII D25A ; schematrons fix mensuels) | Artefacts versionnés dans le module, mise à jour par lot isolé, version portée par chaque flux |
| R6 | Multi-sociétés : une connexion et un curseur de relève par base | Relève par base comme `RenouvellementOAuth` / `ReleveMail`, `Organization-Id` par société |
| R7 | E-reporting : périodicité et agrégation mal comprises | Lot isolé (18) après lecture des spécifications externes ; validation par l'expert-comptable |
| R8 | Rejet ou refus après la clôture comptable (pièce transférée, état T) | Avoir interne daté du jour, jamais de modification de la pièce transférée |
| R9 | Webhook : route publique entrante, sécurité | Relève par curseur d'abord ; webhook en lot ultérieur (Q11) |
| R10 | PDF/A-3 non conforme (veraPDF) : la PA rejette le Factur-X | Lot Édition dédié avec vérification ; repli sur CII seul + PDF en pièce jointe LISIBLE |
| R11 | Doublons à la relève (relance de la file, reprise) | `trackingId` unique, empreinte, AlreadyExistingFlow traité comme succès |

## 10. Questions ouvertes

Voir [facturation-electronique-questions.md](plans/facturation-electronique-questions.md) (questions numérotées,
options, recommandation, bloquantes marquées B).
