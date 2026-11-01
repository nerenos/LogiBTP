import { textesParCode } from '@logibtp/socle/dictionnaire';
import { Dec, Dz, S, ZERO, arrondir } from '@logibtp/socle';
import { TYPE_PRIX, ARRONDI_REVISION } from '../codes.js';

// Révision et actualisation des prix des marchés par index (CONCEPTION-REVISION-PRIX.md, décisions du 31/10/2026),
// répliquées dans src/LogiBTP.Domaine/ReglesRevision.cs (jeu tests/revision/01_revision.json) : contrôle d'une formule
// (Cn = partie fixe + Σ poids × In / I0), mois de l'index d'une pièce, coefficient (I0 au mois zéro exact ; In au mois de
// l'index, sinon dernier connu avant, alors provisoire ; valeurs d'une ancienne base raccordées ; rapports arrondis à
// 10 décimales ; coefficient arrondi au plus proche ou à la valeur supérieure), révision cumulée et régularisation.
// Mois au format « AAAA-MM ».

/** Erreurs d'une formule de révision (ErreursRevision côté C#). */
export const ERREUR_REVISION = Object.freeze({
  SANS_TERME: 'REV_SANS_TERME',
  POIDS: 'REV_POIDS',
  PARTIE_FIXE: 'REV_PARTIE_FIXE',
  SOMME: 'REV_SOMME',
  INDEX_DOUBLE: 'REV_INDEX_DOUBLE',
  PRECISION: 'REV_PRECISION',
  ARRONDI: 'REV_ARRONDI',
});

export const MESSAGES_REVISION = textesParCode('revision_btp.erreurs', Object.values(ERREUR_REVISION));

const PRECISION_RAPPORT = 10;

/** Erreurs d'une formule { partie_fixe, termes [{ index, poids }], precision, arrondi }, dans l'ordre des codes. */
export function controlerFormule(f) {
  const e = new Set();
  const termes = f.termes ?? [];
  if (!termes.length) e.add(ERREUR_REVISION.SANS_TERME);
  if (termes.some((t) => !Dz(t.poids).gt(ZERO))) e.add(ERREUR_REVISION.POIDS);
  const a = Dz(f.partie_fixe);
  if (a.lt(ZERO) || a.gte(1)) e.add(ERREUR_REVISION.PARTIE_FIXE);
  if (termes.length && !termes.reduce((s, t) => s.plus(Dz(t.poids)), a).equals(1)) e.add(ERREUR_REVISION.SOMME);
  const codes = termes.map((t) => String(t.index ?? '').trim().toUpperCase());
  if (new Set(codes).size !== codes.length) e.add(ERREUR_REVISION.INDEX_DOUBLE);
  const p = f.precision ?? 3;
  if (!Number.isInteger(p) || p < 0 || p > 6) e.add(ERREUR_REVISION.PRECISION);
  if (![ARRONDI_REVISION.PROCHE, ARRONDI_REVISION.SUPERIEUR].includes(f.arrondi ?? ARRONDI_REVISION.PROCHE)) e.add(ERREUR_REVISION.ARRONDI);
  return Object.values(ERREUR_REVISION).filter((c) => e.has(c));
}

/** Mois « AAAA-MM » d'une date ou d'un mois. */
export const mois = (d) => String(d).slice(0, 7);

/** Mois décalé de n mois (n négatif : avant). */
export function ajouterMois(m, n) {
  const [a, mm] = mois(m).split('-').map(Number);
  const t = a * 12 + (mm - 1) + n;
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/**
 * Mois de l'index d'une pièce : révisable = mois de la pièce − décalage ; actualisable = début des travaux − 3 mois,
 * seulement si le début est plus de trois mois après le mois zéro (sinon null) ; ferme : null.
 * p : { type_prix, mois_zero, decalage, debut_travaux }.
 */
export function moisIndex(p, moisPiece) {
  if (p.type_prix === TYPE_PRIX.REVISABLE) return ajouterMois(moisPiece, -(p.decalage ?? 0));
  if (p.type_prix !== TYPE_PRIX.ACTUALISABLE || !p.mois_zero || !p.debut_travaux) return null;
  const m = ajouterMois(p.debut_travaux, -3);
  return m > mois(p.mois_zero) ? m : null;
}

const valeur = (serie, v) => {
  const r = v.base ? serie.raccordements?.[v.base] : null;
  return r !== null && r !== undefined ? Dz(v.valeur).times(Dz(r)) : Dz(v.valeur);
};

function arrondirCoef(v, precision, mode) {
  return mode === ARRONDI_REVISION.SUPERIEUR ? Dz(v).toDecimalPlaces(precision, Dec.ROUND_CEIL) : arrondir(v, precision);
}

/**
 * Coefficient d'une formule entre le mois zéro et le mois de l'index : { coef (chaîne ou null), provisoire, manquants
 * (« BT01 I0 », « BT01 In »), mois_index }. series : { code: { valeurs [{ mois, valeur, provisoire, base }], raccordements } }.
 */
export function coefficient(f, series, moisZero, moisIdx) {
  const zero = mois(moisZero);
  const n = mois(moisIdx);
  const manquants = [];
  let provisoire = false;
  let c = Dz(f.partie_fixe);
  for (const t of f.termes ?? []) {
    const s = series[t.index];
    const v0 = s?.valeurs.find((v) => mois(v.mois) === zero);
    const vn = s ? [...s.valeurs].filter((v) => mois(v.mois) <= n).sort((x, y) => mois(y.mois).localeCompare(mois(x.mois)))[0] : undefined;
    const i0 = v0 ? valeur(s, v0) : null;
    if (!v0 || i0.isZero()) manquants.push(`${t.index} I0`);
    if (!vn) manquants.push(`${t.index} In`);
    if (!v0 || !vn || i0.isZero()) continue;
    provisoire = provisoire || Boolean(v0.provisoire) || Boolean(vn.provisoire) || mois(vn.mois) !== n;
    c = c.plus(Dz(t.poids).times(arrondir(valeur(s, vn).div(i0), PRECISION_RAPPORT)));
  }
  if (manquants.length) return { coef: null, provisoire, manquants, mois_index: n };
  return { coef: S(arrondirCoef(c, f.precision ?? 3, f.arrondi)), provisoire, manquants, mois_index: n };
}

/**
 * Coefficient d'une pièce du marché (mois de la pièce) : ferme ou mois zéro inconnu → null (pas de révision) ;
 * actualisable sans actualisation (début dans les trois mois) → 1 ; actualisation à la baisse ramenée à 1 sauf l'option.
 * p : { type_prix, mois_zero, formule, decalage, debut_travaux, actualisation_baisse }.
 */
export function coefficientPiece(p, series, moisPiece) {
  if (p.type_prix === TYPE_PRIX.FERME || !p.mois_zero) return { coef: null, provisoire: false, manquants: [], mois_index: null };
  const m = moisIndex(p, moisPiece);
  if (m === null) {
    return { coef: p.type_prix === TYPE_PRIX.ACTUALISABLE && p.debut_travaux ? '1' : null, provisoire: false, manquants: [], mois_index: null };
  }
  const c = coefficient(p.formule, series, p.mois_zero, m);
  if (p.type_prix === TYPE_PRIX.ACTUALISABLE && !p.actualisation_baisse && c.coef !== null && Dz(c.coef).lt(1)) return { ...c, coef: '1' };
  return c;
}

/**
 * Révision cumulée : périodes [{ id, base, coef, deja }] → [{ id, revision, a_facturer }] ; révision due = base ×
 * (coefficient − 1) arrondie au montant ; une période sans coefficient garde le déjà facturé.
 */
export function regulariser(periodes, precision = 2) {
  return periodes.map((p) => {
    const due = p.coef === null || p.coef === undefined ? Dz(p.deja) : arrondir(Dz(p.base).times(Dz(p.coef).minus(1)), precision);
    return { id: p.id, revision: S(due), a_facturer: S(due.minus(Dz(p.deja))) };
  });
}

/** Formule saisie « BT01 0,5 ; BT06 0,35 » → termes [{ index, poids }] (poids en chaîne ; texte illisible : null). */
export function lireTermes(saisie) {
  const termes = [];
  for (const morceau of String(saisie ?? '').split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9_.-]+)\s*[:= ]\s*([0-9]+(?:[.,][0-9]+)?)$/.exec(morceau);
    if (!m) return null;
    termes.push({ index: m[1].toUpperCase(), poids: m[2].replace(',', '.') });
  }
  return termes;
}

/** Termes → texte « BT01 0,5 ; BT06 0,35 ». */
export const ecrireTermes = (termes) => (termes ?? []).map((t) => `${t.index} ${String(S(Dz(t.poids))).replace('.', ',')}`).join(' ; ');
