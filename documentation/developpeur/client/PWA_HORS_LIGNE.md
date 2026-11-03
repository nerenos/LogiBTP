# PWA & Mode Hors-ligne (Client)

> **Fichiers :** `client/src/pwa/` — Service Worker maison, IndexedDB, synchronisation
> **Démo hors-ligne** : Profil ADMIN/SAISIE dans Paramètres, bouton "Simuler un autre utilisateur"

---

## 📱 Progressive Web App

### Manifest (`public/manifest.json`)
```json
{
  "name": "LogiBTP",
  "short_name": "LogiBTP",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f5f5f5",
  "theme_color": "#2c3e50",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Enregistrement SW (`pwa/enregistrement.js`)
```javascript
// Enregistrement au démarrage (main.js)
if ('serviceWorker' in navigator) {
  const registration = await navigator.serviceWorker.register('/sw.js', {
    scope: '/'
  });
  
  // Gestion mises à jour
  registration.addEventListener('updatefound', () => {
    const newWorker = registration.installing;
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        // Nouvelle version disponible → notifier utilisateur
        app.notifierMiseAJourDisponible();
      }
    });
  });
}
```

---

## ⚙️ Service Worker (`pwa/sw.js`)

### Stratégies de cache (`pwa/regles.js`)
```javascript
export const REGLES_CACHE = [
  // 1. HTML principal → Network First (toujours frais)
  { pattern: /^\/$|\/index\.html$/, strategie: 'network-first' },
  
  // 2. Assets statiques (JS, CSS, fonts) → Cache First (hashés = immuables)
  { pattern: /\.(js|css|woff2?|ttf|png|svg|ico)$/, strategie: 'cache-first' },
  
  // 3. API GET → Stale While Revalidate (offline-first pour lectures)
  { pattern: /^\/api\/(?!.*\/enregistrer|.*\/verrou)/, strategie: 'stale-while-revalidate' },
  
  // 4. API POST/PUT/DELETE → Network Only (jamais en cache)
  { pattern: /^\/api\/.*\/(enregistrer|verrou|supprimer)/, strategie: 'network-only' },
  
  // 5. GED contenus → Cache First (empreinte SHA-256 dans URL = immuable)
  { pattern: /^\/api\/ged\/contenu\//, strategie: 'cache-first' }
];
```

### Cycle de vie SW
```javascript
// Installation : precache assets critiques
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('logibtp-static-v1').then(cache => cache.addAll(ASSETS_CRITIQUES))
  );
  self.skipWaiting();
});

// Activation : nettoyage anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => !k.startsWith('logibtp-')).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch : application stratégies
self.addEventListener('fetch', (event) => {
  const regle = REGLES_CACHE.find(r => r.pattern.test(event.request.url));
  event.respondWith(appliquerStrategie(event.request, regle?.strategie || 'network-first'));
});
```

---

## 💾 IndexedDB (Stockage hors-ligne)

### Schéma (`pwa/idb.js` via `@logibtp/socle/ui/idb.js`)
```javascript
const SCHEMA = {
  version: 3,
  tables: {
    // Documents en attente de synchronisation
    documents_en_attente: { keyPath: 'id', indexes: ['ent_id', 'statut', 'date_modif'] },
    
    // Lignes de documents modifiées hors-ligne
    lignes_modifiees: { keyPath: 'id', indexes: ['lig_ent_id', 'date_modif'] },
    
    // Fiches modifiées hors-ligne
    fiches_modifiees: { keyPath: 'id', indexes: ['type', 'ent_id', 'date_modif'] },
    
    // Cache listes (dernière page chargée)
    cache_listes: { keyPath: 'cle', indexes: ['theme', 'vue', 'page', 'date'] },
    
    // Préférences utilisateur (persistées)
    preferences: { keyPath: 'cle' },
    
    // Queue synchronisation (actions à rejouer)
    sync_queue: { keyPath: 'id', autoIncrement: true, indexes: ['type', 'statut', 'date'] }
  }
};
```

### Utilisation
```javascript
// Ouverture DB
const db = await ouvrirDB('logibtp-offline', SCHEMA);

// Écriture hors-ligne (ex: modification ligne document)
await db.transaction('lignes_modifiees', 'readwrite')
  .objectStore('lignes_modifiees')
  .put({ ...ligne, date_modif: Date.now(), hors_ligne: true });

// Ajout à la queue de sync
await db.transaction('sync_queue', 'readwrite')
  .objectStore('sync_queue')
  .add({ type: 'ligne_document', action: 'modifier', donnees: ligne, date: Date.now() });
```

---

## 🔄 Synchronisation

### Détection connexion
```javascript
// pwa/synchro.js
let enLigne = navigator.onLine;
window.addEventListener('online', () => { enLigne = true; declencherSync(); });
window.addEventListener('offline', () => { enLigne = false; });

// Vérification périodique (toutes les 30s si en ligne)
setInterval(() => {
  if (enLigne && !syncEnCours) declencherSync();
}, 30000);
```

### Processus de synchronisation
```javascript
async function declencherSync() {
  syncEnCours = true;
  
  // 1. Récupérer queue non traitée
  const queue = await db.getAllFromIndex('sync_queue', 'statut', 'en_attente');
  
  for (const item of queue) {
    try {
      // 2. Rejouer l'action sur l'API
      await rejouerAction(item);
      
      // 3. Marquer comme synchronisé
      await db.put('sync_queue', { ...item, statut: 'synced', date_sync: Date.now() });
      
      // 4. Nettoyer cache local correspondant
      await nettoyerCacheLocal(item);
      
    } catch (e) {
      // Erreur → marquer en erreur, réessayer plus tard
      await db.put('sync_queue', { ...item, statut: 'erreur', erreur: e.message });
      if (e.status === 409) {
        // Conflit (empreinte changée) → alerter utilisateur
        app.notifierConflitSync(item);
      }
    }
  }
  
  syncEnCours = false;
}
```

### Gestion des conflits (empreinte)
- **Document** : Verrou serveur → pas de conflit possible (un seul modificateur)
- **Fiche** : Verrou + empreinte → 409 si modifié par autre poste
- **Liste (saisie)** : Contrôle empreinte ligne à l'enregistrement → 409 + réaffichage ligne actuelle

---

## 🎭 Mode Démo Hors-ligne

### Activation
1. **Paramètres** → Profil : **ADMIN** ou **SAISIE**
2. **Fiche** → Bouton **"Simuler un autre utilisateur"**
3. **Liste** → Bouton sous la liste **"Simuler modification autre poste"**

### Comportement
- **Calcul local complet** : `MoteurDevisBtp` JS 100% fonctionnel
- **Pas d'enregistrement serveur** : Toutes les modifications restent en IndexedDB
- **Simulation conflits** : Le bouton "Simuler modification autre poste" modifie l'empreinte en base → prochain enregistrement = 409
- **Pas de verrous réels** : Simulation visuelle seulement

### Code démo (`app/hors-ligne/`)
```javascript
// app/hors-ligne/attente.js — Simulation attente serveur
export const simulerAttente = (ms = 500) => new Promise(r => setTimeout(r, ms));

// app/hors-ligne/operations.js — File opérations locales
const fileOperations = [];
export function ajouterOperation(op) { fileOperations.push(op); }
export async function rejouerOperations() { /* ... */ }

// app/hors-ligne/fusion.js — Fusion modifications locales / serveur
export async function fusionner(local, serveur) {
  // Stratégie : dernier écrit gagne (avec alerte si conflit)
}

// app/hors-ligne/synchro.js — Orchestration sync (voir ci-dessus)
```

---

## 🧪 Tests PWA / Hors-ligne

```bash
# Tests unitaires SW
npm test -- client/test/pwa.test.js

# Tests mode hors-ligne
npm test -- client/test/hors-ligne.test.js

# Test manuel :
# 1. Ouvrir http://localhost:5173
# 2. Ouvrir DevTools > Application > Service Workers > Offline
# 3. Naviguer, modifier un document
# 4. Remettre Online > Vérifier sync
```

---

## 🔗 Liens vers autres docs

| Concept | Documentation |
|---------|---------------|
| Architecture client | [ARCHITECTURE.md](ARCHITECTURE.md) |
| État & IndexedDB | [ETAT_UI.md](ETAT_UI.md) |
| Calcul local | [CALCUL.md](CALCUL.md) |
| API synchronisation | [api/ROUTES_API.md](../api/ROUTES_API.md#sync) |
| BDD tables sync | [bdd/COEUR_BTP.md](../bdd/COEUR_BTP.md) |