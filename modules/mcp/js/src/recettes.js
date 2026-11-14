// Règles des recettes (plans/mcp.md, lot 13 ; ANALYSE-MODULE-MCP.md § 10.2), répliquées dans
// dotnet/LogiBTP.Mcp/ReglesRecettes.cs (jeu partagé tests/cas/03_recettes.json).
//
// Une recette est un prompt paramétré enregistré par l'administrateur (jamais par un agent) : marques « {nom} » du prompt
// = paramètres déclarés (typés : marché, chantier, pièce, période, texte), outils permis (sous-ensemble du catalogue),
// sortie attendue. Exposée comme prompt MCP seulement si tous ses outils sont permis à la délégation.
import { ERREUR_MCP, TYPE_PARAMETRE_RECETTE, SORTIE_RECETTE } from './codes.js';

/** Longueurs maximales : libellé, prompt, valeur d'un paramètre remplie dans le prompt. */
export const LIBELLE_RECETTE_MAX = 200;
export const PROMPT_RECETTE_MAX = 4000;
export const VALEUR_PARAMETRE_MAX = 500;

const CODE = /^[a-z][a-z0-9_]{1,59}$/;
const NOM = /^[a-z][a-z0-9_]{0,39}$/;
const MARQUE = /\{([a-z][a-z0-9_]*)\}/g;

const texteDe = (v) => (v === null || v === undefined ? '' : String(v));

/** Noms des marques « {nom} » du prompt, uniques, dans l'ordre d'apparition. */
export function parametresPrompt(prompt) {
  const noms = [];
  for (const m of texteDe(prompt).matchAll(MARQUE)) if (!noms.includes(m[1])) noms.push(m[1]);
  return noms;
}

/**
 * Contrôle d'une recette saisie `{ code, libelle, prompt, parametres: [{ nom, type, libelle, requis }], outils, sortie }` :
 * codes d'erreur dans cet ordre (vide : valide). `outilsConnus` : noms du catalogue (null : non contrôlés).
 * - MCP_RECETTE_CODE : code de 2 à 60 caractères (minuscule, puis minuscules, chiffres, « _ ») ;
 * - MCP_RECETTE_TEXTE : libellé ou prompt vide, ou trop long ;
 * - MCP_RECETTE_PARAMETRE : nom invalide ou en double, type inconnu, libellé de plus de 100 caractères, marque du prompt
 *   non déclarée ou paramètre déclaré absent du prompt ;
 * - MCP_RECETTE_OUTIL : aucun outil, outil en double ou inconnu du catalogue ;
 * - MCP_RECETTE_SORTIE : sortie inconnue.
 */
export function controlerRecette(recette, outilsConnus = null) {
  const r = recette ?? {};
  const erreurs = [];
  if (!CODE.test(texteDe(r.code))) erreurs.push(ERREUR_MCP.MCP_RECETTE_CODE);
  const libelle = texteDe(r.libelle).trim();
  const prompt = texteDe(r.prompt).trim();
  if (!libelle || libelle.length > LIBELLE_RECETTE_MAX || !prompt || prompt.length > PROMPT_RECETTE_MAX) erreurs.push(ERREUR_MCP.MCP_RECETTE_TEXTE);
  const parametres = r.parametres ?? [];
  const noms = parametres.map((p) => texteDe(p?.nom));
  const types = Object.values(TYPE_PARAMETRE_RECETTE);
  const marques = parametresPrompt(prompt);
  if (parametres.some((p) => !NOM.test(texteDe(p?.nom)) || !types.includes(p?.type) || texteDe(p?.libelle).length > 100)
    || new Set(noms).size !== noms.length
    || marques.some((m) => !noms.includes(m)) || noms.some((n) => !marques.includes(n))) erreurs.push(ERREUR_MCP.MCP_RECETTE_PARAMETRE);
  const outils = (r.outils ?? []).map(texteDe);
  if (!outils.length || new Set(outils).size !== outils.length || (outilsConnus && outils.some((o) => !outilsConnus.includes(o)))) {
    erreurs.push(ERREUR_MCP.MCP_RECETTE_OUTIL);
  }
  if (!Object.values(SORTIE_RECETTE).includes(r.sortie)) erreurs.push(ERREUR_MCP.MCP_RECETTE_SORTIE);
  return erreurs;
}

/** Recette proposée à une délégation : active et tous ses outils parmi ceux que la délégation permet. */
export function recettePermise(recette, outilsPermis) {
  if (!recette || recette.active === false) return false;
  const permis = outilsPermis ?? [];
  return (recette.outils ?? []).length > 0 && recette.outils.every((o) => permis.includes(o));
}

/** Valeur d'un paramètre remplie dans le prompt : rognée, sur une ligne hors TEXTE, bornée à VALEUR_PARAMETRE_MAX. */
export function valeurParametre(type, valeur) {
  let v = texteDe(valeur).trim();
  if (type !== TYPE_PARAMETRE_RECETTE.TEXTE) v = v.replace(/\s+/g, ' ');
  return v.length > VALEUR_PARAMETRE_MAX ? v.slice(0, VALEUR_PARAMETRE_MAX) : v;
}

/**
 * Prompt rempli : chaque marque « {nom} » d'un paramètre déclaré remplacée par sa valeur (`valeurs[nom]`, chaîne ou
 * nombre ; absente : vide) ; marques non déclarées laissées telles quelles. Rend `{ texte, manquants }` (paramètres
 * requis sans valeur, dans l'ordre de déclaration).
 */
export function remplirPrompt(recette, valeurs = {}) {
  const parametres = recette?.parametres ?? [];
  const remplies = new Map(parametres.map((p) => [p.nom, valeurParametre(p.type, valeurs?.[p.nom])]));
  const manquants = parametres.filter((p) => p.requis && !remplies.get(p.nom)).map((p) => p.nom);
  const texte = texteDe(recette?.prompt).trim().replace(MARQUE, (m, nom) => (remplies.has(nom) ? remplies.get(nom) : m));
  return { texte, manquants };
}
