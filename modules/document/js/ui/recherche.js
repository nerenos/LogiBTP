import { CFG_LIGNES as C, ordreAffichage } from '@logibtp/socle/ui';

// Recherche dans les lignes du document, sans filtrer : les lignes trouvées (numéro, code, libellé) sont surlignées
// et l'on passe de résultat en résultat (Entrée / Maj+Entrée, ou les flèches) ; les tranches repliées s'ouvrent sur
// le résultat courant. Échap ferme la recherche.

/** Texte comparé sans casse ni accents. */
const normaliser = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export class RechercheLignes {
  constructor(conteneur, { editeur }) {
    this.conteneur = conteneur;
    this.editeur = editeur;
    this.resultats = [];
    this.index = -1;
    conteneur.classList.add('barre-recherche');
    conteneur.innerHTML = `
      <span aria-hidden="true">🔍</span>
      <input type="search" data-recherche-lignes placeholder="Rechercher dans les lignes : numéro, code, libellé" aria-label="Rechercher dans les lignes">
      <span class="compteur" aria-live="polite"></span>
      <button type="button" data-precedent title="Résultat précédent (Maj+Entrée)">▲</button>
      <button type="button" data-suivant title="Résultat suivant (Entrée)">▼</button>
      <button type="button" data-fermer title="Fermer la recherche (Échap)">✕</button>`;
    this.champ = conteneur.querySelector('input');
    this.champ.addEventListener('input', () => this.chercher());
    this.champ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.aller(e.shiftKey || e.key === 'ArrowUp' ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.fermer();
      }
    });
    conteneur.querySelector('[data-precedent]').addEventListener('click', () => this.aller(-1));
    conteneur.querySelector('[data-suivant]').addEventListener('click', () => this.aller(1));
    conteneur.querySelector('[data-fermer]').addEventListener('click', () => this.fermer());
    this.conteneur.hidden = true;
  }

  ouvrir() {
    this.conteneur.hidden = false;
    this.champ.focus();
    this.champ.select();
    if (this.champ.value) this.chercher();
  }

  fermer() {
    this.conteneur.hidden = true;
    this.resultats = [];
    this.index = -1;
    this.editeur.marquer(null);
    this.editeur.grille.focus();
  }

  /** Lignes trouvées dans l'ordre du document (tranches repliées comprises) : tous les mots dans numéro, code, libellé. */
  chercher() {
    const mots = normaliser(this.champ.value).split(/\s+/).filter(Boolean);
    const lignes = ordreAffichage(C, this.editeur.resultat.lignes, new Set()).map((x) => x.item);
    this.resultats = mots.length
      ? lignes.filter((l) => {
        const t = normaliser(`${l.lig_numerotation ?? ''} ${l.lig_code ?? ''} ${l.lig_libelle_brut ?? ''}`);
        return mots.every((m) => t.includes(m));
      }).map((l) => l.lig_id)
      : [];
    // Premier résultat à partir de la ligne courante.
    const ordre = lignes.map((l) => l.lig_id);
    const courant = ordre.indexOf(this.editeur.grille.courant);
    const i = this.resultats.findIndex((id) => ordre.indexOf(id) >= courant);
    this.index = this.resultats.length ? Math.max(0, i) : -1;
    this.afficher();
  }

  /** Résultat suivant (sens 1) ou précédent (-1), en boucle. */
  aller(sens) {
    if (!this.resultats.length) { this.chercher(); if (!this.resultats.length) return; }
    else this.index = (this.index + sens + this.resultats.length) % this.resultats.length;
    this.afficher();
  }

  afficher() {
    const n = this.resultats.length;
    const id = n ? this.resultats[this.index] : null;
    this.conteneur.querySelector('.compteur').textContent = this.champ.value.trim() ? (n ? `${this.index + 1} / ${n}` : 'Aucun résultat') : '';
    this.conteneur.classList.toggle('sans-resultat', Boolean(this.champ.value.trim()) && !n);
    this.editeur.marquer(n ? new Set(this.resultats) : null, id);
    if (id !== null) this.editeur.allerA(id, { focus: false });
  }
}
