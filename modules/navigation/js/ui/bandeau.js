import { echapper, ouvrirDialogue, EVENEMENT_NOTIFICATION, formatHeure, declarerRaccourcis, actionDe, touchesDe } from '@logibtp/socle/ui';
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';

/** Messages gardés pour l'historique du bandeau (I4). */
const MAX_HISTORIQUE = 30;

// Bandeau fixé en haut de chaque page : logo (accueil) à gauche, menus déroulants à la manière des anciens programmes
// Windows (clic ou Alt + lettre soulignée, survol pour passer d'un menu à l'autre, flèches, Entrée, Échap), sous-menus
// (survol ou →), zone d'information (société, mode, messages) à droite. Bandeau trop étroit : libellés courts.
//
// menus : [{ code, libelle: '&Ressources' (lettre d'accès après &), court: 'Res.' (écran étroit), elements: [...] ou () => [...] }]
// élément : { libelle, icone (texte) ou iconeHtml (HTML sûr de iconeHtml du dictionnaire : emoji ou image), url, action, separateur, desactive, info, raccourci, coche, fenetre (⧉ proposé,
//             vrai par défaut pour une URL), titre (bulle), creation ({ url, titre } : bouton ＋ de création rapide
//             sur la même ligne ; Ctrl : nouvelle fenêtre), sousMenu ([...] ou () => [...] : éléments du sous-menu) }
// naviguer(url, { nouvelleFenetre }) : navigation demandée (Ctrl, Maj ou clic milieu, ou ⧉ : nouvelle fenêtre).
//
// Disposition (`disposition`, `disposer()`) : mode 'haut' (bandeau ci-dessus, par défaut), 'droite' ou 'gauche'
// (panneau sur toute la hauteur, du côté choisi : titres des menus dépliés en dessous au clic, sous-menus imbriqués, lignes hautes pour le
// tactile, ascenseur s'il déborde, message et informations fixés en bas ; largeur réglable par la poignée du bord intérieur,
// masquable, masquage automatique à la sortie du survol). Les changements faits depuis le panneau (largeur, masquage)
// sont rendus par `surDisposition(disposition)` pour être gardés.

export const DISPOSITION_MENU = Object.freeze({ HAUT: 'haut', DROITE: 'droite', GAUCHE: 'gauche' });
export const DISPOSITION_DEFAUT = Object.freeze({ mode: DISPOSITION_MENU.HAUT, largeur: 280, masque: false, masquageAuto: false });
export const LARGEUR_MENU = Object.freeze({ min: 200, max: 600 });

const lettre = (libelle) => /&(.)/.exec(libelle)?.[1]?.toLowerCase() ?? null;
const sansEsperluette = (libelle) => libelle.replace(/&(.)/, '$1');

// Accès aux menus au clavier : groupe de raccourcis « menus » (personnalisable), une fonction par menu (son code),
// Alt + la lettre après & par défaut. La lettre soulignée est celle de la touche effective (Alt + une lettre du libellé).
const GROUPE_MENUS = 'menus';
/** Lettre de la touche effective d'un menu (Alt + un caractère), en minuscule ; null sinon. */
const lettreAcces = (m) => {
  const t = touchesDe(GROUPE_MENUS, m.code).find((x) => /^Alt\+.$/i.test(x));
  return t ? t.slice(-1).toLowerCase() : null;
};
/** Libellé avec la lettre d'accès soulignée : celle du & si elle est la touche effective, sinon sa première occurrence. */
const libelleHtml = (m) => {
  const l = lettreAcces(m);
  const texteLibelle = sansEsperluette(m.libelle);
  if (!l) return echapper(texteLibelle);
  const i = lettre(m.libelle) === l ? m.libelle.indexOf('&') : texteLibelle.toLowerCase().indexOf(l);
  if (i < 0) return echapper(texteLibelle);
  return `${echapper(texteLibelle.slice(0, i))}<u>${echapper(texteLibelle[i])}</u>${echapper(texteLibelle.slice(i + 1))}`;
};
/**
 * Déclare (ou complète) le groupe des menus : libellé sans &, Alt + lettre du & par défaut ; une lettre déjà prise par
 * un menu précédent ne donne pas de touche par défaut (le premier l'emporte, comme avant la personnalisation).
 */
const declarerMenus = (menus) => {
  const prises = new Set();
  declarerRaccourcis(GROUPE_MENUS, {
    libelle: texte('navigation.raccourcis.menus'),
    actions: Object.fromEntries((menus ?? []).map((m) => {
      const l = lettre(m.libelle);
      const libre = l && !prises.has(l);
      if (l) prises.add(l);
      return [m.code, { libelle: texte('navigation.raccourcis.menu', { menu: sansEsperluette(m.libelle) }), defaut: libre ? `Alt+${l.toUpperCase()}` : [] }];
    })),
  });
};
const liste = (e) => (typeof e === 'function' ? e() : e) ?? [];

export class Bandeau {
  /** `retour()` : retour à la page précédente (bouton ◀ après le logo), absent : pas de bouton. */
  constructor(conteneur, { menus, naviguer, logo = '', accueil = '/', titreApplication = 'LogiBTP', retour = null, disposition = {}, surDisposition = () => {} } = {}) {
    this.racine = conteneur;
    this.menus = menus;
    declarerMenus(menus);
    this.naviguer = naviguer;
    this.ouvert = null;
    // Niveaux ouverts : 0 = menu déroulant, 1 = sous-menu ; { el, elements, actif }.
    this.niveaux = [];
    this.disposition = { ...DISPOSITION_DEFAUT, ...disposition };
    this.surDisposition = surDisposition;
    // Panneau latéral : menus et sous-menus dépliés (chemins « code » ou « code/i/j »), éléments par chemin.
    this.deplies = new Set();
    this.lignes = new Map();
    this.racine.classList.add('bandeau');
    this.racine.innerHTML = `
      <a class="bandeau-logo" href="${echapper(accueil)}" title="${texteHtml('navigation.bandeau.accueil', { application: titreApplication })}">${logo || `<span class="bandeau-logo-texte">${echapper(titreApplication)}</span>`}</a>
      ${retour ? `<button type="button" class="bandeau-retour" title="${texteHtml('navigation.bandeau.retour')}" aria-label="${texteHtml('navigation.bandeau.retour')}">◀</button>` : ''}
      <span class="bandeau-outils">
        <button type="button" data-masquage-auto aria-pressed="false" title="${texteHtml('navigation.bandeau.masquage_auto')}">📌</button>
        <button type="button" data-masquer title="${texteHtml('navigation.bandeau.masquer')}" aria-label="${texteHtml('navigation.bandeau.masquer')}">⇥</button>
      </span>
      <nav class="bandeau-menus" role="menubar" aria-label="${texteHtml('navigation.bandeau.menu_principal')}"></nav>
      <span class="bandeau-message"><button type="button" class="bandeau-historique" title="${texteHtml('navigation.bandeau.historique')}" aria-label="${texteHtml('navigation.bandeau.historique')}" hidden>${iconeHtml('navigation_historique')}</button><span class="bandeau-message-texte" role="status"></span></span>
      <span class="bandeau-infos"></span>
      <div class="bandeau-deroulant" role="menu" hidden></div>
      <div class="bandeau-deroulant bandeau-sous-menu" role="menu" hidden></div>
      <div class="bandeau-poignee" title="${texteHtml('navigation.bandeau.largeur')}"></div>
      <button type="button" class="bandeau-languette" title="${texteHtml('navigation.bandeau.afficher')}" aria-label="${texteHtml('navigation.bandeau.afficher')}">☰</button>`;
    this.barre = this.racine.querySelector('.bandeau-menus');
    this.deroulant = this.racine.querySelector('.bandeau-deroulant');
    this.sous = this.racine.querySelector('.bandeau-sous-menu');
    this.racine.querySelector('.bandeau-logo').addEventListener('click', (e) => {
      e.preventDefault();
      this.naviguer(accueil, { nouvelleFenetre: e.ctrlKey || e.shiftKey });
    });
    this.racine.querySelector('.bandeau-retour')?.addEventListener('click', () => retour());
    // Historique des messages (I4) : ceux du bandeau et ceux de la fenêtre des messages du socle.
    this.historique = [];
    this.racine.querySelector('.bandeau-historique').addEventListener('click', () => this.afficherHistorique());
    this.racine.querySelector('.bandeau-message-texte').addEventListener('click', () => { if (this.historique.length) this.afficherHistorique(); });
    globalThis.addEventListener?.(EVENEMENT_NOTIFICATION, (e) => {
      const d = e.detail ?? {};
      this.historiser([d.titre, d.message, ...(d.details ?? []).map((x) => [x.libelle, x.message].filter(Boolean).join(' : '))].filter(Boolean).join(' — '), d.niveau);
    });
    this.#evenementsPanneau();
    this.barre.addEventListener('click', (e) => {
      if (this.vertical) { this.#clicVertical(e); return; }
      const b = e.target.closest('[data-menu]');
      if (b) this.ouvert === b.dataset.menu ? this.fermer() : this.ouvrir(b.dataset.menu);
    });
    this.barre.addEventListener('auxclick', (e) => { if (this.vertical && e.button === 1) this.#clicVertical(e, true); });
    this.barre.addEventListener('mouseover', (e) => {
      const b = e.target.closest('[data-menu]');
      if (b && this.ouvert && this.ouvert !== b.dataset.menu) this.ouvrir(b.dataset.menu);
    });
    [this.deroulant, this.sous].forEach((el, niveau) => {
      el.addEventListener('click', (e) => this.#clicElement(e, niveau));
      el.addEventListener('auxclick', (e) => { if (e.button === 1) this.#clicElement(e, niveau, true); });
      el.addEventListener('mousemove', (e) => {
        const li = e.target.closest('[data-index]');
        if (!li) return;
        const i = Number(li.dataset.index);
        if (this.niveaux[niveau]?.actif === i) return;
        this.#surligner(niveau, i);
        if (niveau === 0) this.#survolSous(i);
      });
    });
    this.fermetureExterieure = (e) => {
      if (this.racine.contains(e.target)) return;
      if (this.ouvert) this.fermer();
      if (this.racine.classList.contains('bandeau-survol')) this.#replier();
    };
    document.addEventListener('pointerdown', this.fermetureExterieure, true);
    this.clavier = (e) => this.#clavier(e);
    document.addEventListener('keydown', this.clavier, true);
    document.addEventListener('keyup', (e) => {
      // Alt seul (pressé puis relâché sans autre touche) : accès au menu, comme sous Windows.
      if (e.key === 'Alt' && this.altSeul) { e.preventDefault(); this.ouvert ? this.fermer() : this.#focaliserBarre(); }
      this.altSeul = false;
    }, true);
    // Bandeau trop étroit pour les libellés complets : libellés courts (`court`) des menus qui en ont.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.ajuster()).observe(this.racine);
    this.disposer(this.disposition);
  }

  /** Panneau sur toute la hauteur, à droite ou à gauche. */
  get vertical() { return this.disposition.mode === DISPOSITION_MENU.DROITE || this.disposition.mode === DISPOSITION_MENU.GAUCHE; }
  get aGauche() { return this.disposition.mode === DISPOSITION_MENU.GAUCHE; }

  /** Applique une disposition ({ mode, largeur, masque, masquageAuto }, complétée par la disposition courante). */
  disposer(disposition = {}) {
    const avant = this.disposition.mode;
    this.disposition = { ...this.disposition, ...disposition };
    const d = this.disposition;
    d.largeur = Math.round(Math.max(LARGEUR_MENU.min, Math.min(LARGEUR_MENU.max, Number(d.largeur) || DISPOSITION_DEFAUT.largeur)));
    if (avant !== d.mode) this.fermer();
    const r = this.racine;
    r.classList.toggle('bandeau-vertical', this.vertical);
    r.classList.toggle('bandeau-gauche', this.aGauche);
    r.classList.toggle('bandeau-masque', this.vertical && d.masque && !d.masquageAuto);
    r.classList.toggle('bandeau-auto', this.vertical && d.masquageAuto);
    if (!this.vertical || !d.masquageAuto) r.classList.remove('bandeau-survol');
    r.style.setProperty('--largeur-menu', `${d.largeur}px`);
    const auto = r.querySelector('[data-masquage-auto]');
    auto.setAttribute('aria-pressed', String(Boolean(d.masquageAuto)));
    auto.title = texte(d.masquageAuto ? 'navigation.bandeau.garder' : 'navigation.bandeau.masquage_auto');
    const masquer = r.querySelector('[data-masquer]');
    masquer.hidden = Boolean(d.masquageAuto);
    masquer.textContent = this.aGauche ? '⇤' : '⇥';
    if (avant !== d.mode || !this.rendu) this.rendre();
    else this.ajuster();
  }

  /** Disposition changée depuis le panneau : appliquée puis rendue au cœur pour être gardée. */
  #changerDisposition(changement) {
    this.disposer(changement);
    this.surDisposition({ ...this.disposition });
  }

  /** Panneau latéral : outils, poignée de largeur, languette, survol (masquage automatique). */
  #evenementsPanneau() {
    const r = this.racine;
    r.querySelector('[data-masquer]').addEventListener('click', () => this.#changerDisposition({ masque: true }));
    r.querySelector('[data-masquage-auto]').addEventListener('click', () => {
      const auto = !this.disposition.masquageAuto;
      this.#changerDisposition({ masquageAuto: auto, masque: false });
      if (auto) this.#deplier();
    });
    r.querySelector('.bandeau-languette').addEventListener('click', () => {
      if (this.disposition.masquageAuto) this.#deplier();
      else this.#changerDisposition({ masque: false });
    });
    // Masquage automatique : déplié au survol (ou au toucher de la languette), replié peu après la sortie de la souris.
    r.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && r.classList.contains('bandeau-auto')) this.#deplier(); });
    r.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || !r.classList.contains('bandeau-auto') || this.redimension) return;
      clearTimeout(this.minuterieRepli);
      this.minuterieRepli = setTimeout(() => this.#replier(), 350);
    });
    r.addEventListener('focusout', (e) => { if (r.classList.contains('bandeau-auto') && !r.contains(e.relatedTarget) && !r.matches(':hover')) this.#replier(); });
    const poignee = r.querySelector('.bandeau-poignee');
    poignee.addEventListener('dblclick', () => this.#changerDisposition({ largeur: DISPOSITION_DEFAUT.largeur }));
    poignee.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      poignee.setPointerCapture(e.pointerId);
      const depart = { x: e.clientX, largeur: this.disposition.largeur };
      this.redimension = true;
      document.body.classList.add('redim-x');
      const deplacer = (m) => this.disposer({ largeur: depart.largeur + (this.aGauche ? m.clientX - depart.x : depart.x - m.clientX) });
      const fin = () => {
        poignee.removeEventListener('pointermove', deplacer);
        this.redimension = false;
        document.body.classList.remove('redim-x');
        this.#changerDisposition({});
      };
      poignee.addEventListener('pointermove', deplacer);
      poignee.addEventListener('pointerup', fin, { once: true });
      poignee.addEventListener('pointercancel', fin, { once: true });
    });
  }

  #deplier() {
    clearTimeout(this.minuterieRepli);
    if (this.racine.classList.contains('bandeau-auto')) this.racine.classList.add('bandeau-survol');
  }

  #replier() {
    clearTimeout(this.minuterieRepli);
    this.racine.classList.remove('bandeau-survol');
  }

  /** Panneau masqué (à la main ou automatiquement) : affiché avant un accès au clavier. */
  #afficherPanneau() {
    if (this.disposition.masquageAuto) this.#deplier();
    else if (this.disposition.masque) this.#changerDisposition({ masque: false });
  }

  rendre() {
    this.rendu = true;
    declarerMenus(this.menus);
    if (this.vertical) { this.#rendreVertical(); return; }
    this.barre.innerHTML = this.menus.map((m) => `<button type="button" role="menuitem" aria-haspopup="true" data-menu="${echapper(m.code)}"${m.court ? ` title="${echapper(sansEsperluette(m.libelle))}"` : ''}>
      <span class="bandeau-long">${libelleHtml(m)}</span>${m.court ? `<span class="bandeau-court">${echapper(m.court)}</span>` : ''}</button>`).join('');
    this.#marquerOuvert();
    this.ajuster();
  }

  /**
   * Bandeau trop étroit : libellés courts des menus (`bandeau-compact`), puis s'ils ne suffisent pas, marges réduites,
   * informations tronquées et logo réduit à son icône (`bandeau-serre`).
   */
  ajuster() {
    const r = this.racine;
    const deborde = () => r.scrollWidth > r.clientWidth + 1;
    r.classList.remove('bandeau-compact', 'bandeau-serre');
    if (this.vertical) return;
    if (deborde()) r.classList.add('bandeau-compact');
    if (deborde()) r.classList.add('bandeau-serre');
  }

  /** Informations à droite (société, mode). */
  infos(html) {
    this.racine.querySelector('.bandeau-infos').innerHTML = html;
    this.ajuster();
  }

  message(contenu, niveau = 'info') {
    this.historiser(contenu, niveau);
    const zone = this.racine.querySelector('.bandeau-message-texte');
    zone.textContent = contenu;
    zone.title = contenu;
    zone.className = `bandeau-message-texte ${niveau}`;
    clearTimeout(this.minuterieMessage);
    this.minuterieMessage = setTimeout(() => { zone.textContent = ''; zone.removeAttribute('title'); zone.className = 'bandeau-message-texte'; }, niveau === 'erreur' ? 10000 : 6000);
  }

  /** Ajoute un message à l'historique (le plus récent en tête). */
  historiser(contenu, niveau = 'info') {
    if (!contenu) return;
    this.historique.unshift({ le: new Date(), niveau, texte: String(contenu) });
    this.historique.length = Math.min(this.historique.length, MAX_HISTORIQUE);
    this.racine.querySelector('.bandeau-historique').hidden = false;
  }

  /** Derniers messages de la fenêtre, du plus récent au plus ancien. */
  afficherHistorique() {
    const lignes = this.historique.map((m) => `<li class="${echapper(m.niveau)}"><time>${echapper(formatHeure(m.le.toISOString()))}</time> ${echapper(m.texte)}</li>`).join('');
    return ouvrirDialogue({
      titre: texte('navigation.bandeau.historique'), classe: 'bandeau-historique-fenetre',
      html: lignes ? `<ul class="bandeau-historique-liste">${lignes}</ul>` : `<p class="aide">${texteHtml('navigation.bandeau.historique_vide')}</p>`,
      boutons: [{ libelle: texte('commun.fermer'), principal: true, valeur: null }],
    });
  }

  #menu(code) { return this.menus.find((m) => m.code === code); }

  #html(elements) {
    return elements.map((x, i) => {
      if (x.separateur) return `<div class="bandeau-separateur" role="separator">${x.libelle ? `<span>${echapper(x.libelle)}</span>` : ''}</div>`;
      const fenetre = x.url && x.fenetre !== false && !x.desactive && !x.sousMenu;
      return `<div class="bandeau-element${x.desactive ? ' desactive' : ''}${x.sousMenu ? ' a-sous-menu' : ''}${x.classe ? ` ${echapper(x.classe)}` : ''}" role="menuitem" data-index="${i}"
          aria-disabled="${Boolean(x.desactive)}"${x.sousMenu ? ' aria-haspopup="true"' : ''} title="${echapper(x.titre ?? x.info ?? '')}">
        <span class="bandeau-coche">${x.coche ? '✓' : ''}</span>
        <span class="bandeau-icone">${x.iconeHtml ?? echapper(x.icone ?? '')}</span>
        <span class="bandeau-libelle">${echapper(x.libelle)}${x.info ? `<small>${echapper(x.info)}</small>` : ''}</span>
        <span class="bandeau-raccourci">${echapper(x.raccourci ?? '')}</span>
        ${x.creation && !x.desactive ? `<button type="button" class="bandeau-fenetre bandeau-creation" data-creation title="${texteHtml('navigation.bandeau.creation', { titre: x.creation.titre ?? texte('commun.creer') })}">＋</button>` : '<span></span>'}
        ${fenetre ? `<button type="button" class="bandeau-fenetre" data-fenetre title="${texteHtml('navigation.bandeau.nouvelle_fenetre')}">⧉</button>` : x.sousMenu ? '<span class="bandeau-fleche">▸</span>' : '<span></span>'}
      </div>`;
    }).join('') || `<div class="bandeau-vide">${texteHtml('navigation.bandeau.vide')}</div>`;
  }

  ouvrir(code) {
    const menu = this.#menu(code);
    if (!menu) return;
    this.#fermerSous();
    this.ouvert = code;
    const elements = liste(menu.elements);
    this.deroulant.innerHTML = this.#html(elements);
    this.niveaux = [{ el: this.deroulant, elements, actif: -1 }];
    const bouton = this.barre.querySelector(`[data-menu="${CSS.escape(code)}"]`);
    const r = bouton.getBoundingClientRect();
    const rr = this.racine.getBoundingClientRect();
    this.deroulant.style.left = '0px';
    this.deroulant.hidden = false;
    this.deroulant.style.left = `${Math.max(0, Math.min(r.left - rr.left, window.innerWidth - this.deroulant.offsetWidth - 4))}px`;
    this.#marquerOuvert();
  }

  /** Sous-menu de l'élément `i` du menu ouvert, à droite de l'élément (à gauche s'il déborde). */
  #ouvrirSous(i) {
    const x = this.niveaux[0]?.elements[i];
    if (!x?.sousMenu || x.desactive) return false;
    if (this.niveaux[1]?.parent === i) return true;
    const elements = liste(x.sousMenu);
    this.sous.innerHTML = this.#html(elements);
    this.niveaux[1] = { el: this.sous, elements, actif: -1, parent: i };
    const li = this.deroulant.querySelector(`[data-index="${i}"]`);
    const r = li.getBoundingClientRect();
    const rr = this.racine.getBoundingClientRect();
    // Placée en haut à gauche pour la mesurer sans élargir la page.
    this.sous.style.left = '0px';
    this.sous.style.top = '0px';
    this.sous.hidden = false;
    const droite = r.right - rr.left - 2;
    const gauche = r.left - rr.left - this.sous.offsetWidth + 2;
    this.sous.style.left = `${droite + this.sous.offsetWidth > window.innerWidth - 4 ? Math.max(0, gauche) : droite}px`;
    this.sous.style.top = `${Math.max(0, Math.min(r.top - rr.top - 3, window.innerHeight - rr.top - this.sous.offsetHeight - 4))}px`;
    li.classList.add('sous-ouvert');
    return true;
  }

  #fermerSous() {
    this.sous.hidden = true;
    this.deroulant.querySelectorAll('.sous-ouvert').forEach((el) => el.classList.remove('sous-ouvert'));
    this.niveaux.length = Math.min(this.niveaux.length, 1);
  }

  /** Survol d'un élément du menu : son sous-menu s'ouvre, celui d'un autre élément se ferme. */
  #survolSous(i) {
    if (this.niveaux[1] && this.niveaux[1].parent !== i) this.#fermerSous();
    this.#ouvrirSous(i);
  }

  fermer() {
    this.ouvert = null;
    this.#fermerSous();
    this.niveaux = [];
    this.deroulant.hidden = true;
    this.racine.classList.remove('acces-clavier');
    this.#marquerOuvert();
  }

  #marquerOuvert() {
    this.barre.querySelectorAll('[data-menu]').forEach((b) => b.classList.toggle('ouvert', b.dataset.menu === this.ouvert));
  }

  #focaliserBarre() {
    this.racine.classList.add('acces-clavier');
    if (this.vertical) { this.#afficherPanneau(); this.barre.querySelector('[data-ligne]')?.focus(); return; }
    this.barre.querySelector('[data-menu]')?.focus();
  }

  // ---------------------------------------------------------------- panneau latéral (droite ou gauche)

  /** Titres des menus, éléments des menus dépliés en dessous, sous-menus dépliés imbriqués (aucune fenêtre surgissante). */
  #rendreVertical() {
    const defilement = this.barre.scrollTop;
    this.lignes.clear();
    this.barre.setAttribute('role', 'tree');
    this.barre.innerHTML = this.menus.map((m) => {
      const ouvert = this.deplies.has(m.code);
      this.lignes.set(m.code, { menu: m });
      return `<div class="bandeau-groupe${ouvert ? ' ouvert' : ''}">
        <button type="button" class="bandeau-titre" role="treeitem" data-ligne="${echapper(m.code)}" aria-expanded="${ouvert}" tabindex="-1">
          <span class="bandeau-libelle">${libelleHtml(m)}</span><span class="bandeau-fleche">${ouvert ? '▾' : '▸'}</span></button>
        ${ouvert ? `<div role="group">${this.#htmlVertical(liste(m.elements), m.code, 1)}</div>` : ''}
      </div>`;
    }).join('');
    this.barre.scrollTop = defilement;
  }

  #htmlVertical(elements, parent, profondeur) {
    return elements.map((x, i) => {
      if (x.separateur) return `<div class="bandeau-separateur" role="separator">${x.libelle ? `<span>${echapper(x.libelle)}</span>` : ''}</div>`;
      const chemin = `${parent}/${i}`;
      this.lignes.set(chemin, { element: x });
      const ouvert = Boolean(x.sousMenu) && !x.desactive && this.deplies.has(chemin);
      const fenetre = x.url && x.fenetre !== false && !x.desactive && !x.sousMenu;
      return `<div class="bandeau-element${x.desactive ? ' desactive' : ''}${x.sousMenu ? ' a-sous-menu' : ''}${ouvert ? ' sous-ouvert' : ''}${x.classe ? ` ${echapper(x.classe)}` : ''}"
          role="treeitem" data-ligne="${echapper(chemin)}" tabindex="-1" style="--profondeur: ${profondeur}"
          aria-disabled="${Boolean(x.desactive)}"${x.sousMenu ? ` aria-expanded="${ouvert}"` : ''} title="${echapper(x.titre ?? x.info ?? '')}">
        <span class="bandeau-coche">${x.coche ? '✓' : ''}</span>
        <span class="bandeau-icone">${x.iconeHtml ?? echapper(x.icone ?? '')}</span>
        <span class="bandeau-libelle">${echapper(x.libelle)}${x.info ? `<small>${echapper(x.info)}</small>` : ''}</span>
        ${x.creation && !x.desactive ? `<button type="button" class="bandeau-fenetre bandeau-creation" data-creation tabindex="-1" title="${texteHtml('navigation.bandeau.creation', { titre: x.creation.titre ?? texte('commun.creer') })}">＋</button>` : '<span></span>'}
        ${fenetre ? `<button type="button" class="bandeau-fenetre" data-fenetre tabindex="-1" title="${texteHtml('navigation.bandeau.nouvelle_fenetre')}">⧉</button>` : x.sousMenu ? `<span class="bandeau-fleche">${ouvert ? '▾' : '▸'}</span>` : '<span></span>'}
      </div>${ouvert ? `<div role="group">${this.#htmlVertical(liste(x.sousMenu), chemin, profondeur + 1)}</div>` : ''}`;
    }).join('') || `<div class="bandeau-vide" style="--profondeur: ${profondeur}">${texteHtml('navigation.bandeau.vide')}</div>`;
  }

  /**
   * Déplie ou replie un menu ou un sous-menu, la ligne garde le focus. En accordéon : déplier un menu replie les autres
   * menus (un sous-menu, les autres sous-menus du même menu), avec leurs sous-menus.
   */
  #basculer(chemin, ouvrir = !this.deplies.has(chemin)) {
    const parent = (c) => (c.includes('/') ? c.slice(0, c.lastIndexOf('/')) : null);
    const replier = (racine) => [...this.deplies].filter((c) => c === racine || c.startsWith(`${racine}/`)).forEach((c) => this.deplies.delete(c));
    if (ouvrir) {
      [...this.deplies].filter((c) => c !== chemin && parent(c) === parent(chemin)).forEach(replier);
      this.deplies.add(chemin);
    } else replier(chemin);
    this.#rendreVertical();
    const ligne = this.#ligne(chemin);
    ligne?.focus({ preventScroll: true });
    // Menu déplié : son titre en haut, ses éléments en dessous ; sous-menu : rendu visible.
    if (ouvrir) (parent(chemin) ? ligne?.parentElement : ligne)?.scrollIntoView?.({ block: parent(chemin) ? 'nearest' : 'start' });
  }

  #ligne(chemin) { return this.barre.querySelector(`[data-ligne="${CSS.escape(chemin)}"]`); }

  #clicVertical(e, milieu = false) {
    const el = e.target.closest('[data-ligne]');
    if (!el) return;
    e.preventDefault();
    const chemin = el.dataset.ligne;
    const { menu, element: x } = this.lignes.get(chemin) ?? {};
    if (menu) { this.#basculer(chemin); return; }
    if (!x || x.desactive) return;
    const ctrl = milieu || e.ctrlKey || e.shiftKey || e.metaKey;
    if (e.target.closest('[data-creation]') && x.creation) { this.#apresChoix(); this.naviguer(x.creation.url, { nouvelleFenetre: ctrl }); return; }
    this.#executerVertical(chemin, ctrl || Boolean(e.target.closest('[data-fenetre]')));
  }

  #executerVertical(chemin, nouvelleFenetre = false) {
    const x = this.lignes.get(chemin)?.element;
    if (!x || x.desactive || x.separateur) return;
    if (x.sousMenu) { this.#basculer(chemin); return; }
    this.#apresChoix();
    if (x.action) {
      x.action({ nouvelleFenetre });
      // Coches et informations des menus construits à l'ouverture (thème…) : relues.
      if (this.vertical) this.#rendreVertical();
    } else if (x.url) this.naviguer(x.url, { nouvelleFenetre });
  }

  /** Après un choix : le panneau à masquage automatique se replie, le focus rend la main à la page. */
  #apresChoix() {
    this.racine.classList.remove('acces-clavier');
    if (this.barre.contains(document.activeElement)) document.activeElement.blur();
    this.#replier();
  }

  #clavierVertical(e) {
    if (e.altKey && !e.ctrlKey && e.key !== 'Alt') {
      if (e.key === 'Home') { e.preventDefault(); this.naviguer('/', { nouvelleFenetre: false }); return; }
      const m = this.#menuDe(e);
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      this.racine.classList.add('acces-clavier');
      this.#afficherPanneau();
      this.#basculer(m.code, true);
      this.#ligne(m.code)?.parentElement.querySelector('[role="group"] [data-ligne]:not([aria-disabled="true"])')?.focus();
      return;
    }
    const actuel = document.activeElement?.closest?.('[data-ligne]');
    if (!actuel || !this.barre.contains(actuel)) return;
    const chemin = actuel.dataset.ligne;
    const lignes = [...this.barre.querySelectorAll('[data-ligne]')];
    const i = lignes.indexOf(actuel);
    const aller = (k) => lignes[Math.max(0, Math.min(lignes.length - 1, k))]?.focus();
    const deplie = this.deplies.has(chemin);
    const extensible = Boolean(this.lignes.get(chemin)?.menu || this.lignes.get(chemin)?.element?.sousMenu);
    const parent = chemin.includes('/') ? chemin.slice(0, chemin.lastIndexOf('/')) : null;
    const touches = {
      ArrowDown: () => aller(i + 1), ArrowUp: () => aller(i - 1), Home: () => aller(0), End: () => aller(lignes.length - 1),
      ArrowRight: () => { if (extensible && !deplie) this.#basculer(chemin, true); else if (extensible) aller(i + 1); },
      ArrowLeft: () => { if (extensible && deplie) this.#basculer(chemin, false); else if (parent) this.#ligne(parent)?.focus(); },
      Enter: () => (this.lignes.get(chemin)?.menu ? this.#basculer(chemin) : this.#executerVertical(chemin, e.ctrlKey || e.shiftKey)),
      ' ': () => (this.lignes.get(chemin)?.menu ? this.#basculer(chemin) : this.#executerVertical(chemin, e.ctrlKey || e.shiftKey)),
      Escape: () => this.#apresChoix(),
    };
    if (touches[e.key] && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      touches[e.key]();
    }
  }

  #surligner(niveau, i) {
    const n = this.niveaux[niveau];
    if (!n) return;
    n.actif = i;
    n.el.querySelectorAll('[data-index]').forEach((el) => el.classList.toggle('actif', Number(el.dataset.index) === i));
  }

  #deplacer(sens, niveau = this.niveaux.length - 1) {
    const n = this.niveaux[niveau];
    const total = n?.elements.length ?? 0;
    for (let k = 1; k <= total; k++) {
      const i = (n.actif + sens * k + total * 2) % total;
      const x = n.elements[i];
      if (x && !x.separateur && !x.desactive) { this.#surligner(niveau, i); return; }
    }
  }

  #menuVoisin(sens) {
    const i = this.menus.findIndex((m) => m.code === this.ouvert);
    this.ouvrir(this.menus[(i + sens + this.menus.length) % this.menus.length].code);
    this.#deplacer(1);
  }

  #activer(niveau, i, nouvelleFenetre = false) {
    const x = this.niveaux[niveau]?.elements[i];
    if (!x || x.separateur || x.desactive) return;
    if (x.sousMenu) {
      if (this.#ouvrirSous(i)) this.#deplacer(1, 1);
      return;
    }
    this.fermer();
    if (x.action) x.action({ nouvelleFenetre });
    else if (x.url) this.naviguer(x.url, { nouvelleFenetre });
  }

  #clicElement(e, niveau, milieu = false) {
    const li = e.target.closest('[data-index]');
    if (!li) return;
    e.preventDefault();
    const nouvelleFenetre = Boolean(e.target.closest('[data-fenetre]')) || milieu || e.ctrlKey || e.shiftKey || e.metaKey;
    // ＋ : création rapide (fiche ou document du type de la liste).
    const x = this.niveaux[niveau]?.elements[Number(li.dataset.index)];
    if (e.target.closest('[data-creation]') && x?.creation) {
      this.fermer();
      this.naviguer(x.creation.url, { nouvelleFenetre: milieu || e.ctrlKey || e.shiftKey || e.metaKey });
      return;
    }
    this.#activer(niveau, Number(li.dataset.index), nouvelleFenetre);
  }

  #clavier(e) {
    // Fenêtre <dialog> au premier plan : le clavier lui appartient.
    if (document.activeElement?.closest?.('dialog[open]')) return;
    this.altSeul = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    if (this.vertical) { this.#clavierVertical(e); return; }
    if (e.altKey && !e.ctrlKey && e.key !== 'Alt') {
      if (e.key === 'Home') { e.preventDefault(); this.naviguer('/', { nouvelleFenetre: false }); return; }
      const m = this.#menuDe(e);
      if (m) { e.preventDefault(); e.stopPropagation(); this.ouvrir(m.code); this.#deplacer(1); }
      return;
    }
    const surBarre = this.barre.contains(document.activeElement);
    if (!this.ouvert && !surBarre) return;
    if (!this.ouvert && surBarre) {
      const boutons = [...this.barre.querySelectorAll('[data-menu]')];
      const i = boutons.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); boutons[(i + (e.key === 'ArrowRight' ? 1 : -1) + boutons.length) % boutons.length].focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); this.ouvrir(boutons[i].dataset.menu); this.#deplacer(1); }
      else if (e.key === 'Escape') { e.preventDefault(); document.activeElement.blur(); this.racine.classList.remove('acces-clavier'); }
      else {
        // Barre active (Alt seul) : la lettre soulignée seule ouvre son menu.
        const m = this.menus.find((x) => lettreAcces(x) === e.key.toLowerCase());
        if (m) { e.preventDefault(); this.ouvrir(m.code); this.#deplacer(1); }
      }
      return;
    }
    const niveau = this.niveaux.length - 1;
    const actif = this.niveaux[niveau]?.actif ?? -1;
    const touches = {
      ArrowDown: () => this.#deplacer(1), ArrowUp: () => this.#deplacer(-1),
      ArrowRight: () => { if (niveau > 0 || !this.#ouvrirSous(actif)) this.#menuVoisin(1); else this.#deplacer(1, 1); },
      ArrowLeft: () => { if (niveau > 0) this.#fermerSous(); else this.#menuVoisin(-1); },
      Enter: () => this.#activer(niveau, actif, e.ctrlKey || e.shiftKey),
      Escape: () => {
        if (niveau > 0) { this.#fermerSous(); return; }
        const code = this.ouvert;
        this.fermer();
        this.barre.querySelector(`[data-menu="${CSS.escape(code)}"]`)?.focus();
      },
      Tab: () => this.fermer(),
    };
    if (touches[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      touches[e.key]();
    }
  }

  /** Menu ouvert par un raccourci du groupe menus (Alt + lettre par défaut). */
  #menuDe(e) {
    const code = actionDe(e, GROUPE_MENUS);
    return code ? this.menus.find((m) => m.code === code) ?? null : null;
  }

  /** Libellé sans lettre d'accès (titres, listes de raccourcis). */
  static libelle(libelle) { return sansEsperluette(libelle); }
}
