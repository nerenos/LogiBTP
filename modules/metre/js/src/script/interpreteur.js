import { Dec, D, S, ZERO, UN, arr6, formatNombre, ErreurCalcul } from '@logibtp/socle';
import { analyserScript } from './analyseur.js';
import { MAX_DECIMAL } from './lexeur.js';
import { FONCTIONS, N, C, B } from './fonctions.js';

// Interpréteur du langage de script des métrés (réplique de Script/Interpreteur.cs).

const MAX_TOURS = 10000;
const MAX_INSTRUCTIONS = 100000;
const NOMS_TYPES = { N: 'numérique', C: 'chaîne', B: 'booléen' };
const DEFAUTS = { N: () => N(ZERO), C: () => C(''), B: () => B(false) };

class Interruption extends Error {
  constructor(code, message, noeud) {
    super(message);
    this.code = code;
    this.ligne = noeud.ligne;
    this.colonne = noeud.colonne;
  }
}

/** Valeur typée d'une donnée ou d'une variable de l'hôte (décimal, chaîne ou booléen ; null = 0). */
function typer(v) {
  if (v === null || v === undefined) return N(ZERO);
  if (typeof v === 'string') return C(v);
  if (typeof v === 'boolean') return B(v);
  if (v instanceof Dec || typeof v === 'number') return N(D(v));
  throw new ErreurCalcul('NON_NUMERIQUE', 'Donnée non utilisable dans un script (ni nombre, ni chaîne, ni booléen)');
}

/** Valeur typée vers la valeur exposée : texte décimal, chaîne ou booléen. */
export function exposer(valeur) {
  return valeur.t === 'N' ? S(arr6(valeur.v)) : valeur.v;
}

/** Texte d'une valeur dans une concaténation. */
function texte(valeur) {
  if (valeur.t === 'C') return valeur.v;
  if (valeur.t === 'B') return valeur.v ? 'Vrai' : 'Faux';
  return formatNombre(valeur.v);
}

function controler(v) {
  if (v.abs().gt(MAX_DECIMAL)) throw new ErreurCalcul('DEPASSEMENT', 'Valeur trop grande');
  return v;
}

/**
 * Exécute un script de métré. Ne lève pas d'erreur de calcul : elles sont renvoyées.
 *
 * contexte = {
 *   resoudre(reference) → décimal | chaîne | booléen : lecture d'une donnée ({{lig_qte}}) ou d'une variable
 *                         de portée (@@Perte, {{$largeur}}) — même résolveur que les formules ;
 *   portees, ligneId    : écriture des variables de portée (@@Poids = …) ;
 *   ecrire?(reference, valeur) : écriture d'une donnée de l'hôte ({{lig_libelle_html}} += …) ;
 *                         absent : erreur ECRITURE_INTERDITE ;
 *   fonctions?          : fonctions supplémentaires de l'hôte.
 * }
 * Renvoie { resultat (texte décimal | null), variables, erreurs, avertissements } :
 *  variables      [{ nom, type, local, parametre, valeur, defaut }] des variables déclarées (hors boucles implicites) ;
 *  erreurs        [{ code, message, ligne, colonne }] : toutes les erreurs d'analyse, ou la première erreur d'exécution ;
 *  avertissements [{ code, message }] : METRE_SANS_RESULTAT quand le script se termine sans « Renvoyer ».
 */
export function executerScript(texteScript, contexte = {}) {
  const analyse = analyserScript(texteScript, { fonctions: contexte.fonctions });
  const catalogue = { ...FONCTIONS, ...(contexte.fonctions ?? {}) };
  const memoire = new Map();
  const sortie = (resultat, erreurs, avertissements) => ({
    resultat,
    variables: analyse.declarations.filter((d) => !d.implicite).map((d) => ({
      nom: d.nom, type: d.type, local: d.local, parametre: d.parametre,
      valeur: memoire.has(d.nom) ? exposer(memoire.get(d.nom)) : null,
      defaut: d.defaut?.texte ?? null,
    })),
    erreurs,
    avertissements,
  });
  if (analyse.erreurs.length > 0) return sortie(null, analyse.erreurs, []);

  let instructions = 0;

  const lireReference = (n) => typer(contexte.resoudre(n.ref));
  const lireReferencePositionnee = (n) => {
    try {
      return lireReference(n);
    } catch (e) {
      if (e instanceof ErreurCalcul) throw new Interruption(e.code, e.message, n);
      throw e;
    }
  };

  function evaluer(n) {
    switch (n.k) {
      case 'val': return n.v;
      case 'var': return memoire.get(n.nom);
      case 'portee':
      case 'donnee': return lireReferencePositionnee(n);
      case 'un': {
        const v = evaluer(n.e);
        if (n.op === 'pas') {
          if (v.t !== 'B') throw new Interruption('TYPE', '« pas » : booléen attendu', n);
          return B(!v.v);
        }
        if (v.t !== 'N') throw new Interruption('TYPE', `« ${n.op} » : numérique attendu`, n);
        return n.op === '-' ? N(v.v.neg()) : v;
      }
      case 'bin': return binaire(n);
      case 'appel': {
        const args = n.args.map(evaluer);
        try {
          const r = catalogue[n.nom].appliquer(args);
          if (r.t === 'N') controler(r.v);
          return r;
        } catch (e) {
          if (e instanceof ErreurCalcul) throw new Interruption(e.code, `${catalogue[n.nom].signature} : ${e.message}`, n);
          throw e;
        }
      }
      default: throw new Error(`Nœud inconnu ${n.k}`);
    }
  }

  function booleen(v, quoi, n) {
    if (v.t !== 'B') throw new Interruption('TYPE', `${quoi} : booléen attendu, ${NOMS_TYPES[v.t]} trouvé`, n);
    return v.v;
  }

  function arithmetique(op, g, d, n) {
    if (op === '+' && (g.t === 'C' || d.t === 'C')) return C(texte(g) + texte(d));
    if (g.t !== 'N' || d.t !== 'N') {
      throw new Interruption('TYPE', `« ${op} » : numériques attendus, ${NOMS_TYPES[g.t]} et ${NOMS_TYPES[d.t]} trouvés`, n);
    }
    const a = g.v;
    const b = d.v;
    try {
      switch (op) {
        case '+': return N(controler(a.plus(b)));
        case '-': return N(controler(a.minus(b)));
        case '*': return N(controler(a.times(b)));
        default:
          if (b.isZero()) throw new ErreurCalcul('DIVISION_ZERO', 'Division par zéro');
          return N(controler(op === '/' ? a.div(b) : a.mod(b)));
      }
    } catch (e) {
      if (e instanceof ErreurCalcul) throw new Interruption(e.code, e.message, n);
      throw e;
    }
  }

  function binaire(n) {
    if (n.op === 'et' || n.op === 'ou') {
      const g = booleen(evaluer(n.g), `« ${n.op} »`, n);
      if (n.op === 'et' ? !g : g) return B(g);
      return B(booleen(evaluer(n.d), `« ${n.op} »`, n));
    }
    const g = evaluer(n.g);
    const d = evaluer(n.d);
    if (['+', '-', '*', '/', 'modulo'].includes(n.op)) return arithmetique(n.op, g, d, n);
    if (g.t !== d.t) throw new Interruption('TYPE', `Comparaison de types différents : ${NOMS_TYPES[g.t]} et ${NOMS_TYPES[d.t]}`, n);
    if (g.t === 'B' && n.op !== '=' && n.op !== '<>') throw new Interruption('TYPE', 'Booléens : seuls « = » et « <> » sont permis', n);
    const c = g.t === 'N' ? g.v.cmp(d.v) : g.t === 'C' ? (g.v < d.v ? -1 : g.v > d.v ? 1 : 0) : (g.v === d.v ? 0 : 1);
    switch (n.op) {
      case '=': return B(c === 0);
      case '<>': return B(c !== 0);
      case '<': return B(c < 0);
      case '<=': return B(c <= 0);
      case '>': return B(c > 0);
      default: return B(c >= 0);
    }
  }

  /** Valeur conforme au type déclaré (numérique arrondi à 6 décimales). */
  function conforme(type, v, nom, n) {
    if (v.t !== type) throw new Interruption('TYPE', `« ${nom} » est ${NOMS_TYPES[type]} : ${NOMS_TYPES[v.t]} affecté`, n);
    return type === 'N' ? N(arr6(v.v)) : v;
  }

  function nouvelleValeur(op, ancienne, v, n) {
    if ((op === '++' || op === '--') && ancienne.t !== 'N') throw new Interruption('TYPE', `« ${op} » : numérique attendu`, n);
    switch (op) {
      case '=': return v;
      case '++': return arithmetique('+', ancienne, N(UN), n);
      case '--': return arithmetique('-', ancienne, N(UN), n);
      default: return arithmetique(op[0], ancienne, v, n);
    }
  }

  function affecter(n) {
    const c = n.cible;
    const v = n.e ? evaluer(n.e) : null;
    try {
      if (c.k === 'var') {
        const ancienne = memoire.get(c.nom);
        memoire.set(c.nom, conforme(ancienne.t, nouvelleValeur(n.op, ancienne, v, n), c.nom, n));
        return;
      }
      if (c.k === 'portee') {
        // Écriture au contexte le plus proche (=) ou là où la variable existe (opérations composées).
        if (!contexte.portees) throw new ErreurCalcul('PORTEE', `${c.ref} : aucune portée disponible`);
        if (n.op === '=') {
          contexte.portees.affecter(c.portee, c.nom, '=', v.v, contexte.ligneId);
          return;
        }
        const ancienne = typer(contexte.portees.lire(c.portee, c.nom, contexte.ligneId));
        const r = nouvelleValeur(n.op, ancienne, v, n);
        if (r.t !== 'N') throw new Interruption('TYPE', `${c.ref} : numérique attendu`, n);
        contexte.portees.affecter(c.portee, c.nom, '+=', r.v.minus(ancienne.v), contexte.ligneId);
        return;
      }
      if (!contexte.ecrire) throw new ErreurCalcul('ECRITURE_INTERDITE', `{{${c.ref}}} ne peut pas être modifié`);
      const r = n.op === '=' ? v : nouvelleValeur(n.op, lireReference(c), v, n);
      contexte.ecrire(c.ref, exposer(r));
    } catch (e) {
      if (e instanceof ErreurCalcul) throw new Interruption(e.code, e.message, n);
      throw e;
    }
  }

  // Exécution d'un bloc : renvoie null, { k: 'sortir' }, { k: 'continuer' } ou { k: 'renvoyer', v }.
  function executer(corps) {
    for (const n of corps) {
      if (++instructions > MAX_INSTRUCTIONS) throw new Interruption('BOUCLE_INFINIE', 'Trop d\'instructions exécutées', n);
      switch (n.k) {
        case 'decl':
          memoire.set(n.nom, n.init ? conforme(n.type, evaluer(n.init), n.nom, n) : DEFAUTS[n.type]());
          break;
        case 'aff':
          affecter(n);
          break;
        case 'si': {
          const branche = n.branches.find((b) => booleen(evaluer(b.cond), 'Condition du « Si »', b.cond));
          const r = executer(branche ? branche.corps : n.sinon ?? []);
          if (r) return r;
          break;
        }
        case 'pour': {
          const r = boucle(n);
          if (r) return r;
          break;
        }
        case 'renvoyer': {
          const v = evaluer(n.e);
          if (v.t !== 'N') throw new Interruption('RESULTAT_TYPE', `« Renvoyer » : numérique attendu, ${NOMS_TYPES[v.t]} trouvé`, n);
          return { k: 'renvoyer', v: v.v };
        }
        default:
          return { k: n.k };
      }
    }
    return null;
  }

  function boucle(n) {
    const borne = (e, quoi) => {
      const v = evaluer(e);
      if (v.t !== 'N') throw new Interruption('TYPE', `« Pour », ${quoi} : numérique attendu`, e);
      return v.v;
    };
    if (memoire.get(n.nom).t !== 'N') {
      throw new Interruption('TYPE', `« Pour » : « ${n.nom} » doit être numérique`, n);
    }
    const fin = borne(n.fin, 'fin');
    const pas = n.pas ? borne(n.pas, 'pas') : UN;
    if (pas.isZero()) throw new Interruption('BOUCLE_INFINIE', '« Pour » : pas nul', n);
    memoire.set(n.nom, N(arr6(borne(n.debut, 'début'))));
    for (let tours = 0; ; tours++) {
      const i = memoire.get(n.nom).v;
      if (pas.isPos() ? i.gt(fin) : i.lt(fin)) return null;
      if (tours >= MAX_TOURS) throw new Interruption('BOUCLE_INFINIE', `« Pour » : plus de ${MAX_TOURS} tours`, n);
      const r = executer(n.corps);
      if (r?.k === 'sortir') return null;
      if (r?.k === 'renvoyer') return r;
      memoire.set(n.nom, N(arr6(memoire.get(n.nom).v.plus(pas))));
    }
  }

  try {
    for (const d of analyse.declarations) if (d.implicite) memoire.set(d.nom, N(ZERO));
    const r = executer(analyse.programme);
    if (r?.k === 'renvoyer') return sortie(S(arr6(r.v)), [], []);
    return sortie(null, [], [{ code: 'METRE_SANS_RESULTAT', message: 'Le script ne renvoie pas de quantité (« Renvoyer » absent)' }]);
  } catch (e) {
    if (e instanceof Interruption) return sortie(null, [{ code: e.code, message: e.message, ligne: e.ligne, colonne: e.colonne }], []);
    throw e;
  }
}
