import { echapper, ouvrirMenuContextuel } from '@logibtp/socle/ui';

// Panneau des vues (ergonomie L1) : arbre groupe › thème › vues enregistrées, à droite de la liste, à la place des
// combos du thème et de la vue. Clic sur un thème : sa vue par défaut (★ de l'utilisateur, sinon celle de
// l'administrateur, sinon la première) ; le triangle déplie les vues sans en ouvrir. Largeur au glisser, réduit en un
// bouton ; état gardé dans les préférences de la liste (navigateur).

const PARTAGES = { P: ['👤', 'Vue personnelle'], G: ['👥', 'Vue du groupe'], T: ['', 'Vue de tous'] };
const LARGEUR = { min: 160, max: 480, defaut: 230 };
const SANS_THEME = '';

export class PanneauVues {
  /**
   * conteneur : <aside> du panneau ; separateur : bord à glisser ; liste : ListeDonnees (thèmes, vues, ouverture) ;
   * prefs() / ecrire() : préférences de la liste ({ reduit, largeur, ouverts, defauts }).
   */
  constructor({ conteneur, separateur, liste, prefs, ecrire }) {
    this.conteneur = conteneur;
    this.separateur = separateur;
    this.liste = liste;
    this.prefs = prefs;
    this.ecrire = ecrire;
    this.toutes = [];
    this.filtre = '';
    conteneur.innerHTML = `
      <header>
        <button type="button" data-action="reduire-vues" class="bouton-icone"></button>
        <span class="liste-vues-titre">Vues</span>
        <button type="button" data-action="nouvelle-vue" class="bouton-icone" title="Nouvelle vue dans le thème courant" aria-label="Nouvelle vue">＋</button>
        <button type="button" data-action="themes" class="bouton-icone" title="Thèmes et vues… (administrateur)" aria-label="Thèmes et vues" hidden>⚙</button>
      </header>
      <input type="search" class="liste-vues-recherche" placeholder="Rechercher une vue…">
      <div class="liste-vues-arbre" role="tree"></div>`;
    this.arbre = conteneur.querySelector('.liste-vues-arbre');
    conteneur.querySelector('[data-action="reduire-vues"]').addEventListener('click', () => this.reduire(!this.etat().reduit));
    conteneur.querySelector('[data-action="nouvelle-vue"]').addEventListener('click', () => this.liste.concevoir(true));
    const themes = conteneur.querySelector('[data-action="themes"]');
    themes.hidden = !liste.peutGererThemes || liste.modeChoix;
    conteneur.querySelector('[data-action="nouvelle-vue"]').hidden = liste.modeChoix;
    themes.addEventListener('click', () => liste.gererThemes());
    conteneur.querySelector('.liste-vues-recherche').addEventListener('input', (e) => { this.filtre = e.target.value.trim().toLowerCase(); this.rendre(); });
    this.arbre.addEventListener('click', (e) => this.#clic(e));
    this.arbre.addEventListener('contextmenu', (e) => this.#menu(e));
    this.#glisser();
    // Écran étroit : réduit d'office tant que l'utilisateur n'a rien choisi.
    if (this.etat().reduit === undefined && (globalThis.innerWidth < 900 || liste.modeChoix)) this.etat().reduit = true;
    this.appliquer();
  }

  etat() {
    const p = this.prefs();
    p.panneauVues ??= {};
    return p.panneauVues;
  }

  /** Vue par défaut d'un thème : ★ de l'utilisateur, vue de l'administrateur, première vue. */
  vueParDefaut(theme, vues) {
    const ids = new Set(vues.map((v) => v.vli_id));
    const etoile = this.etat().defauts?.[theme ?? SANS_THEME];
    if (ids.has(etoile)) return etoile;
    const admin = Number(this.liste.themes.find((t) => t.thl_code === theme)?.thl_vli_defaut);
    if (ids.has(admin)) return admin;
    return vues[0]?.vli_id ?? null;
  }

  async rafraichir() {
    try { this.toutes = await this.liste.fournisseur.vues(this.liste.contexte, null); } catch { this.toutes = []; }
    this.rendre();
  }

  appliquer() {
    const e = this.etat();
    const largeur = Math.min(Math.max(Number(e.largeur) || LARGEUR.defaut, LARGEUR.min), LARGEUR.max);
    this.conteneur.closest('.liste')?.style.setProperty('--vues-largeur', `${largeur}px`);
    this.conteneur.classList.toggle('reduit', !!e.reduit);
    this.separateur.hidden = !!e.reduit;
    const b = this.conteneur.querySelector('[data-action="reduire-vues"]');
    b.textContent = e.reduit ? '☰' : '⇥';
    b.title = e.reduit ? 'Afficher le panneau des vues' : 'Réduire le panneau des vues';
  }

  reduire(reduit) {
    this.etat().reduit = reduit;
    this.ecrire();
    this.appliquer();
  }

  /** Thèmes dans l'ordre des menus de l'application (groupe), puis les vues sans thème. */
  #themes() {
    const l = this.liste;
    const themes = l.themes.filter((t) => !l.themeFixe || t.thl_code === l.themeFixe).map((t, i) => ({ t, g: l.groupeTheme?.(t) ?? null, i }))
      .sort((a, b) => (a.g?.ordre ?? 1e6 + a.i) - (b.g?.ordre ?? 1e6 + b.i));
    const res = themes.map(({ t, g }) => ({ code: t.thl_code, libelle: t.thl_libelle, icone: t.thl_icone, groupe: l.groupeTheme ? g?.groupe ?? 'Autres' : null }));
    if (!l.themeFixe && this.toutes.some((v) => !v.vli_theme || !l.themes.some((t) => t.thl_code === v.vli_theme))) {
      res.push({ code: SANS_THEME, libelle: 'Sans thème', icone: '📋', groupe: l.groupeTheme ? 'Autres' : null });
    }
    return res;
  }

  #vuesDe(code) {
    const connus = new Set(this.liste.themes.map((t) => t.thl_code));
    return this.toutes.filter((v) => (code === SANS_THEME ? !v.vli_theme || !connus.has(v.vli_theme) : v.vli_theme === code));
  }

  rendre() {
    const l = this.liste;
    const e = this.etat();
    const ouverts = new Set(e.ouverts ?? []);
    const courant = l.theme ?? SANS_THEME;
    const vueCourante = l.vue?.vli_id ?? null;
    const mots = this.filtre.split(/\s+/).filter(Boolean);
    const correspond = (texte) => mots.every((m) => texte.toLowerCase().includes(m));
    let groupe = null;
    const html = [];
    for (const t of this.#themes()) {
      const vues = this.#vuesDe(t.code);
      const vuesVisibles = mots.length ? vues.filter((v) => correspond(`${t.libelle} ${v.vli_nom}`)) : vues;
      if (mots.length && !vuesVisibles.length && !correspond(t.libelle)) continue;
      if (t.groupe && t.groupe !== groupe) { groupe = t.groupe; html.push(`<div class="liste-vues-groupe">${echapper(groupe)}</div>`); }
      const ouvert = mots.length > 0 || ouverts.has(t.code) || t.code === courant;
      const defaut = this.vueParDefaut(t.code, vues);
      html.push(`<div class="liste-vues-theme${t.code === courant ? ' courant' : ''}" role="treeitem" aria-expanded="${ouvert}" data-theme="${echapper(t.code)}"
          title="Ouvrir la vue par défaut du thème">
          <button type="button" class="liste-vues-deplier" data-deplier tabindex="-1" aria-label="Déplier">${vues.length ? (ouvert ? '▾' : '▸') : ''}</button>
          <span class="liste-vues-icone">${echapper(t.icone ?? '📋')}</span><span class="liste-vues-nom">${echapper(t.libelle)}</span>
          <small>${vues.length || ''}</small></div>`);
      if (!ouvert) continue;
      for (const v of vuesVisibles) {
        const [icone, partage] = PARTAGES[v.vli_partage] ?? ['', ''];
        const etoile = e.defauts?.[t.code] === v.vli_id;
        html.push(`<div class="liste-vues-vue${v.vli_id === vueCourante ? ' courante' : ''}" role="treeitem" data-vue="${v.vli_id}" data-theme="${echapper(t.code)}"
            title="${echapper(`${partage}${v.vli_proprietaire ? ` de ${v.vli_proprietaire}` : ''}`)}">
            <span class="liste-vues-nom">${echapper(v.vli_nom)}</span>${icone ? `<span class="liste-vues-partage">${icone}</span>` : ''}
            <button type="button" class="bouton-icone liste-vues-etoile${etoile ? ' marquee' : ''}" data-etoile tabindex="-1"
              title="${etoile ? 'Vue par défaut du thème (vous) : cliquer pour retirer' : v.vli_id === defaut ? 'Vue par défaut du thème : cliquer pour la marquer comme la vôtre' : 'Ouvrir cette vue d\'un clic sur le thème'}">${etoile ? '★' : v.vli_id === defaut ? '✩' : '☆'}</button>
            <button type="button" class="bouton-icone" data-modifier tabindex="-1" title="Modifier la vue">✎</button></div>`);
      }
    }
    this.arbre.innerHTML = html.join('') || '<p class="aide">Aucune vue</p>';
    this.arbre.querySelector('.courante')?.scrollIntoView?.({ block: 'nearest' });
  }

  async #clic(e) {
    const el = e.target.closest('[data-theme]');
    if (!el) return;
    const theme = el.dataset.theme;
    const code = theme === SANS_THEME ? null : theme;
    try {
      if (e.target.closest('[data-deplier]')) { this.#basculer(theme); return; }
      if (e.target.closest('[data-etoile]')) { this.#etoile(theme, Number(el.dataset.vue)); return; }
      if (el.dataset.vue) {
        await this.liste.ouvrirVueDuTheme(code, Number(el.dataset.vue));
        if (e.target.closest('[data-modifier]')) this.liste.concevoir(false);
        return;
      }
      await this.liste.choisirTheme(code);
    } catch (x) { this.liste.message(x.message ?? String(x), 'erreur'); }
  }

  #menu(e) {
    const el = e.target.closest('[data-vue]');
    if (!el) return;
    const theme = el.dataset.theme;
    const id = Number(el.dataset.vue);
    const ouvrir = () => this.liste.ouvrirVueDuTheme(theme === SANS_THEME ? null : theme, id);
    if (this.liste.modeChoix) { ouvrirMenuContextuel(e, [{ libelle: '★ Vue par défaut du thème (pour moi)', action: () => this.#etoile(theme, id) }], { aide: false }); return; }
    ouvrirMenuContextuel(e, [
      { libelle: '★ Vue par défaut du thème (pour moi)', action: () => this.#etoile(theme, id) },
      { libelle: '✎ Modifier la vue…', action: async () => { await ouvrir(); this.liste.concevoir(false); } },
      { libelle: '⧉ Enregistrer sous…', action: async () => { await ouvrir(); this.liste.concevoir(true); } },
      { libelle: '＋ Nouvelle vue dans ce thème…', action: async () => { await ouvrir(); this.liste.concevoir(true); } },
    ], { aide: false });
  }

  #basculer(theme) {
    const e = this.etat();
    const ouverts = new Set(e.ouverts ?? []);
    if (ouverts.has(theme)) ouverts.delete(theme); else ouverts.add(theme);
    e.ouverts = [...ouverts];
    this.ecrire();
    this.rendre();
  }

  #etoile(theme, id) {
    const e = this.etat();
    e.defauts = { ...e.defauts };
    if (e.defauts[theme] === id) delete e.defauts[theme]; else e.defauts[theme] = id;
    this.ecrire();
    this.rendre();
  }

  #glisser() {
    const sep = this.separateur;
    sep.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sep.setPointerCapture(e.pointerId);
      const droite = this.conteneur.getBoundingClientRect().right;
      const bouger = (ev) => { this.etat().largeur = Math.round(Math.min(Math.max(droite - ev.clientX, LARGEUR.min), LARGEUR.max)); this.appliquer(); };
      const finir = () => {
        sep.removeEventListener('pointermove', bouger);
        sep.removeEventListener('pointerup', finir);
        this.ecrire();
      };
      sep.addEventListener('pointermove', bouger);
      sep.addEventListener('pointerup', finir);
    });
    sep.addEventListener('dblclick', () => this.reduire(true));
  }
}
