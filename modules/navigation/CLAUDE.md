# Module Navigation – contexte

## Rôle
- Squelette de l'application web à routes, sans métier : routeur sur l'historique du navigateur, classe mère des pages (`PageBase`), fenêtres multiples et session restaurable, préférences du navigateur, bandeau à menus façon Windows, accueil personnalisable et widgets.
- Paquet `@logibtp/navigation` (`modules/navigation/js`), deux points d'entrée : `.` (logique sans interface, testable sous Node) et `./ui` (+ `./ui/navigation.css`).

## Dépendances
- Dépend de : `@logibtp/socle` (seulement `echapper` de `@logibtp/socle/ui`, côté `ui/`). Aucun autre module, jamais le cœur.
- Utilisé par : le client seul (`client/src/app/application.js`, `navigation/menus.js`, toutes les pages de `client/src/app/pages/`). Aucun autre module ne l'importe.

## Structure
- `js/src/routeur.js` : `Routeur`, `PageBase`, `correspondre` / `construire` / `analyser` (chemins `/fiche/:type/:id`, `:x?` facultatif).
- `js/src/fenetres.js` : `GestionFenetres` (BroadcastChannel `CANAL` = `logibtp-fenetres`, battement 5 s, expiration 20 s), `sessionAProposer`, `optionsFenetre`, `nouvelId`, clés `CLE_SESSION` / `CLE_PRECEDENTE` (localStorage).
- `js/src/preferences.js` : `Preferences(cle, defauts, stockage)` (`get` / `set` / `reinitialiser`, localStorage), `deplacer(liste, depuis, vers)`.
- `js/ui/bandeau.js` : `Bandeau` (menus déroulants, Alt + lettre `&`, Alt seul, flèches, Alt+Origine = accueil, zone message, infos, logo).
- `js/ui/panneau-fenetres.js` : `PanneauFenetres` (liste des fenêtres : Afficher, 🔔 signaler, fermer la session), `confirmerFermetureSession(modifiees)`.
- `js/ui/accueil.js` : `AccueilBase` (bandeau « Restaurer ma session précédente », raccourcis et widgets personnalisables par glisser, tailles petit / moyen / large).
- `js/ui/widgets.js` : `Widget` (classe mère : `actualiser()` appelle `definition.charger()` puis `rendre(donnees)`), `WidgetIndicateurs`, `WidgetAlertes`, `WidgetTableau`, `WidgetGraphique`, `TYPES_WIDGET`.
- `js/test/navigation.test.js` : routes, routeur (liste conservée, garde, 404), fenêtres (annonce, onglet dupliqué, fermeture / restauration de session, focaliser), préférences.

## API publique et points de spécialisation
- `PageBase` (méthode patron) : `ouvrir()`, `get modifiee`, `quitter()` (confirmation si `modifiee`, false = rester), `reprendre()`, `masquer()`, `fermer()`, `urlCourante()` ; `static conserver = true` garde la page en mémoire (au plus `maxConservees` = 3, éviction de la plus ancienne). Reçoit `{ conteneur, params, requete, app, route }`.
- `Routeur({ routes: [{ nom, chemin, page, titre }], conteneur, app, surPage })` : `demarrer()`, `aller(url, { remplacer, forcer })` (garde `quitter()` sauf `forcer`), `retour(defaut)`, `remplacerUrl(url)` (URL changée sans navigation, clé des pages conservées déplacée), `url(nom, params, requete)`, `trouver(url)` ; route inconnue → route `/404`.
- `GestionFenetres({ etat, surListe, surSignal, surFermetureSession, surDonnees })` : `demarrer`, `annoncer`, `liste`, `ouvrir(url, { position })` (window.open popup), `focaliser(id)`, `signaler(id)`, `diffuser(sujet, contenu)` (message `donnees`), `etatFermeture`, `fermerSession`, `sessionPrecedente`, `restaurer(session)` → `{ ouvertes, bloquees, urlCourante }`.
- Bandeau : `menus: [{ code, libelle: '&Ressources', elements }]`, élément `{ libelle, icone, url, action, separateur, desactive, info, raccourci, coche, fenetre, titre, creation: { url, titre } }` (bouton ＋) ; callback `naviguer(url, { nouvelleFenetre })` ; `message(texte, niveau)`, `infos(html)`, `Bandeau.libelle()`.
- Widgets : `definition = { code, type, titre, icone, taille, url, charger }` ; formats de données documentés en tête de `widgets.js` (éléments avec `url` / `_url` cliquables, Ctrl = nouvelle fenêtre). Nouveau type : sous-classe de `Widget` passée dans `types` d'`AccueilBase`.

## Utilisation par le cœur
- `client/src/app/application.js` : instancie `Preferences('logibtp.navigation', { nouvelleFenetre, profilDemo, theme })`, `Bandeau`, `GestionFenetres`, `Routeur` ; `app.naviguer(url, { nouvelleFenetre, remplacer })` (nouvelle fenêtre ouverte en différé par `fenetres.ouvrir`), `ouvrirElement` (préférence inversée par Ctrl / Maj), interception des liens internes, Ctrl+Maj+F = liste des fenêtres, `publier(sujet, contenu)` = abonnés locaux + `fenetres.diffuser` (ex. sujet `enregistre`).
- `client/src/app/pages/index.js` : `ROUTES` (accueil, liste, fiche, document, ged, parametres…, graphe, import-optim, 404) ; chaque page étend `PageBase` (`PageListe` a `static conserver = true`).
- `client/src/app/navigation/menus.js` (`menus(app)`, `catalogueRaccourcis`, `RACCOURCIS_DEFAUT`) et `navigation/widgets.js` (`catalogueWidgets(app)`, `WIDGETS_DEFAUT`) ; `pages/accueil.js` (`PageAccueil` + `AccueilBase`).
- `pages/document.js`, `fiche.js`, `graphe.js`, `liste.js` appellent `app.routeur.remplacerUrl` (création, réglages, thème / vue).

## Conventions et pièges
- Toute ouverture d'écran passe par `app.naviguer(url, { nouvelleFenetre })`, jamais par un panneau superposé ; chaque URL désigne un écran précis (partage, nouvelle fenêtre, restauration de session).
- `PageBase` a `fermer()` ; la méthode `liberer()` (verrous) est propre aux pages `document.js` / `fiche.js` du cœur.
- Les navigations sont sérialisées par `Routeur.enCours` ; `popstate` refusé par la garde → `history.go(delta)` avec `ignorerPopstate`.
- Préférences et session dans le `localStorage` (propre à l'origine, donc à la société) ; identifiant de fenêtre dans le `sessionStorage` (onglet dupliqué détecté par `qui` / `present`). Jamais en base.
- `annoncer()` après tout changement de page, titre ou `modifiee` (le cœur le fait dans `majPage`).
- Restauration : le navigateur peut bloquer les pop-up au-delà de la première ; les `bloquees` se rouvrent une à une depuis l'accueil.
- Pas de métier ici : menus, raccourcis, widgets et routes sont fournis par le cœur.

## Tests
- `npm test --workspace modules/navigation/js` (vitest), ou `npm test` à la racine (tous les espaces de travail).
