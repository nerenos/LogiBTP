import { ErreurCalcul } from './expression.js';

// Variables de calcul : $$ document, $ titre parent, @@ ouvrage parent, @ ligne courante.
const RE_VARIABLE = /^(\$\$|\$|@@|@)([\p{L}_][\p{L}\p{N}_]*)$/u;
// Variables de données : colonne, table.colonne ou table[id].colonne.
const RE_DONNEE = /^(?:([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?\.)?([A-Za-z_][A-Za-z0-9_]*)$/;

export function analyserReference(texte) {
  const t = texte.trim();
  let m = RE_VARIABLE.exec(t);
  if (m) return { genre: 'variable', portee: m[1], nom: m[2] };
  m = RE_DONNEE.exec(t);
  if (m) {
    return {
      genre: 'donnee',
      table: m[1] ? m[1].toLowerCase() : null,
      id: m[2] ?? null,
      colonne: m[3].toLowerCase(),
    };
  }
  throw new ErreurCalcul('REFERENCE_INVALIDE', `Référence invalide {{${t}}}`);
}

/** Cible d'une affectation de métré, par exemple « @surface ». */
export function analyserCibleVariable(texte) {
  const m = RE_VARIABLE.exec((texte ?? '').trim());
  if (!m) throw new ErreurCalcul('REFERENCE_INVALIDE', `Variable cible invalide « ${texte} »`);
  return { portee: m[1], nom: m[2] };
}
