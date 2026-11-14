// Codes du module Stock, répliqués dans LogiBTP.Stock/Codes.cs (parité vérifiée par CodesTests.cs).

/** Suivi d'un article géré en stock (S24.1) : aucun, par lot (numéro de lot, de coulée), par numéro de série. */
export const SUIVI_ARTICLE = Object.freeze({
  AUCUN: 'AUCUN',
  LOT: 'LOT',
  SERIE: 'SERIE',
});

/** Unité de la durée théorique de péremption d'un article périssable (S24.7) : jours ou mois. */
export const UNITE_DUREE = Object.freeze({
  JOURS: 'J',
  MOIS: 'M',
});

/** Nature d'une part de la ventilation d'un besoin (ventilation.js) : stock d'un dépôt, commande en cours, achat. */
export const NATURE_PART_APPRO = Object.freeze({
  STOCK: 'STOCK',
  COMMANDE: 'COMMANDE',
  ACHAT: 'ACHAT',
});

/** Motif d'une ligne de demande de réappro d'un dépôt (ventilation.js) : mini franchi, article proche de son mini. */
export const MOTIF_REAPPRO = Object.freeze({
  MINI_FRANCHI: 'MINI_FRANCHI',
  PROCHE_MINI: 'PROCHE_MINI',
});
