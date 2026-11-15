// Module MCP LogiBTP : règles de délégation des droits à un agent IA, de la file des propositions et des recettes.
export {
  ECHEANCE_DEFAUT, ECHEANCE_MAX, QUOTA_APPEL, QUOTA_JOUR, ALERTE_QUOTA, NOEUDS_INTERDITS, NOEUDS_LECTURE_SEULE, ACTIONS_INTERDITES,
  normaliserAction, actionsModele, gardesFousActifs, estInterdit, droitsEffectifs, autoriseAgent,
  controlerDelegation, echeanceDelegation, appliquerQuota, classerOutil,
} from './delegation.js';
export {
  ECHEANCE_PROPOSITION, ECHEANCE_PROPOSITION_MAX, echeanceProposition, etatProposition, controlerDecision,
} from './propositions.js';
export {
  LIBELLE_RECETTE_MAX, PROMPT_RECETTE_MAX, VALEUR_PARAMETRE_MAX, parametresPrompt, controlerRecette, recettePermise, valeurParametre, remplirPrompt,
} from './recettes.js';
export {
  CLASSE_OUTIL, ERREUR_MCP, STATUT_APPEL_AGENT, ETAT_PROPOSITION, DECISION_PROPOSITION, TYPE_PARAMETRE_RECETTE, SORTIE_RECETTE,
} from './codes.js';
