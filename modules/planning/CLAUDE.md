# Module Planning – contexte

## Rôle
- Planification des tâches des chantiers et des services sur des ressources ([analyse](../../documentation/conception/ANALYSE-MODULE-PLANNING.md)). Lot 1 : composant d'affichage propre, sans métier (axe du temps, lignes, barres, glisser, virtualisation), spécialisé par méthode patron.
- Ne connaît ni les chantiers, ni les ressources : lignes et tâches fournies par l'application.

## Dépendances
- JS `@logibtp/planning` → `@logibtp/socle` (`echapper`). Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`client/src/app/pages/planning-prototype.js` : prototype sur volume réaliste).

## Structure
- `js/src/temps.js` : instants « AAAA-MM-JJTHH:MM » ↔ minutes depuis 1970 (`versMinutes`, `depuisMinutes`, `dateDe` ; calcul en UTC, sans changement d'heure), `ECHELLES` (HEURE, DEMI_JOUR, JOUR, SEMAINE : minutes par colonne, groupe d'en-tête), `debutUnite` (JOUR, SEMAINE = lundi, MOIS), `semaineIso`, `colonnes` (libellés, week-ends), `groupes` (jours, semaines, mois), `arrondirAuPas`, `periodeFlottante`.
- `js/src/disposition.js` : `empiler` (voies des barres qui se chevauchent, glouton par début), `cumuler` (positions des lignes), `ligneA` (dichotomie), `visibles` (barres d'une ligne triée qui coupent un intervalle, avec la durée maximale).
- `js/ui/vue-planning.js` : `VuePlanning` (coin, en-tête du temps, en-têtes des lignes et corps défilant synchronisés ; dessin des seules lignes et barres visibles avec une marge, à l'image suivante ou par minuterie de repli, `actualiser()` immédiat ; fond par dégradé répété et bandes de week-end ; hauteur fixe ou adaptée aux voies ; glisser : déplacer — changement de ligne sauf `ligneFixe` —, bords = agrandir, au pas ; Ctrl = copie, Alt + clic = scinder ; sélection, double-clic, menu, dépôt HTML5 ; `definirDonnees`, `majTache`, `ajouterTache`, `supprimerTache`, `regler`, `zoomer`, `allerA` ; méthode patron `contenuBarre`, `classeBarre`, `titreBarre`, `enteteLigne`, `classeLigne`). `js/ui/planning.css` (variables `--vp-entete`, `--vp-voie`, `--vp-couleur`).

## Tests
- `npm test --workspace modules/planning/js` (axe du temps, disposition). Prototype : `/planning/prototype?ressources=500&taches=20000` (mesures affichées : génération, données, dessin).
