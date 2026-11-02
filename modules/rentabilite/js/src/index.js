// Module Rentabilité LogiBTP : codes, colonnes et lignes du Détail, montants anormaux, faits d'un chiffre (les faits
// sont calculés par le serveur seul : LogiBTP.Rentabilite.Web et la spécialisation de l'application).
export { SENS, COUT, COLONNES_DETAIL, COLONNES_HEURES, COLONNES_PREVISION, libelleColonne, infoColonne, anomalie, filtrerOrdre, valeursColonnes, indicateursDe, lignesDetail, regrouperFaits } from './indicateurs.js';
export * from './codes.js';
export { lirePeriode, controlerPeriode, raccourciPeriode } from './periodes.js';
export { COLONNES_LISTE, arbreListe, lignesListe, clesJusqua, arrondiAffiche } from './liste.js';
export { LIGNES_RESULTATS, blocResultats } from './resultats.js';
export { montantPrevu, controlerFacturation, comparerFacturation, moisDe, moisEntre } from './facturation.js';
