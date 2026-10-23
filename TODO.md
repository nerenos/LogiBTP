## Base de données

- [ ] **Module de gestion des versions de la base** (après stabilisation du schéma) : numéro de version du schéma
  par base de société, scripts de migration ordonnés et rejouables, application automatique aux bases existantes.
  Aujourd'hui : scripts `modules/*/db` et `db/` appliqués à la création du volume Docker, puis à la main sur `logibtp`
  et `logibtp_demo` ; la plupart ne sont pas rejouables.
- [ ] **Enregistrement des données : uniformiser et sécuriser** : un seul format d'échange et de contrôle par type
  d'écriture, validations serveur systématiques, écritures SQL paramétrées partout (avertissements
  `ExecuteSqlRawAsync` dans `Intervenants.cs`), transactions englobant les champs gérés des fiches
  (`EcrireGeresAsync` est hors de la transaction de la ligne).
- [ ] `f_annuaire_normaliser` utilise encore `unaccent` (ponctuation transformée) : à aligner sur `f_sans_accent`.

### Bases existantes à mettre à niveau (`logibtp` et `logibtp_demo`)

- [ ] Fiches, paramétrage étendu : `modules/fiche/db/041` appliqué ; redémarrer l'API (nouveau `.env` lu au démarrage).
- [ ] Métré en script : appliquer `021`, `061` (`ele_longueur`), `165` et le `131` régénéré. **Sauvegarder avant le
  premier démarrage** de l'API : il convertit les métrés en lignes et supprime `metre_ligne` (irréversible).
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
- [ ] Groupes de démonstration (`db/131`) absents des bases existantes (régénéré, non rejoué).

## Fonctionnel

### Documents

- [ ] Écran de récupération d'une version précédente d'un document (instantanés `his_instantane`, y compris les clés
  de ventilation des frais annexes).
- [ ] Impression et export : ignorer les lignes non éditées (tranches F) ; export et impression du rapport de
  ventilation des frais annexes (au moment des modules Export / Impression).

### Module Mail

Analyses validées le 23/10/2026 : [ANALYSE-MODULE-MAIL.md](documentation/conception/ANALYSE-MODULE-MAIL.md),
[ANALYSE-MODULE-OAUTH.md](documentation/conception/ANALYSE-MODULE-OAUTH.md).

- [ ] Remplir les boîtes de test `LOGIBTP_TEST_MAIL_*` du `.env` (modèle `.env.exemple` : Gmail, Exchange OVH).
- [ ] Essai réel du module OAuth avec la boîte Gmail de test : déclarer l'application Google (adresse de retour
  `http://localhost:5173/api/oauth/retour`), puis 🔗 Se connecter dans `/parametres/connexions`.
- [ ] Essai réel de l'envoi avec les boîtes de test (Gmail en OAuth 2.0, Exchange OVH par mot de passe) : relever les
  quotas réels des hébergeurs et ajuster les limitations par défaut (`Limites.Defaut`).
- [ ] Lots suivants : envois automatiques des autres modules (canal courriel des notifications, mot de passe oublié,
  SAV, relevé du pointage, bordereaux du CRM), réception IMAP (1 h, « Relever maintenant ») et liste « À rapprocher »,
  reconnaissance automatique et alertes.
- [ ] Avant la mise en production : vérification de l'application Google par Google (portée restreinte
  `https://mail.google.com/`), sinon reconnexion des boîtes Gmail tous les 7 jours (mode test) ou mot de passe
  d'application.

### Droits et partage

- [ ] **Module de droits** : droits fins par profil, service et élément ; à reprendre par le Mail (comptes, boîtes,
  « À rapprocher ») et l'OAuth (reconnexion des connexions).
- [ ] **Module de partage de fichiers** (auto-hébergé ou kDrive d'Infomaniak) : lien de téléchargement à la place des
  pièces jointes trop lourdes pour un courriel.

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

### Frais annexes

- [ ] Envoi vers la bibliothèque d'un ouvrage à PV fixe : le PV n'est pas envoyé (le prix d'un ouvrage de la
  bibliothèque est celui de sa composition).
- [ ] Les clés de ventilation ne suivent pas un copier-coller de lignes.

### Métré

- [ ] Les variables chaîne et booléen d'un script ne sont pas publiées dans les portées (`Portees` ne stocke que des
  décimaux).
- [ ] Les fonctions propres à l'hôte (option `fonctions`) ne sont branchées ni aux moteurs ni à l'éditeur.

### Fiches et listes

- [ ] Les listes affichent la valeur chiffrée d'un champ supplémentaire mot de passe (à exclure des colonnes proposées).
- [ ] Listes par requête SQL indisponibles hors ligne (démo : options saisies).
- [ ] Module Fiche : `AvantSuppressionAsync` n'est surchargé nulle part dans le cœur (contrôles métier avant suppression).

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