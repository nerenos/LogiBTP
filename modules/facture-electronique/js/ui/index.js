// Module Facturation électronique, interface : paramètres de la plateforme, tableau des flux, détail d'un flux,
// chronologie du journal (réutilisable par le cœur), dépôt et import manuels, statut posé (motif et commentaire). Composants sans métier : l'application
// fournit le transport (creerApiFe), les droits, les libellés des éléments et la navigation.
export { creerApiFe, RACINE_API_FE } from './api.js';
export { ParametresFe, GROUPE_RACCOURCIS_PARAMETRES, libelleConnecteur } from './parametres-fe.js';
export { TableauFlux, GROUPE_RACCOURCIS_TABLEAU, PREFERENCE_FILTRES, libelleType } from './tableau-flux.js';
export { DetailFlux, GROUPE_RACCOURCIS_DETAIL } from './detail-flux.js';
export { Chronologie, chronologieHtml, libelleEtat, libelleCode, GROUPE_RACCOURCIS_CHRONOLOGIE, PREFERENCE_DETAILS } from './chronologie.js';
export { PanneauDepotManuel, confirmerDepotManuel, importerFichier, telechargerDocumentFlux, GROUPE_RACCOURCIS_DEPOT } from './depot-manuel.js';
export { demanderStatut, libelleStatut } from './statuts.js';
export * as modeles from './modeles.js';
