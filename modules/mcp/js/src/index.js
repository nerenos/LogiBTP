// Module MCP LogiBTP : règles de délégation des droits à un agent IA.
export {
  ECHEANCE_DEFAUT, ECHEANCE_MAX, QUOTA_APPEL, QUOTA_JOUR, ALERTE_QUOTA, NOEUDS_INTERDITS, NOEUDS_LECTURE_SEULE, ACTIONS_INTERDITES,
  normaliserAction, actionsModele, gardesFousActifs, estInterdit, droitsEffectifs, autoriseAgent,
  controlerDelegation, echeanceDelegation, appliquerQuota, classerOutil,
} from './delegation.js';
export { CLASSE_OUTIL, ERREUR_MCP, STATUT_APPEL_AGENT } from './codes.js';
