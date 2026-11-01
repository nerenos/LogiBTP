// Codes du module Rentabilité, répliqués dans LogiBTP.Rentabilite/Codes.cs (parité vérifiée par CodesTests.cs).

/** Indicateurs portés par les faits (flux datés : la somme jusqu'à T donne l'état ou le cumul à T). */
export const INDICATEUR = Object.freeze({
  BUDGET: 'BUDGET',
  BUDGET_EXECUTION: 'BUDGET_EXECUTION',
  ENGAGE: 'ENGAGE',
  DEBOURSE: 'DEBOURSE',
  FACTURE: 'FACTURE',
  ACOMPTE_PAYE: 'ACOMPTE_PAYE',
  ACOMPTE_UTILISE: 'ACOMPTE_UTILISE',
  PRODUCTION: 'PRODUCTION',
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
  ACOMPTE: 'ACOMPTE',
});

/** Source d'un fait. */
export const SOURCE_FAIT = Object.freeze({
  DOCUMENT: 'DOCUMENT',
  POINTAGE: 'POINTAGE',
  TACHE: 'TACHE',
  MOUVEMENT: 'MOUVEMENT',
  REGLEMENT: 'REGLEMENT',
  POINTAGE_MATERIEL: 'POINTAGE_MATERIEL',
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

/** Borne d'une période saisie (lirePeriode). */
export const BORNE_PERIODE = Object.freeze({
  DEBUT: 'DEBUT',
  FIN: 'FIN',
});

/** Raccourcis de période. */
export const RACCOURCI_PERIODE = Object.freeze({
  MOIS: 'MOIS',
  MOIS_PRECEDENT: 'MOIS_PRECEDENT',
  EXERCICE: 'EXERCICE',
  ORIGINE: 'ORIGINE',
});

/** Erreurs de saisie d'une période. */
export const ERREUR_PERIODE = Object.freeze({
  DATE: 'PERIODE_DATE',
  ORDRE: 'PERIODE_ORDRE',
});

/** Type d'une photo (copie figée des faits d'un chantier à une date). */
export const TYPE_PHOTO = Object.freeze({
  MOIS: 'MOIS',
  MANUEL: 'MANUEL',
});

/** Niveaux d'origine de la Liste. */
export const NIVEAU_LISTE = Object.freeze({
  CHARGE: 'CHARGE',
  AFFAIRE: 'AFFAIRE',
});
