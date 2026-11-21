import { D, S, arr6 } from '@logibtp/socle';
import { ratioOuNul } from './appel.js';

// Écart entre le PA d'une ligne de document et le PA de référence de son élément de bibliothèque (lot 9 du plan
// fiches-lignes-documents, Q16 à Q19) : le PA de référence (par unité de stock, fournisseur de la pièce dans les
// documents d'achat) est converti dans l'unité de la ligne par les conversions de l'élément ; sans conversion
// possible, pas d'indicateur. La mise à jour de la bibliothèque repasse le PA de la ligne en unité de stock.

/** Sens de l'écart : la ligne est plus chère ou moins chère que la bibliothèque. */
export const SENS_ECART_PA = Object.freeze({ PLUS_CHER: 'PLUS_CHER', MOINS_CHER: 'MOINS_CHER' });

/** Écart minimal affiché (en PA de la ligne) : en dessous, l'arrondi des conversions d'unité, pas un écart de prix. */
export const SEUIL_ECART_PA = D('0.0001');

/**
 * Écart d'une ligne : null (pas d'indicateur) ou { sens, pa_bibliotheque (unité de la ligne), ecart (ligne − bibliothèque),
 * pa_stock (PA de la ligne par unité de stock), ratio, reference }. `element` : élément lu (unité de stock, unités,
 * données), `reference` : { pa, compose, empreinte… } du PA de référence.
 */
export function ecartPa(ligne, element, reference) {
  if (!element || !reference || reference.compose || reference.pa === null || reference.pa === undefined) return null;
  const pa = D(ligne?.lig_pa);
  if (pa === null || !ligne.lig_unt_code) return null;
  const r = ratioOuNul(element, ligne.lig_unt_code);
  if (!r || r.isZero()) return null;
  const bibliotheque = arr6(D(reference.pa).times(r));
  const ecart = arr6(pa.minus(bibliotheque));
  if (ecart.abs().lt(SEUIL_ECART_PA)) return null;
  return {
    sens: ecart.gt(0) ? SENS_ECART_PA.PLUS_CHER : SENS_ECART_PA.MOINS_CHER,
    pa_bibliotheque: S(bibliotheque), ecart: S(ecart), pa_stock: S(arr6(pa.div(r))), ratio: S(r), reference,
  };
}
