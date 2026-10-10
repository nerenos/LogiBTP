// Environnement d'affichage : onglet actif, position et taille du panneau de détail.
import { lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';

const DEFAUT = { onglet: 'lignes', dock: { position: 'droite', largeur: 340, hauteur: 260, reduit: false } };
const POSITIONS = ['gauche', 'droite', 'bas'];

function lire() {
  const o = lirePreferences();
  return {
    onglet: o.onglet === 'entete' ? 'entete' : 'lignes',
    dock: { ...DEFAUT.dock, ...o.dock, position: POSITIONS.includes(o.dock?.position) ? o.dock.position : 'droite' },
  };
}

const ecrire = (p) => ecrirePreferences({ onglet: p.onglet, dock: p.dock });

export class Disposition {
  constructor({ surOnglet }) {
    this.p = lire();
    this.surOnglet = surOnglet;
    this.vue = document.querySelector('#vue-lignes');
    this.dock = document.querySelector('#dock');
    document.querySelectorAll('[data-onglet-vue]').forEach((b) => b.addEventListener('click', () => this.onglet(b.dataset.ongletVue)));
    this.dock.querySelectorAll('[data-dock]').forEach((b) => b.addEventListener('click', () => this.positionner(b.dataset.dock)));
    this.dock.querySelector('[data-action="reduire"]').addEventListener('click', () => this.reduire(!this.p.dock.reduit));
    this.#separateur(document.querySelector('#separateur'));
    this.appliquer();
  }

  appliquer() {
    const { onglet, dock } = this.p;
    document.querySelectorAll('[data-onglet-vue]').forEach((b) => {
      const actif = b.dataset.ongletVue === onglet;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-selected', String(actif));
    });
    document.querySelector('#vue-entete').hidden = onglet !== 'entete';
    this.vue.hidden = onglet !== 'lignes';
    for (const pos of POSITIONS) this.vue.classList.toggle(`dock-${pos}`, dock.position === pos);
    this.vue.classList.toggle('dock-reduit', dock.reduit);
    this.vue.style.setProperty('--dock-largeur', `${dock.largeur}px`);
    this.vue.style.setProperty('--dock-hauteur', `${dock.hauteur}px`);
    this.dock.querySelectorAll('[data-dock]').forEach((b) => b.classList.toggle('actif', b.dataset.dock === dock.position));
    const bouton = this.dock.querySelector('[data-action="reduire"]');
    bouton.textContent = dock.reduit ? '▢' : '–';
    bouton.title = dock.reduit ? 'Agrandir le panneau de détail' : 'Réduire le panneau de détail';
  }

  onglet(nom) {
    this.p.onglet = nom === 'entete' ? 'entete' : 'lignes';
    ecrire(this.p);
    this.appliquer();
    this.surOnglet?.(this.p.onglet);
  }

  positionner(position) {
    this.p.dock.position = position;
    this.p.dock.reduit = false;
    ecrire(this.p);
    this.appliquer();
  }

  reduire(reduit) {
    this.p.dock.reduit = reduit;
    ecrire(this.p);
    this.appliquer();
  }

  /** Redimensionnement du panneau par glisser (Pointer Events) : largeur à gauche ou à droite, hauteur en bas. */
  #separateur(sep) {
    sep.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sep.setPointerCapture(e.pointerId);
      if (this.p.dock.reduit) this.reduire(false);
      const rect = this.vue.getBoundingClientRect();
      document.body.classList.add('redimensionnement');
      const bouger = (ev) => {
        const d = this.p.dock;
        if (d.position === 'bas') d.hauteur = Math.round(Math.min(Math.max(rect.bottom - ev.clientY, 120), rect.height * 0.8));
        else if (d.position === 'droite') d.largeur = Math.round(Math.min(Math.max(rect.right - ev.clientX, 220), rect.width * 0.7));
        else d.largeur = Math.round(Math.min(Math.max(ev.clientX - rect.left, 220), rect.width * 0.7));
        this.appliquer();
      };
      const finir = () => {
        sep.removeEventListener('pointermove', bouger);
        sep.removeEventListener('pointerup', finir);
        sep.removeEventListener('pointercancel', finir);
        document.body.classList.remove('redimensionnement');
        ecrire(this.p);
      };
      sep.addEventListener('pointermove', bouger);
      sep.addEventListener('pointerup', finir);
      sep.addEventListener('pointercancel', finir);
    });
    // Double-clic sur le séparateur : réduire ou agrandir.
    sep.addEventListener('dblclick', () => this.reduire(!this.p.dock.reduit));
  }
}
