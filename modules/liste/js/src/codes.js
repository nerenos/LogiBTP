// Codes du module Liste, répliqués dans LogiBTP.Listes/Codes.cs (parité vérifiée par CodesTests.cs).

/** Codes d'erreur testés par l'interface. */
export const ERREUR_LISTE = Object.freeze({
  LIGNE_MODIFIEE: 'LIGNE_MODIFIEE',
  REQUETE_HORS_LIGNE: 'REQUETE_HORS_LIGNE',
  PERIODE_INCONNUE: 'PERIODE_INCONNUE',
  PERIODE_NOMBRE: 'PERIODE_NOMBRE',
  PERIODE_COLONNE: 'PERIODE_COLONNE',
});

/** Périodes glissantes des filtres de date (bornes calculées à la date d'exécution : `periodes.js`). */
export const PERIODE = Object.freeze({
  AUJOURD_HUI: 'aujourd_hui',
  HIER: 'hier',
  SEMAINE_EN_COURS: 'semaine_en_cours',
  SEMAINE_PRECEDENTE: 'semaine_precedente',
  MOIS_EN_COURS: 'mois_en_cours',
  MOIS_PRECEDENT: 'mois_precedent',
  TRIMESTRE_EN_COURS: 'trimestre_en_cours',
  ANNEE_EN_COURS: 'annee_en_cours',
  ANNEE_PRECEDENTE: 'annee_precedente',
  EXERCICE_EN_COURS: 'exercice_en_cours',
  DERNIERS_JOURS: 'derniers_jours',
  DERNIERS_MOIS: 'derniers_mois',
  PROCHAINS_JOURS: 'prochains_jours',
});

/** Périodes qui demandent un nombre x. */
export const PERIODE_AVEC_NOMBRE = Object.freeze([PERIODE.DERNIERS_JOURS, PERIODE.DERNIERS_MOIS, PERIODE.PROCHAINS_JOURS]);
