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

### Structure des affaires

- [x] **Structure des affaires, phase 1** (`db/160`) : projets, affaires, chantiers, marchés, intervenants.

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

### Import

### Installation

## Interface

## Réalisé (référence)






