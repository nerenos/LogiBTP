import { CFG_LIGNES as C, descendants, racinesSelection } from './arbre.js';

// Couper, copier, coller entre documents de l'application, via un JSON placé dans le presse-papiers système.
// La copie porte des sous-arbres complets : lignes, enfants, métrés, lignes de métré, variables et propriétés.

const FORMAT = 'logibtp-lignes';
let memoire = null; // repli si l'accès au presse-papiers système est refusé

export function extraire(saisie, ids, { entId, coupe }) {
  const racines = racinesSelection(C, saisie.lignes, ids);
  const garder = new Set();
  for (const r of racines) { garder.add(r.lig_id); for (const d of descendants(C, saisie.lignes, r.lig_id)) garder.add(d); }
  const lignes = saisie.lignes.filter((l) => garder.has(l.lig_id));
  const metres = saisie.metres.filter((m) => garder.has(m.mtr_lig_id));
  const mids = new Set(metres.map((m) => m.mtr_id));
  return {
    format: FORMAT,
    version: 1,
    source_ent_id: entId,
    coupe,
    racines: racines.map((r) => r.lig_id),
    lignes,
    metres,
    metre_lignes: saisie.metre_lignes.filter((x) => mids.has(x.mli_mtr_id)),
    variables: saisie.variables.filter((v) => (v.var_lig_id !== null && garder.has(v.var_lig_id)) || (v.var_mtr_id !== null && mids.has(v.var_mtr_id))),
  };
}

export async function ecrire(contenu) {
  memoire = contenu;
  try { await navigator.clipboard.writeText(JSON.stringify(contenu)); } catch { /* mémoire interne */ }
}

export async function lire() {
  try {
    const texte = await navigator.clipboard.readText();
    const o = JSON.parse(texte);
    if (o?.format === FORMAT) return o;
  } catch { /* presse-papiers inaccessible ou autre contenu */ }
  return memoire;
}

export function oublierCoupe() {
  if (memoire) memoire.coupe = false;
}

/**
 * Copie avec de nouveaux ID temporaires (négatifs). Les racines gardent leur parent d'origine
 * (à replacer par l'appelant) ; les références internes sont renumérotées, les externes supprimées.
 */
export function renumeroter(contenu, prochainId) {
  let n = prochainId;
  const lig = new Map(), mtr = new Map(), mli = new Map();
  for (const l of contenu.lignes) lig.set(l.lig_id, n--);
  for (const m of contenu.metres) mtr.set(m.mtr_id, n--);
  for (const x of contenu.metre_lignes) mli.set(x.mli_id, n--);
  const vars = contenu.variables.map(() => n--);
  const map = (t, v) => (v === null || v === undefined ? null : t.get(v) ?? null);
  const lignes = contenu.lignes.map((l) => ({
    ...structuredClone(l),
    lig_id: lig.get(l.lig_id),
    lig_parent_id: lig.has(l.lig_parent_id) ? lig.get(l.lig_parent_id) : l.lig_parent_id,
    lig_st_depuis_id: map(lig, l.lig_st_depuis_id),
    lig_variante_de_id: map(lig, l.lig_variante_de_id),
    lig_mtr_id: map(mtr, l.lig_mtr_id),
    lig_origine_id: l.lig_id > 0 ? l.lig_id : l.lig_origine_id ?? null,
    lig_numerotation: l.lig_num_manuelle ? l.lig_numerotation : null,
  }));
  return {
    racines: contenu.racines.map((r) => lig.get(r)),
    lignes,
    metres: contenu.metres.map((m) => ({ ...structuredClone(m), mtr_id: mtr.get(m.mtr_id), mtr_lig_id: lig.get(m.mtr_lig_id) })),
    metre_lignes: contenu.metre_lignes.map((x) => ({
      ...structuredClone(x), mli_id: mli.get(x.mli_id), mli_mtr_id: mtr.get(x.mli_mtr_id),
      mli_parent_id: map(mli, x.mli_parent_id), mli_st_depuis_id: map(mli, x.mli_st_depuis_id),
    })),
    variables: contenu.variables.map((v, i) => ({
      ...structuredClone(v), var_id: vars[i], var_lig_id: map(lig, v.var_lig_id), var_mtr_id: map(mtr, v.var_mtr_id),
    })),
  };
}
