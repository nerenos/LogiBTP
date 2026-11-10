import { CATEGORIE_EN16931, VATEX, COMPORTEMENT_TVA } from './codes.js';

/** Catégories EN 16931 admises. */
export const CATEGORIES_EN16931 = Object.freeze(Object.values(CATEGORIE_EN16931));

/**
 * Catégorie EN 16931 et code VATEX proposés pour un comportement de TVA (N, A, I, E).
 * Répliquée dans ReglesTva.cs (jeu tests/cas/05_tva_en16931.json). Valeur inconnue : null.
 */
export function proposerEn16931(comportement) {
  switch (comportement) {
    case COMPORTEMENT_TVA.NORMALE: return { categorie: CATEGORIE_EN16931.STANDARD, vatex: null };
    case COMPORTEMENT_TVA.AUTOLIQUIDATION:
    case COMPORTEMENT_TVA.INTRACOMMUNAUTAIRE: return { categorie: CATEGORIE_EN16931.AUTOLIQUIDATION, vatex: VATEX.AUTOLIQUIDATION };
    case COMPORTEMENT_TVA.EXONEREE: return { categorie: CATEGORIE_EN16931.EXONEREE, vatex: VATEX.EXONERATION };
    default: return null;
  }
}
