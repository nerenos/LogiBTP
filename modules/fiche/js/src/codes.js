// Codes du module Fiche, répliqués dans LogiBTP.Fiches/Codes.cs (parité vérifiée par CodesTests.cs).

/** Codes d'erreur testés par l'interface. */
export const ERREUR_FICHE = Object.freeze({
  VERROU_PERDU: 'VERROU_PERDU',
  FICHE_EN_MODIFICATION: 'FICHE_EN_MODIFICATION',
  FICHE_UTILISEE: 'FICHE_UTILISEE',
  CODE_PRIS: 'CODE_PRIS',
});

/** Largeur d'un groupe de champs dans l'onglet (`largeur` du groupe) ; absente = une colonne de la grille des groupes. */
export const LARGEUR_GROUPE = Object.freeze({
  PLEIN: 'plein',
});

/** Disposition des champs dans un groupe (`disposition` du groupe) ; absente = grille. */
export const DISPOSITION_GROUPE = Object.freeze({
  GRILLE: 'grille',
  FLEX: 'flex',
});
