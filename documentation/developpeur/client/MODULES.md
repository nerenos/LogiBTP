# Modules Client (@logibtp/*)

> Chaque module suit le pattern : **classe mère (socle/module) → spécialisation cœur**
> Les modules sont des **packages npm** indépendants dans `modules/*/js/`

---

## 📦 Catalogue des modules client

### Socle (base technique)

| Module | Package | Entry Point | Rôle |
|--------|---------|-------------|------|
| **Socle** | `@logibtp/socle` | `socle/js/src/index.js` | Calcul décimal, expressions, références, Immer store, composants UI (grille, arbre, combo, dialogue, éditeur riche, préférences, raccourcis), `socle.css` |

### Modules métier (avec spécialisation BTP)

| Module | Package | Spécialisation cœur | Tables BDD |
|--------|---------|---------------------|------------|
| **Document** | `@logibtp/document` | `EditeurDevisBtp`, `ReglesBtp`, `PressePapiersBtp`, `PanneauxBtp` | `document`, `document_ligne` |
| **Métré** | `@logibtp/metre` | `DictionnaireBtp`, hôte `PanneauMetre` | `metre`, `metre_ligne`, `variable` |
| **Liste** | `@logibtp/liste` | `vues-liste.js` (SOURCES_LISTE, THEMES_LISTE, VUES_LISTE) | `source_liste`, `theme_liste`, `vue_liste` |
| **Fiche** | `@logibtp/fiche` | `fiches/definitions.js` (TYPES_FICHE, DROITS_FICHE) | `fiche_*`, `type_fiche`, `champ_supplementaire` |
| **GED** | `@logibtp/ged` | `ged/ged.js`, `ged/arborescence.js` (ArborescenceBtp) | `ged_element`, `ged_version`, `ged_coffre` |
| **Bibliothèque** | `@logibtp/bibliotheque` | `bibliotheque/*` (appel, envoi, données), `fiches/fiche-element.js` | `element`, `famille`, `nature`, `tarif_fournisseur` |
| **Annuaire** | `@logibtp/annuaire` | `annuaire/*`, `fiches/fiche-annuaire.js`, `pages/graphe.js` | `personne`, `individu`, `casquette`, `coordonnee` |
| **Entreprises FR** | `@logibtp/entreprises-fr` | `creerFournisseurEntreprises` (annuaire), fiche personne | — (API externe) |
| **Graphe** | `@logibtp/graphe` | `structure/graphe-structure.js` (VueGrapheStructure) | — (JS seul) |
| **Navigation** | `@logibtp/navigation` | `application.js`, `navigation/menus.js`, `pages/*` | — (JS seul) |
| **Import** | `@logibtp/import` | `import/*` (formats, devis-importe, depot-import) | `document_origine` (cœur) |
| **Edition** | `@logibtp/edition` | `editions/modeles.js`, `editions/polices.js` | `edition_modele`, `parametre_edition` |
| **Règlement** | `@logibtp/reglement` | `pages/reglements.js` | `document_echeance`, `reglement` |
| **CRM** | `@logibtp/crm` | `crm/*` (PanneauSuivi), `pages/crm*.js` | `ged_element` (type `crm_note`) |
| **Authentification** | `@logibtp/authentification` | `pages/connexion.js`, `pages/compte.js`, session `Application` | `individu.ind_utilisateur` |
| **Droits** | `@logibtp/droits` | `app.acces`/`app.peut`, `pages/parametres-droits.js` | `droit_document`, `droit_fiche`, `crm_droit` |
| **Calendrier** | `@logibtp/calendrier` | `pages/parametres-calendriers.js` | `calendrier`, `jour_ferie`, `service.cal_id` |
| **Notification** | `@logibtp/notification` | Cloche bandeau, `pages/notifications.js` | `notification`, `notification_source` |
| **OAuth** | `@logibtp/oauth` | `pages/parametres-connexions.js`, widget `oauth-alertes` | `oauth_connexion`, `oauth_utilisation` |
| **Mail** | `@logibtp/mail` | `pages/mail.js`, `pages/parametres-mail.js`, bouton 📧 document | `mail_compte`, `mail_message`, `mail_piece` |
| **Exécution** | `@logibtp/execution` | `pages/execution.js`, `execution/execution.js` | `ordre_execution`, `ordre_budget` |
| **Pointage** | `@logibtp/pointage` | `pages/pointage.js`, liste `pointages` | `poi_pointage`, `poi_zone`, `poi_saisie` |
| **Planning** | `@logibtp/planning` | `pages/planning.js`, `pages/planning-prototype.js` | `pla_tache`, `pla_ressource`, `pla_dependance` |
| **Stock** | `@logibtp/stock` | `pages/stock.js` (à venir) | `stk_mouvement`, `stk_lieu`, `stk_article` |
| **Comptabilité** | `@logibtp/comptabilite` | `pages/comptabilite.js` (plan, tiers, ventilation, export) | `compte_comptable`, `comptabilite_*` |

---

## 🔗 Dépendances entre modules (côté client)

```mermaid
graph TD
  socle[@logibtp/socle] --> document & metre & liste & fiche & ged & bibliotheque & annuaire & entreprises[entreprises-fr] & graphe & navigation & import & edition & reglement & crm & authentification & droits & calendrier & notification & oauth & mail & execution & pointage & planning & stock & comptabilite
  graphe --> annuaire
  import -.-> document
  edition -.-> document
  mail -.-> document & ged & crm
  oauth -.-> mail
  notification -.-> crm & mail & oauth & authentification & droits
  planning -.-> calendrier & annuaire
  execution -.-> stock & annuaire
  pointage -.-> annuaire & calendrier
  stock -.-> document & annuaire
  sous-traitance -.-> document & annuaire
  crm -.-> ged & annuaire
```

**Règle :** Un module ne dépend jamais d'un autre module métier (sauf `graphe → annuaire`). Les liens passent par le **cœur** (`client/src/app/`).

---

## 🏗️ Structure standard d'un module JS

```
modules/<nom>/js/
├── package.json           # @logibtp/<nom>, dépendances : socle + éventuelles
├── src/
│   ├── index.js           # Exports publics (classes, fonctions, types)
│   ├── <Module>.js        # Classe mère (Template Method : étapes surchargeables)
│   ├── <Module>Web.js     # Spécialisation serveur (si applicable, côté API)
│   ├── ui/                # Composants UI spécifiques au module
│   └── ...                # Logique métier partagée JS/C#
├── test/                  # Tests Vitest (jeux cas partagés)
└── db/                    # Scripts SQL (voir documentation BDD)
```

### Exemple : Module Document

```javascript
// modules/document/js/src/index.jsexport { MoteurDocument } from './moteur-document.js';
export { EditeurDocument } from './ui/editeur-document.js';
export { PanneauDocument } from './ui/panneau-document.js';
export { ReglesDocument } from './regles-document.js';
export { PressePapiersDocument } from './presse-papiers-document.js';
```

---

## 🔄 Spécialisation par le cœur (Client)

Le cœur (`client/src/app/`) **étend** les classes mères des modules :

| Module | Classe mère (module) | Spécialisation cœur (client) | Fichier |
|--------|----------------------|------------------------------|---------|
| Document | `MoteurDocument` | `MoteurDevisBtp` | `calcul/moteur-btp.js` |
| Document | `EditeurDocument` | `EditeurDevisBtp` | `app/editeur-btp.js` |
| Document | `ReglesDocument` | `ReglesBtp` | `app/regles-btp.js` |
| Document | `PressePapiersDocument` | `PressePapiersBtp` | `app/presse-papiers-btp.js` |
| Document | `PanneauDocument` | `PanneauxBtp` | `app/panneaux-btp.js` |
| Métré | `PanneauMetre` (hôte) | `EditeurDevisBtp` (hôte) | `app/editeur-btp.js` |
| Liste | `ConstructeurRequete` | `SpecialisationListeBtp` (côté API) | `vues-liste.js` (config) |
| Fiche | `ValidationFiche` | `SpecialisationFicheBtp` (côté API) | `fiches/definitions.js` |
| GED | `RegleVersions`, `ChaineCoffre` | `SpecialisationGedBtp` (côté API) | `ged/arborescence.js` |
| Bibliothèque | `CalculElement` | `SpecialisationBibliothequeBtp` (API) | `bibliotheque/*` |
| Annuaire | `GrapheAnnuaire` | `VueGrapheStructure` | `structure/graphe-structure.js` |

---

## 📋 Jeux de cas partagés (Tests)

Chaque module définit des **jeux de cas JSON** dans `modules/<nom>/tests/cas/` rejoués par :
- **Vitest** (JS) : `modules/<nom>/test/*.test.js`
- **xUnit** (C#) : `modules/<nom>/tests/*.cs` via `LogiBTP.Socle.Testing.CasPartages`

### Correspondance tests partagés

| Module | Jeux de cas | JS Test | C# Test |
|--------|-------------|---------|---------|
| Socle | `expressions.json` | `socle/tests/expressions.test.js` | `LogiBTP.Socle.Tests/ExpressionsTests.cs` |
| Document | `modules/document/tests/cas/` | `modules/document/test/*.test.js` | `LogiBTP.Documents.Tests/` |
| Métré | `modules/metre/tests/cas/` | `modules/metre/test/*.test.js` | `LogiBTP.Metres.Tests/` |
| Liste | `modules/liste/tests/cas/` | `modules/liste/test/*.test.js` | `LogiBTP.Listes.Tests/` |
| Fiche | `modules/fiche/tests/cas/` | `modules/fiche/test/*.test.js` | `LogiBTP.Fiches.Tests/` |
| GED | `modules/ged/tests/01-06.json` | `modules/ged/test/*.test.js` | `LogiBTP.Ged.Tests/` |
| Bibliothèque | `01_calcul`, `02_coefficients` | `modules/bibliotheque/test/*.test.js` | `LogiBTP.Bibliotheque.Tests/` |
| Annuaire | `01-03` | `modules/annuaire/test/*.test.js` | `LogiBTP.Annuaire.Tests/` |
| Cœur BTP | `tests/cas/*.json` | `client/test/*.test.js` | `tests/LogiBTP.Calcul.Tests/` |
| Ressources | `tests/ressources/*.json` | `client/test/ressources.test.js` | `LogiBTP.Domaine.Tests/` |

---

## ⚙️ Activation des modules (côté client)

```javascript
// Dans Application (application.js)
this.modulesActifs = {
  document: true,
  metre: true,
  liste: true,
  fiche: true,
  ged: true,
  bibliotheque: true,
  annuaire: true,
  // Modules facultatifs (selon module_societe en BDD)
  reglement: false,
  crm: false,
  execution: false,
  pointage: false,
  planning: false,
  stock: false,
  comptabilite: false,
  sous-traitance: false
};

// Vérification avant chargement
if (this.moduleActif('planning')) {
  const { VuePlanningBtp } = await import('@logibtp/planning');
  // ...
}
```

La source de vérité est la table `module_societe` (BDD, script `193_modules_services.sql`), exposée via `/api/societe` au démarrage.

---

## 🔧 Commandes utiles

```bash
# Installer toutes les dépendances (racine)
npm install

# Lancer les tests d'un module spécifique
npm test --workspace=@logibtp/document
npm test --workspace=@logibtp/metre

# Régénérer les vues de liste (génère db/121_listes_parametrage.sql)
npm run generer-vues-liste --workspace client

# Build d'un module seul
npm run build --workspace=@logibtp/socle
```

---

## 📝 Pages liées

- [ARCHITECTURE.md](ARCHITECTURE.md) — Arborescence globale, bootstrap
- [NAVIGATION.md](NAVIGATION.md) — Routeur, fenêtres, modules
- [CALCUL.md](CALCUL.md) — MoteurDevisBtp, parité C#
- [PAGES.md](PAGES.md) — Pages par module
- [TESTS.md](TESTS.md) — Stratégie de test, jeux partagés