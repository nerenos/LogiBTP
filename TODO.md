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

### Documents

- [ ] Restauration d'une version et rapport des frais annexes (faits le 05/11/2026) : essai dans le navigateur à faire
  (restaurer puis enregistrer un brouillon, imprimer le rapport `FRAIS_ANNEXES` d'un devis à tranche F) ; une
  restauration enregistrée est tracée comme une modification (pas d'action RESTAURATION dans l'historique).

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
- [ ] **Avant une exposition sur internet** ([analyse des droits, § 10](documentation/conception/ANALYSE-MODULE-DROITS.md)) :
  reste les prérequis DNS et certificat joker dans l'installeur (§ 10.6) et la CSP bloquante posée par le proxy ;
  en-têtes, CSP en rapport, contrôle de l'`Origin`, CORS, débit, proxys (lot 4) et HTML sans script (lot 5) : faits.
- [ ] **Module de partage de fichiers** (auto-hébergé ou kDrive d'Infomaniak) : lien de téléchargement à la place des
  pièces jointes trop lourdes pour un courriel.

### Chaîne des achats et marchés

Analyse achevée (lots 1 à 7 réalisés, voir « Réalisé »). Restent :

Décisions du 31/10/2026 : `PIED_GLOBAL` gardé (prorata dans le pied de chaque document, somme affichée au pied
global). Lots à venir :

- [ ] Imputation d'un avoir ou d'un trop-perçu sur une facture (partie document faite le 31/10/2026 : onglet Règlements,
  éditions, reste à payer) : écritures avec le module Comptabilité complet.

### Marchés et règlements

- [x] Relances des devis et des factures : plan [relances.md](documentation/conception/plans/relances.md) réalisé en neuf lots le 08/11/2026 (décisions dans
  [relances-questions.md](documentation/conception/plans/relances-questions.md) ; analyse [ANALYSE-RELANCES.md](documentation/conception/ANALYSE-RELANCES.md) ;
  le lot 5 du module Mail et C27 du CRM y sont absorbés). Lot 9 : calcul de nuit et notification « N relances à préparer »
  (`SourceRelancesAPreparer`, services de la base par `SpecialisationRelanceNuit`, chaque destinataire compté selon sa portée),
  mode TACHE des devis (tâche du CRM du jour, CRM actif seulement), pastille « relancé N » de la fiche tiers. Ligne laissée
  cochée : à déplacer dans `documentation/TACHES.md` par un humain.
- [ ] Relances, reports du plan : calcul des pénalités de retard pour information (Q13 a : taux à tenir à jour, aujourd'hui
  mentions citées sans calcul) ; pastille « relancé N » dans l'entête des nouvelles pièces (Q17 : touche la page document) ;
  blocage du client (Q17 c : paramétrable, aujourd'hui aucun blocage).
- [ ] Relances, à finir : éditeur de niveaux pour la règle propre d'un tiers (aujourd'hui saisie JSON dans la fiche) ; rôle de
  relance des types de pièces réglable hors de la page Rentabilité ; rejouer `db/121` et `db/191` sur les bases existantes
  (vues de liste et modèles de lettres) ; mode TACHE encore listé par l'écran de la liste de travail quand le CRM est inactif
  (le serveur refuse alors le groupe, `RELANCE_TACHE` : l'écran du module ne reçoit pas la liste des modes admis).
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

Plan en 24 lots : [terrain-suites.md](documentation/conception/plans/terrain-suites.md) (décisions TS1 à TS25 du
08/11/2026 dans [terrain-suites-questions.md](documentation/conception/plans/terrain-suites-questions.md)).

- [x] Lot 1, écarts : bandeau trop large sur un téléphone (gabarit tactile commun avec le lot 2). Fait : plan, lots 5 (bandeau adaptatif) et 6 (menu simplifié du terrain).
  Fait le 08/11/2026 (plan, lots 2 à 4) : plans au dernier indice validé du suivi des validations (CRM) parmi les pièces
  du terrain (T6), case « Terrain » par plan, plans cochés gardés hors ligne dans un budget à part (25 Mo).
- [x] Lot 2, écarts : pointage à la ligne d'ordre (`poi_lig_id`) quand la tâche vient d'une ligne (T8). Fait le 08/11/2026 :
  plan, lot 7 (`db/288`, reprise des pointages existants hors journées validées, à appliquer).
- [ ] Lot 3, suites : photos HEIC converties (le navigateur ne sait pas les réduire). Plan : lot 8, fait le 08/11/2026
  (champs photo `image/jpeg,image/png`) : reste l'essai sur un iPhone par l'utilisateur (photo de l'appareil et de la
  galerie arrivées en JPEG réduit dans la GED) ; échec : le point revient en question (TS8).
- [x] Lot 4, suites : saisie libre hors ligne limitée aux chantiers et ordres déjà lus (journée gardée) ; nouvelle
  recherche d'un ordre par son numéro impossible hors ligne ; envoi des photos gardées sans contrôle de taille avant
  l'envoi (limite de dépôt de la GED). Plan : lots 9 à 12. Fait le 08/11/2026 : lot 9 (chantiers et ordres ouverts du
  service gardés chaque jour, saisie libre sur une journée jamais lue, ordre cherché par son numéro sur l'appareil) et
  lot 10 (numéro inconnu de l'appareil gardé, résolu par le serveur à l'envoi, refus `ORDRE_INCONNU` signalé), lots 11
  et 12 (limite de dépôt de la GED exposée, photos réduites de force ou refusées avant d'être gardées).
- [ ] Lot 5, suites : valeur juridique de la signature simple à faire confirmer (par l'utilisateur, hors code) ; levée
  des réserves suivie (tâche du CRM seulement) ; demande d'approvisionnement en texte libre (articles de la bibliothèque
  à choisir plus tard) ; réception gardée hors ligne horodatée à l'envoi par le serveur. Plan : lots 13 à 18. Fait le
  08/11/2026 : lot 13 (heure de l'appareil gardée avec la réception hors ligne, `db/289`, forme de signature et les deux
  heures sur le PV, `db/191` à rejouer) ; lot 14 (réserves suivies une par une, `db/290`, levée par le serveur).
- [ ] Lot 7, suites : bibliothèque simplifiée sur le terrain (T18) ; pointage des heures de matériel à la borne ;
  réception d'une commande à options ou variantes (refusée) ; avancement réel par marché quand un chantier en porte
  plusieurs (aujourd'hui : tout le chantier). Plan : lots 17 à 21. Déjà faits ailleurs : valorisation des heures de
  matériel (module Rentabilité, lot 5, `db/261`) et relevés de compteurs à la borne
  ([materiel-suites.md](documentation/conception/plans/materiel-suites.md), lots 3 et 4).
- [ ] Lot 6, suites : temps et fournitures du bon de SAV non repris dans la facture (facture = transformation au bureau) ;
  création d'une intervention impossible hors ligne ; chantier « Entretien et dépannage » créé sans passer par le chrono
  des chantiers (code `SAV-<client>`). Plan : lots 22 à 24.
- [ ] Contrats d'entretien (Exécution, second temps) : analyse à part à écrire (`ANALYSE-CONTRATS-ENTRETIEN.md`), hors
  du plan du terrain (TS25).

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


