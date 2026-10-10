import { S, evaluerExpression } from '@logibtp/socle';

/** Ordre d'évaluation des définitions de variables : var_ordre puis var_id. */
export const parOrdre = (a, b) => ((a.var_ordre ?? 0) - (b.var_ordre ?? 0)) || (a.var_id - b.var_id);

/**
 * Évalue une définition de variable (affectation `=` ou incrémentation `+=`) et renseigne var_valeur.
 * contexte = { resolveur(reference) → décimal, portees: Portees, ligneId }
 */
export function evaluerVariable(definition, { resolveur, portees, ligneId }) {
  const valeur = evaluerExpression(definition.var_formule, resolveur);
  definition.var_valeur = S(portees.affecter(definition.var_portee, definition.var_nom, definition.var_operation ?? '=', valeur, ligneId));
  return definition.var_valeur;
}

/**
 * Répartit les définitions : variables du document, variables de ligne et variables de métré (onglet Définition).
 * Les variables du document sont renvoyées dans l'ordre d'évaluation.
 */
export function repartirVariables(variables) {
  const document = [];
  const parLigne = new Map();
  const parMetre = new Map();
  for (const v of [...variables].sort(parOrdre)) {
    if (v.var_mtr_id !== null && v.var_mtr_id !== undefined) {
      if (!parMetre.has(v.var_mtr_id)) parMetre.set(v.var_mtr_id, []);
      parMetre.get(v.var_mtr_id).push(v);
    } else if (v.var_lig_id !== null && v.var_lig_id !== undefined) {
      if (!parLigne.has(v.var_lig_id)) parLigne.set(v.var_lig_id, []);
      parLigne.get(v.var_lig_id).push(v);
    } else document.push(v);
  }
  return { document, parLigne, parMetre };
}
