import { pairesParCode, texte } from '@logibtp/socle/dictionnaire';
import { normaliser } from './normaliser.js';
import { PERIODE, PERIODE_AVEC_NOMBRE, OPERATEUR_PERIODE } from './codes.js';
import { bornesPeriode } from './periodes.js';
import { aujourdhui } from './requete.js';

// Filtres et tri des colonnes, façon tableur. Ils portent sur les lignes déjà chargées (pas sur la base) :
//   valeurs     ensemble des textes affichés retenus (cases à cocher), null = pas de filtre
//   condition   { op, a, b } : nombre / date (= <> > >= < <= entre vide nonvide) ou texte (contient commence finit = <> vide nonvide)
//   format      { fond, couleur, gras, italique, souligne, barre } : mise en forme calculée de la cellule

export const OPERATEURS_NOMBRE = pairesParCode('liste.operateurs', [
  ['=', 'egal'], ['<>', 'different'], ['>', 'superieur'], ['>=', 'superieur_egal'], ['<', 'inferieur'], ['<=', 'inferieur_egal'],
  'entre', 'vide', 'nonvide',
]);
/** Opérateurs d'une colonne de date : ceux des nombres et la période glissante (condition { op: 'periode', a: code, b: nombre }). */
export const OPERATEURS_DATE = pairesParCode('liste.operateurs', [
  ['=', 'egal'], ['<>', 'different'], ['>', 'superieur'], ['>=', 'superieur_egal'], ['<', 'inferieur'], ['<=', 'inferieur_egal'],
  'entre', 'vide', 'nonvide', OPERATEUR_PERIODE,
]);
/** Périodes proposées (code, libellé). */
export const PERIODES_CHOIX = pairesParCode('liste.periodes', Object.values(PERIODE));
export const OPERATEURS_TEXTE = pairesParCode('liste.operateurs', ['contient', 'commence', 'finit', ['=', 'egal'], ['<>', 'different'], 'vide', 'nonvide']);

export const filtreActif = (f) => !!f && (f.valeurs instanceof Set || !!f.condition?.op || (f.format && Object.values(f.format).some((v) => v !== null && v !== undefined)));

const estVide = (v) => v === null || v === undefined || v === '';

/** Nombre d'une donnée ou d'une saisie (virgule acceptée, date ISO en jours), sinon null. */
export function nombreDe(v) {
  if (estVide(v)) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim();
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) ?? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (d) {
    const [a, m, j] = d[1].length === 4 ? [d[1], d[2], d[3]] : [d[3], d[2], d[1]];
    return Date.UTC(Number(a), Number(m) - 1, Number(j)) / 86400000;
  }
  const n = Number(s.replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

/** Nombre x d'une période paramétrée saisie (entier ≥ 1) ou null ; null aussi pour une période sans nombre. */
export function nombrePeriode(code, saisie) {
  if (!PERIODE_AVEC_NOMBRE.includes(code)) return null;
  const n = Number(String(saisie ?? '').trim().replace(',', '.'));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** La période et son nombre sont-ils complets (nombre exigé pour une période paramétrée) ? */
export const periodeComplete = (code, saisie) => !!code && (!PERIODE_AVEC_NOMBRE.includes(code) || nombrePeriode(code, saisie) !== null);

/**
 * Filtre fixe de vue enregistrée pour une période choisie dans le filtre de colonne : le code est gardé, jamais les dates
 * (les bornes sont recalculées à chaque exécution : `resoudrePeriodes`).
 */
export function filtreVuePeriode(colonne, code, saisie = null) {
  const nombre = nombrePeriode(code, saisie);
  return nombre === null ? { colonne, op: OPERATEUR_PERIODE, valeur: code } : { colonne, op: OPERATEUR_PERIODE, valeur: code, nombre };
}

/** Libellé d'une période choisie (« Mois en cours », « Derniers jours : 30 »). */
export function libellePeriode(code, nombre = null) {
  const libelle = PERIODES_CHOIX.find(([c]) => c === code)?.[1] ?? code;
  return nombre === null || nombre === undefined ? libelle : texte('liste.periodes_avec_nombre', { periode: libelle, nombre });
}

/** La date (valeur de la cellule) est-elle dans la période { a: code, b: nombre saisi } à la date de référence ? */
function conditionPeriode(v, a, b, reference, debutExercice) {
  if (estVide(v) || !periodeComplete(a, b)) return false;
  const { debut, fin } = bornesPeriode(a, nombrePeriode(a, b), reference, debutExercice);
  const jour = String(v).slice(0, 10);
  return jour >= debut && jour <= fin;
}

function conditionNombre(op, v, a, b, reference, debutExercice) {
  if (op === 'vide') return estVide(v);
  if (op === 'nonvide') return !estVide(v);
  if (op === OPERATEUR_PERIODE) return conditionPeriode(v, a, b, reference, debutExercice);
  const x = nombreDe(v), ya = nombreDe(a), yb = nombreDe(b);
  if (x === null || ya === null) return false;
  switch (op) {
    case '=': return x === ya;
    case '<>': return x !== ya;
    case '>': return x > ya;
    case '>=': return x >= ya;
    case '<': return x < ya;
    case '<=': return x <= ya;
    case 'entre': return yb !== null && x >= Math.min(ya, yb) && x <= Math.max(ya, yb);
    default: return true;
  }
}

function conditionTexte(op, texte, a) {
  if (op === 'vide') return estVide(texte);
  if (op === 'nonvide') return !estVide(texte);
  const t = normaliser(texte), x = normaliser(a);
  switch (op) {
    case 'contient': return t.includes(x);
    case 'commence': return t.startsWith(x);
    case 'finit': return t.endsWith(x);
    case '=': return t === x;
    case '<>': return t !== x;
    default: return true;
  }
}

export const estNumerique = (colonne) => colonne.format === 'nombre' || colonne.format === 'date';

/** La cellule ({ valeur, texte, style }) satisfait-elle le filtre de la colonne ? */
export function correspond(filtre, cellule, colonne, reference = aujourdhui(), debutExercice = null) {
  if (!filtreActif(filtre)) return true;
  if (filtre.valeurs instanceof Set && !filtre.valeurs.has(cellule.texte)) return false;
  const c = filtre.condition;
  if (c?.op) {
    const ok = estNumerique(colonne) ? conditionNombre(c.op, cellule.valeur, c.a, c.b, reference, debutExercice) : conditionTexte(c.op, cellule.texte, c.a);
    if (!ok) return false;
  }
  const f = filtre.format;
  if (f) {
    const s = cellule.style;
    if (f.fond !== undefined && f.fond !== null && (s.fond ?? '') !== f.fond) return false;
    if (f.couleur !== undefined && f.couleur !== null && (s.couleur ?? '') !== f.couleur) return false;
    for (const k of ['gras', 'italique', 'souligne', 'barre']) {
      if (f[k] !== undefined && f[k] !== null && !!s[k] !== f[k]) return false;
    }
  }
  return true;
}

/** Comparaison de deux valeurs pour le tri : vides en dernier, nombres et dates numériquement, textes en français. */
export function comparerValeurs(a, b, numerique) {
  const va = estVide(a), vb = estVide(b);
  if (va || vb) return va === vb ? 0 : va ? 1 : -1;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(!!a) - Number(!!b);
  if (numerique || (typeof a === 'number' && typeof b === 'number')) {
    const x = nombreDe(a), y = nombreDe(b);
    if (x !== null && y !== null) return x - y;
  }
  return String(a).localeCompare(String(b), 'fr', { sensitivity: 'base', numeric: true });
}

/** Valeurs distinctes affichées d'une colonne sur les lignes chargées, avec leur nombre d'occurrences. */
export function valeursDistinctes(lignes, colonne, modele) {
  const compte = new Map();
  for (const l of lignes) {
    const v = modele.valeur(l, colonne.code);
    const t = modele.texte(v, colonne);
    const e = compte.get(t);
    if (e) e.nombre++;
    else compte.set(t, { texte: t, valeur: v, nombre: 1 });
  }
  // Listes et cases à cocher : ordre des libellés affichés ; sinon ordre des valeurs (nombres, dates).
  const parTexte = ['combo', 'picto', 'pastille', 'coche'].includes(colonne.format);
  return [...compte.values()].sort((x, y) => (parTexte
    ? comparerValeurs(x.texte, y.texte, false)
    : comparerValeurs(x.valeur, y.valeur, estNumerique(colonne))));
}

/** Mises en forme présentes dans une colonne (filtre par couleur). */
export function formatsPresents(lignes, colonne, modele) {
  const fonds = new Set(), couleurs = new Set();
  for (const l of lignes) {
    const s = modele.style(l, colonne.code);
    if (s.fond) fonds.add(s.fond);
    if (s.couleur) couleurs.add(s.couleur);
  }
  return { fonds: [...fonds], couleurs: [...couleurs] };
}
