// Résolution des textes d'un dictionnaire (module Personnalisation, ANALYSE-MODULE-PERSONNALISATION.md § 4.2) : fonctions
// pures, sans DOM (navigateur, tests, Jint), répliquées dans Dictionnaire.cs (jeu socle/tests/dictionnaire.json).
//
// - clés à points dans un dictionnaire imbriqué : « pointage.saisie.titre » ;
// - interpolation {{nom}} (espaces permis : {{ nom }}) ; valeur absente → texte vide ;
// - référence à une autre clé : $t(commun.chantier), résolue avant l'interpolation, cycles refusés ;
// - pluriel : suffixes _zero (facultatif, nombre = 0), _un (|nombre| < 2, règle du français), _autre.

const PROFONDEUR_MAX = 10;
const VARIABLE = /\{\{\s*([\p{L}\p{N}_.]+)\s*\}\}/gu;
const REFERENCE = /\$t\(([^()\s]+)\)/g;

/** Valeur brute d'une clé (texte) ou undefined (clé absente, ou branche du dictionnaire). */
export function valeurBrute(dictionnaire, cle) {
  let v = dictionnaire;
  for (const partie of String(cle).split('.')) {
    if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, partie)) return undefined;
    v = v[partie];
  }
  return typeof v === 'string' ? v : undefined;
}

/** Remplace les {{variables}} ; une valeur absente (null, undefined) donne un texte vide. */
export function interpoler(texte, valeurs = {}) {
  return texte.replace(VARIABLE, (_, nom) => {
    const v = valeurs?.[nom];
    return v === null || v === undefined ? '' : String(v);
  });
}

/** Noms des variables {{…}} d'un texte (contrôle des appels). */
export function variablesDe(texte) {
  return [...String(texte).matchAll(VARIABLE)].map((m) => m[1]);
}

/** Développe les références $t(cle) ; une référence inconnue reste telle quelle, un cycle lève une erreur. */
export function developper(dictionnaire, texte, chemin = []) {
  return texte.replace(REFERENCE, (tout, cle) => {
    if (chemin.includes(cle) || chemin.length >= PROFONDEUR_MAX) throw new Error(`Référence circulaire : ${[...chemin, cle].join(' → ')}`);
    const v = valeurBrute(dictionnaire, cle);
    return v === undefined ? tout : developper(dictionnaire, v, [...chemin, cle]);
  });
}

/** Clé effective d'un pluriel : cle_zero (si elle existe et nombre = 0), cle_un, cle_autre ; sinon la clé elle-même. */
export function clePluriel(dictionnaire, cle, nombre) {
  const n = Number(nombre);
  if (n === 0 && valeurBrute(dictionnaire, `${cle}_zero`) !== undefined) return `${cle}_zero`;
  const suffixe = Math.abs(n) < 2 ? '_un' : '_autre';
  return valeurBrute(dictionnaire, `${cle}${suffixe}`) !== undefined ? `${cle}${suffixe}` : cle;
}

/**
 * Texte d'une clé : références développées puis variables remplacées. Clé absente : `defaut` s'il est donné (lui aussi
 * interpolé), sinon la clé elle-même (visible à l'écran, donc corrigée).
 */
export function resoudre(dictionnaire, cle, valeurs, defaut) {
  const v = valeurBrute(dictionnaire, cle);
  if (v === undefined) return defaut === undefined || defaut === null ? String(cle) : interpoler(String(defaut), valeurs);
  return interpoler(developper(dictionnaire, v, [cle]), valeurs);
}

/** Texte au pluriel : la variable {{nombre}} vaut le nombre, sauf si les valeurs la donnent. */
export function resoudrePluriel(dictionnaire, cle, nombre, valeurs = {}) {
  return resoudre(dictionnaire, clePluriel(dictionnaire, cle, nombre), { nombre, ...valeurs });
}

/** Toutes les clés (textes) d'un dictionnaire, dans l'ordre du fichier. */
export function cles(dictionnaire, prefixe = '') {
  const res = [];
  for (const [k, v] of Object.entries(dictionnaire ?? {})) {
    const cle = prefixe ? `${prefixe}.${k}` : k;
    if (typeof v === 'string') res.push(cle);
    else if (v && typeof v === 'object') res.push(...cles(v, cle));
  }
  return res;
}

/** Fusion profonde des couches (programme, installation, société) : la dernière l'emporte, clé par clé. */
export function fusionner(...couches) {
  const res = {};
  for (const c of couches) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    for (const [k, v] of Object.entries(c)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        res[k] = fusionner(res[k] && typeof res[k] === 'object' && !Array.isArray(res[k]) ? res[k] : {}, v);
      } else res[k] = v;
    }
  }
  return res;
}
