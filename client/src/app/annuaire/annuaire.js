import { FournisseurAnnuaireApi } from '@logibtp/annuaire';
import { FournisseurEntreprisesApi } from '@logibtp/entreprises-fr';
import { ENTETES } from '../api.js';

// Annuaire du cœur : fournisseurs (API) de l'annuaire et de la recherche d'entreprises françaises.

export const creerFournisseurAnnuaire = () => new FournisseurAnnuaireApi({ base: '/api/annuaire', entetes: ENTETES });

/** Recherche d'entreprises françaises : par le serveur. */
export const creerFournisseurEntreprises = () => new FournisseurEntreprisesApi({ base: '/api/entreprises-fr', entetes: ENTETES });
