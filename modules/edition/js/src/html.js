// Libellés HTML (liste blanche de htmlSur du socle) lus sans DOM : blocs de paragraphes stylés, listes, titres et
// tableaux simples (Q19 : pas de fusion de cellules ni de tableau imbriqué). Le HTML des données est déjà nettoyé
// à l'enregistrement ; toute balise inconnue est ignorée (son texte est gardé), jamais interprétée.

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', laquo: '«', raquo: '»',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—', deg: '°', sup2: '²', sup3: '³',
  times: '×', divide: '÷', middot: '·', bull: '•', copy: '©', reg: '®', eacute: 'é', egrave: 'è', ecirc: 'ê',
  agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë',
  Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç', oelig: 'œ', OElig: 'Œ', thinsp: ' ', shy: '' };

export function decoderEntites(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
    }
    return ENTITES[e] ?? m;
  });
}

/** Le texte contient-il des balises ? */
export const estHtml = (s) => /<\/?[a-z][\s\S]*?>/i.test(String(s ?? ''));

// Lecture des balises : { type: 'ouvrante'|'fermante'|'texte', nom, style }.
function lexer(html) {
  const res = [];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[3] !== undefined || m[0] === '<') { res.push({ type: 'texte', texte: decoderEntites(m[3] ?? '<') }); continue; }
    const nom = m[1].toUpperCase();
    if (m[0][1] === '/') { res.push({ type: 'fermante', nom }); continue; }
    const attrs = m[2] ?? '';
    const style = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    res.push({ type: 'ouvrante', nom, style: style ? decoderEntites(style[2] ?? style[3]) : '', auto: /\/\s*$/.test(attrs) || nom === 'BR' });
  }
  return res;
}

const COULEURS_NOMMEES = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080', orange: '#ffa500' };

function couleur(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map((c) => c + c).join('');
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (rgb) return '#' + rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  return COULEURS_NOMMEES[s] ?? null;
}

/** Propriétés de style CSS conservées (mêmes que la liste blanche du socle) → surcharge de style de texte. */
function lireStyle(css) {
  const res = {};
  let alignement = null;
  for (const decl of String(css ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const p = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).trim().toLowerCase();
    if (p === 'color') { const c = couleur(v); if (c) res.couleur = c; }
    else if (p === 'background-color') { const c = couleur(v); if (c) res.fond = c; }
    else if (p === 'font-weight') res.graisse = v === 'bold' || v === 'bolder' ? 700 : Number(v) || 400;
    else if (p === 'font-style') res.italique = v === 'italic' || v === 'oblique';
    else if (p === 'text-decoration' || p === 'text-decoration-line') { if (v.includes('underline')) res.souligne = true; if (v.includes('line-through')) res.barre = true; }
    else if (p === 'text-align') alignement = { left: 'gauche', center: 'centre', right: 'droite', justify: 'justifie' }[v] ?? null;
  }
  return { style: res, alignement };
}

const STYLES_BALISES = {
  B: { graisse: 700 }, STRONG: { graisse: 700 }, I: { italique: true }, EM: { italique: true },
  U: { souligne: true }, S: { barre: true }, SUB: { exposant: 'bas' }, SUP: { exposant: 'haut' },
};
const TITRES = { H1: 1.6, H2: 1.4, H3: 1.2, H4: 1.1 };
const BLOCS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4']);

/**
 * Blocs d'un libellé HTML.
 * @returns [{ type: 'paragraphe', segments: [{ texte, style }], alignement, puce, niveau, echelle }
 *          | { type: 'tableau', rangees: [{ entete, cellules: [[segments]] }] }]
 * Les styles des segments sont des surcharges relatives (graisse, italique…) ; `echelle` multiplie la taille.
 */
export function lireHtml(html) {
  const blocs = [];
  const pile = [{ nom: '#', style: {} }];
  const listes = [];
  let para = null;
  let tableau = null;
  let rangee = null;
  let cellule = null;
  const styleCourant = () => Object.assign({}, ...pile.map((p) => p.style));
  const nouveauPara = (opts = {}) => {
    para = { type: 'paragraphe', segments: [], alignement: opts.alignement ?? null, puce: opts.puce ?? null, niveau: listes.length, echelle: opts.echelle ?? 1 };
    if (cellule) cellule.paragraphes.push(para); else blocs.push(para);
  };
  const fermerPara = () => { para = null; };

  for (const j of lexer(String(html ?? ''))) {
    if (j.type === 'texte') {
      if (!j.texte) continue;
      if (tableau && !cellule) continue; // texte hors cellule (espaces de mise en forme)
      if (!para) {
        if (!j.texte.trim()) continue;
        nouveauPara();
      }
      para.segments.push({ texte: j.texte.replace(/[\r\n\t]+/g, ' '), style: styleCourant() });
      continue;
    }
    const n = j.nom;
    if (j.type === 'ouvrante') {
      if (n === 'BR') { if (!para) nouveauPara(); para.segments.push({ texte: '\n', style: styleCourant() }); continue; }
      const { style: css, alignement } = lireStyle(j.style);
      if (n === 'TABLE') {
        if (cellule) continue; // tableau imbriqué : son texte reste dans la cellule
        fermerPara();
        tableau = { type: 'tableau', rangees: [] };
        blocs.push(tableau);
        continue;
      }
      if (tableau) {
        if (n === 'TR') { rangee = { entete: false, cellules: [] }; tableau.rangees.push(rangee); continue; }
        if (n === 'TD' || n === 'TH') {
          if (!rangee) { rangee = { entete: false, cellules: [] }; tableau.rangees.push(rangee); }
          cellule = { paragraphes: [], entete: n === 'TH' };
          if (n === 'TH') rangee.entete = true;
          rangee.cellules.push(cellule);
          pile.push({ nom: n, style: { ...(n === 'TH' ? { graisse: 700 } : {}), ...css } });
          fermerPara();
          continue;
        }
        if (n === 'THEAD' || n === 'TBODY') continue;
      }
      if (n === 'UL' || n === 'OL') { fermerPara(); listes.push({ type: n, rang: 0 }); continue; }
      if (BLOCS.has(n)) {
        fermerPara();
        let puce = null;
        if (n === 'LI' && listes.length) {
          const l = listes[listes.length - 1];
          l.rang += 1;
          puce = l.type === 'OL' ? `${l.rang}.` : '•';
        }
        pile.push({ nom: n, style: { ...(TITRES[n] ? { graisse: 700 } : {}), ...css } });
        nouveauPara({ alignement, puce, echelle: TITRES[n] ?? 1 });
        continue;
      }
      if (j.auto) continue;
      pile.push({ nom: n, style: { ...(STYLES_BALISES[n] ?? {}), ...css } });
      continue;
    }
    // Fermante
    if (n === 'TD' || n === 'TH') { popJusqua(pile, n); cellule = null; fermerPara(); continue; }
    if (n === 'TR') { rangee = null; continue; }
    if (n === 'TABLE') { tableau = null; rangee = null; cellule = null; fermerPara(); continue; }
    if (n === 'UL' || n === 'OL') { listes.pop(); fermerPara(); continue; }
    if (BLOCS.has(n)) { popJusqua(pile, n); fermerPara(); continue; }
    popJusqua(pile, n);
  }
  // Paragraphes vides retirés, sauts de ligne de fin retirés.
  const nettoyer = (p) => {
    while (p.segments.length && p.segments[p.segments.length - 1].texte === '\n') p.segments.pop();
    return p.segments.some((s) => s.texte.trim());
  };
  const res = [];
  for (const b of blocs) {
    if (b.type === 'paragraphe') { if (nettoyer(b)) res.push(b); continue; }
    for (const r of b.rangees) for (const c of r.cellules) c.paragraphes = c.paragraphes.filter(nettoyer);
    b.rangees = b.rangees.filter((r) => r.cellules.length);
    if (b.rangees.length) res.push(b);
  }
  return res;
}

function popJusqua(pile, nom) {
  for (let i = pile.length - 1; i > 0; i--) {
    if (pile[i].nom === nom) { pile.length = i; return; }
  }
}

/** Texte brut d'un libellé (une ligne par paragraphe). */
export function texteDeHtml(html) {
  return lireHtml(html).map((b) => (b.type === 'paragraphe'
    ? b.segments.map((s) => s.texte).join('')
    : b.rangees.map((r) => r.cellules.map((c) => c.paragraphes.map((p) => p.segments.map((s) => s.texte).join('')).join(' ')).join(' | ')).join('\n'))).join('\n');
}
