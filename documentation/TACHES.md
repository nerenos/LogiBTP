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

- [ ] Documents, lots A à C : `modules/document/db/019f` et `modules/bibliotheque/db/063` appliqués aux deux bases, fiche
  `element` et vues d'éléments mises à jour, postes de démonstration RG5, PRORATA, REMISE5, FRAISDOS insérés (18/10/2026) ;
  redémarrer l'API (précédents relus, AVANCEMENT_NON_NUMEROTE, changement de numéro, détail `poste` des éléments).
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

- [ ] Évolutions d'octobre 2026 ([conception](conception/CONCEPTION-DOCUMENTS-EVOLUTIONS.md)) : lot A corrections
  fait le 18/10/2026 (Entrée, Préc., plan, bouton de mise en forme) ; lot B numérotation fait le 18/10/2026 (facture
  d'avancement précédente numérotée, changement de numéro) ; lot C fait le 18/10/2026 postes de pied (groupes toujours présents, type POSTE_PIED en bibliothèque), lot D
  recharger les prix de la bibliothèque, lot E textes d'introduction et de conclusion, lot F adresse des travaux.
- [ ] Écran de récupération d'une version précédente d'un document (instantanés `his_instantane`, y compris les clés
  de ventilation des frais annexes).
- [ ] Impression et export : ignorer les lignes non éditées (tranches F) ; export et impression du rapport de
  ventilation des frais annexes (au moment des modules Export / Impression).
- [ ] Module Mail : envoi des pièces marquées « à envoyer » (`dge_a_envoyer`), destinataires depuis `v_intervenants`.

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

### Import

- [ ] OptimBTP : décider du sort des champs non repris (heures, poste de travaux, compléments de pied, première page
  et texte de fin…).
- [ ] Rattachement automatique du client à l'annuaire.

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
