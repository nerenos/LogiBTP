import { FicheBase } from '@logibtp/fiche/ui';
import { FournisseurFicheApi, FournisseurFicheMemoire, MODES } from '@logibtp/fiche';
import { formatNombre, echapper } from '@logibtp/socle/ui';
import { principale } from '@logibtp/annuaire';
import { choisirIndividu } from '@logibtp/annuaire/ui';
import { ENTETES } from '../api.js';
import { TYPES_FICHE, DROITS_FICHE, PARAMETRAGE_FICHE } from './definitions.js';
import { apresEcritureElement } from '../bibliotheque/bibliotheque.js';
import { synchroniserSalarie, rolesSalarie } from '../annuaire/salaries.js';
import { urlPhotoIndividu, vignette } from '../annuaire/photo.js';
import { AGENCES_SALARIES } from '../annuaire/donnees.js';

// Fiches du cœur : spécialisations de FicheBase (module Fiche) pour les salariés et les matériels.

const jours = (iso) => (iso ? (Date.now() - Date.parse(String(iso).slice(0, 10))) / 86400000 : null);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const info = (libelle, valeur, alerte = false) => `<span class="info ${alerte ? 'alerte' : ''}"><small>${libelle}</small>${valeur}</span>`;

/** Fiche du cœur : actions de démonstration hors ligne (verrou d'un autre utilisateur). */
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

  actionsSupplementaires() {
    if (typeof this.fournisseur.simulerVerrouAutre !== 'function' || this.id === null) return [];
    return [{
      libelle: '👤 Autre utilisateur',
      titre: 'Démo : un autre utilisateur ouvre cette fiche en modification',
      action: async () => {
        this.fournisseur.simulerVerrouAutre(this.type, this.id, 'm.dupont');
        if (this.mode === MODES.MODIFICATION) await this.controlerVerrou();
        else { await this.recharger(); this.rendre(); }
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
      ...(this.dotations ? [{ code: 'dotations', titre: 'Dotations', rendre: (corps) => this.dotations(corps, { salarie: Number(this.id) }) }] : []),
      ...(this.compte ? [this.#ongletCompte()] : [])];
  }

  #ongletCompte() {
    return {
      code: 'compte', titre: 'Compte',
      rendre: (corps) => {
        const ind = this.valeur('ind_id');
        if (!ind) { corps.innerHTML = "<p class=\"aide\">Liez d'abord le salarié à un individu de l'annuaire (onglet principal) : le compte de connexion se rattache à l'individu.</p>"; return; }
        this.compte(corps, { type: 'individu', id: ind, prenom: this.valeur('prenom'), nom: this.valeur('nom') });
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
    if (this.mode === MODES.CREATION && ind) this.individuSource = await this.fournisseur.charger('individu', ind).catch(() => null);
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
    el.innerHTML = valeur ? `<a href="/fiche/individu/${valeur}" data-ouvrir>👤 ${echapper(this.libelleIndividu ?? `Individu ${valeur}`)}</a>` : '<span class="aide">Non lié à l\'annuaire</span>';
    if (saisie) {
      el.insertAdjacentHTML('beforeend', ` <button type="button" data-lier title="Lier à un individu existant de l'annuaire">…</button>
        ${valeur ? '<button type="button" data-delier title="Retirer le lien">✕</button>' : '<button type="button" data-creer title="Créer l\'individu dans l\'annuaire (rattaché à l\'agence)">＋ Créer dans l\'annuaire</button>'}`);
    }
    el.querySelector('[data-ouvrir]')?.addEventListener('click', (e) => { e.preventDefault(); this.ouvrirFiche({ type: 'individu', id: valeur }, e); });
    el.querySelector('[data-delier]')?.addEventListener('click', () => { this.definirValeur('ind_id', null); this.rendre(); });
    el.querySelector('[data-lier]')?.addEventListener('click', async () => {
      const r = await choisirIndividu({ annuaire: this.services.annuaire, titre: 'Individu du salarié', nom: [this.valeur('nom'), this.valeur('prenom')].filter(Boolean).join(' ') });
      if (!r) return;
      if (r.nouveau) { await this.#creerIndividu(r.nouveau); return; }
      this.libelleIndividu = r.individu.nom_complet;
      this.definirValeur('ind_id', r.individu.id);
      this.rendre();
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
    const agence = AGENCES_SALARIES[v.agence] ?? AGENCES_SALARIES.Lyon;
    const i = await this.fournisseur.creer('individu', {
      valeurs: {
        civilite, nom, prenom, pays: 'FR', actif: true, roles: rolesSalarie(v),
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
      { libelle: '👤 Fiche annuaire', titre: 'Ouvrir la fiche de l\'individu (coordonnées, rattachements)', visible: !this.estEnSaisie() && !!ind, action: () => this.ouvrirFiche({ type: 'individu', id: ind }) },
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
    }];
  }

  rendreInformations(v) {
    const h = Number(v.heures_utilisation), r = Number(v.heures_revision);
    const parts = [];
    if (r > 0) parts.push(h > r ? info('Révision', `dépassée de ${h - r} h`, true) : info('Avant révision', `${r - h} h`));
    const age = jours(v.date_achat);
    if (age !== null) parts.push(info('Âge', `${(age / 365.25).toFixed(1).replace('.', ',')} an(s)`));
    if (v.etat === 'PANNE') parts.push(info('État', 'En panne', true));
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

/** Résumé de la fiche salarié liée à un individu (champ géré « salarie » de la fiche individu), ou null. */
export function salarieDe(salaries, indId) {
  const s = salaries.find((x) => Number(x.ind_id) === Number(indId));
  return s ? { id: s.id, matricule: s.matricule, poste: s.poste, agence: s.agence, statut: s.statut, actif: s.actif !== false } : null;
}

/** Fournisseur des fiches : API, ou mémoire hors ligne sur les mêmes lignes que les listes de démonstration. */
export function creerFournisseurFiche({ enLigne, lignes, bibliotheque = null, annuaire = null, structure = null }) {
  if (enLigne) return new FournisseurFicheApi({ base: '/api/fiches', entetes: ENTETES });
  return new FournisseurFicheMemoire({
    types: {
      salarie: {
        definition: TYPES_FICHE.salarie.definition, cle: 'id', proprietes: 'proprietes', lignes: lignes.salaries,
        // Colonnes de la vue de liste dérivées de la fiche (comme v_liste_salaries).
        // Individu de l'annuaire mis à jour après écriture (identité, rôle, rattachement à l'agence).
        derivees: (l) => {
          if (annuaire && l.ind_id) queueMicrotask(() => synchroniserSalarie(annuaire, lignes.salaries.find((x) => x.id === l.id) ?? l));
          return { type_element: l.statut === 'INTERIM' ? 'interim' : 'salarie' };
        },
      },
      materiel: { definition: TYPES_FICHE.materiel.definition, cle: 'id', proprietes: 'proprietes', lignes: lignes.materiels },
      // Structure des affaires : mêmes lignes que les listes de démonstration.
      ...(structure ? Object.fromEntries([['projet', 'projets'], ['affaire', 'affaires'], ['chantier', 'chantiers'], ['marche', 'marches']]
        .map(([type, tableau]) => [type, { definition: TYPES_FICHE[type].definition, cle: 'id', proprietes: 'proprietes', lignes: structure[tableau], geres: structure.geres(type) }])) : {}),
      // Éléments de bibliothèque : prix, historique et colonnes de liste recalculés après écriture (rôle du serveur).
      ...(bibliotheque ? {
        element: {
          definition: TYPES_FICHE.element.definition, cle: 'id', proprietes: 'proprietes', lignes: bibliotheque.elements,
          derivees: (l) => { apresEcritureElement(bibliotheque, l); return {}; },
        },
      } : {}),
      // Annuaire : coordonnées, rattachements et liens en champs gérés ; contrôles avant écriture (société de la base unique,
      // SIRET unique, hiérarchie sans boucle) et colonnes de liste recalculées (rôle du serveur et des vues).
      ...(annuaire ? {
        personne: {
          definition: TYPES_FICHE.personne.definition, cle: 'id', proprietes: 'proprietes', lignes: annuaire.personnes, geres: annuaire.geres('personne'),
          derivees: (l) => { annuaire.controlerPersonne(l.id ?? null, l); queueMicrotask(() => annuaire.deriver()); return {}; },
        },
        individu: {
          definition: TYPES_FICHE.individu.definition, cle: 'id', proprietes: 'proprietes', lignes: annuaire.individus,
          // Fiche salarié liée, en plus des champs gérés par l'annuaire.
          geres: (() => {
            const g = annuaire.geres('individu');
            return { ...g, lire: async (l) => ({ ...(await g.lire(l)), salarie: salarieDe(lignes.salaries, l.id) }) };
          })(),
          derivees: () => { queueMicrotask(() => annuaire.deriver()); return {}; },
        },
      } : {}),
    },
    droits: DROITS_FICHE,
    profil: ENTETES['X-Profil'] ?? 'ADMIN',
    utilisateur: ENTETES['X-Utilisateur'] ?? 'demo',
    parametrage: PARAMETRAGE_FICHE,
  });
}
