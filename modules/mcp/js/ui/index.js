// Module MCP, interface : délégations (création, secret affiché une fois, révocation), paramétrage des levées par profil,
// journal des agents, file des propositions. Composants sans métier ; l'application fournit les appels HTTP, l'origine de
// la société, la liste des profils et la navigation.
export { PanneauDelegations, delegationsHtml, secretHtml, GROUPE_RACCOURCIS_DELEGATIONS } from './delegations.js';
export { ParametresAgents, leveeDuProfil, controlerLevee, corpsLevee, GROUPE_RACCOURCIS_PARAMETRES } from './parametres-agents.js';
export { JournalAgents, journalHtml, GROUPE_RACCOURCIS_JOURNAL } from './journal-agents.js';
export {
  FilePropositions, DetailProposition, propositionsHtml, propositionHtml, contenuHtml, ecartsHtml, VUES_PROPOSITIONS, GROUPE_RACCOURCIS_PROPOSITIONS,
} from './propositions.js';
export * as modeles from './modeles.js';
