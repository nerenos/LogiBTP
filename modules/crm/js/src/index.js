// Module CRM LogiBTP : notes (actions, messages, tâches), règles partagées avec le serveur.
export { NATURES_NOTE, ETATS_NOTE, ETATS_CLOS, LONGUEUR_OBJET, controlerNote, MESSAGES_NOTE } from './notes.js';
export { TYPES_RAPPEL, SEUILS_DEFAUT, controlerRappel, MESSAGES_RAPPEL, etatRappel, comparerRappels } from './rappels.js';
export { ETATS_DEMANDE, MOTIFS_SANS_SUITE, ETATS_DEMANDE_CLOS, controlerDemande, MESSAGES_DEMANDE } from './demandes.js';
export { EFFETS_VISA, STATUTS_PLAN, etatPlan, indiceSuivant } from './validations.js';
export { FORMAT_PLAN_DEFAUT, CHAMPS_FORMAT_PLAN, analyserFormatPlan, extraireNomPlan } from './plans.js';
