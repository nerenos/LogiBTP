// Codes du module MCP, répliqués dans Codes.cs (parité vérifiée par CodesTests).
// Les codes communs aux modules (GARDE_FOU, MODELE_PLAFOND, ORIGINE_ECRITURE, ERREUR_AGENT) sont dans le socle.

/** Classement d'un outil d'agent : lecture, écriture directe d'un brouillon, proposition à un humain, interdit. */
export const CLASSE_OUTIL = Object.freeze({
  LECTURE: 'LECTURE',
  BROUILLON: 'BROUILLON',
  PROPOSITION: 'PROPOSITION',
  INTERDIT: 'INTERDIT',
});

/** Erreurs du contrôle d'une délégation et des quotas. */
export const ERREUR_MCP = Object.freeze({
  MCP_MODELE_INCONNU: 'MCP_MODELE_INCONNU',
  MCP_MODELE_NON_PERMIS: 'MCP_MODELE_NON_PERMIS',
  MCP_ADMIN_COMME_MOI: 'MCP_ADMIN_COMME_MOI',
  MCP_ECHEANCE: 'MCP_ECHEANCE',
  MCP_GARDE_FOU_NON_LEVABLE: 'MCP_GARDE_FOU_NON_LEVABLE',
  MCP_QUOTA_JOUR: 'MCP_QUOTA_JOUR',
});
