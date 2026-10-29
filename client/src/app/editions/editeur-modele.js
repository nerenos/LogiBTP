import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, Decoration, ViewPlugin, MatchDecorator,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, foldGutter, foldKeymap, foldService, indentUnit,
} from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { creerCombo, echapper, confirmer } from '@logibtp/socle/ui';
import { verifierModele } from '@logibtp/edition';
import { api } from '../api.js';
import { DictionnaireModele } from './dictionnaire-modele.js';

// ------------------------------------------------------------------ langage : JSON des modèles d'édition

// Clés dont la valeur désigne un autre modèle (Ctrl+clic : l'ouvrir dans un onglet).
const CLES_LIENS = new Set(['bloc', 'rapport']);
// Clés de structure mises en évidence (type de composant, bande, mode).
const CLES_STRUCTURE = new Set(['type', 'mode', 'genre']);

/**
 * Coloration du JSON des modèles : clés, chaînes, nombres, littéraux ; dans les chaînes, formules (`=…`) et gabarits
 * (`{{…}}`) distingués ; codes de blocs et de sous-rapports soulignés (liens).
 */
const jsonModele = StreamLanguage.define({
  name: 'json-modele',
  startState: () => ({ cle: null }),
  token(stream, etat) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === '"') {
      stream.next();
      let echappe = false;
      let texte = '';
      while (!stream.eol()) {
        const c = stream.next();
        if (echappe) { echappe = false; texte += c; continue; }
        if (c === '\\') { echappe = true; continue; }
        if (c === '"') break;
        texte += c;
      }
      // Clé : chaîne suivie de « : ».
      if (stream.match(/^\s*:/, false)) {
        etat.cle = texte;
        return CLES_STRUCTURE.has(texte) ? 'cleStructure' : 'cle';
      }
      const cle = etat.cle;
      etat.cle = null;
      if (cle && CLES_LIENS.has(cle)) return 'lien';
      if (cle && CLES_STRUCTURE.has(cle)) return 'valeurStructure';
      if (texte.startsWith('=')) return 'formule';
      if (texte.includes('{{')) return 'gabarit';
      return 'chaine';
    }
    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) { etat.cle = null; return 'nombre'; }
    if (stream.match(/^(true|false|null)\b/)) { etat.cle = null; return 'litteral'; }
    const c = stream.next();
    if (c === '{' || c === '}' || c === '[' || c === ']') return 'accolade';
    if (c === ',' || c === ':') return 'ponctuation';
    return null;
  },
  tokenTable: {
    cle: t.propertyName, cleStructure: t.keyword, valeurStructure: t.typeName, chaine: t.string, formule: t.special(t.string),
    gabarit: t.special(t.variableName), lien: t.link, nombre: t.number, litteral: t.bool, accolade: t.brace, ponctuation: t.punctuation,
  },
});

const coloration = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--code-fonction)' },
  { tag: t.keyword, color: 'var(--code-mot)', fontWeight: '600' },
  { tag: t.typeName, color: 'var(--code-type)', fontWeight: '600' },
  { tag: t.string, color: 'var(--code-chaine)' },
  { tag: t.special(t.string), color: 'var(--code-reference)' },
  { tag: t.special(t.variableName), color: 'var(--code-nombre)' },
  { tag: t.link, color: 'var(--code-type)', textDecoration: 'underline', cursor: 'pointer' },
  { tag: t.number, color: 'var(--code-nombre)' },
  { tag: t.bool, color: 'var(--code-mot)' },
  { tag: t.brace, color: 'var(--discret)' },
  { tag: t.punctuation, color: 'var(--discret)' },
]);

// {{…}} mis en relief à l'intérieur des chaînes (gabarits dans les libellés).
const decorGabarits = new MatchDecorator({ regexp: /\{\{[^}\n]*\}\}/g, decoration: Decoration.mark({ class: 'cm-gabarit-edition' }) });
const gabarits = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = decorGabarits.createDeco(view); }
  update(u) { this.decorations = decorGabarits.updateDeco(u, this.decorations); }
}, { decorations: (v) => v.decorations });

/** Pliage des objets et tableaux : de l'accolade ouvrante en fin de ligne à sa fermante (chaînes ignorées). */
const pliage = foldService.of((etat, debut, fin) => {
  const ligne = etat.doc.lineAt(debut).text.trimEnd();
  const ouvrant = ligne.at(-1);
  if (ouvrant !== '{' && ouvrant !== '[') return null;
  const texte = etat.doc.sliceString(fin, Math.min(etat.doc.length, fin + 400000));
  let niveau = 0;
  let chaine = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (chaine) { if (c === '\\') i++; else if (c === '"') chaine = false; continue; }
    if (c === '"') chaine = true;
    else if (c === '{' || c === '[') niveau++;
    else if (c === '}' || c === ']') {
      if (niveau === 0) return i > 0 ? { from: fin, to: fin + i } : null;
      niveau--;
    }
  }
  return null;
});

/** Erreur de syntaxe JSON soulignée à sa position (message du navigateur). */
const syntaxe = linter((view) => {
  const texte = view.state.doc.toString();
  try { JSON.parse(texte); return []; } catch (x) {
    const m = /position (\d+)/.exec(x.message) ?? null;
    let pos = m ? Number(m[1]) : null;
    if (pos === null) {
      const lc = /line (\d+) column (\d+)/.exec(x.message);
      pos = lc ? view.state.doc.line(Math.min(Number(lc[1]), view.state.doc.lines)).from + Number(lc[2]) - 1 : texte.length;
    }
    pos = Math.max(0, Math.min(pos, texte.length));
    return [{ from: pos, to: Math.min(texte.length, pos + 1), severity: 'error', message: x.message }];
  }
}, { delay: 400 });

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'inherit', fontSize: '12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, Consolas, monospace', lineHeight: '1.45' },
  '.cm-content': { caretColor: 'var(--texte)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--texte) !important', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--titre-fond)', color: 'var(--discret)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' },
  '.cm-gabarit-edition': { backgroundColor: 'color-mix(in srgb, var(--code-nombre) 15%, transparent)', borderRadius: '2px' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--bord)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--titre-fond)', border: '1px solid var(--bord)', color: 'var(--discret)' },
});

/** Code désigné par un lien sous la position (valeur d'une clé « bloc » ou « rapport »), sinon null. */
function lienA(etat, pos) {
  const ligne = etat.doc.lineAt(pos);
  const re = /"(bloc|rapport)"\s*:\s*"([^"\\]+)"/g;
  for (let m = re.exec(ligne.text); m; m = re.exec(ligne.text)) {
    const debut = ligne.from + m.index + m[0].lastIndexOf('"', m[0].length - 2);
    if (pos >= debut && pos <= ligne.from + m.index + m[0].length) return m[2];
  }
  return null;
}

// ------------------------------------------------------------------ éditeur

/**
 * Éditeur du modèle dans l'aperçu (administrateur, bouton ✎ Modèle) : JSON du rapport, de ses blocs liés et de ses
 * sous-rapports, un onglet par élément ouvert (Ctrl+clic sur le code d'un bloc ou d'un sous-rapport : l'ouvre), sur les
 * données et paramètres de l'aperçu en cours. « Appliquer » remplace le contenu en mémoire et relance la mise en page
 * (rien n'est enregistré) ; « Vérifier » fait contrôler le modèle par le moteur du serveur ; « Enregistrer » écrit le
 * modèle (nouvelle version, impacts des blocs signalés). En attendant le concepteur (lot 7).
 */
export class EditeurModeleApercu {
  /**
   * @param conteneur élément du panneau
   * @param page PageEdition (prep, rendre(), basculerEditeur(false))
   */
  constructor(conteneur, page) {
    this.conteneur = conteneur;
    this.page = page;
    this.origines = new Map(); // code → contenu d'origine (JSON) pour « Rétablir » et l'état modifié
    this.etats = new Map();    // code → EditorState (texte, historique, plis, curseur de l'onglet)
    this.onglets = [];         // codes ouverts, dans l'ordre
    this.courant = null;
    this.vue = null;
  }

  /** Éléments modifiables : le rapport, ses blocs, ses sous-rapports (fermeture fournie par le serveur). */
  elements() {
    const p = this.page.prep;
    return [
      { code: p.modele.code, libelle: `Rapport ${p.modele.code}`, genre: 'RAPPORT', icone: '📄', lire: () => p.modele.contenu, ecrire: (c) => { p.modele.contenu = c; } },
      ...Object.keys(p.rapports ?? {}).sort().map((code) => ({ code, libelle: `Sous-rapport ${code}`, genre: 'RAPPORT', icone: '📑', lire: () => p.rapports[code], ecrire: (c) => { p.rapports[code] = c; } })),
      ...Object.keys(p.blocs ?? {}).sort().map((code) => ({ code, libelle: `Bloc ${code}`, genre: 'BLOC', icone: '🧩', lire: () => p.blocs[code], ecrire: (c) => { p.blocs[code] = c; } })),
    ];
  }

  element(code = this.courant) { return this.elements().find((e) => e.code === code); }

  /** Construit le panneau (après chaque préparation : un autre modèle peut avoir été choisi). */
  construire() {
    const elements = this.elements();
    const codes = new Set(elements.map((e) => e.code));
    // Autre modèle : onglets et états repartent de zéro.
    if (this.onglets.some((c) => !codes.has(c))) { this.onglets = []; this.etats.clear(); this.origines.clear(); }
    for (const e of elements) if (!this.origines.has(e.code)) this.origines.set(e.code, JSON.stringify(e.lire()));
    if (!this.onglets.length) this.onglets = [elements[0].code];
    if (!this.onglets.includes(this.courant)) this.courant = this.onglets[0];
    if (this.vue && this.courant && this.etats.has(this.courant)) this.etats.set(this.courant, this.vue.state);
    this.vue?.destroy();
    this.conteneur.innerHTML = `
      <div class="edition-editeur-barre">
        <strong>✎ Modèle</strong>
        <span class="edition-editeur-ouvrir" title="Ouvrir un bloc ou un sous-rapport du modèle dans un onglet (ou Ctrl+clic sur son code)" data-combo="ouvrir"></span>
        <span class="edition-editeur-espace"></span>
        <button type="button" class="bouton-icone${this.dictionnaireVisible ? ' actif' : ''}" data-action="dictionnaire" title="Dictionnaire — données de la source, paramètres, fonctions, formats, charte : un clic insère l'entrée au curseur" aria-label="Dictionnaire">📖</button>
        <button type="button" class="bouton-icone" data-action="masquer" title="Masquer l'éditeur — les modifications appliquées restent dans l'aperçu" aria-label="Masquer l'éditeur">✕</button>
      </div>
      <div class="edition-editeur-onglets" role="tablist" data-zone="onglets"></div>
      <div class="edition-editeur-code" data-zone="code"></div>
      <div class="edition-dictionnaire" data-zone="dictionnaire" ${this.dictionnaireVisible ? '' : 'hidden'}></div>
      <div class="edition-editeur-actions">
        <button data-action="appliquer" class="principal" title="Remplacer le contenu en mémoire et refaire l'aperçu (Ctrl+Entrée) ; rien n'est enregistré">▶ Appliquer</button>
        <button data-action="verifier" title="Contrôle du modèle par le moteur du serveur (formules, format)">✔ Vérifier</button>
        <button data-action="enregistrer" title="Enregistrer ce modèle en base (nouvelle version)">💾 Enregistrer</button>
        <button data-action="retablir" title="Revenir au contenu lu à l'ouverture">↺ Rétablir</button>
      </div>
      <div class="edition-editeur-message" data-zone="message"></div>
      <p class="aide">Ctrl+clic sur le code d'un bloc ou d'un sous-rapport : l'ouvre dans un onglet. Données de l'aperçu :
        <code>${echapper(Object.keys(this.page.prep.donnees ?? {}).join(', '))}</code></p>`;
    const ouvrir = creerCombo({ options: elements.map((e) => ({ valeur: e.code, libelle: `${e.icone} ${e.libelle}` })), valeur: '', vide: false });
    ouvrir.placeholder = 'Ouvrir un bloc ou un sous-rapport…';
    ouvrir.addEventListener('change', () => { if (ouvrir.valeurCombo) this.ouvrirOnglet(ouvrir.valeurCombo); ouvrir.definirValeur(''); });
    this.conteneur.querySelector('[data-combo="ouvrir"]').replaceChildren(ouvrir);
    this.conteneur.querySelector('[data-action="masquer"]').addEventListener('click', () => this.page.basculerEditeur(false));
    this.conteneur.querySelector('[data-action="dictionnaire"]').addEventListener('click', () => this.basculerDictionnaire());
    this.dictionnaire = new DictionnaireModele(this.conteneur.querySelector('[data-zone="dictionnaire"]'), this);
    if (this.dictionnaireVisible) this.dictionnaire.charger().catch((x) => this.message(echapper(x.message), 'erreur'));
    this.conteneur.querySelector('.edition-editeur-actions').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const action = { appliquer: () => this.appliquer(), verifier: () => this.verifier(), enregistrer: () => this.enregistrer(), retablir: () => this.retablir() }[b.dataset.action];
      Promise.resolve(action?.()).catch((x) => this.message(echapper(x.message), 'erreur'));
    });
    this.vue = new EditorView({ parent: this.conteneur.querySelector('[data-zone="code"]'), state: this.etat(this.courant) });
    this.rendreOnglets();
  }

  /** État CodeMirror d'un onglet (créé à la première ouverture : texte du contenu en mémoire). */
  etat(code) {
    let s = this.etats.get(code);
    if (!s) {
      s = this.creerEtat(JSON.stringify(this.element(code)?.lire() ?? {}, null, 2));
      this.etats.set(code, s);
    }
    return s;
  }

  creerEtat(texte) {
    return EditorState.create({
      doc: texte,
      extensions: [
        lineNumbers(), foldGutter(), lintGutter(), history(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(),
        bracketMatching(), indentUnit.of('  '), EditorState.tabSize.of(2), jsonModele, syntaxHighlighting(coloration), gabarits, pliage, syntaxe, theme,
        keymap.of([
          { key: 'Mod-Enter', run: () => { this.appliquer().catch((x) => this.message(echapper(x.message), 'erreur')); return true; } },
          ...foldKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab,
        ]),
        EditorView.domEventHandlers({
          mousedown: (e, view) => {
            if (!(e.ctrlKey || e.metaKey)) return false;
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            const code = pos === null ? null : lienA(view.state, pos);
            if (!code) return false;
            e.preventDefault();
            if (this.element(code)) this.ouvrirOnglet(code);
            else this.message(`${echapper(code)} n'est pas inclus dans ce modèle (enregistrez puis actualisez)`, 'avertissement');
            return true;
          },
        }),
        EditorView.updateListener.of((u) => { if (u.docChanged) this.rendreOnglets(); }),
      ],
    });
  }

  /** Affiche ou masque le dictionnaire sous l'éditeur (chargé à la première ouverture). */
  basculerDictionnaire(visible = !this.dictionnaireVisible) {
    this.dictionnaireVisible = visible;
    this.conteneur.querySelector('[data-zone="dictionnaire"]').hidden = !visible;
    this.conteneur.querySelector('[data-action="dictionnaire"]').classList.toggle('actif', visible);
    if (visible) this.dictionnaire.charger().catch((x) => this.message(echapper(x.message), 'erreur'));
  }

  /** Insère un texte à la place de la sélection de l'éditeur ; `recul` : curseur ramené de n caractères (entre parenthèses). */
  inserer(texte, recul = 0) {
    const { from, to } = this.vue.state.selection.main;
    this.vue.dispatch({ changes: { from, to, insert: texte }, selection: { anchor: from + texte.length - recul }, scrollIntoView: true });
    this.vue.focus();
  }

  /** Mémorise l'onglet courant et affiche un autre (ouvert s'il ne l'est pas). */
  ouvrirOnglet(code) {
    if (!this.element(code)) return;
    if (this.courant && this.vue) this.etats.set(this.courant, this.vue.state);
    if (!this.onglets.includes(code)) this.onglets.push(code);
    this.courant = code;
    this.vue.setState(this.etat(code));
    this.rendreOnglets();
    this.message('');
    this.vue.focus();
  }

  async fermerOnglet(code) {
    if (this.onglets.length <= 1) return;
    const texte = (code === this.courant ? this.vue.state : this.etats.get(code))?.doc.toString();
    if (texte !== undefined && this.saisieModifiee(code, texte) && !(await confirmer(`${code} : abandonner la saisie non appliquée ?`))) return;
    const i = this.onglets.indexOf(code);
    this.onglets.splice(i, 1);
    this.etats.delete(code);
    if (code === this.courant) {
      this.courant = null;
      this.ouvrirOnglet(this.onglets[Math.max(0, i - 1)]);
    } else this.rendreOnglets();
  }

  /** Saisie de l'onglet différente du contenu en mémoire (non appliquée). */
  saisieModifiee(code, texte) {
    try { return JSON.stringify(JSON.parse(texte)) !== JSON.stringify(this.element(code)?.lire()); } catch { return true; }
  }

  rendreOnglets() {
    const zone = this.conteneur.querySelector('[data-zone="onglets"]');
    if (!zone) return;
    zone.innerHTML = this.onglets.map((code) => {
      const e = this.element(code);
      const texte = (code === this.courant ? this.vue?.state : this.etats.get(code))?.doc.toString();
      const saisie = texte !== undefined && this.saisieModifiee(code, texte);
      const applique = JSON.stringify(e?.lire()) !== this.origines.get(code);
      const etat = saisie ? ' ✎' : applique ? ' ●' : '';
      const bulle = `${e?.libelle ?? code}${saisie ? ' — saisie non appliquée' : applique ? ' — modifié, appliqué à l’aperçu, non enregistré' : ''}`;
      return `<span class="edition-onglet${code === this.courant ? ' actif' : ''}" role="tab" aria-selected="${code === this.courant}" data-onglet="${echapper(code)}" title="${echapper(bulle)}">
        ${e?.icone ?? ''} ${echapper(code)}<b>${etat}</b>${this.onglets.length > 1 ? `<button type="button" class="bouton-icone" data-fermer="${echapper(code)}" title="Fermer l'onglet" aria-label="Fermer l'onglet">×</button>` : ''}</span>`;
    }).join('');
    zone.querySelectorAll('[data-onglet]').forEach((o) => o.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-fermer]')) { this.fermerOnglet(ev.target.closest('[data-fermer]').dataset.fermer); return; }
      if (o.dataset.onglet !== this.courant) this.ouvrirOnglet(o.dataset.onglet);
    }));
  }

  message(texte, genre = 'info') {
    const z = this.conteneur.querySelector('[data-zone="message"]');
    if (!z) return;
    z.className = `edition-editeur-message ${genre}`;
    z.innerHTML = texte;
  }

  /** Contenu saisi (JSON) de l'onglet courant. */
  lire() {
    try {
      return JSON.parse(this.vue.state.doc.toString());
    } catch (x) {
      throw new Error(`JSON invalide : ${x.message}`);
    }
  }

  /** Contrôle local (moteur du navigateur) : liste des erreurs, vide si le modèle est correct. */
  static erreurs(contenu) {
    const r = verifierModele(contenu);
    return Array.isArray(r) ? r : (r?.erreurs ?? []);
  }

  async appliquer() {
    const contenu = this.lire();
    const e = this.element();
    const erreurs = EditeurModeleApercu.erreurs(contenu);
    e.ecrire(contenu);
    this.rendreOnglets();
    await this.page.rendre();
    this.message(erreurs.length ? `⚠ Appliqué avec ${erreurs.length} erreur(s) :${liste(erreurs)}` : `Appliqué (aperçu refait en ${this.page.$('[data-zone="pages"]').dataset.duree} ms) : non enregistré`, erreurs.length ? 'avertissement' : 'succes');
  }

  async verifier() {
    const r = await api.editions.verifier(this.lire());
    const erreurs = Array.isArray(r) ? r : (r?.erreurs ?? []);
    this.message(erreurs.length ? `⛔ ${erreurs.length} erreur(s) :${liste(erreurs)}` : '✔ Modèle correct (contrôle du serveur)', erreurs.length ? 'erreur' : 'succes');
  }

  async enregistrer() {
    const contenu = this.lire();
    const e = this.element();
    const m = await api.editions.modele(e.code);
    const impacts = e.code !== this.page.prep.modele.code ? await api.editions.impacts(e.code).catch(() => []) : [];
    const avis = impacts.length ? `\n\nUtilisé aussi par : ${impacts.map((x) => x.libelle ?? x.code).join(', ')}.` : '';
    if (m.fourni && !(await confirmer(`${e.code} est un modèle fourni : l'enregistrer le marque modifié localement.${avis}\n\nEnregistrer ?`))) return;
    if (!m.fourni && avis && !(await confirmer(`Enregistrer ${e.code} ?${avis}`))) return;
    const r = await api.editions.enregistrerModele(e.code, {
      libelle: contenu.libelle ?? m.libelle, genre: m.genre, cible: m.cible, source: m.source, types: m.types, contenu,
      niveau_acces: m.niveau_acces, acces_profils: m.acces_profils, charte: m.charte, actif: m.actif, ordre: m.ordre,
    });
    e.ecrire(contenu);
    this.origines.set(e.code, JSON.stringify(contenu));
    this.rendreOnglets();
    await this.page.rendre();
    this.message(`💾 ${echapper(e.code)} enregistré${r?.version ? ` (version ${r.version})` : ''}`, 'succes');
  }

  async retablir() {
    const e = this.element();
    const origine = this.origines.get(e.code);
    if (!origine) return;
    e.ecrire(JSON.parse(origine));
    const s = this.creerEtat(JSON.stringify(JSON.parse(origine), null, 2));
    this.etats.set(e.code, s);
    this.vue.setState(s);
    this.rendreOnglets();
    await this.page.rendre();
    this.message('Contenu d’origine rétabli', 'info');
  }

  detruire() { this.vue?.destroy(); this.vue = null; }
}

const liste = (erreurs) => `<ul>${erreurs.map((x) => `<li>${echapper(typeof x === 'string' ? x : `${x.chemin ?? x.code ?? ''} ${x.message ?? JSON.stringify(x)}`)}</li>`).join('')}</ul>`;
