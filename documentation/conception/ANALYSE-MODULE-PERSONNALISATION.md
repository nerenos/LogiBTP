

## 36. Réalisation du lot P3w : fiches du cœur (01/11/2026)

- **Périmètre** : spécialisations des fiches du cœur : `fiches/fiches.js` (onglets communs, informations du salarié et
  du matériel, contrôles), `fiche-element.js` (types d'élément, onglets, périodes et modes des coefficients, aides des
  ouvrages et ensembles, image et notice), `fiche-annuaire.js` (informations, onglets, validation et fusion des tiers
  provisoires, actions), `fiche-structure.js` (statuts, raccourcis vers les listes, recherches de tiers et
  d'individus, prospect, liens, règlements, zones de déplacement, onglets ; gestion du marché : récapitulatif,
  situations, factures d'avancement, sous-traitants, engagé et réalisé, avancement réel, acomptes, postes de pied et
  boutons de création).
- **Textes** : `fiches_btp.*` : `onglets`, `salarie`, `infos`, `controles`, `element.*`, `annuaire.*`, `structure.*`
  (`statuts`, `listes`, `liens`, `colonnes` des tableaux de gestion, `gestion`, `engage`, `avancement`, `acomptes`
  avec `deductions`, `postes` avec `types`, `portees`, `modes`, `sens`, `niveaux`, `creations.<type>.libelle|nom|titre`) ;
  listes de choix par `pairesParCode`, statuts par `textesParCode`, nombres par `pluriel`.
- **Icônes** : `fiches_btp_*` (individu, ouvrage, ensemble, notice, société de la base, provisoire, entreprises,
  valider, fusionner, salarié, particulier, BL, ordre, situation, facture d'avancement, reprise).
- **Hors lot** : les titres des groupes comparés par le code (`groupeVisible` : groupe « Sous-traitance » de la
  définition) suivent les définitions des fiches, rangées avec les données système (§ 8).
- **Contrôles** : `npm test`, analyse des portées ; onglet Gestion d'un marché affiché dans le navigateur.

## 37. Réalisation du lot P3x : structure, documents et hors ligne (01/11/2026)

- **Périmètre** : structure des affaires (`structure/` : adresses des travaux et de livraison, filtre des listes par
  rattachement, graphe de la structure, intervenants, fenêtre du marché d'une commande, liste de choix des
  rattachements, contrôle des intervenants et code déjà pris), documents (`documents/` : fenêtre de transformation,
  options et variantes, documents sources, points à vérifier, onglet Traçabilité), page des règlements
  (`pages/reglements.js`), saisie hors ligne (`hors-ligne/` : états des saisies en attente, libellés des entités,
  messages d'envoi) et page de fusion (`pages/fusion-document.js`).
- **Textes** : `structure_btp.*` (`adresses`, `filtre`, `niveaux`, `graphe`, `intervenants`, `marche_commande`,
  `selection`), `documents_btp.*` (`transformation.etapes|descriptions`, `options`, `sources`, `tracabilite`,
  `avertissements`), `reglements_btp.*`, `hors_ligne_btp.*` (`etats`, `entites`, `envoi`, `fusion`) ; statuts de la liste de
  choix : ceux des fiches de la structure (`fiches_btp.structure.statuts`). Les messages du contrôle des intervenants
  passent par le dictionnaire, en français identiques à `Intervenants.Controler` (test inchangé).
- **Icônes** : `structure_btp_*` (types du graphe, principal, ouvrir), `documents_btp_<type>` des cibles de
  transformation, importé, réimporter, `reglements_btp_page`, `hors_ligne_btp_*` (fusion, garder, copie, fusionner).
- **Couleurs** : nœuds du graphe de la structure et familles de documents par les variables `--graphe-structure-*` du
  thème (lues par `couleurTheme` au dessin, aussi pour l'export SVG).
- **Contrôles** : `npm test`, analyse des portées ; fenêtres de transformation, d'options, de sources, de choix d'un
  rattachement, d'adresse et table des intervenants affichées dans le navigateur.
