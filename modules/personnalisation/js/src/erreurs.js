// Catalogue des messages d'erreur par code (lot P2, ANALYSE-MODULE-PERSONNALISATION.md § 12) : relève dans les sources
// les erreurs de l'API (C# : ExceptionMetier.Invalide / Conflit, new ExceptionMetier, ErreurListe, ErreurFiche) et des
// moteurs (JS : this.erreur / this.avertir, new ErreurCalcul) avec leur message, et retient les codes dont le message
// est sûr à remplacer par « erreurs.<CODE> » du dictionnaire :
//   - chaque lieu où le code est levé a un message littéral (pas d'interpolation, de concaténation ni de choix) ;
//   - tous ces messages sont identiques (un code levé avec deux messages garde le message du serveur) ;
//   - le code n'apparaît pas ailleurs dans le C# (table de messages de règles, autre aide qui lève une erreur, code
//     choisi par une variable…) : sinon le serveur peut le lever avec un autre message, que le dictionnaire masquerait.
// Fonctions pures (sources en texte) : le cœur sait où sont les fichiers et à quelle couche va chaque code.

const LIT_CS = String.raw`@?"(?:[^"\\]|\\.)*"`;
// Appel C# : 1 = code (littéral ou constante, sinon expression), 2 = message (littéral ou expression), 3 = suite.
const APPEL_CS = new RegExp(
  String.raw`(?:ExceptionMetier\.(?:Invalide|Conflit)\(|new ExceptionMetier\(\s*[^,()]+,|new Erreur(?:Liste|Fiche)\()\s*`
  + String.raw`(${LIT_CS}|[\w.]+|[^,]+?)\s*,\s*(\$?${LIT_CS}|[^,)]+)\s*([,)])`, 'g');
const LITTERAL_CS = new RegExp(`^${LIT_CS}$`);
const APPEL_TOUT_CS = /ExceptionMetier\.(?:Invalide|Conflit)\(|new ExceptionMetier\(|new Erreur(?:Liste|Fiche)\(/g;
// Lieux des moteurs miroirs en C# (Erreur / Avertir, ErreurCalcul) : relevés côté JS, ignorés du contrôle « ailleurs ».
const MIROIR_CS = /\b(?:Erreur|Avertir)\(\s*[^,()]+,\s*"[A-Z][A-Z0-9_]*"|new ErreurCalcul\(\s*"[A-Z][A-Z0-9_]*"/g;
const CONSTANTE_CS = /const\s+string\s+(\w+)\s*=\s*"([^"\\]*)"\s*;/g;
const CODE = /^[A-Z][A-Z0-9_]*$/;

const LIT_JS = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\`(?:[^\`\\$]|\\.|\$(?!\{))*\``;
// Appel JS : 1 = code, 2 = message ; un message suivi d'autre chose qu'une virgule ou une parenthèse n'est pas littéral.
const APPEL_JS = new RegExp(
  String.raw`(?:this\.(?:erreur|avertir)\(\s*[^,()]+(?:\([^()]*\))?\s*,|new ErreurCalcul\()\s*`
  + String.raw`('[A-Z][A-Z0-9_]*'|"[A-Z][A-Z0-9_]*"|[^,]+?)\s*,\s*(${LIT_JS}|[^,)]+)\s*([,)])`, 'g');

const ligne = (source, index) => source.slice(0, index).split('\n').length;

/** Valeur d'un littéral C# ("…", @"…"). */
function litteralCs(t) {
  if (t.startsWith('@')) return t.slice(2, -1).replace(/""/g, '"');
  return JSON.parse(t.replace(/\\'/g, "'"));
}

/** Valeur d'un littéral JS ('…', "…", `…` sans ${}). */
function litteralJs(t) {
  const corps = t.slice(1, -1);
  return corps.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e) => {
    if (e.startsWith('u{')) return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r' }[e] ?? e;
  });
}

/** Constantes chaînes d'une source C# : [{ nom, valeur }]. */
export const constantesCs = (source) => [...source.matchAll(CONSTANTE_CS)].map((m) => ({ nom: m[1], valeur: m[2] }));

/**
 * Lieux d'erreur d'une source C# : [{ code, constante, message, ligne, debut, fin }] ; code null si choisi par une
 * expression (constante : son nom, résolu par le catalogue), message null s'il n'est pas littéral.
 */
export function sitesCs(source) {
  const res = [];
  const lus = new Set();
  for (const m of source.matchAll(APPEL_CS)) {
    lus.add(m.index);
    const brut = m[1].trim();
    const litteral = LITTERAL_CS.test(brut);
    const constante = !litteral && /^[\w.]+$/.test(brut) && !/^\d/.test(brut) ? brut.split('.').pop() : null;
    const code = litteral ? litteralCs(brut) : null;
    const message = LITTERAL_CS.test(m[2].trim()) ? litteralCs(m[2].trim()) : null;
    res.push({ code, constante, message, ligne: ligne(source, m.index), debut: m.index, fin: m.index + m[0].length });
  }
  // Appels que l'expression ne sait pas lire (arguments sur plusieurs lignes complexes) : code et message inconnus.
  for (const m of source.matchAll(APPEL_TOUT_CS)) {
    if (!lus.has(m.index)) res.push({ code: null, constante: null, message: null, ligne: ligne(source, m.index), debut: m.index, fin: m.index + m[0].length });
  }
  return res;
}

/** Lieux d'erreur d'une source JS des moteurs : [{ code, message, ligne }] (code null : expression ; message null : non littéral). */
export function sitesJs(source) {
  return [...source.matchAll(APPEL_JS)].map((m) => {
    const brut = m[1].trim();
    const code = /^['"]/.test(brut) ? brut.slice(1, -1) : null;
    const t = m[2].trim();
    const message = new RegExp(`^(?:${LIT_JS})$`).test(t) ? litteralJs(t) : null;
    return { code, message, ligne: ligne(source, m.index) };
  });
}

/**
 * Catalogue : { retenus: Map<code, { message, chemins }>, ecartes: Map<code, raison> } (codes triés).
 * @param {{ cs: { chemin: string, source: string }[], js: { chemin: string, source: string }[] }} sources
 *   cs : sources C# de l'API (hors projets de tests et hors moteurs miroirs, dont les codes sont relevés côté JS) ;
 *   js : sources JS des moteurs et des fonctions qui lèvent ErreurCalcul.
 */
export function catalogueErreurs({ cs = [], js = [] }) {
  const constantes = new Map();
  for (const f of cs) {
    for (const c of constantesCs(f.source)) {
      if (!constantes.has(c.nom)) constantes.set(c.nom, new Set());
      constantes.get(c.nom).add(c.valeur);
    }
  }
  const resoudre = (nom) => (constantes.get(nom)?.size === 1 ? [...constantes.get(nom)][0] : null);
  const lieux = new Map();
  const ecartes = new Map();
  const ajouter = (code, message, chemin) => {
    if (!lieux.has(code)) lieux.set(code, []);
    lieux.get(code).push({ message, chemin });
  };
  const ailleurs = new Set();
  for (const f of cs) {
    const sites = sitesCs(f.source);
    for (const s of sites) {
      const code = s.code ?? (s.constante ? resoudre(s.constante) : null);
      if (code && CODE.test(code)) ajouter(code, s.message, f.chemin);
      // Code choisi par une expression (« a ? "X" : "Y" ») : ses codes possibles ne sont pas sûrs.
      else for (const m of f.source.slice(s.debut, s.fin).matchAll(/"([A-Z][A-Z0-9_]*)"/g)) ailleurs.add(m[1]);
    }
    // Toute autre apparition d'un code (littéral ou nom de constante) hors des lieux reconnus et des déclarations.
    const plages = [...sites.map((s) => [s.debut, s.fin]), ...[...f.source.matchAll(MIROIR_CS)].map((m) => [m.index, m.index + m[0].length])];
    const reconnu = (i) => plages.some(([d, fin]) => i >= d && i < fin);
    const sansConstantes = f.source.replace(CONSTANTE_CS, (t) => ' '.repeat(t.length));
    for (const m of sansConstantes.matchAll(/"([A-Z][A-Z0-9_]*)"/g)) if (!reconnu(m.index)) ailleurs.add(m[1]);
    for (const m of sansConstantes.matchAll(/\.(\w+)\b/g)) {
      const v = resoudre(m[1]);
      if (v && !reconnu(m.index)) ailleurs.add(v);
    }
  }
  for (const f of js) for (const s of sitesJs(f.source)) if (s.code) ajouter(s.code, s.message, f.chemin);

  const retenus = new Map();
  for (const code of [...lieux.keys()].sort()) {
    const l = lieux.get(code);
    const messages = new Set(l.map((x) => x.message));
    if (messages.has(null)) ecartes.set(code, 'message composé');
    else if (messages.size > 1) ecartes.set(code, 'plusieurs messages');
    else if (ailleurs.has(code)) ecartes.set(code, 'code employé ailleurs');
    else retenus.set(code, { message: l[0].message, chemins: [...new Set(l.map((x) => x.chemin))].sort() });
  }
  return { retenus, ecartes };
}
