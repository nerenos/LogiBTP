# Analyse du module Personnalisation (libellés, thème, images)

Statut : **analyse validée** (31/10/2026), décisions au § 10. **Lot P1 réalisé** (31/10/2026) : écarts de la réalisation au § 12.

## 1. But

Structurer les **libellés**, le **thème** (couleurs, tailles) et les **images** de LogiBTP dans un module dédié, à partir
de fichiers statiques :

- `fr.json` : tous les textes affichés (pages, menus, boutons, messages, erreurs) et les libellés des données système ;
- `theme.css` : les variables de présentation (couleurs, fonds, bords, polices) ;
- `images/` : logo, icône de l'application, images de la borne et de la connexion, catalogue des icônes.

Le but premier **n'est pas** une application multilingue : une langue (français) et un thème, mais des textes rangés
sous des clés stables, modifiables sans toucher au code. La phase 2 ajoutera une interface dans l'application, un
stockage en base et la génération des fichiers (§ 9).

## 2. État des lieux (relevé du 31/10/2026, commit `15a80c8`)

| Sujet | Constat |
|---|---|
| Textes du client | ~370 fichiers JS (61 000 lignes), 55 pages ; environ **4 400 littéraux de texte** de deux mots ou plus (3 800 distincts), plus les mots isolés (Code, Libellé, Enregistrer…) : de l'ordre de **6 000 à 8 000 textes**. 80 % dans `client/src`, le reste dans les modules (Document 220, GED 180, Liste 145, Fiche 70, socle 60…). |
| Forme des textes | Gabarits `innerHTML` avec texte français mêlé au HTML (ex. `parametres-installation.js`), constantes de module (`const ORIGINES = {…}`, `MENUS_METIER`, `THEMES`, `FONCTIONS_INTERVENANT`) **évaluées au chargement**, ~735 `title="…"`, ~400 appels `confirmer` / `alerter` / `message`. |
| Messages du serveur | ~840 `ExceptionMetier` (≈ 400 codes distincts) : `{ status, code, title, details }`, `title` en français écrit dans le C# ; les moteurs (`MoteurDocument`…) produisent `{ code, message }`. Le client affiche `title`. |
| Formats | 67 occurrences de `'fr-FR'` en dur (dates, nombres) dont `socle/js/src/ui/format.js`. |
| Thème | Variables CSS en français déjà en place dans `socle/js/src/ui/socle.css` (`--fond`, `--surface`, `--texte`, `--accent`…, 17 variables, clair et sombre) ; choix Automatique / Clair / Sombre (`theme.js`, `public/demarrage-theme.js` appliqué avant l'affichage). Mais **217 couleurs en dur dans les CSS et 139 dans le JS**, et 4 variables utilisées jamais définies (`--avertissement`, `--bordure`, `--texte-discret`, `--fond-carte`). |
| Images | Une seule image (`public/icone.svg`) ; logo du bandeau en SVG dans `application.js` (`LOGO`) ; **~310 icônes en emoji** dans le code (`icone: '⚙'`…), plus les colonnes `*_icone` en base (`thl_icone`, `niv_icone`, `rol_icone`, `cas_icone`, `tno_icone`). |
| Données système en base | ~80 colonnes `*_libelle` ; données fournies par le programme : types et statuts de documents (`tyd_`, `std_`), types de lignes (`tyl_`), fonctions d'intervenants, sources, thèmes et vues de listes (`sli_`, `thl_`, `vli_nom`, générés par `generer-vues-liste.mjs`), types de fiches, listes de valeurs (`lva_`), natures, types comptables, catégories de TVA, nœuds de droits… Couleurs en base (`ctp_couleur`, `lva_couleur`, `etl_couleur`…). Aucune colonne ne distingue une valeur du programme d'une valeur modifiée par la société (sauf `pro_systeme`). |
| Mise en cache | Le service worker garde les fichiers de `public/` en « cache d'abord », sa version étant l'empreinte de la **liste des noms** de fichiers : un `fr.json` modifié sans reconstruction ne serait jamais relu. |

## 3. Principes

- **Un module sans métier** `modules/personnalisation` (paquet `@logibtp/personnalisation`, partie .NET
  `LogiBTP.Personnalisation`) : il charge, fusionne et sert des dictionnaires, il ignore ce que disent les textes.
- **Chaque module apporte ses textes** (`modules/<nom>/js/libelles/fr.json`) ; le cœur les **surcharge** comme il
  spécialise les classes (`client/personnalisation/fr.json`) ; l'installation peut enfin surcharger le résultat
  (§ 6.2). Un module ne dépend toujours pas du cœur : ses clés vivent sous son préfixe.
- **Noms en français** : fonctions (`texte`, `pluriel`, `image`, `icone`, `chargerPersonnalisation`), clés (`pointage.saisie.titre`),
  variables d'interpolation (`{{nombre}}`, `{{salarie}}`), variables CSS (`--fond`, `--accent`, déjà le cas).
- **On garde d'i18next ce qui sert**, rien de plus : clés à points, interpolation, pluriel, référence à une autre clé,
  repli sur une valeur par défaut. Pas de détection de langue, pas de plugins, pas de contexte, pas de formatage intégré
  (les formats restent dans `format.js`, qui lit la langue du dictionnaire).
- **Le libellé est du texte, jamais du HTML** : en phase 2 un administrateur pourra le modifier ; il est donc échappé à
  l'insertion (`texteHtml`), comme les valeurs (règle « HTML sans script » du lot 5 des Droits).
- **Aucun écran sans ses textes** : le dictionnaire est chargé avant le premier module qui s'en sert (§ 5).
- **Les codes restent les codes** : un libellé change, jamais un `tyd_code`, un `std_code` ni un code d'erreur.

## 4. Le module

### 4.1 Fichiers (réalisés au lot P1)

```
socle/js/src/dictionnaire/        @logibtp/socle/dictionnaire : texte, texteHtml, pluriel, existe, icone, iconeHtml, image,
                                  langue, chargerDictionnaire, initialiserDictionnaire ; resolution.js (pur, sans DOM)
socle/dotnet/LogiBTP.Socle/Dictionnaire.cs   même résolution et même fusion (jeu socle/tests/dictionnaire.json)
socle/js/personnalisation/        couche du socle : fr.json (commun.*, socle.*), theme.css (variables), images/icones.json
modules/navigation/js/personnalisation/fr.json   couche de la navigation (navigation.*)
modules/personnalisation/
  CLAUDE.md
  js/src/composition.js           composer(couches) : fusion des textes et icônes, thèmes concaténés, images, version
  js/src/vite.js                  greffon Vite : /personnalisation/* en développement, dist/personnalisation/, module de
                                  secours virtual:logibtp-personnalisation, balises d'index.html
  js/src/verification.js          clés utilisées dans le code absentes du dictionnaire (§ 7.3)
  dotnet/LogiBTP.Personnalisation.Web/   UsePersonnalisation : fichiers du programme + surcharge de l'installation
client/personnalisation/          couche du cœur : fr.json, theme.css, images/ (logo.svg, icone.svg, icones.json),
                                  couches.js (ordre des couches : socle → modules → cœur)
client/src/personnalisation.js    chargerPersonnalisation (dictionnaire, logo), logoApplication
```

La réplication JS ↔ C# suit la règle du projet (un jeu de cas commun) : le serveur doit résoudre les mêmes clés pour
les notifications, les courriels, les éditions et les données système.

### 4.2 Interface

```js
import { texte, texteHtml, pluriel, icone, image } from '@logibtp/socle/dictionnaire';

texte('commun.enregistrer')                               // « Enregistrer »
texte('installation.certificat.a_renouveler')             // « Certificat à renouveler »
pluriel('installation.certificat.jours', 12, { jours: 12 }) // « 12 jours restants »  (clés _un / _autre)
texteHtml('ged.depot.confirmation', { fichier: nom })     // libellé et valeurs échappés, prêt pour innerHTML
texte('erreurs.MARCHE_OBLIGATOIRE', {}, e.message)        // repli : 3e argument, sinon la clé elle-même
icone('parametres')                                        // « ⚙ » (iconeHtml : <img> si le catalogue désigne un fichier)
image('logo.svg')                                          // « /personnalisation/images/logo.svg?v=<empreinte> »
```

Ce qui est repris d'i18next :

| Fonction | Reprise | Forme |
|---|---|---|
| Clés imbriquées à points | oui | `{ "pointage": { "saisie": { "titre": "…" } } }` ↔ `pointage.saisie.titre` |
| Interpolation | oui, sans formatage | `{{nom}}` ; valeur absente laissée vide et signalée en développement |
| Pluriel | oui, français seulement | suffixes `_zero` (facultatif), `_un` (\|n\| < 2), `_autre` : règle écrite (identique en C#) plutôt qu'`Intl.PluralRules` |
| Référence | oui | `$t(commun.chantier)` dans une valeur ; cycles refusés au chargement |
| Repli | oui | valeur par défaut passée par l'appel, sinon la clé (bien visible) |
| Espaces de noms | non au chargement (un seul fichier fusionné), oui dans la structure (préfixe = module) |
| Détection de langue, contexte, plugins, `returnObjects`, chargement paresseux par espace | non |

Pas de bibliothèque ajoutée : le tout tient en deux à trois cents lignes, testées.

### 4.3 Structure des clés

- Premier niveau = **module ou zone** : `commun`, `socle`, `navigation`, `document`, `liste`, `fiche`, `ged`,
  `pointage`…, `menus`, `erreurs`, `donnees` ; le cœur ajoute ses propres zones (`structure`, `accueil`, `parametres`).
- Deuxième niveau = **écran ou composant** (`saisie`, `synthese`, `borne`, `dialogue`), puis l'élément (`titre`,
  `aide`, `bouton.valider`, `colonne.heures`, `confirmation.supprimer`).
- `commun.*` pour les mots partagés (Enregistrer, Annuler, Fermer, Code, Libellé, Oui, Non, Rechercher…) : un texte
  n'est mis en commun que s'il veut dire la même chose partout.
- `erreurs.<CODE>` : le code stable de l'API ou du moteur (`erreurs.SESSION_REQUISE`, `erreurs.LIGNE_DEPASSEE`).
- `donnees.<table>.<code>.<colonne>` : libellés des données système (§ 8), ex. `donnees.type_document.DEVIS.tyd_libelle`.
- Clés en minuscules, mots séparés par un tiret bas quand il le faut (`fin_validite`), jamais de texte français
  comme clé (une correction d'orthographe ne doit pas changer la clé).

Extrait de `fr.json` :

```json
{
  "_meta": { "langue": "fr-FR", "version": 1 },
  "commun": { "enregistrer": "Enregistrer", "annuler": "Annuler", "actualiser": "Relire l'état" },
  "installation": {
    "titre": "Installation",
    "aide": "État du serveur, en lecture : le certificat, les sauvegardes et les mises à jour se gèrent sur le serveur.",
    "certificat": {
      "origine": { "LOGIBTP": "Autorité LogiBTP de l'installation", "LETSENCRYPT": "Let's Encrypt (défi DNS)" },
      "jours_un": "{{jours}} jour restant", "jours_autre": "{{jours}} jours restants",
      "a_renouveler": "Certificat à renouveler"
    }
  },
  "erreurs": { "MARCHE_OBLIGATOIRE": "Une commande client se valide dans un marché." },
  "donnees": { "type_document": { "DEVIS": { "tyd_libelle": "Devis" } } }
}
```

## 5. Chargement asynchrone (point d'attention)

### 5.1 Le risque

Les textes sont aujourd'hui dans le code : ils existent dès l'import. Avec `fr.json` chargé par le réseau, trois
pièges :

1. **Constantes de module** (`const ORIGINES = { … texte(…) }`, `MENUS_METIER`, `THEMES`) évaluées à l'import, avant
   l'arrivée du dictionnaire → clés brutes figées pour toute la session.
2. **Premier affichage** (bandeau, page de connexion, borne, écran « Serveur injoignable ») rendu avant le dictionnaire
   → éclair de clés ou de vide.
3. **Hors ligne** : la PWA démarre sans réseau ; le dictionnaire doit être dans le cache, et rafraîchi quand il change.

### 5.2 Solution retenue (proposition)

1. **Préchargement dès le HTML** : `client/index.html` déclare
   `<link rel="preload" href="/personnalisation/fr.json" as="fetch" crossorigin>` et
   `<link rel="stylesheet" href="/personnalisation/theme.css">` (feuille bloquante : pas d'éclair de couleurs, comme
   `demarrage-theme.js` aujourd'hui). Le téléchargement commence en parallèle des scripts ; aucun script en ligne (CSP).
2. **`main.js` attend le dictionnaire puis importe l'application** :

   ```js
   import { chargerPersonnalisation } from '@logibtp/personnalisation';
   await chargerPersonnalisation();                         // relit la réponse préchargée
   const { Application } = await import('./app/application.js');
   ```

   Tout le code de l'application (et donc toutes les constantes de module) s'évalue **après** le dictionnaire : les
   constantes existantes peuvent rester, il suffit d'y appeler `texte()`. C'est la règle la plus simple à tenir.
   L'aperçu de la page quittée (`demarrage-apercu.js`) reste affiché pendant ce temps : l'utilisateur ne voit pas
   d'écran vide.
3. **Repli si `fr.json` est injoignable** (premier démarrage hors ligne, fichier corrompu) : le dictionnaire par défaut
   **intégré au paquet** à la construction (import JSON des couches module + cœur) prend le relais ; seules les
   surcharges de l'installation manquent. L'application ne démarre donc jamais sur des clés brutes.
4. **Hors navigateur** (Vitest, Jint des éditions, scripts `generer-*`) : `initialiser(dictionnaire)` synchrone, à
   partir des fichiers lus sur le disque (fichier de préparation Vitest commun) ; la résolution est sans DOM.
5. **Service worker** : `fr.json`, `theme.css` et `images/` passent en **réseau d'abord** (comme les lectures de
   l'API) avec garde en cache pour le hors ligne, ou sont appelés avec `?v=<empreinte>` fournie par `/api/societe` ;
   ils ne doivent pas suivre la règle « cache d'abord » des fichiers de l'application (§ 2, dernière ligne).
6. **Clé manquante** : la clé s'affiche telle quelle (visible, donc corrigée) et un avertissement est journalisé en
   développement ; un test empêche d'en livrer (§ 7.3).

Variante écartée : `await` de premier niveau dans le module de personnalisation (bloque silencieusement tous les
importeurs, mal supporté par certains outils et par Jint) ; chargement paresseux de fonctions `() => texte(…)` partout
(lourd à écrire, facile à oublier).

## 6. Thème et images

### 6.1 `theme.css`

- Les variables `:root` (clair) et les blocs sombre (`prefers-color-scheme`, `data-theme="dark"`) **sortent de
  `socle.css`** pour aller dans `theme.css`, chargé **après** les CSS des modules ; `socle.css` garde des valeurs de
  repli neutres pour les tests et les modules utilisés seuls.
- Le jeu de variables est complété : définir les 4 variables orphelines, puis remplacer les 217 couleurs en dur des CSS
  et les 139 du JS par des variables nommées par leur rôle (`--succes-fond`, `--planning-theorique`, `--conge`,
  `--pastille-option`…), jamais par leur teinte.
- Les couleurs **de données** (couleur d'une étiquette, d'un mode de vente, d'une valeur de liste) restent des données ;
  le thème ne fournit que les couleurs par défaut proposées à la création.
- Les choix Automatique / Clair / Sombre et `demarrage-theme.js` sont inchangés. Un seul thème livré ; d'autres
  pourront s'ajouter plus tard (`theme-<code>.css`).

### 6.2 Répertoire `images/` et icônes

- Fichiers servis sous `/personnalisation/images/` : logo du bandeau (remplace la constante `LOGO`), icônes de la PWA
  (le manifeste y pointe), logo de la page de connexion et de la borne, page `/certificat`.
- **Catalogue des icônes** `images/icones.json` : `{ "parametres": "⚙", "chantier": "👷", "ged": "📄" }` ; une valeur peut
  être un emoji ou un fichier (`"chantier": "chantier.svg"`). Les ~310 `icone: '…'` du code deviennent `icone('nom')`.
  Les icônes stockées en base (`thl_icone`…) peuvent aussi désigner un nom du catalogue.
- Les images propres à une société (logo des éditions, photos) restent dans la GED : elles relèvent des données.

### 6.3 Surcharge par l'installation

Les fichiers livrés sont la référence. Une installation peut déposer ses propres `fr.json` (partiel : seules les clés
changées), `theme.css` (ajouté après celui du programme) et images dans un répertoire du serveur (volume Docker
`logibtp-personnalisation`, comme `logibtp-certificats`) ; l'API (`ClientWeb`) sert le fichier fusionné et son
empreinte. Par **société** (sous-domaine) : en phase 2, avec le stockage en base (une base par société).

## 7. Migration des libellés existants

### 7.1 Ordre proposé

| Lot | Contenu |
|---|---|
| P1 | Module (JS + C#, jeu commun), chargement de `main.js`, préchargement, service worker, repli intégré ; `theme.css` sorti du socle et variables orphelines ; `images/` (logo, PWA) ; `format.js` lit la langue du dictionnaire. Migration du **socle**, de la **navigation** (bandeau, menus, dialogues) et de `commun.*`. |
| P2 | **Erreurs par code** : le client affiche `erreurs.<code>` s'il existe, sinon le `title` du serveur (aucune perte) ; extraction des ~400 codes et de leurs messages actuels dans `fr.json`. Les détails (`details`) alimentent l'interpolation. |
| P3… | Un lot par module puis par zone du cœur (Pointage d'abord : pages de référence, borne, peu de textes ; puis Document, Liste, Fiche, GED, …, pages du cœur). Chaque lot : textes, icônes, couleurs en dur. |
| Pn | Données système en base (§ 8). |
| Pn+1 | Serveur : notifications, courriels automatiques, éditions (Jint), messages d'exception lus dans le dictionnaire par `Dictionnaire.cs`. |

### 7.2 Outillage

- **Extraction semi-automatique** (`extraction.mjs`) : relève les littéraux français d'un fichier, propose une clé
  selon le chemin (`pages/pointage.js` → `pointage.*`) et produit le JSON et le diff à relire ; la clé finale est
  choisie par le développeur (pas de remplacement aveugle dans les gabarits `innerHTML`).
- **Textes déjà répliqués** (`FONCTIONS_INTERVENANT` ↔ `fonction_intervenant`, vues et fiches générées par
  `generer-vues-liste`) : la clé `donnees.*` devient la source commune, les tests de parité comparent les clés.

### 7.3 Tests

- Toute clé utilisée dans le code (`texte('…')`, `pluriel`, `icone`) existe dans le dictionnaire fusionné ; les clés
  inutilisées sont signalées (rapport, non bloquant) ; les variables `{{…}}` d'une valeur sont celles passées par
  l'appel (relevé statique).
- Jeu commun JS / C# : interpolation, pluriel, références, cycles, fusion des couches.
- Pour les textes de pages contrôlés par les tests existants, le fichier de préparation Vitest charge `fr.json` : les
  tests continuent de comparer le texte affiché.

## 8. Données système en base

« Données système » = lignes fournies par le programme (scripts de `modules/*/db` et `db/`) : types et statuts de
documents, types de lignes, fonctions d'intervenants, sources / thèmes / vues de listes, types de fiches, listes de
valeurs livrées, types comptables, catégories de TVA, nœuds de droits, profils système, natures et unités livrées…
Les données saisies par la société (chantiers, tiers, articles) ne sont pas concernées.

Proposition :

1. Les libellés de ces lignes sont déclarés dans `fr.json` sous `donnees.<table>.<code>.<colonne>` ; les scripts SQL
   gardent un libellé (base utilisable sans le module) mais ce n'est plus la référence.
2. **Application à la base** par le serveur (`ServicePersonnalisation.AppliquerAsync`, par base) : au démarrage de l'API
   après les scripts, à la commande `installation base mettre-a-jour`, et par une commande dédiée
   `installation personnalisation appliquer [--societe <code>]`. Rejouable.
3. **Respect des modifications locales** : une table `personnalisation_applique (pap_table, pap_code, pap_colonne,
   pap_valeur, pap_le)` garde la dernière valeur écrite par le programme. Une ligne n'est mise à jour que si sa valeur
   actuelle est encore celle-là (ou si elle n'a jamais été appliquée) ; une valeur changée par un administrateur
   (paramétrage des types de documents, listes de valeurs…) est conservée et signalée dans le rapport. Même principe
   que les vues par défaut (`vli_version = 1`).
4. Les tables concernées sont déclarées par le module propriétaire (table, colonne du code, colonnes de libellé), le
   module Personnalisation ne connaît aucune table métier ; le cœur déclare ses tables `ALTER TABLE`.
5. Les libellés figés dans les pièces (instantanés de l'entête, éditions validées, journaux) ne sont jamais réécrits.

## 9. Phase 2 : interface, base et génération

- **Stockage par base** (une par société) : `personnalisation_libelle (pli_cle, pli_valeur, pli_modifie_par,
  pli_modifie_le)`, `personnalisation_theme (pth_variable, pth_clair, pth_sombre)`, images dans un répertoire de la GED
  réservé. Couche « société » au-dessus de l'installation.
- **Génération** : l'API compose programme + installation + société, sert `fr.json`, `theme.css` et `icones.json` avec
  une empreinte (`ETag`, `?v=`) ; cache singleton **indexé par base** (règle du projet) ; régénéré à chaque
  enregistrement, diffusé aux fenêtres ouvertes (`Diffuseur`, sujet `personnalisation`) qui proposent de recharger.
- **Interface** `/parametres/personnalisation` (nœud de droits `administration/personnalisation`) : recherche par clé
  ou par texte, valeur du programme / de l'installation / de la société, retour à la valeur d'origine, aperçu des
  variables et du pluriel, import / export JSON ; éditeur des variables du thème avec contrôle de contraste (clair et
  sombre) ; dépôt des images ; « Appliquer aux données système » (§ 8) avec rapport.
- **Repérage à l'écran** (mode débogage) : survol d'un texte → sa clé, pour savoir quoi modifier.
- Ensuite seulement, si besoin : autres langues (`en.json`, choix par compte), autres thèmes.

## 10. Questions et décisions

| N° | Question | Décision (31/10/2026) |
|---|---|---|
| P1 | Un `fr.json` unique fusionné, ou un fichier par module servi séparément ? | Un fichier par module dans le dépôt, **un seul fichier fusionné servi** (une requête, préchargée). |
| P2 | Syntaxe d'interpolation | **`{{nom}}`** comme i18next. Les libellés de documents et les textes d'édition utilisent déjà `{{…}}` pour leurs variables ; ces textes ne passent jamais par `texte()`, la confusion est donc limitée au rédacteur. |
| P3 | Libellés en HTML permis ? | Non : texte seul, échappé. Exception explicite par suffixe `_html` (balises du nettoyeur du socle) pour les quelques aides mises en forme. |
| P4 | Où ranger les icônes (emoji) ? | `images/icones.json` (ce n'est pas de la langue). |
| P5 | Données système : écraser une valeur modifiée par la société ? | Non, conservée et signalée (§ 8.3). |
| P6 | Surcharge par l'installation dès la phase 1 ? | Oui, simple (répertoire servi par l'API) ; par société en phase 2. |
| P7 | Messages d'erreur : traduire côté client ou côté serveur ? | Client par code en P2 (rapide, sans risque) ; serveur en Pn+1 pour les messages non affichés par le client (journaux, courriels). |
| P8 | Faut-il migrer tout le code ? | Oui, par lots ; nouvelle règle dans `CLAUDE.md` : aucun texte, icône ni couleur en dur dans un nouveau code (comme pour les raccourcis). |

## 11. Estimation

Le module et le chargement (P1) sont courts (quelques jours). Le gros du travail est la migration : de l'ordre de 6 000
à 8 000 textes, environ 300 icônes et 350 couleurs, à faire module par module avec l'outil d'extraction, chaque lot
restant livrable seul (le repli sur la clé ou sur le message du serveur ne casse rien).

## 12. Réalisation du lot P1 (31/10/2026)

Écarts et précisions par rapport aux paragraphes précédents :

- **La résolution est dans le socle**, pas dans le module : le socle et tous les modules affichent des textes, or un
  module ne peut pas dépendre d'un autre module. `@logibtp/socle/dictionnaire` (point d'entrée séparé de `./ui`, léger,
  importé en premier) et `Dictionnaire.cs` portent la résolution et la fusion ; le module Personnalisation porte la
  composition des couches, le greffon Vite, la vérification des clés et le service des fichiers par l'API.
- **Couches** : chaque paquet qui affiche des textes a son dossier `personnalisation/` (`fr.json`, `theme.css`,
  `images/`) ; l'ordre est fixé par `client/personnalisation/couches.js` (socle → modules → cœur). Au lot P1 : socle,
  navigation, cœur. Un module migré ensuite ajoute son dossier et sa ligne dans `couches.js`.
- **Commun** : `commun.*` est dans la couche du socle (la plus basse, lisible par tous).
- **Chargement** (§ 5.2) : `main.js` attend `chargerPersonnalisation()` (dictionnaire, catalogue des icônes et logo en
  parallèle) puis importe `app/application.js`. Le greffon pose dans `index.html` l'icône de la page, les préchargements
  (`fr.json`, `images/icones.json`, `images/logo.svg`), la feuille `theme.css` et un `modulepreload` du paquet de
  l'application : il se télécharge pendant le dictionnaire sans s'exécuter (pas d'attente en cascade). Vérifié dans le
  navigateur, `fr.json` bloqué compris (dictionnaire de secours intégré, chargé seulement dans ce cas).
- **Logo** : `images/logo.svg` est inséré en SVG dans le bandeau (sa couleur suit le thème, `currentColor`) après
  contrôle (`logoValide` : SVG seul, sans script, `foreignObject` ni gestionnaire) ; absent ou refusé : le nom de
  l'application.
- **Surcharge de l'installation** (§ 6.3) : dossier `{LOGIBTP_CONFIG}/personnalisation` (volume de configuration de
  l'image Docker, donc sans nouveau volume), ou `LOGIBTP_PERSONNALISATION`, ou `Personnalisation:Dossier`. Fichiers
  relus dès qu'ils changent (date et taille), servis en `no-cache` avec un `ETag`, sans session (connexion, borne).
- **Service worker** : `/personnalisation/*` en réseau d'abord, copie gardée dans un cache propre (`logibtp-personnalisation`,
  conservé à la déconnexion), sinon la copie de l'installation du client.
- **Thème** : les variables sortent de `socle.css` vers `socle/js/personnalisation/theme.css` ; variables orphelines
  corrigées (`--avertissement` → `--alerte`, `--texte-discret` → `--discret`, `--bordure` → `--bord`, `--fond-carte`
  définie). Les ~350 couleurs en dur restent pour les lots suivants.
- **Formats** : `format.js` du socle et les widgets de la navigation lisent `langue()` (`_meta.langue`).
- **Tests** : jeu commun `socle/tests/dictionnaire.json` (JS et C#), composition et vérification
  (`modules/personnalisation/js/test`), surcharge de l'installation (`LogiBTP.Personnalisation.Tests`), et côté client :
  toute clé littérale du code existe, chaque texte se résout (`client/test/personnalisation.test.js`). Les suites du
  socle, de la navigation et du client posent le dictionnaire avant les tests (`test/preparation.js`).

## 13. Réalisation du lot P2 : erreurs par code (31/10/2026)

- **Affichage** : `messageErreur(code, message, valeurs)` du socle (`@logibtp/socle/dictionnaire`) rend
  `erreurs.<CODE>` s'il existe, sinon le message reçu. Il est appelé par `ErreurApi` (toutes les erreurs de l'API,
  classes dérivées des modules comprises ; le `title` du serveur reste dans `titre`) et par `erreur` / `avertir` du
  `MoteurDocument` JS (donc aussi du moteur BTP). Les détails objet de l'erreur sont les valeurs `{{nom}}` ; s'il manque
  une valeur, le message reçu est gardé (jamais de texte à trou).
- **Codes retenus** (`catalogueErreurs` du module, `modules/personnalisation/js/src/erreurs.js`) : un code n'entre au
  dictionnaire que si tous les lieux qui le lèvent ont **le même message littéral**. Lieux relevés : C# de l'API
  (`ExceptionMetier.Invalide` / `Conflit`, `new ExceptionMetier`, `ErreurListe`, `ErreurFiche`, codes littéraux ou
  constantes) et JS des moteurs (`this.erreur`, `this.avertir`, `new ErreurCalcul`). Écartés : message composé
  (interpolation, concaténation, choix), plusieurs messages pour un code, ou code employé ailleurs dans le C# (table
  `Messages` d'un module de règles, aide propre à un service, code choisi par une expression) : le serveur pourrait le
  lever avec un message plus précis, que le dictionnaire masquerait.
- **Bilan** : 237 codes retenus ; 258 gardent le message du serveur (176 messages composés, 57 codes à plusieurs
  messages, 25 employés ailleurs). `Introuvable` et `AccesRefuse` (messages composés) restent ceux du serveur.
- **Couches** : chaque code va dans le `fr.json` de la couche la plus basse qui le lève (socle, puis module, puis cœur) ;
  un module sans paquet JS (OAuth) a son dossier `personnalisation/` à sa racine. Vingt couches de modules s'ajoutent à
  `couches.js` (ordre alphabétique, sans effet : textes sous le préfixe du module, erreurs sous leur code).
- **Génération** : `npm run extraire-erreurs --workspace client` (`client/scripts/extraire-erreurs.mjs`) réécrit la
  section `erreurs` de chaque couche et donne le bilan. Le test du client (`personnalisation.test.js`) refuse un code du
  dictionnaire qui n'est plus sûr, dont le message a changé ou qui n'est pas dans sa couche, et toute couche du dépôt
  absente de `couches.js`. Un message changé dans le C# : relancer l'extraction.
- **Suites** : rendre sûrs les codes écartés en passant les valeurs dans `details` (puis `{{nom}}` dans le message) ou
  en donnant un code propre à chaque message ; les messages des moteurs C# et du serveur (journaux, courriels) seront
  traduits côté serveur (P7, lot « serveur »).

## 14. Réalisation du lot P3a : module Pointage (31/10/2026)

- **Extraction** : `extraire(source)` du module (`modules/personnalisation/js/src/extraction.js`) relève dans une source
  JS les textes, icônes (pictogrammes) et couleurs en dur restants, avec leur ligne ; il sert de liste de contrôle à
  chaque lot (le rapport d'un fichier migré ne garde que des commentaires et des valeurs de secours).
- **Règles du module** (`modules/pointage/js/src`) : les tables de messages et de libellés par code (`MESSAGES_*`,
  `ETATS_CONGE`, `TYPES_REGLE`, `UNITES_RUBRIQUE`, `SAISIES_RUBRIQUE`, libellé et icône de `ETATS_VALIDATION`) gardent
  leur forme, mais lisent le dictionnaire à chaque accès : `textesParCode(prefixe, codes)` du socle rend un objet figé
  d'accesseurs `texte(prefixe.CODE)`. Textes dans `modules/pointage/js/personnalisation/fr.json` (`pointage.*`), icônes
  des états dans son `images/icones.json`. Le module dépend désormais de `@logibtp/socle` (dictionnaire) ; ses tests
  composent les couches socle + module et échouent sur une clé manquante (`test/preparation.js`).
- **Pages du cœur** : `pages/pointage.js` (saisie, synthèse, export, paramètres, congés), `pages/borne.js` (borne,
  bornes, saisie d'équipe, repas), `pointage/conges.js`, `pointage/repas.js` et les titres des routes : textes sous
  `pointage.<zone>.*` du `fr.json` du cœur, icônes `pointage_*` dans `client/personnalisation/images/icones.json`, mots
  et pictogrammes partagés dans le socle (`commun.*`, `commun.jours_courts.*`, icônes `erreur`, `avertissement`,
  `verrou`, `ajouter`, `retirer`, `enregistrer`, `supprimer`…). Jours et dates par `langue()`.
- **Couleurs** : les styles du Pointage et de la borne (`client/src/styles.css`) lisent des variables du thème : celles
  du socle (`--erreur`, `--bord`, `--fond`) ou celles du cœur (`client/personnalisation/theme.css` : `--pointage-*`,
  `--borne-*`, valeurs inchangées) ; fonds dérivés par `color-mix`. La couleur proposée d'une nouvelle nature d'absence
  est lue dans `--pointage-nature-defaut`.
- **Contrôles** : le test des clés du client couvre aussi `modules/pointage/js/src`. Hors périmètre : la barre
  d'absence du planning (styles du module Planning, lot à venir) et les messages de l'API du Pointage (P2).

## 15. Réalisation du lot P3b : module Document (31/10/2026)

- **Périmètre** : `modules/document/js` (règles et interface : éditeur de la grille, panneaux, vues de colonnes, plan,
  notifications, recherche, paramétrage de l'affichage, disposition) et `ui/document.css`. Les pages du cœur qui
  l'utilisent (page document, `PanneauxBtp`, `EditeurDevisBtp`…) viendront avec les pages du cœur.
- **Socle** : `pairesParCode(prefixe, codes)` (listes `[code, libellé]` figées, libellé relu à chaque accès) à côté de
  `textesParCode` ; `couleurTheme(variable, defaut)` lit une variable du thème pour un champ qui exige une couleur
  explicite (nouvelle étiquette, nature d'absence du Pointage).
- **Textes** : `document.*` du `fr.json` du module (zones `editeur`, `colonnes.<clé>` — titres des colonnes de la grille,
  repris par les alias d'avancement —, `panneaux`, `vues`, `plan`, `notifications`, `recherche`, `parametrage`,
  `etapes` — libellés des étapes d'annulation —, `variables` — variables des libellés et des textes de l'édition —,
  tables par code). Les tables exportées gardent leur forme (`Object.entries`, déstructuration). L'origine « défaut » de
  la condition de paiement devient le code `defaut` (texte `document.panneaux.origines.defaut`).
- **Icônes** : `document_*` du module (pli, filtre, colonnes, vue par défaut, débogage, remise, soldé…), communes du
  socle (`rechercher`, `supprimer`, `erreur`, `avertissement`, `retirer`, `ajouter`, `replier`).
- **Couleurs** : ombres, contours, fond des fenêtres, surlignage de la recherche et de l'analyse, couleurs par défaut
  des étiquettes et des modes de vente : variables `--document-*` du `theme.css` du module (valeurs inchangées).
- **Gardé** : les messages des moteurs de calcul (repli de `messageErreur`, parité avec le C#) ; le tiret « — » des
  listes vides.
- **Contrôles** : tests du module sur le dictionnaire composé (clé manquante = échec), clés de `modules/document/js`
  vérifiées par le test du client ; affichage contrôlé dans le navigateur (entête, totaux, détail, plan, grille et pied
  du devis de démonstration).

## 16. Réalisation du lot P3c : page document du cœur (31/10/2026)

- **Périmètre** : `client/src/app/pages/document.js` (barre, onglets, menu des actions, panneaux ancrables, verrou de
  modification, saisie hors ligne, cycle de vie, numéro, annulation par avoir, bloc d'avancement, lot de consultation,
  aide-mémoire des raccourcis), `client/src/app/panneaux-btp.js` (`PanneauxBtp` : entête, rattachement, coordonnées,
  adresse des travaux ou de livraison, stock, accusé de réception, facture du sous-traitant, détail de la ligne, frais
  annexes) et `client/src/app/editeur-btp.js` (`EditeurDevisBtp` : colonnes BTP, données proposées aux métrés,
  messages). Les fichiers qu'ils appellent (structure, adresses, sous-traitance, analyse, contrôles de saisie,
  hors ligne…) suivront avec leur zone du cœur.
- **Textes** : `document_btp.*` du `fr.json` du cœur : `page` (dont `onglets`, `actions`, `dock`, `verrou`, `attente`,
  `cycle`, `numero`, `annulation`, `avancement`, `lot`, `raccourcis_notes`), `panneaux` (dont `roles`, `modes_calcul`,
  `adresse_actions`, `sections`, `niveaux`, `detail`, `calcul`, `actions`, `frais`), `editeur`, `colonnes` (colonnes
  ajoutées par le cœur), `donnees` (données des métrés), `stock_lieux.<type>.<colonne>`, `stock_date_prevue.<type>` et
  `etapes` (étapes d'annulation). `LIEUX_STOCK` garde sa forme (libellés relus à chaque accès). Le gabarit de la page
  devient une fonction (`gabarit()`), les entêtes des panneaux ancrables un seul modèle (`enteteDock`).
- **Icônes** : `document_btp_*` du cœur (page, métré, PV imposé, rechargement, dépôt, comptoir, lieux de stock, pièce,
  ventilation, envoi, consultation, sous-traitance, ancrages, attente, fusion…), `telephone` ajoutée au socle ; reprises
  du socle et du module Document (`verrou`, `retirer`, `ajouter`, `avertissement`, `erreur`, `enregistrer`,
  `document_reduire`, `document_textes`, `document_modifier`, `document_puce`…).
- **Gardé** : le script de départ d'un métré garde le mot du langage `Renvoyer` (seul le commentaire est un texte) ;
  les libellés des origines d'adresse (`structure/adresses.js`), des états d'attente (`hors-ligne/attente.js`) et des
  contrôles de saisie (`calcul/controles-btp.js`) restent dans leurs fichiers jusqu'à leur lot.
- **Contrôles** : `npm test` complet ; clés statiques vérifiées par le test du client, clés composées (lieux de stock,
  rôles, modes de calcul, actions d'adresse, voisins, étapes de frais, notes de raccourcis) relues contre le
  dictionnaire ; affichage contrôlé dans le navigateur (barre, onglets, titres et panneaux ancrables de la page, entête,
  totaux, détail, grille et pied du devis de démonstration).

## 17. Réalisation du lot P3d : module Liste (31/10/2026)

- **Périmètre** : `modules/liste/js` : règles (opérateurs des filtres de colonne et des filtres de vue, erreurs de
  compilation des formules, fournisseur en mémoire, erreurs de colonne du modèle) et interface (liste : barre, panneau
  des segments, en-têtes, tri, compteur, suite, menu contextuel, suppression, saisie dans la liste ; concepteur de vue ;
  menu de filtre ; gestion des thèmes ; formats de cellule) ; `ui/liste.css`.
- **Socle** : `pairesParCode(prefixe, codes)` accepte une entrée `[code, clé]` pour un code qui ne peut pas servir de clé
  (symboles des opérateurs : `'='` → `egal`, `'<>'` → `different`…).
- **Textes** : `liste.*` du `fr.json` du module (zones `operateurs`, `operateurs_vue`, `formule`, `fournisseur`,
  `modele`, `formats`, `themes`, `menu`, `concepteur`, `liste`) ; compteurs par `pluriel` (`liste.liste.lignes`,
  `liste.liste.fin`) ; mots communs du socle (`commun.enregistrer`, `oui`, `non`, `annuler`, `ok`). Les tables exportées
  (`OPERATEURS_*`) gardent leur forme.
- **Icônes** : `liste_*` du module (tri, filtre, segments, ancrages, lignes entières ou simples, coche, saisie, formule…),
  communes du socle (`retirer`, `supprimer`, `ajouter`).
- **Couleurs** : texte sur couleur d'accent, hachures de la saisie, ombres et fond des fenêtres, couleurs proposées par
  le concepteur (colonne sans couleur, nouvelle règle) : variables `--liste-*` du `theme.css` du module (valeurs
  inchangées) ; les couleurs proposées dans les champs couleur passent par `couleurTheme`.
- **Gardé** : les mots du langage des formules (`SI`, `ALORS`, `ARRONDI`…) et les tests de touches de navigation de la
  grille (Entrée, Échap, flèches ; hors du périmètre de la personnalisation).
- **Contrôles** : tests du module sur le dictionnaire composé (les jeux de formules vérifient les messages d'erreur),
  clés de `modules/liste/js` vérifiées par le test du client, clés composées relues contre le dictionnaire ; affichage
  contrôlé dans le navigateur (liste en mémoire : barre, filtres de vue, segments, en-têtes, menu de filtre, concepteur
  sur ses deux onglets).
