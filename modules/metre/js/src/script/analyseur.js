import { texte } from '@logibtp/socle/dictionnaire';
import { analyserReference, ErreurCalcul } from '@logibtp/socle';
import { decouper, normaliser } from './lexeur.js';
import { FONCTIONS } from './fonctions.js';

// Analyseur du langage de script des métrés (réplique de Script/Analyseur.cs).
// Produit l'arbre du programme et toutes les erreurs détectables sans exécution : syntaxe (avec reprise à
// l'instruction suivante), variables inconnues ou déclarées deux fois, fonctions inconnues, nombre
// d'arguments, Sortir / Continuer hors boucle, références invalides.

const TYPES = { chaine: 'C', numerique: 'N', booleen: 'B', bool: 'B' };
const COMPARAISONS = new Set(['=', '<>', '<', '<=', '>', '>=']);
const AFFECTATIONS = new Set(['=', '+=', '-=', '*=', '/=']);

class ErreurSyntaxe extends Error {
  constructor(code, message, jeton) {
    super(message);
    this.code = code;
    this.ligne = jeton.ligne;
    this.colonne = jeton.colonne;
  }
}

/**
 * Analyse un script. Renvoie { programme, declarations, erreurs } :
 *  programme     instructions (arbre) ;
 *  declarations  [{ nom, type 'C'|'N'|'B', local, implicite, parametre, defaut: { debut, fin, texte } | null,
 *                   declaration: { debut, fin }, ligne, colonne }] dans l'ordre du texte ;
 *  erreurs       [{ code, message, ligne, colonne }] triées par position.
 * options.fonctions : fonctions de l'hôte, ajoutées à FONCTIONS (nom normalisé → définition).
 */
export function analyserScript(script, { fonctions } = {}) {
  const source = script ?? '';
  const { jetons, erreurs } = decouper(source);
  const catalogue = { ...FONCTIONS, ...(fonctions ?? {}) };
  const declarations = [];
  const parNom = new Map();
  const cibles = new Set();
  let i = 0;
  let enTete = true;
  let boucles = 0;
  let profondeurBloc = 0;

  const courant = () => jetons[i];
  const suivant = () => jetons[i++];
  const estOp = (v, j = courant()) => j.t === 'op' && j.v === v;
  const estMc = (n, j = courant()) => j.t === 'mc' && j.n === n;
  const faute = (message, j = courant(), code = 'SYNTAXE') => new ErreurSyntaxe(code, message, j);
  const signaler = (code, message, j) => erreurs.push({ code, message, ligne: j.ligne, colonne: j.colonne });
  const decrire = (j) => (j.t === 'fin' ? texte('metre.script.decrire.fin') : j.t === 'nl' ? texte('metre.script.decrire.nl') : texte('metre.script.decrire.jeton', { jeton: source.slice(j.debut, j.fin) }));
  const attendreOp = (v, quoi) => {
    if (!estOp(v)) throw faute(texte('metre.script.attendu', { quoi, trouve: decrire(courant()) }));
    return suivant();
  };
  const finInstruction = () => {
    const j = courant();
    if (j.t === 'nl') { i++; return; }
    if (j.t === 'fin') return;
    throw faute(texte('metre.script.fin_instruction', { trouve: decrire(j) }));
  };
  const position = (j) => ({ ligne: j.ligne, colonne: j.colonne });

  // ------------------------------------------------------------------ expressions

  function expression() { return ou(); }

  function ou() {
    let g = et();
    while (estMc('ou')) {
      const j = suivant();
      g = { k: 'bin', op: 'ou', g, d: et(), ...position(j) };
    }
    return g;
  }

  function et() {
    let g = non();
    while (estMc('et')) {
      const j = suivant();
      g = { k: 'bin', op: 'et', g, d: non(), ...position(j) };
    }
    return g;
  }

  function non() {
    if (estMc('pas')) {
      const j = suivant();
      return { k: 'un', op: 'pas', e: non(), ...position(j) };
    }
    return comparaison();
  }

  function comparaison() {
    const g = somme();
    const j = courant();
    if (j.t === 'op' && COMPARAISONS.has(j.v)) {
      i++;
      const n = { k: 'bin', op: j.v, g, d: somme(), ...position(j) };
      const k = courant();
      if (k.t === 'op' && COMPARAISONS.has(k.v)) throw faute(texte('metre.script.comparaisons_enchainees'), k);
      return n;
    }
    return g;
  }

  function somme() {
    let g = produit();
    while (estOp('+') || estOp('-')) {
      const j = suivant();
      g = { k: 'bin', op: j.v, g, d: produit(), ...position(j) };
    }
    return g;
  }

  function produit() {
    let g = unaire();
    while (estOp('*') || estOp('/') || estMc('modulo')) {
      const j = suivant();
      g = { k: 'bin', op: j.t === 'mc' ? 'modulo' : j.v, g, d: unaire(), ...position(j) };
    }
    return g;
  }

  function unaire() {
    if (estOp('+') || estOp('-')) {
      const j = suivant();
      return { k: 'un', op: j.v, e: unaire(), ...position(j) };
    }
    return primaire();
  }

  function reference(j) {
    let r;
    try {
      r = analyserReference(j.v);
    } catch (e) {
      if (!(e instanceof ErreurCalcul)) throw e;
      throw faute(e.message, j, e.code);
    }
    return r.genre === 'variable'
      ? { k: 'portee', ref: `${r.portee}${r.nom}`, portee: r.portee, nom: r.nom, ...position(j) }
      : { k: 'donnee', ref: j.v, ...position(j) };
  }

  function variable(j) {
    if (!parNom.has(j.v)) signaler('VARIABLE_INCONNUE', texte('metre.script.variable_inconnue', { nom: j.v }), j);
    return { k: 'var', nom: j.v, ...position(j) };
  }

  function primaire() {
    const j = courant();
    if (j.t === 'nb') { i++; return { k: 'val', v: { t: 'N', v: j.v }, ...position(j) }; }
    if (j.t === 'ch') { i++; return { k: 'val', v: { t: 'C', v: j.v }, ...position(j) }; }
    if (estMc('vrai') || estMc('faux')) { i++; return { k: 'val', v: { t: 'B', v: j.n === 'vrai' }, ...position(j) }; }
    if (j.t === 'ref') { i++; return reference(j); }
    if (estOp('(')) {
      i++;
      const e = expression();
      attendreOp(')', texte('metre.script.quoi.parenthese'));
      return e;
    }
    if (j.t === 'id') {
      i++;
      if (!estOp('(')) return variable(j);
      i++;
      const args = [];
      if (!estOp(')')) {
        args.push(expression());
        while (estOp(';')) { i++; args.push(expression()); }
      }
      attendreOp(')', texte('metre.script.quoi.parenthese'));
      const def = catalogue[j.n];
      if (!def) signaler('FONCTION_INCONNUE', texte('metre.script.fonction_inconnue', { nom: j.v }), j);
      else if (args.length < def.min || (def.max !== null && args.length > def.max)) {
        signaler('ARGUMENTS', texte('metre.script.arguments', { signature: def.signature, nombre: args.length }), j);
      }
      return { k: 'appel', nom: j.n, texte: j.v, args, ...position(j) };
    }
    throw faute(texte('metre.script.expression_attendue', { trouve: decrire(j) }), j);
  }

  // ------------------------------------------------------------------ instructions

  function declarer(nom, type, local, implicite, j, extra = {}) {
    if (parNom.has(nom)) {
      signaler('DECLARATION_DOUBLE', texte('metre.script.declaration_double', { nom }), j);
      return null;
    }
    const d = { nom, type, local, implicite, parametre: false, defaut: null, ...position(j), ...extra };
    declarations.push(d);
    parNom.set(nom, d);
    return d;
  }

  function declaration() {
    const debut = courant();
    const local = estMc('local');
    if (local) i++;
    const jn = courant();
    if (jn.t !== 'id') throw faute(texte('metre.script.nom_attendu', { trouve: decrire(jn) }));
    i++;
    if (!(courant().t === 'id' && courant().n === 'est')) throw faute(texte('metre.script.est_attendu', { trouve: decrire(courant()) }));
    i++;
    if (courant().t === 'id' && (courant().n === 'un' || courant().n === 'une')) i++;
    const jt = courant();
    const type = jt.t === 'id' ? TYPES[jt.n] : undefined;
    if (!type) throw faute(texte('metre.script.type_attendu', { trouve: decrire(jt) }), jt);
    i++;
    let init = null;
    let defaut = null;
    if (estOp('=')) {
      i++;
      const premier = courant();
      init = expression();
      const dernier = jetons[i - 1];
      defaut = { debut: premier.debut, fin: dernier.fin, texte: source.slice(premier.debut, dernier.fin) };
    }
    if (!enTete || boucles > 0 || profondeurBloc > 0) signaler('SYNTAXE', texte('metre.script.declarations_tete'), debut);
    declarer(jn.v, type, local, false, jn, { defaut, declaration: { debut: debut.debut, fin: jetons[i - 1].fin } });
    return { k: 'decl', nom: jn.v, type, init, ...position(jn) };
  }

  function estDeclaration() {
    if (estMc('local')) return true;
    const j = jetons[i + 1];
    return courant().t === 'id' && j && j.t === 'id' && j.n === 'est';
  }

  function cible(j) {
    if (j.t === 'ref') return reference(j);
    if (j.t === 'id') {
      cibles.add(j.v);
      return variable(j);
    }
    throw faute(texte('metre.script.instruction_attendue', { trouve: decrire(j) }), j);
  }

  function bloc(fins) {
    const corps = [];
    profondeurBloc++;
    try {
      for (;;) {
        const j = courant();
        if (j.t === 'fin') return corps;
        if (j.t === 'mc' && fins.includes(j.n)) return corps;
        const n = instructionAvecReprise();
        if (n) corps.push(n);
      }
    } finally {
      profondeurBloc--;
    }
  }

  function exigerFin(ouverture, quoi) {
    if (!estMc('fin')) throw faute(texte('metre.script.fin_attendue', { quoi, ligne: ouverture.ligne }), courant());
    i++;
  }

  function si() {
    const ouverture = suivant();
    const branches = [];
    let sinon = null;
    let cond = expression();
    if (estMc('alors')) i++;
    finInstruction();
    for (;;) {
      branches.push({ cond, corps: bloc(['sinon', 'sinonsi', 'fin']) });
      if (estMc('sinonsi') || (estMc('sinon') && estMc('si', jetons[i + 1]))) {
        i += estMc('sinonsi') ? 1 : 2;
        cond = expression();
        if (estMc('alors')) i++;
        finInstruction();
        continue;
      }
      if (estMc('sinon')) {
        i++;
        finInstruction();
        sinon = bloc(['fin']);
      }
      break;
    }
    exigerFin(ouverture, texte('metre.script.quoi.si'));
    return { k: 'si', branches, sinon, ...position(ouverture) };
  }

  function pour() {
    const ouverture = suivant();
    const jv = courant();
    if (jv.t !== 'id') throw faute(texte('metre.script.variable_boucle', { trouve: decrire(jv) }), jv);
    i++;
    if (!parNom.has(jv.v)) declarer(jv.v, 'N', true, true, jv);
    cibles.add(jv.v);
    attendreOp('=', texte('metre.script.quoi.egal'));
    const debut = expression();
    if (!(courant().t === 'id' && courant().n === 'a')) throw faute(texte('metre.script.a_attendu', { trouve: decrire(courant()) }));
    i++;
    const fin = expression();
    let pas = null;
    if (estMc('pas')) { i++; pas = expression(); }
    finInstruction();
    boucles++;
    let corps;
    try {
      corps = bloc(['fin']);
    } finally {
      boucles--;
    }
    exigerFin(ouverture, texte('metre.script.quoi.pour'));
    return { k: 'pour', nom: jv.v, debut, fin, pas, corps, ...position(ouverture) };
  }

  function instruction() {
    const j = courant();
    if (estDeclaration()) return declaration();
    enTete = false;
    if (estMc('si')) return si();
    if (estMc('pour')) return pour();
    if (estMc('renvoyer')) {
      i++;
      return { k: 'renvoyer', e: expression(), ...position(j) };
    }
    if (estMc('sortir') || estMc('continuer')) {
      i++;
      if (boucles === 0) signaler('SYNTAXE', texte('metre.script.hors_boucle', { mot: j.v }), j);
      return { k: j.n, ...position(j) };
    }
    i++;
    const c = cible(j);
    const op = courant();
    if (op.t === 'op' && (op.v === '++' || op.v === '--')) {
      i++;
      return { k: 'aff', cible: c, op: op.v, e: null, ...position(op) };
    }
    if (op.t === 'op' && AFFECTATIONS.has(op.v)) {
      i++;
      return { k: 'aff', cible: c, op: op.v, e: expression(), ...position(op) };
    }
    throw faute(texte('metre.script.affectation_attendue', { trouve: decrire(op) }), op);
  }

  function instructionAvecReprise() {
    try {
      const n = instruction();
      finInstruction();
      return n;
    } catch (e) {
      if (!(e instanceof ErreurSyntaxe)) throw e;
      erreurs.push({ code: e.code, message: e.message, ligne: e.ligne, colonne: e.colonne });
      while (courant().t !== 'nl' && courant().t !== 'fin') i++;
      if (courant().t === 'nl') i++;
      return null;
    }
  }

  const programme = [];
  while (courant().t !== 'fin') {
    if (courant().t === 'mc' && ['fin', 'sinon', 'sinonsi'].includes(courant().n)) {
      signaler('SYNTAXE', texte('metre.script.sans_ouverture', { mot: courant().v }), courant());
      i++;
      if (courant().t === 'nl') i++;
      continue;
    }
    const n = instructionAvecReprise();
    if (n) programme.push(n);
  }

  for (const d of declarations) d.parametre = !d.local && !d.implicite && !cibles.has(d.nom);
  erreurs.sort((a, b) => (a.ligne - b.ligne) || (a.colonne - b.colonne));
  return { programme, declarations, erreurs };
}

export { normaliser };
