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

/** Types d'un champ supplémentaire en colonne x_ (registre fiche_champ_supplementaire). */
export const TYPE_CHAMP_SUPPLEMENTAIRE = Object.freeze({
  TEXTE: 'texte',
  NOMBRE: 'nombre',
  MONTANT: 'montant',
  DATE: 'date',
  CASE_A_COCHER: 'booleen',
  LISTE: 'liste',
});

/** Erreurs de l'administration des champs supplémentaires (code des erreurs de champ d'une réponse 422 VALIDATION). */
export const ERREUR_CHAMP_SUPPLEMENTAIRE = Object.freeze({
  NOM_INVALIDE: 'CHAMP_NOM_INVALIDE',
  TYPE_INVALIDE: 'CHAMP_TYPE_INVALIDE',
  LIBELLE_OBLIGATOIRE: 'CHAMP_LIBELLE_OBLIGATOIRE',
  TABLE_FERMEE: 'CHAMP_TABLE_FERMEE',
  EXISTE: 'CHAMP_EXISTE',
  INCONNU: 'CHAMP_INCONNU',
  VALEURS: 'CHAMP_VALEURS',
});
