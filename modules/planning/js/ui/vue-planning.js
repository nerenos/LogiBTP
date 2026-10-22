import { echapper } from '@logibtp/socle/ui';
import { ECHELLES, colonnes, groupes, arrondirAuPas, depuisMinutes } from '../src/temps.js';
import { empiler, cumuler, ligneA, visibles } from '../src/disposition.js';

/**
 * Vue du planning (module Planning, sans métier) : axe du temps en colonnes, lignes (ressources, chantiers…) en
 * lignes, tâches en barres positionnées ; virtualisation (seules les lignes et les barres visibles sont dessinées),
 * barres qui se chevauchent empilées en voies (hauteur fixe ou adaptée), glisser pour déplacer (changer de ligne),
 * bords pour agrandir, au pas du glisser ; Ctrl = copier, Alt + clic = scinder ; zoom par la largeur des colonnes et
 * la hauteur des lignes. Méthode patron : `contenuBarre`, `classeBarre`, `titreBarre`, `enteteLigne`, `classeLigne`.
 *
 * Données : lignes [{ cle, libelle, ... }], taches [{ cle, ligne, debut, fin (minutes), libelle, couleur, ... }].
 * Options : debut, fin (minutes), echelle (HEURE, DEMI_JOUR, JOUR, SEMAINE), largeurColonne (px), hauteurVoie (px),
 * hauteurAdaptee (vrai : une voie par barre superposée), pas (minutes, 15), lecture, largeurEntete (px),
 * actions { deplacer({ tache, debut, fin, ligne, copie }) → booléen | promesse, scinder({ tache, instant }),
 * selection(tache), ouvrir(tache), menu(e, tache), deposer(e, { ligne, instant }) }.
 */
export class VuePlanning {
  #o;
  #lignes = [];
  #parLigne = new Map();
  #positions = [0];
  #hauteurs = [];
  #voies = new Map();
  #dureeMax = 0;
  #image = 0;
  #glisser = null;
  selection = null;

  constructor(conteneur, options = {}) {
    this.conteneur = conteneur;
    this.#o = { echelle: 'JOUR', largeurColonne: 48, hauteurVoie: 22, hauteurAdaptee: true, pas: 15, largeurEntete: 220, actions: {}, ...options };
    conteneur.classList.add('vue-planning');
    conteneur.innerHTML = `<div class="vp-coin"></div><div class="vp-entete"><div class="vp-entete-plan"></div></div>
      <div class="vp-lignes"><div class="vp-lignes-plan"></div></div><div class="vp-corps"><div class="vp-plan"><div class="vp-fond"></div><div class="vp-barres"></div></div></div>`;
    this.corps = conteneur.querySelector('.vp-corps');
    this.plan = conteneur.querySelector('.vp-plan');
    this.corps.addEventListener('scroll', () => this.#programmer(), { passive: true });
    this.corps.addEventListener('pointerdown', (e) => this.#appui(e));
    this.corps.addEventListener('dblclick', (e) => { const t = this.#tacheDe(e.target); if (t) this.#o.actions.ouvrir?.(t); });
    this.corps.addEventListener('contextmenu', (e) => { const t = this.#tacheDe(e.target); if (t && this.#o.actions.menu) { e.preventDefault(); this.#o.actions.menu(e, t); } });
    this.corps.addEventListener('dragover', (e) => { if (this.#o.actions.deposer && !this.#o.lecture) e.preventDefault(); });
    this.corps.addEventListener('drop', (e) => {
      if (!this.#o.actions.deposer || this.#o.lecture) return;
      e.preventDefault();
      const p = this.#point(e);
      this.#o.actions.deposer(e, { ligne: this.#lignes[p.ligne], instant: arrondirAuPas(p.instant, this.#o.pas) });
    });
    new ResizeObserver(() => this.#programmer()).observe(this.corps);
    this.#appliquerDimensions();
  }

  // --- Méthode patron (spécialisation par le module ou le cœur) ---

  /** HTML du contenu d'une barre (échappé). */
  contenuBarre(t) { return echapper(t.libelle ?? ''); }
  /** Classes supplémentaires d'une barre. */
  classeBarre(t) { return t.classe ?? ''; }
  /** Infobulle d'une barre. */
  titreBarre(t) { return `${t.libelle ?? ''}\n${depuisMinutes(t.debut).replace('T', ' ')} → ${depuisMinutes(t.fin).replace('T', ' ')}`; }
  /** HTML de l'en-tête d'une ligne. */
  enteteLigne(l) { return echapper(l.libelle ?? ''); }
  /** Classes supplémentaires d'une ligne. */
  classeLigne(l) { return l.classe ?? ''; }

  // --- Données et réglages ---

  get options() { return this.#o; }
  get minutesParPixel() { return ECHELLES[this.#o.echelle].minutes / this.#o.largeurColonne; }
  x(m) { return (m - this.#o.debut) / this.minutesParPixel; }

  /** Remplace les lignes et les tâches (tâches d'une ligne inconnue ignorées). */
  definirDonnees(lignes, taches) {
    this.#lignes = lignes;
    this.#parLigne = new Map(lignes.map((l) => [l.cle, []]));
    this.#dureeMax = 0;
    for (const t of taches) {
      const l = this.#parLigne.get(t.ligne);
      if (!l) continue;
      l.push(t);
      if (t.fin - t.debut > this.#dureeMax) this.#dureeMax = t.fin - t.debut;
    }
    for (const l of this.#parLigne.values()) l.sort((a, b) => a.debut - b.debut);
    this.#disposer();
  }

  /** Taches d'une ligne (triées par début). */
  tachesDe(cleLigne) { return this.#parLigne.get(cleLigne) ?? []; }

  /** Modifie une tâche (ligne, début, fin…) puis redessine sa ligne. */
  majTache(t, changements = {}) {
    const avant = t.ligne;
    this.#retirer(t);
    Object.assign(t, changements);
    const l = this.#parLigne.get(t.ligne);
    if (l) {
      l.push(t);
      l.sort((a, b) => a.debut - b.debut);
      if (t.fin - t.debut > this.#dureeMax) this.#dureeMax = t.fin - t.debut;
    }
    this.#disposerLignes([avant, t.ligne]);
  }

  ajouterTache(t) { this.#parLigne.get(t.ligne)?.push(t); this.majTache(t); }

  supprimerTache(t) { const l = t.ligne; this.#retirer(t); this.#disposerLignes([l]); }

  #retirer(t) {
    const l = this.#parLigne.get(t.ligne);
    const i = l ? l.indexOf(t) : -1;
    if (i >= 0) l.splice(i, 1);
  }

  /** Change la période, l'échelle, la largeur des colonnes, la hauteur des voies… puis redessine. */
  regler(options) {
    const centre = this.#instantCentre();
    Object.assign(this.#o, options);
    this.#appliquerDimensions();
    this.#disposer();
    if (centre != null && !('debut' in options)) this.allerA(centre);
  }

  /** Zoom horizontal (facteur sur la largeur des colonnes), centré. */
  zoomer(facteur) { this.regler({ largeurColonne: Math.max(8, Math.min(400, Math.round(this.#o.largeurColonne * facteur))) }); }

  /** Fait défiler pour montrer l'instant (minutes) au centre. */
  allerA(m) { this.corps.scrollLeft = Math.max(0, this.x(m) - this.corps.clientWidth / 2); }

  #instantCentre() {
    return this.corps.clientWidth ? this.#o.debut + (this.corps.scrollLeft + this.corps.clientWidth / 2) * this.minutesParPixel : null;
  }

  #appliquerDimensions() {
    const s = this.conteneur.style;
    s.setProperty('--vp-entete', `${this.#o.largeurEntete}px`);
    s.setProperty('--vp-voie', `${this.#o.hauteurVoie}px`);
    this.plan.style.width = `${Math.max(0, this.x(this.#o.fin))}px`;
    this.conteneur.querySelector('.vp-entete-plan').style.width = this.plan.style.width;
    this.#dessinerEntete();
    this.#dessinerFond();
  }

  #disposer() {
    this.#voies = new Map();
    this.#hauteurs = this.#lignes.map((l) => this.#hauteurLigne(l));
    this.#positions = cumuler(this.#hauteurs);
    this.#tailleVerticale();
    this.#programmer();
  }

  #disposerLignes(cles) {
    let change = false;
    for (const cle of new Set(cles)) {
      const i = this.#lignes.findIndex((l) => l.cle === cle);
      if (i < 0) continue;
      const h = this.#hauteurLigne(this.#lignes[i]);
      if (h !== this.#hauteurs[i]) { this.#hauteurs[i] = h; change = true; }
    }
    if (change) { this.#positions = cumuler(this.#hauteurs); this.#tailleVerticale(); }
    this.#programmer();
  }

  #hauteurLigne(l) {
    const barres = this.#parLigne.get(l.cle) ?? [];
    const { voies, nb } = empiler(barres);
    for (const [b, v] of voies) this.#voies.set(b, v);
    const n = this.#o.hauteurAdaptee ? Math.max(1, nb) : 1;
    return n * this.#o.hauteurVoie + 6;
  }

  #tailleVerticale() {
    const h = `${this.#positions.at(-1)}px`;
    this.plan.style.height = h;
    this.conteneur.querySelector('.vp-lignes-plan').style.height = h;
  }

  #dessinerEntete() {
    const { debut, fin, echelle } = this.#o;
    const g = groupes(debut, fin, echelle);
    const c = colonnes(debut, fin, echelle);
    const larg = (a, b) => Math.max(0, this.x(Math.min(b, fin)) - this.x(Math.max(a, debut)));
    this.conteneur.querySelector('.vp-entete-plan').innerHTML = `<div class="vp-groupes">${g.map((x) => `<div style="left:${Math.max(0, this.x(x.debut))}px;width:${larg(x.debut, x.fin)}px">${echapper(x.libelle)}</div>`).join('')}</div>
      <div class="vp-colonnes">${c.map((x) => `<div class="${x.weekend ? 'weekend' : ''}" style="left:${this.x(x.debut)}px;width:${this.#o.largeurColonne}px">${this.#o.largeurColonne >= 26 ? echapper(x.libelle) : ''}</div>`).join('')}</div>`;
  }

  /** Fond : week-ends et séparations des colonnes par un dégradé répété (aucun élément par colonne). */
  #dessinerFond() {
    const { debut, fin, echelle, largeurColonne } = this.#o;
    const fond = this.conteneur.querySelector('.vp-fond');
    fond.style.backgroundSize = `${largeurColonne}px 100%`;
    fond.style.backgroundPositionX = `${this.x(colonnes(debut, debut + 1, echelle)[0]?.debut ?? debut)}px`;
    fond.innerHTML = echelle === 'SEMAINE' ? '' : colonnes(debut, fin, 'JOUR').filter((x) => x.weekend)
      .map((x) => `<div class="vp-weekend" style="left:${this.x(x.debut)}px;width:${1440 / this.minutesParPixel}px"></div>`).join('');
  }

  /** Dessine tout de suite (sans attendre l'image suivante). */
  actualiser() { this.#dessiner(); }

  /** Dessin à la prochaine image (minuterie de repli : fenêtre en arrière-plan sans images). */
  #programmer() {
    if (this.#image) return;
    const lancer = () => {
      if (!this.#image) return;
      cancelAnimationFrame(this.#image.image);
      clearTimeout(this.#image.minuterie);
      this.#image = 0;
      this.#dessiner();
    };
    this.#image = { image: requestAnimationFrame(lancer), minuterie: setTimeout(lancer, 100) };
  }

  /** Dessine les lignes et les barres visibles (avec une marge), synchronise les en-têtes. */
  #dessiner() {
    const c = this.corps;
    this.conteneur.querySelector('.vp-entete-plan').style.transform = `translateX(${-c.scrollLeft}px)`;
    this.conteneur.querySelector('.vp-lignes-plan').style.transform = `translateY(${-c.scrollTop}px)`;
    if (!this.#lignes.length) { this.plan.querySelector('.vp-barres').innerHTML = ''; this.conteneur.querySelector('.vp-lignes-plan').innerHTML = ''; return; }
    const marge = 200;
    const i0 = Math.max(0, ligneA(this.#positions, c.scrollTop - marge));
    const i1 = ligneA(this.#positions, c.scrollTop + c.clientHeight + marge);
    const t0 = this.#o.debut + (c.scrollLeft - marge) * this.minutesParPixel;
    const t1 = this.#o.debut + (c.scrollLeft + c.clientWidth + marge) * this.minutesParPixel;
    const lignes = [];
    const barres = [];
    for (let i = i0; i <= i1; i++) {
      const l = this.#lignes[i];
      const y = this.#positions[i];
      lignes.push(`<div class="vp-ligne ${this.classeLigne(l)}" data-i="${i}" style="top:${y}px;height:${this.#hauteurs[i]}px">${this.enteteLigne(l)}</div>`);
      barres.push(`<div class="vp-separation" style="top:${y + this.#hauteurs[i] - 1}px"></div>`);
      for (const t of visibles(this.#parLigne.get(l.cle) ?? [], t0, t1, this.#dureeMax)) {
        const v = this.#o.hauteurAdaptee ? this.#voies.get(t) ?? 0 : 0;
        const gauche = this.x(Math.max(t.debut, this.#o.debut));
        const largeur = Math.max(3, this.x(Math.min(t.fin, this.#o.fin)) - gauche);
        barres.push(`<div class="vp-barre ${this.classeBarre(t)}${t === this.selection ? ' selection' : ''}" data-cle="${echapper(String(t.cle))}" data-ligne="${i}"
          style="left:${gauche}px;width:${largeur}px;top:${y + 3 + v * this.#o.hauteurVoie}px;height:${this.#o.hauteurVoie - 2}px;${t.couleur ? `--vp-couleur:${t.couleur};` : ''}"
          title="${echapper(this.titreBarre(t))}">${this.contenuBarre(t)}</div>`);
      }
    }
    this.conteneur.querySelector('.vp-lignes-plan').innerHTML = lignes.join('');
    this.plan.querySelector('.vp-barres').innerHTML = barres.join('');
  }

  #tacheDe(el) {
    const b = el.closest?.('.vp-barre');
    if (!b) return null;
    const l = this.#lignes[Number(b.dataset.ligne)];
    return this.tachesDe(l?.cle).find((t) => String(t.cle) === b.dataset.cle) ?? null;
  }

  /** Ligne et instant sous le pointeur. */
  #point(e) {
    const r = this.plan.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { ligne: ligneA(this.#positions, y), instant: this.#o.debut + x * this.minutesParPixel, x, y };
  }

  #selectionner(t) {
    this.selection = t;
    this.#o.actions.selection?.(t);
    this.#programmer();
  }

  #appui(e) {
    if (e.button !== 0) return;
    const b = e.target.closest('.vp-barre');
    const t = this.#tacheDe(e.target);
    if (!t) { if (this.selection) this.#selectionner(null); return; }
    this.#selectionner(t);
    if (this.#o.lecture) return;
    const p = this.#point(e);
    if (e.altKey && this.#o.actions.scinder) {
      this.#o.actions.scinder({ tache: t, instant: arrondirAuPas(p.instant, this.#o.pas) });
      return;
    }
    const r = b.getBoundingClientRect();
    const bord = 6;
    const mode = e.clientX - r.left < bord ? 'debut' : r.right - e.clientX < bord ? 'fin' : 'deplacer';
    const fantome = b.cloneNode(true);
    fantome.classList.add('fantome');
    this.plan.querySelector('.vp-barres').append(fantome);
    b.classList.add('origine');
    this.#glisser = { t, mode, depart: p, fantome, ligne: p.ligne, debut: t.debut, fin: t.fin, bouge: false };
    try { this.corps.setPointerCapture(e.pointerId); } catch { /* pointeur simulé */ }
    const bouger = (ev) => this.#bouger(ev);
    const lacher = (ev) => {
      this.corps.removeEventListener('pointermove', bouger);
      this.corps.removeEventListener('pointerup', lacher);
      this.corps.removeEventListener('pointercancel', lacher);
      this.#lacher(ev);
    };
    this.corps.addEventListener('pointermove', bouger);
    this.corps.addEventListener('pointerup', lacher);
    this.corps.addEventListener('pointercancel', lacher);
  }

  #bouger(e) {
    const g = this.#glisser;
    if (!g) return;
    const p = this.#point(e);
    if (!g.bouge && Math.abs(p.x - g.depart.x) < 3 && Math.abs(p.y - g.depart.y) < 3) return;
    g.bouge = true;
    const delta = arrondirAuPas(p.instant - g.depart.instant, this.#o.pas);
    const { t, mode } = g;
    if (mode === 'deplacer') {
      g.debut = t.debut + delta;
      g.fin = t.fin + delta;
      g.ligne = this.#lignes[p.ligne]?.ligneFixe ? g.depart.ligne : Math.max(0, p.ligne);
    } else if (mode === 'debut') {
      g.debut = Math.min(t.fin - this.#o.pas, t.debut + delta);
    } else {
      g.fin = Math.max(t.debut + this.#o.pas, t.fin + delta);
    }
    const s = g.fantome.style;
    s.left = `${this.x(g.debut)}px`;
    s.width = `${Math.max(3, this.x(g.fin) - this.x(g.debut))}px`;
    s.top = `${this.#positions[g.ligne] + 3}px`;
    g.fantome.title = `${depuisMinutes(g.debut).replace('T', ' ')} → ${depuisMinutes(g.fin).replace('T', ' ')}`;
  }

  async #lacher(e) {
    const g = this.#glisser;
    this.#glisser = null;
    if (!g) return;
    g.fantome.remove();
    this.plan.querySelector('.vp-barre.origine')?.classList.remove('origine');
    if (!g.bouge) return;
    const ligne = this.#lignes[g.ligne]?.cle ?? g.t.ligne;
    const proposition = { tache: g.t, debut: g.debut, fin: g.fin, ligne, copie: e.ctrlKey && g.mode === 'deplacer' };
    let accepte = true;
    if (this.#o.actions.deplacer) accepte = await this.#o.actions.deplacer(proposition);
    if (accepte && !proposition.copie) this.majTache(g.t, { debut: g.debut, fin: g.fin, ligne });
    else this.#programmer();
  }
}
