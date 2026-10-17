// @logibtp/metre – module Métré : métrés en script, variables de calcul, conversion des anciens métrés (classes mères).
export { Portees } from './portees.js';
export { evaluerVariable, repartirVariables, parOrdre } from './variables.js';
export {
  decouper, normaliser, MOTS_CLES, analyserScript, executerScript, exposer, FONCTIONS, N, C, B, nombre, modifierDeclaration, litteral,
} from './script/index.js';
export { convertirMetre, convertirContenu } from './conversion.js';
export { estScript, evaluerScriptMetre, lignesVariablesScript, messageErreurScript } from './script-metre.js';
