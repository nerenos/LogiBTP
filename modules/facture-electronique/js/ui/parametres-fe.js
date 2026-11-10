// Module Facturation électronique, paramètres de la plateforme (fe_parametre) : connecteur, connexion OAuth, adresses
// du Flow Service et du Directory Service, Organization-Id, adresse électronique de la société, syntaxe et profil par
// défaut, relève, délai, découpage de l'e-reporting ; essai de connexion (GET /sante, healthcheck de la plateforme).
// Contrôle local par controlerParametres (même règle que le serveur) ; enregistrement réservé au paramétrage.
import { texte, texteHtml, iconeHtml, existe, messageErreur } from '@logibtp/socle/dictionnaire';
import { echapper, creerCombo, confirmer, alerter, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { DECOUPAGE_EREPORTING, CONNECTEUR_FE } from '../src/codes.js';
import {
  parametresPourEdition, corpsParametres, controlerParametres, parametresModifies, dureeMs, SYNTAXES_EMISSION, PROFILS_EMISSION,
  FREQUENCE_RELEVE, DELAI_SECONDES, LONGUEUR_ORGANISATION,
} from './modeles.js';

export const GROUPE_RACCOURCIS_PARAMETRES = 'facture_electronique_parametres';
declarerRaccourcis(GROUPE_RACCOURCIS_PARAMETRES, {
  libelle: texte('facture_electronique.raccourcis.groupe_parametres'),
  actions: {
    enregistrer: { libelle: texte('facture_electronique.raccourcis.enregistrer'), defaut: 'Ctrl+S' },
    essayer: { libelle: texte('facture_electronique.raccourcis.essayer'), defaut: 'Alt+Shift+E' },
  },
});

/** Libellé d'un connecteur : celui du dictionnaire, sinon son code (connecteur propre à une PA). */
export const libelleConnecteur = (code) => (existe(`facture_electronique.connecteurs.${code}`) ? texte(`facture_electronique.connecteurs.${code}`) : code);

/**
 * Paramètres de la facturation électronique. options : { peut: { modifier }, api: { parametres(), enregistrer(corps),
 * sante() } (promesses), connexions() → [{ id, libelle }] (connexions OAuth de l'application, facultatif : sinon
 * saisie du numéro), apresEcriture(), erreur(e) }.
 */
export class ParametresFe {
  #zone;
  #o;
  #serveur = parametresPourEdition();
  #p = parametresPourEdition();
  #sante = null;
  #essai = false;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { peut: {}, api: {}, apresEcriture: () => {}, erreur: (e) => alerter(messageErreur(e?.code, e?.message ?? String(e))), ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('change', (e) => this.#changement(e));
    this.#zone.addEventListener('keydown', (e) => {
      const action = actionDe(e, GROUPE_RACCOURCIS_PARAMETRES);
      if (action === 'enregistrer') this.enregistrer();
      else if (action === 'essayer') this.essayer();
      else return;
      e.preventDefault();
    });
  }

  /** Paramètres en cours d'édition. */
  get valeurs() {
    return { ...this.#p };
  }

  async charger() {
    try {
      this.#serveur = parametresPourEdition(await this.#o.api.parametres());
      this.#p = { ...this.#serveur };
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  #connecteurs() {
    return this.#serveur.connecteurs?.length ? this.#serveur.connecteurs : Object.values(CONNECTEUR_FE);
  }

  #rendre() {
    const p = this.#p;
    const edition = Boolean(this.#o.peut.modifier);
    const erreurs = controlerParametres(p, this.#connecteurs());
    const dis = edition ? '' : 'disabled';
    const marque = (champ) => (erreurs.includes(champ) ? 'aria-invalid="true"' : '');
    const texteChamp = (champ, attrs = '') => `<input type="text" data-champ="${champ}" value="${echapper(p[champ] ?? '')}" ${dis} ${marque(champ)} ${attrs}>`;
    const ligne = (champ, controle, aide = '') => `<tr><th scope="row"><label>${texteHtml(`facture_electronique.parametres.champs.${champ}`)}</label></th>
      <td>${controle}</td><td class="aide">${aide}</td></tr>`;
    const s = this.#sante;
    const sante = !s ? '' : s.disponible
      ? `<p class="fe-sante fe-succes" role="status">${iconeHtml('fe_disponible')} ${echapper(texte('facture_electronique.parametres.disponible', { duree: dureeMs(s.duree) ?? '' }))}</p>`
      : `<p class="fe-sante fe-erreur" role="status">${iconeHtml('fe_indisponible')} ${echapper(texte('facture_electronique.parametres.indisponible', { code: s.code ?? '' }))}
          ${s.code ? echapper(messageErreur(s.code, '')) : ''}</p>`;
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('fe_parametres')} ${texteHtml('facture_electronique.parametres.titre')}</h2>
      <table class="fe-parametres"><tbody>
        ${ligne('actif', `<input type="checkbox" data-champ="actif" ${p.actif ? 'checked' : ''} ${dis}>`, texteHtml('facture_electronique.parametres.aides.actif'))}
        ${ligne('connecteur', '<span data-combo="connecteur"></span>', texteHtml('facture_electronique.parametres.aides.connecteur'))}
        ${ligne('connexion_oauth', this.#o.connexions ? '<span data-combo="connexion_oauth"></span>'
          : `<input type="number" min="1" step="1" data-champ="connexion_oauth" value="${p.connexion_oauth ?? ''}" ${dis} ${marque('connexion_oauth')}>`, texteHtml('facture_electronique.parametres.aides.connexion_oauth'))}
        ${ligne('adresse_flux', texteChamp('adresse_flux', 'size="40" inputmode="url"'), texteHtml('facture_electronique.parametres.aides.adresse_flux'))}
        ${ligne('adresse_annuaire', texteChamp('adresse_annuaire', 'size="40" inputmode="url"'), texteHtml('facture_electronique.parametres.aides.adresse_annuaire'))}
        ${ligne('organisation', texteChamp('organisation', `maxlength="${LONGUEUR_ORGANISATION}" size="30"`), texteHtml('facture_electronique.parametres.aides.organisation'))}
        ${ligne('adresse_electronique', texteChamp('adresse_electronique', 'size="30"'), texteHtml('facture_electronique.parametres.aides.adresse_electronique'))}
        ${ligne('schema_adresse', texteChamp('schema_adresse', 'size="6"'), texteHtml('facture_electronique.parametres.aides.schema_adresse'))}
        ${ligne('syntaxe', '<span data-combo="syntaxe"></span>')}
        ${ligne('profil', '<span data-combo="profil"></span>')}
        ${ligne('frequence_releve', `<input type="number" min="${FREQUENCE_RELEVE.min}" max="${FREQUENCE_RELEVE.max}" step="1" data-champ="frequence_releve" value="${p.frequence_releve ?? ''}" ${dis} ${marque('frequence_releve')}> ${texteHtml('facture_electronique.parametres.minutes')}`)}
        ${ligne('delai_secondes', `<input type="number" min="${DELAI_SECONDES.min}" max="${DELAI_SECONDES.max}" step="1" data-champ="delai_secondes" value="${p.delai_secondes ?? ''}" ${dis} ${marque('delai_secondes')}> ${texteHtml('facture_electronique.parametres.secondes')}`)}
        ${ligne('decoupage_ereporting', '<span data-combo="decoupage_ereporting"></span>', texteHtml('facture_electronique.parametres.aides.decoupage_ereporting'))}
      </tbody></table>
      ${erreurs.length ? `<ul class="fe-erreurs">${erreurs.map((c) => `<li>${iconeHtml('fe_avertissement')} ${echapper(texte(`facture_electronique.parametres.erreurs.${c}`, {
        min_frequence: FREQUENCE_RELEVE.min, max_frequence: FREQUENCE_RELEVE.max, min_delai: DELAI_SECONDES.min, max_delai: DELAI_SECONDES.max, longueur: LONGUEUR_ORGANISATION }))}</li>`).join('')}</ul>` : ''}
      <p class="fe-actions">
        <button type="button" data-essayer ${this.#essai ? 'disabled' : ''} title="${echapper(texte('facture_electronique.parametres.essayer_titre'))}">${iconeHtml('fe_essayer')} ${texteHtml('facture_electronique.parametres.essayer')}</button>
        ${edition ? `<button type="button" class="principal" data-enregistrer ${erreurs.length || !parametresModifies(p, this.#serveur) ? 'disabled' : ''}>${iconeHtml('fe_enregistrer')} ${texteHtml('commun.enregistrer')}</button>` : ''}
      </p>${sante}`;
    const poser = (champ, options, vide = false) => {
      const c = creerCombo({ options, valeur: p[champ] === null || p[champ] === undefined ? '' : String(p[champ]), vide });
      c.dataset.champ = champ;
      c.disabled = !edition;
      if (erreurs.includes(champ)) c.setAttribute('aria-invalid', 'true');
      this.#zone.querySelector(`[data-combo="${champ}"]`)?.append(c);
    };
    poser('connecteur', this.#connecteurs().map((c) => ({ valeur: c, libelle: libelleConnecteur(c) })));
    if (this.#o.connexions) poser('connexion_oauth', (this.#o.connexions() ?? []).map((c) => ({ valeur: String(c.id), libelle: c.libelle })), true);
    poser('syntaxe', SYNTAXES_EMISSION.map((s) => ({ valeur: s, libelle: texte(`facture_electronique.syntaxes.${s}`) })));
    poser('profil', PROFILS_EMISSION.map((s) => ({ valeur: s, libelle: texte(`facture_electronique.profils.${s}`) })));
    poser('decoupage_ereporting', Object.values(DECOUPAGE_EREPORTING).map((s) => ({ valeur: s, libelle: texte(`facture_electronique.decoupages.${s}`) })));
  }

  #changement(e) {
    const t = e.target;
    const champ = t.dataset.champ;
    if (!champ) return;
    let v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.classList.contains('combo')) v = t.valeurCombo === '' ? null : t.valeurCombo;
    else if (t.type === 'number') v = t.value === '' ? null : Number(t.value);
    else v = t.value;
    if (champ === 'connexion_oauth' && v !== null) v = Number(v);
    this.#p = { ...this.#p, [champ]: v };
    this.#sante = null;
    this.#rendre();
    this.#zone.querySelector(`[data-champ="${champ}"]`)?.focus();
  }

  #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-enregistrer]')) this.enregistrer();
    else if (b.matches('[data-essayer]')) this.essayer();
  }

  /** Enregistre les paramètres s'ils sont valables et modifiés ; vrai si enregistrés. */
  async enregistrer() {
    if (!this.#o.peut.modifier || controlerParametres(this.#p, this.#connecteurs()).length || !parametresModifies(this.#p, this.#serveur)) return false;
    try {
      this.#serveur = parametresPourEdition(await this.#o.api.enregistrer(corpsParametres(this.#p)));
      this.#p = { ...this.#serveur };
      this.#o.apresEcriture();
      this.#rendre();
      return true;
    } catch (e) {
      this.#o.erreur(e);
      return false;
    }
  }

  /** Essai de connexion sur les paramètres enregistrés (modifiés : enregistrement proposé d'abord). */
  async essayer() {
    if (parametresModifies(this.#p, this.#serveur)) {
      if (!this.#o.peut.modifier || !await confirmer(texte('facture_electronique.parametres.enregistrer_avant_essai'))) return;
      if (!await this.enregistrer()) return;
    }
    this.#essai = true;
    this.#rendre();
    try {
      this.#sante = await this.#o.api.sante();
    } catch (e) {
      this.#sante = { disponible: false, code: e?.code ?? null };
      this.#o.erreur(e);
    } finally {
      this.#essai = false;
      this.#rendre();
    }
  }
}
