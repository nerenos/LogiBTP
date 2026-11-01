import { echapper, confirmer } from '@logibtp/socle/ui';
import { deplacer } from '../src/preferences.js';
import { TYPES_WIDGET } from './widgets.js';
import { texte, texteHtml, pluriel, langue } from '@logibtp/socle/dictionnaire';

// Accueil (classe mère) : bandeau « Restaurer ma session précédente », raccourcis personnalisables (ajout, retrait,
// ordre par glisser), tableau de bord de widgets (ajout, retrait, ordre, taille). Choix gardés dans le navigateur.
//
// options :
//   catalogueRaccourcis : [{ code, libelle, icone, url, groupe }]
//   catalogueWidgets    : [{ code, type, titre, icone, description, taille ('petit' | 'moyen' | 'large'), url, charger }]
//   preferences         : Preferences (clés raccourcis : [code], widgets : [{ code, taille }])
//   session             : { precedente: () => session | null, restaurer(session) → { bloquees }, ouvrir(fenetre), oublier() }
//   naviguer(url, { nouvelleFenetre }), message(texte, niveau), entete : html (salutation, société…)

const TAILLES = ['petit', 'moyen', 'large'];
const LIBELLES_TAILLE = { petit: '¼', moyen: '½', large: '1' };
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
        <div class="accueil-salutation">${entete}</div>
        <div class="accueil-outils">
          <button type="button" data-action="actualiser" title="${texteHtml('navigation.accueil.actualiser_titre')}">⟳</button>
          <button type="button" data-action="personnaliser" title="${texteHtml('navigation.accueil.personnaliser_titre')}">✎ ${texteHtml('navigation.accueil.personnaliser')}</button>
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
      <div><button type="button" class="principal" data-action="restaurer">↺ ${texteHtml('navigation.session.restaurer')}</button>
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
      return `<a class="accueil-tuile" href="${echapper(r.url)}" data-url="${echapper(r.url)}" data-index="${i}" draggable="${this.edition}" title="${texteHtml('navigation.accueil.tuile_titre', { libelle: r.groupe ? `${r.groupe} › ${r.libelle}` : r.libelle })}">
        <span class="icone">${echapper(r.icone ?? '🔗')}</span><span class="libelle">${echapper(r.libelle)}</span>
        ${this.edition ? `<button type="button" class="accueil-retirer" data-action="retirer-raccourci" data-index="${i}" title="${texteHtml('commun.retirer')}">✕</button>` : ''}</a>`;
    }).join('') + (this.edition ? `<div class="accueil-tuile accueil-ajout">
        <span class="icone">＋</span><select data-action="ajouter-raccourci" aria-label="${texteHtml('navigation.accueil.ajouter_raccourci')}"><option value="">${texteHtml('navigation.accueil.ajouter_raccourci_choix')}</option>
        ${this.#optionsGroupees(this.catalogueRaccourcis.filter((r) => !codes.includes(r.code)), (r) => r.groupe ?? texte('navigation.accueil.autres'), (r) => `${r.icone ?? ''} ${r.libelle}`)}</select></div>` : '')
      || `<p class="aide">${texteHtml('navigation.accueil.aucun_raccourci')}</p>`;
    zone.querySelector('select')?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      this.preferences.set('raccourcis', [...this.preferences.get('raccourcis'), e.target.value]);
      this.rendreRaccourcis();
    });
  }

  #optionsGroupees(elements, groupe, libelle) {
    const groupes = new Map();
    for (const x of elements) groupes.set(groupe(x), [...(groupes.get(groupe(x)) ?? []), x]);
    return [...groupes].map(([g, xs]) => `<optgroup label="${echapper(g)}">${xs.map((x) => `<option value="${echapper(x.code)}">${echapper(libelle(x))}</option>`).join('')}</optgroup>`).join('');
  }

  /** Réordonnancement des raccourcis et des widgets par glisser-déposer (mode personnalisation). */
  #glisser() {
    let source = null;
    this.racine.addEventListener('dragstart', (e) => {
      const el = e.target.closest('[draggable="true"][data-index]');
      if (!el || !this.edition) return;
      source = { zone: el.closest('.accueil-tuiles') ? 'raccourcis' : 'widgets', index: Number(el.dataset.index) };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(source.index));
    });
    this.racine.addEventListener('dragover', (e) => {
      if (source && e.target.closest('[data-index]')) e.preventDefault();
    });
    this.racine.addEventListener('drop', (e) => {
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
          ? `<button type="button" data-action="taille" data-index="${i}" title="${texteHtml('navigation.accueil.taille', { taille: texte(`navigation.accueil.taille_${taille}`) })}">${LIBELLES_TAILLE[taille]}</button><button type="button" data-action="retirer-widget" data-index="${i}" title="${texteHtml('commun.retirer')}">✕</button>`
          : `<button type="button" data-action="actualiser-widget" data-index="${i}" title="${texteHtml('commun.actualiser')}">⟳</button>`}</span></header>
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
      ajout.innerHTML = `<header><h3>＋ ${texteHtml('navigation.accueil.ajouter_widget')}</h3></header><div class="widget-corps">${disponibles.length
        ? `<ul class="accueil-catalogue">${disponibles.map((d) => `<li><button type="button" data-action="ajouter-widget" data-code="${echapper(d.code)}"><b>${echapper(`${d.icone ?? ''} ${d.titre}`)}</b><small>${echapper(d.description ?? '')}</small></button></li>`).join('')}</ul>`
        : `<p class="aide">${texteHtml('navigation.accueil.tous_widgets')}</p>`}</div>`;
      grille.append(ajout);
    } else if (!choisis.length) grille.innerHTML = `<p class="aide">${texteHtml('navigation.accueil.aucun_widget')}</p>`;
  }

  actualiser() { for (const w of this.widgets) w?.actualiser(); }

  async #clic(e) {
    const b = e.target.closest('[data-action]');
    const action = b?.dataset.action;
    if (action && b.tagName !== 'SELECT') {
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
