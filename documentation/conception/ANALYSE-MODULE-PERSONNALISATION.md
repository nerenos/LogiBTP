

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
