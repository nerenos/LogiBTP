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
  // Point /mcp, outils et gestion (lot 5).
  MCP_JETON_REQUIS: 'MCP_JETON_REQUIS',
  MCP_DELEGATION_INCONNUE: 'MCP_DELEGATION_INCONNUE',
  MCP_OUTIL_INCONNU: 'MCP_OUTIL_INCONNU',
  MCP_OUTIL_INTERDIT: 'MCP_OUTIL_INTERDIT',
  MCP_OUTIL_PARAMETRE: 'MCP_OUTIL_PARAMETRE',
  MCP_USURPATION: 'MCP_USURPATION',
  MCP_PARAMETRE_INVALIDE: 'MCP_PARAMETRE_INVALIDE',
  // Module désactivé pour la société (lot 6) : point /mcp refusé, jetons délégués sans plafond.
  MCP_MODULE_INACTIF: 'MCP_MODULE_INACTIF',
  // Outil composé (lot 7) : appel d'une route que l'outil n'a pas déclarée (liste blanche exacte de l'outil).
  MCP_ROUTE_NON_DECLAREE: 'MCP_ROUTE_NON_DECLAREE',
  // File des propositions (lot 10) : proposition déjà traitée, échue, refus sans motif, action sans exécuteur, contenu corrigé invalide.
  MCP_PROPOSITION_CLOSE: 'MCP_PROPOSITION_CLOSE',
  MCP_PROPOSITION_ECHUE: 'MCP_PROPOSITION_ECHUE',
  MCP_MOTIF_REQUIS: 'MCP_MOTIF_REQUIS',
  MCP_EXECUTEUR_INCONNU: 'MCP_EXECUTEUR_INCONNU',
  MCP_CONTENU_INVALIDE: 'MCP_CONTENU_INVALIDE',
});

/** Statut d'un appel d'outil au journal des agents (agent_journal.ajo_statut). */
export const STATUT_APPEL_AGENT = Object.freeze({
  SUCCES: 'SUCCES',
  REFUS: 'REFUS',
  QUOTA: 'QUOTA',
  ERREUR: 'ERREUR',
});

/** État d'une proposition d'agent (mcp_proposition.mpr_etat) ; ECHUE : en attente au-delà de son échéance. */
export const ETAT_PROPOSITION = Object.freeze({
  EN_ATTENTE: 'EN_ATTENTE',
  ACCEPTEE: 'ACCEPTEE',
  REFUSEE: 'REFUSEE',
  ANNULEE: 'ANNULEE',
  ECHUE: 'ECHUE',
});

/** Décision d'un humain sur une proposition : accepter (exécution sous son identité), corriger le contenu, refuser avec motif. */
export const DECISION_PROPOSITION = Object.freeze({
  ACCEPTER: 'ACCEPTER',
  CORRIGER: 'CORRIGER',
  REFUSER: 'REFUSER',
});
