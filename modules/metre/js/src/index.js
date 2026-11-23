// @logibtp/metre – module Métré : métrés en script, variables de calcul (classes mères).
export { Portees } from './portees.js';
export { evaluerVariable, repartirVariables, parOrdre } from './variables.js';
export {
  decouper, normaliser, MOTS_CLES, analyserScript, executerScript, exposer, FONCTIONS, N, C, B, nombre, modifierDeclaration, litteral, scriptDepuisDefinitions,
} from './script/index.js';
export { estScript, estMetreDocument, porteePublication, evaluerScriptMetre, lignesVariablesScript, messageErreurScript } from './script-metre.js';
