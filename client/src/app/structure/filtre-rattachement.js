import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { TYPE_FICHE } from '../codes.js';
import { echapper } from '@logibtp/socle/ui';
import { champRattachement } from './selection.js';

// Filtre des listes par rattachement à la structure des affaires, sur un seul type à la fois. Listes de documents :
// barre « Projet | Affaire | Chantier | Marché » (choix du type) puis zone de code (double-clic ou F4 : liste de
// choix) ; filtre sur l'identifiant correspondant de la vue (projet_id…). Autres listes (chantiers d'une affaire,
// marchés d'un chantier…) : filtre sur la colonne de même nom (code), rappelé par une pastille.
// Adresse : /liste/<thème>?<type>=CODE (un seul type : projet, affaire, chantier ou marche ; raccourcis des fiches).

export const NIVEAUX = [
  { type: TYPE_FICHE.PROJET, colonne: 'projet_id', liste: 'projets', get titre() { return texte('structure_btp.niveaux.projet'); } },
  { type: TYPE_FICHE.AFFAIRE, colonne: 'affaire_id', liste: 'affaires', get titre() { return texte('structure_btp.niveaux.affaire'); } },
  // Documents : chantier de l'entête, sinon des lignes d'achat et des documents sources (colonne chantiers, db/248).
  { type: TYPE_FICHE.CHANTIER, colonne: 'chantier_id', colonneDocuments: 'chantiers', liste: 'chantiers', get titre() { return texte('structure_btp.niveaux.chantier'); } },
  { type: TYPE_FICHE.MARCHE, colonne: 'marche_id', liste: 'marches', get titre() { return texte('structure_btp.niveaux.marche'); } },
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
   * choisi (projet_id…) ; autre source ayant la colonne d'identifiant (ordres : chantiers, projet_id…) → cet identifiant ;
   * sinon source ayant une colonne du type (affaire, projet, chantier) → cette colonne (code),
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
    for (const n of NIVEAUX) { f[n.colonne] = null; f[n.type] = null; if (n.colonneDocuments) f[n.colonneDocuments] = null; }
    this.colonneSimple = null;
    const x = this.#element();
    if (!x) return f;
    // Vues dérivées de v_liste_documents (ordres…) : colonne d'identifiant, la colonne de même nom portant « code – libellé ».
    const colonneId = [this.niveau.colonneDocuments, this.niveau.colonne].find((c) => c && colonnes.includes(c));
    if (source === 'documents') f[this.niveau.colonneDocuments ?? this.niveau.colonne] = [String(x.id)];
    else if (colonneId && `${this.niveau.type}s` !== source) {
      f[colonneId] = [String(x.id)];
      this.colonneSimple = colonneId;
    } else if (colonnes.includes(this.niveau.type) && `${this.niveau.type}s` !== source) {
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
      c.innerHTML = `<span class="filtre-rattachement-titre" title="${texteHtml('structure_btp.filtre.rattachement_aide')}">${texteHtml('structure_btp.filtre.rattachement')}</span>
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
        b.textContent = `${icone('retirer')} ${texte('structure_btp.filtre.effacer')}`;
        b.title = texte('structure_btp.filtre.retirer_rattachement');
        b.addEventListener('click', () => { this.id = null; this.#appliquerDocuments(); });
        c.append(b);
      }
      return;
    }
    const x = this.#element();
    c.hidden = !this.colonneSimple || !x;
    if (c.hidden) return;
    c.innerHTML = `<span class="filtre-rattachement-titre">${texteHtml('structure_btp.filtre.titre')}</span><span class="pastille cochee">${echapper(`${this.niveau.titre} ${x.code}`)}</span>
      <button type="button" data-effacer title="${texteHtml('structure_btp.filtre.retirer')}">${iconeHtml('retirer')} ${texteHtml('structure_btp.filtre.effacer')}</button>`;
    c.querySelector('[data-effacer]').addEventListener('click', () => {
      this.liste.definirFiltreExterne(this.colonneSimple, null, { recharger: false });
      this.colonneSimple = null;
      this.id = null;
      this.surChange({});
      this.rendre();
      this.liste.recharger();
      this.liste.rafraichirSegments?.().catch(() => {});
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
