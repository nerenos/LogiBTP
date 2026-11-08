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

/** État d'un lot de relances : préparé (rien d'envoyé), envoyé (clos), partiel (une partie envoyée). */
export const ETAT_LOT_RELANCE = Object.freeze({
  PREPARE: 'PREPARE',
  ENVOYE: 'ENVOYE',
  PARTIEL: 'PARTIEL',
});

/** Motif d'une suspension de relance (pièce ou tiers). */
export const MOTIF_SUSPENSION = Object.freeze({
  LITIGE: 'LITIGE',
  PROMESSE: 'PROMESSE',
  ECHELONNEMENT: 'ECHELONNEMENT',
  AUTRE: 'AUTRE',
});

/** Erreurs de contrôle d'une règle de relance et du service (journal, lots, suspensions). */
export const ERREUR_RELANCE = Object.freeze({
  REGLE_SANS_NIVEAU: 'RELANCE_REGLE_SANS_NIVEAU',
  REGLE_TROP_DE_NIVEAUX: 'RELANCE_REGLE_TROP_DE_NIVEAUX',
  NIVEAU_RANG: 'RELANCE_NIVEAU_RANG',
  NIVEAU_DELAI: 'RELANCE_NIVEAU_DELAI',
  NIVEAU_MODE: 'RELANCE_NIVEAU_MODE',
  REGLE_INTERVALLE: 'RELANCE_REGLE_INTERVALLE',
  NATURE: 'RELANCE_NATURE',
  SUSPENSION_CIBLE: 'RELANCE_SUSPENSION_CIBLE',
  SUSPENSION_MOTIF: 'RELANCE_SUSPENSION_MOTIF',
  SUSPENSION_DATE: 'RELANCE_SUSPENSION_DATE',
  LOT_CLOS: 'RELANCE_LOT_CLOS',
  GROUPE_INCONNU: 'RELANCE_GROUPE_INCONNU',
  MODE: 'RELANCE_MODE',
  HORS_PORTEE: 'RELANCE_HORS_PORTEE',
  PAS_EN_ATTENTE_NUMERO: 'RELANCE_PAS_EN_ATTENTE_NUMERO',
  NUMERO_VIDE: 'RELANCE_NUMERO_VIDE',
  RIEN_A_NOTER: 'RELANCE_RIEN_A_NOTER',
});
