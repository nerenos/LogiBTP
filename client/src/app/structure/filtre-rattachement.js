import { echapper } from '@logibtp/socle/ui';
import { champRattachement } from './selection.js';
import { changerNiveau } from './structure.js';

// Filtre des listes par rattachement à la structure des affaires. Listes de documents : barre « Projet, Affaire,
// Chantier, Marché » (zone de code, double-clic ou F4 : liste de choix ; les parents suivent l'enfant), filtres sur
// les identifiants de la vue (projet_id…). Autres listes (chantiers d'une affaire, marchés d'un chantier…) : filtre
// sur la colonne de même nom (code), rappelé par une pastille.
// Adresse : /liste/<thème>?projet=CODE&affaire=CODE&chantier=CODE&marche=CODE (raccourcis des fiches).

export const NIVEAUX = [
  { type: 'projet', cle: 'ent_projet_id', colonne: 'projet_id', liste: 'projets', titre: 'Projet' },
  { type: 'affaire', cle: 'ent_affaire_id', colonne: 'affaire_id', liste: 'affaires', titre: 'Affaire' },
  { type: 'chantier', cle: 'ent_chantier_id', colonne: 'chantier_id', liste: 'chantiers', titre: 'Chantier' },
  { type: 'marche', cle: 'ent_marche_id', colonne: 'marche_id', liste: 'marches', titre: 'Marché' },
];

/** Rattachement désigné par les codes de l'adresse ({ projet: 'PRJ-2026-001' … }), parents complétés. */
export function rattachementDepuisCodes(codes, refs) {
  let r = {};
  for (const n of NIVEAUX) {
    const code = codes[n.type];
    const x = code ? (refs[n.liste] ?? []).find((y) => y.code.toLowerCase() === String(code).toLowerCase()) : null;
    if (x) r = changerNiveau(r, n.cle, x.id, refs);
  }
  return r;
}

export class FiltreRattachement {
  /**
   * conteneur : zone au-dessus de la liste ; liste : ListeDonnees (definirFiltreExterne) ; refs : référentiels de la
   * structure ; surChange(codes) : codes retenus (adresse de la page).
   */
  constructor(conteneur, { liste, refs, surChange = () => {} }) {
    this.conteneur = conteneur;
    this.liste = liste;
    this.refs = refs;
    this.surChange = surChange;
    this.r = {};
    this.colonnesSimples = [];
    conteneur.classList.add('filtre-rattachement');
  }

  /** Codes du rattachement courant (adresse). */
  codes() {
    return Object.fromEntries(NIVEAUX.filter((n) => this.r[n.cle]).map((n) => [n.type, (this.refs[n.liste] ?? []).find((x) => x.id === this.r[n.cle])?.code]));
  }

  /**
   * Filtres externes de la vue (option filtresVue de la liste), selon sa source : documents → identifiants
   * (projet_id…) ; autre source ayant des colonnes projet / affaire / chantier / marche → ces colonnes (codes) ;
   * toutes les colonnes gérées ici sont citées (null : filtre retiré). codes : rattachement voulu (adresse), sinon
   * celui en cours.
   */
  filtresPour(source, colonnes, codes = null) {
    this.source = source;
    if (codes) this.r = rattachementDepuisCodes(codes, this.refs);
    const c = this.codes();
    const f = {};
    for (const n of NIVEAUX) { f[n.colonne] = null; f[n.type] = null; }
    this.colonnesSimples = [];
    if (source === 'documents') {
      for (const n of NIVEAUX) if (this.r[n.cle]) f[n.colonne] = [String(this.r[n.cle])];
    } else {
      // Liste d'un niveau (chantiers…) : filtrée par ses parents, jamais par son propre niveau.
      for (const n of NIVEAUX) {
        if (c[n.type] && colonnes.includes(n.type) && `${n.type}s` !== source) { f[n.type] = [c[n.type]]; this.colonnesSimples.push(n.type); }
      }
    }
    return f;
  }

  rendre() {
    const c = this.conteneur;
    c.replaceChildren();
    if (this.source === 'documents') {
      c.hidden = false;
      c.innerHTML = '<span class="filtre-rattachement-titre" title="Documents rattachés (les parents suivent l\'enfant)">Rattachement</span>';
      for (const n of NIVEAUX) {
        c.append(champRattachement({ type: n.type, titre: n.titre, refs: this.refs, valeur: this.r[n.cle] ?? null, choisir: (id) => this.#changer(n.cle, id) }));
      }
      if (NIVEAUX.some((n) => this.r[n.cle])) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = '✕ Effacer';
        b.title = 'Retirer le filtre par rattachement';
        b.addEventListener('click', () => { this.r = {}; this.#appliquerDocuments(); });
        c.append(b);
      }
      return;
    }
    const codes = this.codes();
    const actifs = this.colonnesSimples.map((t) => `${NIVEAUX.find((n) => n.type === t).titre} ${codes[t]}`);
    c.hidden = !actifs.length;
    if (!actifs.length) return;
    c.innerHTML = `<span class="filtre-rattachement-titre">Filtre</span><span class="pastille cochee">${echapper(actifs.join(' · '))}</span>
      <button type="button" data-effacer title="Retirer le filtre">✕ Effacer</button>`;
    c.querySelector('[data-effacer]').addEventListener('click', () => {
      for (const col of this.colonnesSimples) this.liste.definirFiltreExterne(col, null, { recharger: false });
      this.colonnesSimples = [];
      this.r = {};
      this.surChange({});
      this.rendre();
      this.liste.recharger();
    });
  }

  #changer(cle, id) {
    this.r = changerNiveau(this.r, cle, id, this.refs);
    this.#appliquerDocuments();
  }

  #appliquerDocuments() {
    for (const n of NIVEAUX) this.liste.definirFiltreExterne(n.colonne, this.r[n.cle] ? [String(this.r[n.cle])] : null, { recharger: false });
    this.surChange(this.codes());
    this.rendre();
    this.liste.recharger();
    this.liste.rafraichirSegments?.().catch(() => {});
  }
}
