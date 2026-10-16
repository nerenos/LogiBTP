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

- [ ] **Module d'installation** : générer et conserver la chaîne de chiffrement de l'installation (aujourd'hui
  `LOGIBTP_CLE_CHIFFREMENT` dans `.env`, générée à la main ; la perdre ou la changer rend illisibles les mots de passe
  des fiches), rotation de clé (rechiffrer les valeurs `chiffre:v1:`).
- [ ] Fiches, paramétrage étendu (16/10/2026) : `modules/fiche/db/041` appliqué à `logibtp` et `logibtp_demo` ; redémarrer
  l'API (nouveau `.env` lu au démarrage). Restent : un mot de passe d'une colonne du programme saisi dans une liste
  (module Liste, saisie en ligne) serait écrit en clair, et les listes affichent la valeur chiffrée d'un champ
  supplémentaire mot de passe (à exclure des colonnes proposées) ; listes par requête SQL indisponibles hors ligne
  (démo : options saisies) ; groupes de démonstration (`db/131`) absents des bases existantes (régénéré, non rejoué).

- [ ] **Métré en script, bases existantes** : appliquer 021 (Métré), 061 (Bibliothèque, `ele_longueur`), 165 et le 131
  régénéré à `logibtp` et `logibtp_demo` ; sauvegarder avant le premier démarrage de l'API, qui convertit les métrés en
  lignes et supprime `metre_ligne` (irréversible).
- [ ] Métré : les variables chaîne et booléen d'un script ne sont pas publiées dans les portées (`Portees` ne stocke
  que des décimaux) ; les fonctions propres à l'hôte (option `fonctions`) ne sont branchées ni aux moteurs ni à l'éditeur.

- [ ] Phase 2 de la structure des affaires : traçabilité des quantités, situations cumulées, transformation partielle,
  déduction du paiement direct.
- [ ] Module Mail : envoi des pièces marquées « à envoyer » (`dge_a_envoyer`), destinataires depuis `v_intervenants`.
- [ ] Gestion de la sous-traitance (montants et agréments du paiement direct).
- [ ] GED, bases existantes : `modules/ged/db/051` déjà appliqué à `logibtp` et `logibtp_demo` (16/10/2026) ; après
  redémarrage de l'API, indexer les documents déposés avant (`POST /api/ged/indexation`, administrateur, lots de 200).
- [ ] GED : revue des fins de conservation (DETRUIRE : purge proposée, jamais pour le coffre-fort) ; l'archivage
  automatique de nuit (`ArchivageGed`) ne voit pas les documents SECRET d'autrui (filtre d'accès de l'utilisateur
  système) ; texte des images (OCR) et des .msg non extrait ; résumé automatique (agent IA local).
- [ ] **Module Comptabilité** : règle définitive du compte comptable des lignes (aujourd'hui provisoire : compte de la
  ligne, sinon de la nature selon la famille du document, sinon du tiers ; à remplacer par `definirRegleCompte` de
  `client/src/app/comptes.js`, côté serveur aussi s'il faut le compte effectif) ; vrai plan de comptes à la place de
  `compte_comptable` (db/166, minimal, sans écran de gestion). Le compte du tiers (`per_cli_compte` / `per_fou_compte`)
  est un compte auxiliaire (411 / 401) : son usage comme compte de produit ou de charge est à confirmer.
- [ ] Vue de colonnes « Complet » des bases existantes : `db/150` (`ON CONFLICT DO NOTHING`) n'y ajoute pas les colonnes
  Compte et Commentaire (à ajouter par le dialogue des colonnes, ou par une mise à jour de `vue_document`).
- [ ] Frais annexes : redémarrer l'API (nouvelles colonnes et tables de `db/167`, appliqué aux deux bases le
  16/10/2026) ; l'envoi vers la bibliothèque d'un ouvrage à PV fixe n'envoie pas son PV (le prix d'un ouvrage de la
  bibliothèque est celui de sa composition) ; les clés de ventilation ne suivent pas un copier-coller de lignes ;
  impression : ignorer les lignes non éditées (tranches F).
- [ ] Écran de récupération d'une version précédente d'un document (instantanés `his_instantane`, y compris les clés
  de ventilation des frais annexes).
- [ ] Export et impression du rapport de ventilation des frais annexes (au moment des modules Export / Impression).
- [ ] Import OptimBTP : décider du sort des champs non repris (heures, poste de travaux, compléments de pied,
  première page et texte de fin…) ; rattachement automatique du client à l'annuaire.

## Interface

- [ ] Remplacer les derniers `<select>` par `creerCombo` : conception des vues de liste, menu de filtre, sélecteurs de
  thème et de vue des listes, profil de démonstration (paramètres).
- [ ] Raccourcis clavier : déclarer aussi les fonctions des fiches, des listes et de la GED (groupes à ajouter avec
  `declarerRaccourcis`) ; les accélérateurs des menus du bandeau (`&Paramètres`) ne sont pas personnalisables ; menu
  contextuel à étendre (fiches, explorateur GED, entête du document).
- [ ] Module Fiche : `AvantSuppressionAsync` n'est surchargé nulle part dans le cœur (contrôles métier avant suppression).
