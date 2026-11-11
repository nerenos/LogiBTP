# Plan de formation - Documentation utilisateur LogiBTP (HTML)

## 1. Phase d'analyse et compréhension (Semaine 1-2)

### 1.1 Immersion dans le codebase
- [ ] **Lecture complète de CLAUDE.md** - Noter tous les modules, routes, concepts métier
- [ ] **Exploration des projets** :
  - `LogiBTP.Domaine` - Entités BTP (DocumentBtp, DocumentLigneBtp, etc.)
  - `LogiBTP.Calcul` - Moteur de devis (MoteurDevisBtp, modèles de calcul)
  - `LogiBTP.Api` - Point d'entrée, branchement modules, Program.cs
- [ ] **Étude des spécialisations BTP** dans `Btp/` :
  - SpecialisationBtp.cs (cœur document/métré)
  - SpecialisationsElements.cs (Fiche, Liste, GED, Bibliothèque)
  - Modules facultatifs : CRM, Authentification, Pointage, Planning, Exécution, Stock, Sous-traitance, Terrain, Comptabilité, etc.

### 1.2 Cartographie fonctionnelle
- [ ] **Lister tous les modules** (obligatoires + facultatifs) avec leurs dépendances
- [ ] **Identifier les personas utilisateurs** : Métreur, Conducteur travaux, Chef chantier, Administrateur, Comptable, Magasinier, etc.
- [ ] **Recenser les parcours métier clés** :
  - Création/devis → Validation → Facturation
  - Planning → Pointage → Exécution
  - Stock → Approvisionnement → Chantier
  - Sous-traitance → Consultation → Marché → Paiement direct
  - Terrain (mobile) : pointage, ordres, réceptions, SAV

### 1.3 Analyse technique pour la doc
- [ ] **Endpoints API** : Extraire depuis `MapModule...()` et routes propres au cœur
- [ ] **Modèles de données** : Entités principales + DTOs
- [ ] **Configuration** : appsettings, variables d'environnement, multi-tenant (sociétés)
- [ ] **Installation/Déploiement** : Commandes `installation`, certificats, base de données

---

## 2. Architecture de la documentation (Semaine 2-3)

### 2.1 Structure du site HTML
```
docs/
├── index.html                    # Page d'accueil / Vue d'ensemble
├── getting-started/              # Démarrage
│   ├── installation.md
│   ├── configuration.md
│   ├── premieres-etapes.md
│   └── multi-societe.md
├── guides-utilisateur/           # Par persona/métier
│   ├── metreur/
│   ├── conducteur-travaux/
│   ├── chef-chantier/
│   ├── administrateur/
│   ├── comptable/
│   └── magasinier/
├── modules/                      # Documentation par module
│   ├── document-metre/
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
├── reference-api/                # Référence technique
│   ├── endpoints.md
│   ├── modeles-donnees.md
│   ├── codes-erreurs.md
│   └── conventions.md
├── administration/               # Admin système
│   ├── installation.md
│   ├── maintenance.md
│   ├── sauvegarde.md
│   ├── securite.md
│   └── modules-facultatifs.md
├── developpement/                # Pour devs (optionnel)
│   ├── architecture.md
│   ├── moteur-calcul.md
│   ├── specialisations.md
│   └── tests.md
└── assets/
    ├── css/
    ├── js/
    └── images/
```

### 2.2 Choix technologique
- [ ] **Générateur de site statique** : VitePress / Astro / Docusaurus / MkDocs (recommandé : **VitePress** - Vue, rapide, MD natif)
- [ ] **Thème** : Personnalisé LogiBTP (couleurs BTP, logo)
- [ ] **Recherche** : Algolia DocSearch ou recherche locale (MiniSearch)
- [ ] **Versioning** : Dossiers par version (v1, v2) ou branches git

### 2.3 Standards rédactionnels
- [ ] **Glossaire termes BTP** : Définir (Métré, Ventilation, FA, PMP, Retenue de garantie, etc.)
- [ ] **Conventions** : Captures d'écran (format, annotations), blocs d'info/attention, exemples de code
- [ ] **Nommage** : Cohérence FR/EN, terminologie exacte du code (`DocumentBtp`, `EntIntervenants`, etc.)

---

## 3. Création du contenu - Par modules (Semaine 3-8)

### 3.1 Module Cœur : Document + Métré (Priorité haute)
- [x] Concepts : Document, Lignes, Métrés, Variables, Ventilations, Frais annexes
- [x] Cycle de vie : Brouillon → Validé → Émis → Archivé
- [x] Calcul : Moteur de devis, formules, comparateur, écarts arrondi
- [x] Éditions : Modèles, pieds, sources annexes, dépôt GED
- [x] API : Endpoints document, lignes, métrés, variables, calcul

### 3.2 Module Planning + Pointage (Priorité haute)
- [x] Ressources : Salariés, Intérimaires, Matériels, Sous-traitants, Équipes
- [x] Calendriers : Effectifs, fermetures, journées travaillées
- [x] Pointage terrain : Borne, journée, non-conformités, restaurants
- [x] Liaison Planning → Pointage : Tâches, affectations, jalons
- [x] API : Journees, pointages, équipes, calendriers, restaurants

### 3.3 Module Exécution (Priorité haute)
- [x] Ordres d'exécution : Types (E_OE, E_OI, E_RP...), budget, répartition
- [x] Étapes : Planification, validation, contrôle, délégation
- [x] Atelier / Borne : Validation étapes, pointage borne
- [x] Éditions : Ordres, étapes, avancement
- [x] API : Documents exécution, répartition, types, ressources, atelier

### 3.4 Module Stock (Priorité moyenne)
- [x] Articles : Éléments STOCK, unités, PMP, PA, lots/séries
- [x] Mouvements : Entrée/Sortie/Transfert, valorisation, dotation
- [x] Magasin : Sorties/retours, dotations salarié, renouvellements EPI
- [x] Approvisionnement : Prévisions, commandes fournisseurs
- [x] Borne stock : Sortie/retour terrain, validation responsable
- [x] Inventaire comptable : Écarts, réévaluation PMP
- [x] API : Mouvements, articles, prévisions, magasin, bornes, inventaire

### 3.5 Module Sous-traitance (Priorité moyenne)
- [x] Marchés ST : Sens, nature, garantie, pièces DGE
- [x] Consultations : Lots, offres, comparatif, envoi/relance
- [x] Commandes/Factures ST : Pièces bloquantes, factures reçues, avancement
- [x] Paiement direct : Lien, postes, applicatif
- [x] Retenues : Garantie, libération, cautions
- [x] Assistant : Comparatif, transformation, suivi engagé/réalisé
- [x] API : Consultation, marchés ST, pièces, paiements, retenues

### 3.6 Module Terrain - Application mobile (Priorité moyenne)
- [ ] Vue journalière : Tâches, équipiers, pièces DGE, chantiers
- [ ] Pointage terrain : Saisie libre, équipe, non-conformités
- [ ] Ordres/Étapes : Validation, avancement, photos, non-conformité
- [ ] Réception/Pose : PV, signature, réserves, courriel
- [ ] SAV : Interventions, bon, PV, photos
- [ ] Livraisons/Matériels : BL, pointage matériel, compteurs
- [ ] API : Terrain, étapes, tâches, réceptions, SAV, compléments

### 3.7 Modules transverses (Priorité basse-moyenne)
- [ ] **CRM** : Demandes, projets, fils, documents, rappels
- [ ] **GED + Bibliothèque** : Dépôt, catégories, versions, ressources édition, compositions ouvrage
- [ ] **Annuaire** : Tiers, fusion, intervenants, coordonnées figées
- [ ] **Comptabilité** : Taux TVA, tiers/comptes, export pièces, natures
- [ ] **Éditions** : Sources, modèles, mentions, ressources, dépôt GED
- [ ] **Mail/Notifications** : Canaux, modèles, reconnaissance, alertes
- [ ] **Authentification/Droits** : Comptes, sessions, profils, services
- [ ] **Ressources** : Habilitations, compteurs, entretiens, plans, équipes

### 3.8 Administration & Installation
- [ ] Architecture multi-tenant (sociétés, sous-domaines)
- [ ] Installation : `preparer`, `base creer`, `societe ajouter`, `scripts verifier`
- [ ] Certificats : Autorité LogiBTP, base, HTTPS
- [ ] Sauvegarde/Chiffrement : Clé données, empreintes
- [ ] Modules facultatifs : Activation, dépendances, services
- [ ] Journaux techniques : Niveaux, purge, audit
- [ ] Configuration : .env, societes.json, LOGIBTP_CONFIG

---

## 4. Implémentation technique du site (Semaine 4-5, en parallèle)

### 4.1 Setup VitePress
```bash
npm create vitepress@latest docs -- --template default
cd docs
npm install
npm run dev
```

### 4.2 Configuration personnalisée
- [ ] `vitepress/config.mts` : Navigation, sidebar, thème, search
- [ ] `theme/` : Layout custom, composants (Alert, Tabs, ApiEndpoint)
- [ ] `styles/` : Variables CSS LogiBTP, responsive, print
- [ ] Scripts : `build`, `preview`, `deploy`

### 4.3 Composants réutilisables
- [ ] `<ApiEndpoint>` : Méthode, URL, params, réponse, codes erreur
- [ ] `<DataModel>` : Tableau propriétés, types, description
- [ ] `<Workflow>` : Diagramme Mermaid du cycle de vie
- [ ] `<GlossaryTooltip>` : Terme BTP avec définition
- [ ] `<VersionBadge>` : Version module, disponibilité

### 4.4 Pipeline CI/CD
- [ ] GitHub Actions / GitLab CI : Build + Deploy (GitHub Pages, Netlify, Vercel)
- [ ] Prévisualisation PR : Deploy preview sur chaque PR
- [ ] Vérification liens : `markdown-link-check`
- [ ] Validation HTML : `htmlhint`

---

## 5. Révision, validation, lancement (Semaine 8-9)

### 5.1 Relecture croisée
- [ ] **Relecture technique** : Développeurs valident exactitude code/API
- [ ] **Relecture métier** : Utilisateurs clés valident parcours
- [ ] **Relecture UX** : Navigation, recherche, accessibilité (WCAG AA)

### 5.2 Tests utilisateurs
- [ ] Scénarios : "Je veux créer un devis", "Je veux pointer ma journée", "Je veux valider une réception"
- [ ] Mesure : Temps pour trouver l'info, taux de réussite, satisfaction

### 5.3 Lancement
- [ ] URL production : `https://docs.logibtp.fr` ou `/docs` sur l'app
- [ ] Redirection depuis l'app (bouton Aide/Documentation)
- [ ] Annonce : Release notes, formation équipe support

### 5.4 Maintenance continue
- [ ] **Processus** : Doc-as-code, PR obligatoire pour modif code impactant doc
- [ ] **Rythme** : Mise à jour à chaque release (changelog → doc)
- [ ] **Métriques** : Pages vues, recherches échouées, feedback utilisateur
- [ ] **Révision trimestrielle** : Contenu obsolète, nouveaux modules

---

## 6. Estimation des charges

| Phase | Durée | Ressources |
|-------|-------|------------|
| Analyse + Architecture | 2 sem | 1 Tech Writer + 1 Dev (revue) |
| Setup site + composants | 1 sem | 1 Dev frontend |
| Rédaction modules cœur | 3 sem | 1 Tech Writer + experts métier |
| Rédaction modules avancés | 3 sem | 1 Tech Writer + experts métier |
| Rédaction admin/install | 1 sem | 1 DevOps + Tech Writer |
| Relecture + tests | 1 sem | Équipe projet |
| **Total** | **~11 semaines** | **~1.5 ETP** |

---

## 7. Livrables attendus

1. **Site de documentation HTML** déployé et accessible
2. **Guide de contribution** (`CONTRIBUTING-docs.md`) pour l'équipe
3. **Glossaire BTP** exportable (JSON/CSV) pour réutilisation
4. **Checklist "Doc-ready"** pour les futures PR code
5. **Rapport d'audit** : Couverture doc vs fonctionnalités

---

## 8. Points d'attention spécifiques LogiBTP

| Particularité | Action doc |
|---------------|------------|
| Multi-tenant (sociétés par sous-domaine) | Chapitre dédié + exemples `demo.localhost` |
| Modules facultatifs (dépendances) | Matrice modules + guide activation |
| Moteur de calcul complexe (parité JS/.NET) | Section "Pour les développeurs" + cas de test |
| Conventions snake_case / PascalCase | Tableau de correspondance API ↔ Code |
| Commandes CLI `installation` | Procédures pas-à-pas avec captures |
| Éditions / Modèles d'impression | Galerie visuelle + dictionnaire sources |
| Application terrain (mobile) | Parcours "sur le terrain" avec captures mobile |
| Règles métier (409 codes erreur) | Catalogue codes erreur par module |

---

## 9. Prochaines actions immédiates

1. [x] Valider ce plan avec l'équipe projet
2. [x] Nommer le **Tech Writer** principal (ou désigner un dev volontaire)
3. [x] Créer le repo `docs` / dossier `docs` dans le mono-repo
4. [x] Initialiser VitePress avec config de base
5. [x] Rédiger la **page d'accueil** et **Getting Started** (quick win)
6. [ ] Planifier des **ateliers de 1h par module** avec experts métier

---

*Document vivant - À mettre à jour à chaque sprint de documentation*