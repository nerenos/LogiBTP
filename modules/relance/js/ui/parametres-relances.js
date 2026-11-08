// Module Relances, paramétrage de la règle par nature (devis, facture) : niveaux (rang, délai, mode, modèles de courriel et
// de lettre), répétition du dernier niveau. Contrôle local par controlerRegle (même règle que le serveur) avant
// l'enregistrement, réservé à l'administrateur. Composant sans métier : l'application fournit les appels et les modèles.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, creerCombo, confirmer, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { NATURE_RELANCE } from '../src/codes.js';
import { controlerRegle, regleParDefaut, NIVEAUX_MAX } from '../src/regles.js';
import { modesAdmis, reglePourEdition, ajouterNiveau, retirerNiveau, modifierNiveau, definirRepetition } from './modeles.js';

export const GROUPE_RACCOURCIS_PARAMETRES = 'relances_parametres';
declarerRaccourcis(GROUPE_RACCOURCIS_PARAMETRES, {
  libelle: texte('relance.raccourcis.groupe_parametres'),
  actions: { enregistrer: { libelle: texte('relance.raccourcis.enregistrer'), defaut: 'Ctrl+S' } },
});

const NATURES = Object.values(NATURE_RELANCE);

/**
 * Paramètres des relances. options : { peut: { modifier }, api: { regles(), enregistrer(nature, regle) } (promesses),
 * modeles: { courriel(nature) → [{ id, libelle }], edition(nature) → [{ id, libelle }] } (facultatif),
 * reglements: booléen (module Règlements actif : sinon l'avertissement du reste à payer, Q8), apresEcriture(), erreur(e) }.
 */
export class ParametresRelances {
  #zone;
  #o;
  #regles = {};
  #modif = {};
  #nature = NATURE_RELANCE.DEVIS;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { peut: {}, api: {}, modeles: {}, reglements: true, apresEcriture: () => {}, erreur: () => {}, ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('change', (e) => this.#changement(e));
    this.#zone.addEventListener('keydown', (e) => {
      if (actionDe(e, GROUPE_RACCOURCIS_PARAMETRES) === 'enregistrer') { e.preventDefault(); this.enregistrer(); }
    });
  }

  async charger() {
    try {
      this.#regles = (await this.#o.api.regles()) ?? {};
      this.#modif = {};
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  /** Règle affichée d'une nature : la modification en cours, sinon celle du serveur, sinon la règle par défaut. */
  regle(nature) {
    return this.#modif[nature] ?? reglePourEdition(this.#regles[nature], nature);
  }

  #rendre() {
    const nature = this.#nature;
    const regle = this.regle(nature);
    const erreurs = controlerRegle(regle, nature);
    const edition = Boolean(this.#o.peut.modifier);
    const modeles = (type) => (this.#o.modeles?.[type]?.(nature) ?? []);
    const ligne = (n) => `<tr data-rang="${n.rang}"><th scope="row">${n.rang}</th>
      <td><input type="number" min="1" step="1" data-champ="delai" value="${n.delai ?? ''}" ${edition ? '' : 'disabled'} aria-label="${echapper(texte('relance.regle.delai'))}"> ${texteHtml('relance.regle.jours')}</td>
      <td data-combo="mode"></td><td data-combo="modele_courriel"></td><td data-combo="modele_edition"></td>
      <td>${edition ? `<button type="button" data-retirer="${n.rang}" title="${echapper(texte('relance.regle.retirer'))}">${iconeHtml('relance_retirer')}</button>` : ''}</td></tr>`;
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('relance_parametres')} ${texteHtml('relance.regle.titre')}</h2>
      ${this.#o.reglements ? '' : `<p class="relance-avertissement">${iconeHtml('relance_avertissement')} ${texteHtml('relance.regle.sans_reglements')}</p>`}
      <p class="relance-onglets" role="tablist">${NATURES.map((n) => `<button type="button" role="tab" data-nature="${n}" aria-selected="${n === nature}" class="${n === nature ? 'actif' : ''}">${echapper(texte(`relance.natures.${n}`))}</button>`).join('')}</p>
      <table class="relance-table relance-regle"><thead><tr><th>${texteHtml('relance.regle.rang')}</th><th>${texteHtml('relance.regle.delai')}</th><th>${texteHtml('relance.regle.mode')}</th>
        <th>${texteHtml('relance.regle.modele_courriel')}</th><th>${texteHtml('relance.regle.modele_edition')}</th><th></th></tr></thead><tbody>${regle.niveaux.map(ligne).join('')}</tbody></table>
      <p class="relance-champs"><label><input type="checkbox" data-repeter ${regle.repeter ? 'checked' : ''} ${edition ? '' : 'disabled'}> ${texteHtml('relance.regle.repeter')}</label>
        <label>${texteHtml('relance.regle.intervalle')} <input type="number" min="1" step="1" data-intervalle value="${regle.intervalle ?? ''}" ${edition && regle.repeter ? '' : 'disabled'}> ${texteHtml('relance.regle.jours')}</label></p>
      ${erreurs.length ? `<ul class="relance-erreurs">${erreurs.map((c) => `<li>${iconeHtml('relance_avertissement')} ${echapper(texte(`relance.regle.erreurs.${c}`))}</li>`).join('')}</ul>` : ''}
      ${edition ? `<p class="relance-actions"><button type="button" data-ajouter ${regle.niveaux.length >= NIVEAUX_MAX ? 'disabled' : ''}>${iconeHtml('relance_ajouter')} ${texteHtml('relance.regle.ajouter')}</button>
        <button type="button" data-defaut>${iconeHtml('relance_defaut')} ${texteHtml('relance.regle.defaut')}</button>
        <button type="button" class="principal" data-enregistrer ${erreurs.length ? 'disabled' : ''}>${iconeHtml('relance_enregistrer')} ${texteHtml('relance.regle.enregistrer')}</button></p>` : ''}`;
    for (const tr of this.#zone.querySelectorAll('tr[data-rang]')) {
      const n = regle.niveaux.find((x) => x.rang === Number(tr.dataset.rang));
      const poser = (cle, options, valeur, vide) => {
        const c = creerCombo({ options, valeur: valeur ?? '', vide });
        c.dataset.champ = cle;
        c.disabled = !edition;
        tr.querySelector(`[data-combo="${cle}"]`).append(c);
      };
      poser('mode', modesAdmis(nature).map((m) => ({ valeur: m, libelle: texte(`relance.modes.${m}`) })), n.mode, false);
      const options = (type) => modeles(type).map((m) => ({ valeur: String(m.id), libelle: m.libelle }));
      poser('modele_courriel', options('courriel'), n.modele_courriel === null ? '' : String(n.modele_courriel), true);
      poser('modele_edition', options('edition'), n.modele_edition === null ? '' : String(n.modele_edition), true);
    }
  }

  #changer(regle) {
    this.#modif[this.#nature] = regle;
    this.#rendre();
  }

  #changement(e) {
    const t = e.target;
    const rang = Number(t.closest('tr[data-rang]')?.dataset.rang);
    if (t.dataset.repeter !== undefined) this.#changer(definirRepetition(this.regle(this.#nature), t.checked, this.regle(this.#nature).intervalle ?? 30));
    else if (t.dataset.intervalle !== undefined) this.#changer(definirRepetition(this.regle(this.#nature), true, t.value));
    else if (t.dataset.champ === 'delai') this.#changer(modifierNiveau(this.regle(this.#nature), rang, 'delai', t.value));
    else if (t.dataset.champ) this.#changer(modifierNiveau(this.regle(this.#nature), rang, t.dataset.champ, t.valeurCombo));
  }

  #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const regle = this.regle(this.#nature);
    if (b.dataset.nature) { this.#nature = b.dataset.nature; this.#rendre(); }
    else if (b.matches('[data-ajouter]')) this.#changer(ajouterNiveau(regle));
    else if (b.dataset.retirer) this.#changer(retirerNiveau(regle, Number(b.dataset.retirer)));
    else if (b.matches('[data-defaut]')) this.#restaurer();
    else if (b.matches('[data-enregistrer]')) this.enregistrer();
  }

  async #restaurer() {
    if (!await confirmer(texte('relance.regle.confirmer_defaut'))) return;
    this.#changer(regleParDefaut(this.#nature));
  }

  /** Enregistre la règle de la nature affichée si elle est valable ; la règle du serveur la remplace ensuite. */
  async enregistrer() {
    const nature = this.#nature;
    const regle = this.regle(nature);
    if (!this.#o.peut.modifier || controlerRegle(regle, nature).length) return;
    try {
      await this.#o.api.enregistrer(nature, regle);
      this.#o.apresEcriture();
      await this.charger();
    } catch (e) {
      this.#o.erreur(e);
    }
  }
}
