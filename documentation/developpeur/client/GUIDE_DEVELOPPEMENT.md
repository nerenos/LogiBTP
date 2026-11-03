# Guide Développement Client

> **Setup, commandes, debug, contribution** — Tout pour être productif dès le premier jour

---

## 🚀 Installation & Démarrage

### Prérequis
| Outil | Version | Installation |
|-------|---------|--------------|
| **Node.js** | 20+ (LTS) | `nvm install 20` ou téléchargement officiel |
| **npm** | 10+ | Inclus avec Node.js |
| **Docker Desktop** | Dernier | Pour PostgreSQL 17 |
| **Git** | 2.40+ | `git --version` |
| **VS Code** | Dernier | Extensions recommandées ci-dessous |

### Extensions VS Code recommandées
```json
// .vscode/extensions.json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense",
    "ms-playwright.playwright",
    "vitest.explorer"
  ]
}
```

### Installation complète
```bash
# 1. Cloner le repo
git clone https://github.com/logibtp/logibtp.git
cd logibtp

# 2. Installer TOUTES les dépendances (workspaces npm)
npm install

# 3. Démarrer PostgreSQL (port 5433)
docker compose up -d

# 4. Vérifier que la base est prête
docker compose logs postgres | grep "database system is ready to accept connections"

# 5. Lancer l'API (terminal 1)
dotnet run --project src/LogiBTP.Api --launch-profile http
# → http://localhost:5080 (API)

# 6. Lancer le client (terminal 2)
npm run dev
# → http://localhost:5173 (Client)
# → http://demo.localhost:5173 (Société démo)
```

---

## 🛠️ Commandes quotidiennes

### Client (depuis racine ou `client/`)
| Commande | Description |
|----------|-------------|
| `npm run dev` | Dev server Vite (HMR, proxy API) |
| `npm run build` | Build production dans `client/dist/` |
| `npm run preview` | Aperçu build production |
| `npm test` | Tous les tests Vitest |
| `npm test -- --run <pattern>` | Tests filtrés (ex: `--run analyse-calcul`) |
| `npm run test:coverage` | Tests + rapport couverture |
| `npm run test:watch` | Mode watch (re-run à la sauvegarde) |
| `npm run lint` | ESLint + Prettier check |
| `npm run format` | Prettier --write |
| `npm run generer-vues-liste` | Génère `db/121_listes_parametrage.sql` depuis `vues-liste.js` |
| `npm run exporter-resultats` | Exporte résultats calcul JS pour parité C# |

### Workspaces (modules)
```bash
# Installer deps d'un module seul
npm install --workspace=@logibtp/document

# Tests d'un module
npm test --workspace=@logibtp/metre
npm test --workspace=@logibtp/liste

# Build d'un module
npm run build --workspace=@logibtp/socle
```

### Base de données
```bash
# Appliquer un script SQL à la base principale
docker compose exec -T postgres psql -U logibtp -d logibtp -v ON_ERROR_STOP=1 < db/160_structure.sql

# Appliquer à la base démo
docker compose exec -T postgres psql -U logibtp -d logibtp_demo -v ON_ERROR_STOP=1 < db/160_structure.sql

# Reset complet (ATTENTION : supprime toutes les données)
docker compose down -v && docker compose up -d

# Connexion psql interactive
docker compose exec -it postgres psql -U logibtp -d logibtp
```

---

## 🐛 Debug & Diagnostic

### Debug Client (VS Code)
```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "launch",
      "name": "Debug Client (Chrome)",
      "url": "http://localhost:5173",
      "webRoot": "${workspaceFolder}/client/src",
      "sourceMapPathOverrides": {
        "/src/*": "${workspaceFolder}/client/src/*",
        "/@logibtp/*": "${workspaceFolder}/*/js/src/*"
      }
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests Vitest",
      "program": "${workspaceFolder}/client/node_modules/vitest/vitest.mjs",
      "args": ["run"],
      "cwd": "${workspaceFolder}/client",
      "console": "integratedTerminal"
    }
  ]
}
```

### Outils navigateur
- **React DevTools** : Ne s'applique pas (Vanilla JS)
- **Vue DevTools** : Ne s'applique pas
- **Console** : `app` = instance `Application` globale (`window.__logibtp_app`)
- **Network** : Filtrer `/api/` pour voir les appels
- **Application > Storage** : localStorage, sessionStorage, IndexedDB, Cache Storage
- **Application > Service Workers** : Debug SW, simuler offline

### Logs utiles
```javascript
// Dans la console navigateur
app.magasin.etat                    // État global complet
app.magasin.get('documents.42')     // Document en cache
app.api.get('/api/documents/42')    // Appel API direct
app.moduleActif('planning')         // Vérifier module actif
app.peut('MODIFIER', 'document')    // Vérifier droit

// Activer logs API
localStorage.setItem('debug:api', 'true');
// Puis recharger → logs détaillés dans console
```

### Problèmes courants

| Problème | Cause probable | Solution |
|----------|----------------|----------|
| Page blanche au chargement | Erreur JS non gérée | Console F12, vérifier imports ESM |
| `npm run dev` échoue | Port 5173 occupé | `lsof -ti:5173 | xargs kill` ou changer port dans `vite.config.js` |
| API 404 / CORS | Proxy Vite mal configuré | Vérifier `vite.config.js` → `server.proxy['/api']` |
| Module non trouvé `@logibtp/*` | `npm install` pas fait à la racine | `npm install` à la racine du repo |
| Tests échouent "cas partagés" | Fichiers JSON modifiés sans régénérer | Vérifier `tests/cas/` vs `modules/*/tests/cas/` |
| Base démo inaccessible | `demo.localhost` pas résolu | Ajouter `127.0.0.1 demo.localhost` dans `/etc/hosts` (ou `C:\Windows\System32\drivers\etc\hosts`) |
| Service Worker ne met pas à jour | Cache agressif | DevTools > Application > SW > "Update on reload" |

---

## 🔧 Workflow de contribution

### 1. Créer une branche
```bash
git checkout main
git pull origin main
git checkout -b feat/ma-nouvelle-fonctionnalite
# ou fix/, chore/, docs/, refactor/
```

### 2. Développer
- **Client** : Modifier `client/src/` + tests `client/test/`
- **Module** : Modifier `modules/<nom>/js/src/` + tests `modules/<nom>/test/`
- **Socle** : Modifier `socle/js/src/` + tests `socle/tests/`
- **Toujours** : Ajouter/maj tests unitaires + cas partagés si règle calcul

### 3. Vérifier avant commit
```bash
# Format & Lint
npm run format
npm run lint

# Tests client
npm test

# Si modification calcul : parité JS/C#
npm run exporter-resultats
# Puis côté API (dans autre terminal ou après) :
LOGIBTP_TEST_PG="..." dotnet test LogiBTP.slnx
```

### 4. Commit & Push
```bash
git add -A
git commit -m "feat(client): ajouter panneau X pour Y

- Nouveau composant PanneauX dans client/src/app/
- Intégration dans EditeurDevisBtp
- Tests unitaires + cas partagé tests/cas/xx_nouveau.json
- Parité C# vérifiée"

git push origin feat/ma-nouvelle-fonctionnalite
```

### 5. Pull Request
- **Template** : `.github/pull_request_template.md` (si existe)
- **Reviewers** : Au moins 1 approbation requise
- **Checks** : CI doit passer (tests, lint, build)
- **Merge** : Squash & merge sur `main`

---

## 📝 Conventions de code

### JavaScript / ESM
- **Modules ESM** : `import` / `export` (pas de CommonJS)
- **Nommage** : `camelCase` variables/fonctions, `PascalCase` classes, `UPPER_SNAKE` constantes
- **Fichiers** : `kebab-case.js` (ex: `editeur-btp.js`)
- **Pas de `var`** : `const` par défaut, `let` si réaffectation
- **Async/await** : Préféré aux `.then()`
- **Immer** : Toujours utiliser `produce()` pour modifier l'état

### Composants UI
```javascript
// Pattern standard composant socle
export class MonComposant {
  constructor(options = {}) {
    this.options = { ...DEFAUTS, ...options };
    this.element = null;
    this.abonnements = [];
  }

  rendre() { /* crée this.element */ }
  monter() { /* événements, abonnements */ }
  demonter() { /* nettoyage : this.abonnements.forEach(fn => fn()) */ }
  detruire() { this.demonter(); this.element?.remove(); }
}
```

### CSS
- **Variables CSS** : Utiliser `--couleur-*`, `--espace-*`, `--rayon-*`
- **BEM-like** : `.composant`, `.composant__element`, `.composant--modificateur`
- **Pas de `!important`** (sauf override utilisateur explicite)
- **Mobile first** : Media queries `min-width` uniquement

### Commits (Conventional Commits)
```
feat(client): ajouter filtre avancé dans liste documents
fix(calcul): corriger arrondi TVA autoliquidation
docs(client): mettre à jour guide développement
refactor(ui): extraire composant GrilleLigne
chore(deps): mettre à jour decimal.js v10.6
```

---

## 🔄 Hot Module Replacement (HMR)

Vite gère le HMR nativement pour :
- **Styles CSS** : Injection sans rechargement
- **Modules JS** : Rechargement du module + ré-exécution
- **Composants** : Si le composant gère `monter()`/`demonter()`, l'instance est remplacée

### Limites HMR
- **Magasin global (Immer)** : État conservé, mais abonnements peuvent doubler → `app.magasin.abonnes.clear()` au HMR
- **Service Worker** : Pas de HMR (rechargement page requis)
- **Web Workers** : Rechargement complet

```javascript
// Dans main.js - gestion HMR
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    app.magasin.abonnes.clear();
    app.demonter();
  });
}
```

---

## 📦 Build & Déploiement

### Build production
```bash
npm run build
# → client/dist/ (fichiers hashés, minifiés, gzippés)
```

### Variables d'environnement build
```bash
# .env.production (non commité)
VITE_API_BASE_URL=https://api.logibtp.fr
VITE_SENTRY_DSN=https://xxx@sentry.io/xxx
VITE_VERSION=1.2.3
```

### Docker (image client servie par API)
```dockerfile
# Dans Dockerfile racine (multi-stage)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

---

## 🔗 Liens vers autres docs

| Concept | Documentation |
|---------|---------------|
| Architecture client | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Modules | [MODULES.md](MODULES.md) |
| Navigation | [NAVIGATION.md](NAVIGATION.md) |
| Calcul | [CALCUL.md](CALCUL.md) |
| PWA / Hors-ligne | [PWA_HORS_LIGNE.md](PWA_HORS_LIGNE.md) |
| Tests | [TESTS.md](TESTS.md) |
| API Guide dev | [api/GUIDE_DEVELOPPEMENT.md](../api/GUIDE_DEVELOPPEMENT.md) |
| BDD Guide dev | [bdd/INSTALLATION_MAJ.md](../bdd/INSTALLATION_MAJ.md) |