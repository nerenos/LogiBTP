# Module Métré – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [METRE.md](../../documentation/modules/METRE.md).

## Rôle
- Métrés en script ([CONCEPTION-SCRIPT.md](../../documentation/conception/CONCEPTION-SCRIPT.md)) qui donnent la quantité d'une ligne de l'hôte : déclarations typées en tête (chaîne, numérique, booléen ; `local` = interne), affectations et opérations composées, `Si`, `Pour` (`Sortir`, `Continuer`), fonctions, `Renvoyer` = quantité. Variables de calcul à portées (`$$` document, `$` titre, `@@` ouvrage, `@` ligne), lues et écrites par les scripts ou définies par l'hôte (`=` / `+=`).
- Les anciens métrés saisis en lignes (valeurs, sous-détails, sous-totaux, table `metre_ligne`) n'existent plus : `conversion.js` / `ConversionMetre.cs` les convertissent en scripts (migration des bases au démarrage de l'API : `src/LogiBTP.Api/Btp/ConversionMetresBases.cs`).
- Saisie : éditeur de code CodeMirror 6 (`EditeurScript` : coloration, indentation des blocs, complétion, erreurs soulignées et marquées dans la marge) dans `PanneauMetre`, dictionnaire repliable (variables et données, fonctions, structures), grille des variables du script ; erreurs et avertissements de tous les métrés du document dans `NotificationsMetre` (panneau ancrable de l'hôte). Les erreurs ne bloquent ni la saisie ni l'enregistrement.

## Dépendances
- Dépend de : socle (`Dec`, `D`, `S`, `ZERO`, `arr6`, `arrondir`, `formatNombre`, `analyserReference`, `analyserCibleVariable`, `referencesDe`, `evaluerExpression`, `ErreurCalcul` ; UI : `GrilleArbre`, `formatLibre`, `echapper`) et, pour l'interface seulement, CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `language`, `autocomplete`, `lint`, `@lezer/highlight`). Ne dépend PAS du module Document : il ignore la structure de l'hôte.
- Utilisations par le cœur : voir le détail.

## Repères
- L'hôte décide des données inscriptibles (`ecrire` du contexte du script, sinon `ECRITURE_INTERDITE`) et ajoute ses fonctions (cœur : `FONCTIONS_BTP` ↔ `FonctionsBtp.Catalogue`).
- Lignes `variable_definition` à `var_mtr_id` : produites par le moteur à chaque calcul, jamais évaluées comme définitions.
- Pas de projet Web ni de routes.

## Règles répliquées JS / C# et jeux de cas
- `script/*.js` ↔ `Script/*.cs` ; jeux `tests/scripts/*.json` (plusieurs cas par fichier : exemple, déclarations, expressions, instructions, fonctions, portées et données, erreurs d'analyse et d'exécution avec ligne et colonne), `test/cas-script.test.js` ↔ `CasScriptTests.cs`.
- `script-metre.js` ↔ `ScriptMetre.cs`, `portees.js` ↔ `Portees.cs`, `variables.js` ↔ `Variables.cs`.
- Conversion : `conversion.js` ↔ `ConversionMetre.cs` (même texte de script) ; jeux `tests/conversion/*.json` (anciens jeux du module : sous-détails, sous-totaux, somme de produits, définitions, erreurs ; cas limites ; définition lisant une quantité calculée → variable de ligne), `test/conversion.test.js` ↔ `CasConversionTests.cs` (+ conversion d'une composition JSON).
- Jeux du cœur qui l'exercent via le moteur BTP : `tests/cas/03_metres_sous_details.json`, `04_variables_increment_poids.json`, `12_variables_metre_affectation.json`, `15_ensemble_tranche_parametree.json` (convertis depuis les lignes), `16_metre_script.json` (quantité, variables régénérées, libellé calculé et échappé, erreur non bloquante).
- Codes : `SYNTAXE`, `TYPE`, `VARIABLE_INCONNUE`, `DECLARATION_DOUBLE`, `FONCTION_INCONNUE`, `ARGUMENTS`, `REFERENCE_INVALIDE`, `DIVISION_ZERO`, `RACINE_NEGATIVE`, `DEPASSEMENT`, `BOUCLE_INFINIE`, `RESULTAT_TYPE`, `ECRITURE_INTERDITE`, `PORTEE`, `OPERATION_INVALIDE` (portées) ; avertissement `METRE_SANS_RESULTAT` ; côté moteur BTP : `METRE_ABSENT`.

## Conventions et pièges
- Ne jamais importer `@logibtp/document` ni le cœur dans ce module ; toute connaissance de l'hôte passe par `hote` / `chaine` / le résolveur / le contexte du script.
- Ordre des définitions : `var_ordre` puis `var_id` (`parOrdre`) ; variables `$$` évaluées en premier par les moteurs ; variables de ligne après la quantité de la ligne ; le script s'exécute avant la quantité vendue (lire `{{lig_qte_vendue}}` y est une erreur).
- `+=` exige une variable déjà définie dans la chaîne ; `@` exige une ligne.
- Script : accents retirés par une table explicite identique JS / C# (`normaliser` / `Lexeur.Normaliser`), jamais par `Normalize(FormD)` (sans effet en globalisation invariante) ; limites du `decimal` C# reproduites en JS (`MAX_DECIMAL`, `DEPASSEMENT`) ; valeurs numériques arrondies à 6 décimales à l'affectation et au `Renvoyer` seulement ; analyse en erreur = pas d'exécution ; exécution arrêtée à la première erreur (10 000 tours par boucle, 100 000 instructions). Portées typées : décimal, chaîne ou booléen (`Portees.lireValeur` / `LireValeur`, `affecter` / `AffecterValeur`) ; `lire` / `Lire` (formules, quantités) exige un décimal (`TYPE`), les opérations composées aussi ; toutes les variables non locales d'un script sont publiées en `@` de la ligne ; un script affecte une chaîne ou un booléen à `$x`, `@@x`… ; les libellés les affichent (`lireVariableLibelle` des moteurs de document, booléen en Vrai / Faux).
- Conversion : chaque ligne devient une variable locale (`L1`, `L2_1`… selon sa position), dans l'ordre de l'ancien évaluateur (niveau le plus bas d'abord) ; un niveau s'enchaîne sans priorité (parenthèses) ; formule vide ou sous-total pointé invalide → 0 avec un commentaire ⚠.
- Éditeur : indentation d'une nouvelle ligne = celle de la ligne précédente non vide (tabulations conservées), + 1 après Si / Sinon / SinonSi / Pour ; Fin / Sinon / SinonSi alignés sur le bloc qu'ils ferment (`indentService`, lignes lues par le contexte : saut de ligne simulé). Focus donné après l'événement d'ouverture (F4 dans la grille). Texte remplacé de l'extérieur par différence (le curseur suit).
- Éditeur : une pause de saisie (300 ms) ou la sortie de l'éditeur = une étape d'annulation de l'hôte ; le texte de l'hôte ne remplace celui de l'éditeur que hors saisie en attente. Une fonction ajoutée au langage apparaît d'elle-même dans la complétion et le dictionnaire (signature, description).
- Toute règle modifiée : JS + C# + cas, puis `npm test`, `npm run exporter-resultats`, `dotnet test LogiBTP.slnx` (le moteur BTP en dépend).

## Textes et icônes (module Personnalisation, lot P3q)
- Textes, icônes et couleurs par `js/personnalisation/` (règles et exceptions gardées en littéraux : voir le détail).

## Tests
- `npm test --workspace modules/metre/js` (vitest : `test/cas-script.test.js`, `test/conversion.test.js`, `test/editeur-script.test.js` : modèles de fonctions et de structures).
- `dotnet test modules/metre/dotnet/LogiBTP.Metres.Tests` (`CasScriptTests.cs`, `CasConversionTests.cs`) ; jeux du cœur : `npm test` et `dotnet test LogiBTP.slnx`.

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Métré en script ([conception](documentation/conception/CONCEPTION-SCRIPT.md)) : langage répliqué entre `modules/metre/js/src/script/` et `LogiBTP.Metres/Script/` (jeux `modules/metre/tests/scripts`) ; dans les moteurs BTP, `Renvoyer` = quantité, erreurs non bloquantes (quantité saisie conservée), `{{lig_libelle_html}}` seule donnée inscriptible (libellé calculé, texte ajouté échappé), variables non locales régénérées en `variable_definition` (jeu `tests/cas/16_metre_script.json`) ; données techniques de la ligne (`lig_longueur`…, mètres) recopiées de l'élément. Plus de métrés en lignes : `metre_ligne` est convertie en scripts puis supprimée au démarrage de l'API (`ConversionMetresBases`, `ConversionMetre`). Saisie par l'éditeur CodeMirror du module (`EditeurScript`) ; erreurs non bloquantes listées dans le dock des notifications (`NotificationsMetre`).
