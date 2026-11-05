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

### Comptabilité

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
