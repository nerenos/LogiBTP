# Facturation électronique (RFE) : plan par lots

> Analyse : [ANALYSE-FACTURATION-ELECTRONIQUE.md](../ANALYSE-FACTURATION-ELECTRONIQUE.md) (09/11/2026) ; questions et
> décisions : [facturation-electronique-questions.md](facturation-electronique-questions.md) (toutes tranchées le
> 09/11/2026). **Plan à valider** (point de contrôle 2) avant le lot 1.
>
> Décisions structurantes : aucune PA désignée, connecteur **générique AFNOR XP Z12-013**, connecteurs propres à une PA
> par surcharge, **dépôt manuel** en repli (Q1) ; module facultatif `modules/facture-electronique` sans métier (Q3) ;
> **deux parties, réception puis émission** (Q2, Q24) ; émission en Factur-X **et** CII seul (Q4) ; EN16931 par
> défaut, EXTENDED-CTC-FR pour ce qui l'exige (Q7) ; validation XSD + complétude maison, schematrons FNFE complets par
> SaxonJS dans les tests et l'outil (Q6) ; **e-reporting dans le chantier** : LogiBTP collecte, extrait et transmet à
> la PA les données brutes de vente et d'encaissement, en envoi unitaire ou en plusieurs envois au choix de la
> société (Q20).
>
> Demande ajoutée (09/11/2026) : **trace complète du suivi des étapes et des changements d'état** de chaque facture
> émise ou reçue. Décision de conception : journal `fe_evenement` en ajout seul (ni UPDATE ni DELETE, triggers comme
> le coffre de la GED), **chaîné par empreinte** (comme `ChaineCoffre`), alimenté par tous les lots (production,
> contrôle, dépôt, accusé, statut reçu ou posé, erreur, reprise de la file, action d'un utilisateur, avoir interne,
> rattachement), affiché en **chronologie** sur la pièce et sur le flux.
>
> Ordre : socle (rien), modules, puis cœur, dans chaque partie. Un module ne dépend jamais du cœur. Un commit par lot ;
> SQL livré au manifeste `db/installation/scripts.txt`, **jamais appliqué par Claude**. Après tout ajout de
> dépendance : `npm run rapport-dependances`. Après modification du code : `graphify update .` si l'outil est présent.

| Lot | Titre | Module | Dépend de | Statut |
|---|---|---|---|---|
| | **Partie A : socle commun et réception** | | | |
| 1 | Codes, modèle sémantique EN16931, règles du cycle de vie | `modules/facture-electronique` (nouveau) | — | FAIT (09/11/2026) |
| 2 | Lecture CII D22B et Factur-X (XML embarqué), XSD | module | 1 | FAIT (09/11/2026) |
| 3 | Lecture UBL 2.1 (Invoice, CreditNote) | module | 1, 2 | FAIT (09/11/2026) |
| 4 | Schematrons FNFE : artefacts versionnés, validation par SaxonJS (tests et outil) | module | 2, 3 | FAIT (09/11/2026) |
| 5 | CDAR : écriture et lecture des statuts | module | 1 | A FAIRE |
| 6 | Connecteur : contrat, AFNOR XP Z12-013 (Flow, Directory), plateforme simulée, dépôt manuel | module | 1, 5 | A FAIRE |
| 7 | OAuth : flux CLIENT pour un fournisseur GENERIQUE (si absent) | `modules/oauth` | — | A FAIRE |
| 8 | Schéma, file des flux, statuts, **journal des étapes chaîné**, relève par base, service et routes | module | 6 | A FAIRE |
| 9 | Écrans du module : paramètres, tableau des flux, détail et chronologie, dépôt et import manuels | module | 8 | A FAIRE |
| 10 | Catégories de TVA : catégorie EN16931 et code VATEX | `modules/comptabilite` | — | A FAIRE |
| 11 | Branchement du cœur : activation, droits, spécialisation, paramètres, notifications, onglet Chronologie | cœur | 8, 9, 7 | A FAIRE |
| 12 | Réception : flux reçu → pièce d'achat ou de sous-traitance en brouillon, rattachements, liste à traiter | cœur | 11, 2, 3, 10 | A FAIRE |
| 13 | Réception : statuts posés (204, 205, 207, 210) et Paiement transmis (211) | cœur | 12, 5 | A FAIRE |
| 14 | Réception hors plateforme : Factur-X ou XML glissé ou reçu par courriel | cœur | 12 | A FAIRE |
| 15 | Réception de sous-traitance : cadre S5, bloc PAYEUR, demande de paiement direct (224) | cœur | 12, 13 | A FAIRE |
| | **Partie B : émission et e-reporting** | | | |
| 16 | Contrôle de complétude (JS ↔ C#) et écriture CII D22B (EN16931, EXTENDED-CTC-FR) | module | 1, 4 | A FAIRE |
| 17 | Écriture UBL 2.1 (Invoice, CreditNote) | module | 16 | A FAIRE |
| 18 | PDF/A-3 et fichier associé | `modules/edition` | — | A FAIRE |
| 19 | E-reporting : modèle des transactions et paiements, écriture du flux 10 (10.1 à 10.4), découpage des envois | module | 1, 8 | A FAIRE |
| 20 | Annuaire sur la fiche personne et vérification de nuit (option) | cœur | 11, 6 | A FAIRE |
| 21 | Paramètres d'émission BTP : code BT-3 par type, nature biens / services / mixte, notes légales | cœur | 11, 10 | A FAIRE |
| 22 | Document de vente → modèle : factures, acomptes, définitives, avoirs ; contrôle dans l'éditeur | cœur | 21, 16 | A FAIRE |
| 23 | Document de vente → modèle : situations (période), pied BTP, retenue, références de chantier | cœur | 22 | A FAIRE |
| 24 | Émission à la validation : CII ou Factur-X, GED et coffre, dépôt, pastille | cœur | 22, 23, 17, 18, 20 | A FAIRE |
| 25 | Rejet et refus → avoir interne ; litige et suspension de relance | cœur | 24 | A FAIRE |
| 26 | Statut Encaissée (212) depuis les règlements, liste à valider | cœur | 24 | A FAIRE |
| 27 | Sous-traitance et cotraitance émises (S5, S6), B2G par la PA | cœur | 24 | A FAIRE |
| 28 | E-reporting : collecte et extraction des ventes et encaissements, envoi unitaire ou groupé | cœur | 19, 24, 26 | A FAIRE |
| 29 | Archivage (rétention), démonstration, documentation | cœur | 24, 28 | A FAIRE |

Fin de la partie A : lot 15 ; point d'arrêt pour validation de l'utilisateur avant la partie B.

---

## Partie A : socle commun et réception

## Lot 1 : codes, modèle sémantique EN16931, règles du cycle de vie — FAIT (09/11/2026)

- **Module** : `modules/facture-electronique` (nouveau, dépend du socle seul). **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `modules/facture-electronique/js/package.json` (`@logibtp/facture-electronique`), `js/src/index.js`,
  `js/src/codes.js` ↔ `dotnet/LogiBTP.FactureElectronique/Codes.cs` (`TYPE_FACTURE` BT-3 : 380, 384, 386, 389, 393,
  381, 261, 262, 396, 503… ; `CADRE_FACTURATION` B1…S7 ; `CATEGORIE_TVA` S, E, AE, K, G, O, Z ; `TRAITEMENT` (note
  BAR : B2B, B2BINT, B2C, OUTOFSCOPE, ARCHIVEONLY) ; `STATUT_CDV` 200–228 utiles ; `MOTIF_STATUT` (50 codes) ;
  `ACTION_CDV` ; `SYNTAXE`, `PROFIL`, `TYPE_FLUX`, `SENS_FLUX`, `REGLE_TRAITEMENT`, `ETAT_FLUX` ; `EVENEMENT_FE` (types
  du journal) ; codes d'erreur), `js/src/cycle-vie.js` ↔ `dotnet/LogiBTP.FactureElectronique/ReglesCycleVie.cs`,
  `dotnet/LogiBTP.FactureElectronique/ModeleFacture.cs` (BG / BT utiles, extensions EXT-FR-FE : PAYEUR, facture
  antérieure à la ligne, sous-type de ligne), `tests/cas/01_cycle_vie.json`, `dotnet/LogiBTP.FactureElectronique.Tests/`
  (`CodesTests.cs`, `ReglesCycleVieTests.cs`), `LogiBTP.slnx`, `package.json` racine.
- **Règles répliquées JS ↔ C#** (`cycle-vie`) : statut suivant permis selon le sens et l'émetteur ; statuts terminaux
  (Rejetée, Refusée : plus de statut obligatoire ensuite) ; motifs autorisés par statut (onglet « Tableau des motifs »
  de l'annexe A XP Z12-012) ; motif obligatoire pour 207, 210, 213 ; statut affiché (le plus avancé, Rejetée / Refusée
  priment) ; statuts obligatoires vers le PPF (200, 210, 212, 213).
- **Jeux** : `01_cycle_vie.json` (transitions permises et refusées, terminaux, motifs, statut affiché) ; parité des codes.
- **Critère de fin** : `npm test --workspace @logibtp/facture-electronique` et `dotnet test LogiBTP.slnx` verts, le jeu
  passe en JS et en C#. `CLAUDE.md` du module créé (comme pour Relances).
- **Réalisé** : `modules/facture-electronique` : `CLAUDE.md`, `js/package.json`, `js/src/{index,codes,cycle-vie}.js`,
  `js/test/cycle-vie.test.js`, `tests/cas/01_cycle_vie.json` (motifs par statut générés depuis l'onglet « Tableau des
  motifs de STATUTS »), `dotnet/LogiBTP.FactureElectronique/{Codes,ReglesCycleVie,ModeleFacture}.cs`,
  `dotnet/LogiBTP.FactureElectronique.Tests/{CodesTests,ReglesCycleVieTests}.cs` ; enregistré dans `package.json` racine
  (et `package-lock.json`), `LogiBTP.slnx` ; `DEPENDANCES.md` régénéré (vitest 5.1.0 partout, version réellement installée). Tests : 120 en JS, 30 en C# (suite .NET : 1032).
  Écarts : `PROFIL_FACTURE` au lieu de `PROFIL` (déjà un code du socle) ; ajout de `SENS_FACTURE` (E / R : rôle vendeur
  ou acheteur, distinct de `SENS_FLUX` In / Out de l'API), `EMETTEUR_STATUT`, `CODE_NOTE`, `SOUS_TYPE_LIGNE`,
  `ETAT_ACCUSE`, `NIVEAU_ACCUSE`, `MOTIF_ACCUSE` (reasonCode du swagger) ; `CADRE_FACTURATION` complet B1 à M9 (8 et 9 :
  multi-vendeurs, bidirectionnelle) ; `STATUT_CDV` : 200 à 214, 220, 221, 224 à 228 et 501 Irrecevable (motifs IRR_*),
  sans 250 à 601 ; `MOTIF_STATUT` compte 51 codes (schematron et annexe), non 50. Règles retenues pour l'enchaînement
  (statut posé par la société seulement) : rien après un terminal, facture émise : rien avant Déposée, Déposée une
  fois, Complétée seulement après Suspendue ; statut reçu contrôlé sur code, émetteur, motif et action. Statut affiché :
  rang interne (Annulée le plus avancé, affacturage au rang 85). `ModeleFacture.cs` sans équivalent JS (lot 16).

## Lot 2 : lecture CII D22B et Factur-X, XSD — FAIT (09/11/2026)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `dotnet/LogiBTP.FactureElectronique/Formats/LectureCii.cs` (XML CII → `ModeleFacture`, profils
  BASIC WL, EN16931, EXTENDED), `Formats/ExtractionFacturX.cs` (fichier `factur-x.xml` du PDF/A-3, dépendance PdfPig,
  Apache-2.0, à confirmer au lot), `Formats/ValidationXsd.cs` (`XmlSchemaSet`), `artefacts/xsd/` (XSD CII D22B
  *uncoupled*, Factur-X 1.09.2 par profil, copiés du paquet FNFE avec leur version et licence), tests
  `LectureCiiTests.cs`, `ExtractionFacturXTests.cs`, jeux `tests/exemples/` (exemples FNFE UC1–UC5, UC13, Factur-X
  EN16931 / BASIC WL / EXTENDED).
- **Règles** : serveur seul (rien à répliquer : la lecture n'existe pas côté navigateur). Montants lus en `decimal`.
  Erreurs : syntaxe, XSD, profil non reconnu, pas de XML embarqué.
- **Critère de fin** : tous les exemples FNFE CII et Factur-X lus (numéro, dates, parties, SIREN, adresses
  électroniques, lignes, TVA, totaux, notes, cadre, facture antérieure, PAYEUR) ; `dotnet test` vert ;
  `npm run rapport-dependances` relancé.
- **Réalisé** : `dotnet/LogiBTP.FactureElectronique/Formats/{LectureCii,ValidationXsd,ExtractionFacturX,ExceptionLectureFacture}.cs`,
  csproj (PdfPig 0.1.16, déjà utilisé par la GED : lit l'arbre `/EmbeddedFiles` ; XSD embarqués en ressources),
  `artefacts/xsd/{cii-d22b,factur-x/{basicwl,en16931,extended}}` + `artefacts/{VERSION,LICENCE}` (paquet FNFE 1.4.0.04,
  sans modification), `tests/exemples/` (CII EN16931 UC1–UC5, UC4b, UC13 ; EXTENDED-CTC-FR UC10–UC13 ; Factur-X
  BASIC WL et EXTENDED ; `VERSION`), `tests/exemples/logibtp/S5_PAYEUR_EXTENDED-CTC-FR_CII.xml` (cas construit),
  tests `LectureCiiTests.cs`, `ExtractionFacturXTests.cs` ; codes ajoutés JS ↔ C# : `SPECIFICATION_FACTURE` (BT-24),
  `TYPE_DOCUMENT_REFERENCE` (50, 130, 916), `SCHEMA_IDENTIFIANT` (0002, 0009, 0224, 0225, VA, FC), 7 codes de lecture
  dans `ERREUR_FE` ; `ModeleFacture.cs` : `Facture.Specification` (BT-24 lu) ; `DEPENDANCES.md` régénéré. Tests : 93 en
  C# pour le module (suite .NET : 1095), 120 en JS. Écarts : les exemples FNFE ne portent ni PAYEUR, ni agent, ni
  facture antérieure en ligne, d'où le cas construit S5 (XSD D22B vérifié) ; XML Factur-X EN16931 identiques aux CII
  EN16931 (non recopiés) ; trois PDF recopiés sur quinze (un par profil, ~1,1 Mo), les quinze du paquet lus une fois
  hors dépôt ; profil BASIC accepté (XSD Factur-X EN16931, le paquet n'a pas celui de BASIC), MINIMUM refusé
  (`PROFIL_INCONNU`) ; Factur-X EXTENDED et EXTENDED-CTC-FR tous deux au profil `Extended-CTC-FR`
  (`Facture.Specification` les distingue) ; lignes de groupe ou d'information sans quantité ni prix lues à 0, unité
  vide ; exemples BASIC WL : adresse électronique au schéma EM (courriel), non 0225 ; erreur `DONNEE_INVALIDE` pour un
  terme obligatoire absent ou une date / un nombre illisible ; tout CII (y compris XML Factur-X) conforme au XSD D22B.

## Lot 3 : lecture UBL 2.1 — FAIT (09/11/2026)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `Formats/LectureUbl.cs` (Invoice et CreditNote → `ModeleFacture`), `artefacts/xsd/ubl-2.1/` (XSD
  OASIS nécessaires), `Formats/Lecture.cs` (détection de la syntaxe : CII, UBL, PDF Factur-X), tests `LectureUblTests.cs`,
  comparaison CII ↔ UBL des mêmes cas FNFE (UC1–UC5, UC13 existent dans les deux syntaxes).
- **Critère de fin** : chaque cas FNFE donne le même modèle en CII et en UBL (test d'égalité) ; `dotnet test` vert.
- **Réalisé** : `dotnet/LogiBTP.FactureElectronique/Formats/{LectureUbl,Lecture,OutilsLecture}.cs` (`Lecture.Detecter` /
  `Lecture.Lire` → `FactureLue(Syntaxe, Facture)` : PDF si « %PDF- » dans le premier Ko, sinon racine XML CII, UBL Invoice
  ou CreditNote, autre racine `SYNTAXE_INCONNUE` ; `OutilsLecture` : chargement sûr, décimaux, termes obligatoires,
  partagés avec `LectureCii`), `ValidationXsd.cs` (`JeuXsd.UblInvoice`, `UblCreditNote`), `artefacts/xsd/ubl-2.1/`
  (maindoc Invoice et CreditNote, 13 `common/` importés, OASIS UBL 2.1 OS du paquet FNFE ; `artefacts/VERSION`),
  `tests/exemples/ubl/{en16931,extended-ctc-fr}/` (les 13 cas FNFE, jumeaux des CII), `tests/exemples/logibtp/`
  (`S5_PAYEUR_EXTENDED-CTC-FR_UBL.xml`, jumeau du S5 CII ; `AVOIR_F202500011_EN16931_{CII,UBL}.xml`, avoir 381 en
  CreditNote, aucun exemple FNFE n'en ayant), tests `LectureUblTests.cs` (égalité du modèle sérialisé en JSON pour les
  15 paires CII ↔ UBL, XSD, termes propres à l'UBL, détection, erreurs) ; codes JS ↔ C# : `CODE_EXIGIBILITE_TVA`
  (UNTDID 2475) et `CODE_EXIGIBILITE_TVA_UBL` (UNTDID 2005), `TYPE_DOCUMENT_REFERENCE.PROJET_AVOIR_UBL` (50),
  `SCHEMA_IDENTIFIANT.CREANCIER_SEPA` et `TVA_UBL`. Corrections du lot 1 : historique `null` traité comme vide dans
  `ReglesCycleVie.cs` et `cycle-vie.js` (trois cas ajoutés à `01_cycle_vie.json`) ; le commentaire au-dessus
  d'`ERREUR_FE` dans `codes.js` était déjà corrigé au lot 2. Tests : 141 en C# pour le module (suite .NET : 1143), 124
  en JS. Écarts : le modèle garde les conventions du CII (BT-8 UBL 3 / 35 / 432 lu 5 / 29 / 72 ; BT-21 tiré du
  préfixe « #CODE# » de la note) ; CII : `DepartmentName` (BT-41-0, sans terme EN16931 ni équivalent UBL) n'est plus lu
  comme nom du contact (BT-41 = `PersonName`) ; UBL : rabais BT-147 nul non retenu (l'`AllowanceCharge` du prix sert
  aussi à porter le prix brut), `InvoicePeriod` sans date (BT-8 seul) → pas de période, identifiant SEPA (BT-90) hors
  identifiants de la partie ; CreditNote : BT-9 en `PaymentMeans/PaymentDueDate`, BT-11 en
  `AdditionalDocumentReference` de type 50 ; sous-ligne (EXT-FR-FE-162/163) lue dans le `BillingReference` de ligne
  qui porte un `DocumentStatusCode`, un autre `BillingReference` de ligne étant la facture antérieure (EXT-FR-FE-BG-06) ;
  profils UBL acceptés : EN16931, ses CIUS (`…#compliant#…` hors Factur-X BASIC) et EXTENDED-CTC-FR ; le XSD xmldsig
  d'UBL portant une DTD interne, les XSD embarqués sont lus avec `DtdProcessing.Parse` (résolveur limité à
  l'assemblage ; le XML reçu reste sans DTD).

## Lot 4 : schematrons FNFE, validation par SaxonJS — FAIT (09/11/2026)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `artefacts/schematrons/` (EN16931 CII / UBL, EXTENDED-CTC-FR, BR-FR-Flux2 CII / UBL standard et
  WARNING, CDAR ; XSLT compilés du paquet FNFE 1.4.0.04, fichier `VERSION` et licence Apache-2.0), `js/outils/valider.js`
  (SaxonJS + `xslt3` en dépendances de développement : XSD puis schematrons selon syntaxe et profil, rapport SVRL →
  liste { niveau, règle, message, emplacement }), script `npm run valider-facture -- <fichier>`, `js/test/schematrons.test.js`
  (exemples FNFE valides : aucune erreur fatale ; cas altérés : erreur attendue).
- **Règles** : outil seulement (pas de validation XSLT 2.0 dans le serveur, Q6) ; le serveur valide XSD + complétude
  (lot 16) et lit les accusés de la PA.
- **Critère de fin** : `npm run valider-facture` sur les exemples FNFE sans erreur fatale ; tests verts ; dépendances
  rapportées. Procédure de mise à jour des artefacts décrite dans le `CLAUDE.md` du module.
- **Réalisé** : `artefacts/schematrons/{en16931,extended-ctc-fr,factur-x/{basicwl,en16931,extended},br-fr-flux2,cdar}/`
  (16 fichiers, 8,6 Mo : XSLT des dossiers `2xslt` du paquet FNFE 1.4.0.04 copiés sans modification, avec les
  `_codedb.xml` de Factur-X lus par `document()` ; BR-FR-Flux2 identique dans les cinq dossiers CII / Factur-X et les
  deux UBL : une copie ; `artefacts/VERSION` : origine, versions et licences — FNFE Apache-2.0, schematrons EN16931 de
  la Commission EUPL 1.2), `js/outils/schematrons.js` (catalogue `SCHEMATRONS` / `JEUX_XSD`, compilation en SEF par
  `xslt3` en parallèle, `npm run compiler-schematrons [-- --forcer]`), `js/outils/valider.js` (`validerFacture`,
  `controlesAEnchainer`, `extraireXmlFacturX` ; `npm run valider-facture -- <fichier>… [--warning] [--facturx] [--json]`,
  à la racine et dans le workspace), `js/test/schematrons.test.js` (59 tests : les 40 exemples FNFE et LogiBTP, XML et
  PDF, sans erreur fatale et en trois étapes ; cas altérés BR-FR-01 fatal puis avertissement en version WARNING,
  BR-CO EN16931, BR-FR-04 en UBL, XSD qui arrête l'enchaînement ; choix des contrôles ; erreurs `SYNTAXE_INCONNUE`,
  `XML_ILLISIBLE`, `XML_ABSENT`) ; codes JS ↔ C# `ETAPE_CONTROLE` (XSD, PROFIL, FRANCE) et `NIVEAU_CONTROLE` (flag
  SVRL : fatal, warning, information) ; dépendances de développement du workspace `saxon-js` et `xslt3` 2.7.0 (licence
  Saxonica : gratuite, redistribution binaire sans modification, pas open source), `xmllint-wasm` 5.3.0 (MIT) pour
  l'étape XSD ; `.gitignore` : `modules/facture-electronique/js/.sef/`. Décisions : SEF non versionnés (5 Mo chacun,
  61 Mo en tout) mais générés par le script (une minute sur 4 cœurs) et recompilés d'eux-mêmes quand un XSLT change
  (empreinte SHA-256 + chemin) ; étape XSD en Node par libxml2 en WebAssembly (pas de binaire système ni d'appel au
  .NET) ; une erreur XSD arrête l'enchaînement. Durée d'une validation (SEF chargés) : 150 à 900 ms (XSD 60 à 200 ms,
  schematron du profil 40 à 630 ms — Factur-X EXTENDED le plus lent —, BR-FR-Flux2 50 à 160 ms) ; premier
  chargement d'un SEF environ 1 s ; suite JS du module 15 s (75 s avec la compilation). Écarts : un XML seul au BT-24
  propre à Factur-X (BASIC WL, BASIC, EXTENDED Factur-X / ZUGFeRD) est contrôlé avec le XSD et le schematron Factur-X
  (le serveur prend D22B) ; EXTENDED-CTC-FR passe par le schematron EXTENDED-CTC-FR-CII même dans un Factur-X ; CDAR :
  BR-FR-CDV seul (XSD CDAR au lot 5, vérifié sur un exemple du paquet) ; PDF : XML extrait des flux FlateDecode
  (pas de lecteur PDF en Node) ; assertion sans `flag` (schematrons Factur-X) comptée fatale. Corrections du lot 3 : le
  cas `logibtp/S5_PAYEUR_EXTENDED-CTC-FR_{CII,UBL}.xml` était refusé (BT-123 « RELEVE » hors liste BR-FR-17 →
  `DOCUMENT_ANNEXE` ; type MIME `text/plain` hors BR-FREXT-CL-24 → `text/csv` ; UBL-SR-43 : `DocumentTypeCode` 916
  retiré d'une pièce jointe UBL), tests de lecture ajustés. Tests : 183 en JS pour le module, 143 en C# (suite .NET :
  1145).

## Lot 5 : CDAR, écriture et lecture des statuts (A FAIRE)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `Formats/Cdar.cs` (statut → CDAR D22B : facture référencée MDT-87 et date, code MDT-105, motif, action,
  émetteur et rôle, destinataires, montant et taux pour Encaissée, pièce jointe pour 224 ; lecture CDAR → statut),
  `artefacts/xsd/cdar-d22b/`, tests `CdarTests.cs` (les 60 exemples CDAR FNFE lus ; aller-retour écriture → lecture ;
  XSD), `js/test/cdar.test.js` (schematron BR-FR-CDV sur les CDAR écrits, via l'outil du lot 4).
- **Critère de fin** : exemples FNFE lus, CDAR écrits valides (XSD et schematron BR-FR-CDV) ; tests verts.

## Lot 6 : connecteur de plateforme (A FAIRE)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `dotnet/LogiBTP.FactureElectronique.Web/Connecteurs/ConnecteurPlateforme.cs` (classe mère, méthode
  patron : `DeposerAsync`, `RechercherAsync(curseur)`, `TelechargerAsync(flowId, docType)`, `AbonnerAsync` (réservé),
  `AnnuaireAsync` (SIREN, SIRET, routage, ligne d'annuaire), `SanteAsync`), `ConnecteurAfnor.cs` (Flow Service et
  Directory Service 1.3.0 : `multipart/form-data`, `sha256`, `Request-Id`, `Organization-Id`, pagination par curseur,
  erreurs 400–503 → codes, jeton par `IFournisseurJeton`), `ConnecteurSimule.cs` (PA simulée en mémoire / base : accusé
  Ok ou Error selon des règles de démo, statuts 200→205 programmés, factures reçues de démonstration), `ConnecteurManuel.cs`
  (repli Q1 (c) : rien n'est envoyé, le fichier est mis à disposition au téléchargement ; import manuel des fichiers et
  statuts reçus), `FabriqueConnecteurs.cs` (code de connecteur → classe ; surcharge par une PA : nouvelle classe
  enregistrée), tests `ConnecteurAfnorTests.cs` (serveur HTTP de test : contrat des swaggers), `ConnecteurSimuleTests.cs`.
- **Critère de fin** : le connecteur AFNOR passe les tests de contrat (dépôt, recherche paginée, téléchargement des
  trois `docType`, annuaire, erreurs) ; la plateforme simulée enchaîne dépôt → accusé → statuts ; `dotnet test` vert.

## Lot 7 : OAuth, flux CLIENT pour un fournisseur GENERIQUE (A FAIRE)

- **Module** : `modules/oauth`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : selon l'existant (`ServiceOAuth.cs`, `ReglesOAuth.cs`, page de paramétrage du module) ; jeu de test.
- **Contenu** : vérifier qu'une connexion GENERIQUE en flux CLIENT (adresse du jeton saisie, `client_id` / secret,
  portées) fonctionne ; sinon l'ajouter. Rien sur la facturation électronique (le module reste sans métier).
- **Critère de fin** : test d'obtention d'un jeton `client_credentials` sur un fournisseur GENERIQUE ; si rien n'est à
  changer, le lot passe à FAIT avec la preuve du test existant.

## Lot 8 : schéma, file, statuts, journal des étapes, relève, service (A FAIRE)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `db/099f_facture_electronique.sql` (rejouable) : `fe_parametre` (par société : connecteur, connexion
  OAuth, adresse de l'API, `Organization-Id`, notre adresse électronique, format et profil par défaut, fréquence de
  relève, découpage de l'e-reporting) ; `fe_flux` (sens, type, syntaxe, profil, règle de traitement, `trackingId`
  unique, `flowId`, empreinte, GED original / converti / lisible, élément lié `type_element` / `id_element` sans clé
  vers le cœur, état de file, accusé, essais, prochain essai, curseur) ; `fe_statut` (flux, code, motif, action, montant,
  taux, émetteur, sens reçu / posé, CDAR en GED, date) ; `fe_erreur` ; **`fe_evenement`** (flux, élément, type
  `EVENEMENT_FE`, état avant / après, acteur : utilisateur, système, plateforme ; détail JSONB ; horodatage ;
  `fev_empreinte` = SHA-256(empreinte précédente + contenu) ; triggers refusant UPDATE / DELETE / TRUNCATE) ;
  `fe_releve` (curseur et dernière relève par sens). `dotnet/LogiBTP.FactureElectronique.Web/` : `Donnees.cs`,
  `SpecialisationFactureElectronique.cs` (points de spécialisation : élément d'un flux, création d'une pièce reçue,
  statut posé, rangement GED, notification, droits), `ServiceFactureElectronique.cs`, `FileFlux.cs` (passage de fond
  par base : dépôts dus, reprises 1 / 5 / 15 / 60 min comme le Mail, `FOR UPDATE SKIP LOCKED`), `ReleveFlux.cs`
  (relève par curseur, Q11), `JournalFe.cs` (écriture et vérification de la chaîne), `Extensions.cs`
  (`AddModuleFactureElectronique<T>`, `MapModuleFactureElectronique`), tests.
- **Routes** (`/api/facture-electronique`) : paramètres, flux (liste, détail, fichier, chronologie), dépôt manuel,
  import manuel, nouvelle tentative, vérification de la chaîne du journal.
- **Règles** : jamais de changement de la pièce de l'application par le module (il signale, le cœur décide) ;
  `AlreadyExistingFlow` = succès ; un événement par étape et par changement d'état, sans exception.
- **Critère de fin** : tests de la file (reprises, doublon), de la relève (curseur, idempotence) et du journal (ajout
  seul, chaîne vérifiée, altération détectée) verts ; script ajouté au manifeste ; SQL non appliqué.

## Lot 9 : écrans du module (A FAIRE)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `js/ui/parametres-fe.js` (connecteur, connexion OAuth, adresses, formats, essai de connexion
  `healthcheck`), `js/ui/tableau-flux.js` (flux émis et reçus, filtres par état, sens, statut, erreurs ; liste par le
  module Liste si la vue s'y prête), `js/ui/detail-flux.js` (métadonnées, fichiers, statuts, erreurs, **chronologie**
  du journal), `js/ui/chronologie.js` (composant réutilisable par le cœur), `js/ui/depot-manuel.js` (télécharger le
  fichier à déposer, importer un fichier ou un statut reçu), `js/personnalisation/fr.json`, tests.
- **Règles d'interface** : aucun texte, icône ni couleur en dur ; `<dialog>` du socle ; `creerCombo` ; dates par
  `activerDates` ; raccourcis par `declarerRaccourcis`.
- **Critère de fin** : `npm test` vert ; écrans montés dans la page de démonstration du module avec la plateforme
  simulée.

## Lot 10 : catégories de TVA, catégorie EN16931 et VATEX (A FAIRE)

- **Module** : `modules/comptabilite`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `db/094g_comptabilite_tva_en16931.sql` (`ctv_categorie_en16931` S / E / AE / K / G / O / Z,
  `ctv_vatex` ; valeurs proposées depuis `ctv_comportement`), `Donnees.cs`, `SpecialisationComptabilite.cs` (lecture,
  enregistrement), écran des catégories, `js/src/codes.js` ↔ `Codes.cs` si un code s'ajoute, `CodesTests`.
- **Critère de fin** : tests du module verts ; la catégorie autoliquidation donne AE / `VATEX-FR-AE`.

## Lot 11 : branchement du cœur (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `src/LogiBTP.Api/Btp/FactureElectroniqueBtp.cs` (`SpecialisationFactureElectroniqueBtp`), `Program.cs`
  (activation par `MODULE_FACULTATIF.FACTURE_ELECTRONIQUE`), `client/src/app/codes.js` ↔ `src/LogiBTP.Domaine/Codes.cs`
  (code du module, `TYPE_ELEMENT` des flux), `SpecialisationDroitsBtp.Routes` (nœuds des routes), `db/3xx_facture_electronique.sql`
  (activation, droits, signaux de notification : facture reçue, rejet, refus, litige, erreur de file), page
  `client/src/app/pages/facture-electronique.js` et menu, onglet **Chronologie** des pièces (composant du lot 9 :
  événements du flux + historique du document), `db/installation/scripts.txt`.
- **Critère de fin** : module activable et désactivable sans erreur ; routes refusées sans droit (403) ; onglet visible
  sur une pièce liée à un flux de la plateforme simulée ; `npm test` et `dotnet test LogiBTP.slnx` verts.

## Lot 12 : réception, flux reçu → pièce en brouillon (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `Btp/ReceptionFactureBtp.cs` (modèle → `A_FACTURE` ou `T_FACTURE_AVT` en BROUILLON : fournisseur par
  SIREN puis SIRET, fiche provisoire sinon (`071`) ; commande par BT-13 ; marché de sous-traitance et chantier par
  BT-11 / BT-12 / BT-18 ; lignes, TVA (AE → autoliquidation), référence externe et date du fournisseur, `document_origine`
  IMPORT avec format et fichier), GED (étape RECEPTION, original, lisible, pièces jointes BR-FR-17, coffre : Q21), liste
  « Factures reçues à traiter » (`db/3xx`, vue et thème du module Liste), événements du journal (reçue, lue, rattachée,
  pièce créée), tests `ReceptionFactureBtpTests.cs` sur les exemples FNFE.
- **Règles** : jamais de validation automatique ; doublon (même fournisseur, même numéro) refusé et tracé ; écarts avec
  la commande en avertissements existants.
- **Critère de fin** : une facture reçue de la plateforme simulée crée la pièce en brouillon rattachée, PDF en GED,
  chronologie complète ; tests verts.

## Lot 13 : réception, statuts posés (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `Btp/StatutsReceptionBtp.cs` (Prise en charge 204 à la création, Approuvée 205 à la validation, En
  litige 207 et Refusée 210 par boutons avec motif de la liste, Paiement transmis 211 à l'enregistrement d'un règlement
  émis), paramètre « statut envoyé ou non » par code, boutons de la page document (`client/src/app/documents/`), textes,
  tests.
- **Règles** : transitions par `ReglesCycleVie` (lot 1) ; refus impossible après Approuvée ; chaque statut = CDAR
  déposé par la file + événement.
- **Critère de fin** : enchaînement 204 → 205 → 211 et 204 → 207 → 210 sur la plateforme simulée, refus d'une
  transition interdite ; tests verts.

## Lot 14 : réception hors plateforme (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : glisser-déposer d'un Factur-X ou d'un XML sur la liste à traiter ou sur la page d'une facture
  d'achat ; pièce jointe Factur-X d'un courriel rattaché (`MailBtp.cs`, proposition « Créer la facture ») ; même
  traitement que le lot 12 (flux de sens R, connecteur MANUEL) ; tests.
- **Critère de fin** : un Factur-X glissé crée la même pièce qu'un flux reçu, sans statut envoyé ; tests verts.

## Lot 15 : réception de sous-traitance (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `ReceptionFactureBtp.cs` (cadre S5 et bloc PAYEUR → facture de sous-traitance en paiement direct
  rattachée au marché, `019j`, `092b`), lecture d'un statut 224 (demande de paiement direct) rattaché à la facture du
  sous-traitant, autoliquidation contrôlée avec `per_st_autoliquidation`, tests.
- **Critère de fin** : cas UC13 FNFE et un cas de paiement direct reçus et rattachés ; tests verts. **Fin de la
  partie A : validation de l'utilisateur avant le lot 16.**

---

## Partie B : émission et e-reporting

## Lot 16 : contrôle de complétude et écriture CII (A FAIRE)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `js/src/completude.js` ↔ `dotnet/LogiBTP.FactureElectronique/ReglesCompletude.cs`, `tests/cas/02_completude.json`,
  `Formats/EcritureCii.cs` (EN16931 et EXTENDED-CTC-FR), tests (écrit → lu (lot 2) → égal ; XSD ; schematrons par
  l'outil du lot 4).
- **Règles répliquées JS ↔ C#** : BR-FR-01/02 (numéro), 04 (type), 05/06 (notes PMT, PMD, AAB), 08 (cadre), 09–11 et
  32 (SIREN / SIRET), 12/13 et 21–26 (adresses électroniques et routage), 15/16 (catégories et taux), CO-03 à 05
  (facture antérieure), CO-06/08 (acompte), DEC-01 à 04 (décimales), sommes EN16931 (BR-CO-10 à 16) ; résultat :
  liste { règle, niveau bloquant / avertissement, donnée }.
- **Critère de fin** : jeu de complétude identique en JS et en C# ; factures écrites sans erreur fatale aux schematrons
  EN16931 et BR-FR-Flux2 ; tests verts.

## Lot 17 : écriture UBL (A FAIRE)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `Formats/EcritureUbl.cs` (Invoice, CreditNote pour les avoirs), tests aller-retour et schematrons.
- **Critère de fin** : mêmes modèles écrits en UBL et en CII, relus égaux, valides ; tests verts.

## Lot 18 : PDF/A-3 et fichier associé (A FAIRE)

- **Module** : `modules/edition`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `js/src/rendu-pdf.js` (option PDF/A-3 : métadonnées XMP avec schéma d'extension fourni par
  l'appelant, OutputIntent sRGB, fichiers associés `/AF` avec `AFRelationship`, `EmbeddedFiles`), profil ICC livré,
  `CATALOGUE_FONCTIONS` si une fonction s'ajoute, tests Node et parité Jint, `npm run construire`.
- **Règles** : générique (le module ignore Factur-X : l'appelant fournit le fichier, son nom, sa relation et le XMP).
  PDF toujours déterministe.
- **Critère de fin** : PDF produit valide PDF/A-3b au contrôle veraPDF (lancé à la main, hors CI, résultat noté dans le
  plan) ; tests Node et C# verts.

## Lot 19 : e-reporting, écriture du flux 10 (A FAIRE)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `ModeleEreporting.cs` (transactions unitaires et agrégées, paiements, période), `Formats/EcritureFlux10.cs`
  (XSD `ereporting`, `transaction`, `payment`, `report` du paquet FNFE), `ReglesEreporting.cs` (agrégation par jour,
  taux et catégorie pour le B2C ; découpage en envois : **unitaire ou en plusieurs envois** selon le paramètre de la
  société, Q20 ; correction d'une période déjà envoyée), tests.
- **Prérequis** : périodicité et règles de rectification lues dans les spécifications externes DGFiP / AIFE v3.x
  (lien noté dans le lot).
- **Critère de fin** : flux 10.1 à 10.4 valides au XSD sur des jeux B2C et international ; tests verts.

## Lot 20 : annuaire sur la fiche personne (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : bouton « Vérifier dans l'annuaire » de la fiche personne (`client/src/app/fiches/fiche-annuaire.js`) :
  ligne d'annuaire → `per_fe_adresse`, `per_fe_plateforme`, `per_fe_code_routage` ; `db/3xx` (`per_fe_verifie_le`,
  `per_fe_suffixe`) ; vérification de nuit des tiers actifs, **en option** (paramètre, passage de fond par base) ;
  avertissement à l'émission si le tiers n'est pas dans l'annuaire ; tests.
- **Critère de fin** : vérification sur la plateforme simulée met la fiche à jour ; option de nuit désactivée par
  défaut ; tests verts.

## Lot 21 : paramètres d'émission BTP (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `db/3xx` (`type_document.tyd_fe_type_facture` BT-3 : V_FACTURE 380, V_FACTURE_AVT 380, facture
  d'acompte 386, V_AVOIR 381, avoir d'acompte 503 ; nature biens / services sur le type de ligne ou la nature de
  l'article, Q8), règle de calcul de la nature d'une pièce (B, S, M) et du cadre (1, 2, 4, 5, 6), répliquée si
  l'éditeur l'affiche (`client/src/calcul/` ↔ `src/LogiBTP.Calcul/`), notes PMT / PMD / AAB depuis les mentions de la
  société (`db/190`), paramètre TVA sur les débits, cas de test.
- **Critère de fin** : chaque type de vente donne son BT-3 et son cadre ; jeu de cas JS ↔ C# vert.

## Lot 22 : document de vente → modèle, cas simples (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `Btp/EmissionFactureBtp.cs` (facture, avoir avec facture antérieure BG-3, facture d'acompte 386,
  facture définitive B4 / S4 / M4 avec reprise d'acompte en ligne négative, parties : SIREN, SIRET, TVA, adresses
  électroniques, adresse de livraison, conditions de paiement, IBAN ; TVA par `ctv_categorie_en16931` et VATEX),
  affichage des résultats de complétude dans l'éditeur (bandeau de la pièce), tests sur des pièces de démonstration
  (écriture CII → schematrons par l'outil).
- **Critère de fin** : factures, avoirs, acomptes et définitives de la démonstration sans erreur fatale ; tests verts.

## Lot 23 : situations et pied BTP (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `EmissionFactureBtp.cs` (situation en **montants de période** quelle que soit `ent_avt_presentation`,
  période BG-26 ou BT-72 ; prorata et frais en remises / charges de document ; déductions d'acompte et de paiement
  direct ; **retenue de garantie en note ABU** et dans BT-20 ; références BT-11 / BT-17 / BT-18 du chantier et du
  marché ; arrondis aux deux décimales cohérents avec `MoteurDevisBtp`), tests sur des situations cumulées et en période.
- **Critère de fin** : situations de la démonstration valides (sommes BR-CO exactes) ; tests verts ; écarts d'arrondi
  documentés si la tolérance EXTENDED-CTC-FR est nécessaire.

## Lot 24 : émission à la validation (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : déclencheur à la validation (Q23 : automatique, option « envoyer plus tard », bouton « Émettre » pour les
  pièces antérieures), refus de validation si complétude bloquante pour un tiers B2B / B2G (Q5, droit FORCER), CII ou
  Factur-X (PDF de l'édition + XML par le lot 18, XMP Factur-X fourni par le cœur) selon la société ou le tiers
  (`per_fe_format`), GED (étape ENVOI) et coffre, mise en file, pastille de statut sur la pièce et colonne dans les
  listes de factures, tiers B2C ou hors annuaire : envoi habituel (aucun flux 2), tests.
- **Critère de fin** : une facture validée part vers la plateforme simulée, reçoit Déposée puis Mise à disposition,
  chronologie complète ; Factur-X validé par l'outil du lot 4 ; tests verts.

## Lot 25 : rejet, refus, litige (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : sur Rejetée (213) ou Refusée (210) : notification, proposition d'avoir interne d'annulation
  (`AnnulerParAvoirDans`, lien ANNULATION, note BAR = ARCHIVEONLY, flux en `ArchiveOnly` ou non déposé) puis copie en
  nouvelle facture ; pièce transférée en comptabilité : avoir daté du jour ; sur En litige (207) : suspension de la
  relance (module Relances, Q17) et levée à Approuvée ; tests.
- **Critère de fin** : scénarios rejet, refus et litige sur la plateforme simulée ; aucun changement de statut du
  document sans action de l'utilisateur ; tests verts.

## Lot 26 : statut Encaissée (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : proposition d'un statut 212 par règlement pointé d'une facture de services sans option sur les débits
  (montant encaissé, taux de TVA ; par échéance et par versement partiel), liste à valider avant envoi (comme les
  relances, Q15), annulation d'encaissement (cas 34), tests.
- **Critère de fin** : encaissements partiels et total d'une situation donnent les bons CDAR ; tests verts.

## Lot 27 : sous-traitance, cotraitance et B2G émises (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : facture d'un titulaire au maître d'ouvrage intégrant les sous-traitants ; cotraitance (cadre S6,
  RECAPITULATIF_COTRAITANCE) ; B2G par la PA (code service, numéro d'engagement de la fiche, Q19) ; tests.
- **Critère de fin** : cas B2G et cotraitance valides à l'outil ; tests verts.

## Lot 28 : e-reporting, collecte et envoi (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : collecte des ventes B2C (`per_fe_type` = B2C ou non assujetti) et internationales, et des
  encaissements correspondants (module Règlements), extraction vers le modèle du lot 19 sur la période, paramètre de
  la société **envoi unitaire ou en plusieurs envois** (Q20), liste des périodes (préparée, envoyée, acceptée,
  rejetée), relance et correction d'une période, journal, tests.
- **Critère de fin** : une période de démonstration B2C et une internationale envoyées à la plateforme simulée,
  dans les deux modes d'envoi ; tests verts.

## Lot 29 : archivage, démonstration, documentation (A FAIRE)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : règle de rétention GED des flux (10 ans, Q21) dans `db/3xx` ; données de démonstration (plateforme
  simulée, factures reçues et émises) ; `documentation/modules/FACTURE-ELECTRONIQUE.md`, `MODULES.md`,
  `documentation/JOURNAL-LOTS.md`, `TODO.md` (restes) ; `npm run rapport-dependances`.
- **Critère de fin** : `npm test`, `npm run exporter-resultats`, `dotnet test LogiBTP.slnx` verts ; documentation à
  jour.
