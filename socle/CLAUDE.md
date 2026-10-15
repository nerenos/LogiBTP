# Socle – contexte

## Rôle
- Briques **sans métier** communes à tous les modules et au cœur : calcul décimal, arrondi commercial, formules `{{…}}`, références, libellés, JSON, composants d'interface (grille arborescente, combos, état annulable, préférences, raccourcis, thème), outils de tests partagés JS / C#, socle ASP.NET Core (sociétés, utilisateur, erreurs métier).
- Aucun nom de table métier ici, sauf les configurations d'arbre `CFG_LIGNES` / `CFG_METRE` (noms de colonnes génériques).

## Dépendances
- Dépend de : `decimal.js`, `immer` (JS) ; `Microsoft.AspNetCore.App` (Socle.Web seulement). Ne dépend d'aucun module ni du cœur.
- JS `@logibtp/socle` (workspace `socle/js`) : dépendance de tous les modules JS (sauf `import`) et de `client`.
- .NET : `LogiBTP.Socle` ← projets de calcul des modules (Documents, Metres, Bibliotheque, Listes, Fiches, Annuaire) et `src/LogiBTP.Calcul` ; `LogiBTP.Socle.Web` ← projets `*.Web` des modules et `src/LogiBTP.Api` ; `LogiBTP.Socle.Testing` ← tous les `*.Tests` et `tests/LogiBTP.Calcul.Tests`.

## Structure
- `js/package.json` : exports `.` → `src/calcul/index.js`, `./ui` → `src/ui/index.js`, `./ui/socle.css`, `./testing` → `testing/index.js`.
- `js/src/calcul/decimal.js` : `Dec` (decimal.js cloné, précision 34, ROUND_HALF_UP), `D`, `Dz`, `coef`, `S`, `arrondir`, `arr6`, `formatNombre`.
- `js/src/calcul/expression.js` : analyseur de formules sans `eval` (grammaire identique à `Expression.cs`), `ErreurCalcul`.
- `js/src/calcul/references.js` : `analyserReference` (variable `$$ $ @@ @` ou donnée `table[id].colonne`), `analyserCibleVariable`.
- `js/src/calcul/libelles.js` : `remplacerVariables`, `texteBrut`, `formaterValeur`, `echapperHtml`.
- `js/src/ui/grille.js` : `GrilleArbre` (≈580 l., mode ligne / édition, glisser-déposer, dépôt externe, `definirColonnes`).
- `js/src/ui/liste-deroulante.js` : `ListeDeroulante` (combo, mode strict), `AssistantFormule` (`{{` ou Ctrl+Espace).
- `js/src/ui/etat.js` : `Magasin` (pile annuler / rétablir par patchs Immer, `lectureSeule`, `surRefus`).
- `js/src/ui/arbre.js` : opérations d'arbre pures paramétrées par `cfg` (`enfants`, `ordreAffichage`, `parId`, `ancetres`, `descendants`, `racinesSelection`, `renumeroter`, `placer`, `indenter`, `desindenter`, `decaler`, `supprimer`).
- `js/src/ui/format.js` : `lireNombre`, `formatNombre` (Intl fr-FR), `formatLibre`, `htmlSur` (liste blanche alignée sur HtmlSanitizer serveur), `echapper`, `estHtml`, `decoderEntites`.
- `js/src/ui/preferences.js` : `lirePreferences` / `ecrirePreferences` (clé `localStorage` `logibtp.affichage`, fusion).
- `js/src/ui/raccourcis.js` + `raccourcis.json` : raccourcis de la grille (`combinaison`, `actionDe`, `libelleRaccourci`, `configurerRaccourcis`).
- `js/src/ui/editeur-riche.js` : `editerLibelle({ html, titre, variables })` → Promise (HTML, null si vidé, undefined si annulé).
- `js/src/ui/theme.js` : `THEMES` (auto / clair / sombre), `appliquerTheme` (`<html data-theme>`) ; `socle.css` (importé par `client/src/main.js`).
- `js/testing/index.js` : `lireCas`, `egal`, `verifier`, `verifierErreurs` (Node, pour les suites de jeux partagés).
- `dotnet/LogiBTP.Socle/` : `ArrondiCalcul.cs`, `Expression.cs`, `References.cs`, `Libelles.cs`, `ErreurCalcul.cs`, `JsonCalcul.cs`, `AccesColonnes.cs`.
- `dotnet/LogiBTP.Socle.Web/` : `Societes.cs`, `Web.cs`. `dotnet/LogiBTP.Socle.Testing/CasPartages.cs`. `dotnet/LogiBTP.Socle.Tests/` : `SocleTests.cs`, `SocietesTests.cs`.
- `tests/expressions.json` : jeu partagé de l'analyseur (variables + cas `resultat` ou `erreur`).

## API publique
- JS `@logibtp/socle` : `Dec, D, Dz, S, ZERO, UN, coef, arrondir, arr6, formatNombre, evaluerExpression(texte, resoudre), referencesDe, ErreurCalcul(code, message), analyserReference, analyserCibleVariable, remplacerVariables(html, resoudre) → { texte, inconnues }, texteBrut, formaterValeur, echapperHtml`.
- JS `@logibtp/socle/ui` : tout `arbre.js` (+ `CFG_LIGNES` `lig_id/lig_parent_id/lig_ordre`, `CFG_METRE` `mli_*`), `GrilleArbre, Magasin, ListeDeroulante, AssistantFormule, lireNombre, formatNombre, formatLibre, htmlSur, echapper, estHtml, decoderEntites, lirePreferences, ecrirePreferences, actionDe, combinaison, libelleRaccourci, configurerRaccourcis, editerLibelle, THEMES, appliquerTheme`.
- `Magasin(saisie, { recalculer, identifiants, limite = 100 })` : `abonner`, `modifier(recette, libelle)`, `annuler`, `retablir`, `charger`, `appliquerServeur`, `prochainId` ; recalcul après chaque modification.
- `GrilleArbre(conteneur, { cle, colonnes, lignes(), actions })` : colonnes `{ cle, titre, valeur, editable, editeur: 'nombre'|'liste'|'select'|'formule', options, suggestions, classeCellule, titreCellule }` ; `editeur: 'select'` = `ListeDeroulante` strict, valeur lue par `resoudre()`.
- .NET `LogiBTP.Socle` : `ArrondiCalcul.Arrondir / Arr6 / Racine / FormatNombre` ; `Expression.Evaluer(texte, Func<string, decimal>)`, `Expression.References` ; `References.Analyser` → `ReferenceVariable(Portee, Nom)` | `ReferenceDonnee(Table, Id, Colonne)`, `References.AnalyserCible` ; `Libelles.EchapperHtml / FormaterValeur / Remplacer / TexteBrut` ; `ErreurCalcul(code, message)`, `MessageCalcul(LigId, Code, Message)` ; `JsonCalcul.Options` (snake_case, nombres lus en chaîne), `JsonCalcul.Cloner<T>` ; `AccesColonnes.Colonnes / Existe / Lire` (propriété PascalCase ↔ colonne snake_case, héritage inclus).
- .NET `LogiBTP.Socle.Web` : `ExceptionMetier(statut, code, message, details)` + fabriques `Introuvable` (404), `AccesRefuse` (403), `Conflit` (409), `Invalide` (422) ; `UseErreursMetier()` → JSON `{ status, code, title, details }`.
- `Utilisateur(Code, Profil, Groupe)` : `EstAdmin` (profil `ADMIN`), `Utilisateur.Depuis(http)` lit `X-Utilisateur` / `X-Profil` / `X-Groupe` (défauts `demo` / `ADMIN`) en attendant l'authentification.
- Sociétés : `OptionsSocietes` (section `Societes` : `Domaines`, `Principale` ← `ConnectionStrings:LogiBTP`, `LibellePrincipale`, `Liste`), `SocieteConfiguree`, `SocieteCourante(Code, Libelle, Connexion)` (`Principale` si Code null, injectée en scoped), `AddSocietes(configuration)`, `UseSocietes()` (sous-domaine de l'hôte ; inconnu → 404 `SOCIETE_INCONNUE` ; `www`, IP, domaine nu → base principale), `SousDomaine(hote, domaines)`.
- `CasPartages` : `RacineDepot` (dossier de `LogiBTP.slnx`), `Chemin`, `Fichiers` (MemberData), `Lire`, `Egal`, `Verifier`, `Trouver`, `VerifierErreurs`, `ColonnesJs(fichier, nom)` (lit un `NOM = new Set([...])` JS pour les tests d'alignement des colonnes).

## Règles répliquées JS / C#
- Arrondi : `arrondir` ↔ `ArrondiCalcul.Arrondir` (demi vers l'infini, jamais bancaire) ; `arr6` ↔ `Arr6` (NUMERIC(18,6)).
- Formules : `evaluerExpression` ↔ `Expression.Evaluer` (priorités usuelles, virgule ou point, `× ÷ −`, `{{référence}}`) ; jeu `socle/tests/expressions.json` rejoué par `js/test/expressions.test.js` et `SocleTests.Analyseur_expressions`.
- Codes d'erreur : `SYNTAXE`, `FORMULE_VIDE`, `DIVISION_ZERO`, `REFERENCE_INVALIDE` ; `VARIABLE_INCONNUE` levé par les résolveurs ; `RACINE_NEGATIVE` (C#).
- Références et libellés : `analyserReference` ↔ `References.Analyser`, `remplacerVariables`/`formaterValeur`/`texteBrut` ↔ `Libelles.*`, `formatNombre` (calcul) ↔ `ArrondiCalcul.FormatNombre` (virgule, zéros retirés, pas de `-0`).
- Comparaison des jeux : `egal` / `verifier` / `verifierErreurs` ↔ `CasPartages.Egal / Verifier / VerifierErreurs` (nombres en décimal exact, null = absent, codes d'erreur triés).

## Conventions et pièges
- Jamais de `Number` pour un montant : `D()` / `Dz()` / `coef()` ; `S()` pour sérialiser un décimal exact. `formatNombre` / `formatLibre` de `ui` passent par `Number` : affichage seulement.
- Deux `formatNombre` homonymes : `@logibtp/socle` (libellés, « 12,5 ») ≠ `@logibtp/socle/ui` (Intl, décimales fixes).
- `D('')`, `D(null)` → null ; `Dz` → 0 ; `coef` → 1.
- Le socle ne connaît aucun module : pas d'import de `modules/` ni du cœur ; toute spécialisation passe par options / rappels (`actions` de la grille, `recalculer` du Magasin, `resoudre` des formules).
- Préférences d'affichage uniquement via `lirePreferences` / `ecrirePreferences` (navigateur, jamais en base) ; écrire = fusion, pas remplacement.
- Combos : `ListeDeroulante` strict (libellé affiché, valeur = identifiant) ; ne pas créer de `<select>` simple.
- Raccourcis de la grille dans `raccourcis.json` (éviter AltGr, Alt+Maj, Alt+←, Ctrl+N/T/W).
- `htmlSur` et le nettoyage HTML serveur doivent garder la même liste blanche de balises et de styles.
- C# : `TargetFramework` net10.0, `InvariantGlobalization` (Directory.Build.props) ; sérialiser avec `JsonCalcul.Options` pour garder les noms de colonnes du DDL.
- Cache singleton dépendant du schéma : l'indexer par base (`SocieteCourante.Connexion`).

## Tests
- JS : `npm test --workspace socle/js` (vitest) ; tout le dépôt : `npm test` à la racine.
- .NET : `dotnet test socle/dotnet/LogiBTP.Socle.Tests` ; tout : `dotnet test LogiBTP.slnx`.
- Modifier une règle répliquée : JS + C# + cas dans `socle/tests/expressions.json`, puis les deux suites.
