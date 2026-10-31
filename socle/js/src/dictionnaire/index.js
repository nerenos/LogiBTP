// @logibtp/socle/dictionnaire – textes, icônes et images de l'application (module Personnalisation,
// ANALYSE-MODULE-PERSONNALISATION.md). Point d'entrée séparé de ./ui : il s'importe (et se charge) avant tout le reste.
//
// Le dictionnaire (fr.json fusionné de toutes les couches) est chargé une fois au démarrage par chargerDictionnaire(),
// AVANT l'import de l'application (client/src/main.js) : les constantes de module qui appellent texte() s'évaluent donc
// avec les vrais textes. Hors navigateur (tests, Jint), initialiserDictionnaire() pose un dictionnaire synchrone.

import { resoudre, resoudrePluriel, valeurBrute, developper, variablesDe, interpoler } from './resolution.js';

export { resoudre, resoudrePluriel, valeurBrute, interpoler, variablesDe, developper, clePluriel, cles, fusionner } from './resolution.js';

// Échappement HTML (même règle qu'echapperHtml du calcul, sans charger decimal.js au démarrage).
const echapperHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Adresse des fichiers de personnalisation servis (fr.json, theme.css, images/). */
export const ADRESSE_PERSONNALISATION = '/personnalisation/';

const etat = { libelles: {}, icones: {}, version: '', langue: 'fr-FR', origine: 'aucune', manquantes: new Set(), surManquante: null };

/**
 * Pose le dictionnaire de façon synchrone : { libelles, icones, version }. `surManquante(cle)` est appelé une fois par
 * clé absente (développement : avertissement dans la console).
 */
export function initialiserDictionnaire({ libelles = {}, icones = {}, version = '', origine = 'initialise', surManquante = etat.surManquante } = {}) {
  etat.libelles = libelles ?? {};
  etat.icones = icones ?? {};
  etat.version = version ?? '';
  etat.langue = valeurBrute(etat.libelles, '_meta.langue') ?? 'fr-FR';
  etat.origine = origine;
  etat.surManquante = surManquante;
  etat.manquantes.clear();
}

async function lireJson(adresse) {
  const r = await fetch(adresse, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${adresse} : ${r.status}`);
  return r.json();
}

/**
 * Charge fr.json et images/icones.json servis (préchargés par client/index.html). Échec (serveur injoignable sans cache,
 * fichier invalide) : `secours()` fournit le dictionnaire du programme intégré au client ({ libelles, icones }).
 * Rend l'origine retenue : 'serveur' ou 'secours'.
 */
export async function chargerDictionnaire({ adresse = ADRESSE_PERSONNALISATION, secours, surManquante } = {}) {
  try {
    const [libelles, icones] = await Promise.all([lireJson(`${adresse}fr.json`), lireJson(`${adresse}images/icones.json`).catch(() => ({}))]);
    initialiserDictionnaire({ libelles, icones, version: valeurBrute(libelles, '_meta.version') ?? '', origine: 'serveur', surManquante });
  } catch (e) {
    if (!secours) throw e;
    const s = await secours();
    initialiserDictionnaire({ ...s, origine: 'secours', surManquante });
  }
  return etat.origine;
}

function manquante(cle) {
  if (etat.manquantes.has(cle)) return;
  etat.manquantes.add(cle);
  etat.surManquante?.(cle);
}

/**
 * Texte d'une clé, variables {{nom}} remplacées par `valeurs`. Clé absente : `defaut` s'il est donné (message du
 * serveur, par exemple), sinon la clé elle-même.
 */
export function texte(cle, valeurs, defaut) {
  if (valeurBrute(etat.libelles, cle) === undefined) manquante(cle);
  return resoudre(etat.libelles, cle, valeurs, defaut);
}

/** Texte au pluriel (clés cle_un / cle_autre, cle_zero facultative) ; {{nombre}} vaut le nombre. */
export function pluriel(cle, nombre, valeurs) {
  const t = resoudrePluriel(etat.libelles, cle, nombre, valeurs);
  if (t === cle) manquante(cle);
  return t;
}

/**
 * Texte prêt pour innerHTML : le libellé est du texte (jamais du HTML), il est échappé avec ses valeurs. Seules les
 * clés terminées par « _html » gardent leurs balises (aides mises en forme), leurs valeurs étant échappées.
 */
export function texteHtml(cle, valeurs, defaut) {
  const derniere = String(cle).split('.').pop();
  if (derniere.endsWith('_html')) {
    const echappees = Object.fromEntries(Object.entries(valeurs ?? {}).map(([k, v]) => [k, echapperHtml(v ?? '')]));
    return texte(cle, echappees, defaut);
  }
  return echapperHtml(texte(cle, valeurs, defaut));
}

/**
 * Table de libellés par code lue dans le dictionnaire : { CODE: texte(`${prefixe}.CODE`) } (accès paresseux, figée).
 * Les codes restent dans le code (règles répliquées), les libellés dans fr.json : `MESSAGES_X[code]` reste utilisable.
 */
export function textesParCode(prefixe, codes) {
  const o = {};
  for (const c of codes) Object.defineProperty(o, c, { get: () => texte(`${prefixe}.${c}`), enumerable: true });
  return Object.freeze(o);
}

/**
 * Paires [code, libellé] figées (listes de choix des modules) : le libellé est relu à chaque accès dans
 * `prefixe.CODE` ; la déstructuration `[code, libelle]` et `map` gardent leur forme.
 */
export function pairesParCode(prefixe, codes) {
  return Object.freeze(codes.map((c) => {
    const p = [c];
    Object.defineProperty(p, 1, { get: () => texte(`${prefixe}.${c}`), enumerable: true });
    return Object.freeze(p);
  }));
}

/**
 * Valeur d'une variable du thème (`--nom`, feuille theme.css des couches) pour un champ qui exige une valeur explicite
 * (couleur #rrggbb d'un champ couleur, couleur par défaut enregistrée) ; `defaut` hors navigateur ou si elle est vide.
 */
export function couleurTheme(variable, defaut = '#000000') {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return defaut;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || defaut;
}

/** La clé existe-t-elle ? */
export const existe = (cle) => valeurBrute(etat.libelles, cle) !== undefined;

/**
 * Message d'une erreur par son code (lot P2) : « erreurs.<CODE> » du dictionnaire s'il existe, interpolé par les valeurs
 * (les détails objet de l'erreur), sinon le message fourni (title du serveur, message du moteur) : aucune perte.
 */
export function messageErreur(code, message, valeurs) {
  const brut = code ? valeurBrute(etat.libelles, `erreurs.${code}`) : undefined;
  if (typeof brut !== 'string') return message;
  const v = valeurs && typeof valeurs === 'object' && !Array.isArray(valeurs) ? valeurs : {};
  // Une variable que l'erreur ne fournit pas : le message reçu, plus juste qu'un texte à trou.
  const texte = developper(etat.libelles, brut);
  if (variablesDe(texte).some((n) => v[n] === undefined || v[n] === null)) return message;
  return interpoler(texte, v);
}

/** Langue des formats (dates, nombres) : _meta.langue du dictionnaire, « fr-FR » par défaut. */
export const langue = () => etat.langue;

/** Version du dictionnaire chargé (_meta.version, empreinte posée par la construction) et son origine. */
export const versionDictionnaire = () => ({ version: etat.version, origine: etat.origine });

/** Clés demandées absentes du dictionnaire depuis le chargement (débogage). */
export const clesManquantes = () => [...etat.manquantes];

const estFichier = (v) => /\.(svg|png|jpe?g|webp|gif)$/i.test(v);

/** Adresse d'un fichier du répertoire images/ (suffixe de version : relu quand la personnalisation change). */
export function image(fichier) {
  return `${ADRESSE_PERSONNALISATION}images/${encodeURI(fichier)}${etat.version ? `?v=${encodeURIComponent(etat.version)}` : ''}`;
}

/**
 * Icône du catalogue images/icones.json, en texte (emoji). Une icône désignée par un fichier n'a pas de texte : rend ''
 * (utiliser iconeHtml). Nom inconnu : `defaut`, sinon ''.
 */
export function icone(nom, defaut = '') {
  const v = etat.icones[nom];
  if (v === undefined) return defaut;
  return estFichier(v) ? '' : v;
}

/** Icône prête pour innerHTML : emoji échappé, ou image du répertoire images/. */
export function iconeHtml(nom, defaut = '') {
  const v = etat.icones[nom];
  if (v === undefined) return echapperHtml(defaut);
  return estFichier(v) ? `<img class="icone-image" src="${echapperHtml(image(v))}" alt="">` : echapperHtml(v);
}
