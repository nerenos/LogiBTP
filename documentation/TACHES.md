# LogiBTP – tâches à faire

> Tâches ouvertes et décisions reportées. À mettre à jour quand une tâche est faite ou reportée (la ligne passe en
> `[x]` avec la date, ou disparaît si elle n'a plus de sens). Analyses et décisions détaillées :
> [documentation/conception/](conception/). Règles de développement : `CLAUDE.md` de chaque dossier.

## Base de données

- [ ] **Module de gestion des versions de la base** (après stabilisation du schéma) : numéro de version du schéma
  par base de société, scripts de migration ordonnés et rejouables, application automatique aux bases existantes.
  Aujourd'hui : scripts `modules/*/db` et `db/` appliqués à la création du volume Docker, puis à la main sur `logibtp`
  et `logibtp_demo` ; la plupart ne sont pas rejouables.
- [ ] **Enregistrement des données : uniformiser et sécuriser** : un seul format d'échange et de contrôle par type
  d'écriture, validations serveur systématiques, écritures SQL paramétrées partout (avertissements
  `ExecuteSqlRawAsync` dans `Intervenants.cs`), transactions englobant les champs gérés des fiches
  (`EcrireGeresAsync` est hors de la transaction de la ligne).

### Bases existantes à mettre à niveau (`logibtp` et `logibtp_demo`)

- [ ] Module CRM : `modules/crm/db/095` à `099` et `db/194` appliqués aux deux bases (21/10/2026) ; redémarrer l'API. L'utilisateur de démonstration `demo` n'est relié à aucun individu (`ind_utilisateur`) : « Mes tâches » et « À prendre » restent vides pour lui (renseigner l'identifiant de connexion d'un individu de notre société).
- [ ] Modules et services : `db/193` appliqué aux deux bases (20/10/2026) ; redémarrer l'API (routes `/api/modules`, `/api/services`, filtre d'activation des Règlements).

- [ ] Éditions : `modules/edition/db/090`, `091`, `db/190`, `191`, `192` appliqués aux deux bases (18/10/2026) ; arrêter et
  relancer l'API (nouveau module, routes `/api/editions`, polices copiées dans la sortie, production en fond). Deux
  éditions d'essai du devis DV2026-00001 rangées en GED de `logibtp` (catégorie edition, hors coffre) : supprimables.

- [ ] Documents, lots A à F : `modules/document/db/019f`, `019g`, `modules/bibliotheque/db/063` et `db/184` appliqués aux
  deux bases, fiches `element` et `chantier` et vues d'éléments mises à jour, postes de démonstration RG5, PRORATA,
  REMISE5, FRAISDOS insérés (18/10/2026) ; redémarrer l'API (précédents relus, AVANCEMENT_NON_NUMEROTE, changement de
  numéro, détail `poste` des éléments, textes des documents, adresse des travaux).
- [ ] Listes des documents : `db/185` appliqué aux deux bases (18/10/2026) ; redémarrer l'API (colonnes des sources en
  cache : N° sit. et Facture / situation restent vides sinon).
- [ ] Tiers provisoires : `modules/annuaire/db/071` et `db/183` appliqués aux deux bases (18/10/2026), vue « Tiers
  provisoires à valider » (19) ajoutée ; les vues de tiers existantes (20 à 24) n'ont pas la colonne Provisoire
  (à ajouter par le concepteur de vue). Redémarrer l'API (routes et `SpecialisationAnnuaireBtp`).
- [ ] Fiches, paramétrage étendu : `modules/fiche/db/041` appliqué ; redémarrer l'API (nouveau `.env` lu au démarrage).
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

## Fonctionnel

### Documents

- [ ] Évolutions d'octobre 2026 ([conception](conception/CONCEPTION-DOCUMENTS-EVOLUTIONS.md)) : faits le 18/10/2026 :
  lot A corrections (Entrée, Préc., plan, bouton de mise en forme), lot B numérotation (facture d'avancement précédente
  numérotée, changement de numéro), lot C postes de pied (groupes toujours présents, type POSTE_PIED en bibliothèque),
  lot D prix rechargés depuis la bibliothèque, lot E textes d'introduction et de conclusion, lot F adresse des
  travaux / de livraison. Reste : impression (placement des textes et des blocs de coordonnées), à faire avec le module
  d'impression.
- [ ] Écran de récupération d'une version précédente d'un document (instantanés `his_instantane`, y compris les clés
  de ventilation des frais annexes).
- [ ] Impression et export : ignorer les lignes non éditées (tranches F) ; export et impression du rapport de
  ventilation des frais annexes (au moment des modules Export / Impression).
- [ ] Module Mail : envoi des pièces marquées « à envoyer » (`dge_a_envoyer`), destinataires depuis `v_intervenants`.

### Édition (impression)

- [ ] **Module Édition** ([conception](conception/CONCEPTION-EDITION.md)) : lots 0 à 6 réalisés le 18/10/2026 (moteur sans
  DOM navigateur + Jint, pagination, modèles et blocs en base, source document, aperçu, impression, production en GED
  et coffre-fort, sous-rapports, import / export, images, fiches, listes, étiquettes ; détail au § 16). Restent : lot 7
  concepteur, production à l'envoi, éditions des vues et procédures spécifiques, chartes éditables à l'écran.
- [ ] Facturation électronique (Factur-X / plateforme agréée) : module à cadrer à part (§ 3.5 de l'analyse).

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

### Fiches et listes

- [ ] Un mot de passe d'une colonne du programme saisi dans une liste (module Liste, saisie en ligne) serait écrit en
  clair.
- [ ] Tiers provisoires : droit de validation et de fusion = profil ADMIN (`PeutValiderTiers`) ; un droit dédié
  (VALIDER_TIERS) dans le paramétrage des fiches reste à décider. Démo hors ligne : `reporterFusion` du fournisseur
  mémoire non branché (pas de documents hors ligne).
- [ ] Listes par requête SQL indisponibles hors ligne (démo : options saisies).

### Structure des affaires

- [ ] Phase 2 : traçabilité des quantités, situations cumulées, transformation partielle, déduction du paiement direct.

### GED

- [ ] Revue des fins de conservation (DETRUIRE : purge proposée, jamais pour le coffre-fort).
- [ ] L'archivage automatique de nuit (`ArchivageGed`) ne voit pas les documents SECRET d'autrui (filtre d'accès de
  l'utilisateur système).
- [ ] Texte des images (OCR) et des .msg non extrait ; résumé automatique (agent IA local).

### Sous-traitance

- [ ] Montants et agréments du paiement direct (gestion de la sous-traitance).
- [ ] **Module Sous-traitance : analyse à faire** (décision C20 du CRM, 20/10/2026) : gestion des marchés de
  sous-traitance (demandes, commandes, suivi par l'ordre de sous-traitance de l'Exécution) et des documents
  obligatoires (attestations, agréments).

### Import

- [ ] OptimBTP : décider du sort des champs non repris (heures, poste de travaux, compléments de pied, première page
  et texte de fin…).
- [ ] Rattachement automatique du client à l'annuaire.

### Nouveaux modules : CRM, Exécution, Planning, Pointage MO

- [ ] Analyses préalables rédigées le 20/10/2026 ([socle commun](conception/ANALYSE-MODULES-TRANSVERSE.md),
  [CRM](conception/ANALYSE-MODULE-CRM.md), [Exécution](conception/ANALYSE-MODULE-EXECUTION.md),
  [Planning](conception/ANALYSE-MODULE-PLANNING.md), [Pointage MO](conception/ANALYSE-MODULE-POINTAGE.md)) : CRM
  C1–C30 décidées (C6 à approfondir, C7 reporté) ; Exécution E1–E24 décidées ; Planning P1–P23 décidés ; M1–M15 à trancher
  (propositions faites). Décisions structurantes à valider : ordres
  d'exécution = documents d'une famille E ; Pointage = variables de paie exportées (pas de calcul de paie) ;
  composant de planning propre ; activation des modules par drapeau (`module_societe`) au lieu de la présence des
  tables.
- [x] **Développement du module CRM, premier temps** (21/10/2026, lots 0 à 5) : activation des modules et services ; notes
  (prise en charge par un service, privées et RGPD, onglet Suivi, courriel glissé) ; rappels (seuils, Mes rappels,
  widget) ; demandes de veille et transformation en projet ; plans, indices, visas, bordereaux et tâches de retour ;
  fil d'actualité. [analyse](conception/ANALYSE-MODULE-CRM.md), [module](../modules/crm/CLAUDE.md)
- [ ] CRM, second temps : pipeline commercial, export iCalendar, miniatures des photos (GED), relances des devis et
  factures (C22, C27 : règle globale et par tiers, liste validée avant l'envoi), notifications poussées et récurrence
  des rappels (planificateur, centre de notifications), module Archivage (C29 : `not_archivee_le`), bordereau par un
  modèle du module Édition et envoi par le module Mail, événements publiés par le cœur (document validé…) dans le fil.
- [ ] Désactivation d'un module = tout masqué, listes comprises (Exécution E24, règle commune) : à appliquer au CRM
  (notes et événements hors des listes et des onglets quand il est désactivé) et aux Règlements (colonnes réglé /
  reste, échéances).
- [ ] CRM, troisième temps : portail tiers, réserves (OPR), comptes rendus de réunion, DOE, assistance IA, journal
  d'appels.
- [ ] Prérequis communs : activation des modules, authentification réelle (en-têtes `X-Utilisateur` aujourd'hui),
  référentiels services / ressources / calendriers (tables `demo_*` à remplacer), centre de notifications, temps réel,
  application mobile hors ligne.

### Archivage

- [ ] **Module Archivage : analyse à faire** (décision C29 du CRM, 20/10/2026) : archivage complet des éléments (tiers
  d'abord : l'Annuaire n'a que `per_actif`), consultation des archives, effets sur les modules (notes du CRM archivées
  avec leur tiers, point d'accroche « élément archivé »), suppression définitive.

### Installation

- [ ] **Module d'installation** : générer et conserver la chaîne de chiffrement de l'installation (aujourd'hui
  `LOGIBTP_CLE_CHIFFREMENT` dans `.env`, générée à la main ; la perdre ou la changer rend illisibles les mots de passe
  des fiches), rotation de clé (rechiffrer les valeurs `chiffre:v1:`).

## Interface

- [ ] Remplacer les derniers `<select>` par `creerCombo` : vues de liste, menu de filtre, sélecteurs de thème et de vue
  des listes, profil de démonstration (paramètres).
- [ ] Raccourcis clavier : déclarer les fonctions des fiches, des listes et de la GED (groupes à ajouter avec
  `declarerRaccourcis`) ; les accélérateurs des menus du bandeau (`&Paramètres`) ne sont pas personnalisables ; menu
  contextuel à étendre (fiches, explorateur GED, entête du document).

## Réalisé (référence)

- [x] **Tâches diverses** (18/10/2026) : `f_annuaire_normaliser` aligné sur `f_sans_accent` (appliqué aux deux
  bases) ; valeurs chiffrées masquées dans les listes ; clés de ventilation recréées au copier-coller ; contrôles avant
  suppression des fiches (`SuppressionFiches`) ; PV fixe des ouvrages de la bibliothèque ; métré : variables chaîne et
  booléen dans les portées, fonctions BTP (`Conditionnements`) aux moteurs et à l'éditeur ; tiers provisoires
  (doublons, validation, fusion avec report des documents) ; bases existantes : métrés déjà convertis, 021 / 061 / 165
  en place, définition de la fiche élément (longueur) et champs supplémentaires de `db/131` complétés sans écraser
  le paramétrage local.
- [x] **Règles des documents** (17/10/2026, six lots) : règles globales, par famille et par type, catalogue R1 à R20,
  cycle de vie ENVOYE / VALIDE, statuts automatiques et de paiement, dévalidation par indice, droits APPROUVER /
  DEVALIDER / FORCER, contrôles de gestion. [conception](conception/CONCEPTION-REGLES-DOCUMENTS.md)
- [x] **Gestion du marché, postes globaux, acomptes, échéances, règlements** (17/10/2026, lots 1 à 5) : onglet
  Gestion de la fiche marché, conditions de paiement et échéancier, postes de pied, acomptes, module Règlements.
  [conception](conception/CONCEPTION-MARCHES-REGLEMENTS.md)
- [x] **Chaîne des achats et gestion des marchés** (16/10/2026, lots 1 à 7) : reste à solder, options et variantes,
  marché et avenants, pieds de section et pied global, plusieurs sources, avancement (situations, factures
  d'avancement, avoir d'avancement, révisions, reprise, déduction), annulation en cascade.
  [conception](conception/CONCEPTION-ACHATS-MARCHES.md)
- [x] **Frais annexes** (16/10/2026) : ventilation par tranches F, clés, rapport de l'onglet Analyse.
  [conception](conception/CONCEPTION-VENTILATION-FRAIS.md)
- [x] **Métré en script** : langage, éditeur, conversion des anciens métrés, notifications.
  [conception](conception/CONCEPTION-SCRIPT.md)
- [x] **Structure des affaires, phase 1** (`db/160`) : projets, affaires, chantiers, marchés, intervenants.
- [x] **GED, coffre-fort et organisation** (16/10/2026) : chaîne du coffre, versions, accès, rétention, classification,
  arborescence.
