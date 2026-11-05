# Module Graphe – contexte

## Rôle
- Graphe de nœuds et d'arêtes **sans métier** (`@logibtp/graphe`) : parcours en largeur, fusion (développement d'un nœud), disposition en couches ; vue SVG interactive (`@logibtp/graphe/ui`) spécialisée par chaque module.
- Chaque consommateur construit son graphe à partir de ses données dans le format commun, puis le confie à sa sous-classe de `VueGraphe`.

## Dépendances
- Dépend de : `@logibtp/socle` seulement (`echapper`, `lirePreferences`, `ecrirePreferences` de `@logibtp/socle/ui`). Pas de partie .NET ni de base.
- Utilisé par : module Annuaire (`construireGraphe` dans `modules/annuaire/js/src/graphe.js`, `VueGrapheAnnuaire` dans `modules/annuaire/js/ui/graphe.js`) ; cœur : `VueGrapheStructure` (`client/src/app/structure/graphe-structure.js`, onglet Graphe des fiches de la structure) ; `client/src/main.js` importe `@logibtp/graphe/ui/graphe.css`.

## Structure
- `js/src/graphe.js` : `parcourirEnLargeur`, `fusionnerGraphes`, `disposerGraphe`, `voisinage`.
- `js/ui/vue-graphe.js` : classe mère `VueGraphe`, utilitaire `tronquer(texte, n)`.
- `js/ui/graphe.css` : styles de la vue (`.graphe`, `.graphe-barre`, `.graphe-zone`, `.graphe-panneau`, `.graphe-legende`).
- `js/test/graphe.test.js` : parcours, fusion, disposition.

## Format
- `{ noeuds: [{ cle, type, id, libelle, ordre, icone, sous_titre, actif, distance, depart, … }], aretes: [{ cle, de, vers, type, libelle, actif }] }`.
- `cle` unique (ex. `P12`) ; `type` interprété par la spécialisation ; `ordre` = couche (plus petit en haut) ; `distance` = sauts depuis le départ ; propriétés libres (casquettes, niveau…). `colonne: true` = nœud en colonne par défaut ; `ouvrable: false` masque Ouvrir / Centrer / Développer.

## Fonctions
- `parcourirEnLargeur(depart, voisins, profondeur)` → `Map(clé → distance)`, départ à 0.
- `fusionnerGraphes(a, b, { fusionnerNoeud, apres })` : fusion par clé ; nœud présent gardé (ajusté par `fusionnerNoeud(existant, nouveau)`), nœud nouveau jamais `depart` ; `apres({ noeuds, aretes }, b)` = règles de la spécialisation (ex. résumé de contacts retiré).
- `disposerGraphe(graphe, { ecartX=210, ecartY=130, ecartContact=38, iterations=4, enColonne })` → `{ positions: Map(clé → { x, y, couche }), couches }` : couches par `ordre`, barycentre des voisins, pas de chevauchement ; nœuds `enColonne` empilés sous la dernière couche à l'aplomb de leur premier voisin principal (la largeur ne dépend que des principaux).
- `voisinage(graphe, cle)` → `{ noeuds: Set, aretes: Set }` (survol, panneau).

## Points de spécialisation (`VueGraphe`, méthode patron)
- Options du constructeur `(conteneur, options)` : `depart { type, id }`, `charger(depart, reglages)`, `developper(noeud, reglages, extra)`, `ouvrir(noeud, evenement)`, `recentrer(depart, reglages)` (sinon sur place), `pleinEcran(depart, reglages, evenement)` (bouton ⧉ affiché si fourni), `surReglages`, `message`, `reglages`, `cleReglages`, `profondeurMax` (5).
- Méthodes à redéfinir : `chargerGraphe`, `developperGraphe` (défaut : `chargerGraphe` profondeur 1), `fusionner`, `reglagesDefaut`, `controlesReglages` (`[{ type: 'case' | liste, code, libelle, titre, options }]`), `enColonne`, `dimensions`, `couleurNoeud`, `corpsNoeud(n, { x, y, w, h, bord, cx })`, `titreNoeud`, `styleArete` (attributs SVG), `libelleArete` (`{ texte, secondaire, couleur }`), `legende` (`[{ classe, style, libelle }]`), `compte`, `infosNoeud`, `boutonsNoeud` (`[{ code, libelle, titre, action }]`), `relationVoisin`, `peutOuvrir`, `nomExport`.
- `static CLE_REGLAGES` : clé des préférences (`annuaireGraphe`, `structureGraphe`) ; sans spécialisation, les options `charger` / `developper` suffisent.

## Conventions et pièges
- Réglages (dont `profondeur`, bornée 1..`profondeurMax`, défaut 2) dans les préférences du navigateur, jamais en base ; chaque changement réécrit les préférences puis recharge.
- `charger` n'affiche rien si la vue a été retirée de la page pendant le chargement (onglet quitté).
- Positions déplacées à la main gardées dans `manuelles` ; « ⟲ Disposer » les efface. `developper` fusionne puis redispose sans recadrer.
- Export SVG autonome : variables du thème (`--surface`, `--fond`, `--texte`, `--discret`, `--bord`, `--accent`) résolues dans l'image ; marqueurs `graphe-fleche` / `graphe-fleche-lien`.
- Aucune notion métier ici (pas de personne, chantier…) ; le parcours métier vit dans le module consommateur (et en C# s'il est répliqué, ex. `GrapheAnnuaire.cs`).

## Tests
- `npm test --workspace modules/graphe/js` (vitest) ; les parcours métier sont testés dans les modules consommateurs (jeu `modules/annuaire/tests/cas/03_graphe.json`).
