import { echapper, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { disposerGraphe, fusionnerGraphes, voisinage } from '../src/graphe.js';

// Vue d'un graphe (classe mère, style des outils d'analyse de liens) : couches par ordre, nœuds en colonne sous les
// couches, niveau de représentation (profondeur), zoom à la molette, déplacement du fond et des nœuds, survol qui met en
// évidence les voisins, panneau du nœud choisi (ouvrir, centrer, développer), export SVG. Réglages gardés dans le
// navigateur (préférences), jamais en base.
//
// Points de spécialisation (méthode patron) : chargerGraphe, developperGraphe, fusionner, reglagesDefaut,
// controlesReglages, enColonne, dimensions, corpsNoeud, couleurNoeud, styleArete, libelleArete, legende, compte,
// infosNoeud, boutonsNoeud, relationVoisin, peutOuvrir, nomExport. Sans spécialisation, les options charger(depart,
// reglages) et developper(noeud, reglages) suffisent.

const NS = 'http://www.w3.org/2000/svg';
export const tronquer = (t, n) => (String(t ?? '').length > n ? `${String(t).slice(0, n - 1)}…` : String(t ?? ''));

export class VueGraphe {
  /**
   * options : depart { type, id } ; charger(depart, reglages) → graphe ; developper(noeud, reglages, extra) → graphe ;
   * ouvrir(noeud, evenement) ; recentrer(depart, reglages) (sinon recentrage sur place) ; pleinEcran(depart, reglages,
   * evenement) ; surReglages(reglages) ; message ; reglages (sinon préférences du navigateur) ; cleReglages (clé des
   * préférences) ; profondeurMax (5).
   */
  constructor(conteneur, options) {
    this.conteneur = conteneur;
    this.options = options;
    this.depart = options.depart;
    this.profondeurMax = options.profondeurMax ?? 5;
    this.cleReglages = options.cleReglages ?? this.constructor.CLE_REGLAGES ?? 'graphe';
    const p = { profondeur: 2, ...this.reglagesDefaut(), ...(lirePreferences()[this.cleReglages] ?? {}), ...(options.reglages ?? {}) };
    this.reglages = { ...p, profondeur: Math.min(Math.max(Number(p.profondeur) || 2, 1), this.profondeurMax) };
    this.vue = { x: 0, y: 0, k: 1 };
    this.manuelles = new Map();
    this.selection = null;
    this.#construire();
    this.charger().catch((e) => this.erreur(e));
  }

  erreur(e) { console.error(e); this.options.message?.(e.message ?? String(e), 'erreur'); }

  // ---------------------------------------------------------------- points de spécialisation

  /** Graphe autour du départ. */
  chargerGraphe(depart, reglages) { return this.options.charger(depart, reglages); }

  /** Voisins directs d'un nœud (développement) ; extra : réglages ponctuels. */
  developperGraphe(noeud, reglages, extra = {}) {
    return this.options.developper ? this.options.developper(noeud, reglages, extra) : this.chargerGraphe({ type: noeud.type, id: noeud.id }, { ...reglages, ...extra, profondeur: 1 });
  }

  fusionner(a, b) { return fusionnerGraphes(a, b); }

  /** Réglages propres à la spécialisation (en plus de la profondeur). */
  reglagesDefaut() { return {}; }

  /** Contrôles de la barre : [{ code, libelle, titre, type: 'case' | 'liste', options: [valeurs] }]. */
  controlesReglages() { return []; }

  /** Nœud empilé en colonne sous les couches (contacts, détails). */
  enColonne(n) { return n.colonne === true; }

  dimensions(n) { return this.enColonne(n) ? { w: 150, h: 30 } : { w: 184, h: 46 }; }

  /** Couleur du bandeau latéral d'un nœud principal. */
  couleurNoeud(_n) { return 'var(--bord)'; }

  /** Corps SVG d'un nœud (rectangle, icône, libellé, sous-titre) ; bord : attributs du contour (départ en évidence). */
  corpsNoeud(n, { x, y, w, h, bord }) {
    if (this.enColonne(n)) {
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="var(--fond)" ${bord}/>
        <text x="${x + 10}" y="${y + 20}" font-size="12">${echapper(n.icone ?? '•')}</text>
        <text x="${x + 28}" y="${y + 19}" font-size="11" fill="var(--texte)">${echapper(tronquer(n.libelle, 19))}</text>`;
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="var(--surface)" ${bord}/>
      <rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${this.couleurNoeud(n)}"/>
      <text x="${x + 14}" y="${y + 19}" font-size="13">${echapper(n.icone ?? '◻')}</text>
      <text x="${x + 34}" y="${y + 19}" font-size="12" font-weight="600" fill="var(--texte)">${echapper(tronquer(n.libelle, 22))}</text>
      <text x="${x + 34}" y="${y + 35}" font-size="10" fill="var(--discret)">${echapper(tronquer(n.sous_titre ?? '', 22))}</text>`;
  }

  /** Attributs SVG du tracé d'une arête. */
  styleArete(_a) { return 'stroke="var(--discret)" stroke-width="1.6" marker-end="url(#graphe-fleche)"'; }

  /** Libellé affiché sur l'arête (null : aucun) et s'il n'apparaît qu'au survol. */
  libelleArete(a) { return a.libelle ? { texte: a.libelle, secondaire: false, couleur: 'var(--discret)' } : null; }

  /** Légende : [{ classe, libelle }] (classes l-* de graphe.css, ou style en ligne). */
  legende() { return []; }

  compte(g) { return g.noeuds.length ? `${g.noeuds.length} nœud(s), ${g.aretes.length} relation(s)` : 'Aucun élément'; }

  /** Description du nœud dans le panneau (HTML, sous le titre). */
  infosNoeud(n) {
    return `<p class="aide">${n.sous_titre ? `${echapper(n.sous_titre)} · ` : ''}${n.distance === 0 ? 'départ' : `à ${n.distance} saut${n.distance > 1 ? 's' : ''}`}${n.actif === false ? ' · inactif' : ''}</p>`;
  }

  /** Le nœud a-t-il une fiche à ouvrir (double-clic, bouton) ? */
  peutOuvrir(n) { return !!this.options.ouvrir && n.ouvrable !== false; }

  /** Boutons du panneau : [{ code, libelle, titre, action() }]. */
  boutonsNoeud(n) {
    const b = [];
    if (this.peutOuvrir(n)) b.push({ code: 'ouvrir', libelle: 'Ouvrir la fiche', action: (e) => this.options.ouvrir(n, e) });
    if (!n.depart && n.ouvrable !== false) b.push({ code: 'centrer', libelle: '◎ Centrer ici', titre: 'Repartir de ce nœud', action: () => this.recentrer({ type: n.type, id: n.id }) });
    if (n.ouvrable !== false) b.push({ code: 'developper', libelle: '＋ Développer', titre: 'Ajouter ses voisins directs au graphe', action: () => this.developper(n).catch((e) => this.erreur(e)) });
    return b;
  }

  /** Nature de la relation avec un voisin (liste du panneau). */
  relationVoisin(a, _n) { return a.libelle ?? a.type ?? ''; }

  nomExport() { return `graphe-${this.depart.type}-${this.depart.id}.svg`; }

  // ---------------------------------------------------------------- construction

  #construire() {
    const r = this.reglages;
    const controle = (c) => (c.type === 'case'
      ? `<label ${c.titre ? `title="${echapper(c.titre)}"` : ''}><input type="checkbox" data-r="${c.code}" ${r[c.code] ? 'checked' : ''}> ${echapper(c.libelle)}</label>`
      : `<label ${c.titre ? `title="${echapper(c.titre)}"` : ''}>${echapper(c.libelle)}
          <select data-r="${c.code}">${c.options.map((o) => `<option ${Number(r[c.code]) === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`);
    this.conteneur.innerHTML = `<div class="graphe">
      <div class="graphe-barre">
        <label title="Nombre de sauts depuis le départ">Niveau de représentation
          <select data-r="profondeur">${Array.from({ length: this.profondeurMax }, (_, i) => `<option value="${i + 1}" ${r.profondeur === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <button type="button" data-plus title="Augmenter le niveau de représentation">＋</button><button type="button" data-moins title="Diminuer le niveau de représentation">－</button>
        ${this.controlesReglages().map(controle).join('')}
        <span class="graphe-compte aide"></span>
        <span class="graphe-actions"><button type="button" data-ajuster title="Tout voir">⤢ Ajuster</button>
          <button type="button" data-disposer title="Replacer les nœuds déplacés">⟲ Disposer</button>
          <button type="button" data-svg title="Enregistrer l'image (SVG)">⬇ SVG</button>
          ${this.options.pleinEcran ? '<button type="button" data-plein title="Ouvrir le graphe dans sa page (Ctrl : nouvelle fenêtre)">⧉ Plein écran</button>' : ''}</span>
      </div>
      <div class="graphe-zone">
        <svg class="graphe-svg" xmlns="${NS}"><defs>
          <marker id="graphe-fleche" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--discret)"/></marker>
          <marker id="graphe-fleche-lien" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/></marker>
        </defs><g class="graphe-monde"><g class="graphe-aretes"></g><g class="graphe-noeuds"></g></g></svg>
        <aside class="graphe-panneau" hidden></aside>
        ${this.legende().length ? `<div class="graphe-legende">${this.legende().map((l) => `<span><i class="${l.classe ?? ''}" ${l.style ? `style="${l.style}"` : ''}></i>${echapper(l.libelle)}</span>`).join('')}</div>` : ''}
      </div></div>`;
    const c = this.conteneur;
    this.svg = c.querySelector('svg');
    this.monde = c.querySelector('.graphe-monde');
    c.querySelectorAll('[data-r]').forEach((el) => el.addEventListener('change', () => {
      this.reglages[el.dataset.r] = el.type === 'checkbox' ? el.checked : Number(el.value);
      this.#reglagesChanges();
    }));
    c.querySelector('[data-plus]').addEventListener('click', () => this.#profondeur(1));
    c.querySelector('[data-moins]').addEventListener('click', () => this.#profondeur(-1));
    c.querySelector('[data-ajuster]').addEventListener('click', () => this.ajuster());
    c.querySelector('[data-disposer]').addEventListener('click', () => { this.manuelles.clear(); this.#disposer(); this.rendre(); this.ajuster(); });
    c.querySelector('[data-svg]').addEventListener('click', () => this.exporter());
    c.querySelector('[data-plein]')?.addEventListener('click', (e) => this.options.pleinEcran(this.depart, this.reglages, e));
    this.#interactions();
  }

  #profondeur(d) {
    const p = Math.min(Math.max(this.reglages.profondeur + d, 1), this.profondeurMax);
    if (p === this.reglages.profondeur) return;
    this.reglages.profondeur = p;
    this.conteneur.querySelector('[data-r="profondeur"]').value = String(p);
    this.#reglagesChanges();
  }

  #reglagesChanges() {
    ecrirePreferences({ [this.cleReglages]: { ...this.reglages } });
    this.options.surReglages?.({ ...this.reglages });
    this.charger().catch((e) => this.erreur(e));
  }

  async charger({ garderVue = false } = {}) {
    this.graphe = await this.chargerGraphe(this.depart, this.reglages);
    this.#disposer();
    this.rendre();
    if (!garderVue) this.ajuster();
  }

  #disposer() {
    const { positions } = disposerGraphe(this.graphe, { ecartX: 210, ecartY: 120, enColonne: (n) => this.enColonne(n) });
    this.positions = positions;
    // Haut de chaque colonne (début du tronc commun) : plus petite ordonnée des nœuds en colonne au même x.
    const enColonne = this.graphe.noeuds.filter((x) => this.enColonne(x));
    const hauts = new Map();
    for (const n of enColonne) {
      const p = positions.get(n.cle);
      hauts.set(p.x, Math.min(hauts.get(p.x) ?? Infinity, p.y));
    }
    this.colonnes = new Map(enColonne.map((n) => [n.cle, hauts.get(positions.get(n.cle).x)]));
    for (const [k, p] of this.manuelles) if (this.positions.has(k)) this.positions.set(k, { ...this.positions.get(k), ...p });
  }

  // ---------------------------------------------------------------- rendu

  noeud(k) { return this.graphe.noeuds.find((n) => n.cle === k); }

  rendre() {
    const g = this.graphe;
    this.conteneur.querySelector('.graphe-compte').textContent = this.compte(g);
    this.monde.querySelector('.graphe-aretes').innerHTML = g.aretes.map((a) => this.#arete(a)).join('');
    this.monde.querySelector('.graphe-noeuds').innerHTML = g.noeuds.map((n) => this.#noeudSvg(n)).join('');
    this.#appliquerSelection();
  }

  #extremites(a) {
    const p1 = this.positions.get(a.de), p2 = this.positions.get(a.vers);
    const n1 = this.noeud(a.de), n2 = this.noeud(a.vers);
    if (!p1 || !p2 || !n1 || !n2) return null;
    const d1 = this.dimensions(n1), d2 = this.dimensions(n2);
    const h1 = d1.h / 2, h2 = d2.h / 2;
    if (!this.enColonne(n1) && this.enColonne(n2)) {
      // Nœud en colonne : tronc vertical commun à gauche de la colonne, puis branche vers le nœud.
      const tronc = p2.x - d2.w / 2 - 12;
      const haut = (this.colonnes?.get(a.vers) ?? p2.y) - 22;
      const y1 = p1.y + h1, m = (y1 + haut) / 2;
      return { d: `M${p1.x},${y1} C${p1.x},${m} ${tronc},${m} ${tronc},${haut} L${tronc},${p2.y} L${p2.x - d2.w / 2},${p2.y}`,
        mx: p2.x + d2.w / 2 + 6, my: p2.y + 3, ancre: 'start' };
    }
    if (Math.abs(p1.y - p2.y) < 1) {
      // Même couche : arc au-dessus des nœuds.
      const y = p1.y - h1;
      const haut = y - 40 - Math.min(Math.abs(p2.x - p1.x) / 6, 60);
      return { d: `M${p1.x},${y} C${p1.x},${haut} ${p2.x},${haut} ${p2.x},${p2.y - h2}`, mx: (p1.x + p2.x) / 2, my: haut + 12 };
    }
    const [h, b, hh, hb] = p1.y < p2.y ? [p1, p2, h1, h2] : [p2, p1, h2, h1];
    const y1 = h.y + hh, y2 = b.y - hb, m = (y1 + y2) / 2;
    const d = `M${h.x},${y1} C${h.x},${m} ${b.x},${m} ${b.x},${y2}`;
    return { d: p1.y < p2.y ? d : `M${b.x},${y2} C${b.x},${m} ${h.x},${m} ${h.x},${y1}`, mx: (h.x + b.x) / 2, my: m };
  }

  #arete(a) {
    const e = this.#extremites(a);
    if (!e) return '';
    const l = this.libelleArete(a);
    const libelle = l ? `<text x="${e.mx}" y="${e.my}" text-anchor="${e.ancre ?? 'middle'}" class="graphe-libelle ${l.secondaire ? 'secondaire' : ''}" font-size="10" fill="${l.couleur ?? 'var(--discret)'}"
          paint-order="stroke" stroke="var(--surface)" stroke-width="3">${echapper(tronquer(l.texte, 28))}</text>` : '';
    return `<g class="graphe-arete" data-arete="${a.cle}" data-de="${a.de}" data-vers="${a.vers}" ${a.actif === false ? 'opacity="0.45"' : ''}>
      <path d="${e.d}" fill="none" ${this.styleArete(a)} ${a.actif === false ? 'stroke-dasharray="2 3"' : ''}/>${libelle}<title>${echapper(`${this.noeud(a.de)?.libelle} → ${this.noeud(a.vers)?.libelle}${a.libelle ? ` : ${a.libelle}` : ''}`)}</title></g>`;
  }

  /** Bulle du nœud. */
  titreNoeud(n) { return [n.libelle, n.sous_titre].filter(Boolean).join(' – '); }

  #noeudSvg(n) {
    const p = this.positions.get(n.cle);
    const { w, h } = this.dimensions(n);
    const bord = n.depart ? 'stroke="var(--accent)" stroke-width="3"' : 'stroke="var(--bord)" stroke-width="1.2"';
    const corps = this.corpsNoeud(n, { x: p.x - w / 2, y: p.y - h / 2, w, h, bord, cx: p.x });
    return `<g class="graphe-noeud" data-cle="${n.cle}" ${n.actif === false ? 'opacity="0.5"' : ''} style="cursor:pointer">${corps}<title>${echapper(this.titreNoeud(n))}</title></g>`;
  }

  // ---------------------------------------------------------------- sélection et panneau

  /** Mise en évidence : nœud survolé ou choisi et ses voisins ; le reste estompé. */
  #surligner(k) {
    const v = k ? voisinage(this.graphe, k) : null;
    this.monde.querySelectorAll('.graphe-noeud').forEach((el) => el.classList.toggle('estompe', !!v && !v.noeuds.has(el.dataset.cle)));
    this.monde.querySelectorAll('.graphe-arete').forEach((el) => {
      el.classList.toggle('estompe', !!v && !v.aretes.has(el.dataset.arete));
      el.classList.toggle('active', !!v && v.aretes.has(el.dataset.arete));
    });
  }

  #appliquerSelection() {
    this.monde.querySelectorAll('.graphe-noeud').forEach((el) => el.classList.toggle('choisi', el.dataset.cle === this.selection));
    this.#surligner(this.selection);
    const panneau = this.conteneur.querySelector('.graphe-panneau');
    const n = this.selection && this.noeud(this.selection);
    panneau.hidden = !n;
    if (!n) return;
    const voisins = this.graphe.aretes.filter((a) => a.de === n.cle || a.vers === n.cle).map((a) => {
      const autre = this.noeud(a.de === n.cle ? a.vers : a.de);
      return `<li><small class="aide">${echapper(this.relationVoisin(a, n))}</small> <a href="#" data-voisin="${autre?.cle}">${echapper(autre?.libelle ?? '')}</a></li>`;
    });
    const boutons = this.boutonsNoeud(n);
    panneau.innerHTML = `<header><b>${echapper(n.icone ?? '')} ${echapper(n.libelle)}</b><button type="button" data-fermer title="Fermer">✕</button></header>
      ${this.infosNoeud(n)}
      ${boutons.length ? `<p class="graphe-boutons">${boutons.map((b, i) => `<button type="button" data-bouton="${i}" ${b.titre ? `title="${echapper(b.titre)}"` : ''}>${echapper(b.libelle)}</button>`).join('')}</p>` : ''}
      ${voisins.length ? `<ul class="graphe-voisins">${voisins.join('')}</ul>` : ''}`;
    panneau.querySelector('[data-fermer]').addEventListener('click', () => { this.selection = null; this.#appliquerSelection(); });
    panneau.querySelectorAll('[data-bouton]').forEach((el) => el.addEventListener('click', (e) => boutons[Number(el.dataset.bouton)].action(e)));
    panneau.querySelectorAll('[data-voisin]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.selection = a.dataset.voisin; this.#appliquerSelection(); }));
  }

  /** Nouveau départ (la page peut changer d'adresse ; sinon rechargement sur place). */
  recentrer(depart) {
    if (this.options.recentrer) { this.options.recentrer(depart, this.reglages); return; }
    this.depart = depart;
    this.selection = null;
    this.manuelles.clear();
    this.charger().catch((e) => this.erreur(e));
  }

  /** Développement d'un nœud : ses voisins directs ajoutés au graphe affiché. */
  async developper(noeud, extra = {}) {
    const g = await this.developperGraphe(noeud, this.reglages, extra);
    this.graphe = this.fusionner(this.graphe, g);
    this.#disposer();
    this.rendre();
  }

  // ---------------------------------------------------------------- zoom, déplacements

  #appliquerVue() { this.monde.setAttribute('transform', `translate(${this.vue.x},${this.vue.y}) scale(${this.vue.k})`); }

  /** Cadrage de tout le graphe dans la zone. */
  ajuster() {
    const r = this.svg.getBoundingClientRect();
    const pts = [...this.positions.values()];
    if (!pts.length || !r.width) { this.#appliquerVue(); return; }
    const minX = Math.min(...pts.map((p) => p.x)) - 110, maxX = Math.max(...pts.map((p) => p.x)) + 110;
    const minY = Math.min(...pts.map((p) => p.y)) - 70, maxY = Math.max(...pts.map((p) => p.y)) + 40;
    const k = Math.min(r.width / (maxX - minX), r.height / (maxY - minY), 1.4);
    this.vue = { k, x: (r.width - (maxX + minX) * k) / 2, y: (r.height - (maxY + minY) * k) / 2 };
    this.#appliquerVue();
  }

  #interactions() {
    const svg = this.svg;
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.min(Math.max(this.vue.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.15), 3);
      this.vue = { k, x: mx - ((mx - this.vue.x) * k) / this.vue.k, y: my - ((my - this.vue.y) * k) / this.vue.k };
      this.#appliquerVue();
    }, { passive: false });
    let glisse = null;
    svg.addEventListener('pointerdown', (e) => {
      const n = e.target.closest('.graphe-noeud');
      glisse = { n: n?.dataset.cle ?? null, x0: e.clientX, y0: e.clientY, vue: { ...this.vue }, p: n ? { ...this.positions.get(n.dataset.cle) } : null, bouge: false };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!glisse) {
        const n = e.target.closest?.('.graphe-noeud');
        if (!this.selection) this.#surligner(n?.dataset.cle ?? null);
        return;
      }
      const dx = e.clientX - glisse.x0, dy = e.clientY - glisse.y0;
      if (Math.abs(dx) + Math.abs(dy) > 3) glisse.bouge = true;
      if (!glisse.bouge) return;
      if (glisse.n) {
        // Nœud déplacé à la main : sa position est gardée jusqu'à « Disposer ».
        const p = { x: glisse.p.x + dx / this.vue.k, y: glisse.p.y + dy / this.vue.k };
        this.positions.set(glisse.n, { ...this.positions.get(glisse.n), ...p });
        this.manuelles.set(glisse.n, p);
        this.#redessinerNoeud(glisse.n);
      } else {
        this.vue = { ...glisse.vue, x: glisse.vue.x + dx, y: glisse.vue.y + dy };
        this.#appliquerVue();
      }
    });
    svg.addEventListener('pointerup', () => {
      const g = glisse;
      glisse = null;
      if (!g || g.bouge) return;
      this.selection = g.n;
      this.#appliquerSelection();
    });
    // Double-clic sur un nœud : ouverture de sa fiche (Ctrl : nouvelle fenêtre).
    svg.addEventListener('dblclick', (e) => {
      const k = e.target.closest('.graphe-noeud')?.dataset.cle;
      const n = k && this.noeud(k);
      if (n && this.peutOuvrir(n)) this.options.ouvrir(n, e);
    });
    svg.addEventListener('pointerleave', () => { if (!glisse && !this.selection) this.#surligner(null); });
  }

  #redessinerNoeud(k) {
    const el = this.monde.querySelector(`.graphe-noeud[data-cle="${k}"]`);
    if (el) el.outerHTML = this.#noeudSvg(this.noeud(k));
    for (const a of this.graphe.aretes.filter((x) => x.de === k || x.vers === k)) {
      const ea = this.monde.querySelector(`.graphe-arete[data-arete="${a.cle}"]`);
      if (ea) ea.outerHTML = this.#arete(a);
    }
    this.#appliquerSelection();
  }

  /** Image SVG autonome (couleurs du thème résolues). */
  exporter() {
    const style = getComputedStyle(document.documentElement);
    const vars = ['--surface', '--fond', '--texte', '--discret', '--bord', '--accent'].map((v) => `${v}:${style.getPropertyValue(v).trim()}`).join(';');
    const pts = [...this.positions.values()];
    const minX = Math.min(...pts.map((p) => p.x)) - 110, maxX = Math.max(...pts.map((p) => p.x)) + 110;
    const minY = Math.min(...pts.map((p) => p.y)) - 70, maxY = Math.max(...pts.map((p) => p.y)) + 40;
    const copie = this.svg.cloneNode(true);
    copie.querySelector('.graphe-monde').removeAttribute('transform');
    copie.querySelectorAll('.estompe').forEach((el) => el.classList.remove('estompe'));
    copie.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    copie.setAttribute('width', String(Math.round(maxX - minX)));
    copie.setAttribute('height', String(Math.round(maxY - minY)));
    copie.setAttribute('style', `${vars};background:${style.getPropertyValue('--surface').trim()};font-family:system-ui,sans-serif`);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copie)], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = this.nomExport();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
