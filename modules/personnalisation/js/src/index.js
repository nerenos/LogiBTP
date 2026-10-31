// @logibtp/personnalisation – outils Node du module Personnalisation (composition des couches, vérification des clés).
// La résolution des textes au fil de l'application est dans le socle (@logibtp/socle/dictionnaire), utilisé par tous.
export { composer, contenu, empreinte, DICTIONNAIRE, THEME, ICONES } from './composition.js';
export { clesUtilisees, verifierCles } from './verification.js';
