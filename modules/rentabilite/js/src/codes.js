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
  // Saisies prévisionnelles (lot 6, § 10.1) : jamais mélangées au réel.
  PREVU_BUDGET: 'PREVU_BUDGET',
  PREVU_EXECUTION: 'PREVU_EXECUTION',
  PREVU_ENGAGE: 'PREVU_ENGAGE',
  PREVU_DEBOURSE: 'PREVU_DEBOURSE',
  PREVU_FACTURE: 'PREVU_FACTURE',
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
  PREVISION: 'PREVISION',
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

/** État d'une saisie prévisionnelle : ouverte, échue (échéance passée sans solde), soldée. */
export const ETAT_PREVISION = Object.freeze({
  OUVERTE: 'OUVERTE',
  ECHUE: 'ECHUE',
  SOLDEE: 'SOLDEE',
});

/** Action du journal d'une saisie prévisionnelle. */
export const ACTION_PREVISION = Object.freeze({
  CREATION: 'CREATION',
  MODIFICATION: 'MODIFICATION',
  SOLDE: 'SOLDE',
  REOUVERTURE: 'REOUVERTURE',
  SUPPRESSION: 'SUPPRESSION',
});

/** Erreurs de saisie d'une prévision. */
export const ERREUR_PREVISION = Object.freeze({
  INDICATEUR: 'PREVISION_INDICATEUR',
  COMPOSANTE: 'PREVISION_COMPOSANTE',
  LIBELLE: 'PREVISION_LIBELLE',
  MONTANT: 'PREVISION_MONTANT',
  SOLDEE: 'PREVISION_SOLDEE',
  VERSION: 'PREVISION_VERSION',
});

/** Mode de saisie d'un mois du prévisionnel de facturation (lot 7) : montant HT ou % du budget PV. */
export const MODE_FACTURATION = Object.freeze({
  MONTANT: 'MONTANT',
  POURCENT: 'POURCENT',
});

/** Erreurs d'une prévision de facturation. */
export const ERREUR_FACTURATION = Object.freeze({
  MOIS: 'FACTURATION_MOIS',
  DOUBLON: 'FACTURATION_DOUBLON',
  MODE: 'FACTURATION_MODE',
  VALEUR: 'FACTURATION_VALEUR',
  BUDGET: 'FACTURATION_BUDGET',
  VERSION: 'FACTURATION_VERSION',
});
