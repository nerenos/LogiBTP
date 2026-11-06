# Module GED – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données et triggers, points de spécialisation, archivage automatique, raccourcis de l'explorateur, routes) : [GED.md](../../documentation/modules/GED.md).

## Rôle et dépendances
- Documents stockés sur le serveur (contenus rangés par empreinte SHA-256, dépôts identiques partagés), liés à un élément quelconque (`type_element`, `id_element`), classés dans des répertoires, versions, aperçu, mails (.eml / .msg avec pièces jointes), suppression par masquage, coffre-fort (journal chaîné immuable).
- Versions : `etape` (VALIDATION, ENVOI, RECEPTION, SIGNATURE, REFUS, ARCHIVAGE) toutes conservées ; `edition` (dépôts, modifications) : seules les N dernières (`editions_conservees`, 5 par défaut).
- Cycle de vie : confidentialité et accès, texte extrait et plein texte, classification automatique au dépôt, dérivations, rétention (archivage puis fin de conservation), archive séparée.
- Explorateur `ExplorateurGed` (classe mère) : arbre (nœuds automatiques d'une `ArborescenceGed` + répertoires créés), chemin servant de filtre, vue icônes ou détails, dock d'informations ; raccourcis du groupe `ged` par `actionDe`, jamais de touche en dur.
- Dépend du socle seul ; utilisé par le cœur (`SpecialisationGedBtp`, `ArborescenceBtp`, onglets Pièces et fiches). Documents d'une société rangés sous le nom de sa base (`SocieteCourante.Base`).
- Rattachement des documents du cœur : `type_element` = `tyd_code`, `id_element` = `ent_groupe_id ?? ent_id` (groupe des indices).

## Parité JS / C# (jeux `tests/cas`)
- Coffre `coffre.js` ↔ `ChaineCoffre.cs` (01 ; texte d'entrée, horodatage ISO UTC à la milliseconde) ; versions `versions.js` ↔ `RegleVersions.cs` (02 ; courante jamais purgée, rien au coffre) ; normalisation `recherche.js` ↔ `NormalisationGed.cs` ↔ `f_ged_normaliser` (03) ; rétention `retention.js` ↔ `RegleRetention.cs` (04) ; classification `classification.js` ↔ `ClassificationGed.cs` (05) ; accès `acces.js` ↔ `AccesGed.cs` (06).
- Règles par défaut de rétention et de classification identiques aux INSERT de `db/051`. `FournisseurGedMemoire` reproduit `ServiceGed` (mêmes codes `ErreurGed`).
- Toute règle modifiée : les deux côtés et le jeu de cas.

## Règles et pièges
- **Ne jamais contourner les triggers de `db/050`** (ni DELETE, TRUNCATE ou désactivation, ni « sortie » du coffre, même en démo ou en test). L'archive séparée ne prend jamais un document du coffre : une famille qui en contient un est archivée sur place (`dge_archive`).
- Document au coffre : ni version, ni étape, ni changement d'élément ; seul le classement change ; mise au coffre refusée si le contenu recalculé diffère (`INTEGRITE`).
- Accès : auteur du dépôt et accès listés toujours ; SECRET : personne d'autre ; CONFIDENTIEL : + administrateurs. Confidentialité modifiable par l'auteur ou un administrateur ; saisie au dépôt prioritaire sur la classification. `v_liste_ged` ne montre que PUBLIC / INTERNE sans accès listés (le module Liste n'applique pas les accès).
- Répertoire : un document classé dans le répertoire d'un autre élément est lié à cet élément (pièces jointes comprises) ; suppression d'un répertoire vide seulement.
- Purge : document déjà masqué, jamais au coffre ; masquer un mail masque ses pièces jointes.
- Contenu servi : type MIME jamais de confiance ; `inline` seulement par `AffichageContenu`, toujours `nosniff` et `Content-Security-Policy: sandbox` ; aperçu : cadre PDF seul, sans attribut `sandbox`.
- Dépôt multipart lu par le service (pas d'`IFormFile`) ; ne jamais poser le Content-Type d'un FormData.
- Archivage automatique (`ArchivageGed`, chaque nuit et par base) : `AppliquerRetentionSysteme` sans filtre d'accès ; la route `/retention/appliquer` garde le filtre de l'administrateur.
- Recherche normalisée par `SansAccent.Retirer` du socle (l'application tourne en `InvariantGlobalization`).

## Personnalisation (lot P3f)
- Textes `ged.*`, icônes `ged_*`, couleurs `--ged-*` de `js/personnalisation/` ; gardés en littéraux : règles par défaut (copies de `db/051`) et raisons de rupture du coffre (parité avec `ChaineCoffre.cs`).

## Tests
- `npm test --workspace modules/ged/js` ; `dotnet test modules/ged/dotnet/LogiBTP.Ged.Tests` (ou `dotnet test LogiBTP.slnx`) ; `LOGIBTP_TEST_PG` : normalisation SQL comparée au jeu.

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Module GED : chaîne du coffre-fort répliquée entre `modules/ged/js/src/coffre.js` et `ChaineCoffre.cs` (texte d'entrée, horodatage à la milliseconde UTC, jeu `01_coffre.json`), conservation des versions entre `versions.js` et `RegleVersions.cs` (jeu `02_versions.json`) ; `FournisseurGedMemoire` applique les mêmes règles que `ServiceGed`. Le journal et les documents du coffre sont protégés par des triggers (`db/050`) : ne jamais les contourner. Organisation et cycle de vie (`db/051`, rejouable) : répertoires, confidentialité et accès (`acces.js` ↔ `AccesGed.cs`, jeu `06_acces.json`), texte extrait et plein texte, dérivations, rétention (`retention.js` ↔ `RegleRetention.cs`, jeu `04` ; règles paramétrées dans `/parametres/ged`, archivage automatique chaque nuit et par base : `ArchivageGed`, section `Ged:Archivage`), classification automatique (`classification.js` ↔ `ClassificationGed.cs`, jeu `05`), archive séparée (jamais pour le coffre : archivage sur place). Explorateur : arborescence du cœur `ArborescenceBtp` (`client/src/app/ged/arborescence.js` : Projet › Affaire › Chantier › Marché › famille (Ventes, Achats, Stock) › type de document › documents, dossiers virtuels pour la famille et le type ; liens symboliques vers les documents enfants dans un regroupement, enfants imbriqués depuis un document) ; un dépôt dans un dossier lie la pièce à l'élément du dossier.
