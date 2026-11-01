import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { FicheBase } from '@logibtp/fiche/ui';
import { FournisseurFicheApi, MODES } from '@logibtp/fiche';
import { formatNombre, echapper } from '@logibtp/socle/ui';
import { principale } from '@logibtp/annuaire';
import { choisirIndividu } from '@logibtp/annuaire/ui';
import { ENTETES } from '../api.js';
import { rolesSalarie } from '../annuaire/salaries.js';
import { urlPhotoIndividu, vignette } from '../annuaire/photo.js';
import { AGENCES_SALARIES } from '../annuaire/donnees.js';

// Fiches du cœur : spécialisations de FicheBase (module Fiche) pour les salariés et les matériels.

const jours = (iso) => (iso ? (Date.now() - Date.parse(String(iso).slice(0, 10))) / 86400000 : null);
const info = (libelle, valeur, alerte = false) => `<span class="info ${alerte ? 'alerte' : ''}"><small>${libelle}</small>${valeur}</span>`;

/** Fiche du cœur : onglet Suivi (module CRM), modules actifs. */
export class FicheLogiBTP extends FicheBase {
  constructor(options) {
    super(options);
    // Onglet Suivi (module CRM actif) : fabrique fournie par la page (PanneauSuivi).
    this.suivi = options.suivi ?? null;
    this.fil = options.fil ?? null;
    // Modules actifs de la société (boutons propres à un module facultatif).
    this.moduleActif = options.moduleActif ?? (() => true);
  }

  /** Onglet Suivi : notes, tâches et courriels de la fiche (module CRM), une fois la fiche enregistrée. */
  ongletsSuivi() {
    if (!this.suivi) return [];
    return [{
      code: 'suivi', titre: texte('fiches_btp.onglets.suivi'),
      rendre: (corps) => {
        if (this.id === null) { corps.innerHTML = `<p class="aide">${texteHtml('fiches_btp.suivi_nouvelle')}</p>`; return; }
        this.panneauSuivi?.fermer();
        this.panneauSuivi = this.suivi(corps, { type: this.type, id: this.id });
      },
    }];
  }

}

/**
 * Fiche salarié : liée à l'individu de l'annuaire (identité, coordonnées professionnelles, rattachement à l'agence). Un
 * salarié créé depuis un individu en reprend l'identité ; un salarié sans individu peut le créer ou être lié à un individu
 * existant. À l'enregistrement, l'individu reprend l'identité, le rôle et le rattachement (SalariesAnnuaire côté serveur).
 */
export class FicheSalarie extends FicheLogiBTP {
  constructor(options) {
    super(options);
    this.services = options.services;
    this.ouvrirFiche = options.ouvrirFiche ?? (() => {});
    // Onglet Compte (module Authentification, administrateur en ligne) : fabrique fournie par la page.
    this.compte = options.compte ?? null;
    // Onglets du référentiel des ressources (habilitations, missions d'intérim) : fabriques fournies par la page.
    this.ressources = options.ressources ?? null;
    // Onglet Dotations (module Stock actif, en ligne) : EPI et outillage dotés, historique.
    this.dotations = options.dotations ?? null;
  }

  /** Onglet Compte : compte de connexion de l'individu du salarié (création, profil, validité, réinitialisation). */
  ongletsSpecifiques() {
    if (this.id === null) return super.ongletsSpecifiques();
    const r = this.ressources;
    return [...super.ongletsSpecifiques(),
      ...(r ? [{ code: 'habilitations', titre: texte('fiches_btp.onglets.habilitations'), rendre: (corps) => r.habilitations(corps, { element: 'salarie', id: this.id }) }] : []),
      ...(r && this.valeur('statut') === 'INTERIM' ? [{ code: 'missions', titre: texte('fiches_btp.onglets.missions'), rendre: (corps) => r.missions(corps, { salarie: this.id }) }] : []),
      ...(r?.materielAffecte ? [{ code: 'materiel-affecte', titre: texte('fiches_btp.onglets.materiel'), rendre: (corps) => r.materielAffecte(corps, { type: this.valeur('statut') === 'INTERIM' ? 'INTERIM' : 'SALARIE', id: this.id }) }] : []),
      ...(this.dotations ? [{ code: 'dotations', titre: texte('fiches_btp.onglets.dotations'), rendre: (corps) => this.dotations(corps, { salarie: Number(this.id) }) }] : []),
      ...(this.compte ? [this.#ongletCompte()] : [])];
  }

  #ongletCompte() {
    return {
      code: 'compte', titre: texte('fiches_btp.onglets.compte'),
      rendre: (corps) => {
        const ind = this.valeur('ind_id');
        if (!ind) { corps.innerHTML = `<p class="aide">${texteHtml('fiches_btp.salarie.sans_individu')}</p>`; return; }
        this.compte(corps, { type: TYPE_FICHE.INDIVIDU, id: ind, prenom: this.valeur('prenom'), nom: this.valeur('nom') });
      },
    };
  }

  /** Photo de l'individu du salarié (annuaire), en vignette de l'encart. */
  apresChargement() {
    super.apresChargement?.();
    urlPhotoIndividu(this.fournisseur, this.services?.ged, this.valeur('ind_id')).then((url) => {
      this.urlPhoto = url;
      const zone = this.conteneur.querySelector('.fiche-informations');
      if (!zone || !url) return;
      zone.innerHTML = this.rendreInformations(this.valeurs());
      zone.hidden = false;
    });
  }

  rendreInformations(v) { return `${vignette(this.urlPhoto)}${super.rendreInformations(v) ?? ''}`; }

  /** Création depuis un individu (?individu=ID) : sa fiche est lue pour préremplir le salarié. */
  async ouvrir() {
    const ind = Number(new URLSearchParams(globalThis.location?.search ?? '').get('individu')) || null;
    if (this.mode === MODES.CREATION && ind) this.individuSource = await this.fournisseur.charger(TYPE_FICHE.INDIVIDU, ind).catch(() => null);
    return super.ouvrir();
  }

  valeursCreation() {
    const v = super.valeursCreation();
    const i = this.individuSource;
    if (!i) return v;
    const iv = i.valeurs;
    const rat = (iv.rattachements ?? []).find((r) => Object.values(AGENCES_SALARIES).includes(Number(r.per_id))) ?? null;
    const agence = Object.entries(AGENCES_SALARIES).find(([, id]) => id === Number(rat?.per_id))?.[0] ?? null;
    return {
      ...v, ind_id: Number(i.id), nom: iv.nom, prenom: iv.prenom, agence, poste: rat?.fonction ?? null, statut: (iv.roles ?? []).includes('INTERIMAIRE') ? 'INTERIM' : v.statut,
      email: principale(rat?.coordonnees ?? [], 'EMAIL'), telephone: principale(rat?.coordonnees ?? [], 'TELEPHONE'),
    };
  }

  /** Individu de l'annuaire : lien vers sa fiche ; en saisie, lier à un individu existant ou le créer. */
  rendreChamp(champ, valeur) {
    if (champ.code !== 'ind_id') return super.rendreChamp(champ, valeur);
    const el = document.createElement('div');
    el.className = 'fiche-saisie-champ annuaire-parent';
    const saisie = this.estEnSaisie();
    el.innerHTML = valeur ? `<a href="${urlFiche(TYPE_FICHE.INDIVIDU, valeur)}" data-ouvrir>${iconeHtml('fiches_btp_individu')} ${echapper(this.libelleIndividu ?? texte('fiches_btp.salarie.individu', { id: valeur }))}</a>` : `<span class="aide">${texteHtml('fiches_btp.salarie.non_lie')}</span>`;
    if (saisie) {
      el.insertAdjacentHTML('beforeend', ` <button type="button" data-lier title="${texteHtml('fiches_btp.salarie.lier')}">…</button>
        ${valeur ? `<button type="button" data-delier title="${texteHtml('fiches_btp.salarie.delier')}">${iconeHtml('retirer')}</button>` : `<button type="button" data-creer title="${texteHtml('fiches_btp.salarie.creer_aide')}">${iconeHtml('ajouter')} ${texteHtml('fiches_btp.salarie.creer')}</button>`}`);
    }
    el.querySelector('[data-ouvrir]')?.addEventListener('click', (e) => { e.preventDefault(); this.ouvrirFiche({ type: TYPE_FICHE.INDIVIDU, id: valeur }, e); });
    el.querySelector('[data-delier]')?.addEventListener('click', () => { this.definirValeur('ind_id', null); this.rendre(); });
    el.querySelector('[data-lier]')?.addEventListener('click', async () => {
      const r = await choisirIndividu({ annuaire: this.services.annuaire, titre: texte('fiches_btp.salarie.choisir'), nom: [this.valeur('nom'), this.valeur('prenom')].filter(Boolean).join(' ') });
      if (!r) return;
      if (r.nouveau) { await this.#creerIndividu(r.nouveau); return; }
      this.libelleIndividu = r.individu.nom_complet;
      this.definirValeur('ind_id', r.individu.id);
      this.rendre();
    });
    el.querySelector('[data-creer]')?.addEventListener('click', () => this.#creerIndividu({ nom: this.valeur('nom'), prenom: this.valeur('prenom') }).catch((e) => this.message(e.message, 'erreur')));
    if (valeur && !this.libelleIndividu) {
      this.services.annuaire.individu(valeur).then((i) => { this.libelleIndividu = i.nom_complet; const a = el.querySelector('[data-ouvrir]'); if (a) a.textContent = `${icone('fiches_btp_individu')} ${i.nom_complet}`; }).catch(() => {});
    }
    return el;
  }

  /** Individu créé dans l'annuaire, rattaché à l'agence du salarié avec ses coordonnées professionnelles. */
  async #creerIndividu({ civilite = null, nom, prenom }) {
    if (!nom) { this.message(texte('fiches_btp.salarie.nom_requis'), 'avertissement'); return; }
    const v = this.valeurs();
    const coordonnees = [
      v.email ? { nature: 'EMAIL', usage: 'PRO', valeur: v.email, principal: true } : null,
      v.telephone ? { nature: 'TELEPHONE', usage: 'PORTABLE', valeur: v.telephone, principal: true } : null,
    ].filter(Boolean);
    const agence = AGENCES_SALARIES[v.agence] ?? AGENCES_SALARIES.Lyon;
    const i = await this.fournisseur.creer(TYPE_FICHE.INDIVIDU, {
      valeurs: {
        civilite, nom, prenom, pays: 'FR', actif: true, roles: rolesSalarie(v),
        rattachements: [{ per_id: agence, fonction: v.poste ?? null, service: v.service ?? null, debut: v.date_entree ?? null, actif: true, coordonnees }],
      },
      proprietes: {},
    });
    this.libelleIndividu = [nom?.toUpperCase(), prenom].filter(Boolean).join(' ');
    this.definirValeur('ind_id', Number(i.id));
    this.rendre();
    this.message(texte('fiches_btp.salarie.individu_cree'), 'succes');
  }

  actionsSupplementaires() {
    const ind = this.valeur('ind_id');
    return [
      { libelle: `${icone('fiches_btp_individu')} ${texte('fiches_btp.salarie.fiche_annuaire')}`, titre: texte('fiches_btp.salarie.fiche_annuaire_aide'), visible: !this.estEnSaisie() && !!ind, action: () => this.ouvrirFiche({ type: TYPE_FICHE.INDIVIDU, id: ind }) },
      ...super.actionsSupplementaires(),
    ];
  }

  rendreInformations(v) {
    const parts = [];
    const anciennete = jours(v.date_entree);
    if (anciennete !== null) parts.push(info(texteHtml('fiches_btp.infos.anciennete'), pluriel('fiches_btp.infos.annees', Math.max(0, Math.floor(anciennete / 365.25)))));
    const age = jours(v.date_naissance);
    if (age !== null) parts.push(info(texteHtml('fiches_btp.infos.age'), pluriel('fiches_btp.infos.annees', Math.floor(age / 365.25))));
    if (v.salaire_brut !== null && v.salaire_brut !== undefined && Number(v.heures_mois) > 0) {
      parts.push(info(texteHtml('fiches_btp.infos.cout_horaire'), texteHtml('fiches_btp.infos.euros', { montant: formatNombre(Number(String(v.salaire_brut).replace(',', '.')) * 1.45 / Number(String(v.heures_mois).replace(',', '.')), 2) })));
    }
    if (v.actif === false) parts.push(info(texteHtml('fiches_btp.infos.situation'), texteHtml('fiches_btp.infos.sorti'), true));
    return parts.join('');
  }

  validerMetier(v) {
    const erreurs = [];
    if (v.date_entree && String(v.date_entree).slice(0, 10) > aujourdhui()) erreurs.push({ champ: 'date_entree', message: texte('fiches_btp.controles.entree_future') });
    if (v.date_naissance) {
      if (jours(v.date_naissance) / 365.25 < 15) erreurs.push({ champ: 'date_naissance', message: texte('fiches_btp.controles.age_min') });
      if (v.date_entree && String(v.date_naissance) >= String(v.date_entree)) erreurs.push({ champ: 'date_naissance', message: texte('fiches_btp.controles.naissance_entree') });
    }
    return erreurs;
  }
}

export class FicheMateriel extends FicheLogiBTP {
  constructor(options) {
    super(options);
    this.ressources = options.ressources ?? null;
  }

  /** Onglet Habilitations : contrôles réglementaires du matériel et habilitations exigées de son conducteur. */
  ongletsSpecifiques() {
    const r = this.ressources;
    if (!r || this.id === null) return super.ongletsSpecifiques();
    return [...super.ongletsSpecifiques(), {
      code: 'habilitations', titre: texte('fiches_btp.onglets.controles'),
      rendre: (corps) => {
        corps.innerHTML = '<div data-controles></div><div data-exigees></div>';
        r.habilitations(corps.querySelector('[data-controles]'), { element: 'materiel', id: this.id, titre: texte('fiches_btp.materiel.controles') });
        r.exigees(corps.querySelector('[data-exigees]'), { materiel: this.id });
      },
    }, ...(r.affectations ? [{ code: 'affectations', titre: texte('fiches_btp.onglets.affectations'), rendre: (corps) => r.affectations(corps, { materiel: this.id }) }] : []),
      ...(r.compteurs ? [{ code: 'compteurs', titre: texte('fiches_btp.onglets.compteurs'), rendre: (corps) => r.compteurs(corps, { materiel: this.id }) }] : []),
      ...(r.couts ? [{ code: 'couts', titre: texte('fiches_btp.onglets.couts'), rendre: (corps) => r.couts(corps, { materiel: this.id }) }] : [])];
  }

  rendreInformations(v) {
    const parts = [];
    const age = jours(v.date_achat);
    if (age !== null) parts.push(info(texteHtml('fiches_btp.infos.age'), texteHtml('fiches_btp.infos.annees_decimal', { nombre: (age / 365.25).toFixed(1).replace('.', ',') })));
    if (v.etat === 'PANNE') parts.push(info(texteHtml('fiches_btp.infos.etat'), texteHtml('fiches_btp.infos.panne'), true));
    if (v.controle_ok === false) parts.push(info(texteHtml('fiches_btp.infos.controle'), texteHtml('fiches_btp.infos.a_faire'), true));
    return parts.join('');
  }

  validerMetier(v) {
    const erreurs = [];
    if (Number(v.heures_utilisation) < 0) erreurs.push({ champ: 'heures_utilisation', message: texte('fiches_btp.controles.heures_negatives') });
    if (v.date_achat && String(v.date_achat).slice(0, 10) > aujourdhui()) erreurs.push({ champ: 'date_achat', message: texte('fiches_btp.controles.achat_futur') });
    if (v.etat === 'CHANTIER' && !v.chantier) erreurs.push({ champ: 'chantier', message: texte('fiches_btp.controles.chantier') });
    return erreurs;
  }
}

export const CLASSES_FICHE = { salarie: FicheSalarie, materiel: FicheMateriel };

/** Fournisseur des fiches (API). */
export const creerFournisseurFiche = () => new FournisseurFicheApi({ base: '/api/fiches', entetes: ENTETES });
