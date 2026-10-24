import { echapper } from '@logibtp/socle/ui';

// Bandeau fixé en haut de chaque page : logo (accueil) à gauche, menus déroulants à la manière des anciens programmes
// Windows (clic ou Alt + lettre soulignée, survol pour passer d'un menu à l'autre, flèches, Entrée, Échap), sous-menus
// (survol ou →), zone d'information (société, mode, messages) à droite. Bandeau trop étroit : libellés courts.
//
// menus : [{ code, libelle: '&Ressources' (lettre d'accès après &), court: 'Res.' (écran étroit), elements: [...] ou () => [...] }]
// élément : { libelle, icone, url, action, separateur, desactive, info, raccourci, coche, fenetre (⧉ proposé,
//             vrai par défaut pour une URL), titre (bulle), creation ({ url, titre } : bouton ＋ de création rapide
//             sur la même ligne ; Ctrl : nouvelle fenêtre), sousMenu ([...] ou () => [...] : éléments du sous-menu) }
// naviguer(url, { nouvelleFenetre }) : navigation demandée (Ctrl, Maj ou clic milieu, ou ⧉ : nouvelle fenêtre).

const lettre = (libelle) => /&(.)/.exec(libelle)?.[1]?.toLowerCase() ?? null;
const libelleHtml = (libelle) => echapper(libelle).replace(/&amp;(.)/, '<u>$1</u>');
const sansEsperluette = (libelle) => libelle.replace(/&(.)/, '$1');
const liste = (e) => (typeof e === 'function' ? e() : e) ?? [];

export class Bandeau {
  constructor(conteneur, { menus, naviguer, logo = '', accueil = '/', titreApplication = 'LogiBTP' } = {}) {
    this.racine = conteneur;
    this.menus = menus;
    this.naviguer = naviguer;
    this.ouvert = null;
    // Niveaux ouverts : 0 = menu déroulant, 1 = sous-menu ; { el, elements, actif }.
    this.niveaux = [];
    this.racine.classList.add('bandeau');
    this.racine.innerHTML = `
      <a class="bandeau-logo" href="${echapper(accueil)}" title="${echapper(titreApplication)} : accueil (Alt+Origine)">${logo || `<span class="bandeau-logo-texte">${echapper(titreApplication)}</span>`}</a>
      <nav class="bandeau-menus" role="menubar" aria-label="Menu principal"></nav>
      <span class="bandeau-message" role="status"></span>
      <span class="bandeau-infos"></span>
      <div class="bandeau-deroulant" role="menu" hidden></div>
      <div class="bandeau-deroulant bandeau-sous-menu" role="menu" hidden></div>`;
    this.barre = this.racine.querySelector('.bandeau-menus');
    this.deroulant = this.racine.querySelector('.bandeau-deroulant');
    this.sous = this.racine.querySelector('.bandeau-sous-menu');
    this.racine.querySelector('.bandeau-logo').addEventListener('click', (e) => {
      e.preventDefault();
      this.naviguer(accueil, { nouvelleFenetre: e.ctrlKey || e.shiftKey });
    });
    this.barre.addEventListener('click', (e) => {
      const b = e.target.closest('[data-menu]');
      if (b) this.ouvert === b.dataset.menu ? this.fermer() : this.ouvrir(b.dataset.menu);
    });
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
    this.fermetureExterieure = (e) => { if (this.ouvert && !this.racine.contains(e.target)) this.fermer(); };
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
    this.rendre();
  }

  rendre() {
    this.barre.innerHTML = this.menus.map((m) => `<button type="button" role="menuitem" aria-haspopup="true" data-menu="${echapper(m.code)}"${m.court ? ` title="${echapper(sansEsperluette(m.libelle))}"` : ''}>
      <span class="bandeau-long">${libelleHtml(m.libelle)}</span>${m.court ? `<span class="bandeau-court">${echapper(m.court)}</span>` : ''}</button>`).join('');
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
    if (deborde()) r.classList.add('bandeau-compact');
    if (deborde()) r.classList.add('bandeau-serre');
  }

  /** Informations à droite (société, mode). */
  infos(html) {
    this.racine.querySelector('.bandeau-infos').innerHTML = html;
    this.ajuster();
  }

  message(texte, niveau = 'info') {
    const zone = this.racine.querySelector('.bandeau-message');
    zone.textContent = texte;
    zone.title = texte;
    zone.className = `bandeau-message ${niveau}`;
    clearTimeout(this.minuterieMessage);
    this.minuterieMessage = setTimeout(() => { zone.textContent = ''; zone.className = 'bandeau-message'; }, niveau === 'erreur' ? 10000 : 6000);
  }

  #menu(code) { return this.menus.find((m) => m.code === code); }

  #html(elements) {
    return elements.map((x, i) => {
      if (x.separateur) return `<div class="bandeau-separateur" role="separator">${x.libelle ? `<span>${echapper(x.libelle)}</span>` : ''}</div>`;
      const fenetre = x.url && x.fenetre !== false && !x.desactive && !x.sousMenu;
      return `<div class="bandeau-element${x.desactive ? ' desactive' : ''}${x.sousMenu ? ' a-sous-menu' : ''}${x.classe ? ` ${echapper(x.classe)}` : ''}" role="menuitem" data-index="${i}"
          aria-disabled="${Boolean(x.desactive)}"${x.sousMenu ? ' aria-haspopup="true"' : ''} title="${echapper(x.titre ?? x.info ?? '')}">
        <span class="bandeau-coche">${x.coche ? '✓' : ''}</span>
        <span class="bandeau-icone">${echapper(x.icone ?? '')}</span>
        <span class="bandeau-libelle">${echapper(x.libelle)}${x.info ? `<small>${echapper(x.info)}</small>` : ''}</span>
        <span class="bandeau-raccourci">${echapper(x.raccourci ?? '')}</span>
        ${x.creation && !x.desactive ? `<button type="button" class="bandeau-fenetre bandeau-creation" data-creation title="${echapper(x.creation.titre ?? 'Créer')} (Ctrl : nouvelle fenêtre)">＋</button>` : '<span></span>'}
        ${fenetre ? '<button type="button" class="bandeau-fenetre" data-fenetre title="Ouvrir dans une nouvelle fenêtre (Ctrl+clic)">⧉</button>' : x.sousMenu ? '<span class="bandeau-fleche">▸</span>' : '<span></span>'}
      </div>`;
    }).join('') || '<div class="bandeau-vide">(vide)</div>';
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
    this.barre.querySelector('[data-menu]')?.focus();
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
    if (e.altKey && !e.ctrlKey && e.key !== 'Alt') {
      if (e.key === 'Home') { e.preventDefault(); this.naviguer('/', { nouvelleFenetre: false }); return; }
      const m = this.menus.find((x) => lettre(x.libelle) === e.key.toLowerCase());
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
        const m = this.menus.find((x) => lettre(x.libelle) === e.key.toLowerCase());
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

  /** Libellé sans lettre d'accès (titres, listes de raccourcis). */
  static libelle(libelle) { return sansEsperluette(libelle); }
}
