// Largeur des colonnes : fixe (px), proportionnelle (poids) ou automatique (poids 1), bornées par min / max.
// Les colonnes fixes sont servies d'abord ; l'espace restant est réparti au prorata des poids, en
// figeant à leur borne les colonnes qui la dépassent (répartition itérative).

const MIN_DEFAUT = 48;

export function calculerLargeurs(colonnes, disponible) {
  const res = new Array(colonnes.length).fill(0);
  let reste = disponible;
  const souples = [];
  colonnes.forEach((c, i) => {
    const l = c.largeur ?? {};
    const min = Number(l.min) || MIN_DEFAUT;
    const max = Number(l.max) || Infinity;
    if (l.mode === 'fixe' && Number(l.valeur) > 0) {
      res[i] = Math.min(Math.max(Number(l.valeur), min), max);
      reste -= res[i];
    } else {
      souples.push({ i, poids: l.mode === 'proportionnel' && Number(l.valeur) > 0 ? Number(l.valeur) : 1, min, max });
    }
  });
  let libres = souples;
  for (let tour = 0; tour < 10 && libres.length; tour++) {
    const poids = libres.reduce((s, x) => s + x.poids, 0);
    const figees = [];
    for (const x of libres) {
      const l = (Math.max(reste, 0) * x.poids) / poids;
      if (l < x.min) figees.push([x, x.min]);
      else if (l > x.max) figees.push([x, x.max]);
    }
    if (!figees.length) {
      for (const x of libres) res[x.i] = (Math.max(reste, 0) * x.poids) / poids;
      break;
    }
    for (const [x, l] of figees) { res[x.i] = l; reste -= l; }
    libres = libres.filter((x) => !figees.some(([f]) => f === x));
  }
  return res.map((l) => Math.floor(l));
}
