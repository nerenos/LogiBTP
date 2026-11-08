// Codes du module Relances, répliqués dans Codes.cs (parité vérifiée par CodesTests).

/** Nature d'une pièce relancée : devis envoyé ou facture à reste échu. */
export const NATURE_RELANCE = Object.freeze({
  DEVIS: 'DEVIS',
  FACTURE: 'FACTURE',
});

/** Mode d'une relance : courriel, lettre simple, lettre recommandée, tâche d'appel du CRM (devis seulement). */
export const MODE_RELANCE = Object.freeze({
  COURRIEL: 'COURRIEL',
  COURRIER: 'COURRIER',
  RECOMMANDE: 'RECOMMANDE',
  TACHE: 'TACHE',
});

/** État d'une relance du journal. */
export const ETAT_RELANCE = Object.freeze({
  PROPOSEE: 'PROPOSEE',
  ENVOYEE: 'ENVOYEE',
  ATTENTE_NUMERO: 'ATTENTE_NUMERO',
  ANNULEE: 'ANNULEE',
});

/** Erreurs de contrôle d'une règle de relance. */
export const ERREUR_RELANCE = Object.freeze({
  REGLE_SANS_NIVEAU: 'RELANCE_REGLE_SANS_NIVEAU',
  REGLE_TROP_DE_NIVEAUX: 'RELANCE_REGLE_TROP_DE_NIVEAUX',
  NIVEAU_RANG: 'RELANCE_NIVEAU_RANG',
  NIVEAU_DELAI: 'RELANCE_NIVEAU_DELAI',
  NIVEAU_MODE: 'RELANCE_NIVEAU_MODE',
  REGLE_INTERVALLE: 'RELANCE_REGLE_INTERVALLE',
});
