import { D, S } from '@logibtp/socle';
import { analyserScript } from './analyseur.js';

// Édition du texte d'un script depuis la grille des variables (interface seulement, pas de réplique C# :
// le texte reste la seule source, la grille réécrit la valeur par défaut de la déclaration).

/** Littéral du langage pour une valeur saisie : numérique (point décimal), chaîne entre guillemets, Vrai / Faux. */
export function litteral(valeur, type) {
  if (type === 'B') return valeur === true || valeur === 'true' || valeur === 'Vrai' ? 'Vrai' : 'Faux';
  if (type === 'C') return `"${String(valeur ?? '').replaceAll('"', '""')}"`;
  return S(D(String(valeur ?? '0').replace(',', '.')) ?? D(0));
}

/**
 * Remplace (ou ajoute) la valeur par défaut de la déclaration de `nom` par le littéral `texteValeur`.
 * Renvoie le nouveau texte, ou le texte inchangé si la variable n'est pas déclarée.
 */
export function modifierDeclaration(texte, nom, texteValeur) {
  const d = analyserScript(texte).declarations.find((x) => x.nom === nom && !x.implicite);
  if (!d) return texte;
  if (d.defaut) return texte.slice(0, d.defaut.debut) + texteValeur + texte.slice(d.defaut.fin);
  const fin = d.declaration.fin;
  return `${texte.slice(0, fin)} = ${texteValeur}${texte.slice(fin)}`;
}
