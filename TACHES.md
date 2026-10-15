# LogiBTP – tâches à faire

## Base de données

- [ ] **Module de gestion des versions de la base** (après stabilisation du schéma) : numéro de version du schéma
  par base de société, scripts de migration ordonnés et rejouables, application automatique aux bases existantes
  (aujourd'hui : scripts `modules/*/db` et `db/` appliqués à la création du volume Docker, puis à la main sur
  `logibtp` et `logibtp_demo` ; la plupart ne sont pas rejouables).
- [ ] **Enregistrement des données : uniformiser et sécuriser** le transfert d'information (client ↔ API) et le
  stockage : un seul format d'échange et de contrôle par type d'écriture, validations côté serveur systématiques,
  écritures SQL paramétrées partout (ex. avertissements `ExecuteSqlRawAsync` dans `Intervenants.cs`), transactions
  englobant les champs gérés des fiches (`EcrireGeresAsync` hors de la transaction de la ligne).
- [ ] `f_annuaire_normaliser` utilise encore `unaccent` (ponctuation transformée), à aligner sur `f_sans_accent`.

## Fonctionnel

- [ ] Phase 2 de la structure des affaires : traçabilité des quantités, situations cumulées, transformation partielle,
  déduction du paiement direct.
- [ ] Module Mail : envoi des pièces marquées « à envoyer » (`dge_a_envoyer`), destinataires depuis `v_intervenants`.
- [ ] Gestion de la sous-traitance (montants et agréments du paiement direct).
- [ ] Import OptimBTP : décider du sort des champs non repris (heures, poste de travaux, compléments de pied,
  première page et texte de fin…) ; rattachement automatique du client à l'annuaire.

## Interface

- [ ] Remplacer les derniers `<select>` par `creerCombo` : conception des vues de liste, menu de filtre, paramétrage
  des fiches, sélecteurs de thème et de vue des listes.
- [ ] Module Fiche : `AvantSuppressionAsync` n'est surchargé nulle part dans le cœur (contrôles métier avant suppression).
