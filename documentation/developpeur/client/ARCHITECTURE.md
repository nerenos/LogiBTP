# Architecture Client (Frontend)

> **Stack :** Vanilla JS (ESM), Vite 7, CodeMirror 6, Immer, decimal.js
> **Pas de framework UI** (React/Vue/Svelte) — composants maison légers

---

## 📁 Arborescence `client/src/`

```
client/
├── index.html                 # Point d'entrée HTML
├── package.json               # Workspace npm : @logibtp/client
├── vite.config.js             # Config Vite, alias @logibtp/*, proxy API
├── public/                    # Assets statiques (favicon, manifest PWA)
├── dist/                      # Build de production (gitignore)
├── test/                      # Tests Vitest (unitaires + intégration)
└── src/
    ├── main.js                # Bootstrap : Application, routeur, bandeau, SW
    ├── styles.css             # Styles globaux + variables CSS (thème)
    ├── app/                   # Cœur métier BTP (pages, composants, services)
    │   ├── application.js     # Classe Application : services, routeur, fenêtres, notifications
    │   ├── api.js             # Client API (fetch wrapper, gestion erreurs, auth)
    │   ├── navigation/        # Menus, widgets, routeur, gestion fenêtres
    │   ├── pages/             # Pages par fonctionnalité (voir PAGES.md)
    │   ├── calcul/            # Moteur de calcul BTP côté client (voir CALCUL.md)
    │   ├── fiches/            # Système de fiches (définitions, types, droits)
    │   ├── bibliothque/       # Appel/édition bibliothèque
    │   ├── ged/               # GED : explorateur, arborescence, dépôt
    │   ├── import/            # Import devis (formats, vérification, rapport)
    │   ├── hors-ligne/        # Mode démo hors-ligne, sync, fusion
    │   ├── ressources/        # Équipes, compteurs, entretiens, affectations
    │   ├── planning/          # Planning ressources, tâches, charges
    │   ├── pointage/          # Pointage hebdo, bornes, congés, repas
    │   ├── execution/         # Ordres d'exécution, parcours, synthèse
    │   ├── crm/               # Suivi, notes, demandes, validations
    │   ├── stock/             # Magasins, inventaires, approvisionnement
    │   ├── sous-traitance/    # Marchés ST, pièces, factures, réception
    │   ├── structure/         # Projets, affaires, chantiers, marchés, intervenants
    │   ├── annuaire/          # Personnes, individus, coordination
    │   ├── editions/          # Aperçu impressions, modèles
    │   ├── panneau-lateral.js # Panneau ancrable (filtres, arborescences)
    │   ├── panneaux-btp.js    # Panneaux spécifiques BTP (métrage, variables)
    │   ├── regles-btp.js      # Règles de gestion BTP côté client
    │   ├── presse-papiers-btp.js # Copier/coller lignes, métrés, variables
    │   ├── dictionnaire-btp.js # Dictionnaire métré (variables, formules)
    │   └── variables-tranche.js # Variables de tranche (document)
    ├── calcul/                # Moteur de calcul pur (réplique exacte C#)
    │   ├── index.js           # Exports publics
    │   ├── moteur-btp.js      # MoteurDevisBtp (parité avec C#)
    │   ├── colonnes-btp.js    # Définition colonnes BTP (mirror de C#)
    │   ├── controles-btp.js   # Contrôles cohérence (blocages, écarts)
    │   └── fonctions-btp.js   # Fonctions utilitaires calcul
    └── pwa/                   # Progressive Web App
        ├── sw.js              # Service Worker (Workbox-like maison)
        ├── enregistrement.js  # Enregistrement SW, mises à jour
        └── regles.js          # Règles de cache (stratégies par route)
```

---

## 🔧 Pattern Workspace npm

Le projet utilise **npm workspaces** (monorepo) à la racine :

```json
// package.json (racine)
{
  "workspaces": [
    "socle/js",
    "modules/*/js",
    "client"
  ]
}
```

### Packages publiés (interne)

| Package | Path | Description |
|---------|------|-------------|
| `@logibtp/socle` | `socle/js/` | Calcul décimal, expressions, Immer store, composants UI génériques |
| `@logibtp/document` | `modules/document/js/` | Moteur document générique, éditeur, panneaux, règles |
| `@logibtp/metre` | `modules/metre/js/` | Métré, script, conversion, panneau hôte |
| `@logibtp/liste` | `modules/liste/js/` | Listes paginées, filtres, concepteur vues |
| `@logibtp/fiche` | `modules/fiche/js/` | Fiches, verrous, champs confidentiels, pièces jointes |
| `@logibtp/ged` | `modules/ged/js/` | GED, coffre-fort, versions, recherche |
| `@logibtp/bibliotheque` | `modules/bibliotheque/js/` | Éléments, prix, unités, tarifs, composition |
| `@logibtp/annuaire` | `modules/annuaire/js/` | Personnes, individus, graphe |
| `@logibtp/navigation` | `modules/navigation/js/` | Routeur, fenêtres, préférences, bandeau |
| `@logibtp/import` | `modules/import/js/` | Import devis, formats, dépôt |
| `@logibtp/edition` | `modules/edition/js/` | Modèles PDF, polices, QR codes |
| `@logibtp/reglement` | `modules/reglement/js/` | Échéances, règlements, cautions |
| `@logibtp/crm` | `modules/crm/js/` | Notes, rappels, demandes, suivis |
| `@logibtp/authentification` | `modules/authentification/js/` | Connexion, compte, pseudo |
| `@logibtp/droits` | `modules/droits/js/` | Catalogue droits, routes, profils |
| `@logibtp/calendrier` | `modules/calendrier/js/` | Calendriers, fériés, temps travail |
| `@logibtp/notification` | `modules/notification/js/` | Sources notifications, planificateur |
| `@logibtp/oauth` | `modules/oauth/js/` | Connexions sortantes, jetons |
| `@logibtp/mail` | `modules/mail/js/` | Envoi, réception, modèles |
| `@logibtp/execution` | `modules/execution/js/` | Ordres, parcours, budgets |
| `@logibtp/pointage` | `modules/pointage/js/` | Saisie pointage, contrôles, paie |
| `@logibtp/planning` | `modules/planning/js/` | Tâches, ressources, dépendances |
| `@logibtp/stock` | `modules/stock/js/` | Mouvements, lieux, articles |
| `@logibtp/comptabilite` | `modules/comptabilite/js/` | Plan comptable, ventilation, export |

### Chargement dynamique (ESM)

```javascript
// Exemple : chargement conditionnel d'un module facultatif
if (app.moduleActif('planning')) {
  const { VuePlanningBtp } = await import('@logibtp/planning');
  // ...
}
```

---

## ⚡ Bootstrap (`main.js`)

```javascript
// Séquence de démarrage
import { Application } from './app/application.js';
import { enregistrerSW } from './pwa/enregistrement.js';

// 1. Instance unique (singleton via window.__logibtp_app)
const app = new Application({
  // Configuration depuis window.__LOGIBTP_CONFIG__ (injectée par index.html)
  baseUrl: window.__LOGIBTP_CONFIG__.baseUrl,
  societe: window.__LOGIBTP_CONFIG__.societe,
  utilisateur: window.__LOGIBTP_CONFIG__.utilisateur,
  profil: window.__LOGIBTP_CONFIG__.profil,
  modulesActifs: window.__LOGIBTP_CONFIG__.modulesActifs
});

// 2. Initialisation asynchrone
await app.initialiser();

// 3. Service Worker (PWA)
if ('serviceWorker' in navigator) {
  await enregistrerSW();
}

// 4. Rendu initial (routeur + bandeau + page courante)
app.demarrer();
```

---

## 🎨 Système de styles

- **`styles.css`** : Variables CSS (couleurs, espacements, typographie), reset, utilitaires
- **`socle.css`** (depuis `@logibtp/socle`) : Composants UI (grille, arbre, combo, dialogue, éditeur riche, liste déroulante, raccourcis)
- **Pas de CSS-in-JS** — classes BEM-like, variables CSS pour thème
- **Thème clair/sombre** : Via variable CSS `--theme` (persisté dans localStorage)

---

## 📦 Build & Dev

| Commande | Description |
|----------|-------------|
| `npm run dev` | Vite dev server (HMR, proxy API sur `/api`) |
| `npm run build` | Build production dans `dist/` (minifié, hashés) |
| `npm run preview` | Aperçu build production |
| `npm test` | Vitest (unitaires + intégration) |
| `npm run generer-vues-liste` | Génère `db/121_listes_parametrage.sql` depuis `vues-liste.js` |

### Alias Vite (résolution `@logibtp/*`)

```javascript
// vite.config.js
export default defineConfig({
  resolve: {
    alias: {
      '@logibtp/socle': '/socle/js/src',
      '@logibtp/document': '/modules/document/js/src',
      // ... tous les modules
    }
  },
  server: {
    proxy: { '/api': { target: 'http://localhost:5080', changeOrigin: true } }
  }
});
```

---

## 🔗 Liens transverses

| Concept | Fichier client | Fichier API | Fichier BDD |
|---------|----------------|-------------|-------------|
| Colonnes BTP | `calcul/colonnes-btp.js` | `LogiBTP.Domaine/DocumentLigneBtp.cs` | `db/100_btp.sql` |
| Moteur calcul | `calcul/moteur-btp.js` | `LogiBTP.Calcul/MoteurDevisBtp.cs` | — |
| Métré | `calcul/colonnes-btp.js` + `app/panneaux-btp.js` | `SpecialisationBtp` (métré) | `db/100_btp.sql` (FK) |
| Listes | `app/vues-liste.js` | `SpecialisationListeBtp` | `db/120_listes.sql` + `121_*` |
| Fiches | `app/fiches/definitions.js` | `SpecialisationFicheBtp` | `db/130_fiches.sql` + `131_*` |
| GED | `app/ged/ged.js` | `SpecialisationGedBtp` | `modules/ged/db/050_ged_schema.sql` |

---

## 📝 Prochaines pages à rédiger

- [ ] [MODULES.md](MODULES.md) — Détail modules `@logibtp/*`
- [ ] [NAVIGATION.md](NAVIGATION.md) — Routeur, fenêtres, BroadcastChannel
- [ ] [ETAT_UI.md](ETAT_UI.md) — Immer, signaux, composants UI
- [ ] [CALCUL.md](CALCUL.md) — MoteurDevisBtp JS, parité C#
- [ ] [PAGES.md](PAGES.md) — Inventaire pages par domaine
- [ ] [PWA_HORS_LIGNE.md](PWA_HORS_LIGNE.md) — SW, IndexedDB, sync
- [ ] [TESTS.md](TESTS.md) — Vitest, cas partagés
- [ ] [GUIDE_DEVELOPPEMENT.md](GUIDE_DEVELOPPEMENT.md) — Setup, debug, contrib