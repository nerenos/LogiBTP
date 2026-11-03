# Navigation & Routing (Client)

> **Module :** `@logibtp/navigation` — JS seul, pas de composant serveur
> **Fichiers clés :** `modules/navigation/js/src/` + `client/src/app/navigation/` + `client/src/app/application.js`

---

## 🗺️ Routeur (`Routeur`)

### Principes
- **URL par écran** : `/`, `/liste/salaries?vue=2`, `/fiche/salarie/12`, `/document/5`, `/ged/3`, `/parametres`
- **Historique navigateur** natif (API `history.pushState` / `popstate`)
- **Garde avant départ** : détection modifications non sauvegardées (`●` dans le titre)
- **Pages conservées** : instances de pages mises en cache pour retour instantané

### Configuration des routes

```javascript
// modules/navigation/js/src/routeur.js (simplifié)
const routes = [
  { path: '/', page: 'accueil', module: null },
  { path: '/liste/:theme', page: 'liste', module: 'liste' },
  { path: '/fiche/:type/:id', page: 'fiche', module: 'fiche' },
  { path: '/fiche/:type/:id?copie=1', page: 'fiche', module: 'fiche', mode: 'copie' },
  { path: '/document/:id', page: 'document', module: 'document' },
  { path: '/document/import?jeton=:jeton', page: 'import-verification', module: 'import' },
  { path: '/ged/:id?', page: 'ged', module: 'ged' },
  { path: '/execution/:id?', page: 'execution', module: 'execution' },
  { path: '/planning', page: 'planning', module: 'planning' },
  { path: '/pointage', page: 'pointage', module: 'pointage' },
  { path: '/stock', page: 'stock', module: 'stock' },
  { path: '/comptabilite/:section', page: 'comptabilite', module: 'comptabilite' },
  { path: '/crm/:section?', page: 'crm', module: 'crm' },
  { path: '/mail/:section?', page: 'mail', module: 'mail' },
  { path: '/edition/:id?', page: 'edition', module: 'edition' },
  { path: '/parametres/:section?', page: 'parametres', module: null },
  { path: '/connexion', page: 'connexion', module: 'authentification' },
  { path: '/compte', page: 'compte', module: 'authentification' },
  { path: '/borne/:id', page: 'borne', module: 'pointage' },
  { path: '*', page: 'introuvable', module: null }
];
```

### Navigation programmatique

```javascript
// Depuis n'importe où via app (Application)
app.naviguer('/document/42');                    // Même fenêtre
app.naviguer('/document/42', { nouvelleFenetre: true }); // Nouvelle fenêtre
app.naviguer('/liste/salaries', { remplacer: true });      // Remplace l'historique (pas de retour)
```

---

## 🪟 Gestion des fenêtres (`GestionFenetres`)

### Fonctionnalités
- **Fenêtres séparées** : `window.open` avec nom unique (`logibtp_<timestamp>_<random>`)
- **BroadcastChannel** : Canal `logibtp-fenetres` pour communication inter-fenêtres
- **Liste des fenêtres** : Accessible via menu **Fenêtres** (Ctrl+Maj+F)
- **Remise au premier plan** / **Signalement** (🔔 cadre + titre clignotants)
- **Fermeture session** : Vérifie modifications dans TOUTES les fenêtres avant de fermer

### Communication inter-fenêtres

```javascript
// Diffusion événement (ex: après enregistrement document)
app.publier('enregistre', { type: 'document', id: 42, action: 'maj' });

// Écoute dans une autre fenêtre
app.souscrire('enregistre', (data) => {
  if (data.type === 'document' && this.documentId === data.id) {
    this.rafraichir();
  }
});
```

### Restauration de session

1. **À la fermeture** : Sauvegarde état fenêtres dans `sessionStorage` (positions, URLs, tailles)
2. **Au rechargement** : Bouton « Restaurer ma session précédente » sur l'accueil
3. **Réouverture** : `window.open` pour chaque fenêtre (navigateur bloque popups multiples → autorisation requise)
4. **Fallback** : Rouvrir fenêtres bloquées une à une via bouton sur l'accueil

---

## 🧭 Bandeau & Menus (`Bandeau`, `Menus`)

### Structure du bandeau (haut de page, fixe)
```
[Menu Ressources] [Menu Ventes] [Menu Achats] [Menu Documents] [Menu Paramètres] [Menu Fenêtres]  [Société ▼] [Profil ▼] [Logo]
     Alt+R            Alt+V           Alt+A            Alt+D              Alt+P              Alt+F
```

### Raccourcis clavier menus
- **Alt + lettre soulignée** : Ouvre le menu (ex: Alt+R → Ressources)
- **Alt seul** → puis **flèches** : Navigation clavier dans les menus
- **Échap** : Ferme menu / revient à la liste / ferme fiche/document

### Menu Fenêtres (Ctrl+Maj+F)
- Liste toutes les fenêtres de la session (via BroadcastChannel)
- Actions : **Premier plan**, **Signaler** (🔔), **Fermer**, **Fermer la session**

---

## 🏠 Accueil (`AccueilBase`)

### Widgets personnalisables
- **Raccourcis** : Liens vers pages fréquentes (glisser-déposer pour réordonner)
- **Indicateurs** : Chiffres clés (devis en cours, factures à relancer, etc.)
- **Alertes** : Notifications non lues, documents rejetés, validité dépassée
- **Derniers documents** : Accès rapide aux 5 derniers ouverts
- **Répartitions** : Graphiques (CA par client, heures par chantier, etc.)

### Personnalisation (✎ Personnaliser)
- Ajouter / retirer / réordonner (drag & drop) raccourcis et widgets
- Redimensionner widgets (tailles : petit, moyen, grand)
- **Persistance** : `localStorage` par origine (donc par société)

---

## 🔐 Multi-sociétés & Navigation

### Résolution société par sous-domaine
| Environnement | Société principale | Société démo |
|---------------|-------------------|--------------|
| **Dev** | `localhost:5173` | `demo.localhost:5173` |
| **Prod** | `acme.logibtp.fr` | `demo.logibtp.fr` |

### Isolation complète par origine
| Stockage | Portée | Partagé entre sociétés ? |
|----------|--------|--------------------------|
| `localStorage` | Origine (scheme+host+port) | ❌ Non |
| `sessionStorage` | Onglet + origine | ❌ Non |
| `BroadcastChannel` | Origine | ❌ Non |
| `IndexedDB` (PWA) | Origine | ❌ Non |
| Cookies (session) | Domaine + path | ⚠️ Partagé si même domaine racine |

> **Conséquence :** Deux sociétés ouvertes en même temps = deux sessions indépendantes, pas de partage fenêtres/préférences.

---

## 📄 Cycle de vie d'une page (`PageBase`)

```javascript
// client/src/app/pages/index.js - classe de base
class PageBase {
  // 1. Création
  constructor(app, params) { ... }
  
  // 2. Initialisation asynchrone (chargement données)
  async initialiser() { ... }
  
  // 3. Rendu (DOM)
  rendre() { ... }
  
  // 4. Montage (événements, abonnements)
  monter() { ... }
  
  // 5. Démontage (nettoyage)
  demonter() { ... }
  
  // 6. Garde avant départ (retourne true/false ou Promise)
  async peutQuitter() { 
    return !this.aModificationsNonSauvees(); 
  }
  
  // 7. Raccourcis clavier spécifiques à la page
  get raccourcis() { return []; }
}
```

### États de modification
- **Document** : Verrou posé à l'ouverture (sans expiration), ● dans titre
- **Fiche** : Verrou renouvelé 30s, expiration 2min sans battement
- **Liste (saisie)** : Pas de verrou, contrôle empreinte ligne à l'enregistrement (409 si conflit)

---

## ⌨️ Raccourcis globaux (`Raccourcis`)

| Raccourci | Action | Contexte |
|-----------|--------|----------|
| **F1** | Aide / Aide-mémoire | Global |
| **F3** | Recherche bibliothèque (code/libellé) | Document, Fiche élément |
| **F4** | Ouvrir panneau métré | Document (ligne sélectionnée) |
| **F5** | Rafraîchir liste / page | Liste, Document, Fiche |
| **Ctrl+S** | Enregistrer | Document, Fiche |
| **Échap** | Annuler / Fermer / Retour liste | Global |
| **Ctrl+Maj+F** | Menu Fenêtres | Global |
| **Alt + lettre** | Ouvrir menu bandeau | Global |
| **Ctrl+Clic / Maj+Clic / Clic milieu** | Ouvrir dans nouvelle fenêtre | Menus, listes, liens |
| **Ctrl+Roue** | Zoom page | Global |

---

## 🔗 Liens vers autres docs

| Concept | Documentation |
|---------|---------------|
| Architecture globale | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Modules & activation | [MODULES.md](MODULES.md) |
| Pages par module | [PAGES.md](PAGES.md) |
| Calcul & métré dans document | [CALCUL.md](CALCUL.md) |
| Mode hors-ligne / PWA | [PWA_HORS_LIGNE.md](PWA_HORS_LIGNE.md) |
| API Routes correspondantes | [api/ROUTES_API.md](../api/ROUTES_API.md) |
| BDD tables navigation | [bdd/COEUR_BTP.md](../bdd/COEUR_BTP.md) (script 193) |