// Formules des champs d'édition (Q8) : texte brut, gabarit à variables « Devis n° {{entete.ent_numero}} » ou
// expression complète « =Si(document.ent_verrouille; "Original"; "Provisoire") ».
// Valeurs : décimal (Dec, jamais Number), chaîne, booléen, null, liste (collection), objet, texte riche
// ({ riche: [{ texte, style }] }, produit par Gras, Taille, Style…) ou valeur spéciale (Retrait).
// Analyseur sans eval ; noms de fonctions sans accents ni casse ; arguments séparés par « ; » (virgule décimale).
import { texte } from '@logibtp/socle/dictionnaire';
import { Dec, D, formatNombre, sansAccent } from '@logibtp/socle';
import { montantEnLettres, entierEnLettres } from './lettres.js';

export class ErreurFormule extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Normalisation par la table explicite du socle (Jint : pas de garantie sur normalize).
const normaliser = (s) => sansAccent(String(s));

// ---------------------------------------------------------------------------------------------------------------
// Lexeur
function lexer(src) {
  const res = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(?:[.,][0-9]+)?/.exec(s.slice(i));
      res.push({ t: 'nombre', v: m[0].replace(',', '.') });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === '«') {
      const fermant = c === '"' ? '"' : '»';
      let j = i + 1; let v = '';
      for (;;) {
        if (j >= s.length) throw new ErreurFormule('SYNTAXE', texte('edition.formules.chaine'));
        if (s[j] === fermant) {
          if (fermant === '"' && s[j + 1] === '"') { v += '"'; j += 2; continue; }
          break;
        }
        v += s[j++];
      }
      res.push({ t: 'chaine', v: fermant === '»' ? v.trim() : v });
      i = j + 1;
      continue;
    }
    const deux = s.slice(i, i + 2);
    if (['<=', '>=', '<>', '!='].includes(deux)) { res.push({ t: 'op', v: deux === '!=' ? '<>' : deux }); i += 2; continue; }
    if ('+-*/&=<>();[].×÷−'.includes(c)) {
      const v = { '×': '*', '÷': '/', '−': '-' }[c] ?? c;
      res.push({ t: 'op', v });
      i++;
      continue;
    }
    if (c === '{' && s[i + 1] === '{') {
      // {{chemin}} dans une expression : référence.
      const f = s.indexOf('}}', i + 2);
      if (f < 0) throw new ErreurFormule('SYNTAXE', texte('edition.formules.reference'));
      res.push({ t: 'ref', v: s.slice(i + 2, f).trim() });
      i = f + 2;
      continue;
    }
    const m = /^[A-Za-z_$@À-ÿ][A-Za-z0-9_$@À-ÿ]*/.exec(s.slice(i));
    if (m) { res.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    throw new ErreurFormule('SYNTAXE', texte('edition.formules.caractere', { caractere: c }));
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------
// Analyseur (descente récursive) → arbre
// expr := ou ; ou := et (OU et)* ; et := non (ET non)* ; non := NON non | comp ; comp := concat (op concat)? ;
// concat := add (& add)* ; add := mul ((+|-) mul)* ; mul := unaire ((*|/) unaire)* ; unaire := - unaire | prim
function analyser(src) {
  const j = lexer(src);
  let p = 0;
  const voir = () => j[p];
  const estOp = (v) => voir()?.t === 'op' && voir().v === v;
  const estMot = (v) => voir()?.t === 'id' && normaliser(voir().v) === v;
  const attendre = (v) => { if (!estOp(v)) throw new ErreurFormule('SYNTAXE', texte('edition.formules.attendu', { attendu: v })); p++; };

  const ou = () => { let g = et(); while (estMot('ou')) { p++; g = { k: 'ou', g, d: et() }; } return g; };
  const et = () => { let g = non(); while (estMot('et')) { p++; g = { k: 'et', g, d: non() }; } return g; };
  const non = () => { if (estMot('non')) { p++; return { k: 'non', e: non() }; } return comp(); };
  const comp = () => {
    const g = concat();
    const t = voir();
    if (t?.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) { p++; return { k: 'comp', op: t.v, g, d: concat() }; }
    return g;
  };
  const concat = () => { let g = add(); while (estOp('&')) { p++; g = { k: 'concat', g, d: add() }; } return g; };
  const add = () => {
    let g = mul();
    while (estOp('+') || estOp('-')) { const op = voir().v; p++; g = { k: 'arith', op, g, d: mul() }; }
    return g;
  };
  const mul = () => {
    let g = unaire();
    while (estOp('*') || estOp('/')) { const op = voir().v; p++; g = { k: 'arith', op, g, d: unaire() }; }
    return g;
  };
  const unaire = () => { if (estOp('-')) { p++; return { k: 'neg', e: unaire() }; } if (estOp('+')) { p++; return unaire(); } return prim(); };
  const prim = () => {
    const t = voir();
    if (!t) throw new ErreurFormule('SYNTAXE', texte('edition.formules.incomplete'));
    if (t.t === 'nombre') { p++; return { k: 'val', v: new Dec(t.v) }; }
    if (t.t === 'chaine') { p++; return { k: 'val', v: t.v }; }
    if (t.t === 'ref') { p++; return { k: 'ref', chemin: t.v }; }
    if (t.t === 'op' && t.v === '(') { p++; const e = ou(); attendre(')'); return e; }
    if (t.t === 'id') {
      p++;
      const n = normaliser(t.v);
      if (n === 'vrai') return { k: 'val', v: true };
      if (n === 'faux') return { k: 'val', v: false };
      if (n === 'nul' || n === 'vide') return { k: 'val', v: null };
      if (estOp('(')) {
        p++;
        const args = [];
        if (!estOp(')')) {
          args.push(ou());
          while (estOp(';')) { p++; args.push(ou()); }
        }
        attendre(')');
        return { k: 'appel', nom: n, brut: t.v, args };
      }
      // Chemin : a.b.c, a[0].b
      let chemin = t.v;
      for (;;) {
        if (estOp('.') && j[p + 1]?.t === 'id') { chemin += '.' + j[p + 1].v; p += 2; continue; }
        if (estOp('[') && j[p + 1]?.t === 'nombre' && j[p + 2]?.v === ']') { chemin += `[${j[p + 1].v}]`; p += 3; continue; }
        break;
      }
      return { k: 'ref', chemin };
    }
    throw new ErreurFormule('SYNTAXE', texte('edition.formules.inattendu', { jeton: t.v }));
  };
  const arbre = ou();
  if (p < j.length) throw new ErreurFormule('SYNTAXE', texte('edition.formules.inattendu', { jeton: voir().v }));
  return arbre;
}

// ---------------------------------------------------------------------------------------------------------------
// Valeurs

export const estDec = (v) => v instanceof Dec;
export const estRiche = (v) => v !== null && typeof v === 'object' && Array.isArray(v.riche);
export const estRetrait = (v) => v !== null && typeof v === 'object' && v.retrait !== undefined;

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Nombre au format français : séparateur de milliers (espace fine insécable), décimales fixes. */
export function formaterNombre(v, decimales = 2, milliers = true) {
  const d = D(v);
  if (d === null) return '';
  const s = d.toDecimalPlaces(decimales, Dec.ROUND_HALF_UP).toFixed(decimales);
  const negatif = s.startsWith('-') && !/^-0(?:\.0*)?$/.test(s);
  const [ent, dec] = s.replace('-', '').split('.');
  const groupes = milliers ? ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : ent;
  return (negatif ? '-' : '') + groupes + (dec ? ',' + dec : '');
}

/**
 * Nombre sous sa forme la plus simple : au plus `max` décimales (arrondi commercial), zéros inutiles retirés,
 * séparateur de milliers : 30,00 → « 30 », 85,26 → « 85,26 », 85,5 → « 85,5 », 12,3456 → « 12,35 ».
 */
export function formaterSimple(v, max = 2) {
  const d = D(v);
  if (d === null) return '';
  const s = formaterNombre(d, max);
  return s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s;
}

/** Date ISO (AAAA-MM-JJ…) → « JJ/MM/AAAA » ou format « long » (18 octobre 2026). */
export function formaterDate(v, format = 'court') {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v));
  if (!m) return String(v);
  const [, a, mo, j, h, mi] = m;
  if (format === 'long') return `${Number(j)} ${MOIS[Number(mo) - 1]} ${a}`;
  if (format === 'mois') return `${MOIS[Number(mo) - 1]} ${a}`;
  if (format === 'heure' && h) return `${j}/${mo}/${a} ${h}:${mi}`;
  return `${j}/${mo}/${a}`;
}

/** Date ISO + n jours (calendrier UTC, sans heure). */
function ajouterJours(v, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Texte affiché d'une valeur (décimal : format des libellés, booléen : Oui / Non). */
export function enTexte(v) {
  if (v === null || v === undefined) return '';
  if (estDec(v)) return formatNombre(v);
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (typeof v === 'number') return formatNombre(new Dec(v));
  if (estRiche(v)) return v.riche.map((s) => s.texte).join('');
  if (estRetrait(v)) return enTexte(v.libelle) + enTexte(v.texte);
  if (Array.isArray(v)) return v.map(enTexte).filter((x) => x).join(', ');
  if (typeof v === 'object') return '';
  return String(v);
}

/** Segments stylés d'une valeur (texte riche conservé, le reste dans le style de base). */
export function enSegments(v, style = {}) {
  if (estRiche(v)) return v.riche.map((s) => ({ texte: s.texte, style: { ...style, ...s.style } }));
  if (estRetrait(v)) return [...enSegments(v.libelle, style), ...enSegments(v.texte, style)];
  const t = enTexte(v);
  return t === '' ? [] : [{ texte: t, style }];
}

const estVide = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
  || (estRiche(v) && v.riche.every((s) => !s.texte));

const versDec = (v, nom = 'valeur') => {
  if (estDec(v)) return v;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Dec(v);
  if (typeof v === 'boolean') return new Dec(v ? 1 : 0);
  const s = String(v).replace(/[\s  ]/g, '').replace(',', '.');
  if (/^-?\d+(\.\d+)?$/.test(s)) return new Dec(s);
  throw new ErreurFormule('TYPE', texte('edition.formules.nombre_attendu', { nom, valeur: enTexte(v) }));
};

const versBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined || v === '') return false;
  if (estDec(v)) return !v.isZero();
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  const s = normaliser(String(v));
  return !(s === 'faux' || s === 'non' || s === 'false' || s === '0' || s === 'n');
};

function comparer(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) {
    const va = estVide(a); const vb = estVide(b);
    return va && vb ? 0 : va ? -1 : vb ? 1 : 0;
  }
  if (estDec(a) || estDec(b) || typeof a === 'number' || typeof b === 'number') {
    try { return versDec(a).comparedTo(versDec(b)); } catch { /* comparaison textuelle */ }
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(versBool(a)) - Number(versBool(b));
  const x = normaliser(enTexte(a)); const y = normaliser(enTexte(b));
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Lecture d'un chemin « a.b[0].c » dans un objet. */
export function lireChemin(objet, chemin) {
  let v = objet;
  for (const part of String(chemin).split(/\.|(?=\[)/)) {
    if (v === null || v === undefined) return null;
    const idx = /^\[(\d+)\]$/.exec(part);
    if (idx) { v = Array.isArray(v) ? v[Number(idx[1])] : null; continue; }
    if (!part) continue;
    v = v[part];
  }
  return v === undefined ? null : v;
}

// ---------------------------------------------------------------------------------------------------------------
// Fonctions : nom normalisé → { min, max, appliquer(args évalués, ctx) }. `paresseux` : arguments non évalués.

const riche = (v, style) => ({ riche: enSegments(v).map((s) => ({ texte: s.texte, style: { ...s.style, ...style } })) });

export const FONCTIONS = {
  si: { min: 2, max: 3, paresseux: true, appliquer: (a, ctx, ev) => (versBool(ev(a[0])) ? ev(a[1]) : a[2] ? ev(a[2]) : null) },
  estvide: { min: 1, max: 1, appliquer: ([v]) => estVide(v) },
  premiernonvide: { min: 1, max: 20, appliquer: (a) => a.find((v) => !estVide(v)) ?? null },
  concat: { min: 1, max: 50, appliquer: (a) => (a.some(estRiche) ? { riche: a.flatMap((v) => enSegments(v)) } : a.map(enTexte).join('')) },
  // Joindre(séparateur; valeurs…) : les listes sont mises à plat (lignes d'une adresse…), les vides retirés.
  joindre: { min: 2, max: 50, appliquer: ([sep, ...a]) => a.flatMap((v) => (Array.isArray(v) ? v : [v])).map(enTexte).filter((x) => x).join(enTexte(sep).replace(/\\n/g, '\n')) },
  majuscule: { min: 1, max: 1, appliquer: ([v]) => enTexte(v).toUpperCase() },
  minuscule: { min: 1, max: 1, appliquer: ([v]) => enTexte(v).toLowerCase() },
  gauche: { min: 2, max: 2, appliquer: ([v, n]) => [...enTexte(v)].slice(0, Number(versDec(n))).join('') },
  droite: { min: 2, max: 2, appliquer: ([v, n]) => { const c = [...enTexte(v)]; return c.slice(Math.max(0, c.length - Number(versDec(n)))).join(''); } },
  longueur: { min: 1, max: 1, appliquer: ([v]) => new Dec([...enTexte(v)].length) },
  remplacer: { min: 3, max: 3, appliquer: ([v, a, b]) => enTexte(v).split(enTexte(a)).join(enTexte(b)) },
  texte: { min: 1, max: 1, appliquer: ([v]) => enTexte(v) },
  nombre: { min: 1, max: 3, appliquer: ([v, dec, milliers]) => formaterNombre(versDec(v), dec === undefined ? 2 : Number(versDec(dec)), milliers === undefined ? true : versBool(milliers)) },
  montant: { min: 1, max: 2, appliquer: ([v, dec]) => (versDec(v) === null ? '' : formaterNombre(versDec(v), dec === undefined ? 2 : Number(versDec(dec)))) },
  monnaie: { min: 1, max: 2, appliquer: ([v, sym]) => (versDec(v) === null ? '' : `${formaterNombre(versDec(v), 2)} ${sym === undefined ? '€' : enTexte(sym)}`) },
  // Pourcentage sous sa forme la plus simple (au plus deux décimales par défaut) : 30 %, 85,26 %.
  pourcent: { min: 1, max: 2, appliquer: ([v, dec]) => (versDec(v) === null ? '' : `${formaterSimple(versDec(v), dec === undefined ? 2 : Number(versDec(dec)))} %`) },
  simple: { min: 1, max: 2, appliquer: ([v, dec]) => (versDec(v) === null ? '' : formaterSimple(versDec(v), dec === undefined ? 2 : Number(versDec(dec)))) },
  date: { min: 1, max: 2, appliquer: ([v, f]) => formaterDate(v, f === undefined ? 'court' : normaliser(enTexte(f))) },
  arrondi: { min: 1, max: 2, appliquer: ([v, n]) => versDec(v)?.toDecimalPlaces(n === undefined ? 0 : Number(versDec(n)), Dec.ROUND_HALF_UP) ?? null },
  abs: { min: 1, max: 1, appliquer: ([v]) => versDec(v)?.abs() ?? null },
  min: { min: 1, max: 50, appliquer: (a) => agreger(a, 'min') },
  max: { min: 1, max: 50, appliquer: (a) => agreger(a, 'max') },
  somme: { min: 1, max: 2, appliquer: ([c, champ], ctx) => collection(c, champ, ctx).reduce((s, v) => (v === null ? s : s.plus(v)), new Dec(0)) },
  compte: { min: 1, max: 2, appliquer: ([c, champ], ctx) => new Dec(champ === undefined ? (Array.isArray(c) ? c.length : 0) : collection(c, champ, ctx).filter((v) => v !== null).length) },
  moyenne: { min: 1, max: 2, appliquer: ([c, champ], ctx) => { const l = collection(c, champ, ctx).filter((v) => v !== null); return l.length ? l.reduce((s, v) => s.plus(v), new Dec(0)).div(l.length) : null; } },
  page: { min: 0, max: 0, appliquer: (a, ctx) => (ctx.page ? new Dec(ctx.page.numero) : null) },
  nbpages: { min: 0, max: 0, appliquer: (a, ctx) => (ctx.page ? new Dec(ctx.page.total) : null) },
  aujourdhui: { min: 0, max: 0, appliquer: (a, ctx) => ctx.aujourdhui ?? null },
  parametre: { min: 1, max: 1, appliquer: ([n], ctx) => ctx.parametres?.[enTexte(n)] ?? null },
  // Mise en forme dans la formule (Q9) : texte riche.
  gras: { min: 1, max: 1, appliquer: ([v]) => riche(v, { graisse: 700 }) },
  italique: { min: 1, max: 1, appliquer: ([v]) => riche(v, { italique: true }) },
  souligne: { min: 1, max: 1, appliquer: ([v]) => riche(v, { souligne: true }) },
  barre: { min: 1, max: 1, appliquer: ([v]) => riche(v, { barre: true }) },
  taille: { min: 2, max: 2, appliquer: ([t, v]) => riche(v, { taille: Number(versDec(t)) }) },
  couleur: { min: 2, max: 2, appliquer: ([c, v], ctx) => riche(v, { couleur: ctx.couleur ? ctx.couleur(enTexte(c)) : enTexte(c) }) },
  style: { min: 2, max: 2, appliquer: ([n, v], ctx) => riche(v, ctx.style ? ctx.style(enTexte(n)) : {}) },
  retrait: { min: 2, max: 2, appliquer: ([libelle, texte]) => ({ retrait: true, libelle, texte }) },
  ligne: { min: 0, max: 0, appliquer: () => '\n' },
  enlettres: { min: 1, max: 3, appliquer: ([v, u, s]) => (versDec(v) === null ? '' : montantEnLettres(versDec(v), u === undefined ? 'euro' : enTexte(u), s === undefined ? 'centime' : enTexte(s))) },
  entierenlettres: { min: 1, max: 1, appliquer: ([v]) => (versDec(v) === null ? '' : entierEnLettres(Number(versDec(v).abs().floor().toFixed(0)))) },
  arrondisup: { min: 1, max: 2, appliquer: ([v, n]) => versDec(v)?.toDecimalPlaces(n === undefined ? 0 : Number(versDec(n)), Dec.ROUND_CEIL) ?? null },
  arrondiinf: { min: 1, max: 2, appliquer: ([v, n]) => versDec(v)?.toDecimalPlaces(n === undefined ? 0 : Number(versDec(n)), Dec.ROUND_FLOOR) ?? null },
  contient: { min: 2, max: 2, appliquer: ([v, x]) => normaliser(enTexte(v)).includes(normaliser(enTexte(x))) },
  commencepar: { min: 2, max: 2, appliquer: ([v, x]) => normaliser(enTexte(v)).startsWith(normaliser(enTexte(x))) },
  dans: { min: 2, max: 50, appliquer: ([v, ...l]) => l.some((x) => comparer(v, x) === 0) },
  choix: { min: 2, max: 50, appliquer: ([i, ...l]) => { const n = Number(versDec(i)); return Number.isInteger(n) && n >= 1 && n <= l.length ? l[n - 1] : null; } },
  ajouterjours: { min: 2, max: 2, appliquer: ([d, n]) => ajouterJours(d, Number(versDec(n) ?? 0)) },
  // Codes : valeur spéciale lue par les composants code-barres et QR.
  codebarre39: { min: 1, max: 1, appliquer: ([v], ctx) => ctx.code39 ? ctx.code39(enTexte(v)) : enTexte(v) },
};

function agreger(args, sens) {
  const l = args.flatMap((a) => (Array.isArray(a) ? a : [a])).map((v) => versDec(v)).filter((v) => v !== null);
  if (!l.length) return null;
  return l.reduce((a, b) => (sens === 'min' ? (b.lessThan(a) ? b : a) : (b.greaterThan(a) ? b : a)));
}

function collection(c, champ, ctx) {
  const liste = Array.isArray(c) ? c : [];
  if (champ === undefined) return liste.map((v) => versDec(v));
  const nom = enTexte(champ);
  return liste.map((e) => versDec(lireChemin(e, nom), nom));
}

// ---------------------------------------------------------------------------------------------------------------
// Évaluation

function evaluerArbre(n, ctx) {
  const ev = (x) => evaluerArbre(x, ctx);
  switch (n.k) {
    case 'val': return n.v;
    case 'ref': {
      if (!ctx.resoudre) return null;
      return ctx.resoudre(n.chemin);
    }
    case 'neg': { const v = versDec(ev(n.e)); return v === null ? null : v.neg(); }
    case 'non': return !versBool(ev(n.e));
    case 'et': return versBool(ev(n.g)) && versBool(ev(n.d));
    case 'ou': return versBool(ev(n.g)) || versBool(ev(n.d));
    case 'concat': {
      const g = ev(n.g); const d = ev(n.d);
      if (estRiche(g) || estRiche(d)) return { riche: [...enSegments(g), ...enSegments(d)] };
      return enTexte(g) + enTexte(d);
    }
    case 'comp': {
      const c = comparer(ev(n.g), ev(n.d));
      return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[n.op];
    }
    case 'arith': {
      const g = versDec(ev(n.g)); const d = versDec(ev(n.d));
      if (g === null || d === null) return null;
      if (n.op === '+') return g.plus(d);
      if (n.op === '-') return g.minus(d);
      if (n.op === '*') return g.times(d);
      if (d.isZero()) throw new ErreurFormule('DIVISION_ZERO', texte('edition.formules.division_zero'));
      return g.div(d);
    }
    case 'appel': {
      const f = ctx.fonctions?.[n.nom] ?? FONCTIONS[n.nom];
      if (!f) throw new ErreurFormule('FONCTION_INCONNUE', texte('edition.formules.fonction_inconnue', { nom: n.brut }));
      if (n.args.length < f.min || n.args.length > f.max) throw new ErreurFormule('ARGUMENTS', f.min === f.max ? texte('edition.formules.arguments', { nom: n.brut, nombre: f.min }) : texte('edition.formules.arguments_entre', { nom: n.brut, min: f.min, max: f.max }));
      if (f.paresseux) return f.appliquer(n.args, ctx, ev);
      return f.appliquer(n.args.map(ev), ctx);
    }
    default: throw new ErreurFormule('SYNTAXE', texte('edition.formules.invalide'));
  }
}

// Analyses mises en cache (les mêmes formules sont évaluées pour chaque ligne).
const CACHE = new Map();
function compiler(source) {
  let c = CACHE.get(source);
  if (c) return c;
  const s = String(source ?? '');
  if (s.startsWith('=')) c = { k: 'expr', arbre: analyser(s.slice(1)) };
  else if (s.includes('{{')) {
    const parties = [];
    let i = 0;
    while (i < s.length) {
      const d = s.indexOf('{{', i);
      if (d < 0) { parties.push({ texte: s.slice(i) }); break; }
      if (d > i) parties.push({ texte: s.slice(i, d) });
      const f = s.indexOf('}}', d + 2);
      if (f < 0) throw new ErreurFormule('SYNTAXE', texte('edition.formules.reference'));
      parties.push({ arbre: analyser(s.slice(d + 2, f)) });
      i = f + 2;
    }
    c = { k: 'gabarit', parties };
  } else c = { k: 'texte', texte: s };
  if (CACHE.size > 5000) CACHE.clear();
  CACHE.set(source, c);
  return c;
}

/**
 * Valeur d'une formule de champ. Gabarit : chaîne ou texte riche (si une partie est riche) ; une partie qui est la
 * seule du gabarit garde son type (un « {{lig_montant_ht}} » seul reste un décimal, formaté par le champ).
 * @param ctx { resoudre(chemin), fonctions?, page?, parametres?, aujourdhui?, couleur?, style?, code39? }
 */
export function evaluerFormule(source, ctx = {}) {
  const c = compiler(source);
  if (c.k === 'texte') return c.texte;
  if (c.k === 'expr') return evaluerArbre(c.arbre, ctx);
  if (c.parties.length === 1 && c.parties[0].arbre) return evaluerArbre(c.parties[0].arbre, ctx);
  const valeurs = c.parties.map((p) => (p.arbre ? evaluerArbre(p.arbre, ctx) : p.texte));
  if (valeurs.some((v) => estRiche(v) || estRetrait(v))) return { riche: valeurs.flatMap((v) => enSegments(v)) };
  return valeurs.map(enTexte).join('');
}

/** Contrôle d'une formule (concepteur, import) : null ou { code, message }. */
export function verifierFormule(source) {
  try { compiler(source); return null; } catch (e) { return { code: e.code ?? 'SYNTAXE', message: e.message }; }
}

/** Valeur booléenne d'une condition (absente = vrai). */
export function evaluerCondition(source, ctx) {
  if (source === undefined || source === null || source === '') return true;
  const s = String(source);
  return versBool(evaluerFormule(s.startsWith('=') || s.includes('{{') ? s : '=' + s, ctx));
}

export { versDec, versBool, estVide, normaliser };
