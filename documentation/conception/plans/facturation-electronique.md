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
| 5 | CDAR : écriture et lecture des statuts | module | 1 | FAIT (09/11/2026) |
| 6 | Connecteur : contrat, AFNOR XP Z12-013 (Flow, Directory), plateforme simulée, dépôt manuel | module | 1, 5 | FAIT (09/11/2026) |
| 7 | OAuth : flux CLIENT pour un fournisseur GENERIQUE (si absent) | `modules/oauth` | — | FAIT (10/11/2026) |
| 8 | Schéma, file des flux, statuts, **journal des étapes chaîné**, relève par base, service et routes | module | 6 | FAIT (10/11/2026) |
| 9 | Écrans du module : paramètres, tableau des flux, détail et chronologie, dépôt et import manuels | module | 8 | FAIT (10/11/2026) |
| 10 | Catégories de TVA : catégorie EN16931 et code VATEX | `modules/comptabilite` | — | FAIT (10/11/2026) |
| 11 | Branchement du cœur : activation, droits, spécialisation, paramètres, notifications, onglet Chronologie | cœur | 8, 9, 7 | FAIT (10/11/2026) |
| 12 | Réception : flux reçu → pièce d'achat ou de sous-traitance en brouillon, rattachements, liste à traiter | cœur | 11, 2, 3, 10 | FAIT (10/11/2026) |
| 13 | Réception : statuts posés (204, 205, 207, 210) et Paiement transmis (211) | cœur | 12, 5 | FAIT (10/11/2026) |
| 14 | Réception hors plateforme : Factur-X ou XML glissé ou reçu par courriel, avoirs reçus | cœur | 12 | FAIT (10/11/2026) |
| 15 | Réception de sous-traitance : cadre S5, bloc PAYEUR, demande de paiement direct (224) | cœur | 12, 13 | A FAIRE |
| | **Partie B : émission et e-reporting** | | | |
| 16 | Contrôle de complétude (JS ↔ C#) et écriture CII D22B (EN16931, EXTENDED-CTC-FR) | module | 1, 4 | FAIT (11/11/2026) |
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

## Lot 5 : CDAR, écriture et lecture des statuts — FAIT (09/11/2026)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `Formats/Cdar.cs` (statut → CDAR D22B : facture référencée MDT-87 et date, code MDT-105, motif, action,
  émetteur et rôle, destinataires, montant et taux pour Encaissée, pièce jointe pour 224 ; lecture CDAR → statut),
  `artefacts/xsd/cdar-d22b/`, tests `CdarTests.cs` (les 60 exemples CDAR FNFE lus ; aller-retour écriture → lecture ;
  XSD), `js/test/cdar.test.js` (schematron BR-FR-CDV sur les CDAR écrits, via l'outil du lot 4).
- **Critère de fin** : exemples FNFE lus, CDAR écrits valides (XSD et schematron BR-FR-CDV) ; tests verts.
- **Réalisé** : `Formats/ModeleCdar.cs` (modèle : `MessageCdar` → `AccuseCdar` (MDB-03) → `StatutFactureCdar` (MDG-32) →
  `DetailStatutCdar` (MDG-37) → `CaracteristiqueCdar` (MDG-43), `PartieCdar`, `PieceJointeCdar`, `NoteCdar` ; entrée
  `StatutAEcrire` + `FactureReferencee`, `MontantEncaisse` ; sortie `StatutLu` ; `ExceptionCdar`), `Formats/Cdar.cs`
  (`Construire` : contrôle par `ReglesCycleVie.Controler` puis données obligatoires BR-FR-CDV (MDT-87, MDT-100 et
  MDT-129 sauf Irrecevable, MDT-215 d'Encaissée, MDT-38 et rôle non WK en phase de traitement, MDT-73 des destinataires
  hors plateformes) ; rôle déduit de l'émetteur (WK, SE, BY, AB), phase MDT-77 (305 pour 200, 201, 202, 203, 213, 221,
  501 ; 23 sinon), code UNTDID 1373 MDT-88 de l'onglet « Acteurs CDV », PPF ajouté en destinataire d'un statut
  obligatoire, message pour le seul PPF en profil einvoicingF2 sans MDT-2, identifiant par défaut
  numéro_statut_date-heure tenu en 50 caractères ; `Ecrire` (UTF-8 sans BOM, validé par le XSD) ; `Lire` (XSD,
  termes MDT-4, MDT-8, MDT-87, MDT-105 exigés) ; `StatutsLus` (émetteur déduit du rôle — Rejetée de plateforme : PA-R si
  un acheteur est destinataire —, B2G si l'expéditeur est Chorus Pro, contrôle par `ReglesCycleVie`)),
  `ValidationXsd` (`JeuXsd.CdarD22B`), `Lecture.Detecter` reconnaît un CDAR (`Lecture.Lire` le refuse :
  `SYNTAXE_INCONNUE`) ; `artefacts/xsd/cdar-d22b/` (14 XSD du paquet FNFE 1.4.0.04 copiés sans modification),
  `tests/exemples/cdar/fnfe/` (les 59 CDAR de `Z.example/TEST/CDAR`), `tests/exemples/cdar/logibtp/` (17 CDAR écrits :
  200 à 225 et 501, dont Encaissée à deux taux, Encaissée pour le PPF, litige avec données invalides et attendues,
  paiement direct avec pièce jointe) ; codes JS ↔ C# `ROLE_CDAR`, `TYPE_ACCUSE_CDAR`, `PROCESSUS_CDV`, `PROFIL_CDV`,
  `CARACTERISTIQUE_CDV`, `MATRICULE_PLATEFORME`, `SCHEMA_IDENTIFIANT.PLATEFORME` (0238) ; outil Node : étape XSD CDAR
  D22B avant BR-FR-CDV (`JEUX_XSD.CDAR_D22B`). Tests : `CdarTests.cs` (98 : exemples FNFE lus, statut admis par le
  cycle de vie, réécrits et relus à l'identique du modèle ; émetteur déduit ; 17 cas écrits identiques aux fichiers de
  référence — régénérés par `LOGIBTP_REGENERER_CDAR=1` —, relus à l'identique ; refus du cycle de vie et données
  absentes ; erreurs de lecture), `js/test/cdar.test.js` (82 : les 76 CDAR sans erreur fatale ni avertissement en
  XSD puis BR-FR-CDV ; cas altérés BR-FR-CDV-14, -15, -08, CL-09, XSD). Écarts : `STATUTS_MOTIF_OBLIGATOIRE` élargi à
  Approuvée partiellement, Suspendue et Irrecevable (BR-FR-CDV-15 fatal ; le lot 1 tenait le motif de Suspendue pour
  facultatif) dans les deux langages et le jeu `01_cycle_vie.json` ; Erreur de routage et Irrecevable écrits en phase
  305 sans MDT-88 (le code 5 de l'onglet n'y est pas admis, BR-FR-CDV-CL-05) ; pièce jointe facultative pour 224 (rien
  ne l'impose dans le schematron) ; libellés de statut, motif et action recopiés s'ils sont fournis (pas de libellé
  en dur) ; un message mono-document (MDT-74 faux) par statut écrit, la lecture prenant les blocs multiples ; refus
  B2G : motifs propres seulement si l'expéditeur est Chorus Pro (matricule 9999), à fournir par l'appelant. Tests : 266
  en JS pour le module, 247 en C# (suite .NET : 1249).

## Lot 6 : connecteur de plateforme — FAIT (09/11/2026)

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
- **Réalisé** : projet `dotnet/LogiBTP.FactureElectronique.Web` (Socle, Socle.Web, `Microsoft.AspNetCore.App` ; ni EF
  ni schéma), dossier `Connecteurs/` : `ModeleConnecteur.cs` (`ParametresConnecteur` : code, base, adresses Flow et
  Directory, connexion OAuth, `Organization-Id`, délai ; `FluxADeposer`, `FluxDepose`, `Flux`, `AccuseFlux`,
  `CriteresFlux`, `PageFlux`, `FichierFlux`, abonnement, `EtatSante` ; annuaire : `UniteLegale`, `Etablissement`,
  `CodeRoutage`, `LigneAnnuaire`, `RechercheAnnuaire`), `ExceptionConnecteur.cs` (dérive d'`ExceptionMetier` ; code,
  statut HTTP, `errorCode` de la PA, `Request-Id`, `Reessayable` pour 408, 429, 5xx sauf 501 et PA injoignable),
  `ConnecteurPlateforme.cs` (méthode patron : contrôles avant envoi — fichier ≤ 100 Mo, nom ≤ 255, identifiants ≤ 64,
  énumérations, limite 1 à 100, SIREN / SIRET, code de routage —, SHA-256, puis étapes protégées ; `DeposerAsync`,
  `RechercherAsync`, `RechercherToutAsync` (toutes les pages, dernier curseur), `FluxAsync` (Metadata),
  `TelechargerAsync` (Original, Converted, ReadableView), `AbonnerAsync` (réservé), `SanteAsync` (sans exception),
  annuaire en 8 opérations ; annuaire et abonnement `FONCTION_NON_PRISE_EN_CHARGE` par défaut), `ConnecteurAfnor.cs`
  (multipart `flowInfo` JSON + `file` en application/xml ou application/pdf, `Request-Id` UUID par appel,
  `Organization-Id`, Bearer par `IFournisseurJeton` sans dépendre d'OAuth, curseur, `docType`, chemins
  `code-insee:` / `siret:` / `code:` et `include`, statuts 400–503 → `ERREUR_FE`, délai, message de la PA passé par
  `Masquage` ; journal : méthode, chemin, statut, Request-Id, durée, jamais d'en-tête ni de jeton ; points de
  surcharge `AdresseFlux`, `AdresseAnnuaire`, `PreparerAsync`, `ErreurAsync`), `PlateformeSimulee.cs` (accusé Pending
  puis Ok / Error après un délai ; règles : EmptyFlow, FileSizeExceeded, ChecksumMismatch, AlreadyExistingFlow,
  FlowTypeError, InvalidSchema, numéro contenant « REJET » → OtherTechnicalError ; statuts 200 → 205 programmés, écrits
  par `Cdar.Ecrire` en flux entrants CustomerInvoiceLC ; factures et statuts reçus de démonstration ; Converted =
  XML d'un Factur-X, ReadableView = résumé texte ; curseur « rang:N » ; temps par `TimeProvider` ; magasin
  `IMagasinFlux` / `MagasinFluxMemoire`, remplaçable au lot 8 ; registre `PlateformesSimulees` par base),
  `AnnuaireSimule.cs`, `ConnecteurSimule.cs`, `ConnecteurManuel.cs` (dépôt tenu localement en Pending, Original
  téléchargeable, `Confirmer` Ok / Error, `Importer` facture ou CDAR reçus ; registre `DepotsManuels` par base),
  `FabriqueConnecteurs.cs` (AFNOR, SIMULE, MANUEL ; `EnregistrementConnecteur` d'une PA, même code = remplacement),
  `Extensions.cs` (`AddConnecteursFactureElectronique`, `AddConnecteurPlateforme`). Codes JS ↔ C# : `CONNECTEUR_FE`,
  `TYPE_DOCUMENT_FLUX`, `ORIGINE_REGLE`, `OPERATEUR_ANNUAIRE`, `TYPE_PLATEFORME_ANNUAIRE`, `ETAT_LIGNE_ANNUAIRE`,
  15 `ERREUR_FE` du connecteur. Swaggers recopiés sans modification dans `artefacts/api/` (`VERSION`). Tests :
  `ServeurAfnorTest.cs` (PA locale Kestrel sur 127.0.0.1 adossée à la plateforme simulée : jeton, Request-Id,
  multipart, énumérations lues dans les swaggers), `ConnecteurAfnorTests.cs` (33 : énumérations identiques aux
  swaggers, chemins appelés présents dans les swaggers, dépôt, pagination, trois `docType`, annuaire, 11 statuts
  d'erreur, délai, port fermé, jeton absent des journaux, fabrique et PA dérivée), `ConnecteurSimuleTests.cs` (4 :
  dépôt → accusé → 200 à 205 relus par `Cdar.StatutsLus` sans erreur, relève idempotente, règles d'Error, reçus,
  connecteur manuel). Écarts : le Directory Service ne déclare ni `Request-Id` ni `Organization-Id`, envoyés quand
  même (ignorés par une PA conforme) ; `Metadata` passe par `FluxAsync`, pas par `TelechargerAsync` ; abonnement :
  création seule (liste et suppression non faites, Q11) ; connexion OAuth exigée (pas d'accès anonyme) ; type d'un
  CDAR déposé déduit du rôle de l'émetteur (vendeur → CustomerInvoiceLC, sinon SupplierInvoiceLC). Tests : 290 en C#
  pour le module, 266 en JS (inchangés).

## Lot 7 : OAuth, flux CLIENT pour un fournisseur GENERIQUE (FAIT (10/11/2026))

- **Module** : `modules/oauth`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : selon l'existant (`ServiceOAuth.cs`, `ReglesOAuth.cs`, page de paramétrage du module) ; jeu de test.
- **Contenu** : vérifier qu'une connexion GENERIQUE en flux CLIENT (adresse du jeton saisie, `client_id` / secret,
  portées) fonctionne ; sinon l'ajouter. Rien sur la facturation électronique (le module reste sans métier).
- **Critère de fin** : test d'obtention d'un jeton `client_credentials` sur un fournisseur GENERIQUE ; si rien n'est à
  changer, le lot passe à FAIT avec la preuve du test existant.
- **Réalisé** : rien à changer dans `ServiceOAuth` / `ClientOAuth` : GENERIQUE en flux CLIENT était déjà géré (adresse du
  jeton obligatoire à l'enregistrement du client, portées saisies, `ClientCredentialsAsync` renouvelé par `JetonAsync`).
  Ajout de `LogiBTP.OAuth.Tests/ClientOAuthGeneriqueTests.cs` (faux point de jeton en mémoire : adresse saisie,
  grant_type, client_id, secret, portées, renouvellement) ; libellé du flux CLIENT neutralisé dans
  `client/personnalisation/fr.json` ; `modules/oauth/CLAUDE.md` mis à jour. Aucun SQL.

## Lot 8 : schéma, file, statuts, journal des étapes, relève, service — FAIT (10/11/2026)

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
- **Réalisé** : `modules/facture-electronique/db/099f_facture_electronique.sql` (rejouable, au manifeste après
  `099_crm_fil`) : `fe_parametre` (une ligne : actif, connecteur, connexion OAuth, adresses, Organization-Id, adresse
  électronique et schéma, syntaxe et profil par défaut, fréquence de relève, délai, découpage `DECOUPAGE_EREPORTING`),
  `fe_flux` (sens, type, syntaxe, profil, règle, numéro lu, `ffl_id_suivi` unique, `ffl_id_flux` unique par connecteur,
  empreinte, GED original / converti / lisible, élément `ffl_type_element` / `ffl_id_element`, état `ETAT_FLUX`, accusé
  et détails, essais, prochain essai, dernière erreur, curseur), `fe_fichier` (fichiers gardés : le dépôt part de
  l'original), `fe_statut` (`SENS_STATUT` reçu / posé, facture connue ou numéro seul, CDAR porteur, erreurs du
  contrôle), `fe_erreur`, `fe_evenement` (rang, flux, élément, type `EVENEMENT_FE`, avant / après, acteur `ACTEUR_FE`,
  utilisateur, détail JSONB, horodatage, empreintes ; trigger `fn_fe_evenement_chainer` : verrou de transaction, rang
  suivant, heure du serveur à la milliseconde, SHA-256(précédente | rang | horodatage | type | flux | élément | avant |
  après | acteur | utilisateur | détail::text) ; UPDATE, DELETE et TRUNCATE refusés, TRUNCATE de `fe_flux` aussi),
  `fe_releve` (curseur par sens), `fe_magasin` + séquence (plateforme simulée et dépôt manuel en base).
  `dotnet/LogiBTP.FactureElectronique.Web/` (EF Core Npgsql ajouté) : `Donnees.cs`, `JournalFe.cs` (écriture par INSERT,
  détail sans champ sensible et masqué, chronologie d'un flux ou d'un élément, `Verifier` : rangs consécutifs,
  chaînage, empreinte), `SpecialisationFactureElectronique.cs` (`ElementDuFluxAsync`, `CreerPieceRecueAsync`,
  `StatutRecuAsync`, `StatutPoseAsync`, `RangerAsync`, `LireFichierAsync`, `SignalerAsync`, `ExigerParametrage`,
  `Exiger`), `ServiceFactureElectronique.cs` (paramètres contrôlés `PARAMETRE_INVALIDE`, `MettreEnFileAsync` : doublon
  même suivi et même fichier = flux existant, autre fichier = 409 ; réception : facture lue puis rattachée ou créée par
  l'application, CDAR → statuts de la facture visée par numéro et sens ; accusé : Ok ou AlreadyExistingFlow seul →
  ACQUITTE, Error → ERREUR + `fe_erreur` + signalement ; `PoserStatutAsync` contrôlé par `ReglesCycleVie` ; nouvelle
  tentative, dépôt manuel confirmé, import manuel, fichier, chronologie, vérification), `FileFlux.cs` (un flux par
  transaction, `FOR UPDATE SKIP LOCKED`, reprises 1 / 5 / 15 / 60 min puis ERREUR, tâche `PassageFactureElectronique`
  par base active, base sans schéma ignorée), `ReleveFlux.cs` (curseur par sens, fréquence, idempotente par connecteur +
  flowId, un échec n'avance pas le curseur), `MagasinFluxBase.cs` (`IMagasinFlux` en base, cache par base et magasin),
  `Extensions.cs` (`AddModuleFactureElectronique<T>`, `MapModuleFactureElectronique` ; `AddConnecteursFactureElectronique`
  prend désormais un magasin par base **et** par magasin). Codes JS ↔ C# ajoutés : `ACTEUR_FE`, `SENS_STATUT`,
  `DECOUPAGE_EREPORTING`, `ERREUR_FE.FLUX_INTROUVABLE`, `ETAT_FLUX_INVALIDE`, `PARAMETRE_INVALIDE`. Routes
  (`/api/facture-electronique`) : `GET|PUT /parametres`, `GET /sante`, `GET /flux`, `GET /flux/{id}`,
  `GET /flux/{id}/fichier?document=`, `GET /flux/{id}/chronologie`, `GET /chronologie?type_element=&id_element=`,
  `POST /flux/{id}/tentative`, `POST /flux/{id}/depot-manuel`, `POST /import`, `POST /releve`,
  `GET /journal/verification`. Tests : `JournalFeTests` (5, sans base) et `ServiceFactureElectroniqueTests` (6, base
  `LOGIBTP_TEST_PG` où 099f est chargé : dépôt et doublon, reprises puis erreur et nouvelle tentative, relève avec accusés,
  statuts 200 → 205, curseur et idempotence, AlreadyExistingFlow, facture reçue rattachée et import, dépôt manuel avec
  magasin en base, journal en ajout seul, chaîne vérifiée, altération détectée) ; module : 304 tests C# (dont les 6 de
  base, verts avec la base jetable), 266 JS. Écarts : un flux CDAR reçu a ses propres étapes (RECEPTION puis CONTROLE
  RECU → TRAITE) et chaque statut une étape STATUT_RECU sur le flux de la facture (avant / après = statut affiché) ;
  horodatage du journal = heure du serveur PostgreSQL ; fichiers gardés dans `fe_fichier` même rangés en GED ;
  nouvelle tentative d'un flux refusé = nouveau dépôt sous un nouvel identifiant de suivi ; `PoserStatutAsync` sans
  route (lot 13) ; magasin en base gardé en cache par processus (une instance de l'API par base) ; routes non
  rattachées aux droits tant que le cœur ne les monte pas (lot 11). **Script à appliquer par l'utilisateur** :
  `099f_facture_electronique.sql` (par `installation base mettre-a-jour`).

## Lot 9 : écrans du module — FAIT (10/11/2026)

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
- **Réalisé** : `js/ui/` : `modeles.js` (fonctions pures : `controlerParametres` ↔ `ReglesParametresFe.Controler`
  (nouveau, C#, jeu partagé `tests/cas/02_parametres.json`, utilisé par `EnregistrerParametres` : PARAMETRE_INVALIDE
  liste les champs en défaut), requête et pages du tableau, gravités, `actionsFlux` comme le serveur (nouvelle
  tentative, dépôt manuel en attente), documents proposés, chronologie par jour, détail JSON à plat, base 64),
  `parametres-fe.js` (`ParametresFe` : connecteur, connexion OAuth fournie par l'hôte, adresses, Organization-Id,
  adresse électronique, syntaxe, profil, relève, délai, découpage ; essai `GET /sante` sur les paramètres enregistrés,
  enregistrement proposé d'abord s'ils sont modifiés), `tableau-flux.js` (`TableauFlux` : filtres sens, état, type,
  statut affiché, erreurs, jours de création, gardés dans le `localStorage` ; pages par identifiant ; relève à la
  demande ; vérification de la chaîne du journal), `detail-flux.js` (`DetailFlux` : métadonnées, accusé, fichiers à
  télécharger, statuts, erreurs, chronologie ; nouvelle tentative confirmée, accusé du dépôt manuel),
  `chronologie.js` (`Chronologie` et `chronologieHtml`, réutilisables par le cœur : étapes par jour, type, acteur,
  avant → après (état de file ou statut), détail et empreinte dépliables, préférence du navigateur ; mode élément
  avec lien vers chaque flux), `depot-manuel.js` (`PanneauDepotManuel`, `confirmerDepotManuel`, `importerFichier`,
  `telechargerDocumentFlux`), `api.js` (`creerApiFe` : routes du module sur le transport de l'hôte), `index.js`,
  `facture-electronique.css` ; `js/personnalisation/` (`fr.json`, `images/icones.json`, `theme.css`), couche déclarée
  dans `client/personnalisation/couches.js` ; raccourcis par groupe (`facture_electronique_*`). Routes : filtres
  `erreurs` (avec ou sans `fe_erreur`) et `du` / `au` (jours de création, UTC) ajoutés à `GET /flux` (testés dans
  `ServiceFactureElectroniqueTests`). Page de démonstration `js/demo/` (`npm run demo --workspace
  @logibtp/facture-electronique`, Vite ajouté en développement) : API simulée en mémoire au comportement de la
  plateforme simulée (accusé Ok ou Error « REJET », statuts 200 → 205, dépôt manuel, import, journal chaîné), onglets
  Paramètres, Flux, Dépôt manuel, Chronologie d'une pièce, détail par `#flux=<id>`. Tests JS : `modeles.test.js`
  (jeu partagé, tableau, actions, chronologie), `ecrans.test.js` (clés, icônes, codes, ni fenêtre, `<select>`,
  touche, couleur ni stockage en dur, démonstration comprise), `import.test.js` (raccourcis, routes) ; module : 304
  tests JS, 305 C#. Écarts : statut affiché filtré sur les flux chargés (calculé, pas en base) ; le module Liste ne s'y
  prête pas (vues générées par le cœur) ; connexions OAuth fournies par l'hôte (le module ne dépend pas d'OAuth) ;
  écrans rendus en Chrome sans affichage, fenêtres non essayées en navigateur (TODO). Aucun SQL. Parité des blancs (revue) : `\s` de JS + U+0085 et U+001C à U+001F, U+FEFF compris côté C# (`EstBlanc`, `Rogner`) ; jeu `02_parametres.json` complété (U+FEFF, organisation entourée d'espaces).

## Lot 10 : catégories de TVA, catégorie EN16931 et VATEX — FAIT (10/11/2026)

- **Module** : `modules/comptabilite`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `db/094g_comptabilite_tva_en16931.sql` (`ctv_categorie_en16931` S / E / AE / K / G / O / Z,
  `ctv_vatex` ; valeurs proposées depuis `ctv_comportement`), `Donnees.cs`, `SpecialisationComptabilite.cs` (lecture,
  enregistrement), écran des catégories, `js/src/codes.js` ↔ `Codes.cs` si un code s'ajoute, `CodesTests`.
- **Critère de fin** : tests du module verts ; la catégorie autoliquidation donne AE / `VATEX-FR-AE`.
- **Réalisé** : `modules/comptabilite/db/094g_comptabilite_tva_en16931.sql` (rejouable, au manifeste après `094f` :
  `ctv_categorie_en16931` S / E / AE / K / G / O / Z avec contrainte, `ctv_vatex`, valeurs proposées depuis
  `ctv_comportement` seulement quand elles sont vides : N → S, A et I → AE / `VATEX-FR-AE`, E → E / `VATEX-EU-132`) ;
  `Donnees.cs` (entité, `CategorieTvaDto` : `CategorieEn16931`, `Vatex`), `ServiceComptabilite` (lecture, enregistrement,
  `TVA_EN16931`, même proposition si vides) ; `js/src/codes.js` ↔ `Codes.cs` (`CATEGORIE_EN16931`, `VATEX`,
  `COMPORTEMENT_TVA`, `CodesTests`), `js/src/tva.js` `proposerEn16931` ↔ `ReglesTva.cs`, jeu `05_tva_en16931.json` ;
  écran des catégories (`creerCombo` de la catégorie, saisie du VATEX, textes `comptabilite_btp.*`). Le module ne dépend
  pas de la facture électronique. Script à appliquer par l'utilisateur.

## Lot 11 : branchement du cœur — FAIT (10/11/2026)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `src/LogiBTP.Api/Btp/FactureElectroniqueBtp.cs` (`SpecialisationFactureElectroniqueBtp`), `Program.cs`
  (activation par `MODULE_FACULTATIF.FACTURE_ELECTRONIQUE`), `client/src/app/codes.js` ↔ `src/LogiBTP.Domaine/Codes.cs`
  (code du module, `TYPE_ELEMENT` des flux), `SpecialisationDroitsBtp.Routes` (nœuds des routes), `db/3xx_facture_electronique.sql`
  (activation, droits, signaux de notification : facture reçue, rejet, refus, litige, erreur de file), page
  `client/src/app/pages/facture-electronique.js` et menu, onglet **Chronologie** des pièces (composant du lot 9 :
  événements du flux + historique du document), `db/installation/scripts.txt`.
- **Critère de fin** : module activable et désactivable sans erreur ; routes refusées sans droit (403) ; onglet visible
  sur une pièce liée à un flux de la plateforme simulée ; `npm test` et `dotnet test LogiBTP.slnx` verts.
- **Réalisé** : `src/LogiBTP.Api/Btp/FactureElectroniqueBtp.cs` (`SpecialisationFactureElectroniqueBtp`, par portée :
  `ActifAsync` = module `facture_electronique` actif pour la base (`ModulesSociete`, cache de 30 s par base), la tâche de
  fond saute une base désactivée ; fichiers d'un flux rattaché à une pièce (`TYPE_ELEMENT_FE.DOCUMENT`, `ent_id`) rangés
  dans la GED de la pièce (type et groupe d'indices, catégorie `facture_electronique`, stockage sous `SocieteCourante.Base`),
  relus par `LireFichierAsync`, GED indisponible journalisée sans bloquer la file ; signaux RECUE (facture reçue), REJET
  (accusé Error ou statut 213), REFUS (210), LITIGE (207), ERREUR_FILE publiés aux comptes qui consultent le nœud,
  niveau et activation lus dans `facture_electronique_signal`, clé anti-doublon, types de préférences) ; module : la
  spécialisation et `FabriqueConnecteurs` passent **par portée** (jeton `IFournisseurJeton` du module OAuth et société
  de la requête ou de la base, jamais du conteneur racine), crochet `ActifAsync` lu par `PassageFactureElectronique`,
  filtre `type_element` / `id_element` dans l'API simulée de la démonstration. `Program.cs` : `AddModuleFactureElectronique`,
  routes sous `ExigeModule(ModulesFacultatifs.FactureElectronique)`, types de notification. Codes `MODULE_FACULTATIF`,
  `TYPE_ELEMENT_FE`, `SIGNAL_FE` (`codes.js` ↔ `Codes.cs`, `CodesTests`). Droits : nœud `facture_electronique`
  (Consulter, Modifier) au catalogue, `/api/facture-electronique` en module, tentative, dépôt manuel, import et relève
  en action Modifier, paramètres en `Parametrage`. `db/295_facture_electronique.sql` (rejouable, au manifeste après
  099f : activation désactivée à la création, droits copiés du nœud `comptabilite`, catégorie GED, signaux).
  Client : page `pages/facture-electronique.js` (onglets Flux avec détail, Dépôt manuel, Paramètres avec les connexions
  OAuth ; `?flux=<id>`), menu Ventes (module et droit), transport `facture-electronique/api-fe.js`, CSS du module ;
  onglet **Chronologie** de la page document (`documents/chronologie-document.js` : composant `Chronologie` du module
  en mode élément + historique des versions du document ; masqué sans module, sans droit ou sans flux ; Alt+9).
  Tests : `FactureElectroniqueBtpTests.cs` (toutes les routes du module déclarées, refusées sans droit comme
  `UseDroits` (403), Consulter en lecture, Modifier pour agir, paramètres au nœud Paramètres ; inscriptions par
  portée ; signaux), `client/test/facture-electronique.test.js` (onglet visible et rendu sur une pièce émise par la
  plateforme simulée, masqué sinon ; menu). Écrans non vérifiés en navigateur (TODO) ; script à appliquer par
  l'utilisateur.

## Lot 12 : réception, flux reçu → pièce en brouillon — FAIT (10/11/2026)

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
- **Réalisé** : `src/LogiBTP.Api/Btp/ReceptionFactureBtp.cs` (appelé par `SpecialisationFactureElectroniqueBtp.CreerPieceRecueAsync`) :
  avoir (BT-3) laissé à traiter ; fournisseur par SIREN puis SIRET (`ChoisirFournisseur` : fiche définitive avant
  provisoire, SIRET de la facture puis tête parmi les établissements du SIREN), sinon fiche provisoire (`CreerProvisoire`,
  relation FOURNISSEUR, SIREN et TVA repris) ; doublon (même fournisseur, même référence externe comparée sans
  séparateurs, A_FACTURE ou T_FACTURE_AVT de référence non annulée ni remplacée) refusé ; commande de sous-traitance
  du fournisseur désignée par BT-12 / BT-13 / BT-18 (numéro, ou code de son marché ST) → T_FACTURE_AVT par
  transformation, montants reçus à ventiler (`ent_st_saisie` RECUE, contrôle ST8 existant) ; sinon A_FACTURE :
  commande d'achat de BT-13 du fournisseur (`AccuseCommandeBtp.SqlCommandes`, pièces valables) → transformation des
  lignes rapprochées (`Rapprocher` : BT-132 = numérotation ou identifiant, puis article BT-155/156 = code, puis libellé),
  quantité et prix net de la facture en prix fixe (écart : avertissement `PRIX_ACHAT_ECART` existant à la validation),
  autres lignes ajoutées avant le pied ; commande non transformable ou aucune ligne rapprochée : pièce libre, chantier
  par BT-11 / BT-18 (code du chantier) ou BT-12 (code du marché), affaire et projet du chantier ; lignes
  (`PreparerLignes` : feuilles de l'arbre des sous-lignes en éléments au prix net ramené à la quantité de base, groupes
  et informations en textes, remises et charges du document, BASIC WL sans ligne : une ligne par ventilation de TVA ;
  unités UN/ECE par synonyme de `unite` puis correspondance) ; TVA (`ChoisirTva` : catégorie EN16931 de
  `ctv_categorie_en16931`, à défaut proposée par `ReglesTva` ; S au même taux, AE → taux autoliquidé, K → intracom,
  Z / G / O → exonéré) ; référence externe BT-1, `ent_date_externe` BT-2 ; jamais validée ; `document_origine` IMPORT
  (format = syntaxe, fichier = original en GED posé au rangement, référence, rapport : flux, fournisseur, commande,
  totaux, TVA et unités non reconnues, avertissements) ; pièces jointes BG-24 en GED. GED : fichiers d'un flux reçu
  rangés à l'étape RECEPTION puis au coffre (Q21) ; notification RECUE « pièce créée en brouillon, à vérifier ».
  Module : `PieceRecueFe` (créée / refusée), étapes `LECTURE` (résumé lu), `PIECE_CREEE`, `DOUBLON` (erreur
  `FACTURE_EN_DOUBLE`, facture restée RECU) en plus de RECEPTION et RATTACHEMENT (codes JS ↔ C#, textes, icônes,
  `099g` rejouable au manifeste) ; au rattachement, fichiers gardés rangés en GED de l'élément et vue lisible
  téléchargée de la plateforme ; chronologie d'un élément = ses étapes et celles des flux rattachés. Cœur :
  `db/296_facture_electronique_reception.sql` (rejouable : `v_liste_fe_recues`, résumé lu dans l'étape LECTURE, à
  traiter = sans pièce ou pièce en brouillon), source, thème et vue 1014 « Factures reçues à traiter » dans
  `vues-liste.js` (`db/121` régénéré), menu Ventes, ligne sans pièce ouverte sur le flux (`TYPE_ELEMENT_FE.FLUX` ↔
  `TypesElementFe.Flux`), `EtapesGed.Reception`. Tests : `ReceptionFactureBtpTests.cs` (lignes au total HT de chaque
  exemple FNFE dont PDF, sous-lignes, TVA dont AE, unités, fournisseur, rapprochement ; de bout en bout sur une base
  jetable `LOGIBTP_TEST_PG_JETABLE` : Factur-X UC1 de la plateforme simulée → A_FACTURE en brouillon d'un tiers
  provisoire, PDF en GED à l'étape RECEPTION au coffre, origine, chronologie RECEPTION → LECTURE → PIECE_CREEE →
  RATTACHEMENT, liste à traiter ; seconde réception refusée en doublon ; CII avec BT-13 → transformation de la
  commande), `ServiceFactureElectroniqueTests` (étapes, doublon, lisible), `client/test/liste-fe-recues.test.js`.
  Écrans non vérifiés en navigateur (TODO) ; scripts à appliquer par l'utilisateur.

## Lot 13 : réception, statuts posés — FAIT (10/11/2026)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `Btp/StatutsReceptionBtp.cs` (Prise en charge 204 à la création, Approuvée 205 à la validation, En
  litige 207 et Refusée 210 par boutons avec motif de la liste, Paiement transmis 211 à l'enregistrement d'un règlement
  émis), paramètre « statut envoyé ou non » par code, boutons de la page document (`client/src/app/documents/`), textes,
  tests.
- **Règles** : transitions par `ReglesCycleVie` (lot 1) ; refus impossible après Approuvée ; chaque statut = CDAR
  déposé par la file + événement.
- **Critère de fin** : enchaînement 204 → 205 → 211 et 204 → 207 → 210 sur la plateforme simulée, refus d'une
  transition interdite ; tests verts.
- **Réalisé** : règle (JS ↔ C#, jeu `01_cycle_vie.json`) : Refusée interdite après Approuvée ou Paiement transmis
  (`TRANSITION_INTERDITE`). Module : `ServiceFactureElectronique.PoserAsync` (contrôle `ReglesCycleVie`, CDAR écrit par
  `CdarDuStatut` depuis l'original : auteur acheteur, destinataire vendeur, adresse électronique de la facture ou des
  paramètres, PPF ajouté pour 210, motif, commentaire en note ; mis en file par `MettreEnFileAsync` ; `fe_statut` POSE ;
  étape STATUT_POSE avec origine et `envoye` ; dans la transaction en cours s'il y en a une), `PoserStatutAsync`
  (utilisateur, droit Modifier) et `PoserStatutApplicationAsync` (acteur SYSTEME) ; route `POST /flux/{id}/statut`
  (`DemandeStatut` : code, motif, action, commentaire ; nœud `facture_electronique`, Modifier) ; `PieceRecueFe.Statuts`
  posés après RATTACHEMENT dans la transaction de la réception (refus gardé en `fe_erreur`) ; paramètre
  `statuts_non_envoyes` (`099h` rejouable, au manifeste ; `ReglesParametresFe.StatutsParametrables` ↔
  `STATUTS_PARAMETRABLES` : statuts du vendeur ou de l'acheteur hors 210 et 212 exigés par le PPF, jeu
  `02_parametres.json`) : statut gardé au journal sans CDAR ; écrans : cases « Statuts posés envoyés » des paramètres,
  `demanderStatut` (fenêtre `<dialog>` du socle, motif par `creerCombo` de `motifsAutorises`, commentaire),
  `statutsProposes` / `motifsProposes` / `demandeStatutValable` (`modeles.js`), libellés des 51 motifs, icônes
  `fe_statut_207` / `fe_statut_210`. Cœur : `Btp/StatutsReceptionBtp.cs` (204 `ALaCreation`, 205 `ApprouverAsync` depuis
  `SpecialisationBtp.ApresValidationAsync` pour A_FACTURE / T_FACTURE_AVT, 211 `PaiementTransmisAsync` depuis
  `SpecialisationReglementBtp.ApresPointageAsync` pour les pièces pointées par un décaissement hors imputation
  (`PiecesPayeesAsync`) ; statut déjà posé ou plus posable ignoré, refus journalisé sans bloquer) ;
  `ReceptionFactureBtp` : création idempotente (`BrouillonDuFluxAsync` : brouillon de `document_origine` du même
  connecteur + identifiant de la plateforme, ou du même flux, repris avant le contrôle du doublon ; rapport complété de
  `connecteur` et `id_flux`) et original déjà en GED réutilisé (`RangerAsync`). Client : onglet Chronologie, bloc
  « Statut de la facture reçue » (statut affiché, boutons En litige / Refuser selon `statutsProposes` et le droit
  Modifier, raccourcis du groupe `document_statuts_fe`). Tests : `ServiceFactureElectroniqueTests` (204 à la création,
  CDAR en file lu comme 204 de l'acheteur, 205, 210 refusé après 205, motif hors liste, statut non envoyé, paramètre
  invalide, file → ENVOYE), `ReceptionFactureBtpTests` sur la base jetable (204 → 205 (pièce validée) → 211 (règlement
  émis) avec trois CDAR déposés sur la plateforme simulée ; 204 → 207 → 210, Refusée sans motif refusée, rien après
  Refusée ; brouillon repris sans doublon), `client/test/facture-electronique.test.js`, `modeles.test.js`. Écarts :
  205 et 211 posés par les points d'accroche seulement en requête HTTP (services de la requête) et hors de leur
  transaction (connexion du module) ; 211 sans montant, au premier règlement ; non vérifié en navigateur (TODO).
  **Script à appliquer par l'utilisateur** : `099h_facture_electronique_statuts.sql`.

## Lot 14 : réception hors plateforme — FAIT (10/11/2026)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : glisser-déposer d'un Factur-X ou d'un XML sur la liste à traiter ou sur la page d'une facture
  d'achat ; pièce jointe Factur-X d'un courriel rattaché (`MailBtp.cs`, proposition « Créer la facture ») ; même
  traitement que le lot 12 (flux de sens R, connecteur MANUEL) ; tests.
- **Critère de fin** : un Factur-X glissé crée la même pièce qu'un flux reçu, sans statut envoyé ; tests verts.
- **Réalisé** : module : `099i_facture_electronique_hors_plateforme.sql` (rejouable, au manifeste après 099h :
  `ffl_hors_plateforme`) ; `ImportManuel.HorsPlateforme` et `ServiceFactureElectronique.ImporterHorsPlateformeAsync`
  (facture seule, CDAR refusé `DEMANDE_INVALIDE` ; même chemin que l'import : connecteur MANUEL, étape IMPORT_MANUEL avec
  `hors_plateforme` et l'origine, lecture, pièce créée ou doublon, rattachement) ; `PoserAsync` : flux hors plateforme →
  statut gardé au journal sans CDAR (`envoye` faux, `hors_plateforme` au détail) ; `FluxDto.HorsPlateforme`, origine
  affichée au détail du flux ; règle miroir `estFichierFacture` (`js/src/reception.js`) ↔ `ReglesReception.EstFichierFacture`
  (jeu `tests/cas/03_fichiers_facture.json` : extension .pdf / .xml ou type MIME). Cœur : `ReceptionFactureBtp` : avoir
  reçu (BT-3 381, 261, 262, 396, 502, 503 ; UBL CreditNote) → `A_AVOIR` en brouillon (pièce libre, jamais de commande),
  montants positifs (`EnPositif` : avoir émis en négatif inversé, noté au rapport), facture d'origine BT-25 du même
  fournisseur (A_FACTURE / A_FACTURE_AVT de référence non annulée, référence externe sans séparateurs ; une seule) rattachée
  par un lien TRANSFORMATION, sinon numéros cherchés au rapport ; doublon d'avoir parmi les A_AVOIR ; brouillon repris :
  A_AVOIR compris ; 205 à la validation d'un A_AVOIR ; GED : un contenu déjà rangé pour la pièce (même SHA-256, catégorie
  facture_electronique) est réutilisé (`DejaRangeAsync`) : vue lisible et pièces jointes d'un brouillon repris non
  redéposées (point du lot 13). `Btp/ReceptionHorsPlateformeBtp.cs` : route `POST /api/facture-electronique/courriels/{id}/facture`
  (référence de la pièce : courriel reçu lisible par l'utilisateur, pièce Factur-X ou XML ; Modifier du nœud, déclarée
  dans `SpecialisationDroitsBtp.Routes`, sous `ExigeModule`). Codes `TYPE_DOCUMENT.A_FACTURE_AVT` / `A_AVOIR` ↔
  `TypesDocument`. Client : `facture-electronique/depot-facture.js` (zone de dépôt : fichiers seuls, dépôt déjà pris par
  la GED laissé, module actif et Modifier ; import `hors_plateforme`, pièce créée ouverte, sinon flux à traiter ouvert
  avec l'erreur) branchée sur la liste « Factures reçues à traiter » (et bouton « Importer une facture ») et sur la page
  des A_FACTURE, A_FACTURE_AVT, A_AVOIR, T_FACTURE_AVT ; bouton « Créer la facture » sur les pièces jointes Factur-X / XML
  d'un courriel reçu (`pages/mail.js`) ; textes `facture_electronique_btp.depot.*`, icône, couleurs `--fe-depot-cible*`.
  Tests : `ServiceFactureElectroniqueTests` (hors plateforme : étapes, 204 et 205 sans CDAR, CDAR refusé),
  `ReglesReceptionTests` / `reception.test.js` (jeu 03), `ReceptionFactureBtpTests` (exemple d'avoir `AVOIR_F202500011` en
  UBL et CII : lignes positives, BT-25 ; variante négative en mémoire ; de bout en bout sur la base jetable : facture
  glissée → A_FACTURE en brouillon, origine, sans CDAR, liste à traiter ; avoir UBL → A_AVOIR rattaché à la facture ;
  doublon d'avoir ; GED sans second dépôt), `FactureElectroniqueBtpTests` (route du courriel), `client/test/depot-facture.test.js`.
  Écarts : un Factur-X glissé sur une facture d'achat crée sa propre pièce (pas de rattachement à la pièce ouverte ; un
  doublon désigne la pièce existante) ; « Créer la facture » proposé sur tout courriel reçu, rattaché ou non ; avoir
  d'une facture de sous-traitance reçu en A_AVOIR ; non vérifié en navigateur (TODO). **Script à appliquer par
  l'utilisateur** : `099i_facture_electronique_hors_plateforme.sql`.

## Lot 15 : réception de sous-traitance — FAIT (10/11/2026)

- **Cœur**. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `ReceptionFactureBtp.cs` (cadre S5 et bloc PAYEUR → facture de sous-traitance en paiement direct
  rattachée au marché, `019j`, `092b`), lecture d'un statut 224 (demande de paiement direct) rattaché à la facture du
  sous-traitant, autoliquidation contrôlée avec `per_st_autoliquidation`, tests.
- **Critère de fin** : cas UC13 FNFE et un cas de paiement direct reçus et rattachés ; tests verts. **Fin de la
  partie A : validation de l'utilisateur avant le lot 16.**
- **Réalisé** : module : règle miroir `controlerSousTraitance` (`js/src/reception.js`) ↔ `ReglesReception.ControlerSousTraitance`
  (jeu `tests/cas/04_sous_traitance.json` : paiement direct = cadre S5 avec un payeur ; écarts PAYEUR_ABSENT, PAYEUR_HORS_S5,
  AUTOLIQUIDATION_ABSENTE / INATTENDUE (ventilations BG-23 comparées à l'autoliquidation attendue), VATEX_AUTOLIQUIDATION),
  codes `ECART_RECEPTION` et `CODE_EXONERATION` (`codes.js` ↔ `Codes.cs`, `CodesTests`). Cœur : `ReceptionFactureBtp` :
  marché de sous-traitance de la commande retrouvée, sinon du fournisseur par son code dans BT-12 / BT-13 / BT-18 →
  T_FACTURE_AVT libre sur le marché (chantier, affaire, projet, saisie RECUE) ; S5 et payeur → `paiement_direct` au
  rapport d'origine (marché, contrat, commande, mode DIRECT / DELEGATION, payeur, maître d'ouvrage = tiers du marché de
  vente lié sinon du chantier) et écarts CONTRAT_INTROUVABLE, PAIEMENT_DIRECT_NON_PREVU, PAYEUR_DIFFERENT
  (`EcartsPaiementDirect`) ; autoliquidation contrôlée avec `per_st_autoliquidation` ; écarts au rapport (`ecarts`),
  jamais bloquants. `Btp/PaiementDirectRecuBtp.cs` : 224 reçu (lu, enregistré dans `fe_statut` et tracé STATUT_RECU au
  journal `fe_evenement` sur la pièce par le module) → demande de paiement `stt_paiement_direct` (RECUE, reçue le jour du
  224, montant de `ReglesPaiementDirect.Montant`) pour une T_FACTURE_AVT validée d'un marché en paiement direct ou
  délégation ; brouillon : enregistrée à sa validation (`SpecialisationBtp.ApresValidationAsync`) ; signal
  PAIEMENT_DIRECT (`SIGNAL_FE` ↔ `SignauxFe`, `db/297` rejouable au manifeste), codes `GARANTIE_MARCHE` ↔
  `GarantiesMarche`. Client : onglet Traçabilité, bloc paiement direct et écarts lisibles (`receptionSousTraitanceHtml`,
  textes `facture_electronique_btp.sous_traitance.*`, icône). Tests : `ReglesReceptionTests` / `reception.test.js`,
  `ReceptionFactureBtpTests` (exemple FNFE UC13 F202600037 hors paiement direct et sa variante S5 avec payeur ; de bout en
  bout sur la base jetable : facture S5 → T_FACTURE_AVT sur le marché avec paiement direct et écart d'autoliquidation,
  224 tracé sur la pièce puis demande à la validation ; seconde facture validée avant son 224 → demande à la réception,
  payeur différent signalé, 224 répété sans seconde demande), `client/test/sous-traitance-recue.test.js`. Aucun exemple
  224 dans le dépôt FNFE : CDAR 224 de référence du module (`cdar/logibtp`). Écarts et points ouverts : TODO.md.
  **Script à appliquer par l'utilisateur** : `db/297_facture_electronique_sous_traitance.sql`.

---

## Partie B : émission et e-reporting

## Lot 16 : contrôle de complétude et écriture CII — FAIT (11/11/2026)

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
- **Réalisé** : codes JS ↔ C# `REGLE_COMPLETUDE` (46 règles : `LOGIBTP-PROFIL`, `LOGIBTP-CADRE`, BR-FR-01 à 32 utiles,
  BR-FR-CO-03 à 12, BR-FR-DEC-01 à 04, BR-CO-10 à 17), `NIVEAU_COMPLETUDE` (BLOQUANT, AVERTISSEMENT), `TYPE_PIECE_JOINTE`
  (BR-FR-17), `TRAITEMENT.B2C_INT` (B2CINT, admis par BR-FR-20), `CODE_NOTE.MENTION_TAXE` (TXD), `ERREUR_FE`
  `PROFIL_NON_ECRIT` et `DONNEE_HORS_PROFIL` (`CodesTests`) ; `js/src/completude.js` (`controlerCompletude(facture,
  { bloquant })`, `completudeBloquante`) ↔ `ReglesCompletude.cs` (`Controler(facture, bloquant)`, `Bloquante`,
  `Decimales`, `Chiffres`, `Json` : modèle `ModeleFacture.cs` en camelCase, partagé avec le navigateur), résultat
  `{ regle, niveau, donnee (terme BT ou groupe), ligne (BT-126) }` dans l'ordre des contrôles, arrondi unique du socle ;
  jeu `tests/cas/05_completude.json` (59 cas : base conforme + modifications par chemin) ; `Formats/EcritureCii.cs`
  (`Ecrire`, `Document`, `Specification`, `Extensions`, `Montant`, `Nombre` : ordre du XSD D22B, tout ce que lit
  `LectureCii`, XSD vérifié) ; tests `ReglesCompletudeTests`, `EcritureCiiTests` (les 15 CII d’exemple écrits puis relus
  au même modèle ; exemples complets sans écart bloquant sauf cadres 8 / 9 ; fichiers de référence
  `tests/exemples/ecrits/` régénérés par `LOGIBTP_REGENERER_CII=1` : 12 exemples hors multi-vendeurs et 5 cas du jeu),
  `js/test/completude.test.js` ; les 17 CII écrits passent XSD, schematron du profil et BR-FR-Flux2 sans erreur fatale
  (`schematrons.test.js`, `npm run valider-facture`). Écarts : jeu numéroté 05 (02 déjà pris par les paramètres) ; règles
  du schematron 1.4.0.04 (pas de CO-06 : CO-07 échéance, CO-08 définitive après acompte, CO-09 déjà payée, CO-12 devise)
  et BR-FR-03, 17, 18, 20, 23 à 26, 31 ajoutées ; BR-CO-10 sur les lignes DETAIL ou sans sous-type (règle EXTENDED-CTC-FR) ;
  niveau d'après Q5 (option `bloquant` fournie par l'appelant selon le tiers) ; cadres 8 / 9 non émis (`LOGIBTP-CADRE`) ;
  données EXTENDED-CTC-FR refusées à l'écriture EN16931 (`DONNEE_HORS_PROFIL`) et signalées par `LOGIBTP-PROFIL` ;
  BASIC non écrit ; nombres sans arrondi (montants « 0.00 », autres sans zéro de fin) ; BT-11 avec le nom
  « Project reference » ; avertissement EXTENDED-CTC-FR `BR-FXEXT-*-08rev` sur les CII écrits à TVA exonérée ou
  autoliquidée (motif d'exonération de ligne absent du modèle, TODO).

## Lot 17 : écriture UBL (FAIT le 11/11/2026)

- **Module** : `modules/facture-electronique`. **Agent** : `lot-dev`. **Modèle** : sonnet.
- **Fichiers** : `Formats/EcritureUbl.cs` (Invoice, CreditNote pour les avoirs), tests aller-retour et schematrons.
- **Critère de fin** : mêmes modèles écrits en UBL et en CII, relus égaux, valides ; tests verts.
- **Réalisé** : `Formats/EcritureUbl.cs` (`Ecrire`, `Document`, `EstAvoir` : CreditNote pour `TypesAvoir`, Invoice sinon ; ordre des
  XSD UBL 2.1, XSD vérifié, conversions inverses de `LectureUbl` : BT-8 2475 vers 2005, BT-21 en préfixe `#CODE#`, sous-type et
  ligne parente en BillingReference de ligne, BT-11 d'un avoir en AdditionalDocumentReference 50) ; `EcritureUblTests` (les 15
  CII d'exemple et les 5 cas du jeu écrits en UBL et en CII, relus au même modèle ; 17 UBL de référence
  `tests/exemples/ecrits/*_UBL.xml`, régénérés par `LOGIBTP_REGENERER_CII=1`, jumeaux des CII écrits) ; les 17 UBL passent XSD,
  schematron du profil et BR-FR-Flux2 sans erreur fatale (`schematrons.test.js`, `npm run valider-facture`). Écarts :
  bénéficiaire et représentant fiscal écrits en PartyName seul (nom commercial perdu) ; payeur et échéance d'un avoir sans moyen
  de paiement refusés (`DONNEE_INVALIDE`) ; ligne parente sans sous-type refusée ; BT-13 vide si seule la commande vendeur est
  donnée ; cadres 8 / 9 non émis comme en CII ; mêmes avertissements `BR-FREXT-*-08rev` que le CII.

## Lot 18 : PDF/A-3 et fichier associé (FAIT le 11/11/2026)

- **Module** : `modules/edition`. **Agent** : `lot-dev`. **Modèle** : opus.
- **Fichiers** : `js/src/rendu-pdf.js` (option PDF/A-3 : métadonnées XMP avec schéma d'extension fourni par
  l'appelant, OutputIntent sRGB, fichiers associés `/AF` avec `AFRelationship`, `EmbeddedFiles`), profil ICC livré,
  `CATALOGUE_FONCTIONS` si une fonction s'ajoute, tests Node et parité Jint, `npm run construire`.
- **Règles** : générique (le module ignore Factur-X : l'appelant fournit le fichier, son nom, sa relation et le XMP).
  PDF toujours déterministe.
- **Critère de fin** : PDF produit valide PDF/A-3b au contrôle veraPDF (lancé à la main, hors CI, résultat noté dans le
  plan) ; tests Node et C# verts.
- **Réalisé** : `js/src/pdfa.js` (`normaliserPdfa`, `paquetXmp`, `appliquerPdfa`, `RELATIONS_PDFA`, `profilSrgbLivre`) branché
  sur `produirePdf` par l'option `pdf.pdfa` ({ conformite B par défaut, fichiers [{ nom, octets ou base64, type MIME,
  relation, description }], schemas d'extension XMP [{ schema, espace, prefixe, proprietes [{ nom, type, categorie,
  description, valeur }] }], icc ou icc_base64, condition }) : XMP UTF-8 non compressé (dc, xmp, pdf, pdfaid 3 / B,
  pdfaExtension et valeurs de l'appelant), OutputIntent GTS_PDFA1 sRGB, flux EmbeddedFile (Subtype MIME, Params Size /
  CreationDate / ModDate), Filespec F / UF / AFRelationship, arbre EmbeddedFiles trié, `/AF` du catalogue, `/ID` tiré
  d'une empreinte des entrées (déterministe) ; sans option, PDF inchangé à l'octet. Profil ICC livré :
  `js/src/profil-srgb.js` (base64) et `js/couleurs/sRGB-lcms-v2.icc`, profil sRGB intégré de Little CMS 2.14 (licence MIT,
  mention « No copyright, use freely ») écrit sur la machine par la bibliothèque système en version 2.1, rien de
  téléchargé. Tests : `test/pdfa.test.js` (7 cas), jeu de parité `tests/cas/05_pdfa.json` (devis 01 en PDF/A-3b avec un XML
  associé et un schéma d'extension) identique à l'octet entre Node et Jint ; paquet serveur reconstruit. Aucune fonction de
  formule ajoutée (`CATALOGUE_FONCTIONS` inchangé). **Contrôle veraPDF à lancer à la main** (non fait, veraPDF absent de
  la machine) : après `npm run exporter-resultats --workspace modules/edition/js`,
  `verapdf --flavour 3b modules/edition/tests/resultats-js/05_pdfa.js.pdf` (résultat à noter ici). Limites : annexes PDF
  copiées non contrôlées (elles peuvent rompre la conformité), images JPEG CMJN incompatibles avec l'OutputIntent RGB.

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
