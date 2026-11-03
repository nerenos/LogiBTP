# Calcul BTP côté Client

> **Fichiers clés :** `client/src/calcul/` (moteur pur) + `client/src/app/calcul/` (intégration UI)
> **Parité :** Réplique exacte du C# (`LogiBTP.Calcul/MoteurDevisBtp.cs`)

---

## 🏗️ Architecture du moteur

```text
client/src/calcul/
├── index.js              # Exports publics
├── moteur-btp.js         # MoteurDevisBtp (classe principale)
├── colonnes-btp.js       # Définition colonnes BTP (mirror C#)
├── controles-btp.js      # Contrôles cohérence (blocages, écarts arrondi)
└── fonctions-btp.js      # Fonctions utilitaires (arrondis, TVA, etc.)
```

### `MoteurDevisBtp` — Classe principale

```javascript
// client/src/calcul/moteur-btp.js
export class MoteurDevisBtp extends MoteurDocument {
  constructor(document, options = {}) {
    super(document, options);
    this.colonnes = COLONNES_BTP;        // depuis colonnes-btp.js
    this.controles = CONTROLES_BTP;      // depuis controles-btp.js
    this.fonctions = FONCTIONS_BTP;      // depuis fonctions-btp.js
  }

  // Méthodes surchargeables (Template Method)
  calculerLigne(ligne) { ... }
  calculerTotaux() { ... }
  calculerTVA() { ... }
  calculerFraisAnnexes() { ... }
  calculerProrata() { ... }
  // ...
}
```

---

## 📊 Colonnes BTP (`colonnes-btp.js`)

Miroir exact de `LogiBTP.Domaine/DocumentLigneBtp.cs` :

```javascript
export const COLONNES_BTP = {
  // Identification
  lig_id: { type: 'entier', clePrimaire: true },
  lig_ent_id: { type: 'entier', foreignKey: 'document.ent_id' },
  
  // Nature & type
  lig_nat_id: { type: 'entier', foreignKey: 'nature.nat_id' },
  lig_type_ligne: { type: 'chaine', valeurs: ['LIGNE', 'SOUS_TOTAL', 'TOTAL', 'SECTION', 'PIED', 'TVA', 'COMMENTAIRE'] },
  
  // Métré
  lig_mtr_id: { type: 'entier', foreignKey: 'metre.mtr_id' },
  lig_qte_source: { type: 'chaine', valeurs: ['M', 'U', 'V'] }, // Métré, Unitaire, Variable
  lig_qte: { type: 'decimal', precision: 6 },
  lig_qte_vendue: { type: 'decimal', precision: 6, calculée: true },
  
  // Prix
  lig_pa: { type: 'decimal', precision: 6 },
  lig_fg: { type: 'decimal', precision: 6 },      // Frais généraux %
  lig_pr: { type: 'decimal', precision: 6 },      // Profit %
  lig_fa: { type: 'decimal', precision: 6 },      // Frais annexes %
  lig_pv_net: { type: 'decimal', precision: 6, calculée: true },
  lig_remise: { type: 'decimal', precision: 6 },  // Remise sur PV %
  lig_pv: { type: 'decimal', precision: 6, calculée: true },
  lig_pv_affiche: { type: 'decimal', precision: 6 }, // PV affiché (peut être forcé)
  
  // Blocs / Arrondi
  lig_blocage_pa: { type: 'booleen' },
  lig_blocage_fg: { type: 'booleen' },
  lig_blocage_pr: { type: 'booleen' },
  lig_blocage_fa: { type: 'booleen' },
  lig_blocage_pv: { type: 'booleen' },
  lig_ecart_arrondi: { type: 'decimal', precision: 6 },
  
  // Prorata / Ventilation
  lig_prorata: { type: 'decimal', precision: 6 },
  lig_fa_lignes: { type: 'chaine' }, // JSON : ventilation par ligne
  
  // Liens bibliothèque
  lig_art_id: { type: 'entier', foreignKey: 'element.ele_id' },
  lig_bib_id: { type: 'entier', foreignKey: 'bibliotheque.bib_id' },
  
  // Variables & métré
  lig_variables: { type: 'chaine' }, // JSON : variables de ligne
  lig_proprietes: { type: 'chaine' }, // JSON : propriétés étendues
};
```

---

## ⚙️ Règles de calcul clés (parité C#)

### 1. Ordre de calcul (séquence critique)

```javascript
// Dans MoteurDevisBtp.calculerTout()
async calculerTout() {
  // 1. Variables document (onglet Définition métré)
  this.evaluerVariablesDocument();
  
  // 2. Lignes séquentiellement (dépendances entre lignes)
  for (const ligne of this.lignes) {
    this.calculerLigne(ligne);
  }
  
  // 3. Sous-totaux (recalcul depuis dernier sous-total pointé)
  this.recalculerSousTotaux();
  
  // 4. Variables de ligne (après qté ligne)
  this.evaluerVariablesLignes();
  
  // 5. Frais annexes (ventilation)
  this.calculerFraisAnnexes();
  
  // 6. Totaux HT / TVA / TTC
  this.calculerTotaux();
  
  // 7. Lignes de pied (PIED_HT, PIED_TTC, TOTAL_HT, TOTAL_TTC)
  this.calculerPied();
  
  // 8. TVA (ventilation par taux)
  this.calculerTVA();
  
  // 9. Écarts d'arrondi
  this.calculerEcartsArrondi();
}
```

### 2. Métré (`lig_qte_source = 'M'`)

```javascript
// Évaluateur de script métré (Portées)
const script = ligne.lig_mtr_script; // ex: "1000 / {{poids}} * {{longueur}}"
const contexte = {
  ...variablesDocument,      // $$var
  ...variablesLigne,         // $var
  '@@': ligneOuvrageParent,  // @@ = ouvrage de la ligne
  '@': ligneCourante,        // @ = ligne elle-même
  'lig_qte_vendue': qteCalculée
};

const résultat = evaluerScriptMetre(script, contexte);
// Renvoyer = quantité finale
```

### 3. Variables

| Préfixe | Portée | Exemple | Évalué |
|---------|--------|---------|--------|
| `$$` | Document | `$$surface_totale` | Après métré document |
| `$` | Ligne | `$hauteur` | Après métré ligne |
| `@@` | Ouvrage parent | `@@.pv` | Composantes sœurs |
| `@` | Ligne courante | `@.qte` | Dans script métré |

### 4. Arrondis (précision 6 décimales)

```javascript
// fonctions-btp.js
export const arrondir6 = (v) => Math.round(v * 1e6) / 1e6;

// PA, PR, PV arrondis à CHAQUE ÉTAPE
ligne.lig_pa = arrondir6(ligne.lig_pa);
ligne.lig_pv_net = arrondir6(ligne.lig_pa * (1 + ligne.lig_fg/100) * (1 + ligne.lig_pr/100));
ligne.lig_pv = arrondir6(ligne.lig_pv_net * (1 - ligne.lig_remise/100));
```

### 5. TVA & Autoliquidation

```javascript
// Une seule ligne TVA positionne la ventilation
// Détail par taux dans document_tva (pas une ligne par taux)

calculerTVA() {
  if (this.document.ent_autoliquidation) {
    // TVA calculée puis annulée (tva_montant_annulation)
    this.document.tva_montant_annulation = this.document.tva_montant;
    this.document.tva_montant = 0;
  } else if (this.document.ent_intracom) {
    // TVA à 0 sur le document
    this.document.tva_montant = 0;
  }
  // Ventilation dans document_tva (clé : ttv_id)
}
```

### 6. Frais annexes ventilés

```javascript
// UNIQUEMENT EN MONTANT (pas de % pour éviter dépendance circulaire)
ventilation_frais: [
  { cle: 'LIGNE', cible: 123, montant: 500 },
  { cle: 'ELEMENT', cible: 456, montant: 200 },
  { cle: 'NATURE', cible: 789, montant: 100 }
]
// Réécrit à chaque enregistrement dans ventilation_frais_ligne
```

### 7. Modes calcul ouvrage

```javascript
// ent_mode_calcul_ouvrage :
// 'D' = Déboursé (somme PA composantes)
// 'P' = PV (somme PV composantes)  
// 'B' = Bordereau (prix fixe marché)

// Si ligne SECTION : porte les variables du document
```

---

## 🔄 Parité JS ↔ C#

### Tests partagés (`tests/cas/*.json`)

```json
// tests/cas/01_lignes_simples_remise_tva.json
{
  "document": { "ent_mode_calcul_ouvrage": "D", "ent_tva_mode": "NORMAL" },
  "lignes": [
    { "lig_type_ligne": "LIGNE", "lig_pa": 100, "lig_fg": 10, "lig_pr": 5, "lig_remise": 0 },
    { "lig_type_ligne": "PIED_HT", "lig_montant": -50 }
  ],
  "attendu": {
    "totaux": { "ht": 165, "tva": 33, "ttc": 198 },
    "lignes": [
      { "lig_pv_net": 115.5, "lig_pv": 115.5 },
      { "lig_montant": -50 }
    ]
  }
}
```

### Commande de vérification parité

```bash
# 1. Exporter résultats JS
npm run exporter-resultats

# 2. Lancer tests C# (compare avec résultats JS)
dotnet test LogiBTP.slnx

# Tout écart → échec de test
```

### Ajouter une règle de calcul

1. **Modifier les DEUX moteurs** : `moteur-btp.js` + `MoteurDevisBtp.cs`
2. **Ajouter un cas** dans `tests/cas/` (ou `modules/*/tests/cas/`)
3. **Exécuter** : `npm run exporter-resultats && dotnet test`
4. **Écart arbitré** dans l'UI → capturé dans `calcul_cas_test` → `GET /api/cas-test/{id}/export`

---

## 🎯 Intégration UI

### Panneau métré (`PanneauMetre` hôte dans `EditeurDevisBtp`)

```javascript
// client/src/app/editeur-btp.js
// F4 sur une ligne → ouvre PanneauMetre
async ouvrirPanneauMetre(ligne) {
  const { PanneauMetre } = await import('@logibtp/metre/ui/panneau-metre.js');
  const panneau = new PanneauMetre({
    ligne,
    dictionnaire: this.dictionnaireMetre,      // DictionnaireBtp
    variablesDocument: this.document.variables,
    surValidation: (script, variables) => this.appliquerMetre(ligne, script, variables)
  });
  await panneau.afficher();
}
```

### Dictionnaire métré (`DictionnaireBtp`)

```javascript
// client/src/app/dictionnaire-btp.js
// Variables disponibles, fonctions, opérateurs, unités
export const DictionnaireBtp = {
  variables: { 
    document: ['$$surface', '$$volume', '$$poids'],
    ligne: ['$longueur', '$largeur', '$hauteur', '$qte']
  },
  fonctions: ['SOMME', 'MOYENNE', 'SI', 'ARRONDI', 'RACINE'],
  operateurs: ['+', '-', '*', '/', '^', '%'],
  unites: { 'm': 1, 'cm': 0.01, 'mm': 0.001, 'km': 1000 }
};
```

### Éditeur de devis (`EditeurDevisBtp`)

```javascript
// Grille lignes + panneaux latéraux (métrique, variables, frais annexes)
// Colonnes BTP : Code, Libellé, Qté, Unité, PA, FG%, PR%, FA%, PV net, Rem%, PV, Montant
// Raccourcis : F4 (métré), F3 (biblio), Ctrl+Flèches (déplacer lignes)
```

---

## 🧪 Tests

```bash
# Tests unitaires moteur (Vitest)
npm test -- client/test/calcul/

# Tests d'intégration (jeux cas partagés)
npm test -- client/test/analyse-calcul.test.js

# Parité complète
npm run exporter-resultats && dotnet test LogiBTP.slnx
```

### Fichiers de test client

| Fichier | Description |
|---------|-------------|
| `client/test/analyse-calcul.test.js` | Scénarios complets de calcul |
| `client/test/cas-partages.test.js` | Rejouer `tests/cas/*.json` |
| `client/test/controles-btp.test.js` | Contrôles cohérence (blocages, écarts) |

---

## 🔗 Liens vers autres docs

| Concept | Documentation |
|---------|---------------|
| Architecture client | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Modules (métre, document) | [MODULES.md](MODULES.md) |
| Panneaux BTP dans document | [PAGES.md](PAGES.md#document) |
| API Calcul (C#) | [api/DOMAINE_CALCUL.md](../api/DOMAINE_CALCUL.md) |
| BDD colonnes BTP | [bdd/COEUR_BTP.md](../bdd/COEUR_BTP.md#100_btpsql) |
| Tests partagés | [TESTS.md](TESTS.md) |
| Transversal parité | [transversal/PARITE_JS_CS.md](../transversal/PARITE_JS_CS.md) |"