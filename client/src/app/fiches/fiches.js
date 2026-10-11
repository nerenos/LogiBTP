import { FicheBase } from '@logibtp/fiche/ui';
import { FournisseurFicheApi, FournisseurFicheMemoire, MODES } from '@logibtp/fiche';
import { formatNombre } from '@logibtp/socle/ui';
import { ENTETES } from '../api.js';
import { TYPES_FICHE, DROITS_FICHE, PARAMETRAGE_FICHE } from './definitions.js';
import { apresEcritureElement } from '../bibliotheque/bibliotheque.js';

// Fiches du cœur : spécialisations de FicheBase (module Fiche) pour les salariés et les matériels.

const jours = (iso) => (iso ? (Date.now() - Date.parse(String(iso).slice(0, 10))) / 86400000 : null);
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const info = (libelle, valeur, alerte = false) => `<span class="info ${alerte ? 'alerte' : ''}"><small>${libelle}</small>${valeur}</span>`;

/** Fiche du cœur : actions de démonstration hors ligne (verrou d'un autre utilisateur). */
export class FicheLogiBTP extends FicheBase {
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

export class FicheSalarie extends FicheLogiBTP {
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

/** Fournisseur des fiches : API, ou mémoire hors ligne sur les mêmes lignes que les listes de démonstration. */
export function creerFournisseurFiche({ enLigne, lignes, bibliotheque = null }) {
  if (enLigne) return new FournisseurFicheApi({ base: '/api/fiches', entetes: ENTETES });
  return new FournisseurFicheMemoire({
    types: {
      salarie: {
        definition: TYPES_FICHE.salarie.definition, cle: 'id', proprietes: 'proprietes', lignes: lignes.salaries,
        // Colonnes de la vue de liste dérivées de la fiche (comme v_liste_salaries).
        derivees: (l) => ({ type_element: l.statut === 'INTERIM' ? 'interim' : 'salarie' }),
      },
      materiel: { definition: TYPES_FICHE.materiel.definition, cle: 'id', proprietes: 'proprietes', lignes: lignes.materiels },
      // Éléments de bibliothèque : prix, historique et colonnes de liste recalculés après écriture (rôle du serveur).
      ...(bibliotheque ? {
        element: {
          definition: TYPES_FICHE.element.definition, cle: 'id', proprietes: 'proprietes', lignes: bibliotheque.elements,
          derivees: (l) => { apresEcritureElement(bibliotheque, l); return {}; },
        },
      } : {}),
    },
    droits: DROITS_FICHE,
    profil: ENTETES['X-Profil'] ?? 'ADMIN',
    utilisateur: ENTETES['X-Utilisateur'] ?? 'demo',
    parametrage: PARAMETRAGE_FICHE,
  });
}
