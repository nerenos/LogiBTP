import { EditorState, Prec } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import {
  StreamLanguage, HighlightStyle, syntaxHighlighting, indentOnInput, indentUnit, indentService, bracketMatching,
} from '@codemirror/language';
import { autocompletion, completionKeymap, snippet, snippetCompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { linter, lintGutter, lintKeymap, forceLinting } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { normaliser, MOTS_CLES } from '../src/script/lexeur.js';
import { analyserScript } from '../src/script/analyseur.js';
import { FONCTIONS } from '../src/script/fonctions.js';

// Éditeur de code des scripts de métré (CodeMirror 6) : coloration, indentation des blocs (Si / Sinon / Pour / Fin),
// complétion (mots-clés, types, fonctions, variables déclarées, variables et données de l'hôte après {{ @ $),
// structures à compléter (Tab : champ suivant), erreurs soulignées avec marque dans la marge.

const TYPES = ['numérique', 'chaîne', 'booléen'];
const MOTS = ['Si', 'alors', 'Sinon', 'SinonSi', 'Fin', 'Pour', 'à', 'pas', 'Renvoyer', 'Sortir', 'Continuer', 'et', 'ou', 'modulo', 'Vrai', 'Faux', 'local', 'est un', 'est une'];
const OUVRANTS = new Set(['si', 'pour']);
const FERMANTS = /^\s*(fin|sinon|sinonsi)\b/i;
const OUVRE_BLOC = /^\s*(si|sinon|sinonsi|pour)\b/i;

/** Structures du langage insérées comme modèles à compléter (Tab : champ suivant). */
export const STRUCTURES = [
  { libelle: 'Si … alors … Fin', modele: 'Si ${condition} alors\n\t${}\nFin' },
  { libelle: 'Si … alors … Sinon … Fin', modele: 'Si ${condition} alors\n\t${}\nSinon\n\t${}\nFin' },
  { libelle: 'SinonSi … alors', modele: 'SinonSi ${condition} alors\n\t${}' },
  { libelle: 'Pour … à … Fin', modele: 'Pour ${i} = ${début} à ${fin}\n\t${}\nFin' },
  { libelle: 'Pour … à … pas … Fin', modele: 'Pour ${i} = ${début} à ${fin} pas ${pas}\n\t${}\nFin' },
  { libelle: 'Sortir de la boucle', modele: 'Sortir' },
  { libelle: 'Tour suivant de la boucle', modele: 'Continuer' },
  { libelle: 'Déclaration numérique', modele: '${Nom} est un numérique = ${valeur}' },
  { libelle: 'Déclaration chaîne', modele: '${Nom} est une chaîne = "${texte}"' },
  { libelle: 'Déclaration booléen', modele: '${Nom} est un booléen = ${Vrai}' },
  { libelle: 'Variable locale', modele: 'local ${Nom} est un numérique = ${valeur}' },
  { libelle: 'Renvoyer la quantité', modele: 'Renvoyer ${quantité}' },
  { libelle: 'Commentaire', modele: '// ${}' },
];

/** Modèle d'appel d'une fonction depuis sa signature : Arrondi(x; décimales) → Arrondi(${x}; ${décimales}). */
export function modeleFonction(f) {
  const m = /^([^(]+)\((.*)\)$/.exec(f.signature);
  if (!m) return f.signature;
  const args = m[2].split(';').map((a) => a.trim()).filter((a) => a && a !== '…');
  return `${m[1]}(${args.map((a) => `\${${a}}`).join('; ')})`;
}

// ------------------------------------------------------------------ langage (coloration, indentation)

const langage = StreamLanguage.define({
  name: 'metre',
  startState: () => ({ profondeur: 0, precedent: null }),
  copyState: (s) => ({ ...s }),
  token(stream, s) {
    if (stream.sol()) s.precedent = null;
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'commentaire'; }
    if (stream.match(/^\{\{[^}]*(\}\})?/)) return 'reference';
    if (stream.match(/^(\$\$|\$|@@|@)[\p{L}_][\p{L}\p{N}_]*/u)) return 'reference';
    if (stream.match(/^\d+([.,]\d+)?/)) return 'nombre';
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol()) {
        if (stream.next() === '"') {
          if (stream.peek() === '"') { stream.next(); continue; }
          break;
        }
      }
      return 'chaine';
    }
    if (stream.match(/^[\p{L}_][\p{L}\p{N}_]*/u)) {
      const n = normaliser(stream.current());
      if (n === 'vrai' || n === 'faux') return 'booleen';
      if (MOTS_CLES.has(n)) {
        if (OUVRANTS.has(n) && !(n === 'si' && s.precedent === 'sinon')) s.profondeur++;
        if (n === 'fin') s.profondeur = Math.max(0, s.profondeur - 1);
        s.precedent = n;
        return 'motCle';
      }
      s.precedent = n;
      if (n === 'chaine' || n === 'numerique' || n === 'booleen' || n === 'bool') return 'type';
      if (n === 'est' || n === 'un' || n === 'une' || n === 'a') return 'motCle';
      if (FONCTIONS[n] && stream.peek() === '(') return 'fonction';
      return 'variable';
    }
    if (stream.match(/^(<>|<=|>=|\+=|-=|\*=|\/=|\+\+|--|[+\-*/=<>×÷−≤≥≠;()])/)) return 'operateur';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '//' }, indentOnInput: /^\s*(fin|sinon|sinonsi)$/i },
  tokenTable: {
    commentaire: t.lineComment, reference: t.special(t.variableName), nombre: t.number, chaine: t.string, booleen: t.bool,
    motCle: t.keyword, type: t.typeName, fonction: t.function(t.variableName), variable: t.variableName, operateur: t.operator,
  },
});

const RE_SI_POUR = /^\s*(si|pour)\b/i;
const RE_FIN = /^\s*fin\b/i;
const RE_SINON = /^\s*(sinon|sinonsi)\b/i;

/**
 * Indentation d'une nouvelle ligne : celle de la ligne précédente non vide (les tabulations sont conservées, y compris
 * dans une expression sur plusieurs lignes), un cran de plus après Si / Sinon / SinonSi / Pour ; Fin, Sinon et SinonSi
 * s'alignent sur le Si ou le Pour qu'ils ferment.
 */
const indentation = Prec.high(indentService.of((cx, pos) => {
  // Lignes lues par le contexte : il tient compte du saut de ligne simulé (Entrée).
  const precedentes = function* () {
    for (let p = cx.lineAt(pos, 1).from - 1; p >= 0;) {
      const l = cx.lineAt(p, -1);
      yield l;
      p = l.from - 1;
    }
  };
  if (FERMANTS.test(cx.textAfterPos(pos))) {
    let niveau = 0;
    for (const l of precedentes()) {
      if (RE_FIN.test(l.text)) niveau++;
      else if (RE_SINON.test(l.text) && niveau === 0) return cx.lineIndent(l.from, -1);
      else if (RE_SI_POUR.test(l.text) && !RE_SINON.test(l.text)) {
        if (niveau === 0) return cx.lineIndent(l.from, -1);
        niveau--;
      }
    }
    return 0;
  }
  for (const l of precedentes()) {
    if (!l.text.trim()) continue;
    const colonne = cx.lineIndent(l.from, -1);
    return OUVRE_BLOC.test(l.text.replace(/\/\/.*$/, '')) ? colonne + cx.unit : colonne;
  }
  return 0;
}));

const coloration = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-mot)', fontWeight: '600' },
  { tag: t.typeName, color: 'var(--code-type)' },
  { tag: t.lineComment, color: 'var(--code-commentaire)', fontStyle: 'italic' },
  { tag: t.number, color: 'var(--code-nombre)' },
  { tag: t.bool, color: 'var(--code-nombre)', fontWeight: '600' },
  { tag: t.string, color: 'var(--code-chaine)' },
  { tag: t.special(t.variableName), color: 'var(--code-reference)' },
  { tag: t.function(t.variableName), color: 'var(--code-fonction)' },
  { tag: t.operator, color: 'var(--code-operateur)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'inherit', border: '1px solid var(--bord)', borderRadius: '4px', fontSize: '0.9rem' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-1px' },
  '.cm-content': { fontFamily: 'ui-monospace, Consolas, monospace', caretColor: 'var(--texte)' },
  // Curseur dessiné par CodeMirror : couleur du texte du thème (visible en clair et en sombre).
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--texte) !important', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--titre-fond)', color: 'var(--discret)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--bord)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent-clair)', color: 'inherit' },
  '.cm-completionDetail': { color: 'var(--discret)', fontStyle: 'normal', marginLeft: '0.6em' },
});

// ------------------------------------------------------------------ complétion

const RE_REFERENCE = /(\{\{[^}\n]*|\$\$?[\p{L}\p{N}_]*|@@?[\p{L}\p{N}_]*)$/u;
const RE_MOT = /[\p{L}_][\p{L}\p{N}_]*$/u;

function completion(source) {
  return (cx) => {
    const ligne = cx.state.doc.lineAt(cx.pos);
    const avant = ligne.text.slice(0, cx.pos - ligne.from);
    if (avant.includes('//') || (avant.split('"').length - 1) % 2 === 1) return null;
    const ref = RE_REFERENCE.exec(avant);
    if (ref) {
      const from = cx.pos - ref[0].length;
      const accolades = ref[0].startsWith('{{');
      const options = source.dictionnaire()
        .filter((e) => accolades || /^\{\{(\$|@)/.test(e.valeur))
        .map((e) => ({
          label: accolades ? e.valeur : e.valeur.slice(2, -2),
          detail: e.detail === null || e.detail === undefined || e.detail === '' ? '' : String(e.detail),
          info: e.libelle, type: 'variable',
        }));
      return { from, options, validFor: /^[{$@\p{L}\p{N}_.[\]]*\}?\}?$/u };
    }
    const mot = cx.matchBefore(RE_MOT);
    if (!mot || (mot.from === mot.to && !cx.explicit)) return null;
    const apresEst = /\best\s+une?\s+[\p{L}]*$/iu.test(avant);
    const declarations = analyserScript(cx.state.doc.toString()).declarations;
    const fonctions = { ...FONCTIONS, ...source.fonctions?.() };
    const options = [
      ...TYPES.map((x) => ({ label: x, type: 'type', boost: apresEst ? 50 : -10 })),
      ...(apresEst ? [] : [
        ...MOTS.map((x) => ({ label: x, type: 'keyword' })),
        ...declarations.map((d) => ({
          label: d.nom, type: 'variable', detail: `${{ N: 'numérique', C: 'chaîne', B: 'booléen' }[d.type]}${d.local ? ' · locale' : ''}`, boost: 20,
        })),
        ...Object.values(fonctions).map((f) => snippetCompletion(modeleFonction(f), {
          label: f.signature.split('(')[0], detail: f.signature, info: f.description, type: 'function', boost: 10,
        })),
        ...STRUCTURES.map((s) => snippetCompletion(s.modele, { label: s.libelle, type: 'text', boost: -20 })),
      ]),
    ];
    return { from: mot.from, options, validFor: /^[\p{L}\p{N}_]*$/u };
  };
}

// ------------------------------------------------------------------ erreurs

/** Diagnostics CodeMirror depuis des erreurs positionnées { code, message, ligne, colonne } du langage. */
function diagnosticsDe(doc, liste, gravite) {
  return liste.map((e) => {
    if (!e.ligne) return { from: doc.length, to: doc.length, severity: gravite, message: e.message, source: e.code };
    const l = doc.line(Math.min(Math.max(e.ligne, 1), doc.lines));
    const from = Math.min(l.from + Math.max(0, (e.colonne ?? 1) - 1), l.to);
    const mot = /^[\p{L}\p{N}_{}$@.]+/u.exec(l.text.slice(from - l.from));
    const to = Math.min(from + (mot ? mot[0].length : 1), l.to);
    return { from: to > from ? from : Math.max(l.from, from - 1), to: to > from ? to : from, severity: gravite, message: e.message, source: e.code };
  });
}

// ------------------------------------------------------------------ éditeur

/**
 * Éditeur d'un script de métré.
 * options : texte, surChangement(texte) (après chaque modification), surEchap(), dictionnaire() → entrées
 * [{ valeur: '{{ref}}', libelle, detail }], fonctions() → fonctions de l'hôte, diagnostics(texte) → { erreurs,
 * avertissements } d'exécution du texte (positionnés ; le texte analysé localement donne les erreurs d'analyse).
 */
export class EditeurScript {
  constructor(conteneur, { texte = '', surChangement, surEchap, dictionnaire = () => [], fonctions, diagnostics = () => null } = {}) {
    this.surChangement = surChangement;
    this.externe = false;
    const lint = linter((vue) => {
      const doc = vue.state.doc;
      const texteDoc = doc.toString();
      const analyse = analyserScript(texteDoc, { fonctions: fonctions?.() });
      if (analyse.erreurs.length) return diagnosticsDe(doc, analyse.erreurs, 'error');
      const d = diagnostics(texteDoc);
      return d ? [...diagnosticsDe(doc, d.erreurs ?? [], 'error'), ...diagnosticsDe(doc, d.avertissements ?? [], 'warning')] : [];
    }, { delay: 250 });
    this.vue = new EditorView({
      parent: conteneur,
      state: EditorState.create({
        doc: texte,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), bracketMatching(), closeBrackets(),
          indentOnInput(), indentUnit.of('\t'), EditorState.tabSize.of(4),
          langage, indentation, syntaxHighlighting(coloration), theme, EditorView.lineWrapping,
          autocompletion({ override: [completion({ dictionnaire, fonctions })], activateOnTyping: true }),
          lint, lintGutter(),
          placeholder('Déclarations en tête, instructions, puis « Renvoyer » la quantité…'),
          keymap.of([
            ...closeBracketsKeymap, ...completionKeymap, ...lintKeymap,
            { key: 'Escape', run: () => { surEchap?.(); return Boolean(surEchap); } },
            { key: 'Mod-/', run: toggleComment },
            indentWithTab, ...defaultKeymap, ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !this.externe) this.surChangement?.(u.state.doc.toString());
          }),
        ],
      }),
    });
  }

  get valeur() { return this.vue.state.doc.toString(); }

  get aLeFocus() { return this.vue.hasFocus; }

  /**
   * Remplace le texte (modification venue de l'extérieur : annulation de l'hôte, grille des variables…). Seule la
   * partie différente est remplacée : le curseur et la sélection suivent.
   */
  remplacer(texte) {
    const actuel = this.valeur;
    if (texte === actuel) return;
    let debut = 0;
    while (debut < actuel.length && debut < texte.length && actuel[debut] === texte[debut]) debut++;
    let finActuel = actuel.length;
    let finTexte = texte.length;
    while (finActuel > debut && finTexte > debut && actuel[finActuel - 1] === texte[finTexte - 1]) { finActuel--; finTexte--; }
    this.externe = true;
    try {
      this.vue.dispatch({ changes: { from: debut, to: finActuel, insert: texte.slice(debut, finTexte) } });
    } finally {
      this.externe = false;
    }
  }

  /** Insère un texte (référence du dictionnaire) à la place de la sélection. */
  inserer(texte) {
    const { from, to } = this.vue.state.selection.main;
    this.vue.dispatch({ changes: { from, to, insert: texte }, selection: { anchor: from + texte.length }, scrollIntoView: true });
    this.vue.focus();
  }

  /** Insère un modèle à compléter (structure, appel de fonction) : Tab passe au champ suivant. */
  insererModele(modele) {
    const { from, to } = this.vue.state.selection.main;
    snippet(modele)(this.vue, null, from, to);
    this.vue.focus();
  }

  /** Place le curseur (ligne et colonne à partir de 1). */
  allerA(ligne, colonne = 1) {
    const doc = this.vue.state.doc;
    const l = doc.line(Math.min(Math.max(ligne, 1), doc.lines));
    const pos = Math.min(l.from + Math.max(0, colonne - 1), l.to);
    this.vue.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    this.vue.focus();
  }

  focus() { this.vue.focus(); }

  /** Relance le contrôle (résultat d'exécution arrivé après le recalcul de l'hôte). */
  rafraichirDiagnostics() { forceLinting(this.vue); }

  detruire() { this.vue.destroy(); }
}
