import { FournisseurAnnuaireApi, FournisseurAnnuaireMemoire } from '@logibtp/annuaire';
import { FournisseurEntreprisesApi, FournisseurEntreprisesDirect } from '@logibtp/entreprises-fr';
import { ENTETES } from '../api.js';
import { annuaireDesSalaries } from './salaries.js';
import { NIVEAUX, CASQUETTES, TYPES_LIEN, ROLES, PERSONNES, INDIVIDUS, RATTACHEMENTS, LIENS, COORDONNEES, USAGES, TIERS_TARIFS } from './donnees.js';

// Annuaire du cœur : fournisseurs (API ou démo hors ligne) de l'annuaire et de la recherche d'entreprises françaises.

/** Démo hors ligne : les salariés de démonstration (lignes partagées avec leurs fiches) sont des individus de l'annuaire. */
export function creerFournisseurAnnuaire({ enLigne, utilisateur = 'demo', profil = 'ADMIN', salaries = [] }) {
  if (enLigne) return new FournisseurAnnuaireApi({ base: '/api/annuaire', entetes: ENTETES });
  const s = annuaireDesSalaries(salaries);
  return new FournisseurAnnuaireMemoire({
    niveaux: NIVEAUX, casquettes: CASQUETTES, types_lien: TYPES_LIEN, roles: ROLES, personnes: PERSONNES, individus: [...INDIVIDUS, ...s.individus],
    rattachements: [...RATTACHEMENTS, ...s.rattachements], liens: LIENS, coordonnees: [...COORDONNEES, ...s.coordonnees], usages: [...USAGES, ...s.usages],
    utilisateur, profil,
  });
}

/** Recherche d'entreprises : par le serveur, ou directement depuis le navigateur hors ligne (API publique sans clé). */
export function creerFournisseurEntreprises({ enLigne }) {
  return enLigne ? new FournisseurEntreprisesApi({ base: '/api/entreprises-fr', entetes: ENTETES }) : new FournisseurEntreprisesDirect();
}

/** Démo hors ligne : tarifs de la bibliothèque reliés aux fournisseurs de l'annuaire (tfo_tiers_id). */
export function relierTarifs(bibliotheque) {
  for (const t of bibliotheque.tarifsElements ?? []) t.tiers_id ??= TIERS_TARIFS[t.fournisseur] ?? null;
}
