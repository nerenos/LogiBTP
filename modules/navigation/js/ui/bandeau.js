import { echapper } from '@logibtp/socle/ui';

// Bandeau fixé en haut de chaque page : menus déroulants à la manière des anciens programmes Windows (clic ou
// Alt + lettre soulignée, survol pour passer d'un menu à l'autre, flèches, Entrée, Échap), zone d'information
// (société, mode, messages) et logo à droite.
//
// menus : [{ code, libelle: '&Ressources' (lettre d'accès après &), elements: [...] ou () => [...] }]
// élément : { libelle, icone, url, action, separateur, desactive, info, raccourci, coche, fenetre (⧉ proposé,
//             vrai par défaut pour une URL), titre (bulle) }
// naviguer(url, { nouvelleFenetre }) : navigation demandée (Ctrl, Maj ou clic milieu, ou ⧉ : nouvelle fenêtre).

const lettre = (libelle) => /&(.)/.exec(libelle)?.[1]?.toLowerCase() ?? null;
const libelleHtml = (libelle) => echapper(libelle).replace(/&amp;(.)/, '<u>$1</u>');
const sansEsperluette = (libelle) => libelle.replace(/&(.)/, '$1');

export class Bandeau {
  constructor(conteneur, { menus, naviguer, logo = '', accueil = '/', titreApplication = 'LogiBTP' } = {}) {
    this.racine = conteneur;
    this.menus = menus;
    this.naviguer = naviguer;
    this.ouvert = null;
    this.actif = -1;
    this.racine.classList.add('bandeau');
    this.racine.innerHTML = `
      <a class="bandeau-accueil" href="${echapper(accueil)}" title="Accueil (Alt+Origine)">⌂</a>
      <nav class="bandeau-menus" role="menubar" aria-label="Menu principal"></nav>
      <span class="bandeau-message" role="status"></span>
      <span class="bandeau-infos"></span>
      <a class="bandeau-logo" href="${echapper(accueil)}" title="${echapper(titreApplication)}">${logo || `<span class="bandeau-logo-texte">${echapper(titreApplication)}</span>`}</a>
      <div class="bandeau-deroulant" role="menu" hidden></div>`;
    this.barre = this.racine.querySelector('.bandeau-menus');
    this.deroulant = this.racine.querySelector('.bandeau-deroulant');
    this.racine.querySelectorAll('.bandeau-accueil, .bandeau-logo').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.naviguer(accueil, { nouvelleFenetre: e.ctrlKey || e.shiftKey });
    }));
    this.barre.addEventListener('click', (e) => {
      const b = e.target.closest('[data-menu]');
      if (b) this.ouvert === b.dataset.menu ? this.fermer() : this.ouvrir(b.dataset.menu);
    });
    this.barre.addEventListener('mouseover', (e) => {
      const b = e.target.closest('[data-menu]');
      if (b && this.ouvert && this.ouvert !== b.dataset.menu) this.ouvrir(b.dataset.menu);
    });
    this.deroulant.addEventListener('click', (e) => this.#clicElement(e));
    this.deroulant.addEventListener('auxclick', (e) => { if (e.button === 1) this.#clicElement(e, true); });
    this.deroulant.addEventListener('mousemove', (e) => {
      const li = e.target.closest('[data-index]');
      if (li) this.#surligner(Number(li.dataset.index));
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
    this.rendre();
  }

  rendre() {
    this.barre.innerHTML = this.menus.map((m) =>
      `<button type="button" role="menuitem" aria-haspopup="true" data-menu="${echapper(m.code)}">${libelleHtml(m.libelle)}</button>`).join('');
    this.#marquerOuvert();
  }

  /** Informations à droite (société, mode). */
  infos(html) { this.racine.querySelector('.bandeau-infos').innerHTML = html; }

  message(texte, niveau = 'info') {
    const zone = this.racine.querySelector('.bandeau-message');
    zone.textContent = texte;
    zone.title = texte;
    zone.className = `bandeau-message ${niveau}`;
    clearTimeout(this.minuterieMessage);
    this.minuterieMessage = setTimeout(() => { zone.textContent = ''; zone.className = 'bandeau-message'; }, niveau === 'erreur' ? 10000 : 6000);
  }

  #menu(code) { return this.menus.find((m) => m.code === code); }

  #elements(menu) {
    const e = typeof menu.elements === 'function' ? menu.elements() : menu.elements;
    return e ?? [];
  }

  ouvrir(code) {
    const menu = this.#menu(code);
    if (!menu) return;
    this.ouvert = code;
    this.elementsOuverts = this.#elements(menu);
    this.deroulant.innerHTML = this.elementsOuverts.map((x, i) => {
      if (x.separateur) return `<div class="bandeau-separateur" role="separator">${x.libelle ? `<span>${echapper(x.libelle)}</span>` : ''}</div>`;
      const fenetre = x.url && x.fenetre !== false && !x.desactive;
      return `<div class="bandeau-element${x.desactive ? ' desactive' : ''}${x.classe ? ` ${echapper(x.classe)}` : ''}" role="menuitem" data-index="${i}"
          aria-disabled="${Boolean(x.desactive)}" title="${echapper(x.titre ?? x.info ?? '')}">
        <span class="bandeau-coche">${x.coche ? '✓' : ''}</span>
        <span class="bandeau-icone">${echapper(x.icone ?? '')}</span>
        <span class="bandeau-libelle">${echapper(x.libelle)}${x.info ? `<small>${echapper(x.info)}</small>` : ''}</span>
        <span class="bandeau-raccourci">${echapper(x.raccourci ?? '')}</span>
        ${fenetre ? '<button type="button" class="bandeau-fenetre" data-fenetre title="Ouvrir dans une nouvelle fenêtre (Ctrl+clic)">⧉</button>' : '<span></span>'}
      </div>`;
    }).join('') || '<div class="bandeau-vide">(vide)</div>';
    const bouton = this.barre.querySelector(`[data-menu="${CSS.escape(code)}"]`);
    const r = bouton.getBoundingClientRect();
    const rr = this.racine.getBoundingClientRect();
    this.deroulant.hidden = false;
    this.deroulant.style.left = `${Math.max(0, Math.min(r.left - rr.left, window.innerWidth - this.deroulant.offsetWidth - 4))}px`;
    this.actif = -1;
    this.#marquerOuvert();
  }

  fermer() {
    this.ouvert = null;
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

  #surligner(i) {
    this.actif = i;
    this.deroulant.querySelectorAll('[data-index]').forEach((el) => el.classList.toggle('actif', Number(el.dataset.index) === i));
  }

  #deplacer(sens) {
    const n = this.elementsOuverts?.length ?? 0;
    for (let k = 1; k <= n; k++) {
      const i = (this.actif + sens * k + n * 2) % n;
      const x = this.elementsOuverts[i];
      if (x && !x.separateur && !x.desactive) { this.#surligner(i); return; }
    }
  }

  #menuVoisin(sens) {
    const i = this.menus.findIndex((m) => m.code === this.ouvert);
    this.ouvrir(this.menus[(i + sens + this.menus.length) % this.menus.length].code);
    this.#deplacer(1);
  }

  #activer(i, nouvelleFenetre = false) {
    const x = this.elementsOuverts?.[i];
    if (!x || x.separateur || x.desactive) return;
    this.fermer();
    if (x.action) x.action({ nouvelleFenetre });
    else if (x.url) this.naviguer(x.url, { nouvelleFenetre });
  }

  #clicElement(e, milieu = false) {
    const li = e.target.closest('[data-index]');
    if (!li) return;
    e.preventDefault();
    const fenetre = Boolean(e.target.closest('[data-fenetre]'));
    this.#activer(Number(li.dataset.index), fenetre || milieu || e.ctrlKey || e.shiftKey || e.metaKey);
  }

  #clavier(e) {
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
    const touches = {
      ArrowDown: () => this.#deplacer(1), ArrowUp: () => this.#deplacer(-1), ArrowRight: () => this.#menuVoisin(1), ArrowLeft: () => this.#menuVoisin(-1),
      Enter: () => this.#activer(this.actif, e.ctrlKey || e.shiftKey), Escape: () => { const code = this.ouvert; this.fermer(); this.barre.querySelector(`[data-menu="${CSS.escape(code)}"]`)?.focus(); },
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
