// Unités du moteur d'édition : positions et dimensions en millimètres, tailles de police en points.
// Calculs de mise en page en nombres flottants (jamais de montant ici) : les coordonnées sont arrondies au
// centième de millimètre pour que le navigateur et Jint produisent exactement le même arbre de pages.

export const PT_MM = 25.4 / 72;
export const MM_PT = 72 / 25.4;

/** Points → millimètres. */
export const ptVersMm = (pt) => pt * PT_MM;
/** Millimètres → points (PDF). */
export const mmVersPt = (mm) => mm * MM_PT;

/** Arrondi au centième de millimètre (comparaison des arbres de pages). */
export const r2 = (v) => Math.round(v * 100) / 100;

/** Formats de papier en millimètres (portrait). */
export const FORMATS = Object.freeze({
  A3: { largeur: 297, hauteur: 420 },
  A4: { largeur: 210, hauteur: 297 },
  A5: { largeur: 148, hauteur: 210 },
  A6: { largeur: 105, hauteur: 148 },
});

/** Dimensions d'une page : format nommé ou personnalisé ({ largeur, hauteur }), orientation portrait / paysage. */
export function dimensionsPage({ format = 'A4', orientation = 'portrait', largeur, hauteur } = {}) {
  const f = FORMATS[format] ?? (largeur && hauteur ? { largeur, hauteur } : FORMATS.A4);
  const paysage = orientation === 'paysage';
  return paysage ? { largeur: f.hauteur, hauteur: f.largeur } : { largeur: f.largeur, hauteur: f.hauteur };
}

/**
 * Longueur exprimée « 30% », « 40mm », « 40 » (mm) ou « * » (reste) : { mode: 'pct'|'mm'|'reste', valeur }.
 * Utilisée pour les colonnes des rangées et des tableaux.
 */
export function lireLongueur(v) {
  if (v === undefined || v === null || v === '' || v === '*') return { mode: 'reste', valeur: 1 };
  if (typeof v === 'number') return { mode: 'mm', valeur: v };
  const s = String(v).trim();
  const m = /^(\d+(?:[.,]\d+)?)\s*(%|mm|\*)?$/.exec(s);
  if (!m) return { mode: 'reste', valeur: 1 };
  const n = Number(m[1].replace(',', '.'));
  if (m[2] === '%') return { mode: 'pct', valeur: n };
  if (m[2] === '*') return { mode: 'reste', valeur: n || 1 };
  return { mode: 'mm', valeur: n };
}

/**
 * Répartit une largeur entre des colonnes (pct, mm, reste proportionnel). Les colonnes « extensibles » d'un format
 * flexible sont celles en reste : elles absorbent la largeur gagnée en passant de l'A4 à l'A3.
 */
export function repartirLargeurs(longueurs, largeur, espacement = 0) {
  const utile = Math.max(0, largeur - espacement * Math.max(0, longueurs.length - 1));
  let fixes = longueurs.map((l) => (l.mode === 'mm' ? l.valeur : l.mode === 'pct' ? (utile * l.valeur) / 100 : 0));
  let pris = fixes.reduce((a, b) => a + b, 0);
  const poids = longueurs.reduce((a, l) => a + (l.mode === 'reste' ? l.valeur : 0), 0);
  // Colonnes fixes trop larges (liste à beaucoup de colonnes) : réduites à proportion pour laisser au moins 15 mm à
  // chaque colonne « reste » (sans réduction si tout tient).
  const nbReste = longueurs.filter((l) => l.mode === 'reste').length;
  const besoin = Math.min(utile * 0.6, nbReste * 15);
  if (pris > 0 && pris > utile - besoin) {
    const f = Math.max(0, utile - besoin) / pris;
    fixes = fixes.map((x) => x * f);
    pris = fixes.reduce((a, b) => a + b, 0);
  }
  const reste = Math.max(0, utile - pris);
  return longueurs.map((l, i) => (l.mode === 'reste' ? (poids ? (reste * l.valeur) / poids : 0) : fixes[i]));
}
