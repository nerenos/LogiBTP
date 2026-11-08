# LogiBTP – tâches déjà faites.

## Base de données

### Bases existantes à mettre à niveau (`logibtp` et `logibtp_demo`)

## Fonctionnel

### Documents

- [x] **Règles des documents** (17/10/2026, six lots) : règles globales, par famille et par type, catalogue R1 à R20,
  cycle de vie ENVOYE / VALIDE, statuts automatiques et de paiement, dévalidation par indice, droits APPROUVER /
  DEVALIDER / FORCER, contrôles de gestion. [conception](conception/CONCEPTION-REGLES-DOCUMENTS.md)


### Messagerie et connexions externes

- [x] **Module OAuth, lot 1** (23/10/2026) : connexions sortantes OAuth 2.0 (Google / Gmail grand public par code +
  PKCE), client, jetons et compte chiffrés, adresse de retour commune, renouvellement et rappels d'échéance par base,
  page `/parametres/connexions`, contrat `IFournisseurJeton` du socle. [analyse](conception/ANALYSE-MODULE-OAUTH.md)
- [x] **Module Mail, lot 1** (23/10/2026) : comptes système chiffrés et alias, mot de passe ou OAuth 2.0, usages,
  modèles ; envoi par file d'attente (limitations, lissage, reprises, erreurs classées, suspension sur blocage),
  journal des envois, confirmation des envois groupés ; envoi d'un document (pièces « à envoyer », GED, statut
  ENVOYE, note du CRM) ; pages `/mail`, `/mail/nouveau`, `/parametres/mail`. [analyse](conception/ANALYSE-MODULE-MAIL.md)
- [x] **Module Mail, lot 2** (23/10/2026) : envois automatiques (canal courriel des notifications, mot de passe oublié
  par lien, bordereaux de diffusion du CRM).
- [x] **Module Mail, lot 3** (23/10/2026) : réception IMAP, courriels reçus en GED, avis de non-remise, liste « À
  rapprocher », rattachement manuel, ignorer, purge.
- [x] **Module Mail, lot 4** (23/10/2026) : reconnaissance automatique répliquée JS ↔ C#, règles et seuils, rattachement
  automatique et alerte au service, propositions à valider.
- [x] **Module OAuth, lot 2** (23/10/2026) : flux sans utilisateur (application Microsoft par client credentials avec
  secret ou certificat — assertion JWT signée, fin de validité lue dans le certificat —, compte de service Google avec
  délégation sur le domaine), fournisseurs Microsoft 365 (délégué par code + PKCE ou application) et générique
  (adresses saisies par connexion), bouton « Se connecter » direct.

### Chaîne des achats et marchés

- [x] **Chaîne des achats et gestion des marchés** (16/10/2026, lots 1 à 7) : reste à solder, options et variantes,
  marché et avenants, pieds de section et pied global, plusieurs sources, avancement (situations, factures
  d'avancement, avoir d'avancement, révisions, reprise, déduction), annulation en cascade.
  [conception](conception/CONCEPTION-ACHATS-MARCHES.md)

### Marchés et règlements

- [x] **Gestion du marché, postes globaux, acomptes, échéances, règlements** (17/10/2026, lots 1 à 5) : onglet
  Gestion de la fiche marché, conditions de paiement et échéancier, postes de pied, acomptes, module Règlements.
  [conception](conception/CONCEPTION-MARCHES-REGLEMENTS.md)
- [x] Projet (lot 6) : zone de déplacement du projet reprise par le chantier ouvert depuis le projet (fait le 08/11/2026, db/278 : zone estimée du chantier ; les zones validées par agence restent celles du Pointage).

### Comptabilité

- [x] Fournisseur « TVA intracommunautaire » (db/229) : catégorie de TVA autoliquidée par défaut sur les nouvelles lignes d'achat (lot 5) et avertissement à la validation (lot 6) du plan ne-plus-utiliser-tva ; type de tiers FE à reprendre par le futur module Facturation électronique.

### Frais annexes

- [x] **Frais annexes** (16/10/2026) : ventilation par tranches F, clés, rapport de l'onglet Analyse.
  [conception](conception/CONCEPTION-VENTILATION-FRAIS.md)

### Métré

- [x] **Métré en script** : langage, éditeur, conversion des anciens métrés, notifications.
  [conception](conception/CONCEPTION-SCRIPT.md)

### Fiches et listes

- [x] Un mot de passe d'une colonne du programme saisi dans une liste (module Liste, saisie en ligne) serait écrit en
  clair. Pas de saisie des mot de passe en liste
- [x] Listes par requête SQL hors ligne : sans objet depuis la fin de la démo hors ligne ; le serveur résout les
  options dans `GET /api/fiches/{type}/definition`, gardée par le service worker (réseau d'abord) pour le hors ligne.
- [x] « Ne plus utiliser » (db/228) : fiches à N écartées des choix de nouvelle saisie (annuaire, bibliothèque, planning, pointage, magasin ; plan ne-plus-utiliser-tva lots 1 à 4).
- [x] Matériel : photo de l'état au départ et au retour d'une affectation : fait (plan materiel-suites, lots 1 et 2), à passer dans TACHES.md par un humain.

### Structure des affaires

- [x] **Structure des affaires, phase 1** (`db/160`) : projets, affaires, chantiers, marchés, intervenants.
- [x] **Structure des affaires, phase 2**, réalisée par d'autres lots : traçabilité des quantités (reste à solder, liens
  recalculés, solde, conversion d'unités `UNITE_TRANSFORMEE`), situations cumulées (avancement, lots 6a et 6b),
  transformation partielle (« Choisir les lignes et les quantités », reliquat), déduction du paiement direct
  (Sous-traitance, lot 4 : lien `PAIEMENT_DIRECT`, poste de pied au montant accepté).

### GED

- [x] **GED, coffre-fort et organisation** (16/10/2026) : chaîne du coffre, versions, accès, rétention, classification,
  arborescence.

### Sous-traitance

- [x] **Sous-traitance, lot 0** (24/10/2026) : famille T dans le module Document, activation du module, lot de
  consultation commun aux demandes de prix d'achat.
- [x] **Sous-traitance, lot 1** (24/10/2026) : types T_*, marché à deux sens, commande validée dans un marché de
  sous-traitance, transformations, sous-traitants de démonstration repris dans l'annuaire.
- [x] **Sous-traitance, lot 2** (24/10/2026) : pièces exigées, validité dans la GED, conformité répliquée JS ↔ C#,
  contrôles à la validation, demandes par courriel, rappels.
- [x] **Sous-traitance, lot 3** (24/10/2026) : factures à l'avancement ou reçues (ventilation répliquée), avoir,
  approbation avant le bon à payer, postes du marché, édition de la proposition de situation.
- [x] **Sous-traitance, lot 4** (24/10/2026) : paiement direct (demande, acceptation dans les 15 jours, plafond agréé,
  déduction de notre facture, transmission, paiement), délégation de paiement, réception et libération des retenues.
- [x] **Sous-traitance, lot 5** (24/10/2026) : éditions du marché (DC4, acte spécial, contrat, ordre de service),
  comparatif des offres d'un lot de consultation, assistant « Sous-traiter », engagé et réalisé du marché de vente.

### Exécution

- [x] **Exécution, lots 2b à 2e** (24/10/2026) : types d'ordres activables, étapes des ordres par états (règles
  répliquées), planning par étapes, validation des étapes depuis l'atelier et la borne.
- [x] **Délégation du contrôle N+1** (05/11/2026, E30) : le responsable d'un service désigne des membres qui contrôlent
  les étapes à sa place, pour une période ou sans fin (page `/execution/delegations`, menu Exécution) ; le délégué
  reçoit la tâche du Suivi et les rappels ; le profil peut aussi accorder le contrôle (droit « Contrôle du N+1 des étapes
  d'ordres », portée service ou tout).

### Stock

- [x] **Fiche de dotation EPI par le module Édition** (05/11/2026, S26) : modèle « Fiche de dotation », imprimée depuis
  la fiche salarié ; signée à la borne (✍ Ma fiche de dotation) pour les remises et retours depuis la fiche précédente,
  PDF rangé dans la GED du salarié ; fiches signées réimprimables.
- [x] **Lots et numéros de série, lot S24-a** (05/11/2026) : suivi de l'article (aucun, par lot, par numéro de série ;
  périssable avec durée théorique) dans l'onglet Stock, section « Lots » du détail de la ligne des pièces de stock
  (facultative, reste sans lot), lots créés à la validation (date limite proposée), mouvements et stock par lot.
- [x] **Lots et numéros de série, lot S24-b** (05/11/2026) : sorties sans lots servies par les lots en stock (FEFO
  pour un article périssable, sinon FIFO), aussi au magasin et à la borne, bouton « Proposer » ; inventaire par lot
  (colonne Lot, une ligne par lot à la génération) ; lot INITIAL à l'activation du suivi ; avertissement des entrées
  sans lot à la validation.
- [x] **Pièce comptable de l'inventaire** (05/11/2026) : à la validation d'un lot, pièce « Écarts d'inventaire » des
  écarts valorisés (lien dans la page du lot), exportée en opération diverse (compte de stock ↔ variation des stocks,
  type comptable STOCK) ; annulation du lot : pièce annulée, ou contre-passée si elle est déjà transférée.

### Application de terrain

- [x] **Lot 1** (30/10/2026) : page `/terrain` (tâches du jour ou de la semaine, adresse et itinéraire, contact,
  consignes, liens, pièces de la GED diffusées sur le terrain), téléphone et repères du chantier dans la partie mobile
  des tâches du planning, case 📱 « Diffusée sur le terrain » de la GED (chantier, marché, ordres).
- [x] **Lot 2** (30/10/2026) : onglet Pointage de `/terrain` (tâches du jour, saisie libre avec tâche réalisée non
  planifiée, chef d'équipe, « Compléter la journée », repas), portée EQUIPE et profil CHEF_EQUIPE, bandeau sur téléphone.
- [x] **Lot 3** (30/10/2026) : onglet Ordres (étapes à valider), « Étape terminée ? » après un pointage sur un ordre,
  avancement réel daté des tâches, non-conformité et photos (galerie, réduction au choix) depuis la carte d'une tâche.
- [x] **Lot 4** (31/10/2026) : saisie sans réseau (journée, repas, avancement, photos, non-conformité, étapes gardés sur
  l'appareil et envoyés au retour), refus affichés avec Réessayer / Abandonner, deux semaines préchargées.
- [x] **Lot 7** (30/10/2026) : présaisie des heures en préférence, réception de livraison simplifiée (bon brouillon validé
  au bureau, droit `terrain/livraison`), pointage des matériels depuis une tâche (heures, compteurs, plein), avancement
  réel comparé au situé dans l'onglet Gestion du marché.
- [x] **Lot 6** (30/10/2026) : interventions SAV dans `/terrain` (onglet 🧰, droit `execution/sav` refusé par défaut),
  nouvelle intervention sur un chantier ou chantier « Entretien et dépannage » du client, compte rendu, photos, bon signé
  en GED, courriel de confirmation ; correction du lot 5 : PV édité quel que soit le profil, étapes créées si besoin.
- [x] **Lot 5** (31/10/2026) : réception de pose signée sur l'écran (`/terrain/reception/:id` : sans réserve, avec
  réserves, refus), PV édité et rangé dans la GED de l'ordre avec son empreinte, réserves au CRM, ordre bloqué au refus,
  PV envoyé au client par courriel ; demande d'approvisionnement depuis une tâche ; pad de signature du socle.

### Import

### Installation

## Interface

- [x] **Bandeau et fenêtres d'interaction** (24/10/2026) : bandeau trop large à 1 024 px réglé par les libellés courts des menus (Res., Bib, SsT, Exe, Param., Fen.), puis marges réduites,
  informations tronquées et logo réduit à son icône ; logo à gauche (plus de maison), état de l'API en vert / rouge ;
  sous-menus (thème d'affichage, fiches), paramètres des modules dans leur menu, demandes d'achat et
  d'approvisionnement aussi dans Achats, ordres de sous-traitance dans Sous-traitance ; fenêtres d'interaction par
  l'élément `<dialog>` (plus de `confirm`, `alert`, `prompt`).
- [x] **Emojis par shortcode** (§ 42 : `:nom:` → image fixe de `images/emojis.json`, remplacement automatique du DOM fait,
  exemples `casque`, `valide`, `attention`) : compléter le catalogue et les images, remplacer les emojis Unicode des
  textes et des icônes, sélecteur dans les zones de saisie, éditions PDF et courriels côté serveur.
- [x] **P3… — un lot par module puis par zone du cœur** : textes, icônes (`icone()`, `images/icones.json`) et couleurs en
  dur (variables du thème). P3a Pointage fait (§ 14 de l'analyse : règles du module par `textesParCode`, pages pointage
  et borne, congés, repas, titres des routes, styles) ; P3b module Document fait (§ 15 : éditeur, panneaux, vues, plan,
  notifications, `document.css`) ; P3c page document du cœur fait (§ 16 : page, `PanneauxBtp`, `EditeurDevisBtp` ; restent
  les fichiers qu'ils appellent : structure, adresses, sous-traitance, analyse, contrôles de saisie, hors ligne) ; P3d module Liste fait (§ 17 : règles, liste, concepteur, menu de filtre, thèmes, `liste.css`) ; P3e module Fiche fait (§ 18 : validation, chrono, fournisseur, fiche, paramétrage, `fiche.css`) ; P3f module GED fait (§ 19 : fournisseur, explorateur, dépôt, aperçu, règles, `ged.css`) ; P3g module Annuaire fait (§ 20 : coordonnées, identifiants, fournisseur, rattachements, liens, tiers provisoires, référentiels, graphe) ; P3h module Bibliothèque fait (§ 21 : tables de libellés, fournisseur, arbres, onglets de la fiche, paramétrage) ; P3i module CRM fait (§ 22 : règles du module, écrans du cœur `crm_btp.*` : suivi, fil, notes, demandes, plans, bordereaux, rappels, paramétrage) ; P3j module Mail fait (§ 23 : boîte, rédaction, détail, suivi des envois, paramétrage `mail_btp.*`) ; P3k module Planning fait (§ 24 : règles et vue du module, thème `--pla-*`, écrans du cœur `planning_btp.*` : page du planning, panneau, ressources, équipes, paramètres, prototype) ; P3l module Stock fait (§ 25 : messages de l'inventaire et méthodes de valorisation du module, écrans du cœur `stock_btp.*` : état, article, paramètres, marquage, inventaires, approvisionnement, projection, magasin, dotations, saisies à valider, fiche de dotation ; couleurs `--stock-*`) ; P3m module Exécution fait (§ 26 : natures et unités des étapes, états des services, messages des contrôles, écran tactile des étapes du module ; écrans du cœur `execution_btp.*` : synthèse, vue d'un chantier, modèles de parcours, catalogue et états des types, panneau Exécution d'un ordre, tableau des étapes, répartition ; couleurs `--exe-*` et `--execution-*`) ; P3n module Sous-traitance fait (§ 27 : états des pièces et des demandes de paiement direct, actions bloquées, portées, messages du module ; écrans du cœur `sous_traitance_btp.*` : onglets Pièces et Paiements, retenue de garantie, assistant Sous-traiter, marché de sous-traitance d'une commande, pièces exigées, comparatif des offres ; couleurs `--sous-traitance-*`) ; P3o module Comptabilité fait (§ 28 : messages des comptes et de la ventilation, étapes de la règle de ventilation ; écrans du cœur `comptabilite_btp.*` : plan comptable, tiers par compte, paramètres, collectifs, types comptables et de documents, catégories et taux de TVA, ventilation, export des écritures) ; P3p module Calendrier fait (§ 29 : règles des jours fériés, jours de la semaine, messages des contrôles ; page `/parametres/calendriers` : `calendrier_btp.*`) ; P3q module Métré fait (§ 30 : messages du langage de script — lexeur, analyseur, interpréteur, fonctions, portées —, panneau de métré, éditeur, dictionnaire et notifications ; fonction `Conditionnements` du cœur) ; P3r module Édition fait (§ 31 : alertes et messages du moteur, libellés imprimés par défaut, aide du langage ; aperçu, éditeur du modèle, dictionnaire et paramétrage `edition_btp.*` ; restent les modèles fournis `editions/modeles.js`, données système) ; P3s module Import fait (§ 32 : erreurs du zip et du XML, sorts et motifs des champs `CHAMPS_*`, avertissements de la conversion OptimBTP ; page d'import, devis à vérifier, rapport `import_btp.*`) ; P3t modules Authentification et Droits faits (§ 33 : états, messages des règles, actions et portées ; connexion, Mon compte, comptes utilisateurs, profils et droits `authentification_btp.*` / `droits_btp.*`) ; P3u modules OAuth et Notifications faits (§ 34 : connexions externes, boîte et préférences de notification, cloche du bandeau `oauth_btp.*` / `notifications_btp.*`) ; P3v navigation du cœur faite (§ 35 : menus, widgets, raccourcis, bandeau `navigation_btp.*` ; définitions des fiches, vues et données de démonstration rangées avec les données système) ; P3w fiches du cœur faites (§ 36 : `fiches.js`, `fiche-element.js`, `fiche-annuaire.js`, `fiche-structure.js`, textes `fiches_btp.*`) ; P3x structure, documents et hors ligne faits (§ 37 : `structure/*`, transformation, sources, traçabilité, avertissements, page des règlements, page de fusion, `hors-ligne/*`) ; P3y ressources et terrain faits (§ 38 : `ressources/*`, pages du référentiel et des habilitations, `terrain/*`, pages Mon terrain, réception de pose et intervention SAV) ; P3z analyse, frais annexes et bibliothèque du cœur faits (§ 39 : onglet Analyse, calculs de l'analyse, frais annexes et leur rapport, appel et envoi de la bibliothèque, tarifs fournisseur et leur import, onglet Photo / Logo) ; P3aa pages de paramétrage et pages générales faits (§ 40 : Paramètres, documents, installation, raccourcis, services, référentiels, modules, annuaire, société, bibliothèque, GED ; accueil, fiche, introuvable, GED, graphe, liste ; titres des routes ; arborescence de la GED ; paramètres d'une tranche) ; P3ab écrans de la révision des prix et des règlements faits (§ 41 : index et formules, onglet Révision du marché, marchés à facturer du mois, onglet Règlements du document, colonne Chantier des lignes). Suivants :
  modules suivants (écrans restants signalés par la recherche des textes en dur), menus
  (`navigation/menus.js`), pages du cœur ; liste de contrôle d'un fichier par `extraire` du module Personnalisation.
- [x] **Erreurs par code, suite de P2** (P2 fait : 237 codes sûrs au dictionnaire, § 13 de l'analyse) : 258 codes gardent
  le message du serveur (messages composés, plusieurs messages pour un code, codes employés ailleurs) ; les rendre sûrs
  au fil des lots par module (valeurs dans `details` et `{{nom}}`, ou un code par message), puis
  `npm run extraire-erreurs --workspace client`.
  [analyse](documentation/conception/ANALYSE-MODULE-PERSONNALISATION.md))

Lots P1 (module, chargement, socle et navigation migrés), P2 (erreurs par code), P3a (Pointage), P3b (module Document), P3c (page document du cœur), P3d (module Liste), P3e (module Fiche), P3f (module GED), P3g (module Annuaire), P3h (module Bibliothèque), P3i (module CRM), P3j (module Mail), P3k (module Planning), P3l (module Stock), P3m (module Exécution), P3n (module Sous-traitance), P3o (module Comptabilité), P3p (module Calendrier), P3q (module Métré), P3r (module Édition), P3s (module Import), P3t (modules Authentification et Droits), P3u (modules OAuth et Notifications), P3v (navigation du cœur), P3w (fiches du cœur), P3x (structure, documents et hors ligne), P3y (ressources et terrain), P3z (analyse, frais annexes et bibliothèque du cœur), P3aa (pages de paramétrage et pages générales) et P3ab (écrans de la révision des prix et des règlements) faits. Suites, dans l'ordre de l'analyse (§ 7.1) :

## Réalisé (référence)

### Petites suites du 31/10/2026

- [x] Rafraîchissement simultané d'un jeton sans erreur 500, délai du fournisseur en repli de l'approvisionnement,
  colonne Livraison des commandes et réservations, retrait de la révision en heures du matériel, marque « non remise »
  des courriels dans l'annuaire, précédent / suivant dans la page document, décision Q9 reportée.

### Nettoyage du 04/11/2026

- [x] Colonnes retirées : `salarie.sal_matricule` (lectures passées sur `sal_code`, colonne `matricule` des vues de liste
  gardée) et `projet.prj_responsable` (projet du CRM créé avec `prj_responsable_ind_id`, démo sur des individus de la
  structure) par `db/265` ; `search_path = public` des fonctions de la GED (`modules/ged/db/054`, pg_restore direct) ;
  contrôles avant suppression des fiches du cœur déjà faits (`SuppressionFiches`).
- [x] Revue du code, lot F : identifiant de connexion `ind_utilisateur` toujours en minuscules (trigger de `db/266`,
  comparé à `lower(@u)`) ; ordres annulés ou remplacés écartés des jalons du planning, sources de tâches sur
  `v_ordres_ouverts` (le Pointage garde les ordres soldés : heures pointées après le solde) ; 71 `?? DBNull.Value` en
  ligne passés sur `SqlBtp.P` (restent les tuples, lambdas et `AddWithValue`).
- [x] Reprises de `db/266` : vues de liste enregistrées sur l'ancien libellé du statut passées sur la pastille `etat`
  (segments compris), colonnes Compte et Commentaire de la vue « Complet ».
- [x] Archivage de nuit de la GED sur tous les documents échus, SECRET compris (`ServiceGed.AppliquerRetentionSysteme`).
- [x] Devis à relancer : une note du CRM de type Relance remet le délai à zéro (`db/267`) ; délai = filtre de l'indicateur
  de la vue (15 jours par défaut, modifiable dans le concepteur).
- [x] Géocodage à l'enregistrement d'un chantier ou d'un restaurant (point d'accroche `ApresEcritureAsync` du module
  Fiche).
- [x] Unités de l'article (E10, suite) : champ Unité du détail de la ligne (unités de l'article en tête, même conversion
  du prix) ; « ne plus demander » gardé dans le navigateur pour le document.
- [x] Revue du code, lot F (fin) : statuts des requêtes du cœur par constantes (`StatutsDocument`, `StatutsDocumentBtp`
  nouveau ↔ `STATUT_DOCUMENT_BTP`) ; requêtes interpolées : statut en paramètre et listes en tableau
  (`std_code <> ALL({SqlBtp.StatutsHorsVigueur})`), requêtes brutes : `NOT IN ({SqlBtp.HorsVigueur})`.
- [x] Raccourcis clavier des fiches : groupe `fiche` du module Fiche (Modifier F2, onglets Alt+1…9, copier, supprimer,
  synthèse, confidentiel, paramétrer, onglets précédent / suivant), Imprimer Ctrl+P du cœur, touches dans les bulles ;
  onglet Graphe quitté avant la fin de son chargement : plus d'erreur.
- [x] Raccourcis clavier des listes (groupe `liste` : lignes, Début / Fin, Ctrl+A, Entrée, nouvelle fenêtre, Suppr ;
  page : Ctrl+F, Inser) et de l'explorateur GED (groupe `ged` : éléments, Entrée, F2, historique Alt+← / →, parent,
  Ctrl+F, Inser) ; touches effectives dans le menu contextuel des listes et les bulles de la GED.
- [x] Menu contextuel étendu : fiches (actions de la barre, onglets), explorateur GED (document, dossier, liste) et
  entête / options du document (boutons de la barre et actions du menu ▾), touches effectives affichées ; nom de la
  touche Inser.
- [x] Accès aux menus du bandeau personnalisables (groupe `menus` du module Navigation : Alt + lettre du `&` par défaut,
  lettre soulignée selon la touche effective) ; lettres en double (Tiers / Sous-traitance, Pointage / Paramètres) :
  le premier menu garde la touche, le second est à régler dans la page des raccourcis.

## Démonstration sur Vercel ([guide](documentation/DEPLOIEMENT-VERCEL.md))

- [x] **Mise en ligne** (côté utilisateur) : base Neon, initialisation (`scripts/demo/initialiser-base-demo.sh`),
  compte des visiteurs, projet Vercel et variables ; services et Container Runtime de Vercel en bêta : premier
  déploiement à vérifier (aiguillage `/documentation/`, en-têtes `X-Forwarded-*` reçus par le conteneur).
- [x] Séparer les données de démonstration des données de référence du manifeste (une base de démonstration
  aujourd'hui = toute base neuve).
- [x] Remise à zéro automatique des données de la démonstration (branche Neon remise à zéro chaque nuit). / remise à 0 en manuel

### Demandes du 25/10/2026, suites des lots réalisés

- [x] Sécurité de la base (lot 11 réalisé) : `MettreAJour-LogiBTP.ps1` pourrait relancer la préparation et redémarrer la base quand la connexion n'est pas chiffrée (aujourd'hui : relancer l'installeur) ; renouvellement du certificat de la base dans la tâche planifiée (aujourd'hui : à chaque préparation, 60 jours avant l'échéance ; certificat de 730 jours). Lot 1 du plan securite-base-suites fait (commande `certificat base-renouveler`, code 10) ; lot 2 (Windows) fait (mise à jour et tâche « LogiBTP - certificat » ; essais manuels à faire sur une installation de développement) ; lot 3 (Linux) fait (essais manuels à faire sur une installation de développement).
- [x] Restaurants (lot 10 réalisé) : carte des restaurants abandonnée (RO3) au profit de la liste `/pointage/restaurants` avec lien d'itinéraire (plan restaurants-suites, lot 5, fait) ; repas d'équipe à la borne et liste des repas d'une période faits (lots 1 à 4).
- [x] Documents (lot 9 réalisé) : (fait le 08/11/2026 : reconnaissance des accusés de réception reçus par courriel, plan ar-courriel lots 1 à 4, livraison confirmée proposée dans la boîte de réception ; date de livraison par ligne modifiable sur une commande validée, PUT /api/structure/documents/{id}/lignes/{ligId}/livraison).
- [x] Tarifs fournisseurs (lot 8 réalisé) : formats d'import personnalisés (module Import : correspondance de colonnes enregistrée par fournisseur), remises par famille d'articles et catalogues, unités synonymes à l'import (A18b).
- [x] Matériel (lot 5c réalisé) : import des cartes carburant (fait : lecture, rapprochement, écriture et page `/import/carburant`, plan materiel-suites lots 9-10b) ; relevés de compteurs saisis à la borne (fait, plan materiel-suites lots 3-4 ; écran de validation au bureau fait, plan materiel-suites lot 4b : `/ressources/releves-a-valider`) ; données de démonstration d'entretiens (aujourd'hui tous en retard faute d'historique).
- [x] Refacturation interne du matériel (M4 du lot 5c) : les heures pointées et planifiées sont valorisées sur les chantiers où il travaille (module Rentabilité, lot 5) ; chantier de suivi crédité (produit interne, lot 7 du plan materiel-suites)  ; coût par heure de l'onglet Coûts repris comme coût moyen de la fiche sur action (fait, plan materiel-suites, lot 8).

### Stock

Analyse du 24/10/2026 : [ANALYSE-MODULE-STOCK.md](documentation/conception/ANALYSE-MODULE-STOCK.md).


- [x] Lots et numéros de série (S24) : questions tranchées le 05/11/2026 (§ 11 de l'analyse : lots facultatifs, péremption
  par article périssable avec durée théorique) ; S24-a, S24-b et S24-c réalisés ; S24-d (numéros de série → équipements
  installés : module SAV `modules/sav`, garantie des articles, création par les mouvements, écrans, interventions E_SAV
  rattachées) réalisé par les lots 2 à 6 de [plans/stock.md](plans/stock.md) (06/11/2026, C# non compilé). Écarts de
  S24-c : pas de dossier des ouvrages exécutés (S24.6).
- [x] Clôture : valorisation du stock à date de tous les lieux (état et écriture de variation de fin d'exercice, un compte
  par nature d'article) et provision pour dépréciation (valeur d'inventaire inférieure au PMP, 39x) : lots 7 à 11 de
  [plans/stock.md](plans/stock.md) (faits le 07/11/2026, C# non compilé).

  ### Droits 
  - [x] **Avant une exposition sur internet** ([analyse des droits, § 10](documentation/conception/ANALYSE-MODULE-DROITS.md)) :
  reste les prérequis DNS et certificat joker dans l'installeur (§ 10.6) et la CSP bloquante posée par le proxy ;
  en-têtes, CSP en rapport, contrôle de l'`Origin`, CORS, débit, proxys (lot 4) et HTML sans script (lot 5) : faits.

- [x] **Module de droits** ([analyse](documentation/conception/ANALYSE-MODULE-DROITS.md), lots 1 à 5 réalisés : profils, arbre, refus par défaut des routes, montants de validation, usurpation, listes filtrées, JWT et rafraîchissement rotatif, machines connues, double facteur, exclusion d'IP, identifiants d'API, sécurité web, journaux, .env chiffré, rôles PostgreSQL) :
  droits fins par profil, portée et élément, montants de validation, usurpation, RGPD, JWT avec
  rafraîchissement rotatif, machines connues, double facteur par courriel, exclusion d'IP, identifiants API, deux clés
  (`.env`, données) ; profil par défaut = saisie mobile (A5 révisée) ; à reprendre par le Mail (comptes, boîtes,
  « À rapprocher ») et l'OAuth (reconnexion des connexions).

  ### Documents

- [x] Restauration d'une version et rapport des frais annexes (faits le 05/11/2026) : essai dans le navigateur à faire
  (restaurer puis enregistrer un brouillon, imprimer le rapport `FRAIS_ANNEXES` d'un devis à tranche F) ; une
  restauration enregistrée est tracée comme une modification (pas d'action RESTAURATION dans l'historique).

### Chaîne des achats et marchés

Analyse achevée (lots 1 à 7 réalisés, voir « Réalisé »). Restent :

Décisions du 31/10/2026 : `PIED_GLOBAL` gardé (prorata dans le pied de chaque document, somme affichée au pied
global). Lots à venir :

- [x] Imputation d'un avoir ou d'un trop-perçu sur une facture (partie document faite le 31/10/2026 : onglet Règlements, éditions, reste à payer) : écritures avec le module Comptabilité complet.