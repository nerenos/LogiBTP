// Codes du module Bibliothèque, répliqués dans LogiBTP.Bibliotheque/Codes.cs (parité vérifiée par BibliothequeTests.cs).

/** Type de gestion d'un élément (ele_gestion). */
export const GESTION_ELEMENT = Object.freeze({
  STOCK: 'STOCK',
  ACHAT: 'ACHAT',
  SOUS_TRAITANCE: 'SOUS_TRAITANCE',
  NON_GERE: 'NON_GERE',
});

/** Scénario de prix d'achat d'un élément (ele_scenario_pa). */
export const SCENARIO_PA = Object.freeze({
  FIXE: 'FIXE',
  FOURNISSEUR_PRINCIPAL: 'FOURNISSEUR_PRINCIPAL',
  DERNIER_PA: 'DERNIER_PA',
  MEILLEUR_MIN: 'MEILLEUR_MIN',
  MEILLEUR_MAX: 'MEILLEUR_MAX',
  PMP: 'PMP',
});

/** Genre d'un poste de pied (ele_pied_genre, recopié dans lig_proprietes.genre_poste). */
export const GENRE_POSTE = Object.freeze({
  REMISE: 'REMISE',
  PRORATA: 'PRORATA',
  ACOMPTE: 'ACOMPTE',
  PAIEMENT_DIRECT: 'PAIEMENT_DIRECT',
  RETENUE: 'RETENUE',
  AUTRE: 'AUTRE',
});
