import { echapper } from '@logibtp/socle/ui';
import { champRattachement } from './selection.js';

// Filtre des listes par rattachement à la structure des affaires, sur un seul type à la fois. Listes de documents :
// barre « Projet | Affaire | Chantier | Marché » (choix du type) puis zone de code (double-clic ou F4 : liste de
// choix) ; filtre sur l'identifiant correspondant de la vue (projet_id…). Autres listes (chantiers d'une affaire,
// marchés d'un chantier…) : filtre sur la colonne de même nom (code), rappelé par une pastille.
// Adresse : /liste/<thème>?<type>=CODE (un seul type : projet, affaire, chantier ou marche ; raccourcis des fiches).

export const NIVEAUX = [
  { type: 'projet', colonne: 'projet_id', liste: 'projets', titre: 'Projet' },
  { type: 'affaire', colonne: 'affaire_id', liste: 'affaires', titre: 'Affaire' },
  { type: 'chantier', colonne: 'chantier_id', liste: 'chantiers', titre: 'Chantier' },
  { type: 'marche', colonne: 'marche_id', liste: 'marches', titre: 'Marché' },
];

export class FiltreRattachement {
  /**
   * conteneur : zone au-dessus de la liste ; liste : ListeDonnees (definirFiltreExterne) ; refs : référentiels de la
   * structure ; surChange(codes) : code retenu (adresse de la page).
   */
  constructor(conteneur, { liste, refs, surChange = () => {} }) {
    this.conteneur = conteneur;
    this.liste = liste;
    this.refs = refs;
    this.surChange = surChange;
    this.niveau = NIVEAUX[2]; // chantier par défaut
    this.id = null;
    this.colonneSimple = null;
    conteneur.classList.add('filtre-rattachement');
  }

  #element() { return this.id ? (this.refs[this.niveau.liste] ?? []).find((x) => x.id === this.id) ?? null : null; }

  /** Code retenu ({ chantier: 'CH-2026-001' }), pour l'adresse. */
  codes() {
    const x = this.#element();
    return x ? { [this.niveau.type]: x.code } : {};
  }

  /**
   * Filtres externes de la vue (option filtresVue de la liste), selon sa source : documents → identifiant du type
   * choisi (projet_id…) ; autre source ayant une colonne du type (affaire, projet, chantier) → cette colonne (code),
   * jamais le niveau de la liste elle-même. Toutes les colonnes gérées ici sont citées (null : filtre retiré).
   * codes : type et code voulus (adresse : le premier type présent), sinon le choix en cours.
   */
  filtresPour(source, colonnes, codes = null) {
    this.source = source;
    const voulu = codes && NIVEAUX.find((n) => codes[n.type]);
    if (voulu) {
      this.niveau = voulu;
      this.id = (this.refs[voulu.liste] ?? []).find((x) => x.code.toLowerCase() === String(codes[voulu.type]).toLowerCase())?.id ?? null;
    }
    const f = {};
    for (const n of NIVEAUX) { f[n.colonne] = null; f[n.type] = null; }
    this.colonneSimple = null;
    const x = this.#element();
    if (!x) return f;
    if (source === 'documents') f[this.niveau.colonne] = [String(x.id)];
    else if (colonnes.includes(this.niveau.type) && `${this.niveau.type}s` !== source) {
      f[this.niveau.type] = [x.code];
      this.colonneSimple = this.niveau.type;
    }
    return f;
  }

  rendre() {
    const c = this.conteneur;
    c.replaceChildren();
    if (this.source === 'documents') {
      c.hidden = false;
      c.innerHTML = `<span class="filtre-rattachement-titre" title="Documents rattachés au projet, à l'affaire, au chantier ou au marché choisi">Rattachement</span>
        <span class="filtre-types" role="radiogroup">${NIVEAUX.map((n) => `<button type="button" role="radio" data-type="${n.type}" aria-checked="${n === this.niveau}"
          class="${n === this.niveau ? 'actif' : ''}">${echapper(n.titre)}</button>`).join('')}</span>`;
      c.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
        const n = NIVEAUX.find((y) => y.type === b.dataset.type);
        if (n === this.niveau) return;
        const actif = !!this.id;
        this.niveau = n;
        this.id = null;
        if (actif) this.#appliquerDocuments();
        else this.rendre();
        c.querySelector('.rattachement-code')?.focus();
      }));
      c.append(champRattachement({ type: this.niveau.type, refs: this.refs, valeur: this.id, choisir: (id) => { this.id = id; this.#appliquerDocuments(); } }));
      if (this.id) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = '✕ Effacer';
        b.title = 'Retirer le filtre par rattachement';
        b.addEventListener('click', () => { this.id = null; this.#appliquerDocuments(); });
        c.append(b);
      }
      return;
    }
    const x = this.#element();
    c.hidden = !this.colonneSimple || !x;
    if (c.hidden) return;
    c.innerHTML = `<span class="filtre-rattachement-titre">Filtre</span><span class="pastille cochee">${echapper(`${this.niveau.titre} ${x.code}`)}</span>
      <button type="button" data-effacer title="Retirer le filtre">✕ Effacer</button>`;
    c.querySelector('[data-effacer]').addEventListener('click', () => {
      this.liste.definirFiltreExterne(this.colonneSimple, null, { recharger: false });
      this.colonneSimple = null;
      this.id = null;
      this.surChange({});
      this.rendre();
      this.liste.recharger();
    });
  }

  #appliquerDocuments() {
    for (const n of NIVEAUX) this.liste.definirFiltreExterne(n.colonne, n === this.niveau && this.id ? [String(this.id)] : null, { recharger: false });
    this.surChange(this.codes());
    this.rendre();
    this.liste.recharger();
    this.liste.rafraichirSegments?.().catch(() => {});
  }
}
