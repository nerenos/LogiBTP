import { echapper, confirmer } from '@logibtp/socle/ui';
import { deplacer, inserer } from '../src/preferences.js';
import { TYPES_WIDGET } from './widgets.js';
import { texte, texteHtml, pluriel, langue, iconeHtml } from '@logibtp/socle/dictionnaire';

// Accueil (classe mère) : bandeau « Restaurer ma session précédente », raccourcis personnalisables (ajout par une
// fenêtre de choix non modale : glisser sur les tuiles = place choisie, double-clic ou Entrée = à la fin ; retrait,
// ordre par glisser), tableau de bord de widgets (ajout, retrait, ordre, taille). Choix gardés dans le navigateur.
//
// options :
//   catalogueRaccourcis : [{ code, libelle, icone (texte) ou iconeHtml (HTML sûr), url, groupe }]
//   catalogueWidgets    : [{ code, type, titre, icone, description, taille ('petit' | 'moyen' | 'large'), url, charger }]
//   preferences         : Preferences (clés raccourcis : [code], widgets : [{ code, taille }])
//   session             : { precedente: () => session | null, restaurer(session) → { bloquees }, ouvrir(fenetre), oublier() }
//   naviguer(url, { nouvelleFenetre }), message(texte, niveau), entete : html (salutation, société…)

const TAILLES = ['petit', 'moyen', 'large'];
const LIBELLES_TAILLE = { petit: '¼', moyen: '½', large: '1' };
const sansAccent = (t) => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const iconeRaccourci = (r) => r.iconeHtml ?? (r.icone ? echapper(r.icone) : iconeHtml('navigation_raccourci'));
const dateHeure = (t) => new Date(t).toLocaleString(langue(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export class AccueilBase {
  constructor(conteneur, { catalogueRaccourcis = [], catalogueWidgets = [], preferences, session = null, naviguer, message = () => {}, entete = '', types = TYPES_WIDGET } = {}) {
    this.racine = conteneur;
    this.catalogueRaccourcis = catalogueRaccourcis;
    this.catalogueWidgets = catalogueWidgets;
    this.preferences = preferences;
    this.session = session;
    this.naviguer = naviguer;
    this.message = message;
    this.types = types;
    this.edition = false;
    this.widgets = [];
    this.racine.classList.add('accueil');
    this.racine.innerHTML = `
      <section class="accueil-session" hidden></section>
      <header class="accueil-entete">
        ${entete}
        <div class="accueil-outils">
          <button type="button" data-action="actualiser" title="${texteHtml('navigation.accueil.actualiser_titre')}">${iconeHtml('navigation_actualiser')}</button>
          <button type="button" data-action="personnaliser" title="${texteHtml('navigation.accueil.personnaliser_titre')}">${iconeHtml('navigation_personnaliser')} ${texteHtml('navigation.accueil.personnaliser')}</button>
        </div>
      </header>
      <section class="accueil-bloc"><h2>${texteHtml('navigation.accueil.raccourcis')}</h2><div class="accueil-tuiles"></div></section>
      <section class="accueil-bloc"><h2>${texteHtml('navigation.accueil.tableau_de_bord')}</h2><div class="accueil-grille"></div></section>
      <div class="accueil-edition-pied" hidden><button type="button" data-action="reinitialiser">${texteHtml('navigation.accueil.reinitialiser')}</button>
        <button type="button" class="principal" data-action="terminer">${texteHtml('navigation.accueil.terminer')}</button></div>`;
    this.racine.addEventListener('click', (e) => this.#clic(e));
    this.racine.addEventListener('auxclick', (e) => {
      const t = e.target.closest('.accueil-tuile[data-url]');
      if (t && e.button === 1 && !this.edition) { e.preventDefault(); this.naviguer(t.dataset.url, { nouvelleFenetre: true }); }
    });
    this.#glisser();
  }

  ouvrir() {
    this.rendreSession();
    this.rendreRaccourcis();
    this.rendreWidgets();
  }

  // ---------------------------------------------------------------- session précédente

  rendreSession(bloquees = null) {
    const zone = this.racine.querySelector('.accueil-session');
    const s = this.session?.precedente();
    if (!s && !bloquees?.length) { zone.hidden = true; return; }
    zone.hidden = false;
    if (bloquees?.length) {
      zone.innerHTML = `<div><b>${echapper(pluriel('navigation.session.bloquees', bloquees.length))}</b>
        <span class="aide">${texteHtml('navigation.session.bloquees_aide')}</span></div>
        <div class="accueil-bloquees">${bloquees.map((f, i) => `<button type="button" data-action="ouvrir-bloquee" data-index="${i}">${echapper(f.icone ?? '')} ${echapper(f.titre || f.url)}</button>`).join('')}</div>`;
      this.bloquees = bloquees;
      return;
    }
    const n = s.fenetres.length;
    zone.innerHTML = `<div><b>${texteHtml(s.interrompue ? 'navigation.session.interrompue' : 'navigation.session.precedente')}</b>
        ${echapper(pluriel('navigation.session.du', n, { date: dateHeure(s.fermeeLe) }))}
        <span class="aide">(${s.fenetres.map((f) => echapper(f.titre || f.url)).join(' · ')})</span></div>
      <div><button type="button" class="principal" data-action="restaurer">${iconeHtml('navigation_restaurer')} ${texteHtml('navigation.session.restaurer')}</button>
        <button type="button" data-action="oublier" title="${texteHtml('navigation.session.oublier_titre')}">${texteHtml('commun.ignorer')}</button></div>`;
  }

  #restaurer() {
    const s = this.session.precedente();
    if (!s) return;
    const { bloquees, urlCourante } = this.session.restaurer(s);
    this.urlCourante = urlCourante;
    this.rendreSession(bloquees);
    if (!bloquees.length) {
      this.message(texte('navigation.session.restauree'));
      if (urlCourante && urlCourante !== '/') this.naviguer(urlCourante, { nouvelleFenetre: false });
    }
  }

  // ---------------------------------------------------------------- raccourcis

  #raccourci(code) { return this.catalogueRaccourcis.find((r) => r.code === code); }

  rendreRaccourcis() {
    const codes = this.preferences.get('raccourcis').filter((c) => this.#raccourci(c));
    const zone = this.racine.querySelector('.accueil-tuiles');
    zone.innerHTML = codes.map((c, i) => {
      const r = this.#raccourci(c);
      const fenetre = r.url && r.fenetre !== false && !r.desactive && !r.sousMenu;
      return `<a class="accueil-tuile" href="${echapper(r.url)}" data-url="${echapper(r.url)}" data-index="${i}" draggable="${this.edition}" title="${texteHtml('navigation.accueil.tuile_titre', { libelle: r.groupe ? `${r.groupe} › ${r.libelle}` : r.libelle })}">
        <span class="icone">${iconeRaccourci(r)}</span><span class="libelle">${echapper(r.libelle)}</span>
        ${this.edition ? `<button type="button" class="accueil-retirer" data-action="retirer-raccourci" data-index="${i}" title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>` : ''}
        ${!this.edition && r.creation && !r.desactive ? `<button type="button" class="bandeau-fenetre bandeau-creation" data-creation title="${texteHtml('navigation.bandeau.creation', { titre: r.creation.titre ?? texte('commun.creer') })}">${iconeHtml('navigation_ajouter')}</button>` : ''}
        ${this.edition ? '' : fenetre ? `<button type="button" class="bandeau-fenetre" data-fenetre title="${texteHtml('navigation.bandeau.nouvelle_fenetre')}">${iconeHtml('navigation_nouvelle_fenetre')}</button>` : r.sousMenu ? `<span class="bandeau-fleche">${iconeHtml('deplier')}</span>` : ''}</a>`;
    }).join('') + (this.edition ? `<button type="button" class="accueil-tuile accueil-ajout" data-action="ajouter-raccourci" title="${texteHtml('navigation.accueil.choix_aide')}">
        <span class="icone">${iconeHtml('ajouter')}</span><span class="libelle">${texteHtml('navigation.accueil.ajouter_raccourci')}</span></button>` : '')
      || `<p class="aide">${texteHtml('navigation.accueil.aucun_raccourci')}</p>`;
    this.#rendreChoix();
  }

  // ---------------------------------------------------------------- fenêtre de choix des raccourcis

  /** Fenêtre non modale (les tuiles restent des cibles de dépôt) des raccourcis pas encore affichés. */
  #ouvrirChoix() {
    if (this.choix) { this.choix.querySelector('input').focus(); return; }
    const d = document.createElement('dialog');
    d.className = 'accueil-choix';
    d.innerHTML = `<header><h3>${texteHtml('navigation.accueil.choix_titre')}</h3>
        <button type="button" data-fermer title="${texteHtml('commun.fermer')}">${iconeHtml('retirer')}</button></header>
      <p class="aide">${texteHtml('navigation.accueil.choix_aide')}</p>
      <input type="search" placeholder="${texteHtml('navigation.accueil.choix_filtre')}" aria-label="${texteHtml('navigation.accueil.choix_filtre')}">
      <div class="accueil-choix-liste"></div>`;
    d.querySelector('[data-fermer]').addEventListener('click', () => this.#fermerChoix());
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.#fermerChoix(); return; }
      const el = e.target.closest?.('[data-code]');
      if (el && e.key === 'Enter') { e.preventDefault(); this.#ajouterRaccourci(el.dataset.code); }
    });
    d.addEventListener('dblclick', (e) => {
      const el = e.target.closest('[data-code]');
      if (el) this.#ajouterRaccourci(el.dataset.code);
    });
    d.querySelector('input').addEventListener('input', () => this.#rendreChoix());
    this.racine.append(d);
    this.choix = d;
    this.racine.classList.add('accueil-choix-ouvert');
    d.show();
    this.#rendreChoix();
    d.querySelector('input').focus();
  }

  #fermerChoix() {
    this.choix?.close();
    this.choix?.remove();
    this.choix = null;
    this.racine.classList.remove('accueil-choix-ouvert');
  }

  #rendreChoix() {
    const liste = this.choix?.querySelector('.accueil-choix-liste');
    if (!liste) return;
    const codes = this.preferences.get('raccourcis');
    const filtre = sansAccent(this.choix.querySelector('input').value.trim());
    const disponibles = this.catalogueRaccourcis.filter((r) => !codes.includes(r.code));
    const retenus = disponibles.filter((r) => !filtre || sansAccent(`${r.groupe ?? ''} ${r.libelle}`).includes(filtre));
    if (!retenus.length) {
      liste.innerHTML = `<p class="aide">${texteHtml(disponibles.length ? 'navigation.accueil.choix_aucun' : 'navigation.accueil.tous_raccourcis')}</p>`;
      return;
    }
    const groupes = new Map();
    for (const r of retenus) {
      const g = r.groupe ?? texte('navigation.accueil.autres');
      groupes.set(g, [...(groupes.get(g) ?? []), r]);
    }
    liste.innerHTML = [...groupes].map(([g, rs]) => `<h4>${echapper(g)}</h4><ul>${rs.map((r) => `<li draggable="true" tabindex="0" data-code="${echapper(r.code)}">
        <span class="icone">${iconeRaccourci(r)}</span><span>${echapper(r.libelle)}</span></li>`).join('')}</ul>`).join('');
  }

  /** Raccourci du catalogue ajouté à `position` (index d'une tuile affichée) ou à la fin. */
  #ajouterRaccourci(code, position = null) {
    const codes = this.preferences.get('raccourcis');
    if (!this.#raccourci(code) || codes.includes(code)) return;
    // Position parmi les tuiles affichées → position dans la préférence (codes absents du catalogue gardés en place).
    const affiches = codes.filter((c) => this.#raccourci(c));
    const avant = position == null || position >= affiches.length ? null : codes.indexOf(affiches[position]);
    this.preferences.set('raccourcis', inserer(codes, code, avant));
    this.rendreRaccourcis();
  }

  /** Réordonnancement des raccourcis et des widgets par glisser-déposer (mode personnalisation) ; ajout d'un raccourci
   *  glissé depuis la fenêtre de choix (déposé sur une tuile : à sa place ; ailleurs dans les tuiles : à la fin). */
  #glisser() {
    let source = null;
    const marquer = (el) => {
      this.racine.querySelectorAll('.accueil-depot').forEach((x) => x !== el && x.classList.remove('accueil-depot'));
      el?.classList.add('accueil-depot');
    };
    this.racine.addEventListener('dragstart', (e) => {
      const choisi = e.target.closest?.('.accueil-choix [data-code]');
      if (choisi) {
        source = { zone: 'catalogue', code: choisi.dataset.code };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', source.code);
        return;
      }
      const el = e.target.closest('[draggable="true"][data-index]');
      if (!el || !this.edition) return;
      source = { zone: el.closest('.accueil-tuiles') ? 'raccourcis' : 'widgets', index: Number(el.dataset.index) };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(source.index));
    });
    this.racine.addEventListener('dragover', (e) => {
      if (!source) return;
      if (source.zone === 'catalogue') {
        const zone = e.target.closest('.accueil-tuiles');
        if (!zone) { marquer(null); return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        marquer(e.target.closest('.accueil-tuile[data-index]') ?? zone.querySelector('.accueil-ajout'));
      } else if (e.target.closest('[data-index]')) e.preventDefault();
    });
    this.racine.addEventListener('dragend', () => { source = null; marquer(null); });
    this.racine.addEventListener('drop', (e) => {
      if (source?.zone === 'catalogue') {
        if (!e.target.closest('.accueil-tuiles')) return;
        e.preventDefault();
        const cible = e.target.closest('.accueil-tuile[data-index]');
        const code = source.code;
        source = null;
        marquer(null);
        this.#ajouterRaccourci(code, cible ? Number(cible.dataset.index) : null);
        return;
      }
      const cible = e.target.closest('[data-index]');
      if (!source || !cible) return;
      e.preventDefault();
      const zone = cible.closest('.accueil-tuiles') ? 'raccourcis' : 'widgets';
      if (zone === source.zone) {
        this.preferences.set(zone, deplacer(this.preferences.get(zone), source.index, Number(cible.dataset.index)));
        zone === 'raccourcis' ? this.rendreRaccourcis() : this.rendreWidgets();
      }
      source = null;
    });
  }

  // ---------------------------------------------------------------- widgets

  #definition(code) { return this.catalogueWidgets.find((w) => w.code === code); }

  rendreWidgets() {
    const choisis = this.preferences.get('widgets').filter((w) => this.#definition(w.code));
    const grille = this.racine.querySelector('.accueil-grille');
    grille.innerHTML = '';
    this.widgets = [];
    choisis.forEach((w, i) => {
      const def = this.#definition(w.code);
      const taille = w.taille ?? def.taille ?? 'moyen';
      const carte = document.createElement('article');
      carte.className = `widget widget-${taille} widget-type-${def.type}`;
      carte.dataset.index = String(i);
      carte.draggable = this.edition;
      carte.innerHTML = `<header><h3>${def.url ? `<a href="${echapper(def.url)}" data-url="${echapper(def.url)}">` : ''}${echapper(`${def.icone ?? ''} ${def.titre}`.trim())}${def.url ? '</a>' : ''}</h3>
        <span class="widget-outils">${this.edition
          ? `<button type="button" data-action="taille" data-index="${i}" title="${texteHtml('navigation.accueil.taille', { taille: texte(`navigation.accueil.taille_${taille}`) })}">${LIBELLES_TAILLE[taille]}</button><button type="button" data-action="retirer-widget" data-index="${i}" title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>`
          : `<button type="button" data-action="actualiser-widget" data-index="${i}" title="${texteHtml('commun.actualiser')}">${iconeHtml('navigation_actualiser')}</button>`}</span></header>
        <div class="widget-corps"></div>`;
      grille.append(carte);
      const Classe = this.types[def.type];
      if (!Classe) { carte.querySelector('.widget-corps').textContent = texte('navigation.accueil.widget_inconnu', { type: def.type }); return; }
      const widget = new Classe({ definition: def, corps: carte.querySelector('.widget-corps'), naviguer: this.naviguer });
      this.widgets[i] = widget;
      widget.actualiser();
    });
    carteTitre(grille, this.naviguer);
    if (this.edition) {
      const ajout = document.createElement('article');
      ajout.className = 'widget widget-petit accueil-ajout-widget';
      const disponibles = this.catalogueWidgets.filter((d) => !choisis.some((w) => w.code === d.code));
      ajout.innerHTML = `<header><h3>${iconeHtml('navigation_ajouter')} ${texteHtml('navigation.accueil.ajouter_widget')}</h3></header><div class="widget-corps">${disponibles.length
        ? `<ul class="accueil-catalogue">${disponibles.map((d) => `<li><button type="button" data-action="ajouter-widget" data-code="${echapper(d.code)}"><b>${echapper(`${d.icone ?? ''} ${d.titre}`)}</b><small>${echapper(d.description ?? '')}</small></button></li>`).join('')}</ul>`
        : `<p class="aide">${texteHtml('navigation.accueil.tous_widgets')}</p>`}</div>`;
      grille.append(ajout);
    } else if (!choisis.length) grille.innerHTML = `<p class="aide">${texteHtml('navigation.accueil.aucun_widget')}</p>`;
  }

  actualiser() { for (const w of this.widgets) w?.actualiser(); }

  async #clic(e) {
    const b = e.target.closest('[data-action]');
    const action = b?.dataset.action;
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      const i = Number(b.dataset.index);
      const widgets = this.preferences.get('widgets');
      switch (action) {
        case 'restaurer': this.#restaurer(); break;
        case 'oublier': this.session.oublier(); this.rendreSession(); break;
        case 'ouvrir-bloquee': {
          const f = this.bloquees[i];
          if (this.session.ouvrir(f)) {
            this.bloquees = this.bloquees.filter((x) => x !== f);
            this.rendreSession(this.bloquees);
            if (!this.bloquees.length) {
              this.session.oublier();
              if (this.urlCourante && this.urlCourante !== '/') this.naviguer(this.urlCourante, { nouvelleFenetre: false });
            }
          } else this.message(texte('navigation.fenetres.bloquee'), 'avertissement');
          break;
        }
        case 'personnaliser': this.#basculerEdition(!this.edition); break;
        case 'terminer': this.#basculerEdition(false); break;
        case 'actualiser': this.actualiser(); break;
        case 'actualiser-widget': this.widgets[i]?.actualiser(); break;
        case 'reinitialiser':
          if (await confirmer(texte('navigation.accueil.reinitialiser_question'))) {
            this.preferences.reinitialiser('raccourcis');
            this.preferences.reinitialiser('widgets');
            this.rendreRaccourcis();
            this.rendreWidgets();
          }
          break;
        case 'ajouter-raccourci': this.#ouvrirChoix(); break;
        case 'retirer-raccourci':
          this.preferences.set('raccourcis', this.preferences.get('raccourcis').filter((_, k) => k !== i));
          this.rendreRaccourcis();
          break;
        case 'retirer-widget':
          this.preferences.set('widgets', widgets.filter((_, k) => k !== i));
          this.rendreWidgets();
          break;
        case 'taille': {
          const def = this.#definition(widgets[i].code);
          const actuelle = widgets[i].taille ?? def.taille ?? 'moyen';
          this.preferences.set('widgets', widgets.map((w, k) => (k === i ? { ...w, taille: TAILLES[(TAILLES.indexOf(actuelle) + 1) % TAILLES.length] } : w)));
          this.rendreWidgets();
          break;
        }
        case 'ajouter-widget':
          this.preferences.set('widgets', [...widgets, { code: b.dataset.code }]);
          this.rendreWidgets();
          break;
        default:
      }
      return;
    }
    const tuile = e.target.closest('.accueil-tuile[data-url]');
    if (tuile) {
      e.preventDefault();
      if (!this.edition) this.naviguer(tuile.dataset.url, { nouvelleFenetre: e.ctrlKey || e.shiftKey || e.metaKey });
    }
  }

  #basculerEdition(actif) {
    this.edition = actif;
    if (!actif) this.#fermerChoix();
    this.racine.classList.toggle('accueil-edition', actif);
    this.racine.querySelector('.accueil-edition-pied').hidden = !actif;
    this.racine.querySelector('[data-action="personnaliser"]').classList.toggle('actif', actif);
    this.rendreRaccourcis();
    this.rendreWidgets();
  }
}

/** Titres de widget cliquables : la navigation passe par le gestionnaire des widgets (Ctrl+clic). */
function carteTitre(grille, naviguer) {
  grille.querySelectorAll('.widget > header a[data-url]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    naviguer(a.dataset.url, { nouvelleFenetre: e.ctrlKey || e.shiftKey || e.metaKey });
  }));
}
