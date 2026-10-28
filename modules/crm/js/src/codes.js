// Codes du module CRM, répliqués dans LogiBTP.Crm/Codes.cs (parité vérifiée par CodesTests.cs).

/** Natures d'une note. */
export const NATURE_NOTE = Object.freeze({
  ACTION: 'ACTION',
  MESSAGE: 'MESSAGE',
  TACHE: 'TACHE',
});

/** États d'une note. */
export const ETAT_NOTE = Object.freeze({
  A_FAIRE: 'A_FAIRE',
  EN_COURS: 'EN_COURS',
  TERMINE: 'TERMINE',
  MEMO: 'MEMO',
  ANNULEE: 'ANNULEE',
});
