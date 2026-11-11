// Module Facturation électronique, chronologie du journal des étapes (fe_evenement) d'un flux ou d'un élément de
// l'application : étapes par jour, heure, type, acteur, changement d'état ou de statut, détail, empreinte chaînée.
// Composant réutilisable par le cœur (onglet Chronologie de la pièce, lot 11) : l'hôte fournit le chargement.
import { texte, texteHtml, iconeHtml, existe } from '@logibtp/socle/dictionnaire';
import { echapper, formatDate, formatHeure, lireStockage, ecrireStockage, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { grouperParJour, transition, natureEtat, classeEvenement, champsDetail, empreinteCourte } from './modeles.js';

export const GROUPE_RACCOURCIS_CHRONOLOGIE = 'facture_electronique_chronologie';
declarerRaccourcis(GROUPE_RACCOURCIS_CHRONOLOGIE, {
  libelle: texte('facture_electronique.raccourcis.groupe_chronologie'),
  actions: {
    details: { libelle: texte('facture_electronique.raccourcis.details'), defaut: 'Alt+Shift+D' },
    actualiser: { libelle: texte('facture_electronique.raccourcis.actualiser'), defaut: 'Alt+Shift+R' },
  },
});

/** Préférence d'affichage (navigateur) : détails des étapes dépliés. */
export const PREFERENCE_DETAILS = 'logibtp.facture_electronique.chronologie.details';

/** Libellé d'un code sous un préfixe du dictionnaire, sinon le code lui-même (code d'une PA, motif non traduit). */
export const libelleCode = (prefixe, code) => (existe(`facture_electronique.${prefixe}.${code}`) ? texte(`facture_electronique.${prefixe}.${code}`) : String(code ?? ''));

/** Libellé d'un état avant / après : état de la file, statut de cycle de vie, sinon la valeur brute. */
export function libelleEtat(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return '';
  const nature = natureEtat(valeur);
  if (nature === 'etat') return texte(`facture_electronique.etats.${valeur}`);
  if (nature === 'statut') return texte('facture_electronique.statut_code', { code: valeur, libelle: texte(`facture_electronique.statuts.${valeur}`) });
  return String(valeur);
}

const libelleCle = (chemin) => {
  const cle = `facture_electronique.chronologie.champs.${chemin.replace(/\[\d+\]/g, '')}`;
  return existe(cle) ? texte(cle) : chemin;
};

/**
 * HTML de la chronologie. options : { details (déplier le détail de chaque étape), element (afficher l'élément de
 * l'application et le flux de chaque étape : chronologie d'une pièce), libelleElement(type, id), libelleUtilisateur(code) }.
 */
export function chronologieHtml(evenements, options = {}) {
  const { details = false, element = false } = options;
  const libelleElement = options.libelleElement ?? ((type, id) => texte('facture_electronique.element', { type, id }));
  const libelleUtilisateur = options.libelleUtilisateur ?? ((code) => code);
  if (!evenements?.length) return `<p class="aide">${texteHtml('facture_electronique.chronologie.vide')}</p>`;
  const etape = (e) => {
    const t = transition(e);
    const changement = t.change
      ? `<span class="fe-transition">${t.avant ? `<span class="fe-etat-avant">${echapper(libelleEtat(t.avant))}</span> ${iconeHtml('fe_transition')} ` : ''}<span class="fe-etat-apres">${echapper(libelleEtat(t.apres))}</span></span>`
      : (t.apres ? `<span class="fe-transition">${echapper(libelleEtat(t.apres))}</span>` : '');
    const acteur = `${iconeHtml(`fe_acteur_${String(e.acteur).toLowerCase()}`)} ${echapper(texte(`facture_electronique.acteurs.${e.acteur}`))}${e.utilisateur ? ` (${echapper(libelleUtilisateur(e.utilisateur))})` : ''}`;
    const champs = details ? champsDetail(e.detail) : [];
    const lien = element ? `<span class="fe-chrono-lien">${e.type_element ? echapper(libelleElement(e.type_element, e.id_element)) : ''}
        ${e.flux_id ? `<button type="button" class="lien" data-ouvrir-flux="${e.flux_id}">${echapper(texte('facture_electronique.chronologie.flux', { id: e.flux_id }))}</button>` : ''}</span>` : '';
    return `<li class="fe-etape fe-etape-${classeEvenement(e)}" data-rang="${e.rang}">
      <span class="fe-chrono-heure" title="${echapper(texte('facture_electronique.chronologie.rang', { rang: e.rang }))}">${echapper(formatHeure(e.horodatage))}</span>
      <span class="fe-chrono-type">${iconeHtml(`fe_evenement_${String(e.type).toLowerCase()}`)} ${echapper(texte(`facture_electronique.evenements.${e.type}`))}</span>
      ${changement}<span class="fe-chrono-acteur">${acteur}</span>${lien}
      ${champs.length ? `<dl class="fe-chrono-detail">${champs.map(([k, v]) => `<dt>${echapper(libelleCle(k))}</dt><dd>${echapper(v)}</dd>`).join('')}</dl>` : ''}
      ${details ? `<span class="fe-chrono-empreinte" title="${echapper(e.empreinte)}">${iconeHtml('fe_empreinte')} ${echapper(empreinteCourte(e.empreinte))}</span>` : ''}</li>`;
  };
  return grouperParJour(evenements).map((j) => `<section class="fe-chrono-jour"><h4>${echapper(formatDate(j.jour))}</h4>
    <ol class="fe-chrono">${j.evenements.map(etape).join('')}</ol></section>`).join('');
}

/**
 * Chronologie affichée dans une zone. options : { charger() → promesse des événements (GET /flux/{id}/chronologie ou
 * GET /chronologie?type_element=&id_element=), evenements (déjà chargés, sinon charger), titre (afficher le titre,
 * vrai par défaut), element, libelleElement, libelleUtilisateur, ouvrirFlux(id, nouvelleFenetre), erreur(e) }.
 */
export class Chronologie {
  #zone;
  #o;
  #evenements = [];

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { titre: true, element: false, erreur: () => {}, ...options };
    this.#evenements = options.evenements ?? [];
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('change', (e) => {
      if (e.target.matches('[data-details]')) this.#basculer(e.target.checked);
    });
    this.#zone.addEventListener('keydown', (e) => {
      const action = actionDe(e, GROUPE_RACCOURCIS_CHRONOLOGIE);
      if (action === 'details') this.#basculer(!this.details);
      else if (action === 'actualiser' && this.#o.charger) this.charger();
      else return;
      e.preventDefault();
    });
  }

  /** Détails dépliés (préférence du navigateur). */
  get details() {
    return Boolean(lireStockage(PREFERENCE_DETAILS, false));
  }

  get evenements() {
    return this.#evenements;
  }

  /** Charge les événements (si charger est fourni) puis affiche. */
  async charger() {
    if (this.#o.charger) {
      try {
        this.#evenements = (await this.#o.charger()) ?? [];
      } catch (e) {
        this.#o.erreur(e);
      }
    }
    this.rendre();
  }

  /** Affiche des événements déjà lus (détail d'un flux). */
  afficher(evenements) {
    this.#evenements = evenements ?? [];
    this.rendre();
  }

  rendre() {
    const { titre } = this.#o;
    this.#zone.innerHTML = `<div class="fe-chrono-entete">${titre ? `<h3>${iconeHtml('fe_chronologie')} ${texteHtml('facture_electronique.chronologie.titre')}</h3>` : ''}
        <label><input type="checkbox" data-details ${this.details ? 'checked' : ''}> ${texteHtml('facture_electronique.chronologie.details')}</label>
        ${this.#o.charger ? `<button type="button" data-actualiser title="${echapper(texte('facture_electronique.chronologie.actualiser'))}">${iconeHtml('fe_actualiser')}</button>` : ''}</div>
      <div class="fe-chrono-corps" tabindex="-1">${chronologieHtml(this.#evenements, { ...this.#o, details: this.details })}</div>`;
  }

  #basculer(details) {
    ecrireStockage(PREFERENCE_DETAILS, details);
    this.rendre();
  }

  #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-actualiser]')) this.charger();
    else if (b.dataset.ouvrirFlux) this.#o.ouvrirFlux?.(Number(b.dataset.ouvrirFlux), e.ctrlKey || e.metaKey);
  }
}
