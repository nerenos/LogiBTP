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
