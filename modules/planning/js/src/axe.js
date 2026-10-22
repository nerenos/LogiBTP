// Axe du temps à périodes masquées (sans métier) : heures non travaillées de chaque jour et jours masqués (vendredi,
// samedi, dimanche…) retirés de l'affichage ; instants (minutes) ↔ positions (pixels). Sans masque, l'axe est linéaire.

/**
 * Plages visibles de [debut, fin[ : chaque jour non masqué, réduit à [heures[0], heures[1][ si les heures sont données ;
 * plages contiguës fusionnées. masque : { heures: [debut, fin] (minutes dans le jour) | null, jours: [0 = dimanche … 6] }.
 */
export function plagesVisibles(debut, fin, masque) {
  if (!masque || (!masque.heures && !masque.jours?.length)) return [{ debut, fin }];
  const jours = new Set(masque.jours ?? []);
  const [h0, h1] = masque.heures ?? [0, 1440];
  const r = [];
  for (let j = Math.floor(debut / 1440) * 1440; j < fin; j += 1440) {
    if (jours.has(new Date(j * 60000).getUTCDay())) continue;
    const a = Math.max(debut, j + h0);
    const b = Math.min(fin, j + h1);
    if (a >= b) continue;
    const der = r.at(-1);
    if (der && der.fin === a) der.fin = b;
    else r.push({ debut: a, fin: b });
  }
  return r.length ? r : [{ debut, fin }];
}

/**
 * Axe de [debut, fin[ à `minutesParPixel` : `x(m)` (un instant masqué est placé au début de la plage visible suivante ;
 * hors période, prolongement linéaire), `instant(px)`, `largeur` (pixels), `plages` ({ debut, fin, x }) et `coupures`
 * (positions des périodes masquées).
 */
export function creerAxe(debut, fin, minutesParPixel, masque) {
  const plages = plagesVisibles(debut, fin, masque).map((p) => ({ ...p }));
  let largeur = 0;
  for (const p of plages) { p.x = largeur; largeur += (p.fin - p.debut) / minutesParPixel; }
  /** Dernier indice i tel que cle(plages[i]) <= v (−1 si aucun). */
  const indice = (v, cle) => {
    let a = 0;
    let b = plages.length - 1;
    let r = -1;
    while (a <= b) {
      const m = (a + b) >> 1;
      if (cle(plages[m]) <= v) { r = m; a = m + 1; } else b = m - 1;
    }
    return r;
  };
  return {
    plages,
    largeur,
    coupures: plages.slice(1).map((p) => p.x),
    x(m) {
      if (m < plages[0].debut) return m >= debut ? 0 : (m - debut) / minutesParPixel;
      const i = Math.max(0, indice(m, (p) => p.debut));
      const p = plages[i];
      if (m >= p.fin && i < plages.length - 1) return plages[i + 1].x;
      return p.x + (m - p.debut) / minutesParPixel;
    },
    instant(px) {
      const p = plages[Math.max(0, indice(px, (q) => q.x))];
      return p.debut + (px - p.x) * minutesParPixel;
    },
  };
}
