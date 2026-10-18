# Module Édition – contexte

## Rôle
- Éditions (impressions) des documents, fiches et listes : modèles en JSON stockés en base, mise en page paginée et rendus SVG (aperçu) et PDF ([CONCEPTION-EDITION.md](../../documentation/conception/CONCEPTION-EDITION.md)).
- **Un seul moteur JS, indépendant du DOM** : il mesure le texte lui-même (polices livrées, fontkit) et produit un arbre de pages positionné (mm) ; même code dans le navigateur (aperçu) et côté serveur dans **Jint** (PDF, GED). Exception assumée à la règle des moteurs miroirs : rien à répliquer en C#.

## Dépendances
- JS `@logibtp/edition` : `@logibtp/socle` (décimaux), `pdf-lib`, `@pdf-lib/fontkit`, `qrcode-generator` ; `esbuild` (construction du paquet serveur). Jamais du cœur ni d'un autre module.
- .NET `LogiBTP.Editions` : `Jint`, `LogiBTP.Socle`. Polices : `js/polices/` (Inter 4.1 statique, Libre Barcode 39 ; OFL), copiées dans la sortie du projet .NET (`polices/`).

## Structure
- `js/src/` : `unites.js` (mm, formats A3–A6, longueurs %, mm, reste), `polices.js` (`Polices` : mesure sans crénage ni ligature, chiffres tabulaires `tnum`, `fontkitEdition` : mise en forme rapide installée pour pdf-lib), `texte.js` (`mettreEnLignes` : coupure, justification, ellipse, réduction, retraits), `html.js` (libellés HTML de la liste blanche sans DOM, Q19), `formules.js` (langage des champs, Q8 à Q10), `charte.js` (`CHARTE_DEFAUT`, styles, couleurs, traits), `composition.js` (composants → boîtes), `pagination.js`, `rapport.js` (`editer` : bandes, modes, sous-rapports), `etiquettes.js` (planches), `rendu-svg.js` (aperçu), `rendu-pdf.js` (`produirePdf`), `codes.js` (Code 39, QR), `images.js` (PNG / JPEG, refus du SVG), `modele.js` (format, contrôle, dépendances, cycles), `faces.js` (`FACES_EDITION`, `chargerPolices`), `base64.js`.
- `js/serveur/entree.js` : API globale `LogiBTPEdition` pour Jint (`initialiser`, `pages`, `pdf`, `verifierModele`, `dependances`, `lireImage`) ; paquet construit par `npm run construire --workspace modules/edition/js` → `dotnet/LogiBTP.Editions/moteur/moteur-edition.js` (généré, versionné, ressource embarquée).
- `dotnet/LogiBTP.Editions` : `MoteurEditionJs` (Jint : script, polices, `Pages`, `Pdf`, compression zlib .NET des flux via `__deflate`), `PoolMoteursEdition` (instances prêtées, Jint non réentrant).
- `tests/cas/*.json` (modèle, données ou `generer`, env) ; `tests/donnees/` ; `tests/resultats-js/` (généré par `npm run exporter-resultats --workspace modules/edition/js`, non versionné) ; aperçus HTML et PDF des essais dans `js/.essais/` (non versionné).

## Modèle (résumé, détail dans `js/src/modele.js`)
- Bandes : `ENTETE_PAGE`, `PIED_PAGE`, `FOND_PAGE` (filigrane, zones absolues), `CORPS` (aussi `TITRE`, `RESUME`) ; `pages` TOUTES / PREMIERE / SUIVANTES / DERNIERE / SAUF_DERNIERE ; modes UNIQUE, REPETE (`collection`), GROUPE (`rupture`, `entete`, `pied`, `regrouper`) ; options `saut_avant`, `saut_apres`, `saut_par_groupe`, `garder_ensemble`, `garder_avec_suivant`, `bas_de_page`, `chaque_page`.
- Composants : `champ` (valeur, style, format, alignement, multiligne auto|une|sauts, lignes_max, ellipse, reduction_min, html, masquer_si_vide, rotation, cadre, fond, marges, hauteur), `pile`, `rangee` (largeurs %, mm, `*`, meme_hauteur), `tableau` (colonnes, gabarits par condition : cellules fusionnées `de`/`a`, surcharges, retrait, fond, bordures, masquer, garder_avec_suivant, lie_au_precedent ; entête répétée, `cumul` → report, `remplir`), `repete`, `image` (ressource par code), `trait`, `espace`, `code39`, `qr`, `absolu`, `saut_page`, `bloc` (lié, paramètres), `sous_rapport` (trois niveaux).
- Formules : texte brut, gabarit `{{chemin}}`, expression `=…` ; résolution : `ligne`/`element`, `groupe`, `parametres`, `page`, `bloc`, puis racine des données ; erreur = champ vide + alerte (Q8).

## Règles
- Mesure = dessin : somme des chasses des glyphes de la table caractère → glyphe (`Polices`), sans crénage ni ligature, utilisée par la mise en ligne, le PDF (encodage pdf-lib par `fontkitEdition`) et l'aperçu (CSS : `font-kerning:none`, ligatures et `calt` désactivés).
- Arbre de pages et PDF déterministes : coordonnées arrondies au centième de mm, nombres PDF à trois décimales, date du PDF fournie ; PDF non compressé identique à l'octet entre Node et Jint (test C#) ; le serveur compresse par zlib .NET.
- Montants : décimaux (`Dec`) dans les formules ; positions en nombres flottants (jamais de montant).

## Tests
- `npm test --workspace modules/edition/js` ; `npm run exporter-resultats --workspace modules/edition/js` puis `dotnet test modules/edition/dotnet/LogiBTP.Editions.Tests` (parité Node ↔ Jint, durées affichées).
- Après toute modification de `js/src` : `npm run construire --workspace modules/edition/js` (paquet serveur).
