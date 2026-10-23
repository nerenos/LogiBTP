// Module Exécution LogiBTP : états des ordres et des services d'un élément (parcours), étapes d'un ordre ; règles
// partagées avec le serveur (ReglesEtats.cs, ReglesEtapes.cs).
export { ETATS_SERVICE, ETATS_ORDRE, etatOrdre, etatsServices, controlerParcours, MESSAGES_EXECUTION } from './etats.js';
export {
  NATURES_ETAPE, UNITES_ETAPE, MESSAGES_ETAPES, predecesseurs, etapesAValider, controlerAnnulation, etapeEnCours, etatExecution, datesPrevues,
  controlerEtapes,
} from './etapes.js';
