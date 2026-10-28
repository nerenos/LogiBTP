// Codes du module Pointage, répliqués dans LogiBTP.Pointage/Codes.cs (parité vérifiée par CodesTests.cs).

/** États d'une demande de congé. */
export const ETAT_CONGE = Object.freeze({
  DEMANDE: 'DEMANDE',
  VALIDE: 'VALIDE',
  REFUSE: 'REFUSE',
  ANNULE: 'ANNULE',
});

/** Codes d'erreur testés par l'interface. */
export const ERREUR_POINTAGE = Object.freeze({
  POI_VALIDE: 'POI_VALIDE',
  BORNE_JETON: 'BORNE_JETON',
});
