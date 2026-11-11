// Codes du module Comptabilité, répliqués dans LogiBTP.Comptabilite/Codes.cs (parité vérifiée par CodesTests.cs).

/** Catégories de TVA de la norme EN 16931 (le module ne dépend pas de la facture électronique : il porte les siennes). */
export const CATEGORIE_EN16931 = Object.freeze({
  STANDARD: 'S',
  EXONEREE: 'E',
  AUTOLIQUIDATION: 'AE',
  INTRACOMMUNAUTAIRE: 'K',
  EXPORT: 'G',
  HORS_CHAMP: 'O',
  TAUX_ZERO: 'Z',
});

/** Motifs d'exonération (liste VATEX) proposés par défaut. */
export const VATEX = Object.freeze({
  AUTOLIQUIDATION: 'VATEX-FR-AE',
  EXONERATION: 'VATEX-EU-132',
});

/** Comportements de TVA des moteurs de calcul. */
export const COMPORTEMENT_TVA = Object.freeze({
  NORMALE: 'N',
  AUTOLIQUIDATION: 'A',
  INTRACOMMUNAUTAIRE: 'I',
  EXONEREE: 'E',
});
