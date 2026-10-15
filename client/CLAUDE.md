# Client LogiBTP (cœur, application web Vite)

## Rôle
- Application web du cœur (`logibtp-client`, workspace npm) : spécialise les paquets JS des modules (`@logibtp/socle`, `metre`, `document`, `liste`, `fiche`, `ged`, `navigation`, `bibliotheque`, `graphe`, `annuaire`, `entreprises-fr`, `import`) ; aucun module ne dépend du client.
- En ligne : API C# par `/api` (proxy Vite vers `http://localhost:5080`, `Host` conservé pour choisir la société). API injoignable (`api.disponible()` sur `/api/sante`) : **démo hors ligne**, calcul local complet, fournisseurs `…Memoire` sans enregistrement.

## Structure
- `src/main.js` : CSS des modules puis `new Application().demarrer()` (`window.__logibtp` en développement).
- `src/app/application.js` : `Application` (routeur, fenêtres et session du module Navigation, bandeau, `naviguer(url, { nouvelleFenetre })`, `ouvrirElement`) ; `services()` crée une fois les fournisseurs `{ liste, fiche, ged, bibliotheque, annuaire, entreprises, structure }` (API ou mémoire) ; `LISTE_PAR_TYPE` (liste de retour d'une fiche).
- `src/app/api.js` : `api` (documents, verrous, transformation, traçabilité/origine, `/structure/*`, étiquettes, couleurs, vues de document) ; en-têtes `X-Utilisateur` / `X-Profil` en attendant l'authentification ; `ErreurApi`.
- `src/app/societe.js` : `sousDomaine`, `societeCourante` (une base par sous-domaine).
- `src/app/pages/index.js` : `ROUTES` → `/`, `/liste/:theme?`, `/fiche/:type/:id`, `/document/:id` (`demo`, `nouveau?type=`, `import?jeton=`), `/ged/:id?`, `/parametres` (+ `/bibliotheque`, `/annuaire`, `/documents`), `/annuaire/graphe`, `/annuaire/societe`, `/import/optimbtp`, `/404`. Chaque page dérive de `PageBase`.
- `src/app/pages/document.js` : `PageDocument` (éditeur, `Disposition`, `PlanDocument`, `RechercheLignes`, vues de colonnes, onglets Analyse / Pièces (GED) / Traçabilité, rattachement, transformation, import à vérifier).
- `src/app/navigation/menus.js` (`MENUS_METIER`, `menus(app)`, `catalogueRaccourcis`, `RACCOURCIS_DEFAUT`, création rapide `creation: { url, titre }`) ; `navigation/widgets.js` (`catalogueWidgets`, `WIDGETS_DEFAUT`).
- `src/app/editeur-btp.js` : `ReglesBtp`, `PressePapiersBtp`, `DictionnaireBtp`, `EditeurDevisBtp` ; `panneaux-btp.js` : `PanneauxBtp` (entête : mode de calcul, variables `$$`, rattachement, annuaire du document, rédacteur ; détail : métré, perte, blocages, déboursé, marge) et `individusSociete`.
- `src/app/analyse-calcul.js` (calculs sans interface : `feuillesAnalyse`, `agreger`, `forcerMontant`, `elementsAnalyse`, `modificationsElement`, `repartirQuantite`) ; `analyse-coefs.js` (`AnalyseCoefficients`, onglet Analyse).
- `src/app/demo.js` (`DOCUMENT_DEMO`, `DEFINITION_DEMO`, `ID_SECTION_DEMO`) ; `demo-lots.js` (`lignesLotsDemo`, `coderDemo`, `NAT`) ; `donnees-demo-liste.js` (générateur déterministe : salariés, matériels, ressources, documents).
- `src/app/vues-liste.js` (`SOURCES_LISTE`, `THEMES_LISTE`, `VUES_LISTE`) ; `vues-document.js` (`VUES_DOCUMENT`, `MODELES_DOCUMENT`, `ETIQUETTES_LIGNE`, `COULEURS_TYPE_PRIX`) ; `variables-tranche.js` (paramètres `$` d'un titre ou d'une section).
- `src/app/fiches/` : `definitions.js` (`TYPES_FICHE`, `DROITS_FICHE`, `PARAMETRAGE_FICHE`, `ficheDeLigne`), `fiches.js` (`FicheLogiBTP`, `FicheSalarie`, `FicheMateriel`, `creerFournisseurFiche`), `fiche-element.js` (`FicheElement`), `fiche-annuaire.js` (`FichePersonne`, `FicheIndividu`), `fiche-structure.js` (`FicheProjet|Affaire|Chantier|Marche`, `prochainCode`, `codeMarche`, `RACCOURCIS`), `classes.js` (`CLASSES_FICHE`).
- `src/app/structure/` : `structure.js` (`completerRattachement`, `controlerIntervenants`, `creerFournisseurStructure`, `FournisseurStructureMemoire`), `donnees.js` (démo + `FONCTIONS_INTERVENANT`), `selection.js` (`champRattachement`, `choisirRattachement`), `intervenants.js` (`TableIntervenants`), `marche-commande.js` (`proposerMarche`), `filtre-rattachement.js` (`FiltreRattachement`), `graphe-structure.js` (`VueGrapheStructure`).
- `src/app/documents/` : `transformation.js` (`ciblesTransformation`, `choisirTransformation`, `transformerDocument`), `tracabilite.js` (`afficherTracabilite`).
- `src/app/import/` : `formats.js` (`FORMATS_IMPORT`), `depot-import.js` (IndexedDB, jeton), `devis-importe.js` (`saisieDevisImporte`, `ecartsImport`), `devis-a-verifier.js` (`ouvrirImport`, `creerDepuisImport`), `rapport-import.js`.
- `src/app/bibliotheque/` : `bibliotheque.js` (`creerFournisseurBibliotheque`, `calculerOuvrage`, `calculerEnsemble`), `appel.js` (`AppelBibliotheque` : code, F3, dépôt), `envoi.js` (`EnvoiBibliotheque`, `compositionDepuisContenu`), `donnees.js` (démo).
- `src/app/annuaire/` : `annuaire.js` (`creerFournisseurAnnuaire`, `creerFournisseurEntreprises`, `relierTarifs`), `salaries.js` (`annuaireDesSalaries`, `synchroniserSalarie`), `donnees.js` (démo) ; `src/app/ged/ged.js` (`creerFournisseurGed`, démo) ; `src/app/listes.js` (`creerFournisseurListe`, `donneesDemo`, `estTypeDocument`).
- `src/calcul/` : `moteur-btp.js` (`MoteurDevisBtp extends MoteurDocument`, `calculerDocument`), `colonnes-btp.js` (`COLONNES_DOCUMENT_BTP`, `COLONNES_LIGNE_BTP`, décimales, calculées), `controles-btp.js` (`controlesValidation`, `natureObligatoire`), `index.js` (`CHAMPS_*_BTP`, `cleLigneBtp`, `comparerResultats`).
- `scripts/` : `generer-vues-liste.mjs` (SQL générés du cœur, voir `db/CLAUDE.md`), `exporter-resultats.mjs` (résultats JS → `tests/resultats-js/`), `generer-documents-demo.mjs <host> <id devis>` (documents de démo par l'API), `exemples-multilignes.mjs`.
- `test/` (Vitest) : `cas-partages` (`tests/cas/*.json`), `analyse-calcul`, `bibliotheque-appel`, `envoi-bibliotheque`, `controles-btp`, `import-devis`, `societe`, `structure` (dont parité `FONCTIONS_INTERVENANT` ↔ `db/162`).

## Spécialisation des modules
- **Document** : `EditeurDevisBtp`/`ReglesBtp`/`PressePapiersBtp` (`editeur-btp.js`), `PanneauxBtp` (`panneaux-btp.js`, `controlesSupplementaires`), `MoteurDevisBtp` (`calcul/moteur-btp.js`), colonnes `calcul/colonnes-btp.js`, vues `vues-document.js`, page `pages/document.js`, transformation `documents/`.
- **Métré** : `DictionnaireBtp extends DictionnaireMetre`, `PanneauMetre` dans la page document et la fiche élément ; moteur via `Portees`, `EvaluateurMetre`.
- **Liste** : `listes.js` + `vues-liste.js` ; `pages/liste.js` (`ListeDonnees`, options `filtresVue` → `FiltreRattachement`, `actionsElements`, `glisser`).
- **Fiche** : `fiches/*` (classes dérivées de `FicheBase` via `FicheLogiBTP`), `pages/fiche.js`.
- **GED** : `ged/ged.js`, `ExplorateurGed` dans `pages/ged.js`, `pages/fiche.js`, `pages/document.js`.
- **Bibliothèque** : `bibliotheque/*`, `fiche-element.js`, `pages/parametres-bibliotheque.js`, `PanneauArbres` dans `pages/liste.js`.
- **Annuaire / Entreprises FR** : `annuaire/*`, `fiche-annuaire.js`, `pages/graphe.js` (`VueGrapheAnnuaire`), `pages/parametres-annuaire.js`.
- **Graphe** : `structure/graphe-structure.js` (`VueGrapheStructure extends VueGraphe`). **Navigation** : `application.js`, `navigation/*`, pages. **Import** : `import/*`, `pages/import-optim.js`.

## Conventions et pièges
- Montants en decimal.js (`D`, `S`, `arrondir` du socle), jamais `Number` ; toute règle de `moteur-btp.js` se reporte dans `src/LogiBTP.Calcul/MoteurDevisBtp.cs` avec un cas dans `tests/cas`.
- Colonnes de `colonnes-btp.js` alignées sur `DocumentBtp` / `DocumentLigneBtp` (test xUnit `Colonnes_btp_alignees_avec_le_moteur_js`).
- Répliques C# : `controlesValidation` ↔ `SpecialisationBtp.ControlerValidation` ; `controlerIntervenants` ↔ `Intervenants.Controler` ; `synchroniserSalarie` ↔ `SalariesAnnuaire.Synchroniser` ; `completerRattachement` ↔ `PUT /api/structure/documents/{id}/rattachement` ; règles de `fiches.js` / `fiche-annuaire.js` ↔ `SpecialisationFicheBtp`.
- `vues-liste.js`, `fiches/definitions.js`, `vues-document.js`, `bibliotheque/donnees.js`, `annuaire/donnees.js`, `structure/donnees.js` : source unique (démo hors ligne + SQL généré) → après modification, `npm run generer-vues-liste --workspace client`.
- Ouverture d'écran : `app.naviguer(url, { nouvelleFenetre })`, jamais de panneau superposé. Listes de choix : combos saisissables (`ListeDeroulante`), jamais de `<select>` simple. Préférences dans le `localStorage`.
- Hors ligne, `liste.verifierModification` imite `SpecialisationListeBtp` (fiche en modification → 409).

## Commandes
- `npm install` (racine) ; `npm test` (tous workspaces) ou `npm test --workspace client` ; `npm run dev` (Vite, port 5173).
- `npm run exporter-resultats` puis `dotnet test LogiBTP.slnx` : parité complète des moteurs.
- Démo : API `dotnet run --no-build --project src\LogiBTP.Api --launch-profile http` (5080), base PostgreSQL sur 5433 ; société « demo » par http://demo.localhost:5173.
