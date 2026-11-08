# Plan de formation - Documentation utilisateur LogiBTP

Ce document présente la feuille de route globale de la documentation utilisateur et technique de **LogiBTP**.

---

## 1. Phase d'analyse et compréhension (Semaine 1-2)

### 1.1 Immersion dans le codebase
- [x] **Lecture complète de CLAUDE.md** - Noter tous les modules, routes, concepts métier
- [x] **Exploration des projets** :
  - `LogiBTP.Domaine` - Entités BTP (`DocumentBtp`, `DocumentLigneBtp`, etc.)
  - `LogiBTP.Calcul` - Moteur de devis (`MoteurDevisBtp`, modèles de calcul)
  - `LogiBTP.Api` - Point d'entrée, branchement modules, `Program.cs`
- [x] **Étude des spécialisations BTP** dans `Btp/` :
  - `SpecialisationBtp.cs` (cœur document/métré)
  - `SpecialisationsElements.cs` (Fiche, Liste, GED, Bibliothèque)
  - Modules facultatifs : CRM, Authentification, Pointage, Planning, Exécution, Stock, Sous-traitance, Terrain, Comptabilité, etc.

### 1.2 Cartographie fonctionnelle
- [x] **Lister tous les modules** (obligatoires + facultatifs) avec leurs dépendances
- [x] **Identifier les personas utilisateurs** : Métreur, Conducteur travaux, Chef chantier, Administrateur, Comptable, Magasinier, etc.
- [x] **Recenser les parcours métier clés** :
  - Création/devis → Validation → Facturation
  - Planning → Pointage → Exécution
  - Stock → Approvisionnement → Chantier
  - Sous-traitance → Consultation → Marché → Paiement direct
  - Terrain (mobile) : pointage, ordres, réceptions, SAV

### 1.3 Analyse technique pour la doc
- [x] **Endpoints API** : Extraire depuis `MapModule...()` et routes propres au cœur
- [x] **Modèles de données** : Entités principales + DTOs
- [x] **Configuration** : appsettings, variables d'environnement, multi-tenant (sociétés)
- [x] **Installation/Déploiement** : Commandes `installation`, certificats, base de données

---

## 2. Architecture de la documentation (Semaine 2-3)

### 2.1 Structure du site HTML
```
docs/
├── index.md                      # Page d'accueil / Vue d'ensemble
├── getting-started/              # Démarrage
│   ├── index.md                  # Introduction & Prérequis
│   ├── installation.md           # Guide d'installation complet
│   ├── configuration.md          # Fichier .env, secrets & personnalisation
│   ├── multi-societe.md          # Architecture multi-sociétés (une base par société)
│   └── premieres-etapes.md       # Tutoriel Quick Win (Premier devis BTP)
├── guides-utilisateur/           # Par persona/métier (À venir)
│   ├── metreur/
│   ├── conducteur-travaux/
│   ├── chef-chantier/
│   ├── administrateur/
│   ├── comptable/
│   └── magasinier/
├── modules/                      # Documentation par module
│   ├── document/                 # Module Cœur : Document commercial BTP [Fait]
│   ├── metre/                    # Module Métré & Quantités scriptées [Fait]
│   ├── bibliotheque/             # Module Référentiel des prix & Articles [Fait]
│   ├── planning-pointage/
│   ├── execution/
│   ├── stock/
│   ├── sous-traitance/
│   ├── terrain-mobile/
│   ├── crm/
│   ├── ged-bibliotheque/
│   ├── annuaire/
│   ├── comptabilite/
│   └── editions/
└── administration/               # Exploitation & Déploiement
    ├── installation.md
    ├── sauvegarde.md
    └── securite.md
```

---

## 3. Prochaines actions immédiates

1. [x] Valider ce plan avec l'équipe projet
2. [x] Nommer le **Tech Writer** principal
3. [x] Créer le dossier `docs` dans le mono-repo
4. [x] Initialiser VitePress avec configuration personnalisée
5. [x] Rédiger la **page d'accueil** et **Getting Started** (quick win) :
   - [x] `docs/index.md` (Page d'accueil)
   - [x] `docs/getting-started/index.md` (Vue d'ensemble & Prérequis)
   - [x] `docs/getting-started/installation.md` (Modes Dev & Prod)
   - [x] `docs/getting-started/configuration.md` (Secrets & .env)
   - [x] `docs/getting-started/multi-societe.md` (Une base par société)
   - [x] `docs/getting-started/premieres-etapes.md` (Tutoriel Quick Win 15 min)
6. [x] Rédiger les modules Cœur prioritaires :
   - [x] `docs/modules/document/index.md` (Concepts, cycle de vie, calcul miroir, transformations)
   - [x] `docs/modules/metre/index.md` (Langage script, portées $$/$/@@/@, fonctions BTP, CodeMirror 6)
   - [x] `docs/modules/bibliotheque/index.md` (Multi-bibliothèques, cascades de prix, multi-unités, mercuriales)
7. [ ] Planifier des **ateliers de 1h par module** avec experts métier
