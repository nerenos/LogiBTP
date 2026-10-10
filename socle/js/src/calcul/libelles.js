import { Dec, formatNombre } from './decimal.js';
import { ErreurCalcul } from './expression.js';

const RE_VARIABLES = /\{\{(.*?)\}\}/g;

export function echapperHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Mise en forme d'une valeur pour un libellé (identique à Libelles.FormaterValeur côté C#).
 * `type` : 'decimale' ou 'date' quand la valeur est transportée en chaîne (colonnes NUMERIC, DATE).
 */
export function formaterValeur(valeur, type = null) {
  if (valeur === null || valeur === undefined) return '';
  if (valeur instanceof Dec) return formatNombre(valeur);
  if (typeof valeur === 'boolean') return valeur ? 'Oui' : 'Non';
  if (typeof valeur === 'number') return formatNombre(valeur);
  if (typeof valeur === 'string') {
    if (type === 'decimale') return formatNombre(valeur);
    if (type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(valeur)) {
      return `${valeur.slice(8, 10)}/${valeur.slice(5, 7)}/${valeur.slice(0, 4)}`;
    }
    return valeur;
  }
  return JSON.stringify(valeur);
}

/**
 * Remplace les variables {{...}} d'un libellé HTML par leur dernière valeur calculée.
 * `resoudre(reference)` renvoie { valeur, type } ; une référence non résolue est laissée telle quelle.
 */
export function remplacerVariables(html, resoudre) {
  const inconnues = [];
  if (html === null || html === undefined) return { texte: null, inconnues };
  const texte = html.replace(RE_VARIABLES, (tout, ref) => {
    try {
      const r = resoudre(ref.trim());
      return echapperHtml(formaterValeur(r.valeur, r.type));
    } catch (e) {
      if (!(e instanceof ErreurCalcul)) throw e;
      inconnues.push({ reference: ref.trim(), message: e.message });
      return tout;
    }
  });
  return { texte, inconnues };
}

/** Libellé sans balises HTML (recherche, exports, comptabilité). */
export function texteBrut(html) {
  if (html === null || html === undefined) return null;
  let s = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|td)>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return s.replace(/\s+/g, ' ').trim();
}
