// @logibtp/socle/dictionnaire – textes, icônes et images de l'application (module Personnalisation,
// ANALYSE-MODULE-PERSONNALISATION.md). Point d'entrée séparé de ./ui : il s'importe (et se charge) avant tout le reste.
//
// Le dictionnaire (fr.json fusionné de toutes les couches) est chargé une fois au démarrage par chargerDictionnaire(),
// AVANT l'import de l'application (client/src/main.js) : les constantes de module qui appellent texte() s'évaluent donc
// avec les vrais textes. Hors navigateur (tests, Jint), initialiserDictionnaire() pose un dictionnaire synchrone.

import { resoudre, resoudrePluriel, valeurBrute, developper, variablesDe, interpoler } from './resolution.js';
import { segmenterEmojis, contientEmoji, baliseEmoji, emojisEnHtml, emojisDansHtml, estEmoji } from './emojis.js';

export { resoudre, resoudrePluriel, valeurBrute, interpoler, variablesDe, developper, clePluriel, cles, fusionner } from './resolution.js';
export { MOTIF_SHORTCODE, segmenterEmojis } from './emojis.js';

// Échappement HTML (même règle qu'echapperHtml du calcul, sans charger decimal.js au démarrage).
const echapperHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Adresse des fichiers de personnalisation servis (fr.json, theme.css, images/). */
export const ADRESSE_PERSONNALISATION = '/personnalisation/';

const etat = { libelles: {}, icones: {}, emojis: {}, version: '', langue: 'fr-FR', origine: 'aucune', manquantes: new Set(), surManquante: null };

/**
 * Pose le dictionnaire de façon synchrone : { libelles, icones, emojis, version }. `surManquante(cle)` est appelé une fois par
 * clé absente (développement : avertissement dans la console).
 */
export function initialiserDictionnaire({ libelles = {}, icones = {}, emojis = {}, version = '', origine = 'initialise', surManquante = etat.surManquante } = {}) {
  etat.libelles = libelles ?? {};
  etat.icones = icones ?? {};
  etat.emojis = emojis ?? {};
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
 * Charge fr.json, images/icones.json et images/emojis.json servis (préchargés par client/index.html). Échec (serveur injoignable sans cache,
 * fichier invalide) : `secours()` fournit le dictionnaire du programme intégré au client ({ libelles, icones, emojis }).
 * Rend l'origine retenue : 'serveur' ou 'secours'.
 */
export async function chargerDictionnaire({ adresse = ADRESSE_PERSONNALISATION, secours, surManquante } = {}) {
  try {
    const [libelles, icones, emojis] = await Promise.all([
      lireJson(`${adresse}fr.json`),
      lireJson(`${adresse}images/icones.json`).catch(() => ({})),
      lireJson(`${adresse}images/emojis.json`).catch(() => ({})),
    ]);
    initialiserDictionnaire({ libelles, icones, emojis, version: valeurBrute(libelles, '_meta.version') ?? '', origine: 'serveur', surManquante });
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
  return Object.freeze(codes.map((x) => {
    // Code qui ne peut pas servir de clé (symbole : '=', '<>'…) : [code, clé].
    const [c, cle] = Array.isArray(x) ? x : [x, x];
    const p = [c];
    Object.defineProperty(p, 1, { get: () => texte(`${prefixe}.${cle}`), enumerable: true });
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

// ---------------------------------------------------------------------------------------------------------------------
// Emojis par shortcode (§ 42) : « :nom: » → image fixe du catalogue images/emojis.json (fichiers sous images/emojis/).

const adresseEmoji = (fichier) => image(fichier);

/** Emoji du catalogue prêt pour innerHTML (<img class="emoji">) ; nom inconnu : `defaut` échappé. */
export function emoji(nom, defaut = '') {
  return estEmoji(etat.emojis, nom) ? baliseEmoji(nom, adresseEmoji(etat.emojis[nom])) : echapperHtml(defaut);
}

/** Noms des emojis du catalogue chargé (aide-mémoire, sélecteur à venir). */
export const nomsEmojis = () => Object.keys(etat.emojis).sort();

/** Texte brut (saisie, donnée) → HTML : texte échappé, shortcodes connus remplacés par leur image. */
export const emojisHtml = (texte) => emojisEnHtml(texte, etat.emojis, adresseEmoji);

/** HTML sûr → HTML : shortcodes remplacés dans le texte seulement (jamais dans une balise ou un attribut). */
export const avecEmojis = (html) => emojisDansHtml(html, etat.emojis, adresseEmoji);

/** texteHtml(cle, valeurs, defaut) avec les shortcodes du libellé (et de ses valeurs) remplacés par leur image. */
export const texteEmojis = (cle, valeurs, defaut) => avecEmojis(texteHtml(cle, valeurs, defaut));

// Parties du DOM jamais modifiées : saisie, code, SVG, ou zone marquée « sans-emojis » (data-sans-emojis).
const EXCLUS = 'script, style, textarea, input, select, option, code, pre, svg, [contenteditable]:not([contenteditable="false"]), .sans-emojis, [data-sans-emojis]';

function remplacerNoeud(noeud) {
  const parent = noeud.parentElement;
  if (!parent || parent.closest(EXCLUS) || !contientEmoji(noeud.nodeValue, etat.emojis)) return;
  const doc = noeud.ownerDocument;
  const fragment = doc.createDocumentFragment();
  for (const s of segmenterEmojis(noeud.nodeValue, etat.emojis)) {
    if ('texte' in s) { fragment.appendChild(doc.createTextNode(s.texte)); continue; }
    const img = doc.createElement('img');
    img.className = 'emoji';
    img.src = adresseEmoji(etat.emojis[s.emoji]);
    img.alt = s.code;
    img.title = s.code;
    img.draggable = false;
    fragment.appendChild(img);
  }
  noeud.replaceWith(fragment);
}

/**
 * Remplace les shortcodes des nœuds de texte de `racine` (élément, ou nœud de texte) par leurs images. Les champs de
 * saisie, le code, les SVG et les zones « sans-emojis » sont laissés tels quels. Rend le nombre de nœuds examinés.
 */
export function appliquerEmojis(racine) {
  if (!racine || Object.keys(etat.emojis).length === 0) return 0;
  if (racine.nodeType === 3) { remplacerNoeud(racine); return 1; }
  if (racine.nodeType !== 1 && racine.nodeType !== 9 && racine.nodeType !== 11) return 0;
  const doc = racine.ownerDocument ?? racine;
  const parcours = doc.createTreeWalker(racine, 4 /* NodeFilter.SHOW_TEXT */);
  const noeuds = [];
  for (let n = parcours.nextNode(); n; n = parcours.nextNode()) if (n.nodeValue.includes(':')) noeuds.push(n);
  noeuds.forEach(remplacerNoeud);
  return noeuds.length;
}

/**
 * Remplacement automatique : applique les emojis à `racine` puis à tout ce qui y est ajouté ou modifié ensuite
 * (MutationObserver). Appelé une fois au démarrage du client sur document.body ; rend la fonction d'arrêt.
 */
export function observerEmojis(racine = typeof document === 'undefined' ? null : document.body) {
  if (!racine || typeof MutationObserver === 'undefined') return () => {};
  appliquerEmojis(racine);
  const observateur = new MutationObserver((mutations) => {
    if (Object.keys(etat.emojis).length === 0) return;
    for (const m of mutations) {
      if (m.type === 'characterData') appliquerEmojis(m.target);
      else for (const n of m.addedNodes) if (n.isConnected) appliquerEmojis(n);
    }
  });
  observateur.observe(racine, { childList: true, subtree: true, characterData: true });
  return () => observateur.disconnect();
}
