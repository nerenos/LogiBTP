// Environnement d'affichage : onglet actif et panneaux ancrables (détail de la ligne, plan du document…).
// Trois zones autour de la grille (gauche, droite, bas), chacune redimensionnable ; plusieurs panneaux peuvent partager
// une zone (empilés). Chaque panneau a sa position, son état réduit et sa visibilité, gardés dans le navigateur.
import { texte, icone } from '@logibtp/socle/dictionnaire';
import { lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';

const POSITIONS = ['gauche', 'droite', 'bas'];
const ZONES = { gauche: 280, droite: 340, bas: 260 };
const DOCKS = { detail: { position: 'droite', reduit: false, visible: true }, plan: { position: 'gauche', reduit: false, visible: true } };

function lire(defauts) {
  const o = lirePreferences();
  const docks = {};
  for (const [id, defaut] of Object.entries({ ...DOCKS, ...defauts })) {
    // Ancienne préférence (un seul panneau, `dock`) reprise pour le détail.
    const ancien = id === 'detail' && o.dock && !o.docks ? { position: o.dock.position, reduit: o.dock.reduit } : {};
    const p = { ...defaut, ...ancien, ...o.docks?.[id] };
    if (!POSITIONS.includes(p.position)) p.position = defaut.position;
    docks[id] = p;
  }
  const zones = { ...ZONES, ...(o.dock && !o.zones ? { [o.dock.position]: o.dock.position === 'bas' ? o.dock.hauteur : o.dock.largeur } : {}), ...o.zones };
  return { onglet: typeof o.onglet === 'string' ? o.onglet : 'lignes', docks, zones };
}

const ecrire = (p) => ecrirePreferences({ onglet: p.onglet, docks: p.docks, zones: p.zones });

export class Disposition {
  /**
   * Panneaux : éléments `.dock[data-dock-id]` (boutons [data-dock] de position, [data-action="reduire"],
   * [data-action="fermer"]) ; zones : `[data-zone]` et séparateurs `[data-sep]` dans #vue-lignes. racine : conteneur de
   * la page (les éléments d'une page qui se ferme peuvent être encore présents dans le document). docks : état par
   * défaut des panneaux propres à la page ({ id: { position, reduit, visible } }).
   */
  constructor({ surOnglet, surDock = null, racine = document, docks = {} }) {
    this.racine = racine;
    this.p = lire(docks);
    this.surOnglet = surOnglet;
    this.surDock = surDock;
    // Onglets déclarés par les boutons [data-onglet-vue] ; chacun affiche la section #vue-<nom>.
    this.onglets = [...this.racine.querySelectorAll('[data-onglet-vue]')].map((b) => b.dataset.ongletVue);
    if (!this.onglets.includes(this.p.onglet)) this.p.onglet = 'lignes';
    this.vue = this.racine.querySelector('#vue-lignes');
    this.docks = new Map([...this.racine.querySelectorAll('.dock[data-dock-id]')].map((d) => [d.dataset.dockId, d]));
    this.racine.querySelectorAll('[data-onglet-vue]').forEach((b) => b.addEventListener('click', () => this.onglet(b.dataset.ongletVue)));
    for (const [id, dock] of this.docks) {
      this.p.docks[id] ??= { position: 'droite', reduit: false, visible: true };
      dock.querySelectorAll('[data-dock]').forEach((b) => b.addEventListener('click', () => this.positionner(id, b.dataset.dock)));
      dock.querySelector('[data-action="reduire"]')?.addEventListener('click', () => this.reduire(id, !this.p.docks[id].reduit));
      dock.querySelector('[data-action="fermer"]')?.addEventListener('click', () => this.afficher(id, false));
    }
    this.vue.querySelectorAll('[data-sep]').forEach((s) => this.#separateur(s, s.dataset.sep));
    this.appliquer();
  }

  /** Panneaux visibles d'une zone, dans l'ordre du document. */
  dansZone(zone) { return [...this.docks.keys()].filter((id) => this.p.docks[id].visible && this.p.docks[id].position === zone); }

  appliquer() {
    const { onglet, docks, zones } = this.p;
    this.racine.querySelectorAll('[data-onglet-vue]').forEach((b) => {
      const actif = b.dataset.ongletVue === onglet;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-selected', String(actif));
    });
    for (const nom of this.onglets) {
      const section = this.racine.querySelector(`#vue-${nom}`);
      if (section) section.hidden = nom !== onglet;
    }
    for (const zone of POSITIONS) {
      const conteneur = this.vue.querySelector(`[data-zone="${zone}"]`);
      const ids = this.dansZone(zone);
      for (const id of ids) if (this.docks.get(id).parentElement !== conteneur) conteneur.append(this.docks.get(id));
      const reduite = ids.length > 0 && ids.every((id) => docks[id].reduit);
      const taille = !ids.length ? '0px' : reduite ? (zone === 'bas' ? '2.2rem' : '2.4rem') : `${zones[zone]}px`;
      this.vue.style.setProperty(`--zone-${zone}`, taille);
      this.vue.style.setProperty(`--sep-${zone}`, ids.length ? '6px' : '0px');
      conteneur.hidden = !ids.length;
      conteneur.classList.toggle('zone-reduite', reduite);
      this.vue.querySelector(`[data-sep="${zone}"]`).hidden = !ids.length;
    }
    for (const [id, dock] of this.docks) {
      const d = docks[id];
      dock.hidden = !d.visible;
      dock.classList.toggle('dock-reduit', d.reduit);
      dock.querySelectorAll('[data-dock]').forEach((b) => b.classList.toggle('actif', b.dataset.dock === d.position));
      const bouton = dock.querySelector('[data-action="reduire"]');
      if (bouton) {
        bouton.textContent = icone(d.reduit ? 'document_agrandir' : 'document_reduire');
        bouton.title = texte(d.reduit ? 'document.disposition.agrandir' : 'document.disposition.reduire');
      }
    }
    this.racine.querySelectorAll('[data-basculer-dock]').forEach((b) => b.classList.toggle('actif', Boolean(docks[b.dataset.basculerDock]?.visible)));
  }

  onglet(nom) {
    this.p.onglet = this.onglets.includes(nom) ? nom : 'lignes';
    ecrire(this.p);
    this.appliquer();
    this.surOnglet?.(this.p.onglet);
  }

  positionner(id, position) {
    Object.assign(this.p.docks[id], { position, reduit: false, visible: true });
    ecrire(this.p);
    this.appliquer();
  }

  reduire(id, reduit) {
    this.p.docks[id].reduit = reduit;
    ecrire(this.p);
    this.appliquer();
  }

  /** Panneau affiché ou fermé (bouton de la barre [data-basculer-dock], croix du panneau). */
  afficher(id, visible = !this.p.docks[id].visible) {
    Object.assign(this.p.docks[id], { visible, reduit: false });
    ecrire(this.p);
    this.appliquer();
    this.surDock?.(id, visible);
  }

  /** Redimensionnement d'une zone par glisser (Pointer Events) : largeur à gauche ou à droite, hauteur en bas. */
  #separateur(sep, zone) {
    sep.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sep.setPointerCapture(e.pointerId);
      for (const id of this.dansZone(zone)) this.p.docks[id].reduit = false;
      this.appliquer();
      const rect = this.vue.getBoundingClientRect();
      document.body.classList.add('redimensionnement');
      const bouger = (ev) => {
        const z = this.p.zones;
        if (zone === 'bas') z.bas = Math.round(Math.min(Math.max(rect.bottom - ev.clientY, 120), rect.height * 0.8));
        else if (zone === 'droite') z.droite = Math.round(Math.min(Math.max(rect.right - ev.clientX, 180), rect.width * 0.6));
        else z.gauche = Math.round(Math.min(Math.max(ev.clientX - rect.left, 180), rect.width * 0.6));
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
    // Double-clic sur le séparateur : réduire ou agrandir les panneaux de la zone.
    sep.addEventListener('dblclick', () => {
      const ids = this.dansZone(zone);
      const reduit = !ids.every((id) => this.p.docks[id].reduit);
      for (const id of ids) this.p.docks[id].reduit = reduit;
      ecrire(this.p);
      this.appliquer();
    });
  }
}
