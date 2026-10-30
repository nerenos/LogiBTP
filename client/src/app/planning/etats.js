// États facultatifs d'une tâche du planning (pla_tache.tac_etat) : page du planning et application de terrain.

export const ETATS_TACHE = Object.freeze({ OPTION: 'Option', PREVUE: 'Prévue', CONFIRMEE: 'Confirmée', EN_COURS: 'En cours', TERMINEE: 'Terminée' });
/** Couleur de la pastille de chaque état (combo du détail, barres). */
export const COULEURS_ETAT = Object.freeze({ OPTION: '#98a2b3', PREVUE: '#2563eb', CONFIRMEE: '#16a34a', EN_COURS: '#d97706', TERMINEE: '#475467' });
