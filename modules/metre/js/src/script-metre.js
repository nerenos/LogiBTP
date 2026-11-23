import { texte } from '@logibtp/socle/dictionnaire';
import { D, analyserCibleVariable } from '@logibtp/socle';
import { executerScript } from './script/interpreteur.js';

// Métré en script (réplique de ScriptMetre.cs) : exécution du script d'un métré pour une ligne de l'hôte,
// publication des variables, lignes de variables (variable_definition) produites à chaque calcul.

/** Le métré a-t-il un script (les anciens métrés en lignes n'en ont pas avant leur conversion) ? */
export const estScript = (metre) => typeof metre?.mtr_script === 'string';

/** Métré du document : sans ligne (mtr_ligne_id null), rattaché au document par mtr_ent_id. */
export const estMetreDocument = (metre) => metre?.mtr_lig_id === null || metre?.mtr_lig_id === undefined;

/**
 * Portée où sont publiées les variables non locales d'un script : `$$` pour le métré du document (sans ligne),
 * `@` de la ligne par défaut ; l'hôte peut en imposer une autre (`$` pour le métré d'une tranche).
 */
export const porteePublication = (metre, publication) => publication ?? (estMetreDocument(metre) ? '$$' : '@');

/**
 * Exécute le script du métré. Renseigne mtr_resultat (null sans « Renvoyer » ou en erreur) ; sans erreur, publie
 * les variables non locales (numériques, chaînes, booléens) en portée @ de la ligne (ou `contexte.publication`,
 * `$$` pour le métré du document) et affecte le résultat à mtr_variable.
 * Métré du document (ligneId null) : `@`, `@@` et `$` refusés (PORTEE), « Renvoyer » averti (METRE_DOCUMENT_RESULTAT)
 * et son résultat ignoré, pas d'avertissement METRE_SANS_RESULTAT.
 * contexte : celui de executerScript ({ resoudre, ecrire, portees, ligneId, fonctions }) + publication facultative.
 * Renvoie le résultat de executerScript.
 */
export function evaluerScriptMetre(metre, contexte) {
  const r = executerScript(metre.mtr_script ?? '', contexte);
  const { portees, ligneId } = contexte;
  if (ligneId === null || ligneId === undefined) {
    r.avertissements = r.avertissements.filter((a) => a.code !== 'METRE_SANS_RESULTAT');
    if (r.resultat !== null) {
      r.avertissements.push({ code: 'METRE_DOCUMENT_RESULTAT', message: texte('metre.script.document_resultat') });
      r.resultat = null;
    }
  }
  metre.mtr_resultat = r.resultat;
  if (r.erreurs.length > 0) return r;
  const publication = porteePublication(metre, contexte.publication);
  for (const v of r.variables) {
    if (!v.local && v.valeur !== null && v.valeur !== undefined) portees.affecter(publication, v.nom, '=', v.type === 'N' ? D(v.valeur) : v.valeur, ligneId);
  }
  if (metre.mtr_variable && r.resultat !== null) {
    const c = analyserCibleVariable(metre.mtr_variable);
    portees.affecter(c.portee, c.nom, '=', D(r.resultat), ligneId);
  }
  return r;
}

/**
 * Lignes de variables d'un métré en script : une par variable non locale (portée de publication), dans l'ordre des déclarations.
 * Une ligne existante (même métré, même nom) garde son identifiant ; `nouvelId()` fournit les autres.
 */
export function lignesVariablesScript(metre, resultat, existantes, { entId, nouvelId, publication }) {
  const portee = porteePublication(metre, publication);
  const parNom = new Map(existantes.filter((v) => v.var_mtr_id === metre.mtr_id).map((v) => [v.var_nom, v]));
  return resultat.variables.filter((v) => !v.local).map((v, k) => ({
    var_id: parNom.get(v.nom)?.var_id ?? nouvelId(),
    var_ent_id: entId,
    var_lig_id: metre.mtr_lig_id ?? null,
    var_mtr_id: metre.mtr_id,
    var_portee: portee,
    var_nom: v.nom,
    var_operation: '=',
    var_formule: v.defaut ?? '',
    var_ordre: k + 1,
    var_type: v.type,
    var_valeur: v.type === 'N' ? v.valeur : null,
    var_valeur_texte: v.type === 'C' ? v.valeur : v.type === 'B' && v.valeur !== null ? (v.valeur ? 'Vrai' : 'Faux') : null,
  }));
}

/** Message d'une erreur de script pour l'hôte (position dans le script). */
export const messageErreurScript = (e) => texte('metre.script.message_hote', { ligne: e.ligne, colonne: e.colonne, message: e.message });
