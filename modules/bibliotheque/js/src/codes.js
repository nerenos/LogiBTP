// Codes du module Bibliothèque, répliqués dans LogiBTP.Bibliotheque/Codes.cs (parité vérifiée par BibliothequeTests.cs).

/** Type de gestion d'un élément (ele_gestion). */
export const GESTION_ELEMENT = Object.freeze({
  STOCK: 'STOCK',
  ACHAT: 'ACHAT',
  SOUS_TRAITANCE: 'SOUS_TRAITANCE',
  NON_GERE: 'NON_GERE',
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
