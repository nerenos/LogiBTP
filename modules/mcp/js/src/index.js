// Module MCP LogiBTP : règles de délégation des droits à un agent IA et de la file des propositions.
export {
  ECHEANCE_DEFAUT, ECHEANCE_MAX, QUOTA_APPEL, QUOTA_JOUR, ALERTE_QUOTA, NOEUDS_INTERDITS, NOEUDS_LECTURE_SEULE, ACTIONS_INTERDITES,
  normaliserAction, actionsModele, gardesFousActifs, estInterdit, droitsEffectifs, autoriseAgent,
  controlerDelegation, echeanceDelegation, appliquerQuota, classerOutil,
} from './delegation.js';
export {
  ECHEANCE_PROPOSITION, ECHEANCE_PROPOSITION_MAX, echeanceProposition, etatProposition, controlerDecision,
} from './propositions.js';
export { CLASSE_OUTIL, ERREUR_MCP, STATUT_APPEL_AGENT, ETAT_PROPOSITION, DECISION_PROPOSITION } from './codes.js';
