// Codes du module Import, répliqués dans LogiBTP.Import/Codes.cs (parité vérifiée par CodesTests.cs).

/** Logiciel d'origine d'une reprise de base. */
export const SOURCE_REPRISE = Object.freeze({
  MDE: 'MDE',
  OPTIM: 'OPTIM',
});

/** Erreurs de validation d'un fichier de correspondances. */
export const ERREUR_CORRESPONDANCE = Object.freeze({
  FORMAT_INVALIDE: 'REPRISE_FORMAT_INVALIDE',
  SOURCE_INCONNUE: 'REPRISE_SOURCE_INCONNUE',
  SOURCE_DIFFERENTE: 'REPRISE_SOURCE_DIFFERENTE',
  TABLE_MANQUANTE: 'REPRISE_TABLE_MANQUANTE',
  TABLE_INCONNUE: 'REPRISE_TABLE_INCONNUE',
  LISTE_CIBLES_INCONNUE: 'REPRISE_LISTE_CIBLES_INCONNUE',
  SOURCE_VIDE: 'REPRISE_SOURCE_VIDE',
  VALEUR_EN_DOUBLE: 'REPRISE_VALEUR_EN_DOUBLE',
  SANS_CIBLE: 'REPRISE_SANS_CIBLE',
  CIBLE_ET_IGNORER: 'REPRISE_CIBLE_ET_IGNORER',
  MOTIF_MANQUANT: 'REPRISE_MOTIF_MANQUANT',
  CIBLE_INCONNUE: 'REPRISE_CIBLE_INCONNUE',
});

/** État des suites d'une pièce source (contrôle des liens de transformation recréés). */
export const ETAT_SUITE = Object.freeze({
  EN_COURS: 'EN_COURS',
  PARTIELLE: 'PARTIELLE',
  TOTALE: 'TOTALE',
  SOLDEE: 'SOLDEE',
});

/** Part sous-traitée d'une ligne de vente source. */
export const PART_SOUS_TRAITANCE = Object.freeze({
  AUCUNE: 'AUCUNE',
  HORS_FOURNITURE: 'HORS_FOURNITURE',
  TOTALE: 'TOTALE',
});

/** Mode d'avancement d'une situation source. */
export const MODE_AVANCEMENT = Object.freeze({
  DETAILLE: 'DETAILLE',
  GLOBAL_CUMUL: 'GLOBAL_CUMUL',
  GLOBAL_SITUATION: 'GLOBAL_SITUATION',
});
