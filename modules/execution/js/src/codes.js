// Codes du module Exécution, répliqués dans LogiBTP.Execution/Codes.cs (parité vérifiée par CodesTests.cs).

/** États d'exécution propres à un ordre (ent_exe_etat), du moins au plus avancé. */
export const ETAT_ORDRE = Object.freeze({
  A_FAIRE: 'A_FAIRE',
  EN_ATTENTE: 'EN_ATTENTE',
  EN_COURS: 'EN_COURS',
  BLOQUE: 'BLOQUE',
  TERMINE: 'TERMINE',
});

/**
 * Statuts documentaires lus par l'état d'un ordre : copie déclarée de STATUT_DOCUMENT du module Document (le module est
 * sans dépendance), vérifiée par client/test/codes.test.js.
 */
export const STATUT_ORDRE = Object.freeze({
  BROUILLON: 'BROUILLON',
  SOLDE: 'SOLDE',
  ANNULE: 'ANNULE',
  REMPLACE: 'REMPLACE',
});
