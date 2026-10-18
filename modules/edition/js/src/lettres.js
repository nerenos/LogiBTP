// Nombres et montants en toutes lettres (factures : « Arrêté la présente facture à la somme de… »).
// Règles traditionnelles : traits d'union sous cent, « et » pour 21 à 71, « quatre-vingts » et « cents » au pluriel
// en fin de nombre, « mille » invariable, « million(s) » et « milliard(s) » noms.
import { Dec, D } from '@logibtp/socle';

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
  'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function moinsDeCent(n, fin) {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10);
  let u = n % 10;
  if (d === 7 || d === 9) u += 10;
  if (u === 0) return d === 8 && fin ? 'quatre-vingts' : DIZAINES[d];
  if (u === 1 && d !== 8 && d !== 9) return `${DIZAINES[d]} et ${UNITES[u]}`;
  if (u === 11 && d === 7) return 'soixante et onze';
  return `${DIZAINES[d]}-${UNITES[u]}`;
}

function moinsDeMille(n, fin) {
  const c = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (c > 0) parts.push(c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 && fin ? 's' : ''}`);
  if (r > 0 || c === 0) parts.push(moinsDeCent(r, fin));
  return parts.join(' ');
}

/** Entier positif en lettres. */
export function entierEnLettres(n) {
  if (n === 0) return 'zéro';
  const groupes = [];
  const echelles = [['', ''], ['mille', 'mille'], ['million', 'millions'], ['milliard', 'milliards']];
  let reste = n;
  let i = 0;
  while (reste > 0 && i < echelles.length) {
    const g = reste % 1000;
    if (g > 0) {
      const [sing, plur] = echelles[i];
      let mots;
      if (i === 1) mots = g === 1 ? 'mille' : `${moinsDeMille(g, false)} mille`;
      else mots = moinsDeMille(g, i === 0) + (i > 1 ? ` ${g > 1 ? plur : sing}` : '');
      groupes.unshift(mots);
    }
    reste = Math.floor(reste / 1000);
    i++;
  }
  return groupes.join(' ');
}

/** Montant en lettres : « cent vingt-sept euros et douze centimes » (unité et sous-unité paramétrables). */
export function montantEnLettres(v, unite = 'euro', sousUnite = 'centime') {
  const d = D(v);
  if (d === null) return '';
  const a = d.abs().toDecimalPlaces(2, Dec.ROUND_HALF_UP);
  const entier = Number(a.floor().toFixed(0));
  const cents = Number(a.minus(a.floor()).times(100).toFixed(0));
  const pl = (n, mot) => (n > 1 ? `${mot}s` : mot);
  // « de » après million(s) / milliard(s) ronds : un million d'euros.
  const lettres = entierEnLettres(entier);
  const de = /(million|milliard)s?$/.test(lettres) ? (/^[aeiouyéè]/i.test(unite) ? " d'" : ' de ') : ' ';
  let s = `${lettres}${de}${pl(entier, unite)}`.replace(/ d' /, " d'");
  if (cents) s += ` et ${entierEnLettres(cents)} ${pl(cents, sousUnite)}`;
  return (d.isNegative() && !a.isZero() ? 'moins ' : '') + s;
}
