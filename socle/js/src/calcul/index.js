// @logibtp/socle – briques de calcul sans métier : décimal, arrondi, formules, références, libellés.
export { Dec, D, Dz, S, ZERO, UN, coef, arrondir, arr6, formatNombre } from './decimal.js';
export { evaluerExpression, referencesDe, ErreurCalcul } from './expression.js';
export { analyserReference, analyserCibleVariable } from './references.js';
export { ErreurApi, appelApi, erreursParChamp } from '../api.js';
export { lireStockage, ecrireStockage } from '../ui/preferences.js';
export { sansAccent, normaliser, ACCENTUEES, BASES, SPECIAUX } from './accents.js';
export { remplacerVariables, texteBrut, formaterValeur, echapperHtml } from './libelles.js';
export { dateLocale, aujourdhui, numeroJour, depuisNumero, ajouterJours, joursEntre, jourSemaine, joursDuMois, ajouterMois, completerDate, texteDate } from './dates.js';
export { NIVEAU_NOTIFICATION, PROFIL, ACTION_DROIT, NIVEAU_CONFIDENTIALITE, ERREUR_ENREGISTREMENT, TYPE_ECRITURE } from '../codes.js';
