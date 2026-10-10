import { Dec } from './decimal.js';

export class ErreurCalcul extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Analyseur d'expressions sans eval(), en calcul décimal.
// Grammaire (identique à Expression.cs) :
//   expr    := terme (('+' | '-') terme)*
//   terme   := facteur (('*' | '/') facteur)*
//   facteur := ('+' | '-') facteur | primaire
//   primaire:= nombre | '(' expr ')' | '{{' référence '}}'
// Les nombres acceptent la virgule ou le point décimal ; ×, ÷ et − sont reconnus.

const OPERATEURS = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '/': '/', '÷': '/', '(': '(', ')': ')' };
const estChiffre = (c) => c !== undefined && c >= '0' && c <= '9';

function decouper(texte) {
  const s = texte ?? '';
  const jetons = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{' && s[i + 1] === '{') {
      const fin = s.indexOf('}}', i + 2);
      if (fin < 0) throw new ErreurCalcul('SYNTAXE', 'Accolades fermantes « }} » attendues');
      jetons.push({ t: 'r', v: s.slice(i + 2, fin).trim(), s: s.slice(i, fin + 2) });
      i = fin + 2;
      continue;
    }
    if (estChiffre(c)) {
      let j = i;
      while (estChiffre(s[j])) j++;
      if ((s[j] === '.' || s[j] === ',') && estChiffre(s[j + 1])) {
        j++;
        while (estChiffre(s[j])) j++;
      }
      const txt = s.slice(i, j);
      jetons.push({ t: 'n', v: new Dec(txt.replace(',', '.')), s: txt });
      i = j;
      continue;
    }
    const op = OPERATEURS[c];
    if (op) { jetons.push({ t: op, s: c }); i++; continue; }
    throw new ErreurCalcul('SYNTAXE', `Caractère inattendu « ${c} »`);
  }
  return jetons;
}

/**
 * Évalue une formule. `resoudre(reference)` renvoie la valeur décimale d'une référence {{...}}.
 */
export function evaluerExpression(texte, resoudre) {
  const jetons = decouper(texte);
  if (jetons.length === 0) throw new ErreurCalcul('FORMULE_VIDE', 'Formule vide');
  let i = 0;
  const courant = () => jetons[i];

  function expr() {
    let v = terme();
    while (courant() && (courant().t === '+' || courant().t === '-')) {
      const op = jetons[i++].t;
      const d = terme();
      v = op === '+' ? v.plus(d) : v.minus(d);
    }
    return v;
  }

  function terme() {
    let v = facteur();
    while (courant() && (courant().t === '*' || courant().t === '/')) {
      const op = jetons[i++].t;
      const d = facteur();
      if (op === '*') v = v.times(d);
      else {
        if (d.isZero()) throw new ErreurCalcul('DIVISION_ZERO', 'Division par zéro');
        v = v.div(d);
      }
    }
    return v;
  }

  function facteur() {
    const j = courant();
    if (!j) throw new ErreurCalcul('SYNTAXE', 'Expression incomplète');
    if (j.t === '+') { i++; return facteur(); }
    if (j.t === '-') { i++; return facteur().neg(); }
    return primaire();
  }

  function primaire() {
    const j = jetons[i++];
    if (!j) throw new ErreurCalcul('SYNTAXE', 'Expression incomplète');
    if (j.t === 'n') return j.v;
    if (j.t === 'r') return resoudre(j.v);
    if (j.t === '(') {
      const v = expr();
      if (!courant() || courant().t !== ')') throw new ErreurCalcul('SYNTAXE', 'Parenthèse fermante attendue');
      i++;
      return v;
    }
    throw new ErreurCalcul('SYNTAXE', `Jeton inattendu « ${j.s} »`);
  }

  const v = expr();
  if (i < jetons.length) throw new ErreurCalcul('SYNTAXE', `Jeton inattendu « ${jetons[i].s} »`);
  return v;
}

/** Liste des références {{...}} d'une formule (aide à la saisie). */
export function referencesDe(texte) {
  return decouper(texte).filter((j) => j.t === 'r').map((j) => j.v);
}
