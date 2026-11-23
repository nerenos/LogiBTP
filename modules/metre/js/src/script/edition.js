import { D, S } from '@logibtp/socle';
import { analyserScript } from './analyseur.js';
import { normaliser, MOTS_CLES } from './lexeur.js';

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

const MOTS_RESERVES = new Set([...MOTS_CLES, 'est', 'un', 'une']);
const RE_LITTERAL = /^\s*-?\d+([.,]\d+)?\s*$/;
const OPERATEURS_FORMULE = { '×': '*', '÷': '/', '−': '-' };

/**
 * Formule d'une définition de variable (grille : nombres à virgule ou point, + - * / × ÷ −, parenthèses, {{référence}})
 * réécrite dans le langage de script : point décimal, opérateurs ASCII ; une référence {{<portée>Nom}} à une variable
 * déjà déclarée du script devient `Nom`.
 */
function formuleScript(formule, portee, declarees) {
  let r = '';
  const s = formule ?? '';
  for (let i = 0; i < s.length;) {
    if (s[i] === '{' && s[i + 1] === '{') {
      const fin = s.indexOf('}}', i + 2);
      const brut = fin < 0 ? s.slice(i) : s.slice(i, fin + 2);
      const ref = brut.slice(2, -2).trim();
      r += ref.startsWith(portee) && declarees.has(ref.slice(portee.length)) && !ref.slice(portee.length).startsWith('$') ? ref.slice(portee.length) : brut;
      i += brut.length;
      continue;
    }
    const m = /^\d+,\d+/.exec(s.slice(i));
    if (m) { r += m[0].replace(',', '.'); i += m[0].length; continue; }
    r += OPERATEURS_FORMULE[s[i]] ?? s[i];
    i++;
  }
  return r.trim();
}

/**
 * Script équivalent aux définitions de variables d'une ligne (grille : `$Nom = formule`, `$Nom += formule`), dans leur
 * ordre (var_ordre puis var_id) : utilisé à la création du métré d'une tranche (plan metres-tranches-document, lot 4).
 * Une variable dont la première définition est `=` est déclarée en tête (numérique ; valeur par défaut = le littéral de
 * cette définition, qui devient un paramètre), ses définitions suivantes deviennent des affectations ; ses références
 * {{$Nom}} après sa première définition deviennent `Nom` (avant, elles lisaient la tranche parente : gardées). Une
 * variable dont la première définition est `+=` (incrément d'une variable d'une tranche englobante) ou dont le nom est
 * un mot du langage reste écrite par sa portée (`$Nom += formule`). Les variables déclarées sont publiées en fin de
 * script, comme les définitions évaluées avant les lignes de la tranche : le calcul ne change pas.
 * Options : portee (défaut `$`), commentaire (première ligne `// …`), renvoyer (expression du « Renvoyer » final).
 */
export function scriptDepuisDefinitions(definitions, { portee = '$', commentaire = null, renvoyer = null } = {}) {
  const ordre = [...definitions].sort((a, b) => ((a.var_ordre ?? 0) - (b.var_ordre ?? 0)) || (a.var_id - b.var_id));
  const premieres = new Map();
  for (const v of ordre) if (!premieres.has(v.var_nom)) premieres.set(v.var_nom, v);
  const declarables = new Set([...premieres.values()]
    .filter((v) => (v.var_operation ?? '=') === '=' && !MOTS_RESERVES.has(normaliser(v.var_nom)) && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(v.var_nom))
    .map((v) => v.var_nom));
  const entete = [];
  const corps = [];
  const declarees = new Set();
  for (const v of ordre) {
    const premiere = premieres.get(v.var_nom) === v;
    const formule = formuleScript(v.var_formule, portee, declarees);
    if (premiere && declarables.has(v.var_nom)) {
      if (RE_LITTERAL.test(v.var_formule ?? '')) entete.push(`${v.var_nom} est un numérique = ${litteral(v.var_formule, 'N')}`);
      else {
        entete.push(`${v.var_nom} est un numérique`);
        corps.push(`${v.var_nom} = ${formule}`);
      }
      declarees.add(v.var_nom);
      continue;
    }
    const op = (v.var_operation ?? '=') === '+=' ? '+=' : '=';
    corps.push(declarees.has(v.var_nom) ? `${v.var_nom} ${op} ${formule}` : `${portee}${v.var_nom} ${op} ${formule}`);
  }
  const lignes = [];
  if (commentaire) lignes.push(`// ${commentaire}`);
  lignes.push(...entete);
  if (entete.length && corps.length) lignes.push('');
  lignes.push(...corps);
  if (renvoyer !== null && renvoyer !== undefined) {
    if (entete.length || corps.length) lignes.push('');
    lignes.push(`Renvoyer ${renvoyer}`);
  }
  return lignes.join('\n');
}
