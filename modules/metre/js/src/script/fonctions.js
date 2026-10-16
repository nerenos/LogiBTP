import { Dec, arrondir, ErreurCalcul } from '@logibtp/socle';
import { MAX_DECIMAL } from './lexeur.js';

// Fonctions du langage de script (réplique de Script/Fonctions.cs). Clé : nom normalisé (minuscules sans
// accents). Valeurs typées : { t: 'N', v: Dec } | { t: 'C', v: string } | { t: 'B', v: boolean }.
// Un hôte ajoute ses fonctions par l'option `fonctions` de analyserScript / executerScript.

export const N = (v) => ({ t: 'N', v });
export const C = (v) => ({ t: 'C', v });
export const B = (v) => ({ t: 'B', v });

/** Valeur numérique d'un argument, sinon erreur TYPE. */
export function nombre(valeur, quoi) {
  if (valeur.t !== 'N') throw new ErreurCalcul('TYPE', `${quoi} : numérique attendu`);
  return valeur.v;
}

/** Nombre entier d'un argument (nombre de décimales, exposant), sinon erreur ARGUMENTS. */
function entier(valeur, quoi, min, max) {
  const v = nombre(valeur, quoi);
  if (!v.isInteger() || v.lt(min) || v.gt(max)) throw new ErreurCalcul('ARGUMENTS', `${quoi} : entier de ${min} à ${max} attendu`);
  return v.toNumber();
}

const unNombre = (nom, f) => (args) => N(f(nombre(args[0], nom)));

export const FONCTIONS = {
  entiersuperieur: {
    min: 1, max: 1, signature: 'EntierSupérieur(x)', description: 'Plus petit entier supérieur ou égal à x',
    appliquer: unNombre('EntierSupérieur', (x) => x.ceil()),
  },
  entierinferieur: {
    min: 1, max: 1, signature: 'EntierInférieur(x)', description: 'Plus grand entier inférieur ou égal à x',
    appliquer: unNombre('EntierInférieur', (x) => x.floor()),
  },
  arrondi: {
    min: 1, max: 2, signature: 'Arrondi(x; décimales)', description: 'Arrondi demi vers l\'infini (0 décimale par défaut)',
    appliquer: (args) => N(arrondir(nombre(args[0], 'Arrondi'), args[1] ? entier(args[1], 'Arrondi, décimales', 0, 10) : 0)),
  },
  tronque: {
    min: 1, max: 2, signature: 'Tronque(x; décimales)', description: 'Troncature vers zéro (0 décimale par défaut)',
    appliquer: (args) => N(nombre(args[0], 'Tronque').toDecimalPlaces(args[1] ? entier(args[1], 'Tronque, décimales', 0, 10) : 0, Dec.ROUND_DOWN)),
  },
  min: {
    min: 1, max: null, signature: 'Min(a; b; …)', description: 'Plus petite des valeurs',
    appliquer: (args) => N(args.map((a) => nombre(a, 'Min')).reduce((m, x) => (x.lt(m) ? x : m))),
  },
  max: {
    min: 1, max: null, signature: 'Max(a; b; …)', description: 'Plus grande des valeurs',
    appliquer: (args) => N(args.map((a) => nombre(a, 'Max')).reduce((m, x) => (x.gt(m) ? x : m))),
  },
  abs: {
    min: 1, max: 1, signature: 'Abs(x)', description: 'Valeur absolue',
    appliquer: unNombre('Abs', (x) => x.abs()),
  },
  racine: {
    min: 1, max: 1, signature: 'Racine(x)', description: 'Racine carrée',
    appliquer: unNombre('Racine', (x) => {
      if (x.isNeg() && !x.isZero()) throw new ErreurCalcul('RACINE_NEGATIVE', 'Racine d\'un nombre négatif');
      return x.sqrt();
    }),
  },
  puissance: {
    min: 2, max: 2, signature: 'Puissance(x; n)', description: 'x à la puissance n (n entier de -100 à 100)',
    appliquer: (args) => {
      const x = nombre(args[0], 'Puissance');
      const n = entier(args[1], 'Puissance, exposant', -100, 100);
      if (x.isZero() && n < 0) throw new ErreurCalcul('DIVISION_ZERO', 'Division par zéro');
      let r = new Dec(1);
      for (let k = 0; k < Math.abs(n); k++) r = r.times(x);
      // Limites du decimal C# : dépassement au-delà de sa plus grande valeur, inverse d'une puissance devenue nulle.
      if (r.abs().gt(MAX_DECIMAL) || (n < 0 && r.abs().lt('1e-28'))) throw new ErreurCalcul('DEPASSEMENT', 'Valeur trop grande');
      return N(n < 0 ? new Dec(1).div(r) : r);
    },
  },
  taille: {
    min: 1, max: 1, signature: 'Taille(chaîne)', description: 'Nombre de caractères',
    appliquer: (args) => {
      if (args[0].t !== 'C') throw new ErreurCalcul('TYPE', 'Taille : chaîne attendue');
      return N(new Dec(args[0].v.length));
    },
  },
};
