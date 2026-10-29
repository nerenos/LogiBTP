// @logibtp/socle – briques de calcul sans métier : décimal, arrondi, formules, références, libellés.
export { Dec, D, Dz, S, ZERO, UN, coef, arrondir, arr6, formatNombre } from './decimal.js';
export { evaluerExpression, referencesDe, ErreurCalcul } from './expression.js';
export { analyserReference, analyserCibleVariable } from './references.js';
export { remplacerVariables, texteBrut, formaterValeur, echapperHtml } from './libelles.js';
export { dateLocale, aujourdhui, numeroJour, depuisNumero, ajouterJours, joursEntre, jourSemaine, joursDuMois, ajouterMois } from './dates.js';
export { NIVEAU_NOTIFICATION, PROFIL, ACTION_DROIT, NIVEAU_CONFIDENTIALITE } from '../codes.js';
