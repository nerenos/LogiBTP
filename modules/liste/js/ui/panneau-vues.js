import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, ouvrirMenuContextuel } from '@logibtp/socle/ui';

// Panneau des vues (ergonomie L1) : arbre groupe › thème › vues enregistrées, à droite de la liste, à la place des
// combos du thème et de la vue. Clic sur un thème : sa vue par défaut (★ de l'utilisateur, sinon celle de
// l'administrateur, sinon la première) ; le triangle déplie les vues sans en ouvrir. Largeur au glisser, réduit en un
// bouton ; état gardé dans les préférences de la liste (navigateur).

/** Partage d'une vue : icône (vide : aucune) et libellé ; relus à chaque accès (dictionnaire). */
const partage = (code) => (['P', 'G', 'T'].includes(code) ? [icone(`liste_vues_partage_${code}`), texte(`liste.vues.partage.${code}`)] : ['', '']);
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
        <span class="liste-vues-titre">${texteHtml('liste.vues.titre')}</span>
        <button type="button" data-action="nouvelle-vue" class="bouton-icone" title="${texteHtml('liste.vues.nouvelle_aide')}" aria-label="${texteHtml('liste.vues.nouvelle')}">${iconeHtml('ajouter')}</button>
        <button type="button" data-action="themes" class="bouton-icone" title="${texteHtml('liste.vues.themes_aide')}" aria-label="${texteHtml('liste.vues.themes')}" hidden>${iconeHtml('liste_vues_themes')}</button>
      </header>
      <input type="search" class="liste-vues-recherche" placeholder="${texteHtml('liste.vues.rechercher')}">
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
    b.textContent = icone(e.reduit ? 'liste_vues_afficher' : 'liste_vues_reduire');
    b.title = texte(`liste.vues.${e.reduit ? 'afficher' : 'reduire'}`);
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
    const res = themes.map(({ t, g }) => ({ code: t.thl_code, libelle: t.thl_libelle, icone: t.thl_icone, groupe: l.groupeTheme ? g?.groupe ?? texte('liste.liste.themes_autres') : null }));
    if (!l.themeFixe && this.toutes.some((v) => !v.vli_theme || !l.themes.some((t) => t.thl_code === v.vli_theme))) {
      res.push({ code: SANS_THEME, libelle: texte('liste.vues.sans_theme'), icone: icone('liste_vues_theme'), groupe: l.groupeTheme ? texte('liste.liste.themes_autres') : null });
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
    const correspond = (t) => mots.every((m) => t.toLowerCase().includes(m));
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
          title="${texteHtml('liste.vues.ouvrir_theme')}">
          <button type="button" class="liste-vues-deplier" data-deplier tabindex="-1" aria-label="${texteHtml('liste.vues.deplier')}">${vues.length ? iconeHtml(ouvert ? 'liste_segment_deplie' : 'liste_segment_replie') : ''}</button>
          <span class="liste-vues-icone">${echapper(t.icone ?? icone('liste_vues_theme'))}</span><span class="liste-vues-nom">${echapper(t.libelle)}</span>
          <small>${vues.length || ''}</small></div>`);
      if (!ouvert) continue;
      for (const v of vuesVisibles) {
        const [picto, libellePartage] = partage(v.vli_partage);
        const etoile = e.defauts?.[t.code] === v.vli_id;
        html.push(`<div class="liste-vues-vue${v.vli_id === vueCourante ? ' courante' : ''}" role="treeitem" data-vue="${v.vli_id}" data-theme="${echapper(t.code)}"
            title="${echapper(v.vli_proprietaire ? texte('liste.vues.partage_de', { partage: libellePartage, proprietaire: v.vli_proprietaire }) : libellePartage)}">
            <span class="liste-vues-nom">${echapper(v.vli_nom)}</span>${picto ? `<span class="liste-vues-partage">${echapper(picto)}</span>` : ''}
            <button type="button" class="bouton-icone liste-vues-etoile${etoile ? ' marquee' : ''}" data-etoile tabindex="-1"
              title="${texteHtml(`liste.vues.etoile_${etoile ? 'retirer' : v.vli_id === defaut ? 'defaut' : 'marquer'}`)}">${iconeHtml(etoile ? 'liste_vues_etoile' : v.vli_id === defaut ? 'liste_vues_etoile_defaut' : 'liste_vues_etoile_vide')}</button>
            <button type="button" class="bouton-icone" data-modifier tabindex="-1" title="${texteHtml('liste.vues.modifier')}">${iconeHtml('liste_saisie')}</button></div>`);
      }
    }
    this.arbre.innerHTML = html.join('') || `<p class="aide">${texteHtml('liste.vues.aucune')}</p>`;
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
    const etoile = { libelle: `${icone('liste_vues_etoile')} ${texte('liste.vues.menu.defaut')}`, action: () => this.#etoile(theme, id) };
    if (this.liste.modeChoix) { ouvrirMenuContextuel(e, [etoile], { aide: false }); return; }
    ouvrirMenuContextuel(e, [
      etoile,
      { libelle: `${icone('liste_saisie')} ${texte('liste.vues.menu.modifier')}`, action: async () => { await ouvrir(); this.liste.concevoir(false); } },
      { libelle: `${icone('liste_copier')} ${texte('liste.vues.menu.enregistrer_sous')}`, action: async () => { await ouvrir(); this.liste.concevoir(true); } },
      { libelle: `${icone('ajouter')} ${texte('liste.vues.menu.nouvelle')}`, action: async () => { await ouvrir(); this.liste.concevoir(true); } },
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
