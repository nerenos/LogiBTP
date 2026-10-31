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

## 18. Réalisation du lot P3e : module Fiche (31/10/2026)

- **Périmètre** : `modules/fiche/js` : règles (messages de validation des champs, formats prédéfinis, contrôle des
  requêtes de liste, contrôle du format de chrono, libellés des modes, fournisseur en mémoire) et interface (fiche :
  en-tête, actions, bandeau du verrou, erreurs, onglets, groupes, marques des champs, champs masqués, code à chrono,
  mots de passe, pièces jointes, messages et confirmations ; paramétrage : champs du logiciel, champs supplémentaires,
  détails) ; `ui/fiche.css`.
- **Textes** : `fiche.*` du `fr.json` du module (zones `validation`, `formats`, `requete`, `chrono`, `modes`,
  `fournisseur`, `fiche`, `parametrage` dont `types`) ; compteur d'erreurs par `pluriel` (`fiche.fiche.erreurs`) ; mots
  communs du socle (`commun.enregistrer`, `annuler`, `supprimer`, `fermer`, `fermer_echap`, `afficher`, `code`,
  `libelle`). Les tables exportées (`MESSAGES`, `LIBELLES_MODES`, `FORMATS_PREDEFINIS`) gardent leur forme. Les jetons du
  format de chrono (`{P}`, `{N:k}`…) restent dans les textes (accolades simples, distinctes des variables `{{nom}}`).
- **Icônes** : `fiche_*` du module (modifier, copier, confidentiel, paramétrer, marques obligatoires, valeur masquée,
  reprise du code prévisionnel, code libre, ordre, détails), communes du socle (`verrou`, `retirer`, `supprimer`,
  `avertissement`).
- **Couleurs** : fond et ombre de la fenêtre du paramétrage : variables `--fiche-*` du `theme.css` du module (valeurs
  inchangées).
- **Gardé** : les messages du serveur (`ValidationFiche.cs`, `ServiceFiche`), mêmes textes ; le marqueur « ⚠ » des
  onglets en erreur dans `fiche.css` (comme celui de la grille des documents).
- **Contrôles** : tests du module sur le dictionnaire composé (clé manquante = échec), clés de `modules/fiche/js`
  vérifiées par le test du client ; affichage contrôlé dans le navigateur (fiche en mémoire : en-tête, bulles, onglets,
  champs masqués, erreurs de saisie, confirmation, paramétrage avec détails ouverts).

## 19. Réalisation du lot P3f : module GED (31/10/2026)

- **Périmètre** : `modules/ged/js` : règles (confidentialités, étapes, actions de fin de rétention, unités de taille,
  icônes des fichiers, messages du fournisseur en mémoire) et interface (explorateur : barre, chemin, arbre, liste,
  badges, visualisation, actions, dock des informations, versions, historique, dérivations, coffre-fort, messages et
  confirmations ; dialogue de dépôt ; aperçu ; arborescence ; paramétrage des règles de rétention et de
  classification) ; `ui/ged.css`.
- **Textes** : `ged.*` du `fr.json` du module (zones `confidentialites`, `etapes`, `actions_fin`, `derivations`,
  `statuts_retention`, `etats_index`, `colonnes`, `tailles`, `champs` — champs communs au dépôt et aux informations —,
  `fournisseur`, `apercu`, `depot`, `regles`, `explorateur`) ; compteurs par `pluriel` (dossiers, documents, versions,
  consultations, règles appliquées, archivés, échus) ; mots communs du socle. Les tables exportées
  (`CONFIDENTIALITES`, `ETAPES`, `ACTIONS_FIN`) gardent leur forme ; l'icône d'un document devient
  `iconeDocument(doc)` (le nom `icone` est celui du dictionnaire), l'utilitaire de texte du fournisseur `nettoye`.
- **Icônes** : `ged_*` du module (types de fichiers, navigation, outils, filtres, actions sur un document, dérivations,
  tri, téléchargement…), communes du socle (`verrou`, `ajouter`, `retirer`, `supprimer`, `replier`, `rechercher`).
- **Couleurs** : bulles, survols, fond de l'aperçu PDF, zone de dépôt, fond et ombre de la fenêtre de dépôt : variables
  `--ged-*` du `theme.css` du module (valeurs inchangées).
- **Gardé** : les règles par défaut de rétention et de classification et les catégories du fournisseur en mémoire
  (copies des INSERT de `db/051` : données système, § 8) ; les raisons de rupture de la chaîne du coffre-fort
  (répliquées avec `ChaineCoffre.cs` et testées des deux côtés) ; les commentaires de version écrits par le fournisseur
  en mémoire (données, comme le serveur).
- **Contrôles** : tests du module sur le dictionnaire composé (clé manquante = échec), clés de `modules/ged/js`
  vérifiées par le test du client ; affichage contrôlé dans le navigateur (GED en mémoire : barre et bulles, arbre,
  liste, visualisation et actions, dock et ses onglets, paramétrage des règles, dialogue de dépôt de deux fichiers).

## 20. Réalisation du lot P3g : module Annuaire (31/10/2026)

- **Périmètre** : `modules/annuaire/js` : règles (natures et usages des coordonnées, réseaux, messages des contrôles
  de coordonnées et d'identifiants, nœuds résumés du graphe, messages du fournisseur en mémoire) et interface (éditeur
  des coordonnées, choix des coordonnées partagées, rattachements, liens, choix d'une personne ou d'un individu, tiers
  provisoires et fusion, paramétrage des référentiels, graphe relationnel).
- **Textes** : `annuaire.*` du `fr.json` du module (zones `natures` — libellé, nom d'une coordonnée, usages par
  nature —, `reseaux`, `coordonnees`, `identifiants`, `fournisseur`, `partage`, `liens`, `provisoire`, `fusion`,
  `selection`, `rattachements`, `referentiels`, `graphe`) ; compteurs par `pluriel` (contacts, rattachements,
  modifications, fiches partageant une coordonnée, choix restant à faire, nœuds du graphe, distance) ; mots communs du
  socle. Les tables exportées (`NATURES`, `RESEAUX`, `MESSAGES_COORDONNEES`, `MESSAGES_IDENTIFIANTS`) gardent leur
  forme ; les utilitaires de texte locaux deviennent `nettoye`.
- **Icônes** : `annuaire_*` du module (natures de coordonnées, personne, individu, groupe de contacts, rattachement,
  partage, principal, historique, reprise, sens des liens, pages, plier), communes du socle (`ajouter`, `retirer`,
  `supprimer`, `avertissement`).
- **Couleurs** : couleur de la relation principale dans le graphe : variables `--annuaire-relation-<code>` du
  `theme.css` du module (valeurs inchangées ; une relation sans variable garde la bordure).
- **Gardé** : civilités proposées (`M.`, `Mme` : valeurs enregistrées) ; mots ignorés pour les doublons de nom (règle) ;
  le libellé « + N contacts » et les icônes des nœuds du graphe restent ceux du jeu `03_graphe.json` (même texte par
  défaut que `GrapheAnnuaire.cs`, qui reste littéral comme les autres messages du serveur).
- **Contrôles** : tests du module sur le dictionnaire composé (clé manquante = échec), clés de `modules/annuaire/js`
  vérifiées par le test du client ; affichage contrôlé dans le navigateur (annuaire en mémoire : coordonnées,
  rattachements, liens, référentiels, graphe et ses couleurs, tiers provisoire avec doublons, choix des coordonnées
  partagées).

## 21. Réalisation du lot P3h : module Bibliothèque (31/10/2026)

- **Périmètre** : `modules/bibliotheque/js` : tables de libellés (scénarios de prix d'achat, gestions, types de nature,
  données techniques), messages du fournisseur en mémoire, interface (arbres des familles et des natures, onglets Prix,
  Unités et Tarifs de la fiche d'un élément, paramétrage : bibliothèques, familles, natures, regroupements, coefficients
  par période, scénarios).
- **Textes** : `bibliotheque.*` du `fr.json` du module (zones `scenarios`, `gestions`, `types_nature`,
  `donnees_techniques`, `fournisseur`, `arbres`, `prix` — dont `alertes` et `sources` —, `unites`, `tarifs`,
  `referentiels` — dont `onglets`, `types_courts`, `etats`, `familles`, `natures`, `coefficients`, `prix` —) ; compteurs
  par `pluriel` (entrées retenues des arbres, éléments recalculés) ; mots communs du socle. Les tables exportées
  (`SCENARIOS_PA`, `GESTIONS`, `TYPES_NATURE`, `DONNEES_TECHNIQUES`) gardent leur forme (`pairesParCode`).
- **Icônes** : `bibliotheque_*` du module (arbres, plier, attente, résultat, principal, lien, enregistrer), communes du
  socle (`ajouter`, `retirer`, `supprimer`, `avertissement`).
- **Couleurs** : aucune couleur en dur dans `bibliotheque.css` (variables du socle) : pas de `theme.css` pour ce module.
- **Écart corrigé** : l'état d'une période de coefficients devient un code (`a_venir`, `en_vigueur`, `passee`) ; la
  classe `periode-passee` du style s'applique enfin (l'ancien libellé « passée » donnait `periode-passée`).
- **Gardé** : messages des erreurs de calcul de `calcul.js` (moteur répliqué avec `CalculElement.cs`, comme les moteurs
  du lot P3b) ; commentaires écrits dans l'historique des prix par le fournisseur en mémoire (données, comme le serveur) ;
  variables des formules d'unités (`{{poids}}`…) passées en valeurs des textes d'aide pour rester affichées.
- **Contrôles** : tests du module sur le dictionnaire composé, clés de `modules/bibliotheque/js` vérifiées par le test
  du client ; affichage contrôlé dans le navigateur (bibliothèque en mémoire : onglets Prix, Unités et Tarifs, arbres,
  paramétrage sur ses onglets).

## 22. Réalisation du lot P3i : module CRM (31/10/2026)

- **Périmètre** : `modules/crm/js/src` (règles : natures, états, demandes, motifs sans suite, types de rappels, statuts
  des plans, messages d'erreur, format des noms de plans) et, le module n'ayant pas d'interface propre, ses écrans du
  cœur : `client/src/app/crm/` (outils communs, fil d'actualité, onglet Suivi), pages `crm*.js` (notes, note, demandes,
  demande, plans, plan, bordereaux, bordereau, rappels, suivi, fil) et `parametres-crm.js`, titres des routes.
- **Textes** : `crm.*` du `fr.json` du module (`natures_note`, `etats_note`, `etats_demande`, `motifs_sans_suite`,
  `types_rappel`, `statuts_plan`, `notes.erreurs`, `demandes.erreurs`, `rappels.erreurs`, `plans`) ; `crm_btp.*` du
  `fr.json` du cœur pour les écrans (`routes`, `liste`, `vues`, `suivi`, `fil`, `rappel`, `rappels`, `note`, `demandes`,
  `demande`, `plans`, `plan`, `diffusions`, `diffusion`, `modes_diffusion`, `historique`, `couleurs_rappel`,
  `parametres`, `commun`, `riche`, `courriel`) ; compteurs par `pluriel` (notes, demandes, photos, réponses, courriels,
  fichiers, visas). Les tables exportées gardent leur forme (`NATURES_NOTE`… : `{ valeur, libelle }`,
  `MODES_DIFFUSION`, effets des statuts de visa : `pairesParCode`).
- **Message à variable** : `MESSAGES_NOTE.NOTE_OBJET` est un accesseur qui passe `LONGUEUR_OBJET` (`{{longueur}}`) ; les
  autres messages restent fournis par `textesParCode`.
- **Icônes** : `crm_action`, `crm_message`, `crm_tache` du module ; `crm_btp_*` du cœur (suivi, note, fil, plans,
  bordereaux, rappels, demandes, projet, fichiers, imprimer, courriel, mise en forme…) ; communes du socle (`ajouter`,
  `retirer`, `verrou`, `avertissement`, `precedent`, `suivant`) et de l'annuaire (`annuaire_individu`,
  `annuaire_personne`).
- **Couleurs** : pastilles des rappels, demande transformée et plan validé, bordereau imprimé par des variables du thème
  du cœur (`--crm-rappel-rouge|orange|vert`, `--crm-valide-fond|texte`, `--crm-impression-texte|fond`).
- **Gardé** : codes (`COURRIEL`, catégorie GED `crm`, types d'éléments) ; noms des répertoires d'indices de la GED
  passés au dictionnaire (`crm_btp.plan.indice`) mais retrouvés d'abord par l'identifiant retenu sur l'indice.
- **Contrôles** : tests du module sur le dictionnaire composé (`test/preparation.js`, clé manquante = échec), clés de
  `modules/crm/js/src` vérifiées par le test du client ; affichage contrôlé dans le navigateur (API simulée : onglet
  Suivi, fil, rappels, plans, paramétrage).

## 23. Réalisation du lot P3j : module Mail (31/10/2026)

- **Périmètre** : le module (`modules/mail/js/src` : reconnaissance des courriels reçus, sans texte affiché ; erreurs déjà
  par code au lot P2) et ses écrans du cœur : `client/src/app/pages/mail.js` (boîte, rédaction, détail d'un courriel,
  suivi des envois), `parametres-mail.js` (comptes, alias, usages, modèles, règles de reconnaissance, limitations),
  titres des routes.
- **Textes** : `mail_btp.*` du `fr.json` du cœur (`routes`, `etats`, `vues`, `natures`, `indices`, `envoi`, `redaction`,
  `champs`, `liste`, `suivi`, `message`, `hebergeurs`, `securites`, `authentifications`, `limites`, `reglages`,
  `apres_rattachement`, `etats_compte`, `parametres`) ; compteurs par `pluriel` (courriels en file, nouveaux, envoyés,
  essais, coordonnées signalées). Les tables gardent leur forme (`ETATS` : { code : [libellé, classe] }, `VUES`,
  `LIMITES`, `PARAMETRES` : paires, `HEBERGEURS`… : `{ valeur, libelle }`, `NATURES` : `textesParCode`).
- **Modèle par défaut** : corps proposé à un nouveau modèle de courriel dans `mail_btp.parametres.corps_defaut_html`
  (variable `{{document}}` passée en valeur pour rester affichée).
- **Icônes** : `mail_btp_*` du cœur ; communes du socle (`ajouter`, `retirer`, `avertissement`).
- **Couleurs** : corps d'un courriel affiché dans son cadre isolé par `--mail-corps-texte` et `--mail-corps-fond` du thème
  du cœur (lues par `couleurTheme`, le cadre n'ayant pas accès aux variables de la page).
- **Gardé** : codes des natures et actions des règles affichés tels quels dans le paramétrage (valeurs de la règle),
  préréglages des serveurs (données techniques).
- **Contrôles** : `npm test`, `extraire-erreurs` sans écart ; affichage contrôlé dans le navigateur (API simulée : suivi
  des envois, détail d'un courriel reçu avec propositions, paramétrage complet avec un compte et un modèle).

## 24. Réalisation du lot P3k : module Planning (31/10/2026)

- **Périmètre** : le module (`modules/planning/js` : messages du calcul et des dépendances, échelles, en-tête de l'axe —
  jours, mois, semaines —, bulles et étiquettes de la vue, `planning.css`) et ses écrans du cœur : `client/src/app/planning/`
  (états des tâches, ressources d'une tâche, fenêtre de choix des ressources, onglet Ressources), pages `planning.js`
  (planning, panneau, détail d'une tâche, dépendances, jalons, alertes, paramètres), `planning-equipes.js`,
  `planning-prototype.js`, titres des routes.
- **Textes** : `planning.*` du `fr.json` du module (`calcul.erreurs`, `dependances.erreurs`, `echelles`, `temps`, `vue`) ;
  `planning_btp.*` du `fr.json` du cœur (`routes`, `etats`, `onglets`, `modes`, `types_dependance`, `unites_dependance`,
  `modes_dependance`, `frequences`, `types_jalon`, `champs_mobile`, `groupes_tache`, `synchro`, `tris`, `barre`,
  `services`, `panneau`, `historique` — dont les opérations annulables —, `messages`, `menu`, `vue`, `bulle`, `creer`,
  `aplanifier`, `alertes`, `jalons`, `liens`, `detail`, `parametres`, `types_ressource`, `disponibilites`, `ressources`,
  `choix`, `onglet`, `equipes`, `prototype`) ; compteurs par `pluriel` (lignes, tâches, services, modifications, alertes,
  jalons, sélection, membres). Les tables gardent leur forme (`ECHELLES` : libellé en accesseur, `ETATS_TACHE`,
  `TYPES_RESSOURCE`… : `textesParCode`, onglets du panneau et disponibilités : objets à accesseurs).
- **Raccourcis** : bulles d'annuler et rétablir par `libelleRaccourci` (touches personnalisées affichées).
- **Icônes** : `planning_vers` du module ; `planning_btp_*` du cœur ; communes du socle (`ajouter`, `retirer`, `moins`,
  `supprimer`, `precedent`, `suivant`, `replier`, `sous_niveau`, `rechercher`, `enregistrer`, `avertissement`).
- **Couleurs** : vue du module en variables `--pla-*` (thème du module : barres, grille, aujourd'hui, fériés, charge,
  jalons, avancement) ; cœur : `--planning-etat-*` (pastilles des états, `COULEURS_ETAT` en `var(...)`, aussi lues par
  l'application de terrain), `--planning-service-1` à `8`, `--planning-dispo-*`, congé demandé, tâche théorique, chef
  d'équipe, attente d'étape ; couleur proposée d'une tâche par `couleurTheme('--pla-barre')` (champ couleur).
- **Contrôles** : `npm test` (module avec le dictionnaire, clés littérales de `modules/planning/js` vérifiées par le test
  du client) ; affichage contrôlé dans le navigateur (API simulée : planning, panneau complet, détail d'une tâche avec
  dépendances, fenêtre de choix des ressources, équipes, paramètres, prototype).

## 25. Réalisation du lot P3l : module Stock (31/10/2026)

- **Périmètre** : le module (`modules/stock/js/src` : messages du contrôle d'inventaire, méthodes de valorisation) et ses
  écrans du cœur : `client/src/app/stock/` (état du stock et mouvement, onglet Stock de l'article, paramètres et marques,
  marquage en masse, inventaires et bordereaux, approvisionnement et projection, magasin, dotations, saisies de la borne à
  valider, fiche de dotation à signer, onglet Dotations du salarié), titres des routes. Les écrans Stock de la borne
  relèvent du lot P3a (`pointage.borne.*`).
- **Textes** : `stock.*` du module (`inventaire.erreurs`, `methodes`) ; `stock_btp.*` du cœur (`routes`, `sources`,
  `etat`, `colonnes` — en-têtes communs aux écrans —, `marquer`, `niveaux`, `parametres`, `origines`, `article`,
  `types_dotation`, `appro`, `projection`, `inventaire` — dont `etats`, `generations` —, `magasin` — dont `dotations` —,
  `dotations` — dont `periodes` —, `a_valider`, `fiche`) ; compteurs par `pluriel` (articles, commandes, lignes).
  Les tables gardent leur forme (`SOURCES`, `NIVEAUX`, `ORIGINES`, `DOTATIONS` : `textesParCode` ; générations et
  types de dotation : `pairesParCode` ; périodes de l'onglet Dotations : libellé en accesseur).
- **Icônes** : `stock_btp_*` du cœur (stock, chantier, CSV, provisoire, mouvement, marque, projection, retard,
  approvisionnement, retour, inventaire et ses états, impression, magasin, sortie, entrée, dotation, renouvellement) ;
  communes du socle (`ajouter`, `retirer`, `supprimer`).
- **Couleurs** : `--stock-entree`, `--stock-impression-texte`, `--stock-impression-trait`, `--stock-frise-mini`,
  `--stock-frise-rupture` (`styles.css`), couleur proposée d'une nouvelle marque par `couleurTheme('--stock-marque-defaut')`.
- **Contrôles** : `npm test` (module avec le dictionnaire, clés littérales de `modules/stock/js/src` vérifiées par le test
  du client).

## 26. Réalisation du lot P3m : module Exécution (31/10/2026)

- **Périmètre** : le module (`modules/execution/js` : natures et unités des étapes, états des services, messages des
  contrôles d'étapes et de parcours, écran tactile `EcranEtapesAtelier`, `atelier.css`) et ses écrans du cœur :
  `client/src/app/execution/` (panneau Exécution d'un ordre, liaison au planning, bloc de répartition d'une ligne,
  tableau des étapes de l'entête, catalogue des états et états des types d'ordres), page `execution.js` (synthèse, vue
  d'un chantier, modèles de parcours, atelier), titres des routes.
- **Textes** : `execution.*` du module (`etapes.natures`, `etapes.unites`, `etapes.erreurs`, `etats.service`,
  `etats.erreurs`, `atelier`) ; `execution_btp.*` du cœur (`routes`, `etats`, `types_ordre`, `types_ordre_court`,
  `statuts`, `etapes`, `panneau`, `planning`, `repartition`, `catalogue`, `types`, `synthese`, `chantier`, `parcours`,
  `modeles`) ; compteurs par `pluriel` (tâches au planning, tâches créées, ordres mis à jour, autres ordres). Les tables
  gardent leur forme : `NATURES_ETAPE`, `ETATS_SERVICE` et `ETATS_EXECUTION` en objets { libelle, icone } à accesseurs
  (aussi lus par l'onglet Entretiens du matériel), `MESSAGES_*`, `UNITES_ETAPE` et `TYPES_ORDRE` par `textesParCode`,
  statuts déclenchés et types d'ordres courts par `pairesParCode`.
- **Icônes** : `execution_*` du module (natures, états des services, étape validée, valider) ; `execution_btp_*` du cœur
  (états d'exécution, types de ressources, date imposée, recalcul, planifier, synthèse, écart, retard, automatique,
  atelier, monter) ; communes du socle (`ajouter`, `retirer`, `rechercher`, `sous_niveau`, `precedent`).
- **Couleurs** : écran tactile en variables `--exe-*` (thème du module : étape proposée, retard, bouton de validation) ;
  cœur : `--execution-alerte` (retards, écart d'un état imposé), `--execution-etape-defaut` (pastille et couleur proposée
  d'un état, par `couleurTheme`).
- **Contrôles** : `npm test` (module avec le dictionnaire, clés littérales de `modules/execution/js` vérifiées par le
  test du client) ; affichage contrôlé dans le navigateur (API simulée : synthèse, vue d'un chantier, modèles et
  catalogue, atelier, panneau d'un ordre avec étapes, planning et budget, répartition).

## 27. Réalisation du lot P3n : module Sous-traitance (31/10/2026)

- **Périmètre** : le module (`modules/sous-traitance/js/src` : états des pièces et des demandes de paiement direct,
  actions bloquées, portées, messages du paiement direct, de la retenue et de la ventilation) et ses écrans du cœur :
  `client/src/app/sous-traitance/` (onglet Pièces, onglet Paiements, réception et retenue de garantie, assistant
  Sous-traiter), `structure/marche-sous-traitance.js` (marché de sous-traitance proposé à la validation d'une commande),
  pages `parametres-sous-traitance.js` (pièces exigées) et `consultation.js` (comparatif des offres d'un lot de
  consultation, commun aux demandes de prix), titres des routes.
- **Textes** : `sous_traitance.*` du module (`pieces.etats`, `pieces.actions`, `pieces.portees`, `paiement_direct.etats`,
  `paiement_direct.erreurs`, `retenue.erreurs`, `ventilation.erreurs`) ; `sous_traitance_btp.*` du cœur (`routes`,
  `paiements`, `retenue`, `pieces`, `assistant`, `garanties`, `marche`, `parametres` — dont `publics`, `garanties`,
  `bloque` : en-têtes des actions bloquées par code, plus déduits du libellé —, `comparatif`) ; compteurs par `pluriel`
  (pièces à renouveler, offres, lignes rapprochées, autres offres, offres non retenues). Le motif « Ajoutée sur la
  fiche » d'une pièce ajoutée est lu dans le dictionnaire au moment de l'écriture.
- **Icônes** : `sous_traitance_piece_*`, `sous_traitance_pd_*` du module ; `sous_traitance_btp_*` du cœur (délai,
  déclarer, accepter, transmettre, payer, libération, conformité, courriel, document, dépôt, dispense, rétablir,
  sous-traiter, comparatif, retenir, monter) ; communes du socle (`ajouter`, `retirer`, `supprimer`).
- **Couleurs** : `--sous-traitance-conforme`, `--sous-traitance-conforme-fond`, `--sous-traitance-non-conforme`,
  `--sous-traitance-non-conforme-fond`, `--sous-traitance-a-echeance` (`styles.css`).
- **Contrôles** : `npm test` (module avec le dictionnaire, clés littérales de `modules/sous-traitance/js/src` vérifiées
  par le test du client) ; affichage contrôlé dans le navigateur (API simulée : paiements et retenue, pièces, pièces
  exigées, comparatif, assistant Sous-traiter).

## 28. Réalisation du lot P3o : module Comptabilité (31/10/2026)

- **Périmètre** : le module (`modules/comptabilite/js/src` : messages des comptes, étapes et message de la règle de
  ventilation ; dépendance au socle ajoutée) et ses écrans du cœur : page `comptabilite.js` (plan comptable, tiers par
  compte, paramètres — comptes, collectifs, types comptables, types de documents, catégories et taux de TVA —,
  ventilation natures × taux, export des écritures et lots), titres des routes.
- **Textes** : `comptabilite.*` du module (`comptes.erreurs`, `ventilation.origines`, `ventilation.erreurs`) ;
  `comptabilite_btp.*` du cœur (`routes`, `classes`, `types_compte`, `sens_compte`, `types_tiers`,
  `comportements_tva`, `exigibilites`, `familles`, `postes` — comptes des postes des types comptables —, `plan`, `tiers`
  — dont `segments` —, `ordre`, `parametres`, `ventilation`, `export`) ; compteurs par `pluriel` (comptes, lignes,
  comptes créés, lignes sans compte, pièces, pièces exportables, exportées, exclues). Les tables gardent leur forme :
  options { valeur, libelle } par `pairesParCode`, `CLASSES`, `TYPES_COMPTE_TIERS` et familles par `textesParCode` ;
  bouton Enregistrer des sections commun (`boutonEnregistrer`).
- **Icônes** : `comptabilite_btp_*` (plan, tiers, ventilation, export, aperçu, générer, hors longueur et doublon,
  créer, pièce comptable, vers, modifié, replier / déplier une écriture, télécharger, annuler un lot, monter,
  descendre) ; communes du socle (`ajouter`, `retirer`, `supprimer`).
- **Couleurs** : aucune couleur en dur dans ces écrans (classes `discret`, `erreur` du thème).
- **Contrôles** : `npm test` (module avec le dictionnaire, clés littérales de `modules/comptabilite/js/src` vérifiées
  par le test du client) ; affichage contrôlé dans le navigateur (API simulée : plan avec saisie d'un compte, tiers,
  paramètres complets, ventilation, export avec aperçu et lots).

## 29. Réalisation du lot P3p : module Calendrier (31/10/2026)

- **Périmètre** : le module (`modules/calendrier/js/src/calendrier.js` : règles des jours fériés, jours de la semaine,
  messages des contrôles ; dépendance au socle ajoutée) et la page du cœur `parametres-calendriers.js` (liste des
  calendriers, édition des plages et du cycle, jours fériés et fermetures par portée, services), titre de la route.
- **Textes** : `calendrier.*` du module (`regles`, `jours`, `erreurs_regles` ; message du cycle à variable `{{max}}`) ;
  `calendrier_btp.*` du cœur (`zones`, `resume`, `liste`, `edition`, `fermes`, `services`, `routes`).
- **Icônes** : `calendrier_btp_*` (calendrier, par défaut, actif, fermé) ; communes du socle.
- **Couleurs** : aucune couleur en dur (classes du thème).
- **Contrôles** : `npm test` (module avec le dictionnaire, clés littérales de `modules/calendrier/js/src` vérifiées par
  le test du client).

## 30. Réalisation du lot P3q : module Métré (31/10/2026)

- **Périmètre** : le module (`modules/metre/js/src` : messages du lexeur, de l'analyseur, de l'interpréteur, des fonctions
  et des portées, message d'une erreur pour l'hôte ; `ui` : panneau de métré, éditeur CodeMirror, dictionnaire,
  notifications) et la fonction `Conditionnements` du cœur (`client/src/calcul/fonctions-btp.js`, `document_btp.fonctions`).
- **Textes** : `metre.*` (`script` — dont `types` N / C / B par `textesParCode` —, `fonctions` — descriptions par
  accesseurs, arguments —, `portees`, `dictionnaire`, `editeur.structures`, `notifications`, `panneau` — dont
  `erreurs` par `pluriel`, `resultat_html` —). Les jeux partagés comparent les codes d'erreur : les messages changent
  sans toucher au C#. Restent dans le code : mots-clés et types du langage, signatures des fonctions, modèles des
  structures, script produit par la conversion des métrés en lignes (`conversion.js`, miroir de `ConversionMetre`),
  message de `RACINE_NEGATIVE` (déjà par `erreurs.<CODE>`, lot P2).
- **Icônes** : `metre_erreur`, `metre_avertissement`.
- **Couleurs** : couleurs du langage (`--code-*`, clair et sombre) et ombre du panneau (`--metre-ombre`) déplacées de
  `metre.css` vers `personnalisation/theme.css` du module.
- **Contrôles** : `npm test` (module avec le dictionnaire, clés littérales de `modules/metre/js/src` et `ui` vérifiées
  par le test du client) ; panneau de métré affiché dans le navigateur (devis de démonstration : script, variables,
  dictionnaire, notifications).

## 31. Réalisation du lot P3r : module Édition (31/10/2026)

- **Périmètre** : le moteur (`modules/edition/js/src` : alertes de la composition, du rapport, de la pagination et des
  étiquettes, erreurs des formules, de la charte, des images, du modèle et du Code 39, libellés imprimés par défaut
  — Report, À reporter, Total —, catalogue de l'aide du langage) et les écrans du cœur : aperçu (`pages/edition.js`),
  éditeur du modèle et dictionnaire (`editions/editeur-modele.js`, `dictionnaire-modele.js`), paramétrage
  (`pages/parametres-editions.js` : mentions, défauts, import, modèles), titres des routes.
- **Serveur** : le moteur tourne aussi dans Jint ; `serveur/entree.js` pose le dictionnaire du module (fr.json intégré
  au paquet par esbuild) : mêmes alertes et mêmes libellés imprimés qu'au navigateur, parité Node ↔ Jint vérifiée
  (`dotnet test` du module). Les surcharges de l'installation ne s'appliquent qu'à l'aperçu (à reprendre si besoin :
  passer le dictionnaire composé à `initialiser`).
- **Textes** : `edition.*` du module ; `edition_btp.*` du cœur (`apercu` — dont `etats` et `motifs` des productions —,
  `editeur`, `dictionnaire`, `parametres` — dont `conflits`, `actions` de l'import —, `mentions`, `routes`). Catégories
  des fonctions par codes (`textesParCode`), descriptions par accesseurs.
- **Hors lot** : modèles fournis `editions/modeles.js` (contenu des éditions écrit en base par `db/191` : données
  système), couleurs de la charte par défaut, noms des mois et nombres en lettres du moteur.
- **Icônes** : `edition_btp_*` (imprimer, PDF, ranger, double, actualiser, modèle, dictionnaire, appliquer, vérifier,
  rétablir, rapport, sous-rapport, bloc, attente, fait…) ; communes du socle.
- **Contrôles** : `npm test`, `npm run exporter-resultats` puis `dotnet test` du module (17 tests) ; aperçu, éditeur,
  dictionnaire et paramétrage affichés dans le navigateur (API simulée).
