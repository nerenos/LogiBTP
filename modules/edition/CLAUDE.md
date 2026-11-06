# Module Édition – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [EDITION.md](../../documentation/modules/EDITION.md).

## Rôle
- Éditions (impressions) des documents, fiches et listes : modèles en JSON stockés en base, mise en page paginée et rendus SVG (aperçu) et PDF ([CONCEPTION-EDITION.md](../../documentation/conception/CONCEPTION-EDITION.md)).
- **Un seul moteur JS, indépendant du DOM** : il mesure le texte lui-même (polices livrées, fontkit) et produit un arbre de pages positionné (mm) ; même code dans le navigateur (aperçu) et côté serveur dans **Jint** (PDF, GED). Exception assumée à la règle des moteurs miroirs : rien à répliquer en C#.

## Dépendances
- JS `@logibtp/edition` : `@logibtp/socle` (décimaux), `pdf-lib`, `@pdf-lib/fontkit`, `qrcode-generator` ; `esbuild` (construction du paquet serveur). Jamais du cœur ni d'un autre module.
- Utilisations par le cœur : voir le détail.

## Repères
- `dotnet/LogiBTP.Editions/moteur/moteur-edition.js` est généré (`npm run construire --workspace modules/edition/js`) et versionné : ne jamais l'éditer à la main.
- Guide des modèles et dictionnaire : [GUIDE-EDITIONS.md](../../documentation/GUIDE-EDITIONS.md), à tenir à jour avec le moteur ; `CATALOGUE_FONCTIONS` doit documenter toute fonction de `FONCTIONS` (test).
- Jint n'est pas réentrant : instances prêtées par `PoolMoteursEdition`. Production du serveur en file (`edition_tache`, `FOR UPDATE SKIP LOCKED`).
- Écritures des modèles et des chartes : `PeutParametrer` (administrateur).

## Règles
- Mesure = dessin : somme des chasses des glyphes de la table caractère → glyphe (`Polices`), sans crénage ni ligature, utilisée par la mise en ligne, le PDF (encodage pdf-lib par `fontkitEdition`) et l'aperçu (CSS : `font-kerning:none`, ligatures et `calt` désactivés).
- Arbre de pages et PDF déterministes : coordonnées arrondies au centième de mm, nombres PDF à trois décimales, date du PDF fournie ; PDF non compressé identique à l'octet entre Node et Jint (test C#) ; le serveur compresse par zlib .NET.
- Polices intégrées à chaque PDF (sous-ensembles TrueType, table ToUnicode) et rendues conformes par `truetype.js` : signature 0x00010000 (fontkit écrit « true »), sommes de contrôle des tables et ajustement de `head` recalculés, nom `ABCDEF+Inter-Regular` (préfixe déterministe) ; le PDF s'ouvre partout sans police installée.
- Montants : décimaux (`Dec`) dans les formules ; positions en nombres flottants (jamais de montant).

## Textes et icônes (module Personnalisation, lot P3r)
- Textes, icônes et couleurs par `js/personnalisation/` (règles et exceptions gardées en littéraux : voir le détail).

## Tests
- `npm test --workspace modules/edition/js` ; `npm run exporter-resultats --workspace modules/edition/js` puis `dotnet test modules/edition/dotnet/LogiBTP.Editions.Tests` (parité Node ↔ Jint, durées affichées).
- Après toute modification de `js/src` : `npm run construire --workspace modules/edition/js` (paquet serveur).

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Module Édition ([conception](documentation/conception/CONCEPTION-EDITION.md), [guide des rapports et dictionnaire](documentation/GUIDE-EDITIONS.md), `modules/edition/CLAUDE.md`) : un seul moteur JS sans DOM (mesure du texte par les polices livrées, Inter par défaut) exécuté dans le navigateur (aperçu SVG) et dans Jint côté serveur (`LogiBTP.Editions` : PDF) ; arbre de pages et PDF non compressé identiques à l'octet (jeux `modules/edition/tests/cas`) ; après toute modification de `modules/edition/js/src` : `npm run construire --workspace modules/edition/js`.
