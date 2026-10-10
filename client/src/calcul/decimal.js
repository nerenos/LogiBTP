import Decimal from 'decimal.js';

// Calcul décimal exclusivement : jamais de Number pour les montants.
// Arrondi commercial (demi vers l'infini), identique à MidpointRounding.AwayFromZero côté C#.
export const Dec = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 40 });

export const ZERO = new Dec(0);
export const UN = new Dec(1);

/** Valeur décimale ou null (null, undefined et chaîne vide). */
export function D(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Dec) return v;
  return new Dec(v);
}

/** Valeur décimale, null valant zéro. */
export const Dz = (v) => D(v) ?? ZERO;

/** Coefficient multiplicateur, null valant 1. */
export const coef = (v) => D(v) ?? UN;

/** Représentation exacte en notation normale, sans zéro négatif. */
export function S(d) {
  if (d === null || d === undefined) return null;
  const x = d instanceof Dec ? d : new Dec(d);
  return x.isZero() ? '0' : x.toFixed();
}

/** Fonction unique d'arrondi du moteur (ArrondiCalcul.Arrondir côté C#). */
export function arrondir(valeur, precision) {
  return Dz(valeur).toDecimalPlaces(precision, Dec.ROUND_HALF_UP);
}

/** Arrondi à la précision de stockage NUMERIC(18,6). */
export const arr6 = (v) => arrondir(v, 6);

/** Format d'affichage des nombres dans les libellés : virgule décimale, zéros non significatifs retirés. */
export function formatNombre(v) {
  const d = Dz(v);
  let s = d.isZero() ? '0' : d.toFixed();
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}
