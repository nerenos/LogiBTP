# Guide des éditions : créer et modifier les rapports et sous-rapports

Ce guide explique comment un administrateur crée, modifie et teste les modèles d'édition (impressions des documents,
fiches et listes) de LogiBTP. Il se termine par le dictionnaire des données et des fonctions utilisables.

- Conception du module et décisions : [CONCEPTION-EDITION.md](conception/CONCEPTION-EDITION.md).
- Contexte technique du module : [modules/edition/CLAUDE.md](../modules/edition/CLAUDE.md).
- Le même dictionnaire est disponible dans l'application : bouton 📖 de l'éditeur du modèle (aperçu).

---

## 1. Les notions

| Notion | Rôle |
|---|---|
| **Rapport** | Modèle imprimable : format de page, présentations, paramètres, bandes. Un rapport s'imprime seul (devis, facture, fiche, liste, étiquettes). |
| **Sous-rapport** | Rapport inclus dans un autre, sur des données annexes (commandes du marché, situations précédentes…). Type `SOUS_RAPPORT` : jamais proposé seul à l'impression. Trois niveaux d'inclusion au plus. |
| **Bloc lié** | Morceau réutilisable (entête société, coordonnées, totaux, mentions, pied de page) inclus par plusieurs rapports. Modifier un bloc modifie tous les rapports qui l'utilisent. |
| **Bande** | Zone d'un rapport : entête ou pied de page, fond de page, corps (titre, détail, résumé). |
| **Composant** | Élément d'une bande : champ, pile, rangée, tableau, image, trait, code-barres… |
| **Formule** | Valeur d'un champ : texte fixe, gabarit `{{chemin}}` ou expression `=…`. |
| **Charte** | Styles de texte, couleurs, traits et marges nommés, partagés par les modèles. |
| **Source** | Origine des données : `document`, `fiche` ou `liste`. Le serveur prépare les données (§ 9). |

Tous les modèles sont des JSON stockés en base (`modele_edition`) ; chaque enregistrement crée une version
(`modele_edition_version`). Le même moteur JavaScript produit l'aperçu dans le navigateur et le PDF sur le serveur :
ce que montre l'aperçu est exactement ce qui sera imprimé.

### Modèles fournis

| Code | Rapport | Types |
|---|---|---|
| `DEVIS` | Devis | V_DEVIS |
| `COMMANDE_CLIENT` | Accusé de réception de commande | V_COMMANDE |
| `FACTURE` | Facture, avoir, acompte | V_FACTURE, V_AVOIR, V_FACTURE_ACOMPTE, V_RECU_ACOMPTE, V_DEMANDE_ACOMPTE |
| `SITUATION` | Situation de travaux | V_SITUATION, V_REPRISE_AVT |
| `FACTURE_AVANCEMENT` | Facture d'avancement | V_FACTURE_AVT |
| `BON_LIVRAISON` | Bon de livraison, bon de retour | V_RECEPTION, V_RETOUR |
| `COMMANDE_FOURNISSEUR` | Commande et demande de prix fournisseur | A_COMMANDE, A_DEVIS, A_RECEPTION, A_RETOUR |
| `PIECE_INTERNE` | Document interne | — |
| `FICHE`, `LISTE`, `ETIQUETTES_3X8` | Fiche, liste, étiquettes 70 × 37 mm | sources fiche et liste |
| `SR_DOCUMENTS_MARCHE`, `SR_FACTURATION_MARCHE`, `SR_AVANCEMENTS_PRECEDENTS` | Sous-rapports des pièces de marché | SOUS_RAPPORT |

Blocs fournis : `ENTETE_SOCIETE`, `COORDONNEES_DOCUMENT`, `LIGNES_DOCUMENT`, `TOTAUX_DOCUMENT`, `TOTAUX_AVANCEMENT`,
`MENTIONS_PAIEMENT`, `MENTIONS_PARTICULIER`, `PIED_VENTES_ACHATS`, `PIED_INTERNE`, `FILIGRANE_STATUT`,
`RAPPEL_PAGES_SUIVANTES`.

> Un modèle fourni modifié en base est marqué « modifié localement » : les mises à jour livrées par LogiBTP ne
> l'écrasent plus. Pour garder les mises à jour, **copiez** le modèle fourni et modifiez la copie (§ 2.1).

---

## 2. Où créer et modifier

### 2.1 Paramètres › Éditions (`/parametres/editions`)

- **Mentions** de la société (assurance décennale, pénalités, médiateur…) : données `societe.mentions.*`.
- **Modèles par défaut** : modèle proposé pour chaque type de document, fiche ou liste.
- **Liste des modèles** :
  - **Copier** : crée un nouveau modèle à partir d'un existant (nouveau code : lettres, chiffres, `_`). C'est la façon
    de créer un rapport ou un sous-rapport : partir du plus proche.
  - **Impacts** : rapports qui utilisent un bloc ou un sous-rapport.
  - **Exporter** : paquet `.logibtp-edition.json` (le modèle, ses blocs et sous-rapports, la charte, les images).
  - **Importer** un paquet ; codes déjà présents : **lier** (garder l'existant), **remplacer** ou **renommer**.
  - **Supprimer** (pas les modèles fournis ; refusé si le modèle est utilisé).

### 2.2 Éditeur du modèle dans l'aperçu (administrateur)

Ouvrez l'aperçu d'un élément (document : 🖨 Aperçu ou Ctrl+P ; fiche ou liste : 🖨), choisissez le modèle, la
présentation et les paramètres, puis **✎ Modèle** :

- le panneau s'ouvre à droite (masqué à l'ouverture de l'aperçu) ; la séparation se déplace à la souris
  (double-clic : largeur par défaut), ✕ masque l'éditeur sans perdre la saisie ;
- **un onglet par élément ouvert** : le rapport, puis les blocs et sous-rapports par « Ouvrir un bloc ou un
  sous-rapport… » ou **Ctrl+clic sur un code** `"bloc": "…"` / `"rapport": "…"` ; ✎ = saisie non appliquée,
  ● = appliqué à l'aperçu mais non enregistré ;
- JSON coloré : clés, mots de structure (`type`, `mode`, `genre`), formules `=…`, gabarits `{{…}}`, codes liés ;
  pliage des objets ; erreur de syntaxe soulignée ;
- **📖 Dictionnaire** : données de la source avec la valeur de l'aperçu en exemple, paramètres, contextes,
  fonctions, formats, styles et couleurs de la charte ; **clic = insertion au curseur** (`{{chemin}}`, ou le chemin nu
  avec Alt+clic, pour une expression `=…`) ;
- **▶ Appliquer** (Ctrl+Entrée) : remplace le modèle en mémoire et refait l'aperçu — rien n'est enregistré ; les
  alertes du modèle s'affichent au-dessus des pages ;
- **✔ Vérifier** : contrôle par le moteur du serveur (types, formules) ;
- **💾 Enregistrer** : nouvelle version en base ; les rapports concernés par un bloc ou un sous-rapport sont listés
  avant confirmation ;
- **↺ Rétablir** : revient au contenu lu à l'ouverture.

Les modifications appliquées ne valent que pour cet aperçu tant qu'elles ne sont pas enregistrées. Testez sur
plusieurs éléments (petit et gros document, brouillon et validé, avec et sans marché) avant d'enregistrer.

---

## 3. Structure d'un rapport

```json
{
  "format_version": 1,
  "code": "DEVIS_SOCIETE",
  "libelle": "Devis (modèle de la société)",
  "cible": "DOCUMENT",
  "source": "document",
  "page": { "format": "A4", "orientation": "portrait", "flexible": ["A4", "A3"],
            "marges": { "haut": 10, "bas": 10, "gauche": 12, "droite": 12 } },
  "parametres": [ { "nom": "logo", "libelle": "Logo", "type": "booleen", "defaut": true } ],
  "presentations": [
    { "code": "SANS_COMPOSANTES", "libelle": "Sans le détail des ouvrages", "parametres": { "composantes": false, "prix": true } },
    { "code": "DETAILLEE", "libelle": "Détaillée", "parametres": { "composantes": true, "prix": true } }
  ],
  "sources_annexes": [],
  "bandes": [ … ]
}
```

| Propriété | Valeurs |
|---|---|
| `cible` / `source` | `DOCUMENT` / `document`, `FICHE` / `fiche`, `LISTE` / `liste`. |
| `page.format` | `A3`, `A4`, `A5`, `A6` ou personnalisé `{ "largeur": 100, "hauteur": 150 }` (mm). |
| `page.orientation` | `portrait`, `paysage`. |
| `page.flexible` | Formats proposés à l'impression ; les colonnes « reste » (`*`) s'élargissent en A3. |
| `page.marges` | mm : `haut`, `bas`, `gauche`, `droite` ; `miroir: true` inverse gauche / droite sur les pages paires. |
| `page.espace_entete`, `page.espace_pied` | Espace (mm) entre l'entête ou le pied de page et le corps (3 par défaut). |
| `page.nombre_pair` | Ajoute une page blanche pour finir sur un nombre pair (recto verso). |
| `mode` | `RAPPORT` (défaut) ou `ETIQUETTES` (§ 8). |
| `parametres` | Paramètres proposés dans la barre de l'aperçu : `type` `booleen` (case) ou `nombre`, `defaut`. Lus par `Parametre("nom")`. |
| `presentations` | Variantes d'un même rapport (avec ou sans prix, détaillée…) : `code`, `libelle`, `parametres` (appliqués avant ceux de l'aperçu), `defaut_si` (condition : présentation choisie d'office). Sinon la première. |
| `sources_annexes` | Données supplémentaires lues par le serveur dans le même appel, sous `sources.<nom>` (§ 9.4). |

### 3.1 Les bandes

```json
{ "type": "CORPS", "nom": "lignes", "condition": "Compte(lignes) > 0", "mode": "UNIQUE",
  "options": { "garder_ensemble": true }, "contenu": { … composant … } }
```

| Type | Usage |
|---|---|
| `ENTETE_PAGE` | Haut de chaque page. `pages` : `TOUTES` (défaut), `PREMIERE`, `SUIVANTES`, `DERNIERE`, `SAUF_DERNIERE`, `PAIRES`, `IMPAIRES`. |
| `PIED_PAGE` | Bas de chaque page (mêmes `pages`). `Page()` et `NbPages()` y sont exacts. |
| `FOND_PAGE` | Derrière le contenu, position libre (filigrane, cadres) : composant `absolu`. |
| `TITRE` | Corps, en premier (entête du document). |
| `CORPS` | Corps : le détail. |
| `RESUME` | Corps, en dernier (totaux, signature). |

Modes d'une bande du corps :

| Mode | Comportement |
|---|---|
| `UNIQUE` (défaut) | Le contenu une fois. |
| `REPETE` | Le contenu pour chaque élément de `collection` (`element` = l'élément courant). |
| `GROUPE` | Éléments de `collection` regroupés par `rupture` (expression) : `entete` et `pied` (composants) autour de chaque groupe ; `regrouper: true` : le contenu une fois par groupe au lieu d'une fois par élément ; `groupe.valeur`, `groupe.elements`, `groupe.rang`, `groupe.premier`. |

Options (`options`) :

| Option | Effet |
|---|---|
| `saut_avant`, `saut_apres` | Nouvelle page avant / après la bande. |
| `saut_par_groupe` | Mode GROUPE : une page par groupe. |
| `entete_chaque_page` | Mode GROUPE : l'entête du groupe est répétée en haut des pages suivantes (`groupe.suite` vrai : « (suite) »). |
| `garder_ensemble` | La bande ne se coupe pas entre deux pages (si elle tient sur une page). |
| `garder_avec_suivant` | La bande reste sur la même page que la suivante. |
| `bas_de_page` | Posée au bas de la dernière page (totaux), après étirement des tableaux. |
| `chaque_page` | Répétée en haut de chaque page suivante. |

### 3.2 Propriétés communes aux composants

| Propriété | Effet |
|---|---|
| `condition` | Formule : composant ignoré si faux (voir § 5). |
| `nom` | Repère (messages d'alerte). |
| `largeur` | Dans une rangée : `30%`, `40mm` (ou nombre = mm), `*` (reste), `2*` (deux parts du reste). |
| `marges` | Nombre (mm, tous côtés) ou `{ "haut", "bas", "gauche", "droite" }`. |
| `cadre` | Trait nommé (`fin`, `normal`, `fort`, `primaire`) ou `{ "haut": "fin", "bas": "fort", … }`. |
| `fond` | Couleur de la charte ou `#rrggbb` (formule possible). |
| `rayon` | Coins arrondis du cadre (mm). |
| `hauteur`, `hauteur_min` | Hauteur fixe / minimale (mm). |

---

## 4. Les composants

### `champ` — texte

```json
{ "type": "champ", "valeur": "=Retrait(Gras(\"Objet : \"); document.objet)", "style": "normal",
  "alignement": "gauche", "multiligne": "auto", "condition": "document.objet" }
```

| Propriété | Valeurs |
|---|---|
| `valeur` | Formule (§ 5). |
| `style` | Style de la charte, objet de surcharge `{ "base": "normal", "taille": 10, "graisse": 700, "italique": true, "couleur": "primaire" }` ou liste des deux. |
| `format` | `montant`, `monnaie`, `nombre:2`, `simple:2`, `pourcent`, `date`, `date:long`… (§ 10.3). |
| `zero_vide` | `true` : une valeur nulle n'est pas imprimée. |
| `alignement` | `gauche`, `centre`, `droite`, `justifie`. |
| `multiligne` | `auto` (retour à la ligne, défaut), `une` (une ligne, ellipse), `sauts` (seulement aux sauts de ligne). |
| `lignes_max`, `ellipse` | Nombre de lignes au plus ; « … » si le texte est coupé. |
| `reduction_min` | Taille minimale (pt) : la police est réduite pour faire tenir le texte. |
| `html` | `true` : la valeur est un HTML de libellé (gras, italique, listes, tableaux simples). |
| `masquer_si_vide` | `true` (défaut) : un champ vide ne prend pas de place. |
| `prefixe`, `suffixe` | Texte ajouté si la valeur n'est pas vide. |
| `rotation` | Degrés (filigrane : -35). |

### `pile` — empilement vertical

`{ "type": "pile", "espacement": 2, "enfants": [ … ] }` ; `secable: false` interdit la coupure entre deux pages.

### `rangee` — colonnes côte à côte

`{ "type": "rangee", "espacement": 6, "meme_hauteur": true, "enfants": [ { …, "largeur": "52%" }, { …, "largeur": "*" } ] }` ;
`alignement_vertical` d'un enfant : `haut`, `milieu`, `bas`. `meme_hauteur` : cadres de même hauteur.

### `tableau`

```json
{
  "type": "tableau", "nom": "lignes", "collection": "lignes", "remplir": true,
  "report": { "libelle": "Report", "libelle_a_reporter": "À reporter" },
  "total": { "libelle": "Total" },
  "vide": "Aucune ligne",
  "bordures": { "cadre": "fin", "colonnes": "fin", "lignes": null, "entete": "fin" },
  "colonnes": [
    { "cle": "lib", "titre": "Désignation", "largeur": "*", "valeur": "{{ligne.libelle_html}}", "html": true },
    { "cle": "mt", "titre": "Montant HT", "largeur": "23mm", "valeur": "{{ligne.montant}}", "format": "montant",
      "alignement": "droite", "style": "montant", "zero_vide": true,
      "cumul": "=Si(ligne.compte_total; ligne.montant; Nul)", "condition": "Parametre(\"prix\")" }
  ],
  "gabarits": [
    { "condition": "ligne.composante ET NON Parametre(\"composantes\")", "masquer": true },
    { "condition": "ligne.type = \"TITRE\"", "fond": "fond_titre", "style": "titre_ligne", "garder_avec_suivant": true,
      "cellules": [ { "de": "num", "a": "lib", "valeur": "{{ligne.libelle_html}}", "html": true },
                    { "colonne": "mt", "valeur": "{{ligne.montant}}", "format": "montant" } ] },
    { "surcharges": { "lib": { "retrait": "=ligne.niveau * 2" } } }
  ]
}
```

**Colonnes** : `cle` (unique), `titre`, `largeur`, `valeur`, `format`, `alignement`, `alignement_titre`, `style`,
`fond`, `html`, `multiligne`, `lignes_max`, `reduction_min`, `zero_vide`, `retrait`, `condition` (colonne absente si
faux : les autres se partagent la place), `cumul` (formule cumulée : report et total).

**Gabarits de rangée** : pour chaque élément, le **premier gabarit dont la condition est vraie** s'applique ; aucun :
rangée simple des colonnes. Propriétés :

| Propriété | Effet |
|---|---|
| `masquer` | Rangée non imprimée (la valeur reste dans les cumuls si `cumul` la compte). |
| `saut_page` | Nouvelle page dans le tableau (entête répétée, report). |
| `cellules` | Cellules fusionnées : `colonne` (une) ou `de` / `a` (plage ; les colonnes masquées sont sautées), avec les propriétés d'une colonne. |
| `surcharges` | `{ cle: { propriétés } }` : modifie certaines colonnes en gardant les autres. |
| `style`, `fond` | Style et fond de toute la rangée. |
| `bordures` | `{ "haut": "fin", "bas": "fort", "colonnes": false }`. |
| `retrait` (cellule) | Retrait en mm (formule : `=ligne.niveau * 2`). |
| `garder_avec_suivant`, `lie_au_precedent` | Rangée gardée avec la suivante / la précédente (titre avec sa première ligne, composantes avec leur ouvrage). |
| `hauteur_min` | Hauteur minimale. |

**Tableau** : `entete: false` (sans ligne de titres), `remplir: true` (le cadre s'étire jusqu'au bas de la page),
`report` (ligne « À reporter » / « Report » des colonnes `cumul` entre deux pages ; `false` : aucune), `total`
(ligne des sommes des colonnes `cumul` après la dernière rangée), `vide` (texte si la collection est vide),
`colonnes_source` (colonnes dynamiques : expression donnant `[{ cle, titre, largeur, alignement, format }]`, valeur
`ligne.<cle>` ; utilisé par le modèle LISTE). L'entête est répétée en haut de chaque page.

### `repete` — composant répété

`{ "type": "repete", "collection": "client.adresse", "espacement": 0, "contenu": { "type": "champ", "valeur": "{{element}}" } }`
(chaque élément est `element` ; une liste de textes : `{{element}}`).

### `image`

`{ "type": "image", "ressource": "LOGO", "hauteur": 18, "largeur": "45mm", "alignement": "gauche" }` — l'image
est un document de la GED, catégorie « Image des éditions », dont le **code** est un mot-clé ou le titre (PNG ou
JPEG). `ressource` accepte une formule (image selon une condition). `obligatoire: true` : alerte si absente.

### `trait`, `espace`, `saut_page`

`{ "type": "trait", "trait": "fin", "marge": 1 }` ; `{ "type": "espace", "hauteur": 4 }` ; `{ "type": "saut_page" }`.

### `code39` et `qr`

`{ "type": "code39", "valeur": "{{document.numero}}", "taille": 24, "texte_lisible": true }` (police Code 39) ;
`{ "type": "qr", "valeur": "{{document.numero}}", "taille": 20, "correction": "M" }` (taille en mm, correction
L, M, Q, H).

### `absolu` — position libre (fond de page)

`{ "type": "absolu", "x": 30, "y": 200, "largeur": 220, "contenu": { … } }` (mm depuis le coin haut gauche).

### `bloc` — bloc lié

```json
{ "type": "bloc", "bloc": "TOTAUX_DOCUMENT", "parametres": { "accord": true, "lettres": false } }
```

Le bloc lit ses paramètres par `bloc.<nom>` (défauts déclarés dans le bloc :
`"parametres": [{ "nom": "accord", "defaut": false }]`). Un bloc peut inclure d'autres blocs ; les cycles sont refusés
à l'enregistrement.

### `sous_rapport`

```json
{ "type": "sous_rapport", "rapport": "SR_DOCUMENTS_MARCHE", "donnees": "sources.marche_documents",
  "parametres": { "titre": "Pièces du marché" } }
```

Voir § 7.

---

## 5. Les formules

Toute `valeur`, `condition`, `collection`, `rupture`, `cumul`, `fond`, `ressource` accepte une formule :

| Forme | Exemple | Résultat |
|---|---|---|
| Texte fixe | `Total HT` | le texte |
| Gabarit | `Devis n° {{document.numero}} du {{Date(document.date)}}` | texte avec valeurs ; `{{…}}` contient un chemin ou une expression |
| Expression | `=Si(document.verrouille; "Original"; "Provisoire")` | valeur calculée (nombre, texte, booléen, liste) |

Règles :

- **Chemins** : `client.adresse`, `document.type.libelle`, `lignes[0].montant` ; le premier mot désigne un contexte
  (§ 10.2), sinon un champ de l'élément courant, puis un paramètre de bloc, puis la racine des données.
- **Arguments séparés par `;`** (la virgule est la décimale : `1,5`). Noms de fonctions sans accent ni casse :
  `Si`, `SI`, `si` sont équivalents.
- **Chaînes** entre `"…"` (doubler `""` pour un guillemet) ou `« … »`.
- **Montants en décimal exact** (jamais d'arrondi caché) ; `Nul` (ou `Vide`), `Vrai`, `Faux`.
- **Conditions** : vraies si la valeur n'est ni vide, ni `Faux`, ni 0 (`"document.objet"` : vrai si un objet est saisi).
- **Erreur** (fonction inconnue, chemin invalide, division par zéro) : le champ reste vide et une **alerte** est
  affichée au-dessus de l'aperçu et journalisée ; l'édition n'est jamais bloquée.
- **JSON** : dans le modèle, les guillemets d'une formule s'échappent : `"valeur": "=Si(x; \"A\"; \"B\")"`.

Exemples :

```text
=Joindre(" – "; societe.raison_sociale; Si(societe.siret; "SIRET " & societe.siret; Nul))
=Si(document.avancement; "Situation n° " & document.avancement.rang; document.type.libelle)
=Retrait(Gras("Validité : "); document.validite_jours & " jours, jusqu’au " & Date(AjouterJours(document.date; document.validite_jours)))
="Arrêté à la somme de " & EnLettres(totaux.net) & "."
=Somme(lignes; "montant")
=Couleur("alerte"; Si(document.statut.code = "ANNULE"; "ANNULÉ"; Nul))
```

---

## 6. Présentations et paramètres

- Un **paramètre** déclaré dans `parametres` apparaît dans la barre de l'aperçu (case à cocher ou nombre) ; on le lit
  par `Parametre("nom")`.
- Une **présentation** fixe un jeu de paramètres (`prix`, `composantes`, `avancement`…). Les blocs et colonnes s'y
  conditionnent : `"condition": "Parametre(\"prix\") ET NON Parametre(\"avancement\")"`.
- `defaut_si` choisit la présentation d'office : `"defaut_si": "document.avancement"` (pièce d'avancement).
- Le modèle et la présentation imprimés sont retenus pour l'élément et reproposés à la réimpression.

---

## 7. Sous-rapports

Un sous-rapport est un rapport (`types: ["SOUS_RAPPORT"]`) dont seules les bandes du corps sont utilisées (pas
d'entête ni de pied de page : il s'insère dans la page de l'hôte).

### Données

- `donnees` (formule) choisit ses données ; sans `donnees` : les mêmes que l'hôte.
- **Liste** (`sources.marche_documents`) : le sous-rapport la lit par `elements` ; le plus simple est un tableau
  `"collection": "elements"`. Liste vide : le sous-rapport n'est pas imprimé.
- **Objet** : ses propriétés sont la racine des données du sous-rapport.
- `hote` : données du rapport inclusif (`{{hote.document.numero}}`).
- `parametres` du composant : transmis au sous-rapport (formules évaluées chez l'hôte), en plus des paramètres de
  l'hôte et des défauts déclarés par le sous-rapport.
- Trois niveaux au plus (un sous-rapport peut en inclure un autre) ; au-delà, alerte.

### Créer un sous-rapport (exemple : situations précédentes avec le reste à payer)

1. Paramètres › Éditions : **Copier** `SR_AVANCEMENTS_PRECEDENTS` en `SR_PRECEDENTS_SOCIETE`.
2. Ouvrir l'aperçu d'une facture d'avancement, ✎ Modèle, Ctrl+clic sur `"rapport": "SR_AVANCEMENTS_PRECEDENTS"`…
   puis remplacer le code par `SR_PRECEDENTS_SOCIETE` dans le rapport (onglet du rapport) et **Appliquer** :
   l'aperçu utilise le nouveau sous-rapport (actualiser ⟳ s'il n'est pas encore chargé).
3. Ouvrir son onglet, modifier le tableau :

```json
{
  "format_version": 1, "code": "SR_PRECEDENTS_SOCIETE", "libelle": "Situations et factures précédentes",
  "cible": "DOCUMENT", "source": "document",
  "bandes": [ { "type": "CORPS", "contenu": { "type": "pile", "marges": { "haut": 3 }, "enfants": [
    { "type": "champ", "valeur": "Situations et factures précédentes", "style": "sous_titre" },
    { "type": "tableau", "collection": "elements", "report": false, "total": { "libelle": "Total facturé" },
      "colonnes": [
        { "cle": "piece", "titre": "Pièce", "largeur": "*", "valeur": "{{ligne.type}} {{ligne.numero}}" },
        { "cle": "date", "titre": "Date", "largeur": "20mm", "valeur": "{{Date(ligne.date)}}" },
        { "cle": "ht", "titre": "HT", "largeur": "25mm", "valeur": "{{ligne.montant_ht}}", "format": "montant",
          "alignement": "droite", "cumul": "=Si(ligne.facture; ligne.montant_ht; Nul)" },
        { "cle": "reste", "titre": "Reste à payer", "largeur": "25mm", "valeur": "{{ligne.reste}}", "format": "montant",
          "alignement": "droite", "cumul": "=ligne.reste" }
      ] }
  ] } } ]
}
```

4. **Appliquer**, contrôler sur plusieurs factures, **Enregistrer** le sous-rapport puis le rapport.

### Sources annexes

Une source annexe est déclarée au niveau du rapport (`"sources_annexes": ["marche_documents"]`) et lue par le serveur
dans le même appel que les données. Sources disponibles pour les documents : `marche_documents`,
`avancements_precedents` (§ 9.4). Une nouvelle source se programme dans `SpecialisationEditionBtp.SourceAnnexeAsync`
(`src/LogiBTP.Api/Btp/EditionsBtp.cs`) et s'ajoute au dictionnaire (`SourceDocumentEdition.Dictionnaire`).

---

## 8. Étiquettes

`"mode": "ETIQUETTES"` sur une source liste : une étiquette par élément de `collection` sur une planche :

```json
"planche": { "colonnes": 3, "rangees": 8, "largeur": 70, "hauteur": 37, "marge_haut": 0.5, "marge_gauche": 0, "marge_interieure": 4 },
"parametres": [ { "nom": "premiere_etiquette", "type": "nombre", "defaut": 1 }, { "nom": "copies", "type": "nombre", "defaut": 1 } ]
```

Le contenu de la bande est celui d'une étiquette (`element` = la ligne) ; `premiere_etiquette` reprend une planche
entamée, `copies` répète chaque étiquette.

---

## 9. Pas à pas

### 9.1 Ajouter une colonne au tableau des lignes

1. Aperçu d'un devis › ✎ Modèle › Ctrl+clic sur `"bloc": "LIGNES_DOCUMENT"`.
2. Dans `colonnes`, ajouter après la colonne `u` :
   `{ "cle": "code", "titre": "Code", "largeur": "18mm", "valeur": "{{ligne.code}}", "style": "petit" }` (📖 › Données :
   Lignes du document › `lignes[].code` insère `{{ligne.code}}`).
3. Les gabarits fusionnent des plages `de` / `a` : vérifier que les titres et sous-totaux couvrent la nouvelle
   colonne (plage `num` → `pu` par exemple).
4. Appliquer, vérifier sur un devis avec sections, titres, options ; Enregistrer (le bloc sert à toutes les pièces :
   les rapports concernés sont listés).

### 9.2 Masquer une information selon le type de pièce

`"condition": "document.type.code = \"V_DEVIS\""` sur le composant, ou
`"condition": "Dans(document.type.code; \"V_FACTURE\"; \"V_FACTURE_AVT\")"`.

### 9.3 Nouveau rapport pour un type de document

1. Copier le rapport le plus proche (ex. `FACTURE` → `FACTURE_SIMPLE`).
2. Modifier son JSON dans l'aperçu (bandes, blocs), Appliquer, Enregistrer.
3. Paramètres › Éditions › Modèles par défaut : choisir `FACTURE_SIMPLE` pour le type voulu (sinon il reste
   proposé dans la liste des modèles de l'aperçu).

### 9.4 Mettre une image selon une condition

`{ "type": "image", "ressource": "=Si(rattachement.marche; \"LOGO_MARCHES\"; \"LOGO\")", "hauteur": 18 }` ;
déposer les deux images dans la GED (catégorie « Image des éditions », mot-clé = code).

---

## 10. Dictionnaire

### 10.1 Fonctions

Arguments séparés par `;`. Les noms s'écrivent sans accent ni casse.

#### Conditions

| Fonction | Description | Exemple |
|---|---|---|
| `Si(condition; alors; sinon)` | Valeur selon une condition ; sans « sinon » : vide si faux. | `=Si(document.verrouille; "Original"; "Provisoire")` |
| `EstVide(valeur)` | Vrai si absente, vide ou liste vide. | `=EstVide(client.contact)` |
| `PremierNonVide(v1; v2; …)` | Première valeur non vide. | `=PremierNonVide(payeur.nom; client.nom)` |
| `Contient(texte; recherché)` | Contient (sans casse ni accents). | `=Contient(ligne.libelle; "option")` |
| `CommencePar(texte; début)` | Commence par (sans casse ni accents). | `=CommencePar(document.type.code; "V_")` |
| `Dans(valeur; v1; v2; …)` | Égale à l'une des valeurs. | `=Dans(ligne.type; "TITRE"; "SECTION")` |
| `Choix(rang; v1; v2; …)` | Valeur de rang donné (1 = première). | `=Choix(document.avancement.rang; "1re"; "2e")` |

#### Texte

| Fonction | Description | Exemple |
|---|---|---|
| `Concat(v1; v2; …)` | Mise bout à bout (garde la mise en forme) ; `&` fait de même. | `=Concat(Gras("N° "); document.numero)` |
| `Joindre(séparateur; v1; …)` | Valeurs non vides jointes ; listes mises à plat. | `=Joindre(Ligne(); client.nom; client.adresse)` |
| `Majuscule(texte)`, `Minuscule(texte)` | Casse. | `=Majuscule(client.nom)` |
| `Gauche(texte; n)`, `Droite(texte; n)` | n premiers / derniers caractères. | `=Gauche(client.nom; 20)` |
| `Longueur(texte)` | Nombre de caractères. | `=Longueur(document.objet) > 60` |
| `Remplacer(texte; ancien; nouveau)` | Remplacement. | `=Remplacer(societe.siret; " "; "")` |
| `Texte(valeur)` | Conversion en texte. | `=Texte(document.indice)` |
| `Ligne()` | Saut de ligne. | `="Bon pour accord" & Ligne() & "Date et signature"` |

#### Nombres et montants

| Fonction | Description | Exemple |
|---|---|---|
| `Nombre(v; décimales; milliers)` | Décimales fixes (2), séparateur de milliers (vrai). | `=Nombre(ligne.qte; 3)` |
| `Montant(v; décimales)` | Montant sans symbole. | `=Montant(totaux.ht)` |
| `Monnaie(v; symbole)` | Montant suivi de « € ». | `=Monnaie(totaux.net)` |
| `Pourcent(v; décimales max)` | Forme la plus simple : 30 %, 85,26 %. | `=Pourcent(ligne.avt_pct)` |
| `Simple(v; décimales max)` | Nombre le plus simple : 30, 85,5. | `=Simple(ligne.qte)` |
| `Arrondi(v; n)`, `ArrondiSup(v; n)`, `ArrondiInf(v; n)` | Arrondi commercial, supérieur, inférieur. | `=Arrondi(totaux.ttc; 0)` |
| `Abs(v)` | Valeur absolue. | `=Abs(element.montant)` |
| `Min(v1; …)`, `Max(v1; …)` | Plus petite / grande valeur. | `=Max(0; totaux.net)` |
| `EnLettres(montant; unité; sous-unité)` | Montant en lettres (euro, centime). | `=EnLettres(totaux.net)` |
| `EntierEnLettres(n)` | Entier en lettres. | `=EntierEnLettres(document.validite_jours)` |

#### Dates

| Fonction | Description | Exemple |
|---|---|---|
| `Date(date; format)` | `court` (17/10/2026), `long` (17 octobre 2026), `mois` (octobre 2026), `heure`. | `=Date(document.date; "long")` |
| `AjouterJours(date; n)` | Date + n jours. | `=Date(AjouterJours(document.date; 30))` |
| `Aujourdhui()` | Date de l'édition. | `="Édité le " & Date(Aujourdhui())` |

#### Collections

| Fonction | Description | Exemple |
|---|---|---|
| `Somme(collection; champ)` | Somme d'un champ. | `=Somme(lignes; "montant")` |
| `Compte(collection; champ)` | Nombre d'éléments (ou de valeurs non vides). | `=Compte(echeances) > 1` |
| `Moyenne(collection; champ)` | Moyenne. | `=Moyenne(lignes; "avt_pct")` |

#### Page et paramètres

| Fonction | Description | Exemple |
|---|---|---|
| `Page()`, `NbPages()` | Numéro de page, nombre de pages (bandes de page). | `Page {{Page()}} / {{NbPages()}}` |
| `Parametre(nom)` | Paramètre du modèle, de la présentation ou de l'aperçu ; `"presentation"` = code de la présentation. | `=Parametre("prix")` |

#### Mise en forme dans un champ

| Fonction | Description | Exemple |
|---|---|---|
| `Gras`, `Italique`, `Souligne`, `Barre` | Mise en forme d'une partie du texte. | `=Gras(client.nom) & " – " & client.contact` |
| `Taille(points; texte)` | Taille de police. | `=Taille(14; document.numero)` |
| `Couleur(couleur; texte)` | Couleur de la charte ou `#rrggbb`. | `=Couleur("alerte"; "Échue")` |
| `Style(nom; texte)` | Style de la charte. | `=Style("titre"; document.type.libelle)` |
| `Retrait(libellé; texte)` | Libellé à gauche, texte aligné après lui sur toutes ses lignes. | `=Retrait("Objet : "; document.objet)` |
| `CodeBarre39(valeur)` | Valeur encodée pour la police Code 39. | `=CodeBarre39(document.numero)` |

Opérateurs : `+ - * /` (décimal exact), `&` (concaténation), `= <> < > <= >=`, `ET`, `OU`, `NON`, parenthèses.

### 10.2 Contextes

| Contexte | Contenu |
|---|---|
| `ligne`, `element` | Élément courant (tableau, bande REPETE ou GROUPE, `repete`) ; synonymes. |
| `groupe` | Groupe courant (mode GROUPE) : `valeur`, `elements`, `rang`, `premier`, `suite`. |
| `page` | Bandes de page : `numero`, `total`, `premiere`, `derniere`. |
| `bloc` | Paramètres du bloc lié. |
| `parametres` | Paramètres (aussi `Parametre("nom")`). |
| `donnees` | Racine des données (quand un champ de l'élément porte le même nom). |
| `sources` | Sources annexes (`sources.marche_documents`…). |
| `hote`, `elements` | Dans un sous-rapport : données de l'hôte, éléments transmis. |

### 10.3 Formats des champs

| Format | Résultat |
|---|---|
| `montant` (`montant:3`) | 1 250,50 (3 décimales). |
| `monnaie` (`monnaie:$`) | 1 250,50 € (autre symbole). |
| `nombre:N` | N décimales fixes. |
| `simple:N` | Forme la plus simple, N décimales au plus. |
| `pourcent` | 30 %, 85,26 %. |
| `date`, `date:long`, `date:mois`, `date:heure` | Dates. |
| `zero_vide: true` | Valeur nulle non imprimée. |

### 10.4 Charte par défaut

- **Styles** : `normal` (Inter 9 pt), `petit` (7,5), `discret`, `gras`, `titre` (16, primaire), `sous_titre` (11),
  `entete_tableau`, `section`, `titre_ligne`, `sous_total`, `composante`, `montant` (chiffres alignés), `total`,
  `nom_adresse`, `mentions` (6,5), `filigrane` (60).
- **Couleurs** : `texte`, `discret`, `primaire`, `secondaire`, `alerte`, `trait`, `trait_fort`, `fond_entete`,
  `fond_section`, `fond_titre`, `fond_total`, `blanc`, `filigrane`.
- **Traits** : `fin` (0,15 mm), `normal` (0,3), `fort` (0,5), `primaire` (0,5, couleur primaire).

### 10.5 Données de la source « document »

Champs d'une collection : `collection[].champ`, lus par `ligne.champ` (ou `element.champ`) dans un tableau, une
bande ou un composant répété sur la collection. Le dictionnaire 📖 de l'éditeur montre la valeur de chaque donnée
pour le document de l'aperçu.

#### Société

| Chemin | Libellé | Type |
|---|---|---|
| `societe.raison_sociale` | Raison sociale | texte |
| `societe.forme_juridique` | Forme juridique (libellé) | texte |
| `societe.capital` | Capital (« 250 000 € ») | texte |
| `societe.rcs`, `societe.siret`, `societe.tva`, `societe.naf` | RCS, SIRET, TVA intracommunautaire, NAF | texte |
| `societe.adresse` | Adresse (lignes) | liste |
| `societe.telephone`, `societe.courriel` | Téléphone, courriel | texte |
| `societe.mentions.decennale.assureur` / `.adresse` / `.police` / `.couverture` | Assurance décennale | texte |
| `societe.mentions.penalites`, `.indemnite`, `.escompte` | Mentions de paiement | texte |
| `societe.mentions.tva_debits` | Option TVA sur les débits | booléen |
| `societe.mentions.mediateur.nom` / `.site` | Médiateur de la consommation | texte |
| `societe.mentions.retractation`, `.accord`, `.libre` | Rétractation, bon pour accord, mention libre | texte |

#### Document

| Chemin | Libellé | Type |
|---|---|---|
| `document.id` | Identifiant | nombre |
| `document.numero` | Numéro (vide en brouillon) | texte |
| `document.date` | Date | date |
| `document.objet` | Objet | texte |
| `document.type.code` / `.libelle` / `.famille` / `.avancement` | Type (V_DEVIS…), libellé, famille V / A / S, avancement S / F / R | texte |
| `document.statut.code` / `.libelle` | Statut (BROUILLON, VALIDE, ANNULE…) | texte |
| `document.verrouille` | Validé | booléen |
| `document.indice`, `document.devise` | Indice, devise | texte |
| `document.notre_reference`, `document.reference_externe`, `document.date_externe` | Références | texte / date |
| `document.validite_jours`, `document.date_validite` | Validité (jours), fin de validité | nombre / date |
| `document.condition.code` / `.libelle`, `document.mode_reglement` | Condition et mode de règlement | texte |
| `document.nature_avoir` | Nature de l'avoir (ANNULATION, AVANCEMENT…) | texte |
| `document.entete.ent_…` | Toute colonne de l'entête du document | — |

#### Avancement (situations, factures d'avancement)

| Chemin | Libellé | Type |
|---|---|---|
| `document.avancement` | Présent pour une pièce d'avancement | objet |
| `document.avancement.presentation` | C cumul (situation), P période (facture) | texte |
| `document.avancement.rang` | Numéro de situation | nombre |
| `document.avancement.pied.marche_ht` | Montant HT du marché | montant |
| `document.avancement.pied.pct_facture` | % facturé (situation : réalisé) | nombre |
| `document.avancement.pied.nombre_precedents` | Pièces déjà facturées | nombre |
| `document.avancement.pied.lignes[]` | `cle` (ht, tva, ttc, net), `libelle`, `precedent`, `periode`, `cumul` | collection |

#### Client, payeur, adresse des travaux, rédacteur, rattachement

| Chemin | Libellé | Type |
|---|---|---|
| `client.nom`, `client.code`, `client.contact` | Client, code, contact | texte |
| `client.adresse` | Adresse (lignes) | liste |
| `client.courriel`, `client.telephone`, `client.siret`, `client.tva` | Coordonnées | texte |
| `payeur.nom`, `payeur.contact`, `payeur.adresse` | Payeur (vide s'il est le client) | texte / liste |
| `adresse_travaux.origine` | CHANTIER, DEPOT, COMPTOIR, LIBRE | texte |
| `adresse_travaux.libelle`, `.adresse`, `.contact`, `.telephone`, `.instructions`, `.mention` | Adresse des travaux ou de livraison | texte / liste |
| `redacteur.nom`, `redacteur.civilite` | Rédacteur | texte |
| `rattachement.projet` / `.affaire` / `.chantier` / `.marche` `.code` `.libelle` | Rattachement | texte |
| `rattachement.marche.montant_ht` | Montant HT du marché | montant |
| `intervenants[]` | `fonction`, `per_id`, `ind_id`, `principal`, `paiement_direct`, `commentaire` | collection |

#### Lignes du document (`lignes[]`)

Lignes imprimées dans l'ordre d'affichage, sans les lignes « ne pas imprimer » (toujours comptées dans les totaux)
ni les tranches de frais annexes ; pieds de section en lignes `PIED`.

| Champ | Libellé | Type |
|---|---|---|
| `type` | SECTION, TITRE, OUVRAGE, ELEMENT, TEXTE, SOUS_TOTAL, SAUT_PAGE, IMAGE, PIED | texte |
| `niveau` | Profondeur (0 = racine) | nombre |
| `numero`, `code` | Numérotation, code | texte |
| `libelle_html`, `libelle` | Libellé affiché (HTML), texte brut | html / texte |
| `qte`, `unite` | Quantité, unité | nombre / texte |
| `pu`, `pu_brut`, `remise_pct` | PU HT remisé, avant remise, remise % | montant / nombre |
| `montant` | Montant HT (pièce d'avancement : période) | montant |
| `taux_tva` | Taux de TVA | nombre |
| `type_prix` | V vendu, O option, M pour mémoire | texte |
| `option`, `pour_memoire`, `variante`, `composante`, `tranche` | Indicateurs | booléen |
| `compte_total` | Comptée dans le total (à utiliser dans `cumul`) | booléen |
| `avt_pct`, `avt_pct_precedent` | Avancement cumulé, précédent (%) | nombre |
| `avt_qte_cumul`, `avt_qte_marche` | Quantité cumulée, du marché | nombre |
| `avt_montant_cumul`, `avt_montant_precedent`, `avt_montant_marche` | Montants HT cumulé, précédent, du marché | montant |

#### Pied, TVA, totaux, échéances, textes

| Chemin | Libellé | Type |
|---|---|---|
| `pied[]` | `genre` (total, sous_total, poste, tva), `cle` (TOTAL_HT, HT_NET, TOTAL_TTC, NET…), `libelle`, `mode`, `taux`, `base`, `montant`, `mention` | collection |
| `tva[]` | `code`, `taux`, `base`, `montant`, `mention` | collection |
| `totaux.ht`, `totaux.tva`, `totaux.ttc`, `totaux.net` | Total HT net, TVA, TTC, net à payer | montant |
| `echeances[]` | `rang`, `date` (vide : à réception), `montant`, `mode`, `nature` (RETENUE) | collection |
| `textes.intro`, `textes.fin` | Textes de l'édition (HTML) | html |

#### Étapes d'un ordre (module Exécution, documents de la famille E)

| Chemin | Libellé | Type |
|---|---|---|
| `etapes[]` | `code`, `libelle`, `nature` (TACHE, JALON, ATTENTE), `date_obligatoire`, `prevu_le`, `valide_le`, `valide_par`, `controle`, `controle_le`, `controle_par`, `ressource` (étape, sinon ordre), `commentaire` | collection |

#### Sources annexes (avec `sources_annexes`)

| Chemin | Champs |
|---|---|
| `sources.marche_documents[]` | `role` (BASE, AVENANT), `rang`, `numero`, `date`, `objet`, `montant_ht`, `facture_ht` (travaux facturés, ce document compris), `pct_facture` |
| `sources.avancements_precedents[]` | `type`, `numero`, `date`, `rang`, `facture` (vrai : facture), `montant_ht`, `montant_tva`, `montant_ttc`, `net`, `reste` (reste à payer, module Règlements) |

### 10.6 Données de la source « fiche »

| Chemin | Libellé |
|---|---|
| `fiche.type`, `fiche.id`, `fiche.libelle`, `fiche.titre`, `fiche.sous_titre` | Identification de la fiche |
| `valeurs.<code>` | Valeur mise en forme d'un champ (champ supplémentaire : son code sans `+`) |
| `sections[]` | `titre`, `groupes[]` (`titre`, `champs[]` : `code`, `libelle`, `valeur`, `html`) |
| `societe.*` | Société (raison sociale, SIRET, TVA, adresse, téléphone, courriel) |

Les champs confidentiels ne sont jamais transmis.

### 10.7 Données de la source « liste »

| Chemin | Libellé |
|---|---|
| `liste.nom`, `liste.theme`, `liste.recherche`, `liste.nombre`, `liste.tronquee` | Vue imprimée (5 000 lignes au plus) |
| `colonnes[]` | `cle`, `titre`, `largeur`, `alignement`, `format` (pour `colonnes_source`) |
| `lignes[]` | Valeurs mises en forme par code de colonne (`ligne.<code>`), `_texte` (toutes, dans l'ordre), `_titre` (première), `_suite` (suivantes : étiquettes) |
| `societe.*` | Société |

---

## 11. Bonnes pratiques et pièges

- **Copier avant de modifier** un modèle fourni ; donner un code explicite (`DEVIS_SOCIETE`).
- **Modifier un bloc** change tous les rapports qui l'utilisent : consultez les impacts ; pour une variante, copiez le
  bloc et référencez la copie.
- **Tester avant d'enregistrer** : Appliquer, puis plusieurs éléments (brouillon et validé, petit et gros, avec et
  sans marché), puis Vérifier ; enregistrer le bloc ou le sous-rapport avant le rapport qui l'utilise.
- **Alertes** : une formule en erreur ne bloque rien mais laisse un champ vide ; lisez les alertes au-dessus des pages.
- **Cumuls** : une colonne cumulée doit exclure les lignes qui ne comptent pas (`=Si(ligne.compte_total; ligne.montant; Nul)`),
  sinon titres et composantes sont comptés deux fois.
- **Montants** : les données sont en décimal exact ; utilisez `format` ou `Montant()` pour l'affichage, jamais un
  calcul d'arrondi dans le texte.
- **Pièces validées** : l'édition produite à la validation est rangée dans la GED (coffre-fort pour les ventes à
  numérotation continue) ; une modification de modèle ne change pas un PDF déjà rangé (bouton 📄 Double).
- **Export / import** : pour passer un modèle d'une société (base) à une autre ou le sauvegarder.
