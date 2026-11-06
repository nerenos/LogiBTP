# Socle – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [SOCLE.md](../documentation/modules/SOCLE.md).

## Rôle
- Briques **sans métier** communes à tous les modules et au cœur : calcul décimal, arrondi commercial, formules `{{…}}`, références, libellés, JSON, composants d'interface (grille arborescente, combos, état annulable, préférences, raccourcis, thème), outils de tests partagés JS / C#, socle ASP.NET Core (sociétés, utilisateur, erreurs métier).
- Aucun nom de table métier ici, sauf la configuration d'arbre `CFG_LIGNES` (noms de colonnes génériques).

## Dépendances
- Dépend de : `decimal.js`, `immer` (JS) ; `Microsoft.AspNetCore.App` (Socle.Web seulement). Ne dépend d'aucun module ni du cœur.
- Utilisations par le cœur : voir le détail.

## Repères
- Autres parités : dictionnaire `dictionnaire/resolution.js` ↔ `Dictionnaire.cs` (jeu `tests/dictionnaire.json`), accents `accents.js` ↔ `SansAccent.cs` (jeu `tests/sans_accent.json`, même résultat que `f_sans_accent`, `f_annuaire_normaliser`, `f_ged_normaliser` ; jamais `normalize`), codes communs `js/src/codes.js` ↔ `Codes.cs` (`CodesTests`), saisie des dates `completerDate` (jeu `tests/dates_saisie.json`).
- Dates « AAAA-MM-JJ » : `aujourdhui()` / `dateLocale(instant)` dans le fuseau du poste, jamais `toISOString().slice(0, 10)` (la veille entre 0 h et 2 h).
- Erreurs : `ErreurApi` / `appelApi` (`api.js`) côté client, `ExceptionMetier` + `UseErreursMetier()` côté serveur (`{ status, code, title, details }`) ; messages par `messageErreur` (`erreurs.<CODE>`).
- Utilisateur de la requête : `Utilisateur.Depuis(http)` (posé par l'authentification) ; droits par `IDroits` (`ExigeDroit(nœud, action)`), modules facultatifs par `ExigeModule(code, libellé)` (409 `MODULE_INACTIF`).
- Sociétés : `SocieteCourante` par sous-domaine (`UseSocietes`) ; tâches de fond : `OptionsSocietes.Societes()` puis `CreerPorteeSociete(societe)`.
- Sécurité web en tête du pipeline (`UseSecurite` : en-têtes, CORS, origine, limites de débit 429 `TROP_DE_REQUETES`) ; journaux masqués par `Masquage.Texte` ; CSP du client (`ClientWeb.Csp`) alignée sur `client/vite.config.js` par test.
- `Diffuseur` (événements serveur `GET /diffusion`) : mémoire du processus, une seule instance de l'API.
- Tests de parité : `CasPartages` (jeux), `Constantes.Ecarts` (codes JS ↔ C#), `ColonnesJs` (alignement des colonnes).

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
- Police : Inter (`@fontsource-variable/inter`, importée par `client/src/main.js`, famille `"Inter Variable"` en tête de `body` dans `socle.css`), aussi police par défaut des éditions ; montants et quantités en `font-variant-numeric: tabular-nums`.
- Dates : `<input type="date">` existants et à venir changés en champs à saisie abrégée par `activerDates(racine)` (appelé une fois par le client ; `src/ui/champ-date.js` : texte « jj/mm/aaaa », `value` toujours lue et écrite en « AAAA-MM-JJ » comme l'input natif — vide tant que la saisie n'est pas une date —, saisie complétée à la sortie et à Entrée puis `input` émis avant le `change`, pas d'`input` pendant la frappe, saisie impossible : classe `invalide` ; icône du calendrier dans le champ, F4 ou Alt+↓ : calendrier du navigateur ; `data-natif` : laissé tel quel). Règle `completerDate(saisie, reference)` (`src/calcul/dates.js`, jeu `tests/dates_saisie.json`) : « 15 » → jour du mois en cours, « 16/05 » → année en cours, « 15/05/23 » et « 15/05/0023 » → 2023, année < 100 au-delà de l'année en cours + 10 → 19xx, sans séparateur JJMM / JJMMAA / JJMMAAAA, « t » ou « a » = aujourd'hui, « +3 » / « -2 » jours ; aussi lue par la grille des documents (`lireDateSaisie`).
- Combos : `<select>` existants affichés en combos par `activerCombos(racine)` (appelé une fois par le client ; `comboDepuisSelect(select)` : le `<select>` masqué reste la valeur de référence, `change` et `input` relancés sur lui, combo reconstruit si ses options ou `disabled` changent ; `data-natif` ou `multiple` : laissé tel quel) ; nouveau code : hors grille, `creerCombo({ options, valeur, vide })` (`src/ui/combo.js` : champ texte + `ListeDeroulante` strict, `valeurCombo`, `resoudre()`, `definirValeur()`, événement `change`, classe `combo` ; options regroupées par leur propriété `groupe` : titre avant chaque groupe, ordre des groupes gardé au filtrage ; propriété `couleur` : pastille devant le libellé dans la liste et dans le champ, classe `avec-pastille` ; dans une fenêtre modale `dialog`, la liste y est rattachée pour s'afficher au-dessus) ; dans la grille, `editeur: 'select'`. Ne pas créer de `<select>` simple.
- Messages : `notifier({ titre, message, details, niveau, delai })` (`ui/notification.js`, fenêtre non modale à décompte, détails « Aller », événement `logibtp:notification` pour l'historique du bandeau) ; infobulles : `activerInfobulles()` (`ui/infobulle.js`, lit les `title`, aucun à réécrire) ; barres d'outils : `.barre-outils` > `.groupe-outils` (trait entre groupes).
- Fenêtres d'interaction : jamais `confirm()`, `alert()` ni `prompt()` du navigateur, ni de fond superposé en `div` : `confirmer` / `alerter` / `saisir` (`await`) ou un `<dialog>` (`showModal`, `ouvrirModale`) ; `:where(dialog)` donne le cadre et le fond assombri communs, chaque fenêtre garde sa classe.
- Raccourcis de la grille dans `raccourcis.json` (éviter AltGr, Alt+Maj, Alt+←, Ctrl+N/T/W) ; tout nouveau raccourci passe par `declarerRaccourcis` + `actionDe(e, groupe)` (personnalisable), jamais par un test de touche en dur.
- Chiffrement : la chaîne de l'installation (`.env`, hors dépôt ; `.env.exemple` versionné) ne change que par la rotation du module Installation (`installation cle-donnees changer` : valeurs rechiffrées, ancienne chaîne en `LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES`, que `Chiffrement(chaine, precedentes)` essaie au déchiffrement ; on chiffre et on calcule les empreintes toujours par la chaîne courante) ; toute nouvelle empreinte d'une valeur chiffrée se déclare dans `CommandeInstallation.Empreintes` du cœur.
- `htmlSur` et le nettoyage HTML serveur doivent garder la même liste blanche de balises et de styles.
- C# : `TargetFramework` net10.0, `InvariantGlobalization` (Directory.Build.props) ; sérialiser avec `JsonCalcul.Options` (ou `JsonCalcul.Web` : options web en snake_case) pour garder les noms de colonnes du DDL. Paramétrage (pages /parametres) : `u.ExigerParametres()` (droit MODIFIER du nœud `parametres`, l'administrateur toujours ; renseigné par le module Droits à chaque requête) ; comptes, profils, installation et modules restent `u.ExigerAdmin()` (ou `ExceptionMetier.ParametrageRefuse()`), jamais `AccesRefuse("PARAMETRER")`.
- Cache singleton dépendant du schéma : l'indexer par base (`SocieteCourante.Connexion`).

## Tests
- JS : `npm test --workspace socle/js` (vitest) ; tout le dépôt : `npm test` à la racine.
- .NET : `dotnet test socle/dotnet/LogiBTP.Socle.Tests` ; tout : `dotnet test LogiBTP.slnx`.
- Modifier une règle répliquée : JS + C# + cas dans `socle/tests/expressions.json`, puis les deux suites.
