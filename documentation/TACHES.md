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

### Import

### Installation

## Interface

## Réalisé (référence)






