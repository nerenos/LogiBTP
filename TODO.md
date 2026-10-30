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
- [ ] `f_annuaire_normaliser` utilise encore `unaccent` (ponctuation transformée) : à aligner sur `f_sans_accent`.

### Bases existantes à mettre à niveau (`logibtp` et `logibtp_demo`)

- [ ] Fiches, paramétrage étendu : `modules/fiche/db/041` appliqué ; redémarrer l'API (nouveau `.env` lu au démarrage).
- [ ] Métré en script : appliquer `021`, `061` (`ele_longueur`), `165` et le `131` régénéré. **Sauvegarder avant le
  premier démarrage** de l'API : il convertit les métrés en lignes et supprime `metre_ligne` (irréversible).
- [ ] Frais annexes : redémarrer l'API (tables et colonnes de `db/167`, appliqué le 16/10/2026).
- [ ] GED : `modules/ged/db/051` appliqué ; après redémarrage de l'API, indexer les documents déposés avant
  (`POST /api/ged/indexation`, administrateur, lots de 200).
- [ ] Vue de colonnes « Complet » : `db/150` (`ON CONFLICT DO NOTHING`) n'ajoute pas Compte et Commentaire aux bases
  existantes (à ajouter par le dialogue des colonnes ou par une mise à jour de `vue_document`). Les autres colonnes
  de la chaîne achats (reste, soldé…) s'ajoutent seules après la quantité.
- [ ] Données de démonstration : corriger les documents VALIDE → ENVOYE et les devis ACCEPTE → VALIDE (statuts de la
  chaîne ENVOYE / VALIDE), sans script de reprise (base de développement).
- [ ] Documents d'essai créés pendant le développement dans `logibtp_demo` (commandes CC2026-00003…7, marché
  M-2026-005-1, BL, factures et avoirs d'avancement, situations). La facture d'avancement SI2026-00002 (validée avant
  le lot 6b) n'a pas de numéro de situation.
- [ ] Groupes de démonstration (`db/131`) absents des bases existantes (régénéré, non rejoué).

## Fonctionnel

### Documents

- [ ] Écran de récupération d'une version précédente d'un document (instantanés `his_instantane`, y compris les clés
  de ventilation des frais annexes).
- [ ] Impression et export : ignorer les lignes non éditées (tranches F) ; export et impression du rapport de
  ventilation des frais annexes (au moment des modules Export / Impression).

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
  hebdomadaire signé (Pointage M21), relances des devis et factures (CRM C27) ; double authentification par courriel.
- [ ] Création d'un tiers provisoire depuis l'expéditeur d'un courriel reçu ; transfert d'un reçu à un service.
- [ ] Lot 5 : relances par courriel (CRM C27, avec le module Règlements).
- [ ] Annuaire : afficher et effacer la marque « non remise » des coordonnées EMAIL (`coo_non_remis_le`).
- [ ] Avant la mise en production : vérification de l'application Google par Google (portée restreinte
  `https://mail.google.com/`), sinon reconnexion des boîtes Gmail tous les 7 jours (mode test) ou mot de passe
  d'application.

### Droits et partage

- [ ] **Module de droits** ([analyse](documentation/conception/ANALYSE-MODULE-DROITS.md), lots 1 à 5 réalisés : profils, arbre, refus par défaut des routes, montants de validation, usurpation, listes filtrées, JWT et rafraîchissement rotatif, machines connues, double facteur, exclusion d'IP, identifiants d'API, sécurité web, journaux, .env chiffré, rôles PostgreSQL) :
  droits fins par profil, portée et élément, montants de validation, usurpation, RGPD, JWT avec
  rafraîchissement rotatif, machines connues, double facteur par courriel, exclusion d'IP, identifiants API, deux clés
  (`.env`, données) ; profil par défaut = saisie mobile (A5 révisée) ; à reprendre par le Mail (comptes, boîtes,
  « À rapprocher ») et l'OAuth (reconnexion des connexions).
- [ ] **Avant une exposition sur internet** ([analyse des droits, § 10](documentation/conception/ANALYSE-MODULE-DROITS.md)) :
  reste les prérequis DNS et certificat joker dans l'installeur (§ 10.6) et la CSP bloquante posée par le proxy ;
  en-têtes, CSP en rapport, contrôle de l'`Origin`, CORS, débit, proxys (lot 4) et HTML sans script (lot 5) : faits.
- [ ] **Module de partage de fichiers** (auto-hébergé ou kDrive d'Infomaniak) : lien de téléchargement à la place des
  pièces jointes trop lourdes pour un courriel.

### Chaîne des achats et marchés

Analyse achevée (lots 1 à 7 réalisés, voir « Réalisé »). Restent :

- [ ] Vérifier `PIED_GLOBAL` (postes HT du pied global, ex. compte prorata) : la décision Q6 garde le pied global
  après TVA seulement, les postes HT se saisissent sur les commandes.
- [ ] 13.14 sans décision : regroupement des BL par commande (une section par document pour l'instant) et chantier
  par ligne (`lig_cha_id`).
- [ ] Proposition des marchés à facturer pour une période (13.9).
- [ ] Retenue de garantie et révision de prix à affiner (Q22).
- [ ] Écran de transformation ligne à ligne.
- [ ] Déduction d'un règlement ou d'un avoir sur une facture suivante (module Comptabilité).

### Marchés et règlements

- [ ] Saisie de l'échéancier à la main et date de libération des retenues à l'écran (route `PUT /documents/{id}/echeances`
  prête).
- [ ] Onglet Règlements de la page document.
- [ ] Avance forfaitaire « entre deux seuils » ; aperçu des déductions d'acompte avant validation.
- [ ] Liste du délai de paiement des tiers reliée à `condition_paiement` ; relances.
- [ ] Propositions sans décision explicite (retenues par défaut, conception `CONCEPTION-MARCHES-REGLEMENTS.md` § 11) à
  faire valider : modes d'acompte (11.1), déduction en mode chiffre d'affaires (11.2), postes HT sur commandes (11.3),
  postes TTC restants (11.4), règlements sans le module (11.5).

### Comptabilité

Analyse du 25/10/2026 : [ANALYSE-MODULE-COMPTABILITE.md](documentation/conception/ANALYSE-MODULE-COMPTABILITE.md)
(base en trois lots, puis module complet). Base réalisée : lots 1 (plan, collectifs, comptes des tiers, TVA), 2 (types
comptables, ventilation) et 3 (écritures, export Sage 100).

- [ ] Lot 2, écarts : clés de ventilation par code de nature et de taux (un code renommé laisse une clé orpheline) ;
  colonnes `nat_compte_vente|achat` gardées dans la table du module Bibliothèque (plus saisies en ligne, encore dans
  la démo hors ligne) ; une nouvelle nature n'a pas de compte tant qu'aucune clé ne la vise (compte par défaut du type).
- [ ] Lot 3, à valider : modèle Sage 100 (colonnes, ANSI, JJMMAA, sens et montant) à reproduire dans le format
  d'import paramétrable de Sage puis à essayer sur un vrai fichier ; modèle personnalisé seulement par l'API
  (`PUT /api/comptabilite/export/modele`), pas d'écran de saisie des colonnes.
- [ ] Lot 3, écarts : montants des lignes vendues pris comme poids (la base HT de chaque taux fait foi) ; postes de pied
  reconnus par le marqueur du marché, sinon par leur libellé (remise, prorata, acompte, paiement direct, retenue) ;
  déduction d'acompte en mode chiffre d'affaires portée au compte d'acompte (Q13, avis de l'expert-comptable) ;
  virement de la TVA à encaisser à l'encaissement : module complet avec les règlements ; fichier des lots gardé en base
  (pas en GED).
- [ ] Lot 1, écarts : un changement de longueur des comptes ne convertit pas le plan (comptes signalés « hors
  longueur ») ; les comptes de tiers saisis dans la fiche personne ne passent pas par `ReglesComptes` (seulement par
  `/comptabilite/tiers`) ; génération filtrée sur les sous-traitants : un sous-traitant aussi fournisseur sans compte
  n'en reçoit pas (générer sans filtre).
- [ ] **Module Comptabilité complet** : journaux tenus, exercices et clôture, saisie d'écritures, lettrage, règlements
  et TVA sur les encaissements (module Règlements), FEC, contre-passation des pièces modifiées après transfert.
- [ ] Règle définitive du compte comptable des lignes (aujourd'hui provisoire : compte de la ligne, sinon de la nature
  selon la famille du document, sinon du tiers) : à remplacer par `definirRegleCompte` de `client/src/app/comptes.js`,
  côté serveur aussi s'il faut le compte effectif. Le compte du tiers (`per_cli_compte` / `per_fou_compte`) est un
  compte auxiliaire (411 / 401) : son usage comme compte de produit ou de charge est à confirmer.

### Frais annexes

- [ ] Envoi vers la bibliothèque d'un ouvrage à PV fixe : le PV n'est pas envoyé (le prix d'un ouvrage de la
  bibliothèque est celui de sa composition).
- [ ] Les clés de ventilation ne suivent pas un copier-coller de lignes.

### Métré

- [ ] Les variables chaîne et booléen d'un script ne sont pas publiées dans les portées (`Portees` ne stocke que des
  décimaux).
- [ ] Les fonctions propres à l'hôte (option `fonctions`) ne sont branchées ni aux moteurs ni à l'éditeur.

### Fiches et listes

- [ ] Les listes affichent la valeur chiffrée d'un champ supplémentaire mot de passe (à exclure des colonnes proposées).
- [ ] Listes par requête SQL indisponibles hors ligne (démo : options saisies).
- [ ] Module Fiche : `AvantSuppressionAsync` n'est surchargé nulle part dans le cœur (contrôles métier avant suppression).

### Structure des affaires

- [ ] Phase 2 : traçabilité des quantités, situations cumulées, transformation partielle, déduction du paiement direct.

### GED

- [ ] Revue des fins de conservation (DETRUIRE : purge proposée, jamais pour le coffre-fort).
- [ ] L'archivage automatique de nuit (`ArchivageGed`) ne voit pas les documents SECRET d'autrui (filtre d'accès de
  l'utilisateur système).
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
- [ ] Module Facturation électronique (réception obligatoire depuis le 01/09/2026) à analyser : formats (Factur-X,
  UBL, CII), connexion à la plateforme agréée, commun aux ventes, aux achats et à la sous-traitance ; en attendant,
  saisie libre des factures reçues (ST22).
- [ ] Reporter dans Q9 de `CONCEPTION-MARCHES-REGLEMENTS.md` (toujours sans décision) ce que ST5, ST14 et ST15 ont
  tranché (paiement direct réalisé au lot 4 de la sous-traitance).

### Stock

Analyse du 24/10/2026 : [ANALYSE-MODULE-STOCK.md](documentation/conception/ANALYSE-MODULE-STOCK.md).

- [ ] Lots et numéros de série à analyser (S24) : certificats matière (acier : numéro de coulée, certificat 3.1 en GED,
  suivi jusqu'au chantier) et futur module SAV (traçabilité des articles vendus, posés et entretenus) ; colonne de
  traçabilité réservée dans le journal des mouvements dès le lot 1.
- [ ] Fiche de dotation EPI : modèle du module Édition (PDF rangé en GED, signature sur la borne) à la place de la page
  imprimée par le navigateur (S26).
- [ ] Inventaire : pièce comptable (`S_INVENTAIRE` ou écriture d'écart) à produire par le futur module Comptabilité à
  partir d'un lot validé ; valorisation du stock à date pour la clôture.

### Module Exécution

- [ ] Délégation du contrôle N+1 à un autre membre du service : module de droits (E30).

### Application de terrain (poseurs, chefs d'équipe)

- [ ] **Lot 7** ([analyse](documentation/conception/ANALYSE-TERRAIN.md), lots 1 à 6 réalisés) : présaisie des heures,
  réception de livraison simplifiée, pointage des matériels, avancement comparé aux situations.
- [ ] Lot 1, écarts : plans au dernier indice validé du suivi des validations (CRM) parmi les pièces du terrain (T6) ;
  bandeau trop large sur un téléphone (gabarit tactile commun avec le lot 2).
- [ ] Lot 2, écarts : pointage à la ligne d'ordre (`poi_lig_id`) quand la tâche vient d'une ligne (T8) ; option de
  présaisie des heures (T7).
- [ ] Lot 3, suites : comparaison de l'avancement réel aux situations de travaux (second temps) ; photos HEIC converties
  (le navigateur ne sait pas les réduire).
- [ ] Lot 4, suites : saisie libre hors ligne limitée aux chantiers et ordres déjà lus (journée gardée) ; nouvelle
  recherche d'un ordre par son numéro impossible hors ligne ; envoi des photos gardées sans contrôle de taille avant
  l'envoi (limite de dépôt de la GED).
- [ ] Lot 5, suites : valeur juridique de la signature simple à faire confirmer ; levée des réserves suivie (tâche du CRM
  seulement) ; demande d'approvisionnement en texte libre (articles de la bibliothèque à choisir plus tard) ; réception
  gardée hors ligne horodatée à l'envoi par le serveur.
- [ ] Lot 6, suites : temps et fournitures du bon de SAV non repris dans la facture (facture = transformation au bureau) ;
  création d'une intervention impossible hors ligne ; chantier « Entretien et dépannage » créé sans passer par le chrono
  des chantiers (code `SAV-<client>`) ; contrats d'entretien (Exécution, second temps).

### Import

- [ ] OptimBTP : décider du sort des champs non repris (heures, poste de travaux, compléments de pied, première page
  et texte de fin…).
- [ ] Rattachement automatique du client à l'annuaire.

### Installation

- [ ] Fonctions SQL appelées sans schéma dans des expressions indexées ou des colonnes générées (`f_ged_normaliser`…) :
  qualifier les appels ou poser `SET search_path = public` sur les fonctions, pour qu'un pg_restore direct fonctionne
  (la restauration de l'installeur rejoue le SQL avec `search_path = public` en attendant).
- [ ] Séparer les données de démonstration des données de référence (116, 141, 161, 163, démo de 120, sous-traitants
  de 211…) : une base neuve d'installation reçoit aujourd'hui la démonstration (211 dépend des niveaux de 141).
- [ ] **Module d'installation** ([analyse](documentation/conception/ANALYSE-MODULE-INSTALLATION.md), lots 1 à 4 réalisés) :
  reste à essayer Let's Encrypt avec de vrais identifiants DNS et les rôles Api / Base sur deux machines ; vérifier le
  coffre de la GED après une restauration (`installation verifier`) ; page d'amorçage sans contrôle DNS du poste.
- [ ] Scripts Debian 13 (`modules/installation/linux`, [procédure](documentation/INSTALLATION-DEBIAN.md)) : essai de bout
  en bout sur un vrai Debian 13 (installation, rejeu, sauvegarde, restauration, mise à jour avec retour arrière,
  minuteries systemd) ; seules la syntaxe, shellcheck et la rotation 7 / 4 / 12 sont vérifiées.

### Demandes du 25/10/2026

Analyse et découpage en lots : [ANALYSE-DEMANDES-2026-10.md](documentation/conception/ANALYSE-DEMANDES-2026-10.md)
(anomalies B1 à B7, améliorations, lots 0 à 11). À étudier :

- [ ] Poste de travaux (documents ; champ OptimBTP non repris).
- [ ] Tiers par compte (comptabilité) dans le module Liste avec saisie : capacité d'édition des listes à concevoir.
- [ ] Ouvrages fabriqués par l'atelier gérés en stock, ou achetés tout faits (lien avec les tarifs fournisseurs).
- [ ] EcoTaxe.
- [ ] Secteur du chantier et des documents de vente.
- [ ] Demandes de prix d'achat « sur ordre » : déverrouiller plusieurs commandes pendant la durée du chantier en
  conservant les prix de la demande.
- [ ] Module Analyse : à définir.
- [ ] Module Comptabilité avancée : à définir (voir aussi « Module Comptabilité complet »).
- [ ] Module de gestion des risques : à définir.
- [ ] Module de circuit de validation : à définir.
- [ ] Module d'édition automatique : à définir.
- [ ] Module de sauvegarde : option pour sauvegarder la base, sauvegarde de la GED en fichier compressé, méthode pour
  changer la clé de chiffrement du `.env` et la clé des données. Déjà fait par le module Installation (lots 3 et 4) :
  `Sauvegarder-LogiBTP.ps1` (pg_dump, GED et configuration en `.tar.gz`, chiffrement facultatif), rotation de la clé
  des données (`installation cle-donnees changer`) ; reste : sauvegarde lancée depuis l'application et changement de
  la clé de construction qui chiffre les valeurs `env:v1:` du `.env`.

### Demandes du 25/10/2026, suites des lots réalisés

- [ ] « Ne plus utiliser » (db/228) : écarter ces fiches des choix de nouvelle saisie (recherche des tiers de l'annuaire, appel de la bibliothèque, ressources du planning, salariés du pointage et du magasin) : point d'accroche à prévoir dans les modules Annuaire et Bibliothèque (colonne du cœur).
- [ ] Fournisseur « TVA intracommunautaire » (db/229) : proposer la catégorie de TVA autoliquidée (module Comptabilité) sur les lignes de ses pièces d'achat ; type de tiers FE à reprendre par le futur module Facturation électronique.
- [ ] Précédent / suivant : aussi dans la page document ouverte depuis une liste (`suite-liste.js`).
- [ ] Sécurité de la base (lot 11 réalisé) : `MettreAJour-LogiBTP.ps1` pourrait relancer la préparation et redémarrer la base quand la connexion n'est pas chiffrée (aujourd'hui : relancer l'installeur) ; renouvellement du certificat de la base dans la tâche planifiée (aujourd'hui : à chaque préparation, 60 jours avant l'échéance ; certificat de 730 jours).
- [ ] Restaurants (lot 10 réalisé) : repas dans la saisie d'équipe de la borne (aujourd'hui : chacun pour soi), liste des repas d'une période (contrôle RH, notes de frais), géocodage à l'enregistrement d'un chantier ou d'une adresse (aujourd'hui : au premier besoin) et carte des restaurants.
- [ ] Documents (lot 9 réalisé) : reconnaissance des accusés de réception reçus par courriel (module Mail, lot 4 : numéro de commande, rattachement, proposition de la livraison confirmée) ; colonne « Livraison » dans les vues par défaut des commandes fournisseur et des réservations (`vues-document.js`) ; date de livraison par ligne modifiable sur une commande validée (aujourd'hui : l'ARC de l'entête seulement).
- [ ] Tarifs fournisseurs (lot 8 réalisé) : formats d'import personnalisés (module Import : correspondance de colonnes enregistrée par fournisseur), remises par famille d'articles et catalogues, unités synonymes à l'import (A18b), délai du fournisseur (`per_fou_delai_livraison`) en dernier repli du délai d'un article.
- [ ] Projet (lot 6) : retirer l'ancien texte `prj_responsable` quand les responsables auront été repris en individus (démo `structure/donnees.js`, `db/161`, `SpecialisationCrmBtp.CreerProjetAsync` qui l'écrit encore) ; zone de déplacement du projet reprise par le chantier ouvert depuis le projet (zones du Pointage par agence).
- [ ] Matériel (lot 5c réalisé) : import des cartes carburant (module Import, M8) ; retirer le champ « Révision tous les (heures) » (`mat_heures_revision`) et l'encart « Avant révision » de la fiche, remplacés par les plans d'entretien ; relevés de compteurs saisis à la borne (source BORNE prévue) ; données de démonstration d'entretiens (aujourd'hui tous en retard faute d'historique).
- [ ] Refacturation interne du matériel aux chantiers où il travaille (coût horaire d'usage, M4 du lot 5c) : décision de la future analyse de rentabilité ; le coût par heure est affiché dans l'onglet Coûts.
- [ ] Authentification : rafraîchissement simultané du même jeton par deux requêtes → 500 (`jeton_remplace_pkey` en double, `RafraichirAsync`), vu au démarrage de l'API.

## Interface

- [ ] Mode hors ligne : appel de la bibliothèque (F3) limité aux recherches déjà faites en ligne (réponses gardées par le
  service worker) ; à étudier : copie locale des éléments consultés ou d'une bibliothèque choisie pour la recherche hors
  ligne. Écrans hors document (fiches, pointage…) : consultation seulement.

- [ ] Écrans encore construits avec des `<select>` (affichés en combos par `activerCombos` du socle) : les réécrire
  directement avec `creerCombo` au fil des évolutions (concepteur et menu de filtre des listes, onglets de la
  bibliothèque, panneaux du document, annuaire, graphe…). Séparateurs à proportion (onglet Analyse, arbres de la
  bibliothèque) : restés propres (part en % et non largeur).

## Revue du code du 27/10/2026 ([rapport](documentation/REVUE-CODE-2026-10-27.md))

- [ ] Lots A (code mort sûr) et B (code apparemment inutilisé, à trancher) : en attente des évolutions à venir qui
  touchent ce code ; à reprendre ensuite.
- [ ] Lot F, reste à trancher : listes de statuts différentes selon les requêtes d'ordres (Pointage : sans SOLDE ; sources
  du planning et jalons : aucun filtre de statut, un ordre annulé y reste proposé) ; `lower(ind_utilisateur)` seulement
  dans Mail et OAuth (casse du pseudo non unifiée) ; listes de statuts des requêtes paramétrées par interpolation
  (`SpecialisationBtp` encours client, `StockApprovisionnementBtp`) et `std_code <> 'ANNULE'` laissés en littéraux ;
  ~60 `?? DBNull.Value` en ligne (aide `SqlBtp.P` disponible).
- [ ] Raccourcis clavier : déclarer les fonctions des fiches, des listes et de la GED (groupes à ajouter avec
  `declarerRaccourcis`) ; les accélérateurs des menus du bandeau (`&Paramètres`) ne sont pas personnalisables ; menu
  contextuel à étendre (fiches, explorateur GED, entête du document).