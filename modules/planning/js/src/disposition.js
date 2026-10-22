// Disposition des barres d'une ligne du planning (sans métier) : voies des barres qui se chevauchent (algorithme glouton
// par début croissant, première voie libre), recherche des lignes visibles par hauteurs cumulées.

/**
 * Attribue une voie à chaque barre { debut, fin } d'une ligne : deux barres d'une même voie ne se chevauchent pas.
 * Renvoie { voies: Map(barre → indice), nb } ; ordre stable (début, puis fin décroissante, puis ordre d'entrée).
 */
export function empiler(barres) {
  const triees = barres.map((b, i) => ({ b, i })).sort((x, y) => x.b.debut - y.b.debut || y.b.fin - x.b.fin || x.i - y.i);
  const fins = [];
  const voies = new Map();
  for (const { b } of triees) {
    let v = fins.findIndex((f) => f <= b.debut);
    if (v < 0) { v = fins.length; fins.push(b.fin); } else fins[v] = b.fin;
    voies.set(b, v);
  }
  return { voies, nb: fins.length };
}

/** Positions cumulées de lignes de hauteurs données : [0, h0, h0 + h1, …] (longueur n + 1). */
export function cumuler(hauteurs) {
  const r = [0];
  for (const h of hauteurs) r.push(r.at(-1) + h);
  return r;
}

/** Indice de la ligne contenant l'ordonnée y (recherche dichotomique dans les positions cumulées). */
export function ligneA(positions, y) {
  let a = 0;
  let b = positions.length - 2;
  if (b < 0) return -1;
  if (y <= 0) return 0;
  if (y >= positions.at(-1)) return b;
  while (a < b) {
    const m = (a + b + 1) >> 1;
    if (positions[m] <= y) a = m; else b = m - 1;
  }
  return a;
}

/** Barres d'une ligne (triées par début) qui coupent l'intervalle [t0, t1[ : recherche du premier début ≥ t0 − durée max. */
export function visibles(barres, t0, t1, dureeMax) {
  let a = 0;
  let b = barres.length;
  const borne = t0 - dureeMax;
  while (a < b) { const m = (a + b) >> 1; if (barres[m].debut < borne) a = m + 1; else b = m; }
  const r = [];
  for (let i = a; i < barres.length && barres[i].debut < t1; i++) if (barres[i].fin > t0) r.push(barres[i]);
  return r;
}
