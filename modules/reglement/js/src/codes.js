// Codes du module Règlements, répliqués dans Codes.cs (parité vérifiée par CodesTests).

/** Modes de règlement posés par le module (hors liste paramétrable des modes de règlement). */
export const MODE_REGLEMENT_SYSTEME = Object.freeze({
  IMPUTATION: 'IMPUTATION',
});

/** Origine d'un pointage d'échéance : règlement, caution, imputation d'un avoir sur une autre pièce. */
export const SOURCE_POINTAGE = Object.freeze({
  REGLEMENT: 'REGLEMENT',
  CAUTION: 'CAUTION',
  IMPUTATION: 'IMPUTATION',
});
