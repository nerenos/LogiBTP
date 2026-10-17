// Langage de script des métrés : analyse (éditeur, contrôles) et exécution (moteurs).
export { decouper, normaliser, MOTS_CLES } from './lexeur.js';
export { analyserScript } from './analyseur.js';
export { executerScript, exposer } from './interpreteur.js';
export { FONCTIONS, N, C, B, nombre } from './fonctions.js';
export { modifierDeclaration, litteral } from './edition.js';
