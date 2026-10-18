// Rendu de l'aperçu : une page = un SVG en millimètres (viewBox), texte placé sur sa ligne de base. Le navigateur
// ne recalcule aucun retour à la ligne (chaque morceau est déjà positionné) ; crénage et ligatures désactivés comme
// dans la mesure. Aucune donnée n'est interprétée comme du HTML (texte échappé).
import { rectanglesQr } from './codes.js';
import { PT_MM } from './unites.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => (Math.round(v * 1000) / 1000).toString();

/** Nom de famille CSS des polices de l'édition (déclarées par l'hôte : `policesCss`). */
export const familleCss = (famille) => `LogiBTP Edition ${famille}`;

function trait(t) {
  if (!t) return 'stroke="none"';
  return `stroke="${t.couleur}" stroke-width="${n(t.epaisseur)}"${t.pointille ? ` stroke-dasharray="${n(t.epaisseur * 4)} ${n(t.epaisseur * 3)}"` : ''}`;
}

/**
 * SVG d'une page. `ressources` : code → { url } (data URI ou adresse) pour les images.
 */
export function pageSvg(page, { ressources = {}, classe = 'page-edition' } = {}) {
  const parts = [];
  for (const e of page.elements) {
    if (e.t === 'texte') {
      const s = e.style;
      const rot = e.rotation ? ` transform="rotate(${n(e.rotation)} ${n(e.x)} ${n(e.y)})"` : '';
      parts.push(`<text x="${n(e.x)}" y="${n(e.y)}" font-family="'${esc(familleCss(s.police))}'" font-size="${n(s.taille * PT_MM)}" font-weight="${s.graisse}"${s.italique ? ' font-style="italic"' : ''} fill="${s.couleur ?? '#000'}"${s.tnum ? ' class="tnum"' : ''}${rot}>${esc(e.texte)}</text>`);
    } else if (e.t === 'rect') {
      parts.push(`<rect x="${n(e.x)}" y="${n(e.y)}" width="${n(e.l)}" height="${n(e.h)}" fill="${e.fond ?? 'none'}" ${trait(e.trait)}${e.rayon ? ` rx="${n(e.rayon)}"` : ''}/>`);
    } else if (e.t === 'ligne') {
      parts.push(`<line x1="${n(e.x1)}" y1="${n(e.y1)}" x2="${n(e.x2)}" y2="${n(e.y2)}" ${trait(e.trait)}/>`);
    } else if (e.t === 'image') {
      const r = ressources[e.ressource];
      if (!r?.url) continue;
      // Orientation EXIF des photos : 3 = demi-tour, 6 = quart de tour horaire, 8 = quart de tour antihoraire.
      const o = e.orientation ?? 1;
      if (o === 6 || o === 8 || o === 3) {
        const [tx, ty, rot, w, h] = o === 6 ? [e.x + e.l, e.y, 90, e.h, e.l] : o === 8 ? [e.x, e.y + e.h, -90, e.h, e.l] : [e.x + e.l, e.y + e.h, 180, e.l, e.h];
        parts.push(`<image href="${esc(r.url)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none" style="image-orientation:none" transform="translate(${n(tx)} ${n(ty)}) rotate(${rot})"/>`);
      } else parts.push(`<image href="${esc(r.url)}" x="${n(e.x)}" y="${n(e.y)}" width="${n(e.l)}" height="${n(e.h)}" preserveAspectRatio="none" style="image-orientation:none"/>`);
    } else if (e.t === 'qr') {
      const d = rectanglesQr(e.rangees).map((r) => `M${r.x} ${r.y}h${r.l}v1h-${r.l}z`).join('');
      parts.push(`<path transform="translate(${n(e.x)} ${n(e.y)}) scale(${e.module})" d="${d}" fill="#000"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${classe}" viewBox="0 0 ${n(page.largeur)} ${n(page.hauteur)}" width="${n(page.largeur)}mm" height="${n(page.hauteur)}mm" data-page="${page.numero}">`
    + `<rect x="0" y="0" width="${n(page.largeur)}" height="${n(page.hauteur)}" fill="#ffffff"/>${parts.join('')}</svg>`;
}

/**
 * Feuille de style des polices de l'aperçu : @font-face par face (fichiers statiques de l'édition, mêmes octets que
 * la mesure), mesure stricte (sans crénage, ligatures ni alternatives contextuelles).
 * @param faces [{ famille, graisse, italique, url }]
 */
export function policesCss(faces) {
  const ff = faces.map((f) => `@font-face{font-family:"${familleCss(f.famille)}";src:url("${f.url}") format("truetype");font-weight:${f.graisse};font-style:${f.italique ? 'italic' : 'normal'};font-display:block}`).join('');
  return `${ff}.page-edition text{font-kerning:none;font-variant-ligatures:none;font-feature-settings:"kern" 0,"liga" 0,"calt" 0;white-space:pre}`
    + '.page-edition text.tnum{font-variant-numeric:tabular-nums;font-feature-settings:"kern" 0,"liga" 0,"calt" 0,"tnum" 1}';
}
