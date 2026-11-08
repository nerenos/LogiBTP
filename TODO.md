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

### Marchés et règlements

- [ ] Relances des devis et des factures : analyse du 05/11/2026 à valider
  ([ANALYSE-RELANCES.md](documentation/conception/ANALYSE-RELANCES.md), questions R1 à R18, quatre lots ; comprend le lot 5 du module Mail et C27 du CRM).

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
- [ ] Module Facturation électronique (réception obligatoire depuis le 01/09/2026) à analyser : formats (Factur-X,
  UBL, CII), connexion à la plateforme agréée, commun aux ventes, aux achats et à la sous-traitance ; en attendant,
  saisie libre des factures reçues (ST22).

### Application de terrain (poseurs, chefs d'équipe)

- [ ] Lot 1, écarts : plans au dernier indice validé du suivi des validations (CRM) parmi les pièces du terrain (T6) ;
  bandeau trop large sur un téléphone (gabarit tactile commun avec le lot 2).
- [ ] Lot 2, écarts : pointage à la ligne d'ordre (`poi_lig_id`) quand la tâche vient d'une ligne (T8).
- [ ] Lot 3, suites : photos HEIC converties
  (le navigateur ne sait pas les réduire).
- [ ] Lot 4, suites : saisie libre hors ligne limitée aux chantiers et ordres déjà lus (journée gardée) ; nouvelle
  recherche d'un ordre par son numéro impossible hors ligne ; envoi des photos gardées sans contrôle de taille avant
  l'envoi (limite de dépôt de la GED).
- [ ] Lot 5, suites : valeur juridique de la signature simple à faire confirmer ; levée des réserves suivie (tâche du CRM
  seulement) ; demande d'approvisionnement en texte libre (articles de la bibliothèque à choisir plus tard) ; réception
  gardée hors ligne horodatée à l'envoi par le serveur.
- [x] Lot 7, suites : bibliothèque simplifiée sur le terrain (T18) ; heures de matériel non valorisées dans le coût du
  chantier (aucun coût horaire du matériel) ; pointage et relevés de matériel à la borne ; réception d'une commande à options
  ou variantes (refusée) ; avancement réel par marché quand un chantier en porte plusieurs (aujourd'hui : tout le chantier).
- [ ] Lot 6, suites : temps et fournitures du bon de SAV non repris dans la facture (facture = transformation au bureau) ;
  création d'une intervention impossible hors ligne ; chantier « Entretien et dépannage » créé sans passer par le chrono
  des chantiers (code `SAV-<client>`) ; contrats d'entretien (Exécution, second temps).

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

## Revue du code du 27/10/2026 ([rapport](documentation/REVUE-CODE-2026-10-27.md))

- [ ] Lots A (code mort sûr) et B (code apparemment inutilisé, à trancher) : en attente des évolutions à venir qui
  touchent ce code ; à reprendre ensuite.
- [ ] Liste, périodes : écran de saisie du début d'exercice dans les paramètres de la Comptabilité (aujourd'hui clé `debut_exercice` de `parametre_comptabilite`, sans interface ; absent = année civile).


