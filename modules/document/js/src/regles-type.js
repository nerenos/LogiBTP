// Règles des documents résolues pour un type (CONCEPTION-REGLES-DOCUMENTS.md, § 6.1) : la définition du type
// (GET /types-document/{code}/definition) porte `regles` : code → valeur (type, sinon famille, sinon global, sinon
// défaut du catalogue). Valeur absente : `defaut`.

import { FAMILLE_DOCUMENT } from './codes.js';

/** Valeur d'une règle pour le type d'une définition. */
export function regle(definition, code, defaut = null) {
  const v = definition?.regles?.[code];
  return v === undefined || v === null ? defaut : v;
}

/** Libellés des niveaux de règle. */
export const FAMILLES_REGLE = [['V', 'Ventes'], ['A', 'Achats'], ['S', 'Stock'], ['E', 'Exécution'], ['T', 'Sous-traitance']];

/** Famille d'achat : achats et sous-traitance (tiers fournisseur, comptes d'achat, décaissement). */
export const estFamilleAchat = (famille) => famille === FAMILLE_DOCUMENT.ACHAT || famille === FAMILLE_DOCUMENT.SOUS_TRAITANCE;
