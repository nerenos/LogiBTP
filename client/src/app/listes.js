import { FournisseurApi } from '@logibtp/liste';
import { FAMILLES_REGLE } from '@logibtp/document';
import { ENTETES } from './api.js';

// Branchement du module Liste dans le cœur : fournisseur (API) et ouverture des fiches.

export const creerFournisseurListe = () => new FournisseurApi({ base: '/api/listes', entetes: ENTETES });

/** Libellé d'un type d'élément sans écran de fiche. */
export const LIBELLES_ELEMENTS = {
  salarie: 'salarié', interim: 'intérimaire', materiel: 'matériel', equipe: 'équipe', sous_traitant: 'sous-traitant', document_ged: 'document', element: 'élément',
  personne: 'personne', individu: 'individu', projet: 'projet', affaire: 'affaire', chantier: 'chantier', marche: 'marché',
};

/** Les types d'éléments préfixés d'une famille de documents (V_, A_, S_, E_, T_…) sont des documents (code du type). */
const PREFIXES_DOCUMENT = new RegExp(`^[${FAMILLES_REGLE.map(([f]) => f).join('')}]_`);
export const estTypeDocument = (type) => PREFIXES_DOCUMENT.test(String(type ?? ''));
