// Module Stock LogiBTP : stock à une date-heure et valorisation, règles partagées avec le serveur (ReglesStock.cs,
// ReglesValorisation.cs).
export { minute, stockA, ecartComptage } from './stock.js';
export { METHODES_VALORISATION, valoriser, valeurUnitaire } from './valorisation.js';
export { MESSAGES_INVENTAIRE, controlerLot } from './inventaire.js';
export { projeter, minimumJusqua, proposer } from './projection.js';
export { SUIVI_ARTICLE, UNITE_DUREE } from './codes.js';
export { MESSAGES_TRACABILITE, numeroLot, repartirLots, dateLimiteLot, stockParLot, proposerLots } from './tracabilite.js';
