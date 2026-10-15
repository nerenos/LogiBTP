// Conversion d'un libellé RTF (RichEdit) en HTML simple : paragraphes, retours à la ligne, gras, italique, souligné,
// caractères accentués (\'e9 en Windows-1252, \u339?). Polices, tailles et couleurs sont ignorées : la mise en
// forme du document vient de son modèle d'impression.

const IGNORES = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'datastore', 'latentstyles']);
const ECHAPPER = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const echapper = (t) => t.replace(/[&<>"]/g, (c) => ECHAPPER[c]);

let cp1252 = null;
const decoderOctet = (n) => {
  cp1252 ??= new TextDecoder('windows-1252');
  return cp1252.decode(new Uint8Array([n]));
};

/** Texte brut du RTF (paragraphes séparés par des retours à la ligne). */
export function rtfEnTexte(rtf) {
  return rtfEnHtml(rtf).replace(/<\/p><p>|<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

export const estRtf = (t) => typeof t === 'string' && t.trimStart().startsWith('{\\rtf');

/**
 * HTML du RTF : un seul paragraphe donne un contenu en ligne (« Béton <b>C25</b> »), plusieurs donnent des <p>.
 * Les paragraphes vides de fin sont retirés.
 */
export function rtfEnHtml(rtf) {
  const paragraphes = [];
  let courant = [];
  let etat = { b: false, i: false, ul: false, ignorer: false, uc: 1 };
  const pile = [];
  let aSauter = 0;
  const ajouter = (t) => {
    if (etat.ignorer || !t) return;
    const der = courant[courant.length - 1];
    if (der && der.b === etat.b && der.i === etat.i && der.ul === etat.ul && !der.br) der.t += t;
    else courant.push({ t, b: etat.b, i: etat.i, ul: etat.ul });
  };
  const finParagraphe = () => { paragraphes.push(courant); courant = []; };
  let i = 0;
  const n = rtf.length;
  let premierMot = false;
  while (i < n) {
    const c = rtf[i];
    if (c === '{') { pile.push({ ...etat }); premierMot = true; i++; continue; }
    if (c === '}') { etat = pile.pop() ?? etat; premierMot = false; i++; continue; }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') {
      if (aSauter > 0) { aSauter--; i++; continue; }
      let j = i;
      while (j < n && !'\\{}\r\n'.includes(rtf[j])) j++;
      let t = rtf.slice(i, j);
      if (aSauter > 0) { const k = Math.min(aSauter, t.length); t = t.slice(k); aSauter -= k; }
      ajouter(t);
      premierMot = false;
      i = j;
      continue;
    }
    // Séquence de contrôle.
    const s = rtf[i + 1];
    if (s === '\\' || s === '{' || s === '}') { ajouter(s); i += 2; premierMot = false; continue; }
    if (s === '~') { ajouter('\u00a0'); i += 2; continue; }
    if (s === '-' || s === '_') { i += 2; continue; }
    if (s === '*') { if (premierMot) etat.ignorer = true; i += 2; continue; }
    if (s === "'") {
      const code = parseInt(rtf.slice(i + 2, i + 4), 16);
      if (aSauter > 0) aSauter--;
      else ajouter(decoderOctet(code));
      i += 4;
      premierMot = false;
      continue;
    }
    const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40));
    if (!m) { i++; continue; }
    i += m[0].length;
    const mot = m[1];
    const param = m[2] === undefined ? null : Number(m[2]);
    if (premierMot && IGNORES.has(mot)) etat.ignorer = true;
    premierMot = false;
    switch (mot) {
      case 'par': finParagraphe(); break;
      case 'line': if (!etat.ignorer) courant.push({ t: '', br: true }); break;
      case 'tab': ajouter(' '); break;
      case 'b': etat.b = param !== 0; break;
      case 'i': etat.i = param !== 0; break;
      case 'ul': etat.ul = param !== 0; break;
      case 'ulnone': etat.ul = false; break;
      case 'plain': Object.assign(etat, { b: false, i: false, ul: false }); break;
      case 'uc': etat.uc = param ?? 1; break;
      case 'u': ajouter(String.fromCharCode(param < 0 ? param + 65536 : param)); aSauter = etat.uc; break;
      case 'emdash': ajouter('—'); break;
      case 'endash': ajouter('–'); break;
      case 'bullet': ajouter('•'); break;
      case 'lquote': ajouter('‘'); break;
      case 'rquote': ajouter('’'); break;
      case 'ldblquote': ajouter('“'); break;
      case 'rdblquote': ajouter('”'); break;
      default: break;
    }
  }
  if (courant.length) finParagraphe();
  const html = paragraphes.map((p) => p.map((r) => {
    if (r.br) return '<br>';
    let h = echapper(r.t);
    if (r.ul) h = `<u>${h}</u>`;
    if (r.i) h = `<i>${h}</i>`;
    if (r.b) h = `<b>${h}</b>`;
    return h;
  }).join('').replace(/^(<br>)+|(<br>)+$/g, ''));
  while (html.length && !html[html.length - 1].replace(/<[^>]+>/g, '').trim()) html.pop();
  if (html.length <= 1) return (html[0] ?? '').trim();
  return html.map((p) => `<p>${p}</p>`).join('');
}
