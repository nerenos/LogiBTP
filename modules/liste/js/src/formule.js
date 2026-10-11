import { Dec } from '@logibtp/socle';
import { normaliser } from './normaliser.js';

// Formules des colonnes calculées et conditions de mise en forme, évaluées sur les lignes chargées.
//
//   [Colonne]                     valeur d'une colonne, par code ou par titre (sans casse ni accents)
//   12,5  "texte"  VRAI  FAUX  VIDE
//   + - * /   &  (concaténation)   = <> != < <= > >=   ET  OU  NON   ( )
//   SI condition ALORS valeur [SINON valeur]       SI(condition; valeur; valeur)
//   ARRONDI(x; n)  ABS(x)  MIN(a; b…)  MAX(a; b…)  ESTVIDE(x)  CONCAT(a; b…)  MAJUSCULE(t)  MINUSCULE(t)
//
// Exemple : SI [Qté commandée] > [Qté livrée] ALORS "Reste à livrer" SINON ""
// Les nombres sont calculés en décimal exact ; le résultat d'un calcul est rendu en chaîne décimale.

export class ErreurFormule extends Error {
  constructor(message, position = null) {
    super(position === null ? message : `${message} (position ${position + 1})`);
    this.position = position;
  }
}

const MOTS = new Set(['SI', 'ALORS', 'SINON', 'ET', 'OU', 'NON', 'VRAI', 'FAUX', 'VIDE']);

function decouper(source) {
  const jetons = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    const debut = i;
    if (c === '"' || c === '\'') {
      let texte = '';
      i++;
      while (i < source.length) {
        if (source[i] === c) {
          // Guillemet doublé : guillemet littéral.
          if (source[i + 1] !== c) break;
          texte += c;
          i += 2;
          continue;
        }
        texte += source[i++];
      }
      if (i >= source.length) throw new ErreurFormule('Chaîne non terminée', debut);
      i++;
      jetons.push({ t: 'texte', v: texte, p: debut });
    } else if (c === '[') {
      const fin = source.indexOf(']', i);
      if (fin < 0) throw new ErreurFormule('Crochet non fermé', debut);
      jetons.push({ t: 'ref', v: source.slice(i + 1, fin).trim(), p: debut });
      i = fin + 1;
    } else if (/[0-9]/.test(c) || (c === ',' && /[0-9]/.test(source[i + 1] ?? '')) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      while (i < source.length && /[0-9.,]/.test(source[i])) i++;
      const brut = source.slice(debut, i).replace(',', '.');
      if (!/^\d*\.?\d+$|^\d+\.$/.test(brut)) throw new ErreurFormule(`Nombre invalide ${source.slice(debut, i)}`, debut);
      jetons.push({ t: 'nombre', v: new Dec(brut), p: debut });
    } else if (/[\p{L}_]/u.test(c)) {
      while (i < source.length && /[\p{L}\p{N}_]/u.test(source[i])) i++;
      const mot = source.slice(debut, i).toUpperCase();
      jetons.push({ t: MOTS.has(mot) ? mot : 'nom', v: mot, p: debut });
    } else {
      const deux = source.slice(i, i + 2);
      if (['<=', '>=', '<>', '!='].includes(deux)) { jetons.push({ t: deux === '!=' ? '<>' : deux, p: debut }); i += 2; continue; }
      if ('+-*/&=<>();'.includes(c)) { jetons.push({ t: c, p: debut }); i++; continue; }
      throw new ErreurFormule(`Caractère inattendu « ${c} »`, debut);
    }
  }
  jetons.push({ t: 'fin', p: source.length });
  return jetons;
}

// ------------------------------------------------------------------ valeurs

const estDec = (v) => v instanceof Dec;
const estVide = (v) => v === null || v === undefined || v === '';

/** Valeur numérique d'une donnée (nombre, chaîne décimale, booléen), ou null. */
function nombre(v) {
  if (estDec(v)) return v;
  if (typeof v === 'number') return new Dec(v);
  if (typeof v === 'boolean') return new Dec(v ? 1 : 0);
  if (typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v)) return new Dec(v.trim().replace(',', '.'));
  return null;
}

const versNombre = (v, quoi) => {
  if (estVide(v)) return new Dec(0);
  const n = nombre(v);
  if (n === null) throw new ErreurFormule(`${quoi} : « ${v} » n'est pas un nombre`);
  return n;
};

// Texte d'un nombre calculé : virgule décimale (affichage en français).
const versTexte = (v) => (estVide(v) ? '' : estDec(v) ? v.toFixed().replace('.', ',') : typeof v === 'boolean' ? (v ? 'VRAI' : 'FAUX') : String(v));

export function vrai(v) {
  if (typeof v === 'boolean') return v;
  if (estVide(v)) return false;
  const n = nombre(v);
  if (n !== null) return !n.isZero();
  return String(v).toUpperCase() !== 'FAUX';
}

function comparer(a, b) {
  if (estVide(a) && estVide(b)) return 0;
  const na = nombre(a), nb = nombre(b);
  if (na !== null && nb !== null) return na.cmp(nb);
  if (estVide(a)) return -1;
  if (estVide(b)) return 1;
  const ta = versTexte(a), tb = versTexte(b);
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

/** Résultat d'une formule pour l'affichage : décimal en chaîne exacte, le reste tel quel. */
export const resultat = (v) => (estDec(v) ? (v.isZero() ? '0' : v.toFixed()) : v);

// ------------------------------------------------------------------ analyse

const FONCTIONS = {
  SI: (args) => {
    if (args.length < 2 || args.length > 3) throw new ErreurFormule('SI attend 2 ou 3 arguments');
    return (ctx) => (vrai(args[0](ctx)) ? args[1](ctx) : args[2] ? args[2](ctx) : '');
  },
  ARRONDI: (args) => {
    if (args.length < 1 || args.length > 2) throw new ErreurFormule('ARRONDI attend 1 ou 2 arguments');
    return (ctx) => versNombre(args[0](ctx), 'ARRONDI').toDecimalPlaces(args[1] ? versNombre(args[1](ctx), 'ARRONDI').toNumber() : 0, Dec.ROUND_HALF_UP);
  },
  ABS: (args) => (ctx) => versNombre(args[0]?.(ctx), 'ABS').abs(),
  MIN: (args) => (ctx) => args.map((a) => versNombre(a(ctx), 'MIN')).reduce((x, y) => (x.lt(y) ? x : y)),
  MAX: (args) => (ctx) => args.map((a) => versNombre(a(ctx), 'MAX')).reduce((x, y) => (x.gt(y) ? x : y)),
  ESTVIDE: (args) => (ctx) => estVide(args[0]?.(ctx)),
  CONCAT: (args) => (ctx) => args.map((a) => versTexte(a(ctx))).join(''),
  MAJUSCULE: (args) => (ctx) => versTexte(args[0]?.(ctx)).toUpperCase(),
  MINUSCULE: (args) => (ctx) => versTexte(args[0]?.(ctx)).toLowerCase(),
};

class Analyseur {
  constructor(source, resoudre) {
    this.j = decouper(source);
    this.i = 0;
    this.resoudre = resoudre;
    this.references = new Set();
  }

  get courant() { return this.j[this.i]; }
  suivant() { return this.j[this.i++]; }
  accepter(t) { if (this.courant.t === t) { this.i++; return true; } return false; }
  attendre(t, quoi) {
    if (this.courant.t !== t) throw new ErreurFormule(`${quoi} attendu`, this.courant.p);
    return this.suivant();
  }

  formule() {
    const e = this.expression();
    if (this.courant.t !== 'fin') throw new ErreurFormule('Fin de formule attendue', this.courant.p);
    return e;
  }

  expression() {
    if (this.courant.t === 'SI' && this.j[this.i + 1]?.t !== '(') return this.siMot();
    return this.ou();
  }

  siMot(condition = null) {
    if (!condition) { this.attendre('SI', 'SI'); condition = this.expression(); }
    this.attendre('ALORS', 'ALORS');
    const alors = this.expression();
    const sinon = this.accepter('SINON') ? this.expression() : () => '';
    return (ctx) => (vrai(condition(ctx)) ? alors(ctx) : sinon(ctx));
  }

  ou() {
    let g = this.et();
    while (this.accepter('OU')) { const a = g, b = this.et(); g = (ctx) => vrai(a(ctx)) || vrai(b(ctx)); }
    return g;
  }

  et() {
    let g = this.non();
    while (this.accepter('ET')) { const a = g, b = this.non(); g = (ctx) => vrai(a(ctx)) && vrai(b(ctx)); }
    return g;
  }

  non() {
    if (this.accepter('NON')) { const a = this.non(); return (ctx) => !vrai(a(ctx)); }
    return this.comparaison();
  }

  comparaison() {
    const g = this.concat();
    const op = this.courant.t;
    if (!['=', '<>', '<', '<=', '>', '>='].includes(op)) return g;
    this.i++;
    const d = this.concat();
    const test = { '=': (c) => c === 0, '<>': (c) => c !== 0, '<': (c) => c < 0, '<=': (c) => c <= 0, '>': (c) => c > 0, '>=': (c) => c >= 0 }[op];
    return (ctx) => test(comparer(g(ctx), d(ctx)));
  }

  concat() {
    let g = this.addition();
    while (this.accepter('&')) { const a = g, b = this.addition(); g = (ctx) => versTexte(a(ctx)) + versTexte(b(ctx)); }
    return g;
  }

  addition() {
    let g = this.multiplication();
    for (;;) {
      if (this.accepter('+')) { const a = g, b = this.multiplication(); g = (ctx) => versNombre(a(ctx), '+').plus(versNombre(b(ctx), '+')); }
      else if (this.accepter('-')) { const a = g, b = this.multiplication(); g = (ctx) => versNombre(a(ctx), '-').minus(versNombre(b(ctx), '-')); }
      else return g;
    }
  }

  multiplication() {
    let g = this.unaire();
    for (;;) {
      if (this.accepter('*')) { const a = g, b = this.unaire(); g = (ctx) => versNombre(a(ctx), '*').times(versNombre(b(ctx), '*')); }
      else if (this.accepter('/')) {
        const a = g, b = this.unaire();
        g = (ctx) => {
          const d = versNombre(b(ctx), '/');
          if (d.isZero()) throw new ErreurFormule('Division par zéro');
          return versNombre(a(ctx), '/').div(d);
        };
      } else return g;
    }
  }

  unaire() {
    if (this.accepter('-')) { const a = this.unaire(); return (ctx) => versNombre(a(ctx), '-').neg(); }
    if (this.accepter('+')) return this.unaire();
    return this.primaire();
  }

  primaire() {
    const j = this.suivant();
    switch (j.t) {
      case 'nombre': return () => j.v;
      case 'texte': return () => j.v;
      case 'VRAI': return () => true;
      case 'FAUX': return () => false;
      case 'VIDE': return () => null;
      case 'ref': {
        const code = this.resoudre(j.v);
        if (code === null || code === undefined) throw new ErreurFormule(`Colonne inconnue [${j.v}]`, j.p);
        this.references.add(code);
        return (ctx) => ctx.valeur(code);
      }
      case '(': {
        const e = this.expression();
        this.attendre(')', 'Parenthèse fermante');
        return e;
      }
      case 'SI':
      case 'nom': {
        const fabrique = FONCTIONS[j.v];
        if (!fabrique) throw new ErreurFormule(`Fonction inconnue ${j.v}`, j.p);
        this.attendre('(', 'Parenthèse ouvrante');
        const args = [];
        if (!this.accepter(')')) {
          do args.push(this.expression()); while (this.accepter(';'));
          this.attendre(')', 'Parenthèse fermante');
        }
        // « SI (condition) ALORS … » : forme à mots-clés dont la condition est entre parenthèses.
        if (j.t === 'SI' && args.length === 1 && this.courant.t === 'ALORS') return this.siMot(args[0]);
        return fabrique(args);
      }
      default:
        throw new ErreurFormule(j.t === 'fin' ? 'Formule incomplète' : 'Expression attendue', j.p);
    }
  }
}

/**
 * Compile une formule. `resoudre(nom)` renvoie le code de la colonne désignée par [nom], ou null.
 * Renvoie { evaluer(ctx), references } ; ctx.valeur(code) fournit la valeur d'une colonne de la ligne.
 */
export function compilerFormule(source, resoudre) {
  const a = new Analyseur(String(source ?? ''), resoudre);
  const e = a.formule();
  return { evaluer: e, references: a.references };
}

/** Résolution par code puis par titre (sans casse ni accents, sauts de ligne ignorés). */
export function resolveurColonnes(colonnes) {
  const parCode = new Map(colonnes.map((c) => [normaliser(c.code), c.code]));
  const parTitre = new Map(colonnes.filter((c) => c.titre).map((c) => [normaliser(c.titre).replace(/\s+/g, ' ').trim(), c.code]));
  return (nom) => {
    const n = normaliser(nom).replace(/\s+/g, ' ').trim();
    return parCode.get(n) ?? parTitre.get(n) ?? null;
  };
}
