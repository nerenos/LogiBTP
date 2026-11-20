import { texte, texteHtml } from '@logibtp/socle/dictionnaire';
import { creerCombo } from '@logibtp/socle/ui';
import { CLASSE_STYLE_LIGNE } from '../src/codes.js';
import { normaliserStyle } from '../src/styles-lignes.js';
import { creerEditeurStyle, presentationStyle } from './style-ligne.js';

// Paramétrage des styles de lignes (lot 6 fiches-lignes-documents) : un niveau au choix (global, famille, type de
// document), puis un style par classe de ligne. Le plus précis l'emporte à l'affichage ; un changement s'applique à tous
// les documents à leur prochaine ouverture. Fournisseur : { styles() → [{ classe, famille, type, valeur }],
// enregistrer(liste) → liste, types() → [{ tyd_code, tyd_libelle, tyd_famille }] }.

const FAMILLES = ['V', 'A', 'S', 'E', 'T'];

export class ParametrageStylesLignes {
  constructor(conteneur, { fournisseur, admin = false, message = () => {} }) {
    this.conteneur = conteneur;
    this.fournisseur = fournisseur;
    this.admin = admin;
    this.message = message;
    this.niveau = '';
  }

  async ouvrir() {
    this.styles = await this.fournisseur.styles();
    this.types = await this.fournisseur.types();
    this.rendre();
  }

  /** Niveau choisi ('' global, 'F:V' famille, 'T:CODE' type) → { famille, type }. */
  get cible() {
    return { famille: this.niveau.startsWith('F:') ? this.niveau.slice(2) : null, type: this.niveau.startsWith('T:') ? this.niveau.slice(2) : null };
  }

  styleDe(classe) {
    const { famille, type } = this.cible;
    return this.styles.find((s) => s.classe === classe && (s.famille ?? null) === famille && (s.type ?? null) === type)?.valeur ?? {};
  }

  definir(classe, style) {
    const { famille, type } = this.cible;
    this.styles = this.styles.filter((s) => !(s.classe === classe && (s.famille ?? null) === famille && (s.type ?? null) === type));
    if (Object.keys(style).length) this.styles.push({ classe, famille, type, valeur: style });
  }

  rendre() {
    const niveaux = [{ valeur: '', libelle: texte('document.styles.global') },
      ...FAMILLES.map((f) => ({ valeur: `F:${f}`, libelle: texte('document.styles.famille', { famille: f }) })),
      ...this.types.map((t) => ({ valeur: `T:${t.tyd_code}`, libelle: t.tyd_libelle, detail: t.tyd_code }))];
    this.conteneur.innerHTML = `${this.admin ? '' : `<p class="aide">${texteHtml('document.parametrage.lecture_seule')}</p>`}
      <p class="aide">${texteHtml('document.styles.aide')}</p>
      <p><label>${texteHtml('document.styles.niveau')} <span data-niveau></span></label></p><div data-classes></div>
      ${this.admin ? `<div class="boutons"><button type="button" class="principal" data-enregistrer>${texteHtml('document.styles.enregistrer')}</button></div>` : ''}`;
    const combo = creerCombo({ options: niveaux, valeur: this.niveau, vide: false });
    combo.addEventListener('change', () => { this.niveau = combo.valeurCombo; this.rendre(); });
    this.conteneur.querySelector('[data-niveau]').replaceWith(combo);
    const zone = this.conteneur.querySelector('[data-classes]');
    for (const classe of Object.values(CLASSE_STYLE_LIGNE)) {
      const bloc = document.createElement('div');
      bloc.className = 'styles-lignes-classe';
      bloc.innerHTML = `<h3>${texteHtml(`document.styles.classe.${classe}`)}<span class="styles-lignes-apercu">${texteHtml('document.styles.apercu')}</span></h3>`;
      const apercu = bloc.querySelector('.styles-lignes-apercu');
      const majApercu = (style) => {
        apercu.className = 'styles-lignes-apercu';
        apercu.removeAttribute('style');
        const p = presentationStyle(style);
        if (!p) return;
        apercu.classList.add(...p.classes);
        for (const [k, v] of Object.entries(p.variables)) apercu.style.setProperty(k, v);
      };
      majApercu(this.styleDe(classe));
      bloc.append(creerEditeurStyle({
        style: this.styleDe(classe), lectureSeule: !this.admin,
        surChangement: (style) => { this.definir(classe, normaliserStyle(style)); majApercu(style); },
      }));
      zone.append(bloc);
    }
    this.conteneur.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.styles = await this.fournisseur.enregistrer(this.styles);
        this.rendre();
        this.message(texte('document.styles.enregistres'));
      } catch (e) { this.message(e.message, 'erreur'); }
    });
  }
}
