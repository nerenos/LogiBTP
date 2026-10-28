// Saisie et affichage des nombres, nettoyage du HTML affiché.

/** « 12,5 » → « 12.5 » ; vide → null ; invalide → undefined. */
export function lireNombre(texte) {
  const t = String(texte ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (t === '') return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? t : undefined;
}

const formateurs = new Map();
export function formatNombre(v, decimales = 2, { vide = '' } = {}) {
  if (v === null || v === undefined || v === '') return vide;
  if (!formateurs.has(decimales)) {
    formateurs.set(decimales, new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }));
  }
  return formateurs.get(decimales).format(Number(v));
}

/** Nombre avec ses décimales significatives (coefficients, quantités saisies). */
export function formatLibre(v, max = 6) {
  if (v === null || v === undefined || v === '') return '';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: max }).format(Number(v));
}

// Une date seule « AAAA-MM-JJ » est un jour civil : lue à minuit local (new Date() la lirait à minuit UTC).
const instant = (v) => (v instanceof Date ? v : new Date(typeof v === 'string' && v.length === 10 ? `${v}T00:00:00` : v));
const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });
const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** « JJ/MM/AAAA » ; vide → `vide`. */
export const formatDate = (v, { vide = '' } = {}) => (v ? FORMAT_DATE.format(instant(v)) : vide);
/** « JJ/MM/AAAA HH:MM » ; vide → `vide`. */
export const formatDateHeure = (v, { vide = '' } = {}) => (v ? FORMAT_DATE_HEURE.format(instant(v)) : vide);
/** « HH:MM » ; vide → `vide`. */
export const formatHeure = (v, { vide = '' } = {}) => (v ? FORMAT_HEURE.format(instant(v)) : vide);

const BALISES = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUB', 'SUP', 'SPAN', 'UL', 'OL', 'LI',
  'H1', 'H2', 'H3', 'H4', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);

// Propriétés de style conservées (mêmes que la liste blanche HtmlSanitizer du serveur).
const STYLES = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-align'];
const VALEUR_STYLE = /^[#(),.%\w\s-]+$/;

function styleSur(el) {
  const res = [];
  for (const p of STYLES) {
    const v = el.style.getPropertyValue(p);
    if (v && VALEUR_STYLE.test(v) && !/url|expression/i.test(v)) res.push(`${p}: ${v}`);
  }
  return res.join('; ');
}

/** Vrai si le libellé contient une mise en forme (balises HTML). */
export const estHtml = (s) => /<[a-z][^>]*>/i.test(s ?? '');

/** Texte brut ↔ HTML pour la saisie en ligne d'un libellé sans mise en forme. */
export function decoderEntites(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s ?? '';
  return t.value;
}

/**
 * Nettoyage du HTML avant affichage (liste blanche de balises et de styles). Le serveur nettoie aussi
 * à l'enregistrement (HtmlSanitizer) ; ceci protège l'affichage d'un contenu collé non encore enregistré.
 */
export function htmlSur(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const nettoyer = (noeud) => {
    for (const enfant of [...noeud.childNodes]) {
      if (enfant.nodeType === Node.ELEMENT_NODE) {
        // Un <div> (retour à la ligne d'une zone éditable, contenu collé) devient un paragraphe :
        // le retirer fusionnerait son texte avec la ligne précédente.
        if (enfant.tagName === 'DIV') {
          const p = doc.createElement('p');
          p.append(...enfant.childNodes);
          enfant.replaceWith(p);
          const style = styleSur(enfant);
          if (style) p.setAttribute('style', style);
          nettoyer(p);
          continue;
        }
        if (!BALISES.has(enfant.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(enfant.tagName)) enfant.remove();
          else { nettoyer(enfant); enfant.replaceWith(...enfant.childNodes); }
          continue;
        }
        const style = styleSur(enfant);
        for (const a of [...enfant.attributes]) enfant.removeAttribute(a.name);
        if (style) enfant.setAttribute('style', style);
        nettoyer(enfant);
      } else if (enfant.nodeType !== Node.TEXT_NODE) enfant.remove();
    }
  };
  const racine = doc.body.firstChild;
  nettoyer(racine);
  return racine.innerHTML;
}

export function echapper(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
