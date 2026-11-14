# Tests Client (Frontend)

> **Framework :** Vitest 3.x
> **Jeux de cas partagés** : Rejoués par Vitest (JS) et xUnit (C#)
> **Parité JS/C#** : `npm run exporter-resultats && dotnet test`

---

## 🧪 Structure des tests

```text
client/
├── test/                           # Tests unitaires & intégration
│   ├── *.test.js                   # Par module/fonctionnalité
│   ├── setup.js                    # Configuration Vitest (mock API, store)
│   └── helpers/                    # Utilitaires de test
├── src/
│   └── calcul/                     # Tests moteur calcul (voir CALCUL.md)
└── modules/*/test/                 # Tests modules (workspace npm)
```

### Fichiers de test principaux

| Fichier | Module | Description |
|---------|--------|-------------|
| `analyse-calcul.test.js` | Cœur | Scénarios complets calcul devis |
| `cas-partages.test.js` | Cœur | Rejouer `tests/cas/*.json` (parité) |
| `controles-btp.test.js` | Cœur | Contrôles cohérence (blocages, écarts) |
| `ressources.test.js` | Cœur | Habilitations, missions, équipes, affectations, compteurs, entretiens |
| `structure.test.js` | Structure | Projets, affaires, chantiers, marchés, intervenants |
| `adresses.test.js` | Annuaire | Coordonnées, géocodage |
| `bibliotheque-appel.test.js` | Bibliothèque | Appel code, F3, glisser-déposer |
| `bibliotheque-demo.js` | Bibliothèque | Données démo |
| `choix-borne.test.js` | Pointage | Sélection borne badgeuse |
| `codes.test.js` | Socle | Gestion codes (natures, types, etc.) |
| `controles-btp.test.js` | Cœur | Contrôles métier |
| `envoi-bibliotheque.test.js` | Bibliothèque | Envoi lignes vers bibliothèque |
| `fusion.test.js` | Document | Fusion documents |
| `import-devis.test.js` | Import | Import devis, formats, vérification |
| `import-tarifs.test.js` | Bibliothèque | Import tarifs fournisseurs |
| `listes.test.js` | Liste | Pagination, filtres, tris, saisie |
| `menus.test.js` | Navigation | Menus, raccourcis, bandeau |
| `pwa.test.js` | PWA | Service Worker, cache, offline |
| `presse-papiers-btp.test.js` | Document | Copier/coller lignes, métrés, variables |

---

## ⚙️ Configuration Vitest

```javascript
// client/vite.config.js (extrait test)
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/', '**/*.d.ts']
    },
    // Alias pour @logibtp/*
    alias: {
      '@logibtp/socle': '/socle/js/src',
      '@logibtp/document': '/modules/document/js/src',
      // ...
    }
  }
});
```

### Setup commun (`test/setup.js`)
```javascript
import { vi } from 'vitest';
import { Magasin } from '@logibtp/socle/ui/etat.js';

// Mock API global
global.app = {
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  },
  magasin: new Magasin({}),
  moduleActif: (nom) => true,
  peut: (droit, type) => true,
  naviguer: vi.fn(),
  publier: vi.fn(),
  souscrire: vi.fn()
};

// Mock localStorage / sessionStorage / IndexedDB
Object.defineProperty(global, 'localStorage', {
  value: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
});
```

---

## 🎯 Jeux de cas partagés (Parité JS/C#)

### Principe
Chaque règle de calcul est testée via des **fichiers JSON** dans `tests/cas/` (cœur) ou `modules/*/tests/cas/` (modules). Ces fichiers sont lus par :
- **Vitest** : `@logibtp/socle/testing` → `client/test/cas-partages.test.js`
- **xUnit** : `LogiBTP.Socle.Testing.CasPartages` → `tests/LogiBTP.Calcul.Tests/`

### Format d'un cas de test
```json
// tests/cas/01_lignes_simples_remise_tva.json
{
  "nom": "Lignes simples avec remise et TVA",
  "document": {
    "ent_mode_calcul_ouvrage": "D",
    "ent_tva_mode": "NORMAL",
    "ent_taux_tva_defaut": 20
  },
  "lignes": [
    { "lig_type_ligne": "LIGNE", "lig_pa": 100, "lig_fg": 10, "lig_pr": 5, "lig_remise": 0 },
    { "lig_type_ligne": "LIGNE", "lig_pa": 200, "lig_fg": 10, "lig_pr": 5, "lig_remise": 10 },
    { "lig_type_ligne": "PIED_HT", "lig_montant": -50 }
  ],
  "attendu": {
    "totaux": { "ht": 385, "tva": 77, "ttc": 462 },
    "lignes": [
      { "lig_pv_net": 115.5, "lig_pv": 115.5, "lig_montant_ht": 115.5 },
      { "lig_pv_net": 231, "lig_pv": 207.9, "lig_montant_ht": 207.9 },
      { "lig_montant": -50 }
    ]
  }
}
```

### Exécution tests partagés
```javascript
// client/test/cas-partages.test.js
import { lireCasPartages } from '@logibtp/socle/testing';
import { MoteurDevisBtp } from '../src/calcul/index.js';

const cas = await lireCasPartages('tests/cas'); // ou modules/*/tests/cas

describe.each(cas)('$nom', (cas) => {
  test('calcul correspond à l\'attendu', () => {
    const moteur = new MoteurDevisBtp(cas.document);
    moteur.lignes = cas.lignes;
    moteur.calculerTout();
    
    expect(moteur.document.totaux).toEqual(cas.attendu.totaux);
    cas.attendu.lignes.forEach((attendu, i) => {
      expect(moteur.lignes[i]).toMatchObject(attendu);
    });
  });
});
```

---

## 🔄 Parité JS ↔ C#

### Commande de vérification complète
```bash
# 1. Client : exporter résultats JSON pour tous les cas
npm run exporter-resultats
# → Génère tests/resultats-js/ avec résultats calculés par le moteur JS

# 2. Serveur : tests xUnit comparent avec résultats JS
LOGIBTP_TEST_PG="Host=localhost;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp" \
dotnet test LogiBTP.slnx
```

### En cas d'écart
1. **Écart légitime** (arrondi, règle métier) → Modifier **LES DEUX** moteurs + ajouter cas de test
2. **Bug d'un côté** → Corriger le moteur concerné
3. **Écart arbitré dans l'UI** → Capturé dans table `calcul_cas_test` → `GET /api/cas-test/{id}/export` format `tests/cas/`

---

## 🏃 Lancer les tests

```bash
# Tous les tests client (racine)
npm test

# Tests d'un workspace spécifique
npm test --workspace=@logibtp/socle
npm test --workspace=@logibtp/document
npm test --workspace=@logibtp/client

# Tests avec couverture
npm run test:coverage

# Tests en mode watch
npm run test:watch

# Tests spécifiques (filtrage)
npm test -- --run analyse-calcul
npm test -- --run cas-partages
```

### CI/CD (GitHub Actions / GitLab CI)
```yaml
# .github/workflows/test-client.yml
jobs:
  test-client:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

---

## 🧰 Bonnes pratiques de test

### 1. Tests unitaires purs (pas d'API, pas de DOM)
```javascript
// test/calcul/fonctions-btp.test.js
import { arrondir6, calculerTVA } from '@logibtp/client/calcul/fonctions-btp.js';

describe('arrondir6', () => {
  test('arrondit à 6 décimales', () => {
    expect(arrondir6(1.123456789)).toBe(1.123457);
    expect(arrondir6(1.1234564)).toBe(1.123456);
  });
});
```

### 2. Tests composants UI (jsdom)
```javascript
// test/ui/grille.test.js
import { Grille } from '@logibtp/socle/ui/grille.js';

describe('Grille', () => {
  test('affiche les lignes et gère sélection', () => {
    const grille = new Grille({ colonnes: [...], lignes: [...] });
    grille.rendre();
    
    expect(document.querySelectorAll('.grille-ligne')).toHaveLength(3);
    
    grille.selectionner([1]);
    expect(document.querySelector('.grille-ligne.selectionnee')).toBeTruthy();
  });
});
```

### 3. Tests d'intégration (mock API)
```javascript
// test/integration/document.test.js
import { EditeurDevisBtp } from '@logibtp/client/app/editeur-btp.js';

describe('EditeurDevisBtp', () => {
  test('charge document et calcule', async () => {
    app.api.get.mockResolvedValue({ ent_id: 1, lignes: [...] });
    
    const editeur = new EditeurDevisBtp({ documentId: 1 });
    await editeur.initialiser();
    
    expect(app.api.get).toHaveBeenCalledWith('/api/documents/1');
    expect(editeur.moteur.document.totaux.ht).toBeGreaterThan(0);
  });
});
```

### 4. Tests E2E (Playwright - optionnel)
```javascript
// tests/e2e/document.spec.js
import { test, expect } from '@playwright/test';

test('créer un devis complet', async ({ page }) => {
  await page.goto('/document/nouveau?type=V_DEVIS');
  await page.fill('[data-col=code]', 'HEURE');
  await page.press('[data-col=code]', 'Enter');
  await page.fill('[data-col=qte]', '10');
  await page.click('button:has-text(Enregistrer)');
  await expect(page.locator('.toast-succes')).toBeVisible();
});
```

Scénarios réels dans `e2e/` (comptes dans `e2e/.env`, API et client lancés, base avec la démonstration) :

| Fichier | Parcours |
|---------|----------|
| `salarie.spec.ts`, `materiel.spec.ts` | Création d'une fiche |
| `droits.spec.ts` | Refus des routes sans session ou sans droit |
| `commercial-devis.spec.ts` | Demande CRM → projet → devis rattaché → envoyé → révision (indice B) → copie → retour à une version précédente → validé par le client |
| `commercial-situations.spec.ts` | Devis accepté → commande → informations → validation dans un nouveau marché → situations 1 et 2 et leurs factures d'avancement → annulation de la facture 2 par avoir, reprise de la situation 2, nouvelle facture → prévisionnel de facturation du chantier |
| `commercial-facture-reglement.spec.ts` | Facture directe avec tiers payeur → règlement pointé (facture payée) |
| `achats-commande-reception.spec.ts` | Demande de prix → acceptée par le fournisseur → commande → livraison partielle (une ligne laissée en reliquat) → livraison du reliquat avec ligne soldée (commande soldée) |
| `achats-facture-reglement.spec.ts` | Commande acceptée → livraison complète → facture fournisseur (référence du fournisseur, commande facturée) → règlement partiel (payée partiellement) → règlement du solde (payée) |
| `achats-retour-avoir.spec.ts` | Commande livrée (soldée) → bon de retour partiel (reliquat de la commande rouvert) → facture de la livraison → avoir partiel → imputation de l'avoir sur la facture → règlement du solde (facture et avoir payés) |
| `achats-situations.spec.ts` | Commande acceptée → situation fournisseur à 30 % → situation à 80 % (période de 50 %, commande en facturation) |
| `sous-traitance-commande-facture.spec.ts` | Appel d'offres de sous-traitance accepté → commande validée dans un nouveau marché de sous-traitance (lié au marché de vente, caution, autoliquidation : TTC = HT) → factures d'avancement à 40 % puis 70 % (approbation) → facture à 60 % devenue avoir de sous-traitance (période négative) → règlement de la facture n° 1 (payée) |
| `sous-traitance-paiement-direct.spec.ts` | Commande client validée dans un marché public → « Sous-traiter » : commande de sous-traitance (prix du sous-traitant) → marché en paiement direct (montant agréé) → facture du sous-traitant à 50 % → notre facture d'avancement en brouillon → demande de paiement direct reçue, acceptée, transmise avec notre facture (poste de déduction, net à payer réduit), payée par le maître d'ouvrage |
| `stock-mouvements.spec.ts` | Dépôt créé pour le passage → entrée de parpaings (unité de vente m², stock à l'unité) et de plaques → transfert vers un chantier qui consomme → sortie → état du stock du dépôt |
| `stock-inventaire.spec.ts` | Dépôt approvisionné → lot d'inventaire généré sur les articles du lieu (théorique) → comptage avec écart → onglet Écarts → lot validé : pièce d'inventaire, stock recalé |
| `stock-magasin.spec.ts` | Dépôt approvisionné → sortie au magasin pour un chantier → retour du chantier → état du stock |
| `ordres-devis-branches.spec.ts` | Devis de cinq lignes accepté → commande validée dans un nouveau marché → ordre d'exécution lancé depuis le marché, pris en charge, lancement validé et contrôlé → une branche par ligne (lignes des autres branches supprimées) : fabrication (ordre de fabrication terminé → ordre de livraison), achat (demande d'achat → commande fournisseur : fournisseur choisi, ni client ni marché de vente repris), stock (demande d'approvisionnement → réservation sur un dépôt → transfert vers le chantier), sous-traitance (ordre → commande de sous-traitance dans un marché lié), pose (pose et réception contrôlée) → vue d'exécution du chantier (états des services, ordres) |
| `ordres-demandes.spec.ts` | Demandes saisies sur un chantier sans devis : demande d'approvisionnement transmise puis prise en charge → visserie (demande d'achat → demande de prix → commande fournisseur), nacelle (commande fournisseur directe), parpaings (réservation → transfert) ; ordre de sous-traitance → appel d'offres → commande dans un marché de sous-traitance ; liste des ordres filtrée par chantier |
| `ordres-controle-n1.spec.ts` | Contrôle du N+1 : service de test (responsable = N+1, membre = exécutant, comptes du profil Saisie créés au besoin) → ordre d'exécution porté par le service → l'exécutant valide le lancement, ne peut pas le contrôler, l'étape suivante lui est refusée → le N+1 voit la tâche « contrôle à faire » du CRM et contrôle → l'exécutant termine l'ordre |

Aides communes de la page document (entête, grille, menu ▾, transformation, annuaire, attente sur la limite de débit 429) : `e2e/outils/documents.ts` ; achats (fournisseur Matériaux Rhône-Alpes, chantier CH-2026-001, nature MAT, transformation ligne à ligne, règlement d'une échéance) : `e2e/outils/achats.ts` ; sous-traitance (sous-traitant Plomberie Dupuis et Fils, chantier CH-2026-002 et son marché de vente M-2026-002-1, nature ST, fenêtre du marché de sous-traitance, avancement, approbation) : `e2e/outils/sous-traitance.ts` ; stock (articles PARP20 et BA13, chantier CH-2026-001, dépôt propre à chaque passage, pièce de stock validée, état du stock d'un lieu) : `e2e/outils/stock.ts` ; ordres (vente jusqu'au marché, ordre d'exécution du marché, transformation par la fenêtre de choix, lignes gardées, étapes validées et contrôlées, ordre saisi sans source, prise en charge) : `e2e/outils/execution.ts` ; comptes créés par un scénario (`compteDeTest`, `connecterCompte`) : `e2e/outils/connexion.ts`. Les étapes d'un fichier s'enchaînent (`test.describe.serial`, une page partagée) ; les fichiers sont indépendants. Saisies de la grille reprises tant que la cellule n'affiche pas la valeur (`saisirCelluleVerifiee` : la grille est redessinée quand la première ligne crée le document) ; code d'un article saisi d'un bloc ; `valider` accepte « Enregistrer puis valider ? » ; un compte par contexte de navigateur quand un scénario en change. Lancement : `npx playwright test commercial --project=chromium` (ou `achats`, `sous-traitance`, `stock`, `ordres`) (les arguments sont des filtres sur le chemin : sous Windows, pas de `*`, que le terminal ne développe pas).

Sur la version compilée (plus rapide que le serveur Vite, moins d'attentes dépassées) : API en Release (`dotnet run -c Release --project src\LogiBTP.Api --launch-profile http`, avec les mêmes variables, dont `Authentification__ComptesTest`), client construit et servi par l'aperçu (`npm run apercu --workspace client`, port 4173, même proxy `/api`), puis `BASE_URL=http://localhost:4173` (PowerShell : `$env:BASE_URL='http://localhost:4173'`) avant `npx playwright test`. Le service worker du client construit est bloqué par `playwright.config.ts` (`serviceWorkers: 'block'`) : sans cela, les requêtes passent par lui, échappent à `page.route` et les 429 ne sont plus rejoués.

---

## 📊 Couverture visée

| Couche | Couverture cible | Outils |
|--------|------------------|--------|
| Moteur calcul (pur) | **100%** | Vitest + cas partagés |
| Règles métier (controles) | **95%+** | Vitest + cas partagés |
| Composants UI socle | **80%+** | Vitest + jsdom |
| Pages / Intégration | **70%+** | Vitest + mock API |
| PWA / Hors-ligne | **60%+** | Vitest + mock SW |

---

## 🔗 Liens vers autres docs

| Concept | Documentation |
|---------|---------------|
| Architecture client | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Calcul BTP | [CALCUL.md](CALCUL.md) |
| Parité JS/C# | [transversal/PARITE_JS_CS.md](../transversal/PARITE_JS_CS.md) |
| API Tests | [api/TESTS.md](../api/TESTS.md) |
| BDD Tests | [bdd/INSTALLATION_MAJ.md](../bdd/INSTALLATION_MAJ.md#tests) |