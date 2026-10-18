# Métré en script – conception (réalisée)

La saisie en grille (lignes Valeur / Sous-détail / Sous-total, onglet Définition) est remplacée par un
**éditeur de code** : le métré d'une ligne est un petit script. À côté de l'éditeur, une **grille des
variables** montre les variables du métré (non locales) et permet d'en corriger les valeurs.

## 1. Langage

Syntaxe inspirée du WLangage. Mots-clés et noms de fonctions **insensibles à la casse et aux accents**
(`numérique` = `numerique` = `Numérique`, `EntierSupérieur` = `EntierSuperieur`) ; noms de variables
sensibles à la casse (comme aujourd'hui).

### Exemple (celui de la demande, dans la syntaxe retenue)

```
MaChaine est une chaîne
NombrePoint est un numérique
MaLargeur est un numérique = 1.500
MaHauteur est un numérique = 0.85
local Longueur_profile est un numérique
local NombreMontant est un numérique
MaCouleurEstStandard est un booléen = Vrai

NombrePoint = (
        + 2       // en haut
        + 3       // à gauche
        + 3 - 1   // sur la droite à cause de la poignée
        - 2       // en bas
    )
    * 2           // car il y a 2 côtés

NombreMontant = EntierSupérieur(MaLargeur / 1.200)
Longueur_profile = @@Perte * 2 * (MaLargeur + MaHauteur) + NombreMontant
Longueur_profile = EntierSupérieur(Longueur_profile / {{lig_longueur}})   // longueur de barre de l'élément

Si MaCouleurEstStandard alors
    {{lig_libelle_html}} += " RAL standard"
Sinon
    {{lig_libelle_html}} += " RAL personnalisable"
Fin

Renvoyer Longueur_profile
```

### Déclarations (bloc d'en-tête)
- `[local] Nom est un|une <type> [= expression]`, uniquement **avant la première instruction**
  (le bloc de déclaration est le maître de la définition des variables).
- Types : `chaîne`, `numérique`, `booléen` (alias `bool`). Valeur par défaut sans `=` : `""`, `0`, `Faux`.
- Sans `local` : **paramètre du métré** → affiché dans la grille, enregistré (`variable_definition`),
  publié en portée `@` de la ligne (lisible par `{{@MaLargeur}}` dans le libellé et les variables de la ligne).
- Avec `local` : interne au script, ni affiché ni enregistré.
- Variable non déclarée utilisée → erreur `VARIABLE_INCONNUE` ; déclarée deux fois → `DECLARATION_DOUBLE`.
- Toute erreur de script est signalée mais **ne bloque jamais l'enregistrement** (§ 4 bis).

### Instructions
| Instruction | Forme |
|---|---|
| Affectation | `x = expr` |
| Affectation composée | `x += expr`, `x -= expr`, `x *= expr`, `x /= expr` (`+=` concatène une chaîne) |
| Incrémentation | `x++`, `x--` (numérique) |
| Condition | `Si cond alors … [SinonSi cond alors …] [Sinon …] Fin` |
| Boucle | `Pour i = 1 à n [pas p] … Fin` (i déclaré local implicite, pas négatif permis ; limite de 10 000 tours → `BOUCLE_INFINIE`) |
| Sortie de boucle | `Sortir` (quitte la boucle), `Continuer` (tour suivant) ; hors boucle → `SYNTAXE` |
| Résultat | `Renvoyer expr` : termine le script, la valeur (numérique) est la quantité du métré |

### Expressions
- Opérateurs avec priorité mathématique : `+ - * /`, `modulo`, unaires `+ -` ; comparaisons `= <> < <= > >=` ;
  logique `et`, `ou`, `pas` ; `+` entre chaînes = concaténation (un numérique ajouté à une chaîne est
  formaté). `=` dans une condition est une comparaison.
- Littéraux : nombres à **point ou virgule décimale** (`1.500` = `1,500`) — le **point-virgule** sépare
  les arguments de fonction (`Arrondi(x; 2)`, `Max(a; b; c)`) ; chaînes `"…"` (`""` pour un guillemet) ; `Vrai`, `Faux`.
- Commentaires `//` jusqu'à la fin de la ligne.
- Une instruction continue sur la ligne suivante tant qu'une parenthèse est ouverte, ou si la ligne
  suivante commence par un opérateur binaire (`* 2` de l'exemple).
- Références (inchangées) : données `{{lig_qte}}`, `{{document_ligne[12].lig_qte_vendue}}` ; variables de
  portée `@@Perte`, `$largeur`, `$$taux`, `@surface` — avec ou sans `{{ }}`.
- Écriture vers l'extérieur : `@@Poids = …`, `$x += …` (comme l'ancien `mli_variable`, mêmes règles de
  portée : `+=` exige une variable existante) ; champs de la ligne : seul `{{lig_libelle_html}}` est
  inscriptible (§ 3).
- Fonctions : `EntierSupérieur(x)`, `EntierInférieur(x)`, `Arrondi(x[; n])` (demi vers l'infini, la
  fonction d'arrondi du socle), `Tronque(x[; n])`, `Min(a; b; …)`, `Max(a; b; …)`, `Abs(x)`, `Racine(x)`,
  `Puissance(x; n)`, `Taille(ch)`. Codes supplémentaires : `ARGUMENTS`, `REFERENCE_INVALIDE`,
  `RACINE_NEGATIVE`, `DEPASSEMENT` (limites du decimal C#, reproduites en JS), `ECRITURE_INTERDITE`. Liste extensible par l'hôte (point de spécialisation) ; chaque
  fonction porte sa signature et sa description (dictionnaire et autocomplétion).
- Données techniques de la ligne : colonnes `lig_poids`, `lig_surface`, `lig_volume`, `lig_hauteur`,
  `lig_largeur`, `lig_epaisseur`, `lig_longueur` (cœur, `ALTER TABLE document_ligne`), recopiées des
  caractéristiques de l'élément de bibliothèque à l'insertion (`ele_*` ; ajout de `ele_longueur`),
  modifiables sur la ligne (détail). Dimensions converties en **mètres** sur la ligne (l'élément les
  garde en mm) pour des formules lisibles : `{{lig_longueur}}` = 6 pour une barre de 6 000 mm.

### Calcul
- Décimal exact (decimal.js / `decimal`), valeur numérique arrondie à 6 décimales à chaque affectation
  (`arr6`, comme les portées actuelles).
- Erreurs avec numéro de ligne et colonne : `SYNTAXE`, `TYPE` (ex. chaîne × nombre, condition non
  booléenne), `VARIABLE_INCONNUE`, `DECLARATION_DOUBLE`, `DIVISION_ZERO`, `PORTEE`, `FONCTION_INCONNUE`,
  `BOUCLE_INFINIE`, `RESULTAT_TYPE` (Renvoyer d'une chaîne). L'analyse continue après une erreur de
  syntaxe (reprise à l'instruction suivante) pour les signaler toutes ; l'exécution s'arrête à la
  première erreur d'exécution.
- **Sans `Renvoyer`** : le métré ne donne pas de quantité ; la ligne garde sa quantité saisie, l'option
  « quantité issue du métré » est désactivée et un avertissement `METRE_SANS_RESULTAT` est affiché.

## 2. Grille des variables (à côté de l'éditeur)
- Une ligne par variable **non locale** : nom, type, valeur.
- **Modifiable** seulement si la variable est un pur paramètre : déclarée dans l'en-tête et jamais
  réaffectée dans le corps du script (ni `=`, ni `+=`, ni `++`). Modifier la valeur **réécrit la valeur
  par défaut dans la déclaration** du script (le texte reste la seule source).
- Les autres affichent leur valeur calculée, en lecture seule.
- En dessous : résultat (`Renvoyer`), messages d'erreur (clic → ligne de l'erreur dans l'éditeur).

## 3. Modèle et moteurs
- `metre.mtr_script TEXT` : la formule du métré. `mtr_resultat` inchangé.
- `variable_definition` (`var_mtr_id`) : une ligne par variable non locale, synchronisée depuis le script
  à l'enregistrement (`var_portee` `@`, `var_nom`, `var_formule` = valeur par défaut déclarée,
  `var_valeur` = dernière valeur calculée ; ajout d'une colonne `var_type` C/N/B). Ces lignes ne sont
  plus évaluées séparément : c'est le script qui les calcule.
- Libellé : le script lit `{{lig_libelle_html}}` = libellé saisi et l'écrit dans un **libellé calculé**
  qui sert de source à la passe des libellés (`lig_libelle_affiche` / `lig_libelle_brut`). Le libellé
  saisi n'est jamais modifié (pas de cumul au recalcul). Point d'accroche ajouté aux deux
  `MoteurDocument` : `sourceLibelle(l)` (défaut `lig_libelle_html`), spécialisé par le moteur BTP.
- Libellé écrit : le texte ajouté avant ou après le libellé courant est échappé (HTML sûr) ; un texte qui ne le
  contient pas est échappé en entier (`libelleEcrit` / `LibelleEcrit`). En cas d'erreur, le libellé reste celui saisi.
- Seules les variables numériques sont publiées en portée `@` (les portées ne stockent que des décimaux) ;
  l'avertissement `METRE_SANS_RESULTAT` n'est émis que si la quantité de la ligne vient du métré.
- Le module reste indépendant de l'hôte : l'interpréteur reçoit `resolveur`, `portees`, `ligneId` et
  `ecrire(reference, valeur)` (l'hôte décide des champs inscriptibles).
- Ordre dans le moteur BTP : le script s'exécute à la place de l'ancien métré (`quantiteBase`), donc avant
  la quantité vendue (lire `{{lig_qte_vendue}}` reste une erreur, comme aujourd'hui pour les lignes de métré).
- Réplication : `modules/metre/js/src/script/` (lexeur, analyseur, interpréteur) ↔
  `LogiBTP.Metres/Script/` ; jeux `modules/metre/tests/scripts/*.json` (l'exemple ci-dessus, chaque instruction,
  chaque erreur), cas cœur dans `tests/cas` (quantité, avertissement sans résultat, libellé calculé).

## 4. Éditeur
- **CodeMirror 6** (dépendance npm du module Métré, interface seulement) : coloration, numéros de ligne,
  indentation automatique, annulation, soulignement des erreurs, autocomplétion (mots-clés, types,
  fonctions, variables déclarées, et après `{{` ou `@`/`$` : le dictionnaire actuel avec valeurs).
- L'éditeur a sa propre annulation de frappe ; chaque validation (pause de saisie / sortie de l'éditeur)
  pousse **une** étape dans la pile d'annulation de l'hôte.
- Recalcul en direct (anti-rebond ~300 ms) : résultat et grille mis à jour pendant la frappe.
- Panneau : éditeur à gauche, grille des variables + résultat à droite, **dictionnaire repliable** en
  trois groupes : variables et données utilisables (avec valeurs), fonctions (`Arrondi`, `Racine`,
  `Puissance`… avec signature et description), structures de code (`Si … alors … Sinon … Fin`,
  `Pour … à … Fin`, déclaration…) insérées comme gabarits à compléter (Tab : champ suivant).
  Disponible dans la page document et dans la fiche élément (composition d'ouvrage / ensemble).

## 4 bis. Erreurs, comme dans un IDE
- Une erreur de script ne bloque ni la saisie, ni le calcul du reste du document, ni l'enregistrement :
  le métré en erreur ne donne pas de quantité (comme sans `Renvoyer`) et le moteur émet l'erreur sur la
  ligne (code, message, ligne et colonne du script).
- Dans l'éditeur : soulignement à la position, marque dans la marge, message au survol.
- Dans la grille du document : marque d'erreur sur la ligne porteuse du métré (mécanisme existant des
  erreurs par ligne).
- **Panneau de notifications** (dock du bas de la page document) : liste de toutes les erreurs et
  avertissements des métrés du document (ligne du document, ligne/colonne du script, message) ; un clic
  sélectionne la ligne, ouvre son métré et place le curseur sur l'erreur. Compteur dans le bandeau.

## 5. Existant
- Les métrés en lignes V/D/S et les variables de l'onglet Définition sont **convertis en script**
  (`convertirMetre` / `ConversionMetre.Convertir`, même texte des deux côtés) : chaque ligne devient une
  variable locale nommée selon sa position (`L1`, `L2_1`…), dans l'ordre de l'ancien évaluateur ; un niveau
  s'enchaîne sans priorité (`(L1 + L2) * L3`) ; commentaires repris en `//` ; `mli_variable` en
  affectations ; définitions reprises après le résultat (affecté d'abord à `mtr_variable`), sauf à partir de
  la première qui lit une quantité calculée : elle et les suivantes deviennent des variables de ligne.
- Migration : au démarrage de l'API, chaque base qui a encore `metre_ligne` est convertie en une transaction
  (métrés, définitions, compositions `ele_composition`), puis la table est supprimée. Données de
  démonstration réécrites à la main en scripts lisibles (`demo.js`, `bibliotheque/donnees.js`).
- Seul écart voulu avec l'ancien calcul : une erreur de métré ne bloque plus la ligne (quantité saisie).
- Les variables de **ligne** (`var_lig_id` sans métré) et du **document** (`$$`) restent telles quelles.

## 6. Découpage
1. ✅ Langage : lexeur, analyseur, interpréteur JS + C#, jeux de cas du module (`tests/scripts`).
2. ✅ Modèle et moteurs : `mtr_script`, `var_type`, synchronisation des variables, libellé calculé,
   données techniques de la ligne (`lig_*`, `ele_longueur`, recopie depuis la bibliothèque),
   intégration aux deux moteurs BTP, cas du cœur.
3. ✅ Conversion des anciens métrés et des données de démonstration, suppression de `metre_ligne`
   (migration au démarrage de l'API : `ConversionMetresBases`) ; saisie provisoire du script dans le panneau.
4. ✅ Interface : éditeur CodeMirror (`EditeurScript`), grille des variables, dictionnaire, panneau de
   notifications (`NotificationsMetre`, dock du bas de la page document, compteur dans la barre), fiche élément.
5. ✅ Documentation (`CLAUDE.md` du module, MODULES.md, TACHES.md).

## 7. Décisions prises
- Point **et** virgule décimale ; point-virgule entre les arguments.
- `{{lig_longueur}}` : colonne de la ligne issue des caractéristiques de l'élément (en mètres).
- Boucle `Pour … à … Fin` avec `Sortir` et `Continuer`.
- Anciens métrés convertis en script, puis `metre_ligne` et l'ancienne grille supprimés.
- Erreurs non bloquantes, affichées dans l'éditeur, sur les lignes et dans un panneau de notifications.
