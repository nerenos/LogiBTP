// @logibtp/document – module Document : moteur de document générique (classe mère) et outils associés.
export { MoteurDocument, calculerDocument, VERSION_MOTEUR, normaliserLibelle, TEXTES_DOCUMENT } from './moteur-document.js';
export { numeroter, lireFormat, formaterRang, lireDepart } from './numerotation.js';
export { comparerResultats, CHAMPS_DOCUMENT, CHAMPS_LIGNE } from './comparaison.js';
export { etatSolde } from './soldes.js';
export { unitesOptionnelles } from './options.js';
export { calculerEcheances, dateEcheance, montantRetenue, MODES_REGLEMENT } from './echeances.js';
export { regle, FAMILLES_REGLE } from './regles-type.js';
export * from './types.js';
