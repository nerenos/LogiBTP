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

### Bases existantes à mettre à niveau (`logibtp` et `logibtp_demo`)

- [ ] Fiches, paramétrage étendu : `modules/fiche/db/041` appliqué ; redémarrer l'API (nouveau `.env` lu au démarrage).
- [ ] Métré en script : appliquer `021`, `061` (`ele_longueur`), `165` et le `131` régénéré. **Sauvegarder avant le
  premier démarrage** de l'API : il convertit les métrés en lignes et supprime `metre_ligne` (irréversible).
- [ ] Frais annexes : redémarrer l'API (tables et colonnes de `db/167`, appliqué le 16/10/2026).
- [ ] Comptabilité, décisions du 31/10/2026 : appliquer `modules/bibliotheque/db/066`, `modules/comptabilite/db/094d`,
  `db/247` (clés de ventilation converties en identifiants, `nat_compte_*` retirées, comptes de produit et de charge
  des tiers), puis le `131` régénéré (champs de la fiche personne et genre des postes de pied) ; règlements (lot C) :
  rejouer le `191` régénéré (imputations et reste après imputation dans le bloc des totaux) ; lot D : appliquer
  `db/248` (chantier par ligne, colonne `chantiers` de `v_liste_documents`), rejouer les `150` et `176` régénérés
  (colonne Chantier des vues d'achat ; `ON CONFLICT DO NOTHING` : vues existantes à compléter par le dialogue) ;
  lot E : appliquer `db/249` (« pas d'avancement » des marchés par mois) ; lot F : appliquer
  `modules/reglement/db/081` (anciens pointages de caution retirés : la consommation des cautions est calculée) ;
  lot G1 : appliquer `db/250` (révision des prix : index, formules, paramètres des marchés) puis saisir ou importer les
  valeurs des index utilisés (`/parametres/revision`) ; libellés du catalogue BT à vérifier ; rejouer le `191` régénéré
  (bloc `REVISION_PRIX` des situations et factures d'avancement).
- [ ] Module Rentabilité, lot 7 : rejouer `modules/rentabilite/db/099r` (versions et mois du prévisionnel de
  facturation) puis appliquer `db/263` (clé étrangère) ; donner le nœud « Prévisionnel de facturation »
  (`rentabilite/facturation`, Modifier : enregistrer une version) aux profils concernés dans `/parametres/droits`.
- [ ] Module Rentabilité, lot 6 : rejouer `modules/rentabilite/db/099r` (saisies prévisionnelles et leur journal) puis
  appliquer `db/262` (clés étrangères) ; donner le nœud « Saisies prévisionnelles » (`rentabilite/previsions` : créer,
  modifier, supprimer) aux profils qui saisissent dans `/parametres/droits` (à défaut, hérité du nœud `rentabilite`).
  Aucune nouvelle version des règles : rien n'est recalculé tant qu'aucune saisie n'existe.
- [ ] Module Rentabilité, lot 5 : appliquer `db/261` (coût horaire du matériel, paramètres, triggers ; chantiers ouverts
  remis en file pour la version 5 des règles) et rejouer le `131` régénéré (coût moyen horaire de la fiche matériel) ;
  saisir les coûts horaires par type de matériel et la nature des heures de matériel dans `/parametres/rentabilite`,
  vérifier l'option des intérimaires dans `/parametres/pointage` (non cochée : heures sans coût).
- [ ] Module Rentabilité, lot 4 : appliquer `modules/document/db/019q` (type d'avancement D) puis `db/260` (type
  `V_PRODUCTION`, transformation depuis la commande, droits, rôle PRODUCTION ; chantiers ouverts remis en file pour la
  version 4 des règles), rejouer les `121`, `176` et `191` régénérés (thème de liste Situations, vue des colonnes,
  modèle d'édition) ; vérifier les droits du type « Situation de production » dans `/parametres/droits`.
- [ ] Module Rentabilité, lot 3 : aucun script ; au démarrage de l'API, la version 3 des règles remet en file tous les
  chantiers ouverts (heures du budget, factures d'acompte).
- [ ] Module Rentabilité, lot 2 : rejouer `modules/rentabilite/db/099r` puis appliquer `db/259` (acomptes en trésorerie,
  contrôles, photos, vues ; tous les chantiers ouverts sont remis en file pour la version 2 des règles) ; vérifier le
  rôle « Reçu d'acompte » dans `/parametres/rentabilite`.
- [ ] Module Rentabilité, lot 1 : appliquer `modules/rentabilite/db/099r` et `db/258`, activer le module dans
  `/parametres/modules`, vérifier les rôles des types et saisir les taux horaires des services dans
  `/parametres/rentabilite` ; le premier passage du planificateur calcule tous les chantiers ouverts.
- [ ] Module Rentabilité, lot 0 : appliquer `modules/document/db/019p`, `db/255`, `db/256`, `db/257` et le `131`
  régénéré (chargé d'affaires de la fiche affaire), puis choisir le chargé d'affaires des affaires et projets listés par
  `v_responsables_a_reprendre`. Les pièces validées avec une unité sans conversion (stock, lignes transformées) restent
  telles quelles ; seules les nouvelles validations sont contrôlées.
- [ ] GED : `modules/ged/db/051` appliqué ; après redémarrage de l'API, indexer les documents déposés avant
  (`POST /api/ged/indexation`, administrateur, lots de 200).
- [ ] Données de démonstration : corriger les documents VALIDE → ENVOYE et les devis ACCEPTE → VALIDE (statuts de la
  chaîne ENVOYE / VALIDE), sans script de reprise (base de développement).
- [ ] Documents d'essai créés pendant le développement dans `logibtp_demo` (commandes CC2026-00003…7, marché
  M-2026-005-1, BL, factures et avoirs d'avancement, situations). La facture d'avancement SI2026-00002 (validée avant
  le lot 6b) n'a pas de numéro de situation.
- [ ] Groupes de démonstration (`db/131`) absents des bases existantes (régénéré, non rejoué).
- [ ] Rapport de ventilation des frais annexes : rejouer le `191` régénéré (modèle d'édition interne `FRAIS_ANNEXES`).
- [ ] Colonne Livraison des commandes et vue Réservation : `db/176` (`ON CONFLICT DO NOTHING`) ne change pas les vues déjà présentes ; retrait de la colonne Révision du matériel : `db/121` et `db/131` à rejouer ; colonne `mat_heures_revision` gardée en base.

## Fonctionnel

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
  hebdomadaire signé (Pointage M21), relances des devis et factures (CRM C27) ; double authentification par courriel.
- [ ] Création d'un tiers provisoire depuis l'expéditeur d'un courriel reçu ; transfert d'un reçu à un service.
- [ ] Lot 5 : relances par courriel (CRM C27, avec le module Règlements) : voir « Relances » (Marchés et règlements).
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

- [ ] Relances des devis et des factures : plan [relances.md](plans/relances.md) (neuf lots, décisions du 08/11/2026 dans
  [relances-questions.md](plans/relances-questions.md) ; analyse [ANALYSE-RELANCES.md](documentation/conception/ANALYSE-RELANCES.md) ;
  comprend le lot 5 du module Mail et C27 du CRM). Lot 1 fait (08/11/2026 : module `modules/relance`, règle des niveaux
  et calcul des relances dues `regles.js` ↔ `ReglesRelance.cs`) ; lot 2 fait (08/11/2026 : `modules/relance/db/099t`,
  `LogiBTP.Relances.Web` : lots préparés et validés, journal, suspensions, routes `/api/relances…` non encore branchées) ; lot 3 fait (08/11/2026 : écrans `modules/relance/js/ui`, liste de travail, règle, suspensions ; mode préféré du tiers sans effet sur un niveau RECOMMANDE) ;
  suivant : lot 4 (branchement du cœur).

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
- [ ] Lot 7, suites : bibliothèque simplifiée sur le terrain (T18) ; heures de matériel non valorisées dans le coût du
  chantier (aucun coût horaire du matériel) ; pointage et relevés de matériel à la borne ; réception d'une commande à options
  ou variantes (refusée) ; avancement réel par marché quand un chantier en porte plusieurs (aujourd'hui : tout le chantier).
- [ ] Lot 6, suites : temps et fournitures du bon de SAV non repris dans la facture (facture = transformation au bureau) ;
  création d'une intervention impossible hors ligne ; chantier « Entretien et dépannage » créé sans passer par le chrono
  des chantiers (code `SAV-<client>`) ; contrats d'entretien (Exécution, second temps).

### Import

- [ ] OptimBTP : décider du sort des champs non repris (heures, poste de travaux, compléments de pied, première page
  et texte de fin…).
- [ ] Rattachement automatique du client à l'annuaire.

### Installation

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
- [ ] Module Rentabilité (ex « Analyse », suivi économique des chantiers) : analyse validée le 01/11/2026
  ([ANALYSE-MODULE-ANALYSE.md](documentation/conception/ANALYSE-MODULE-ANALYSE.md)), lot 0 réalisé (périmètre unique
  des pièces, chargé d'affaires en individu, chantiers d'une pièce, garde-fou des unités), lot 1 réalisé (faits
  versionnés, file, nuit, Détail, faits, rapprochement, rôles des types paramétrés), lot 2 réalisé (Liste
  multi-origine, période, vues, acomptes en trésorerie, contrôles et changements, photos), lot 3 réalisé (bloc de résultats PV, heures MO), lot 4 réalisé (situation de production, colonnes croisées,
  préchargement, production, FAE / PCA) ; lot 5 réalisé (coût horaire du matériel, matériel pointé et planifié, option des
  intérimaires) ; lot 6 réalisé (saisies prévisionnelles : faits PREVU_* à part du réel, solde proposé ou manuel,
  échues signalées, journal ; Prévisionnel à terminaison) ; lot 7 réalisé (prévisionnel de facturation par chantier et par mois,
  versions comparées au facturé, atterrissage, Liste chantiers × mois) ; lot 8 réalisé (graphiques d'évolution du Détail
  depuis les photos : budget, facturé, dépensé, coût et marge à terminaison) : module terminé selon le découpage. Plus
  tard (Q17) : historique du chargé d'affaires d'une affaire et d'un chantier (aujourd'hui seul le chargé d'affaires
  actuel compte, sur toute la période). Simplifications du lot 1 à revoir :
  - PV ventilé sur les feuilles d'un ouvrage au prorata du PR (à défaut du PA, sinon à parts égales), l'analyse parlant
    du prix client ;
  - engagé planifié : prorata calendaire des tâches, daté du jour (seuls faits exclus de la comparaison de nuit) ;
  - ligne de commande reprise par plusieurs ordres : répartie au prorata ; facturé rattaché à l'ordre le plus important ;
  - choix de l'ordre sur les lignes d'achat (R4) non fait : l'ordre d'une pièce d'achat est celui de son entête ;
  - lignes de `rentabilite_calcul` jamais purgées ; suppression d'un lien entre pièces non signalée (rattrapée la nuit) ;
  - chantier qui tient un stock : ses articles de stock ignorés (consommés à la sortie) ;
  - portées EQUIPE et SERVICE du droit `rentabilite` traitées comme SOI (chargé, conducteur, responsable de l'affaire).
  Simplifications du lot 3 à revoir :
  - Réalisé sans postes de pied (seulement les lignes des factures) ;
  - heures du budget : lignes d'une nature du regroupement MO dont l'unité est h, heure ou heures (autres unités sans
    heures) ;
  - postes de pied du Reste à facturer rapprochés par libellé (budget − facturé).
  Simplifications du lot 8 à revoir :
  - courbes du Détail d'un chantier seulement (pas de graphique d'une affaire ni d'un chargé d'affaires) ; un point par
    photo (deux photos du même jour : la plus récente), plus aujourd'hui ; sans photo, pas de courbe ;
  - le prévisionnel de facturation (lot 7) n'est pas encore tracé (facturé prévu par mois face au facturé).
  Simplifications du lot 7 à revoir :
  - prévision par chantier et par mois au global (montant HT ou % du budget PV) : pas encore au détail des lignes du
    marché comme une situation (% / quantité / montant par ligne), ni par marché ;
  - la prévision du mois ne pré-remplit pas encore la situation de « Marchés à facturer » ;
  - % calculé sur le budget PV du moment de l'enregistrement (gardé dans la version) ; facturé comparé = toutes les
    pièces de vente valables du mois (postes et acomptes compris) ;
  - les mois de la Liste suivent la dernière version de chaque chantier (comparaison à une version passée : Détail).
  Simplifications du lot 6 à revoir :
  - solde jamais automatique : une pièce arrivée après la saisie (même chantier, indicateur, composante, nature si
    saisie, tiers si saisi) est seulement proposée ; pas de solde partiel (une facture qui ne couvre qu'une partie de la
    saisie : réduire le montant de la saisie, la solder plus tard) ;
  - saisie soldée : plus aucun fait, même avant la date du solde (le passé tel qu'il était vu reste dans les photos et
    les contrôles) ; saisie échue signalée dans la Liste et le Détail, sans notification ;
  - pas de saisie prévisionnelle d'heures ni de postes de pied ; Liste sans colonnes « prévu » (Détail seulement).
  Simplifications du lot 2 à revoir :
  - acomptes en trésorerie au niveau du chantier (sans ordre ni nature), TTC ; un acompte payé sans module Règlements
    est daté du reçu validé ;
  - colonnes de la Liste fixes (pas de choix de colonnes dans les vues) ; les rapports (% dépensé, % facturé) sont au
    cumul même en période ;
  - photos jamais purgées ; une photo référence un calcul, toute purge des faits devra garder ceux qu'elle voit.
  Simplifications du lot 4 à revoir :
  - précédent d'une situation de production = dernière pièce facturée (comme la situation de travaux), pas la
    production précédente ; production sans postes de pied (lignes vendues seules) ;
  - colonnes croisées : quantité, % et montant cumulés de l'autre situation, sans colonne d'écart en période ;
  - onglet Gestion du marché sans les situations de production ; édition par le modèle de la situation de travaux.
  Simplifications du lot 5 à revoir :
  - coût horaire du matériel non daté (R9) ; matériel loué = loueur renseigné et location non terminée à la date ;
  - tâche affectée seulement à du matériel : pas de main-d'œuvre théorique (comme une tâche affectée à des intérimaires) ;
  - intérimaires valorisés : coût du pointage s'il est valorisé, sinon taux de la mission à la date (pas de taux moyen).
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

- [x] « Ne plus utiliser » (db/228) : fiches à N écartées des choix de nouvelle saisie (annuaire, bibliothèque, planning, pointage, magasin ; plan ne-plus-utiliser-tva lots 1 à 4).
- [x] Fournisseur « TVA intracommunautaire » (db/229) : catégorie de TVA autoliquidée par défaut sur les nouvelles lignes d'achat (lot 5) et avertissement à la validation (lot 6) du plan ne-plus-utiliser-tva ; type de tiers FE à reprendre par le futur module Facturation électronique.
- [ ] Sécurité de la base (lot 11 réalisé) : `MettreAJour-LogiBTP.ps1` pourrait relancer la préparation et redémarrer la base quand la connexion n'est pas chiffrée (aujourd'hui : relancer l'installeur) ; renouvellement du certificat de la base dans la tâche planifiée (aujourd'hui : à chaque préparation, 60 jours avant l'échéance ; certificat de 730 jours). Lot 1 du plan securite-base-suites fait (commande `certificat base-renouveler`, code 10) ; lot 2 (Windows) fait (mise à jour et tâche « LogiBTP - certificat » ; essais manuels à faire sur une installation de développement) ; lot 3 (Linux) fait (essais manuels à faire sur une installation de développement).
- [ ] Restaurants (lot 10 réalisé) : carte des restaurants abandonnée (RO3) au profit de la liste `/pointage/restaurants` avec lien d'itinéraire (plan restaurants-suites, lot 5, fait) ; repas d'équipe à la borne et liste des repas d'une période faits (lots 1 à 4).
- [ ] Documents (lot 9 réalisé) : (fait le 08/11/2026 : reconnaissance des accusés de réception reçus par courriel, plan ar-courriel lots 1 à 4, livraison confirmée proposée dans la boîte de réception ; date de livraison par ligne modifiable sur une commande validée, PUT /api/structure/documents/{id}/lignes/{ligId}/livraison).
- [ ] Tarifs fournisseurs (lot 8 réalisé) : formats d'import personnalisés (module Import : correspondance de colonnes enregistrée par fournisseur), remises par famille d'articles et catalogues, unités synonymes à l'import (A18b).
- [x] Projet (lot 6) : zone de déplacement du projet reprise par le chantier ouvert depuis le projet (fait le 08/11/2026, db/278 : zone estimée du chantier ; les zones validées par agence restent celles du Pointage).
- [ ] Matériel (lot 5c réalisé) : import des cartes carburant (fait : lecture, rapprochement, écriture et page `/import/carburant`, plan materiel-suites lots 9-10b) ; relevés de compteurs saisis à la borne (fait, plan materiel-suites lots 3-4 ; écran de validation au bureau fait, plan materiel-suites lot 4b : `/ressources/releves-a-valider`) ; données de démonstration d'entretiens (aujourd'hui tous en retard faute d'historique).
- [ ] Refacturation interne du matériel (M4 du lot 5c) : les heures pointées et planifiées sont valorisées sur les chantiers où il travaille (module Rentabilité, lot 5) ; chantier de suivi crédité (produit interne, lot 7 du plan materiel-suites)  ; coût par heure de l'onglet Coûts repris comme coût moyen de la fiche sur action (fait, plan materiel-suites, lot 8).

## Interface

### Ergonomie ([analyse du 31/10/2026](documentation/conception/ANALYSE-ERGONOMIE.md), décisions Q1–Q16 prises)

- [ ] Barres d'outils (suite de E1) : débordement replié dans un menu « ⋯ » en petite largeur (aujourd'hui : retour à
  la ligne des groupes).
- [ ] Matériel : photo de l'état au départ et au retour d'une affectation : fait (plan materiel-suites, lots 1 et 2), à passer dans TACHES.md par un humain.
- [ ] Choix en liste (I1, suite) : sélection multiple faite pour les destinataires du courriel d'une pièce (lot 8) ; reste la
  diffusion GED et les autres écrans, qui suivent le même appel (`choisirDestinataires`).
- [ ] Champs mois (`<input type="month">`, 13 écrans) : même saisie abrégée que les dates, à étudier.
### Personnalisation (textes, thème, images — [analyse](documentation/conception/ANALYSE-MODULE-PERSONNALISATION.md))

Lots P1 (module, chargement, socle et navigation migrés), P2 (erreurs par code), P3a (Pointage), P3b (module Document), P3c (page document du cœur), P3d (module Liste), P3e (module Fiche), P3f (module GED), P3g (module Annuaire), P3h (module Bibliothèque), P3i (module CRM), P3j (module Mail), P3k (module Planning), P3l (module Stock), P3m (module Exécution), P3n (module Sous-traitance), P3o (module Comptabilité), P3p (module Calendrier), P3q (module Métré), P3r (module Édition), P3s (module Import), P3t (modules Authentification et Droits), P3u (modules OAuth et Notifications), P3v (navigation du cœur), P3w (fiches du cœur), P3x (structure, documents et hors ligne), P3y (ressources et terrain), P3z (analyse, frais annexes et bibliothèque du cœur), P3aa (pages de paramétrage et pages générales) et P3ab (écrans de la révision des prix et des règlements) faits. Suites, dans l'ordre de l'analyse (§ 7.1) :

- [ ] **Erreurs par code, suite de P2** (P2 fait : 237 codes sûrs au dictionnaire, § 13 de l'analyse) : 258 codes gardent
  le message du serveur (messages composés, plusieurs messages pour un code, codes employés ailleurs) ; les rendre sûrs
  au fil des lots par module (valeurs dans `details` et `{{nom}}`, ou un code par message), puis
  `npm run extraire-erreurs --workspace client`.
- [ ] **P3… — un lot par module puis par zone du cœur** : textes, icônes (`icone()`, `images/icones.json`) et couleurs en
  dur (variables du thème). P3a Pointage fait (§ 14 de l'analyse : règles du module par `textesParCode`, pages pointage
  et borne, congés, repas, titres des routes, styles) ; P3b module Document fait (§ 15 : éditeur, panneaux, vues, plan,
  notifications, `document.css`) ; P3c page document du cœur fait (§ 16 : page, `PanneauxBtp`, `EditeurDevisBtp` ; restent
  les fichiers qu'ils appellent : structure, adresses, sous-traitance, analyse, contrôles de saisie, hors ligne) ; P3d module Liste fait (§ 17 : règles, liste, concepteur, menu de filtre, thèmes, `liste.css`) ; P3e module Fiche fait (§ 18 : validation, chrono, fournisseur, fiche, paramétrage, `fiche.css`) ; P3f module GED fait (§ 19 : fournisseur, explorateur, dépôt, aperçu, règles, `ged.css`) ; P3g module Annuaire fait (§ 20 : coordonnées, identifiants, fournisseur, rattachements, liens, tiers provisoires, référentiels, graphe) ; P3h module Bibliothèque fait (§ 21 : tables de libellés, fournisseur, arbres, onglets de la fiche, paramétrage) ; P3i module CRM fait (§ 22 : règles du module, écrans du cœur `crm_btp.*` : suivi, fil, notes, demandes, plans, bordereaux, rappels, paramétrage) ; P3j module Mail fait (§ 23 : boîte, rédaction, détail, suivi des envois, paramétrage `mail_btp.*`) ; P3k module Planning fait (§ 24 : règles et vue du module, thème `--pla-*`, écrans du cœur `planning_btp.*` : page du planning, panneau, ressources, équipes, paramètres, prototype) ; P3l module Stock fait (§ 25 : messages de l'inventaire et méthodes de valorisation du module, écrans du cœur `stock_btp.*` : état, article, paramètres, marquage, inventaires, approvisionnement, projection, magasin, dotations, saisies à valider, fiche de dotation ; couleurs `--stock-*`) ; P3m module Exécution fait (§ 26 : natures et unités des étapes, états des services, messages des contrôles, écran tactile des étapes du module ; écrans du cœur `execution_btp.*` : synthèse, vue d'un chantier, modèles de parcours, catalogue et états des types, panneau Exécution d'un ordre, tableau des étapes, répartition ; couleurs `--exe-*` et `--execution-*`) ; P3n module Sous-traitance fait (§ 27 : états des pièces et des demandes de paiement direct, actions bloquées, portées, messages du module ; écrans du cœur `sous_traitance_btp.*` : onglets Pièces et Paiements, retenue de garantie, assistant Sous-traiter, marché de sous-traitance d'une commande, pièces exigées, comparatif des offres ; couleurs `--sous-traitance-*`) ; P3o module Comptabilité fait (§ 28 : messages des comptes et de la ventilation, étapes de la règle de ventilation ; écrans du cœur `comptabilite_btp.*` : plan comptable, tiers par compte, paramètres, collectifs, types comptables et de documents, catégories et taux de TVA, ventilation, export des écritures) ; P3p module Calendrier fait (§ 29 : règles des jours fériés, jours de la semaine, messages des contrôles ; page `/parametres/calendriers` : `calendrier_btp.*`) ; P3q module Métré fait (§ 30 : messages du langage de script — lexeur, analyseur, interpréteur, fonctions, portées —, panneau de métré, éditeur, dictionnaire et notifications ; fonction `Conditionnements` du cœur) ; P3r module Édition fait (§ 31 : alertes et messages du moteur, libellés imprimés par défaut, aide du langage ; aperçu, éditeur du modèle, dictionnaire et paramétrage `edition_btp.*` ; restent les modèles fournis `editions/modeles.js`, données système) ; P3s module Import fait (§ 32 : erreurs du zip et du XML, sorts et motifs des champs `CHAMPS_*`, avertissements de la conversion OptimBTP ; page d'import, devis à vérifier, rapport `import_btp.*`) ; P3t modules Authentification et Droits faits (§ 33 : états, messages des règles, actions et portées ; connexion, Mon compte, comptes utilisateurs, profils et droits `authentification_btp.*` / `droits_btp.*`) ; P3u modules OAuth et Notifications faits (§ 34 : connexions externes, boîte et préférences de notification, cloche du bandeau `oauth_btp.*` / `notifications_btp.*`) ; P3v navigation du cœur faite (§ 35 : menus, widgets, raccourcis, bandeau `navigation_btp.*` ; définitions des fiches, vues et données de démonstration rangées avec les données système) ; P3w fiches du cœur faites (§ 36 : `fiches.js`, `fiche-element.js`, `fiche-annuaire.js`, `fiche-structure.js`, textes `fiches_btp.*`) ; P3x structure, documents et hors ligne faits (§ 37 : `structure/*`, transformation, sources, traçabilité, avertissements, page des règlements, page de fusion, `hors-ligne/*`) ; P3y ressources et terrain faits (§ 38 : `ressources/*`, pages du référentiel et des habilitations, `terrain/*`, pages Mon terrain, réception de pose et intervention SAV) ; P3z analyse, frais annexes et bibliothèque du cœur faits (§ 39 : onglet Analyse, calculs de l'analyse, frais annexes et leur rapport, appel et envoi de la bibliothèque, tarifs fournisseur et leur import, onglet Photo / Logo) ; P3aa pages de paramétrage et pages générales faits (§ 40 : Paramètres, documents, installation, raccourcis, services, référentiels, modules, annuaire, société, bibliothèque, GED ; accueil, fiche, introuvable, GED, graphe, liste ; titres des routes ; arborescence de la GED ; paramètres d'une tranche) ; P3ab écrans de la révision des prix et des règlements faits (§ 41 : index et formules, onglet Révision du marché, marchés à facturer du mois, onglet Règlements du document, colonne Chantier des lignes). Suivants :
  modules suivants (écrans restants signalés par la recherche des textes en dur), menus
  (`navigation/menus.js`), pages du cœur ; liste de contrôle d'un fichier par `extraire` du module Personnalisation.
- [ ] **Données système en base** (§ 8) : libellés `donnees.<table>.<code>.<colonne>` appliqués par le serveur
  (`installation personnalisation appliquer`, démarrage, mise à jour) sans écraser une valeur modifiée par la société
  (table `personnalisation_applique`).
- [ ] **Serveur** : notifications, courriels automatiques, éditions (Jint : `initialiserDictionnaire`) et messages
  d'exception lus par `Dictionnaire.cs`.
- [ ] **Phase 2** (§ 9) : stockage par base, génération des fichiers par société, page `/parametres/personnalisation`,
  repérage des clés à l'écran en mode débogage.
- [ ] **Emojis par shortcode** (§ 42 : `:nom:` → image fixe de `images/emojis.json`, remplacement automatique du DOM fait,
  exemples `casque`, `valide`, `attention`) : compléter le catalogue et les images, remplacer les emojis Unicode des
  textes et des icônes, sélecteur dans les zones de saisie, éditions PDF et courriels côté serveur.
- [ ] Images de l'application à ajouter au répertoire : icônes PNG 192 / 512 de la PWA, logo de la page de connexion et de
  la borne.

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

## Démonstration sur Vercel ([guide](documentation/DEPLOIEMENT-VERCEL.md))

- [ ] **Mise en ligne** (côté utilisateur) : base Neon, initialisation (`scripts/demo/initialiser-base-demo.sh`),
  compte des visiteurs, projet Vercel et variables ; services et Container Runtime de Vercel en bêta : premier
  déploiement à vérifier (aiguillage `/documentation/`, en-têtes `X-Forwarded-*` reçus par le conteneur).
- [ ] Séparer les données de démonstration des données de référence du manifeste (une base de démonstration
  aujourd'hui = toute base neuve).
- [ ] Remise à zéro automatique des données de la démonstration (branche Neon remise à zéro chaque nuit).
