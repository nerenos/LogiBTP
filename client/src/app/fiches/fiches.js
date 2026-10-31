import { urlFiche, TYPE_FICHE } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { FicheBase } from '@logibtp/fiche/ui';
import { FournisseurFicheApi, MODES } from '@logibtp/fiche';
import { formatNombre, echapper, saisir } from '@logibtp/socle/ui';
import { principale } from '@logibtp/annuaire';
import { choisirIndividu } from '@logibtp/annuaire/ui';
import { ENTETES } from '../api.js';
import { rolesSalarie } from '../annuaire/salaries.js';
import { urlPhotoIndividu, vignette } from '../annuaire/photo.js';

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
      code: 'suivi', titre: 'Suivi',
      rendre: (corps) => {
        if (this.id === null) { corps.innerHTML = '<p class="aide">Enregistrez la fiche pour suivre ses notes et ses tâches.</p>'; return; }
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
      ...(r ? [{ code: 'habilitations', titre: 'Habilitations', rendre: (corps) => r.habilitations(corps, { element: 'salarie', id: this.id }) }] : []),
      ...(r && this.valeur('statut') === 'INTERIM' ? [{ code: 'missions', titre: 'Missions', rendre: (corps) => r.missions(corps, { salarie: this.id }) }] : []),
      ...(r?.materielAffecte ? [{ code: 'materiel-affecte', titre: 'Matériel', rendre: (corps) => r.materielAffecte(corps, { type: this.valeur('statut') === 'INTERIM' ? 'INTERIM' : 'SALARIE', id: this.id }) }] : []),
      ...(this.dotations ? [{ code: 'dotations', titre: 'Dotations', rendre: (corps) => this.dotations(corps, { salarie: Number(this.id) }) }] : []),
      ...(this.compte ? [this.#ongletCompte()] : [])];
  }

  #ongletCompte() {
    return {
      code: 'compte', titre: 'Compte',
      rendre: (corps) => {
        const ind = this.valeur('ind_id');
        if (!ind) { corps.innerHTML = "<p class=\"aide\">Liez d'abord le salarié à un individu de l'annuaire (onglet principal) : le compte de connexion se rattache à l'individu.</p>"; return; }
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
    return { ...v, ind_id: Number(i.id), ...this.#valeursIndividu(i.valeurs, v) };
  }

  /** Agences proposées (notre société et ses niveaux inférieurs, v_agences_societe) : identifiants des personnes. */
  #agences() {
    return (this.definition.champs.find((c) => c.code === 'agence')?.options ?? []).map((o) => Number(o.valeur));
  }

  /**
   * Valeurs du salarié lues dans un individu de l'annuaire : identité, agence et poste (son rattachement à l'une de nos
   * agences), coordonnées professionnelles de ce rattachement, contrat intérim.
   */
  #valeursIndividu(iv, v) {
    const agences = this.#agences();
    const rat = (iv.rattachements ?? []).find((r) => r.actif !== false && agences.includes(Number(r.per_id)))
      ?? (iv.rattachements ?? []).find((r) => agences.includes(Number(r.per_id))) ?? null;
    return {
      nom: iv.nom ?? null, prenom: iv.prenom ?? null, agence: rat ? Number(rat.per_id) : null, service: rat?.service ?? null, poste: rat?.fonction?.replace(/ \(intérim\)$/, '') ?? null,
      statut: (iv.roles ?? []).includes('INTERIMAIRE') ? 'INTERIM' : v.statut,
      email: principale(rat?.coordonnees ?? [], 'EMAIL'), telephone: principale(rat?.coordonnees ?? [], 'TELEPHONE'),
    };
  }

  /** Individu lié en saisie (FS1) : ses valeurs complètent les champs vides du salarié, sans rien écraser. */
  async #completerDepuisIndividu(id) {
    const i = await this.fournisseur.charger(TYPE_FICHE.INDIVIDU, id).catch(() => null);
    if (!i) return 0;
    const v = this.valeurs();
    const vide = (x) => x === null || x === undefined || x === '';
    const completes = Object.entries(this.#valeursIndividu(i.valeurs, v)).filter(([code, x]) => !vide(x) && vide(v[code]) && code !== 'statut');
    if (i.valeurs.roles?.includes('INTERIMAIRE') && v.statut !== 'INTERIM' && vide(v.statut)) completes.push(['statut', 'INTERIM']);
    for (const [code, x] of completes) this.definirValeur(code, x);
    return completes.length;
  }

  /** Individu de l'annuaire : lien vers sa fiche ; en saisie, lier à un individu existant ou le créer. */
  rendreChamp(champ, valeur) {
    if (champ.code !== 'ind_id') return super.rendreChamp(champ, valeur);
    const el = document.createElement('div');
    el.className = 'fiche-saisie-champ annuaire-parent';
    const saisie = this.estEnSaisie();
    el.innerHTML = valeur ? `<a href="${urlFiche(TYPE_FICHE.INDIVIDU, valeur)}" data-ouvrir>👤 ${echapper(this.libelleIndividu ?? `Individu ${valeur}`)}</a>` : '<span class="aide">Non lié à l\'annuaire</span>';
    if (saisie) {
      el.insertAdjacentHTML('beforeend', ` <button type="button" data-lier title="Lier à un individu existant de l'annuaire">…</button>
        ${valeur ? '<button type="button" data-delier title="Retirer le lien">✕</button>' : '<button type="button" data-creer title="Créer l\'individu dans l\'annuaire (rattaché à l\'agence)">＋ Créer dans l\'annuaire</button>'}`);
    }
    el.querySelector('[data-ouvrir]')?.addEventListener('click', (e) => { e.preventDefault(); this.ouvrirFiche({ type: TYPE_FICHE.INDIVIDU, id: valeur }, e); });
    el.querySelector('[data-delier]')?.addEventListener('click', () => { this.definirValeur('ind_id', null); this.rendre(); });
    el.querySelector('[data-lier]')?.addEventListener('click', async () => {
      const r = await choisirIndividu({ annuaire: this.services.annuaire, titre: 'Individu du salarié', nom: [this.valeur('nom'), this.valeur('prenom')].filter(Boolean).join(' ') });
      if (!r) return;
      if (r.nouveau) { await this.#creerIndividu(r.nouveau); return; }
      this.libelleIndividu = r.individu.nom_complet;
      this.definirValeur('ind_id', r.individu.id);
      const n = await this.#completerDepuisIndividu(r.individu.id);
      this.rendre();
      if (n) this.message(`${n} champ${n > 1 ? 's' : ''} complété${n > 1 ? 's' : ''} depuis l'annuaire`, 'succes');
    });
    el.querySelector('[data-creer]')?.addEventListener('click', () => this.#creerIndividu({ nom: this.valeur('nom'), prenom: this.valeur('prenom') }).catch((e) => this.message(e.message, 'erreur')));
    if (valeur && !this.libelleIndividu) {
      this.services.annuaire.individu(valeur).then((i) => { this.libelleIndividu = i.nom_complet; const a = el.querySelector('[data-ouvrir]'); if (a) a.textContent = `👤 ${i.nom_complet}`; }).catch(() => {});
    }
    return el;
  }

  /** Individu créé dans l'annuaire, rattaché à l'agence du salarié avec ses coordonnées professionnelles. */
  async #creerIndividu({ civilite = null, nom, prenom }) {
    if (!nom) { this.message('Saisissez d\'abord le nom du salarié', 'avertissement'); return; }
    const v = this.valeurs();
    const coordonnees = [
      v.email ? { nature: 'EMAIL', usage: 'PRO', valeur: v.email, principal: true } : null,
      v.telephone ? { nature: 'TELEPHONE', usage: 'PORTABLE', valeur: v.telephone, principal: true } : null,
    ].filter(Boolean);
    // Agence du salarié, sinon notre société (première des agences proposées).
    const agence = Number(v.agence) || this.#agences()[0];
    if (!agence) { this.message('Aucune agence de notre société dans l\'annuaire', 'erreur'); return; }
    const i = await this.fournisseur.creer(TYPE_FICHE.INDIVIDU, {
      valeurs: {
        civilite, nom, prenom, pays: 'FR', actif: true, usage: 'A', roles: rolesSalarie(v),
        rattachements: [{ per_id: agence, fonction: v.poste ?? null, service: v.service ?? null, debut: v.date_entree ?? null, actif: true, coordonnees }],
      },
      proprietes: {},
    });
    this.libelleIndividu = [nom?.toUpperCase(), prenom].filter(Boolean).join(' ');
    this.definirValeur('ind_id', Number(i.id));
    this.rendre();
    this.message('Individu créé dans l\'annuaire et rattaché à l\'agence : enregistrez le salarié pour conserver le lien', 'succes');
  }

  actionsSupplementaires() {
    const ind = this.valeur('ind_id');
    return [
      { libelle: '👤 Fiche annuaire', titre: 'Ouvrir la fiche de l\'individu (coordonnées, rattachements)', visible: !this.estEnSaisie() && !!ind, action: () => this.ouvrirFiche({ type: TYPE_FICHE.INDIVIDU, id: ind }) },
      ...super.actionsSupplementaires(),
    ];
  }

  rendreInformations(v) {
    const parts = [];
    const anciennete = jours(v.date_entree);
    if (anciennete !== null) parts.push(info('Ancienneté', `${Math.max(0, Math.floor(anciennete / 365.25))} an(s)`));
    const age = jours(v.date_naissance);
    if (age !== null) parts.push(info('Âge', `${Math.floor(age / 365.25)} ans`));
    if (v.salaire_brut !== null && v.salaire_brut !== undefined && Number(v.heures_mois) > 0) {
      parts.push(info('Coût horaire chargé', `${formatNombre(Number(String(v.salaire_brut).replace(',', '.')) * 1.45 / Number(String(v.heures_mois).replace(',', '.')), 2)} €`));
    }
    if (v.actif === false) parts.push(info('Situation', 'Sorti des effectifs', true));
    return parts.join('');
  }

  validerMetier(v) {
    const erreurs = [];
    if (v.date_entree && String(v.date_entree).slice(0, 10) > aujourdhui()) erreurs.push({ champ: 'date_entree', message: 'Date d\'entrée dans le futur' });
    if (v.date_naissance) {
      if (jours(v.date_naissance) / 365.25 < 15) erreurs.push({ champ: 'date_naissance', message: 'Âge inférieur à 15 ans' });
      if (v.date_entree && String(v.date_naissance) >= String(v.date_entree)) erreurs.push({ champ: 'date_naissance', message: 'Naissance postérieure à l\'entrée' });
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
      code: 'habilitations', titre: 'Contrôles et habilitations',
      rendre: (corps) => {
        corps.innerHTML = '<div data-controles></div><div data-exigees></div>';
        r.habilitations(corps.querySelector('[data-controles]'), { element: 'materiel', id: this.id, titre: 'Contrôles réglementaires' });
        r.exigees(corps.querySelector('[data-exigees]'), { materiel: this.id });
      },
    }, ...(r.affectations ? [{ code: 'affectations', titre: 'Affectations', rendre: (corps) => r.affectations(corps, { materiel: this.id, identifie: this.valeur('mode') === 'IDENTIFIE' }) }] : []),
      ...(r.compteurs ? [{ code: 'compteurs', titre: 'Compteurs', rendre: (corps) => r.compteurs(corps, { materiel: this.id }) }] : []),
      ...(r.etats ? [{ code: 'historique', titre: 'Historique', rendre: (corps) => r.etats(corps, { materiel: this.id }) }] : []),
      ...(r.couts ? [{ code: 'couts', titre: 'Coûts', rendre: (corps) => r.couts(corps, { materiel: this.id }) }] : [])];
  }

  /**
   * Matériel identifié (FM1) : quantité 1 en lecture seule, unité masquée ; changement de disponibilité ou de condition
   * en modification (FM3) : motif demandé, tracé dans l'historique (db/252).
   */
  rendreChamp(champ, valeur) {
    const identifie = this.valeur('mode') === 'IDENTIFIE';
    if (identifie && (champ.code === 'quantite' || champ.code === 'unite')) {
      const el = super.rendreChamp({ ...champ, lecture_seule: true }, champ.code === 'quantite' ? 1 : null);
      el.title = 'Matériel identifié : toujours un seul';
      if (champ.code === 'unite') el.placeholder = '—';
      return el;
    }
    const el = super.rendreChamp(champ, valeur);
    if (!this.estEnSaisie()) return el;
    if (champ.code === 'mode') {
      el.addEventListener('change', () => {
        if (this.valeur('mode') === 'IDENTIFIE') this.definirValeur('quantite', 1);
        this.rendre();
      });
    }
    if ((champ.code === 'etat' || champ.code === 'condition') && this.mode === MODES.MODIFICATION) {
      el.addEventListener('change', async () => {
        // Un seul motif par valeur choisie (le combo peut signaler deux fois le même choix) ; retour à la valeur
        // enregistrée : pas de motif.
        const v = this.valeur(champ.code);
        this.etatsDemandes ??= {};
        if (v === this.etatsDemandes[champ.code] || v === this.fiche.valeurs[champ.code]) { this.etatsDemandes[champ.code] = v; return; }
        this.etatsDemandes[champ.code] = v;
        const motif = await saisir('Motif du changement (gardé dans l\'historique du matériel) :', this.valeur('etat_motif') ?? '', { titre: 'Changement d\'état du matériel' });
        if (motif !== null) this.definirValeur('etat_motif', motif.trim() || null);
      });
    }
    return el;
  }

  rendreInformations(v) {
    const parts = [];
    const age = jours(v.date_achat);
    if (age !== null) parts.push(info('Âge', `${(age / 365.25).toFixed(1).replace('.', ',')} an(s)`));
    if (v.etat === 'PANNE') parts.push(info('État', 'En panne', true));
    if (v.condition === 'ENDOMMAGE' || v.condition === 'HS') parts.push(info('Condition', v.condition === 'HS' ? 'Hors service' : 'Endommagé', true));
    if (v.controle_ok === false) parts.push(info('Contrôle réglementaire', 'à faire', true));
    return parts.join('');
  }

  validerMetier(v) {
    const erreurs = [];
    if (Number(v.heures_utilisation) < 0) erreurs.push({ champ: 'heures_utilisation', message: 'Nombre d\'heures négatif' });
    if (v.date_achat && String(v.date_achat).slice(0, 10) > aujourdhui()) erreurs.push({ champ: 'date_achat', message: 'Date d\'achat dans le futur' });
    if (v.etat === 'CHANTIER' && !v.chantier) erreurs.push({ champ: 'chantier', message: 'Chantier à préciser pour un matériel en chantier' });
    return erreurs;
  }
}

export const CLASSES_FICHE = { salarie: FicheSalarie, materiel: FicheMateriel };

/** Fournisseur des fiches (API). */
export const creerFournisseurFiche = () => new FournisseurFicheApi({ base: '/api/fiches', entetes: ENTETES });
