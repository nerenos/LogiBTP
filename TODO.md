## Base de données

- [ ] **Module de gestion des versions de la base** (après stabilisation du schéma) : numéro de version du schéma
  par base de société, scripts de migration ordonnés et rejouables, application automatique aux bases existantes.
  Fait par le module Installation : journal `installation_script` (manifeste `db/installation/scripts.txt`, empreinte de
  chaque script appliqué, `installation base mettre-a-jour`, `base adopter` pour les bases existantes) ; reste : scripts
  rejouables, numéro de version lisible, retour arrière sans restauration.
  Aujourd'hui : scripts `modules/*/db` et `db/` appliqués à la création du volume Docker, puis à la main sur `logibtp`
  et `logibtp_demo` ; la plupart ne sont pas rejouables.
- [ ] **Enregistrement des données : uniformiser et sécuriser** : un seul format d'échange et de contrôle par type
  d'écriture, validations serveur systématiques, écritures SQL paramétrées partout (avertissements
  `ExecuteSqlRawAsync` dans `Intervenants.cs`), transactions englobant les champs gérés des fiches
  (`EcrireGeresAsync` est hors de la transaction de la ligne).

## Fonctionnel

### Module Mail

Analyses validées le 23/10/2026 : [ANALYSE-MODULE-MAIL.md](documentation/conception/ANALYSE-MODULE-MAIL.md),
[ANALYSE-MODULE-OAUTH.md](documentation/conception/ANALYSE-MODULE-OAUTH.md).

- [ ] Remplir les boîtes de test `LOGIBTP_TEST_MAIL_*` du `.env` (modèle `.env.exemple` : Gmail, Exchange OVH).
- [ ] Essai réel du module OAuth avec la boîte Gmail de test : déclarer l'application Google (adresse de retour
  `http://localhost:5173/api/oauth/retour`), puis 🔗 Se connecter dans `/parametres/connexions`.
- [ ] Essai réel d'Exchange Online (Microsoft 365) en délégué et en application (certificat) quand un locataire de
  test sera disponible : autorisations IMAP.AccessAsApp / SMTP.SendAsApp et principal de service dans Exchange.
- [ ] Essai réel de l'envoi avec les boîtes de test (Gmail en OAuth 2.0, Exchange OVH par mot de passe) : relever les
  quotas réels des hébergeurs et ajuster les limitations par défaut (`Limites.Defaut`).
- [ ] Envois à brancher quand les fonctions existeront : relevé
  hebdomadaire signé (Pointage M21) ; double authentification par courriel.
- [ ] Création d'un tiers provisoire depuis l'expéditeur d'un courriel reçu ; transfert d'un reçu à un service.
- [ ] Avant la mise en production : vérification de l'application Google par Google (portée restreinte
  `https://mail.google.com/`), sinon reconnexion des boîtes Gmail tous les 7 jours (mode test) ou mot de passe
  d'application.

### Droits et partage

- [ ] **Module de droits** ([analyse](documentation/conception/ANALYSE-MODULE-DROITS.md), lots 1 à 5 réalisés : profils, arbre, refus par défaut des routes, montants de validation, usurpation, listes filtrées, JWT et rafraîchissement rotatif, machines connues, double facteur, exclusion d'IP, identifiants d'API, sécurité web, journaux, .env chiffré, rôles PostgreSQL) :
  droits fins par profil, portée et élément, montants de validation, usurpation, RGPD, JWT avec
  rafraîchissement rotatif, machines connues, double facteur par courriel, exclusion d'IP, identifiants API, deux clés
  (`.env`, données) ; profil par défaut = saisie mobile (A5 révisée) ; à reprendre par le Mail (comptes, boîtes,
  « À rapprocher ») et l'OAuth (reconnexion des connexions).
- [ ] **Module de partage de fichiers** (auto-hébergé ou kDrive d'Infomaniak) : lien de téléchargement à la place des
  pièces jointes trop lourdes pour un courriel.

### Chaîne des achats et marchés

Analyse achevée (lots 1 à 7 réalisés, voir « Réalisé »). Restent :

Décisions du 31/10/2026 : `PIED_GLOBAL` gardé (prorata dans le pied de chaque document, somme affichée au pied
global). Lots à venir :

- [ ] Imputation d'un avoir ou d'un trop-perçu sur une facture (partie document faite le 31/10/2026 : onglet Règlements,
  éditions, reste à payer) : écritures avec le module Comptabilité complet.

### Comptabilité

Analyse du 25/10/2026 : [ANALYSE-MODULE-COMPTABILITE.md](documentation/conception/ANALYSE-MODULE-COMPTABILITE.md)
(base en trois lots, puis module complet). Base réalisée : lots 1 (plan, collectifs, comptes des tiers, TVA), 2 (types
comptables, ventilation) et 3 (écritures, export Sage 100).

- [ ] Lot 3, à valider : modèle Sage 100 (colonnes, ANSI, JJMMAA, sens et montant) à reproduire dans le format
  d'import paramétrable de Sage puis à essayer sur un vrai fichier ; modèle personnalisé seulement par l'API
  (`PUT /api/comptabilite/export/modele`), pas d'écran de saisie des colonnes.
- [ ] Acomptes en mode trésorerie : la demande et le reçu (non comptables) ne portent pas de TVA ; la TVA due à
  l'encaissement de l'acompte (PCG : 4191 en HT, TVA collectée à part) doit être écrite par l'export des règlements
  (module complet). La facture qui déduit l'acompte retire déjà cette TVA (décisions du 31/10/2026).
- [ ] **Module Comptabilité complet** : journaux tenus, exercices et clôture, saisie d'écritures, lettrage, règlements
  et TVA sur les encaissements (module Règlements), FEC, contre-passation des pièces modifiées après transfert.

### GED

- [ ] Revue des fins de conservation (DETRUIRE : purge proposée, jamais pour le coffre-fort).
- [ ] Texte des images (OCR) et des .msg non extrait ; résumé automatique (agent IA local).

### Sous-traitance

Analyse du 23/10/2026 : [ANALYSE-MODULE-SOUS-TRAITANCE.md](documentation/conception/ANALYSE-MODULE-SOUS-TRAITANCE.md).

- [ ] DC4 : remplissage du formulaire officiel (PDF de l'administration) à étudier ; aujourd'hui édition propre qui en
  reprend les rubriques (ST17).
- [ ] Engagé et réalisé de la sous-traitance à reprendre dans la rentabilité continue du chantier (Exécution,
  possibilité 1) quand elle existera ; aujourd'hui bloc « Sous-traitance » de l'onglet Gestion du marché de vente (ST30).
- [ ] Faire relire le cadre réglementaire (§ 3 : vigilance, autoliquidation, autofacturation, paiement direct) par
  l'expert-comptable ; écritures du paiement direct, de la délégation et de l'autoliquidation à préciser avec le
  module Comptabilité (ST14, ST15).
- [ ] Module Facturation électronique (réception obligatoire depuis le 01/09/2026) : analyse faite le 09/11/2026
  ([ANALYSE-FACTURATION-ELECTRONIQUE.md](documentation/conception/ANALYSE-FACTURATION-ELECTRONIQUE.md)), questions
  tranchées ([facturation-electronique-questions.md](documentation/conception/plans/facturation-electronique-questions.md)), plan en 29 lots
  à valider ([facturation-electronique.md](documentation/conception/plans/facturation-electronique.md)) ; lot 1 fait
  le 09/11/2026 (codes, modèle EN16931, règles du cycle de vie), lot 2 le 09/11/2026 (lecture CII D22B et Factur-X,
  XSD), lot 3 le 09/11/2026 (lecture UBL 2.1 Invoice et CreditNote, détection de la syntaxe), lot 4 le 09/11/2026
  (schematrons FNFE par SaxonJS, outil `npm run valider-facture`), lot 5 le 09/11/2026 (CDAR : écriture et lecture des
  statuts), lot 6 le 09/11/2026 (connecteurs : AFNOR XP Z12-013, plateforme simulée, dépôt manuel), lot 7 le
  10/11/2026 (OAuth GENERIQUE en flux CLIENT), lot 8 le 10/11/2026 (schéma, file avec reprises, statuts, journal des
  étapes chaîné, relève par curseur, service et routes `/api/facture-electronique`), lot 9 le 10/11/2026 (écrans du
  module, chronologie réutilisable, page de démonstration), lot 10 le 10/11/2026 (catégorie EN16931 et VATEX des catégories de TVA), lot 11 le 10/11/2026 (branchement du cœur : activation, droits, GED, signaux, page, onglet Chronologie), lot 12 le 10/11/2026 (réception : facture reçue → pièce d'achat ou de sous-traitance en brouillon, fournisseur, commande, chantier, GED au coffre, liste « Factures reçues à traiter », étapes du journal), lot 13 le 10/11/2026 (statuts posés à la réception : 204 à la création, 205 à la validation, 207 et 210 par boutons, 211 au règlement émis, CDAR par la file, statuts non envoyés par code, création de la pièce reprise sans doublon), lot 14 le 10/11/2026 (réception hors plateforme : Factur-X ou XML glissé sur la liste à traiter ou une facture d'achat, pièce jointe d'un courriel reçu, sans statut envoyé ; avoirs reçus → avoir d'achat rattaché à sa facture), lot 15 le 10/11/2026 (réception de sous-traitance : cadre S5 et payeur → T_FACTURE_AVT en paiement direct sur le marché, statut 224 → demande de paiement, autoliquidation contrôlée avec `per_st_autoliquidation`) ; fin de la partie A validée ; lot 16 le 11/11/2026 (émission : contrôle de complétude JS ↔ C# `completude.js` / `ReglesCompletude.cs`, jeu `05_completude.json`, écriture CII D22B EN16931 et EXTENDED-CTC-FR `Formats/EcritureCii.cs`, CII écrits valides aux schematrons dans `tests/exemples/ecrits/`), lot 17 le 11/11/2026 (écriture UBL 2.1 Invoice et CreditNote `Formats/EcritureUbl.cs`, mêmes modèles relus égaux en UBL et en CII, 17 UBL écrits valides aux schematrons), lot 18 le 11/11/2026 (option PDF/A-3 générique du module Édition `js/src/pdfa.js` : XMP avec schéma d'extension de l'appelant, OutputIntent sRGB, fichiers associés `/AF` et EmbeddedFiles, profil ICC sRGB Little CMS livré, jeu `05_pdfa.json` identique Node ↔ Jint), lot 19 le 11/11/2026 (e-reporting : modèle du flux 10, agrégation B2C, extraction d'une facture internationale, périodes, découpage en un ou plusieurs envois, correction rectificative, contrôle avant envoi, écriture valide au XSD et au schematron Flux10 sur des jeux B2C et international), lot 20 le 11/11/2026 (annuaire sur la fiche personne : bouton « Vérifier dans l'annuaire », colonnes `per_fe_*`, vérification de nuit en option désactivée par défaut, avertissement d'émission), lot 21 le 11/11/2026 (paramètres d'émission BTP : BT-3 par type `tyd_fe_type_facture`, nature biens / services `nat_fe_nature` et surcharge `ent_fe_nature`, nature B / S / M et cadre 1 / 2 / 4 / 5 / 6 répliqués `client/src/calcul/emission-fe.js` ↔ `src/LogiBTP.Calcul/EmissionFeBtp.cs`, jeu `tests/emission-fe/01_emission.json`, notes PMT / PMD / AAB et BT-8 depuis les mentions), lot 22 le 11/11/2026 (pièce de vente → facture électronique EN16931 `Btp/EmissionFactureBtp.cs` : facture, acompte 386, avoir 381 / 503 avec facture d'origine, définitive B4 / S4 / M4 avec reprise d'acompte en ligne négative ; bandeau de complétude dans l'éditeur, libellés des règles ; jeu `tests/emission-fe/02_pieces.json`, XML écrits sans erreur fatale en CII, UBL et Factur-X ; alias SQL du lot 21 corrigés), lot 23 le 11/11/2026 (situations et pied BTP : pièces d'avancement émises en montants de la période, présentation cumul comprise, période BG-14, compte prorata et frais HT en remises / charges, retenue en note ABU et BT-20, paiement direct en BT-20, références chantier / marché / projet BT-11 / 12 / 17 / 18 ; cas `SITUATION_PERIODE` et `SITUATION_CUMUL`), lot 24 le 11/11/2026 (émission à la validation : refus de validation pour un client B2B / B2G incomplet sauf droit FORCER, inscription `document_fe_emission` dans la transaction, option « Envoyer plus tard » et émission automatique de la société, CII / UBL / Factur-X selon `per_fe_format`, Factur-X = PDF/A-3 de l'édition avec `factur-x.xml`, GED à l'étape ENVOI et au coffre, file et plateforme simulée jusqu'à Mise à disposition, pastille et bouton « Émettre » sur la pièce, colonne « Facture électronique » des listes de factures, client particulier, international ou hors annuaire en envoi habituel).
  - [ ] **E-reporting (lot 19) : règles à confirmer avant le lot 28** (risque R7, spécifications externes DGFiP non lues dans le dépôt) : périodicité par régime (`ReglesEreporting.Periodicite` : réel normal mensuel en décades pour les transactions, autres régimes au mois, franchise au bimestre), dates limites de dépôt (non calculées), contenu d'une rectificative RE (période entière ou seules les données corrigées : `Decouper` envoie ce qu'on lui donne), types CO / MO et bloc References de l'annexe A (absents du XSD du paquet FNFE), encaissements négatifs (annulation) refusés par G1.16 ; régime de TVA de la société à ajouter aux paramètres (lot 28) ; acquisitions internationales (déclarant BY) prévues par le modèle mais non collectées.
  - [ ] **SQL à appliquer par l'utilisateur** (lot 10) : `modules/comptabilite/db/094g_comptabilite_tva_en16931.sql` (rejouable, au
    manifeste) sur `logibtp` et `logibtp_demo` par `installation base mettre-a-jour`.
  - [ ] **Contrôle veraPDF du lot 18 à lancer à la main** (veraPDF absent de la machine) : `npm run exporter-resultats
    --workspace modules/edition/js` puis `verapdf --flavour 3b modules/edition/tests/resultats-js/05_pdfa.js.pdf` ; noter
    le résultat dans le lot 18 du plan ([facturation-electronique.md](documentation/conception/plans/facturation-electronique.md)).
  - [ ] **SQL à appliquer par l'utilisateur** (lot 8, jamais appliqué par Claude) : `modules/facture-electronique/db/099f_facture_electronique.sql`
    (rejouable, au manifeste) sur `logibtp` et `logibtp_demo` par `installation base mettre-a-jour`, avant `db/295`.
  - [ ] **SQL à appliquer par l'utilisateur** (lot 21, jamais appliqué par Claude) : `db/299_facture_electronique_emission.sql`
    (rejouable, au manifeste : `tyd_fe_type_facture`, `nat_fe_nature`, `ent_fe_nature`) sur `logibtp` et `logibtp_demo` par
    `installation base mettre-a-jour` ; **à appliquer avant de relancer l'API** (`DocumentBtp.EntFeNature` est lu par EF).
    Points ouverts : écran de paramétrage du BT-3 par type et de la nature biens / services par nature d'article (valeurs du
    script, modifiables en SQL seulement) ; rôle sous-traitant / cotraitant (S5, S6) et pièce déjà payée (cadre 2) fournis par
    l'appelant (lots 24 et 27) ; définitive après acompte (cadre 4) lue dans `acompte_deduction`, donc seulement après la
    validation (un brouillon donne le cadre 1) ; avoir d'acompte 503 tiré du lien TRANSFORMATION ou ANNULATION vers la
    facture d'acompte ; option TVA sur les débits = `mentions.tva_debits` (pas `ctv_exigibilite` du module Comptabilité) ;
    champ « Nature (facture électronique) » de l'onglet Options non vérifié en navigateur ; règles des cadres et de la nature
    à valider par l'expert-comptable (Q8).
  - [ ] **SQL à appliquer par l'utilisateur** (lot 20, jamais appliqué par Claude) : `db/298_facture_electronique_annuaire.sql`
    (rejouable, au manifeste) puis `db/131_fiches_parametrage.sql` (régénéré, rejouable) sur `logibtp` et `logibtp_demo`.
    Points ouverts : nom de la PA non connu de l'annuaire (la fiche reçoit « PA » ou « PPF ») ; case de l'option de nuit
    (page Facturation électronique › Paramètres, lot 24) non vérifiée en navigateur.
  - [ ] **SQL à appliquer par l'utilisateur** (lot 11, jamais appliqué par Claude) : `db/295_facture_electronique.sql`
    (rejouable, au manifeste : activation `facture_electronique` désactivée à la création, droits copiés du nœud
    `comptabilite`, catégorie GED, table des signaux `facture_electronique_signal`) sur `logibtp` et `logibtp_demo`
    par `installation base mettre-a-jour` ; puis activer le module dans Paramètres › Modules et régler la plateforme.
  - [ ] Lot 11 non vérifié en navigateur : page `/facture-electronique` (onglets Flux, Dépôt manuel, Paramètres avec
    les connexions OAuth, `?flux=<id>`), menu Ventes, onglet Chronologie de la page document (Alt+9, masqué sans flux),
    notifications des signaux ; vérifié seulement par les tests (rendu sur la plateforme simulée, décisions des droits).
  - [ ] Signaux de notification : pas encore d'écran pour régler le niveau et l'activation de `facture_electronique_signal`
    (valeurs du script).
  - [ ] **SQL à appliquer par l'utilisateur** (lot 12, jamais appliqué par Claude), par `installation base mettre-a-jour`
    sur `logibtp` et `logibtp_demo` : `modules/facture-electronique/db/099g_facture_electronique_reception.sql`
    (rejouable : étapes LECTURE, PIECE_CREEE, DOUBLON du journal), `db/121_listes_parametrage.sql` (régénéré, rejouable :
    source, thème et vue 1014 « Factures reçues à traiter »), `db/296_facture_electronique_reception.sql` (rejouable :
    vue `v_liste_fe_recues`). Sur une base créée par le manifeste, `ctv_categorie_en16931` est vide (094g passe avant
    les catégories de db/223) : la réception retombe sur le comportement du taux ; rejouer 094g pour la remplir.
  - [ ] Lot 12 non vérifié en navigateur : liste « Factures reçues à traiter » (menu Ventes, `/liste/fe_recues?vue=1014`,
    ouverture d'une ligne sans pièce vers `/facture-electronique?flux=<id>`), pièce en brouillon créée (lignes, TVA,
    référence et date du fournisseur, rapport de `document_origine`), GED de la pièce (original, lisible et pièces
    jointes à l'étape RECEPTION, au coffre), chronologie complète de la pièce ; vérifié par `ReceptionFactureBtpTests`
    (exemples FNFE ; de bout en bout sur une base jetable par `LOGIBTP_TEST_PG_JETABLE`).
  - [ ] Réception, décisions reportées : facture de sous-traitance
    créée par transformation de la commande avec les montants reçus à ventiler (saisie RECUE), sans avancement repris
    ligne à ligne (lot 15) ; écarts de prix avec la commande visibles à la validation (avertissement `PRIX_ACHAT_ECART`),
    pas à la réception.
  - [ ] **SQL à appliquer par l'utilisateur** (lot 13, jamais appliqué par Claude hors des bases jetables des tests),
    par `installation base mettre-a-jour` sur `logibtp` et `logibtp_demo` :
    `modules/facture-electronique/db/099h_facture_electronique_statuts.sql` (rejouable : `fpa_statuts_non_envoyes`).
  - [ ] Lot 13 non vérifié en navigateur : bloc « Statut de la facture reçue » de l'onglet Chronologie (boutons En
    litige et Refuser, Alt+Shift+L / Alt+Shift+X, fenêtre du motif et du commentaire), cases « Statuts posés envoyés »
    des paramètres du module ; vérifié par les tests (`ReceptionFactureBtpTests` de bout en bout sur la base jetable,
    `ServiceFactureElectroniqueTests`, `client/test/facture-electronique.test.js`).
  - [ ] Statuts posés, décisions reportées : 205 et 211 posés par les points d'accroche (validation, pointage) dans leur
    transaction mais sur la connexion du module (un échec de la validation ou du règlement après le point d'accroche
    laisserait le statut posé) et seulement en requête HTTP (services de la requête) ; 211 posé au premier règlement
    émis qui pointe la pièce, sans montant ; dévalidation ou suppression du règlement sans statut d'annulation.
  - [ ] **SQL à appliquer par l'utilisateur** (lot 14, jamais appliqué par Claude hors des bases jetables des tests),
    par `installation base mettre-a-jour` sur `logibtp` et `logibtp_demo` :
    `modules/facture-electronique/db/099i_facture_electronique_hors_plateforme.sql` (rejouable : `ffl_hors_plateforme` ;
    sans lui, le module ne lit plus `fe_flux`).
  - [ ] Lot 14 non vérifié en navigateur : glisser-déposer d'un Factur-X ou d'un XML sur la liste « Factures reçues à
    traiter » (et bouton « Importer une facture ») et sur la page d'une facture ou d'un avoir d'achat (cadre de la zone,
    GED de l'onglet Pièces non perturbée), bouton « Créer la facture » des pièces jointes d'un courriel reçu, origine
    « hors plateforme » au détail du flux ; vérifié par les tests (`ReceptionFactureBtpTests` de bout en bout,
    `ServiceFactureElectroniqueTests`, `client/test/depot-facture.test.js`).
  - [ ] Réception hors plateforme et avoirs, décisions reportées : un Factur-X glissé sur une facture d'achat crée sa
    propre pièce (pas de rattachement à la pièce ouverte, un doublon désigne la pièce existante) ; « Créer la facture »
    proposé sur tout courriel reçu, rattaché ou non ; avoir reçu toujours en A_AVOIR (pas de T_AVOIR pour un avoir de
    sous-traitance), facture d'origine cherchée parmi les A_FACTURE / A_FACTURE_AVT seulement, rattachée par un lien de
    transformation sans lien de lignes ; pas de Paiement transmis (211) pour un avoir ; nouvel exemple d'avoir négatif
    seulement en mémoire dans les tests (pas de fichier jumeau CII / UBL).
  - [ ] **SQL à appliquer par l'utilisateur** (lot 15, jamais appliqué par Claude hors des bases jetables des tests),
    par `installation base mettre-a-jour` sur `logibtp` et `logibtp_demo` : `db/297_facture_electronique_sous_traitance.sql`
    (rejouable : signal de notification PAIEMENT_DIRECT, contrainte des codes de `facture_electronique_signal` élargie).
  - [ ] Lot 15 non vérifié en navigateur : bloc « paiement direct » et écarts de la réception (payeur, autoliquidation,
    contrat) dans l'onglet Traçabilité d'une facture de sous-traitance reçue, notification « Demande de paiement direct
    reçue » ; vérifié par les tests (`ReceptionFactureBtpTests` de bout en bout sur la base jetable, jeu
    `tests/cas/04_sous_traitance.json`, `client/test/sous-traitance-recue.test.js`).
  - [ ] Sous-traitance reçue, décisions reportées : 224 rattaché seulement par le numéro de la facture (flux reçu du
    même numéro, sans contrôle du SIREN du vendeur) ; 224 d'une facture inconnue du module (saisie à la main, papier)
    tracé sans rattachement à une pièce ; facture jointe au 224 non rangée en GED ni lue ; demande de paiement
    enregistrée par le cœur en SQL (`PaiementDirectRecuBtp`, même règle de montant `ReglesPaiementDirect.Montant`) sans
    la tâche du CRM que crée la saisie manuelle (`ApresDemandeAsync`) ; marché de sous-traitance retrouvé par son code
    dans une référence (BT-12, BT-13, BT-18) sans commande : T_FACTURE_AVT libre sur le marché, même hors cadre S5 ;
    contrôle de l'autoliquidation sur `per_st_autoliquidation` du sous-traitant seulement (défaut vrai, `mar_autoliquidation`
    du marché non comparé) ; cadres S6 (cotraitance) et S3 (B2G par Chorus Pro) non traités ; validation des choix
    fiscaux par l'expert-comptable (cadre S5, autoliquidation) toujours à faire.
  - [ ] Émission (lot 22), points ouverts : contrôle de la pièce **enregistrée** seulement (bandeau relu à chaque version, saisie
    en cours non contrôlée) ; pas de pièces de vente en base de démonstration pour un essai réel (jeu construit
    `tests/emission-fe/02_pieces.json`, plus une facture insérée dans une transaction annulée sur la base jetable) ; bandeau
    non vérifié en navigateur ; avertissement PEPPOL-EN16931-R008 des CII lus en Factur-X sans adresse de livraison (élément
    `ApplicableHeaderTradeDelivery` vide écrit par `EcritureCii`) ; adresse électronique par défaut = SIREN quand
    `per_fe_adresse` est vide ; moyens LCR et autres modes : code 1 (non défini) ; corrigé au lot 24 : instantané JSON `null` d'une pièce
    validée (`ent_contact_client`) qui retirait l'adresse du client (fiche relue).
  - [ ] **SQL à appliquer par l'utilisateur** (lot 24, jamais appliqué par Claude) : `db/300_facture_electronique_envoi.sql`
    (rejouable, au manifeste : `ent_fe_differe`, `facture_electronique_emission_option`, `document_fe_emission`, colonne
    `statut_fe` de `v_liste_documents`) puis `db/121_listes_parametrage.sql` (régénéré, rejouable) sur `logibtp` et
    `logibtp_demo` par `installation base mettre-a-jour` ; **à appliquer avant de relancer l'API** (`DocumentBtp.EntFeDiffere`
    est lu par EF). Points ouverts : forçage = droit FORCER sur le type (comme le montant de validation : un administrateur
    n'est jamais bloqué, il reçoit un avertissement et la pièce reste en échec INCOMPLETE jusqu'au bouton « Émettre ») ;
    tiers jamais vérifié dans l'annuaire émis quand même (avertissement, adresse = SIREN) ; Factur-X produit avec le modèle
    d'édition par défaut de la pièce, distinct du PDF de la validation rangé par le module Édition ; pièce à 0 € (sans
    ventilation de TVA) écrite non conforme au XSD Factur-X (BG-23 absent) : à exclure ou traiter au lot 25 ; pastille, bouton
    « Émettre », case « Envoyer plus tard » et options non vérifiés en navigateur ; outil `valider-facture` corrigé (flux
    compressés à la suite : le mot-clé `stream` de `endstream` n'est plus pris pour un début de flux).
  - [ ] Émission des situations (lot 23), décisions à confirmer : postes TTC autres que les acomptes (retenue, paiement direct,
    prorata ou frais après TVA, seuls permis au pied global des factures) **hors facture** : la facture porte le total TTC
    (BT-115 = TTC − acomptes de trésorerie, différent du net à payer de LogiBTP), ils figurent dans BT-20 et la retenue en note
    ABU ; paiement direct non déduit (ni BT-113, ni remise) faute de terme EN16931 : à valider avec l'expert-comptable et la PA ;
    situation présentée en cumul (C, type émis seulement) : TVA recalculée sur la base de la période (BR-CO-17 exact, peut
    différer d'un centime de « TVA cumul − TVA précédente » de l'édition), poste HT sans avancement et retenue au prorata
    période / cumul, reprise d'acompte = cumul − précédent de la ligne ; référence BT-18 = code du chantier (même valeur que
    BT-11, schéma « IT » en UBL) ; période BG-14 par la date de la pièce d'avancement précédente (pas de date de travaux).
  - [ ] Émission (lot 16), décisions reportées : multi-vendeurs et bidirectionnelles (cadres 8 / 9) non émis
    (`LOGIBTP-CADRE` bloquant ; les exemples FNFE UC10, UC11, UC13 bidirectionnel relus à l'identique mais non contrôlés
    aux schematrons) ; le modèle n'a ni motif d'exonération à la ligne (avertissement `BR-FXEXT-AE-08rev` / `E-08rev` du
    schematron EXTENDED-CTC-FR sur le S5 écrit), ni BT-33, ni rôle du payeur ou de l'agent, ni information du moyen de
    paiement : non écrits ; nom du projet BT-11 écrit « Project reference » (correspondance CII) ; une même référence de
    paiement BT-83 pour tous les moyens ; BR-CO-17 en avertissement à l'arrondi exact (le schematron tolère 1) ; règles
    françaises non reprises dans la complétude : BR-FR-14 (adresse de livraison, 09/2027), 27 à 30 (attributs, objets
    AFL / AVV), CO-10 (schémas des identifiants), CO-14 / 15 (assujetti unique), MV / BD ; libellés des règles
    `REGLE_COMPLETUDE` ajoutés au lot 22 (`facture_electronique.completude.regles`). Écart de numérotation : le plan citait CO-06,
    absente du schematron 1.4.0.04 (CO-07 : échéance, CO-08 : définitive, CO-09 : déjà payée).
  - [ ] Base jetable complète (manifeste seul) désignée par `LOGIBTP_TEST_PG` : trois tests échouent déjà sans le lot 12
    (`IntegrationPostgresTests.Agregats_identiques_au_js` et `Lots_par_cle_identiques_au_js` : colonnes de démonstration
    absentes ; `RelancesBtpTests.Devis_en_mode_tache_cree_la_tache_sans_courriel` : date attendue fixe) ; sans variable,
    `dotnet test LogiBTP.slnx` est vert.
  - [ ] Écrans du lot 9 vérifiés par leurs tests et par un rendu sans affichage (Chrome headless) de la page de
    démonstration (`npm run demo --workspace @logibtp/facture-electronique`, port 5181) : essayer en navigateur les
    fenêtres (accusé du dépôt manuel, import d'un fichier, nouvelle tentative), les combos des filtres, les dates et
    les raccourcis, puis sur l'API réelle (module branché au lot 11).

### Import

- [ ] OptimBTP : décider du sort des champs non repris (heures, poste de travaux, compléments de pied, première page
  et texte de fin…).
- [ ] Rattachement automatique du client à l'annuaire.

### Demandes du 25/10/2026

Analyse et découpage en lots : [ANALYSE-DEMANDES-2026-10.md](documentation/conception/ANALYSE-DEMANDES-2026-10.md) (anomalies B1 à B7, améliorations, lots 0 à 11). À étudier :

- [ ] Poste de travaux (documents ; champ OptimBTP non repris).
- [ ] Tiers par compte (comptabilité) dans le module Liste avec saisie : capacité d'édition des listes à concevoir.
- [ ] Ouvrages fabriqués par l'atelier gérés en stock, ou achetés tout faits (lien avec les tarifs fournisseurs).
- [ ] EcoTaxe.
- [ ] Secteur du chantier et des documents de vente.
- [ ] Demandes de prix d'achat « sur ordre » : déverrouiller plusieurs commandes pendant la durée du chantier en conservant les prix de la demande.

## Interface

### Ergonomie ([analyse du 31/10/2026](documentation/conception/ANALYSE-ERGONOMIE.md), décisions Q1–Q16 prises)

- [ ] Barres d'outils (suite de E1) : débordement replié dans un menu « ⋯ » en petite largeur (aujourd'hui : retour à la ligne des groupes).
- [ ] Choix en liste (I1, suite) : sélection multiple faite pour les destinataires du courriel d'une pièce (lot 8) ; reste la
  diffusion GED et les autres écrans, qui suivent le même appel (`choisirDestinataires`).
- [ ] Champs mois (`<input type="month">`, 13 écrans) : même saisie abrégée que les dates, à étudier.
### Personnalisation
- [ ] **Données système en base** (§ 8) : libellés `donnees.<table>.<code>.<colonne>` appliqués par le serveur
  (`installation personnalisation appliquer`, démarrage, mise à jour) sans écraser une valeur modifiée par la société
  (table `personnalisation_applique`).
- [ ] **Serveur** : notifications, courriels automatiques, éditions (Jint : `initialiserDictionnaire`) et messages
  d'exception lus par `Dictionnaire.cs`.
- [ ] **Phase 2** (§ 9) : stockage par base, génération des fichiers par société, page `/parametres/personnalisation`,
  repérage des clés à l'écran en mode débogage.
- [ ] Images de l'application à ajouter au répertoire : icônes PNG 192 / 512 de la PWA, logo de la page de connexion et de la borne.

- [ ] Mode hors ligne : appel de la bibliothèque (F3) limité aux recherches déjà faites en ligne (réponses gardées par le
  service worker) ; à étudier : copie locale des éléments consultés ou d'une bibliothèque choisie pour la recherche hors
  ligne. Écrans hors document (fiches, pointage…) : consultation seulement.

- [ ] Écrans encore construits avec des `<select>` (affichés en combos par `activerCombos` du socle) : les réécrire
  directement avec `creerCombo` au fil des évolutions (concepteur et menu de filtre des listes, onglets de la
  bibliothèque, panneaux du document, annuaire, graphe…). Séparateurs à proportion (onglet Analyse, arbres de la
  bibliothèque) : restés propres (part en % et non largeur).



