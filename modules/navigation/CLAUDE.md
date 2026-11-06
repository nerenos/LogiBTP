# Module Navigation – contexte

- Détail à lire avant de toucher une partie (inventaire des fichiers, modèle de données, points de spécialisation, routes) : [NAVIGATION.md](../../documentation/modules/NAVIGATION.md).

## Rôle
- Squelette de l'application web à routes, sans métier : routeur sur l'historique du navigateur, classe mère des pages (`PageBase`), fenêtres multiples et session restaurable, préférences du navigateur, bandeau à menus façon Windows, accueil personnalisable et widgets.
- Paquet `@logibtp/navigation` (`modules/navigation/js`), deux points d'entrée : `.` (logique sans interface, testable sous Node) et `./ui` (+ `./ui/navigation.css`).

## Dépendances
- Dépend de : `@logibtp/socle` (seulement `echapper`, `confirmer` et `ouvrirModale` de `@logibtp/socle/ui`, côté `ui/`). Aucun autre module, jamais le cœur.
- Utilisations par le cœur : voir le détail.

## Repères
- `PageBase` (méthode patron) : `ouvrir`, `modifiee`, `quitter` (false = rester), `reprendre`, `masquer`, `fermer`, `urlCourante`, `etatAffichage` ; `static conserver = true` garde la page en mémoire (3 au plus).
- Menus, raccourcis, widgets et routes viennent du cœur (`navigation/menus.js`, `navigation/widgets.js`, `pages/index.js`) ; Alt + lettre des menus par le groupe de raccourcis `menus`.
- Fenêtres multiples : `GestionFenetres` (BroadcastChannel `logibtp-fenetres`).

## Conventions et pièges
- Textes dans `js/personnalisation/fr.json` (`navigation.*`, module Personnalisation), lus par `texte` / `texteHtml` / `pluriel` de `@logibtp/socle/dictionnaire` ; les tests posent le dictionnaire socle + navigation (`js/test/preparation.js`).
- Toute ouverture d'écran passe par `app.naviguer(url, { nouvelleFenetre })`, jamais par un panneau superposé ; chaque URL désigne un écran précis (partage, nouvelle fenêtre, restauration de session).
- `PageBase` a `fermer()` ; la méthode `liberer()` (verrous) est propre aux pages `document.js` / `fiche.js` du cœur.
- Les navigations sont sérialisées par `Routeur.enCours` ; `popstate` refusé par la garde → `history.go(delta)` avec `ignorerPopstate`.
- Préférences et session dans le `localStorage` (propre à l'origine, donc à la société) ; identifiant de fenêtre dans le `sessionStorage` (onglet dupliqué détecté par `qui` / `present`). Le module n'écrit jamais en base ; le cœur peut passer à `Preferences` un `stockage` de son choix (accueil : préférences du compte en base, `client/src/app/preferences-compte.js`).
- `annoncer()` après tout changement de page, titre ou `modifiee` (le cœur le fait dans `majPage`).
- Rechargement : `memoriser()` garde onglet (`etatAffichage`) et défilements (`defilements` / `appliquerDefilements`, éléments retrouvés par chemin + classe) dans `sessionStorage` (`CLE_AFFICHAGE`, car `history.replaceState` est ignoré pendant `pagehide`) et une copie HTML de la page (`CLE_APERCU`, ≤ 1,5 Mo) ; `client/index.html` puis `afficherApercu` la posent inerte par-dessus `.pages` jusqu'à l'ouverture de la vraie page (retirée par le nettoyage du routeur, ou après 10 s).
- Restauration : le navigateur peut bloquer les pop-up au-delà de la première ; les `bloquees` se rouvrent une à une depuis l'accueil.
- Pas de métier ici : menus, raccourcis, widgets et routes sont fournis par le cœur.

## Tests
- `npm test --workspace modules/navigation/js` (vitest), ou `npm test` à la racine (tous les espaces de travail).
