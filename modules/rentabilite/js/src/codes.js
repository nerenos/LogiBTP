// Codes du module Rentabilité, répliqués dans LogiBTP.Rentabilite/Codes.cs (parité vérifiée par CodesTests.cs).

/** Indicateurs portés par les faits (flux datés : la somme jusqu'à T donne l'état ou le cumul à T). */
export const INDICATEUR = Object.freeze({
  BUDGET: 'BUDGET',
  BUDGET_EXECUTION: 'BUDGET_EXECUTION',
  ENGAGE: 'ENGAGE',
  DEBOURSE: 'DEBOURSE',
  FACTURE: 'FACTURE',
});

/** Composante d'un fait (colonne de détail des indicateurs de coût). */
export const COMPOSANTE = Object.freeze({
  VENTE: 'VENTE',
  ACHAT: 'ACHAT',
  SOUS_TRAITANCE: 'SOUS_TRAITANCE',
  MO: 'MO',
  MATERIEL: 'MATERIEL',
  STOCK: 'STOCK',
  POSTE: 'POSTE',
});

/** Source d'un fait. */
export const SOURCE_FAIT = Object.freeze({
  DOCUMENT: 'DOCUMENT',
  POINTAGE: 'POINTAGE',
  TACHE: 'TACHE',
  MOUVEMENT: 'MOUVEMENT',
});

/** État d'un calcul (rca_etat). */
export const ETAT_CALCUL = Object.freeze({
  EN_COURS: 'EN_COURS',
  OK: 'OK',
  ERREUR: 'ERREUR',
});

/** Déclencheur d'un calcul (rca_declencheur). */
export const DECLENCHEUR = Object.freeze({
  FILE: 'FILE',
  NUIT: 'NUIT',
  MANUEL: 'MANUEL',
});
