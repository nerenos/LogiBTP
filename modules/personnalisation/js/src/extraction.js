// Extraction semi-automatique des textes en dur (ANALYSE-MODULE-PERSONNALISATION.md § 7.2) : relève dans une source JS
// les littéraux et morceaux de gabarits qui ressemblent à du texte affiché (lettres et espace, ou majuscule accentuée),
// les icônes (émojis, symboles) et les couleurs en dur, avec leur ligne. Rapport à relire : la clé et le remplacement
// sont choisis par le développeur (jamais de remplacement aveugle dans un gabarit innerHTML).

const LITTERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const BALISE = /<[^>]*>/g;
const INTERPOLATION = /\$\{(?:[^{}]|\{[^{}]*\})*\}/g;
const ICONE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FF0B}]/u;
const COULEUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;

/** Le morceau ressemble-t-il à un texte affiché ? (au moins deux lettres et un espace, ou une lettre accentuée). */
export function estTexte(t) {
  const s = t.trim();
  if (s.length < 2 || /^[\w.-]+$/.test(s) && !/[À-ÿ]/.test(s)) return false;
  // Morceau de code (gabarit imbriqué, sélecteur CSS) : accolades, parenthèses, crochets, flèches, affectations.
  if (/[{}()[\];=]|=>|\?\s*$|^[.#\[]/.test(s)) return false;
  if (/^[a-z][\w-]*(\s+[a-z][\w-]*)*$/.test(s) && !/[À-ÿ]/.test(s) && s.split(/\s+/).every((m) => /[-_]|^[a-z]+$/.test(m)) && !/\s(de|la|le|les|du|des|et|à|un|une|en|au|par|sur|pour)\s/.test(` ${s} `)) return false;
  return /\p{L}{2}/u.test(s) && (/\s/.test(s) || /[À-ÿ]/.test(s) || /^\p{Lu}\p{Ll}+$/u.test(s));
}

/** Rapport d'une source : [{ ligne, genre: 'texte'|'icone'|'couleur', valeur }]. */
export function extraire(source) {
  const res = [];
  const ligne = (i) => source.slice(0, i).split('\n').length;
  for (const m of source.matchAll(LITTERAL)) {
    const brut = m[1] ?? m[2] ?? m[3] ?? '';
    const avant = source.slice(Math.max(0, m.index - 30), m.index);
    if (/\b(import|from|require)\s*\(?\s*$/.test(avant) || /(texte|texteHtml|pluriel|icone|iconeHtml)\(\s*$/.test(avant)) continue;
    const morceaux = brut.replace(INTERPOLATION, '\u0000').replace(BALISE, '\u0000').split('\u0000');
    for (const t of morceaux) {
      if (estTexte(t)) res.push({ ligne: ligne(m.index), genre: 'texte', valeur: t.trim() });
      if (ICONE.test(t)) res.push({ ligne: ligne(m.index), genre: 'icone', valeur: [...t].filter((c) => ICONE.test(c)).join(' ') });
    }
    for (const c of brut.matchAll(COULEUR)) res.push({ ligne: ligne(m.index), genre: 'couleur', valeur: c[0] });
  }
  return res;
}
