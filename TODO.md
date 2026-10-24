## Base de données

- [ ] **Module de gestion des versions de la base** (après stabilisation du schéma) : numéro de version du schéma
  par base de société, scripts de migration ordonnés et rejouables, application automatique aux bases existantes.
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
- [ ] Envois à brancher quand les fonctions existeront : confirmation du SAV avec le bon signé (Exécution E22), relevé
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

- [ ] **Module Comptabilité** (à préparer) : plan de comptes complet et vrai plan à la place de `compte_comptable`
  (`db/166`, minimal, sans écran de gestion), journaux, exercices, comptes auxiliaires des tiers (411 / 401), comptes
  de TVA par taux, comptes d'acompte (selon le mode de la société), schéma des écritures des factures, avoirs,
  acomptes et règlements (encaissements du module Règlements), export vers un logiciel comptable.
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
- [ ] **Module d'installation** ([analyse](documentation/conception/ANALYSE-MODULE-INSTALLATION.md), questions I1 à I14
  tranchées le 24/10/2026 ; lots 1 à 3 réalisés) : un conteneur pour l'API (client servi par l'API, HTTPS par Kestrel) et un pour la base, hôte Windows en
  réseau local, certificat (autorité LogiBTP, AD CS, certificat fourni ou Let's Encrypt par DNS) ; enchaîner
  `env initialiser` (fait : clé des données générée, `.env` chiffré, un `.env` fourni est conservé), création des bases
  et des rôles (`db/installation/roles.sql`), `pg_hba.conf`, certificat joker et DNS, premier administrateur ; rotation
  de la clé des données (rechiffrer les valeurs `chiffre:v1:`).

## Interface

- [ ] Remplacer les derniers `<select>` par `creerCombo` : vues de liste, menu de filtre, sélecteurs de thème et de vue
  des listes, profil de démonstration (paramètres).
- [ ] Raccourcis clavier : déclarer les fonctions des fiches, des listes et de la GED (groupes à ajouter avec
  `declarerRaccourcis`) ; les accélérateurs des menus du bandeau (`&Paramètres`) ne sont pas personnalisables ; menu
  contextuel à étendre (fiches, explorateur GED, entête du document).