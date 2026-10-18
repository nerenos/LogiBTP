// Polices du moteur d'édition : mesure du texte sans DOM, à partir des fichiers de police eux-mêmes (fontkit).
// Règle de mesure (identique au rendu PDF et à l'aperçu) : somme des chasses des glyphes, sans crénage, sans
// ligature ni substitution contextuelle ; seuls les chiffres tabulaires (fonction OpenType tnum) changent de glyphe.
// La même table caractère → glyphe sert au dessin du PDF (pdf-lib), ce qui garantit mesure = dessin.
import fontkit from '@pdf-lib/fontkit';
import { ptVersMm } from './unites.js';

// Caractères dont la variante tabulaire est cherchée (chiffres et ponctuation des nombres).
const CARACTERES_TNUM = '0123456789.,:;-+−%€$ ';

/** Clé d'une face : famille, graisse, italique. */
export const cleFace = (famille, graisse = 400, italique = false) => `${famille}|${graisse}|${italique ? 'i' : 'n'}`;

/**
 * Police fontkit avec une mise en forme rapide (table caractère → glyphe, chasse sans crénage), installée à la place
 * de `layout` : pdf-lib l'appelle pour encoder et mesurer le texte, et la mise en forme OpenType complète est trop
 * lente dans Jint (≈ 100 ms par chaîne).
 */
function preparer(octets) {
  const police = fontkit.create(octets);
  const glyphes = new Map();
  const tnum = new Map();
  const glyphe = (cp) => {
    let g = glyphes.get(cp);
    if (g === undefined) {
      g = police.glyphForCodePoint(cp);
      if (!g || g.id === 0) g = police.glyphForCodePoint(63); // « ? » pour un caractère absent de la police
      // Point de code du glyphe (table ToUnicode du PDF : copier-coller, indexation) : fontkit peut l'avoir créé
      // sans (glyphe obtenu par une substitution), et Jint ne retrouve pas toujours le même que V8.
      if (g.id !== 0 && cp !== 63 && !(g.codePoints ?? []).includes(cp)) g.codePoints = [...(g.codePoints ?? []), cp];
      glyphes.set(cp, g);
    }
    return g;
  };
  // Variantes tabulaires : une seule mise en forme complète par caractère, au chargement.
  for (const c of CARACTERES_TNUM) {
    const cp = c.codePointAt(0);
    const normal = glyphe(cp);
    let g = normal;
    try {
      const r = police.layout(c, { tnum: true });
      if (r.glyphs.length === 1 && r.glyphs[0].id !== 0) g = r.glyphs[0];
    } catch { /* police sans tnum */ }
    if (g.id !== normal.id || g.advanceWidth !== normal.advanceWidth) tnum.set(cp, g);
  }
  const glypheDe = (cp, tabulaire) => (tabulaire && tnum.get(cp)) || glyphe(cp);
  police.layout = (texte, fonctions) => {
    const glyphs = [];
    const positions = [];
    const tabulaire = !!fonctions?.tnum;
    for (const c of texte) {
      const g = glypheDe(c.codePointAt(0), tabulaire);
      glyphs.push(g);
      positions.push({ xAdvance: g.advanceWidth, yAdvance: 0, xOffset: 0, yOffset: 0 });
    }
    return { glyphs, positions };
  };
  return { police, glypheDe };
}

// Polices fontkit partagées par octets (la même police chargée deux fois n'est lue qu'une fois).
const CACHE = new WeakMap();
function charger(octets) {
  let p = CACHE.get(octets);
  if (!p) { p = preparer(octets); CACHE.set(octets, p); }
  return p;
}

/** Remplaçant de fontkit pour pdf-lib : renvoie la police préparée (mise en forme rapide) déjà chargée. */
export const fontkitEdition = { create: (octets) => charger(octets).police };

/**
 * Jeu de polices d'une édition. `ajouter(famille, { graisse, italique }, octets)` ; la mesure choisit la face la plus
 * proche (même italique, graisse la plus proche, sinon la face normale de la famille, sinon la première).
 */
export class Polices {
  constructor() {
    this.faces = new Map();
    this.cache = new Map();
  }

  ajouter(famille, { graisse = 400, italique = false } = {}, octets) {
    const { police, glypheDe } = charger(octets);
    const upem = police.unitsPerEm;
    this.faces.set(cleFace(famille, graisse, italique), {
      famille, graisse, italique, octets, police, glypheDe, upem,
      ascent: police.ascent / upem, descent: -police.descent / upem, lineGap: police.lineGap / upem,
    });
    this.cache.clear();
    return this;
  }

  /** Face la plus proche du style demandé. */
  face({ police: famille, graisse = 400, italique = false } = {}) {
    const cle = cleFace(famille, graisse, italique);
    const exacte = this.faces.get(cle);
    if (exacte) return exacte;
    const candidates = [...this.faces.values()];
    const memeFamille = candidates.filter((f) => f.famille === famille);
    const liste = memeFamille.length ? memeFamille : candidates;
    if (!liste.length) throw new Error('Aucune police chargée');
    const score = (f) => (f.italique === !!italique ? 0 : 1000) + Math.abs(f.graisse - graisse);
    return liste.reduce((a, b) => (score(b) < score(a) ? b : a));
  }

  /** Largeur en millimètres d'un texte dans un style ({ police, taille (pt), graisse, italique, tnum }). */
  largeur(texte, style) {
    if (!texte) return 0;
    const f = this.face(style);
    const cle = `${f.famille}|${f.graisse}|${f.italique}|${style.tnum ? 1 : 0}`;
    let parFace = this.cache.get(cle);
    if (!parFace) { parFace = new Map(); this.cache.set(cle, parFace); }
    let unites = parFace.get(texte);
    if (unites === undefined) {
      unites = 0;
      for (const c of texte) unites += f.glypheDe(c.codePointAt(0), !!style.tnum).advanceWidth;
      if (parFace.size < 20000) parFace.set(texte, unites);
    }
    return ptVersMm((unites / f.upem) * style.taille);
  }

  /** Métriques verticales en millimètres : ascent (au-dessus de la ligne de base), descent, hauteur de ligne. */
  metriques(style) {
    const f = this.face(style);
    const t = ptVersMm(style.taille);
    const interligne = style.interligne ?? 1.2;
    return { ascent: f.ascent * t, descent: f.descent * t, hauteur: t * interligne };
  }

  /** Familles disponibles (charte, contrôle des modèles). */
  familles() {
    return [...new Set([...this.faces.values()].map((f) => f.famille))];
  }
}
