import { echapper, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';
import { disposerGraphe, fusionnerGraphes, PROFONDEUR_MAX } from '../src/graphe.js';

// Graphe relationnel de l'annuaire (style des outils d'analyse de liens) : couches par niveau (groupes en haut, sociétés,
// établissements, agences, dépôts, puis contacts), hiérarchie, liens typés et rattachements. Niveau de représentation
// (profondeur, 1 à 5 sauts), contacts et liens affichables, zoom à la molette, déplacement du fond et des nœuds, survol qui
// met en évidence les voisins, panneau du nœud choisi (ouvrir la fiche, centrer, développer), export SVG.
// Réglages d'affichage gardés dans le navigateur (préférences), jamais en base.

const LARGEUR = { personne: 184, individu: 150, groupe: 120 };
const HAUTEUR = { personne: 46, individu: 30, groupe: 28 };
const COULEURS_RELATION = {
  CLIENT: '#2e9d5b', PROSPECT: '#7cc497', FOURNISSEUR: '#2f6fd1', LOUEUR: '#5b8fe0', SOUS_TRAITANT: '#e07b24', COTRAITANT: '#c99a2e',
  INTERIM: '#b5651d', ARCHITECTE: '#8b5cf6', MOE: '#7c3aed', BE: '#6d5bd0', BC: '#0f9fa8', MOA: '#d14d72', BANQUE: '#64748b', ASSURANCE: '#475569',
};
const PREFS = 'annuaireGraphe';
const tronquer = (t, n) => (String(t ?? '').length > n ? `${String(t).slice(0, n - 1)}…` : String(t ?? ''));
const NS = 'http://www.w3.org/2000/svg';

export class VueGraphe {
  /**
   * options : annuaire (graphe(type, id, options)) ; depart { type, id } ; referentiels { niveaux, casquettes } ;
   * ouvrirFiche({ type, id }, evenement) ; recentrer({ type, id }) (sinon recentrage sur place) ; pleinEcran() ;
   * surReglages(reglages) ; message ; reglages (profondeur…, sinon préférences du navigateur).
   */
  constructor(conteneur, options) {
    this.conteneur = conteneur;
    this.options = options;
    this.depart = options.depart;
    const p = { profondeur: 2, contacts: true, liens: true, max_contacts: 8, ...(lirePreferences()[PREFS] ?? {}), ...(options.reglages ?? {}) };
    this.reglages = { profondeur: Math.min(Math.max(Number(p.profondeur) || 2, 1), PROFONDEUR_MAX), contacts: p.contacts !== false, liens: p.liens !== false, max_contacts: Number(p.max_contacts) || 8 };
    this.vue = { x: 0, y: 0, k: 1 };
    this.manuelles = new Map();
    this.selection = null;
    this.#construire();
    this.charger().catch((e) => this.#erreur(e));
  }

  #erreur(e) { console.error(e); this.options.message?.(e.message ?? String(e), 'erreur'); }

  #construire() {
    const r = this.reglages;
    this.conteneur.innerHTML = `<div class="graphe">
      <div class="graphe-barre">
        <label title="Nombre de sauts depuis la fiche (hiérarchie, liens, contacts) ; les niveaux supérieurs restent affichés">Niveau de représentation
          <select data-r="profondeur">${Array.from({ length: PROFONDEUR_MAX }, (_, i) => `<option value="${i + 1}" ${r.profondeur === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <button type="button" data-plus title="Augmenter le niveau de représentation">＋</button><button type="button" data-moins title="Diminuer le niveau de représentation">－</button>
        <label><input type="checkbox" data-r="contacts" ${r.contacts ? 'checked' : ''}> Contacts</label>
        <label><input type="checkbox" data-r="liens" ${r.liens ? 'checked' : ''}> Liens</label>
        <label title="Au-delà, les contacts d'une personne sont résumés (« + N contacts »)">Contacts par personne
          <select data-r="max_contacts">${[4, 8, 15, 30, 100].map((n) => `<option ${r.max_contacts === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
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
        <div class="graphe-legende"><span><i class="l-hier"></i>Hiérarchie</span><span><i class="l-lien"></i>Lien</span><span><i class="l-rat"></i>Contact</span><span><i class="l-inactif"></i>Inactif</span></div>
      </div></div>`;
    const c = this.conteneur;
    this.svg = c.querySelector('svg');
    this.monde = c.querySelector('.graphe-monde');
    c.querySelectorAll('[data-r]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.r;
      this.reglages[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
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
    const p = Math.min(Math.max(this.reglages.profondeur + d, 1), PROFONDEUR_MAX);
    if (p === this.reglages.profondeur) return;
    this.reglages.profondeur = p;
    this.conteneur.querySelector('[data-r="profondeur"]').value = String(p);
    this.#reglagesChanges();
  }

  #reglagesChanges() {
    ecrirePreferences({ [PREFS]: { ...this.reglages } });
    this.options.surReglages?.({ ...this.reglages });
    this.charger().catch((e) => this.#erreur(e));
  }

  async charger({ garderVue = false } = {}) {
    this.graphe = await this.options.annuaire.graphe(this.depart.type, this.depart.id, this.reglages);
    this.#disposer();
    this.rendre();
    if (!garderVue) this.ajuster();
  }

  #disposer() {
    const { positions } = disposerGraphe(this.graphe, { ecartX: 210, ecartY: 120 });
    this.positions = positions;
    // Haut de la colonne de chaque contact (début du tronc commun) : plus petite ordonnée des contacts au même x.
    const hauts = new Map();
    for (const n of this.graphe.noeuds.filter((x) => x.type !== 'personne')) {
      const p = positions.get(n.cle);
      hauts.set(p.x, Math.min(hauts.get(p.x) ?? Infinity, p.y));
    }
    this.colonnes = new Map(this.graphe.noeuds.filter((x) => x.type !== 'personne').map((n) => [n.cle, hauts.get(positions.get(n.cle).x)]));
    for (const [k, p] of this.manuelles) if (this.positions.has(k)) this.positions.set(k, { ...this.positions.get(k), ...p });
  }

  // ---------------------------------------------------------------- rendu

  #noeud(k) { return this.graphe.noeuds.find((n) => n.cle === k); }

  #couleur(n) {
    if (n.type !== 'personne') return 'var(--discret)';
    const c = n.casquettes.find((x) => COULEURS_RELATION[x]);
    return c ? COULEURS_RELATION[c] : 'var(--bord)';
  }

  rendre() {
    const g = this.graphe;
    this.conteneur.querySelector('.graphe-compte').textContent = g.noeuds.length
      ? `${g.noeuds.filter((n) => n.type === 'personne').length} personne(s), ${g.noeuds.filter((n) => n.type === 'individu').length} contact(s), ${g.aretes.length} relation(s)` : 'Fiche introuvable';
    const aretes = this.monde.querySelector('.graphe-aretes');
    const noeuds = this.monde.querySelector('.graphe-noeuds');
    aretes.innerHTML = g.aretes.map((a) => this.#arete(a)).join('');
    noeuds.innerHTML = g.noeuds.map((n) => this.#noeudSvg(n)).join('');
    this.#appliquerSelection();
  }

  #extremites(a) {
    const p1 = this.positions.get(a.de), p2 = this.positions.get(a.vers);
    const n1 = this.#noeud(a.de), n2 = this.#noeud(a.vers);
    if (!p1 || !p2) return null;
    const h1 = HAUTEUR[n1.type] / 2, h2 = HAUTEUR[n2.type] / 2;
    if (n1.type === 'personne' && n2.type !== 'personne') {
      // Contact en colonne : tronc vertical commun à gauche de la colonne, puis branche vers le contact.
      const tronc = p2.x - LARGEUR[n2.type] / 2 - 12;
      const haut = (this.colonnes?.get(a.vers) ?? p2.y) - 22;
      const y1 = p1.y + h1, m = (y1 + haut) / 2;
      return { d: `M${p1.x},${y1} C${p1.x},${m} ${tronc},${m} ${tronc},${haut} L${tronc},${p2.y} L${p2.x - LARGEUR[n2.type] / 2},${p2.y}`,
        mx: p2.x + LARGEUR[n2.type] / 2 + 6, my: p2.y + 3, ancre: 'start' };
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
    const style = {
      hierarchie: 'stroke="var(--discret)" stroke-width="1.8" marker-end="url(#graphe-fleche)"',
      lien: 'stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="6 4" marker-end="url(#graphe-fleche-lien)"',
      rattachement: 'stroke="var(--discret)" stroke-width="1" opacity="0.7"',
      groupe: 'stroke="var(--discret)" stroke-width="1" stroke-dasharray="2 3"',
    }[a.type];
    const libelle = a.libelle && (a.type === 'lien' || a.type === 'rattachement')
      ? `<text x="${e.mx}" y="${e.my}" text-anchor="${e.ancre ?? 'middle'}" class="graphe-libelle ${a.type === 'rattachement' ? 'secondaire' : ''}" font-size="10" fill="${a.type === 'lien' ? 'var(--accent)' : 'var(--discret)'}"
          paint-order="stroke" stroke="var(--surface)" stroke-width="3">${echapper(tronquer(a.libelle, 28))}</text>` : '';
    return `<g class="graphe-arete" data-arete="${a.cle}" data-de="${a.de}" data-vers="${a.vers}" ${a.actif ? '' : 'opacity="0.45"'}>
      <path d="${e.d}" fill="none" ${style} ${a.actif ? '' : 'stroke-dasharray="2 3"'}/>${libelle}<title>${echapper(`${this.#noeud(a.de)?.libelle} → ${this.#noeud(a.vers)?.libelle}${a.libelle ? ` : ${a.libelle}` : ''}`)}</title></g>`;
  }

  #noeudSvg(n) {
    const p = this.positions.get(n.cle);
    const w = LARGEUR[n.type], h = HAUTEUR[n.type];
    const x = p.x - w / 2, y = p.y - h / 2;
    const bord = n.depart ? 'stroke="var(--accent)" stroke-width="3"' : 'stroke="var(--bord)" stroke-width="1.2"';
    const niveau = this.options.referentiels?.niveaux?.find((x2) => x2.code === n.niveau)?.libelle ?? n.niveau ?? '';
    const relations = (n.casquettes ?? []).map((c) => this.options.referentiels?.casquettes?.find((x2) => x2.code === c)?.icone ?? '').join('');
    const titre = `${n.libelle}${niveau ? ` – ${niveau}` : ''}${n.sous_titre ? ` – ${n.sous_titre}` : ''}`;
    let corps;
    if (n.type === 'personne') {
      corps = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="var(--surface)" ${bord}/>
        <rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${this.#couleur(n)}"/>
        <text x="${x + 14}" y="${y + 19}" font-size="13">${echapper(n.icone ?? '🏢')}</text>
        <text x="${x + 34}" y="${y + 19}" font-size="12" font-weight="600" fill="var(--texte)">${echapper(tronquer(n.libelle, 22))}</text>
        <text x="${x + 34}" y="${y + 35}" font-size="10" fill="var(--discret)">${echapper(tronquer([niveau, n.sous_titre].filter(Boolean).join(' · '), 22))}</text>
        ${relations ? `<text x="${x + w - 6}" y="${y + 35}" font-size="10" text-anchor="end">${echapper(relations)}</text>` : ''}`;
    } else if (n.type === 'individu') {
      corps = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="var(--fond)" ${bord}/>
        <text x="${x + 10}" y="${y + 20}" font-size="12">👤</text>
        <text x="${x + 28}" y="${y + 19}" font-size="11" fill="var(--texte)">${echapper(tronquer(n.libelle, 19))}</text>`;
    } else {
      corps = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="var(--fond)" stroke="var(--discret)" stroke-dasharray="3 3"/>
        <text x="${p.x}" y="${y + 18}" font-size="11" text-anchor="middle" fill="var(--discret)">👥 ${echapper(n.libelle)}</text>`;
    }
    return `<g class="graphe-noeud" data-cle="${n.cle}" ${n.actif ? '' : 'opacity="0.5"'} style="cursor:pointer">${corps}<title>${echapper(titre)}</title></g>`;
  }

  // ---------------------------------------------------------------- sélection et panneau

  #voisinage(k) {
    const v = new Set([k]);
    const a = new Set();
    for (const x of this.graphe.aretes) if (x.de === k || x.vers === k) { v.add(x.de); v.add(x.vers); a.add(x.cle); }
    return { noeuds: v, aretes: a };
  }

  /** Mise en évidence : nœud survolé ou choisi et ses voisins ; le reste estompé. */
  #surligner(k) {
    const v = k ? this.#voisinage(k) : null;
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
    const n = this.selection && this.#noeud(this.selection);
    panneau.hidden = !n;
    if (!n) return;
    const ref = this.options.referentiels ?? {};
    const niveau = ref.niveaux?.find((x) => x.code === n.niveau);
    const relations = (n.casquettes ?? []).map((c) => ref.casquettes?.find((x) => x.code === c)).filter(Boolean);
    const voisins = this.graphe.aretes.filter((a) => a.de === n.cle || a.vers === n.cle).map((a) => {
      const autre = this.#noeud(a.de === n.cle ? a.vers : a.de);
      const sens = a.type === 'hierarchie' ? (a.de === n.cle ? 'Niveau inférieur' : 'Niveau supérieur') : a.type === 'lien' ? `${a.libelle ?? 'Lien'}${a.vers === n.cle ? ' (vers cette fiche)' : ''}` : a.type === 'rattachement' ? (a.libelle ?? 'Contact') : 'Contacts';
      return `<li><small class="aide">${echapper(sens)}</small> <a href="#" data-voisin="${autre?.cle}">${echapper(autre?.libelle ?? '')}</a></li>`;
    });
    panneau.innerHTML = `<header><b>${echapper(n.icone ?? '')} ${echapper(n.libelle)}</b><button type="button" data-fermer title="Fermer">✕</button></header>
      <p class="aide">${n.type === 'personne' ? echapper(niveau?.libelle ?? n.niveau ?? '') : n.type === 'individu' ? 'Individu' : 'Contacts non affichés'}${n.sous_titre ? ` · ${echapper(n.sous_titre)}` : ''}
        · ${n.distance === 0 ? 'fiche de départ' : `à ${n.distance} saut${n.distance > 1 ? 's' : ''}`}${n.actif ? '' : ' · inactif'}</p>
      ${relations.length ? `<p class="annuaire-pastilles">${relations.map((r) => `<span class="pastille cochee">${echapper(r.icone ?? '')} ${echapper(r.libelle)}</span>`).join('')}</p>` : ''}
      <p class="graphe-boutons">${n.type !== 'groupe' ? '<button type="button" data-ouvrir>Ouvrir la fiche</button>' : ''}
        ${n.type !== 'groupe' && !n.depart ? '<button type="button" data-centrer title="Repartir de ce nœud">◎ Centrer ici</button>' : ''}
        ${n.type !== 'groupe' ? '<button type="button" data-developper title="Ajouter ses voisins directs au graphe">＋ Développer</button>' : '<button type="button" data-tous>Afficher tous les contacts</button>'}</p>
      ${voisins.length ? `<ul class="graphe-voisins">${voisins.join('')}</ul>` : ''}`;
    panneau.querySelector('[data-fermer]').addEventListener('click', () => { this.selection = null; this.#appliquerSelection(); });
    panneau.querySelector('[data-ouvrir]')?.addEventListener('click', (e) => this.options.ouvrirFiche?.({ type: n.type, id: n.id }, e));
    panneau.querySelector('[data-centrer]')?.addEventListener('click', () => this.recentrer({ type: n.type, id: n.id }));
    panneau.querySelector('[data-developper]')?.addEventListener('click', () => this.developper({ type: n.type, id: n.id }).catch((e) => this.#erreur(e)));
    panneau.querySelector('[data-tous]')?.addEventListener('click', () => this.developper({ type: 'personne', id: n.id }, { max_contacts: 200 }).catch((e) => this.#erreur(e)));
    panneau.querySelectorAll('[data-voisin]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.selection = a.dataset.voisin; this.#appliquerSelection(); }));
  }

  /** Nouveau départ (la page peut changer d'adresse ; sinon rechargement sur place). */
  recentrer(depart) {
    if (this.options.recentrer) { this.options.recentrer(depart, this.reglages); return; }
    this.depart = depart;
    this.selection = null;
    this.manuelles.clear();
    this.charger().catch((e) => this.#erreur(e));
  }

  /** Développement d'un nœud : ses voisins directs ajoutés au graphe affiché. */
  async developper(depart, extra = {}) {
    const g = await this.options.annuaire.graphe(depart.type, depart.id, { ...this.reglages, ...extra, profondeur: 1 });
    this.graphe = fusionnerGraphes(this.graphe, g);
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

  #point(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.vue.x) / this.vue.k, y: (e.clientY - r.top - this.vue.y) / this.vue.k };
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
    svg.addEventListener('pointerup', (e) => {
      const g = glisse;
      glisse = null;
      if (!g || g.bouge) return;
      this.selection = g.n;
      this.#appliquerSelection();
    });
    // Double-clic sur un nœud : ouverture de sa fiche (Ctrl : nouvelle fenêtre).
    svg.addEventListener('dblclick', (e) => {
      const k = e.target.closest('.graphe-noeud')?.dataset.cle;
      const n = k && this.#noeud(k);
      if (n && n.type !== 'groupe') this.options.ouvrirFiche?.({ type: n.type, id: n.id }, e);
    });
    svg.addEventListener('pointerleave', () => { if (!glisse && !this.selection) this.#surligner(null); });
  }

  #redessinerNoeud(k) {
    const el = this.monde.querySelector(`.graphe-noeud[data-cle="${k}"]`);
    if (el) el.outerHTML = this.#noeudSvg(this.#noeud(k));
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
    a.download = `graphe-${this.depart.type}-${this.depart.id}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
