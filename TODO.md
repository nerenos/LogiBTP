## Base de données

- [ ] **Module de gestion des versions de la base** (après stabilisation du schéma) : numéro de version du schéma
  par base de société, scripts de migration ordonnés et rejouables, application automatique aux bases existantes.
  Fait par le module Installation : journal `installation_script` (manifeste `db/installation/scripts.txt`, empreinte de
  chaque script appliqué, `installation base mettre-a-jour`, `base adopter` pour les bases existantes) ; reste : scripts
  rejouables, numéro de version lisible, retour arrière sans restauration.
  Aujourd'hui : scripts `modules/*/db` et `db/` appliqués à la création du volume Docker, puis à la main sur `logibtp`
  et `logibtp_demo` ; la plupart ne sont pas rejouables.
- [ ] **Enregistrement des données, suite** (plan [enregistrement-donnees.md](documentation/conception/plans/enregistrement-donnees.md),
  lots 1 à 9 faits le 13/11/2026) : passer les contrôles des autres tables de paramétrage au format commun
  (`Controles`, 422 `VALIDATION` par champ ; fait : listes de valeurs) — annuaire (`CODE` / `LIBELLE`, avec son
  fournisseur mémoire), bibliothèque, comptabilité, pointage, ressources ; brancher `erreursParChamp` dans les écrans de
  paramétrage pour placer chaque message sous son champ ; étendre `.EnTransaction()` aux groupes restants sans effet
  externe immédiat (ressources, rentabilité, structure, terrain, exécution) après revue de leurs appels sortants.

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
- [ ] **Module MCP** (agents IA au nom d'un utilisateur, [plan](documentation/conception/plans/mcp.md), lots 0 à 4 faits
  le 13/11/2026 : audit des routes, contrats du socle, règles de délégation `modules/mcp`, plafond appliqué par les
  Droits, jetons délégués du module Authentification) : lots 5 à 14 (point `/mcp` — à lui de révoquer les jetons d'une
  délégation révoquée par `ServiceAuthentification.RevoquerDelegationAsync` —, outils du cœur, propositions, écrans, OAuth 2.1). À trancher
  au lot 6 : un nœud retenu par un garde-fou (TIERS, SALARIES, PAIE…) perd aussi ses écritures (choix du lot 2).
  Reportés du lot 3 (audit § 7, points 3 et 6) : contrôles par identité hors `IDroits` encore aveugles à
  `Utilisateur.Agent` (`PeutGererAsync` `StockBtp.cs`, `MagasinBtp.Exiger`, `PeutTraiterAsync` `StockBorneBtp.cs`,
  `PeutValiderAsync` / `PeutControlerAsync` `SpecialisationExecutionBtp.cs`, `DelegationsControle.cs`,
  `PeutDeverrouiller` `VerrouDocument.cs`) : à refuser pour un agent au lot 6 (ceux qui passent par `EstAdmin`,
  `ExigerAdmin`, `ExigerParametres` le sont déjà) ; la liste blanche du plafond (lot 5) ne doit jamais couvrir
  `POST /api/fiches/{type}/{id}/confidentiel`, `…/secret` ni `POST /api/cas-test` (gabarits exacts plutôt que préfixe
  `/api/fiches/{type}` ou `/api/documents`).
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
- [ ] Module Facturation électronique (réception obligatoire depuis le 01/09/2026) : **plan terminé le 12/11/2026**
  (29 lots, [facturation-electronique.md](documentation/conception/plans/facturation-electronique.md) : lignes « Réalisé »
  de chaque lot ; référence [FACTURE-ELECTRONIQUE.md](documentation/modules/FACTURE-ELECTRONIQUE.md)). Reste à faire :
  - [ ] **SQL à appliquer par l'utilisateur** (jamais appliqué par Claude hors des bases jetables des tests), par
    `installation base mettre-a-jour` sur `logibtp` et `logibtp_demo`, dans l'ordre du manifeste : `modules/comptabilite/db/094g`,
    `modules/facture-electronique/db/099f`, `099g`, `099h`, `099i`, `db/121` et `db/131` (régénérés), `db/295` à `db/305` ;
    **avant de relancer l'API** (EF lit `ent_fe_nature`, `ent_fe_differe` ; le contrôle lit `mar_fe_role`). Puis activer le
    module (Paramètres › Modules), régler la plateforme, le régime de TVA et le matricule (onglet E-reporting). Sur une base
    créée par le manifeste, `ctv_categorie_en16931` est vide (094g passe avant les catégories de db/223) : rejouer 094g.
  - [ ] **Non vérifié en navigateur** (vérifié par les tests seulement) : page `/facture-electronique` (Flux, Dépôt manuel,
    Encaissements, E-reporting, Paramètres et cases des options), onglet Chronologie de la page document (statuts posés :
    En litige, Refuser), liste « Factures reçues à traiter » (vue 1014) et glisser-déposer d'un Factur-X ou XML, « Créer la
    facture » d'un courriel, Traçabilité d'une facture de sous-traitance reçue, bouton « Vérifier dans l'annuaire » de la
    fiche personne, bandeau de complétude, pastille, « Émettre », « Envoyer plus tard », « Annuler par avoir interne »,
    champ « Nature (facture électronique) » des Options, « Notre place dans le marché » de la fiche marché, notifications ;
    page de démonstration du module (port 5181). Jeu de démonstration sur l'API réelle :
    `node client/scripts/generer-facture-electronique-demo.mjs [host]` (lot 29, à lancer une fois les scripts appliqués ;
    non exécuté contre une API en développement).
  - [ ] **E-reporting : règles à confirmer** (risque R7, spécifications DGFiP non lues dans le dépôt) : périodicité par régime
    (`ReglesEreporting.Periodicite`), dates limites (aucun envoi automatique), contenu d'une rectificative RE (période entière
    renvoyée), relance d'un rejet en « -E2 », types CO / MO et bloc References (absents du XSD), encaissements négatifs
    refusés par G1.16, catégorie TT-81 (E exonérée en TPS1 / TLB1), encaissements des avoirs non déclarés, acquisitions
    internationales (déclarant BY) non collectées.
  - [ ] **À valider par l'expert-comptable et la PA choisie** : cadres et nature biens / services / mixte (Q8), BT-8 par
    `mentions.tva_debits` ; S5 / S6 / payeur (garantie du marché non contrôlée), S3 B2G non émis ; situations : postes TTC
    hors facture (BT-115 ≠ net à payer, retenue en note ABU, paiement direct non déduit), TVA d'une situation en cumul ;
    Encaissée : part des services d'une mixte prise sur le HT cumulé, montants au prorata du TTC émis ; règle ArchiveOnly des
    avoirs internes ; autoliquidation de la sous-traitance reçue (`per_st_autoliquidation`).
  - [ ] **Contrôle veraPDF du lot 18** à lancer à la main (absent de la machine) : `npm run exporter-resultats --workspace
    modules/edition/js` puis `verapdf --flavour 3b modules/edition/tests/resultats-js/05_pdfa.js.pdf` ; noter le résultat au lot 18.
  - [ ] Écrans de paramétrage manquants : niveau et activation des signaux (`facture_electronique_signal`), BT-3 par type et
    nature par nature d'article (valeurs des scripts, modifiables en SQL seulement), drapeau « code service obligatoire ».
  - [ ] Émission, points ouverts : pièce **enregistrée** contrôlée (pas la saisie en cours) ; pièce à 0 € (BG-23 absent du
    Factur-X) ; Factur-X du modèle d'édition par défaut, distinct du PDF de la validation ; tiers jamais vérifié émis quand même
    (adresse = SIREN) ; avertissement PEPPOL-EN16931-R008 (livraison vide) ; moyens LCR et autres : code 1 ; cadres 8 / 9 non
    émis ; ni motif d'exonération à la ligne, ni BT-33, ni rôle du payeur ; BR-FR-14, 27 à 30, CO-10, CO-14 / 15, MV / BD non
    repris dans la complétude ; pièce d'avancement suivie d'autres : annulation refusée ; suspension de relance levée à 205
    seulement ; Encaissée sans notification ni envoi automatique (Q15 (b)) ; récapitulatif de cotraitance produit hors LogiBTP.
  - [ ] Réception, points ouverts : statuts 205 / 211 posés sur la connexion du module pendant la transaction de la validation
    ou du règlement (un échec ensuite laisserait le statut) et en requête HTTP seulement, 211 sans montant ni annulation ;
    facture de sous-traitance sans avancement ligne à ligne ; écarts de prix vus à la validation seulement ; Factur-X glissé sur
    une facture d'achat : nouvelle pièce ; avoir de sous-traitance en A_AVOIR ; 224 rattaché par le numéro seul, facture jointe
    au 224 non lue, demande de paiement sans tâche du CRM ; cadres S6 et S3 non traités à la réception ; nom de la PA inconnu de
    l'annuaire (« PA » ou « PPF »).
  - [ ] GED : élément `EREPORTING` (transmissions d'e-reporting, `db/305`) absent de l'arborescence de l'explorateur (documents
    trouvés par la recherche) ; ouvrir la GED depuis le détail d'une période.
  - [ ] Base jetable complète désignée par `LOGIBTP_TEST_PG` : trois échecs connus hors chantier
    (`IntegrationPostgresTests.Agregats_identiques_au_js` et `Lots_par_cle_identiques_au_js` : colonnes de démonstration
    absentes ; `RelancesBtpTests.Devis_en_mode_tache_cree_la_tache_sans_courriel` : date attendue fixe) ; échecs intermittents
    du chantier corrigés au lot 29 (collection `CollectionBaseFe` et verrou `VerrouBaseTests.FactureElectronique`).

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



