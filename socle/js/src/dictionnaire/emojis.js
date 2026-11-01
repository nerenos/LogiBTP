// Emojis par shortcode (module Personnalisation, § 42 de ANALYSE-MODULE-PERSONNALISATION.md) : un code texte « :nom: »
// placé dans un texte (libellé du dictionnaire, note, donnée saisie) est remplacé à l'affichage par l'image fixe du
// catalogue images/emojis.json, identique sur tous les appareils (les emojis Unicode changent d'une plateforme à l'autre).
//
// Fonctions pures (sans DOM ni état) : le catalogue et la fabrique d'adresse sont passés par l'appelant (index.js).

/** Shortcode : deux-points, un nom qui commence par une lettre (minuscules, chiffres, « _ », « - »), deux-points. */
export const MOTIF_SHORTCODE = /:([a-z][a-z0-9_-]*):/g;

const echapperHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Un nom d'emoji du catalogue ? (propriété propre : « constructor » ou « toString » ne sont pas des emojis). */
export const estEmoji = (catalogue, nom) => Object.prototype.hasOwnProperty.call(catalogue ?? {}, nom) && typeof catalogue[nom] === 'string';

/**
 * Découpe un texte en segments [{ texte } | { emoji: nom, code: ':nom:' }] ; seuls les noms du catalogue sont des
 * emojis (un shortcode inconnu, une heure « 10:30:00 » restent du texte). Segments de texte voisins fusionnés.
 */
export function segmenterEmojis(texte, catalogue) {
  const s = String(texte ?? '');
  const segments = [];
  const ajouterTexte = (t) => {
    if (!t) return;
    const dernier = segments[segments.length - 1];
    if (dernier && 'texte' in dernier) dernier.texte += t;
    else segments.push({ texte: t });
  };
  let debut = 0;
  for (const m of s.matchAll(MOTIF_SHORTCODE)) {
    if (!estEmoji(catalogue, m[1])) continue;
    ajouterTexte(s.slice(debut, m.index));
    segments.push({ emoji: m[1], code: m[0] });
    debut = m.index + m[0].length;
  }
  ajouterTexte(s.slice(debut));
  return segments;
}

/** Le texte contient-il au moins un shortcode du catalogue ? (test rapide avant tout remplacement). */
export function contientEmoji(texte, catalogue) {
  const s = String(texte ?? '');
  if (!s.includes(':')) return false;
  for (const m of s.matchAll(MOTIF_SHORTCODE)) if (estEmoji(catalogue, m[1])) return true;
  return false;
}

/**
 * Balise <img> d'un emoji : classe « emoji » (taille et alignement de socle.css), texte de remplacement = le shortcode
 * (lecteurs d'écran, copier-coller : le code est retrouvé), info-bulle = le nom.
 */
export function baliseEmoji(nom, adresse) {
  const code = `:${nom}:`;
  return `<img class="emoji" src="${echapperHtml(adresse)}" alt="${echapperHtml(code)}" title="${echapperHtml(code)}" draggable="false">`;
}

/** Texte brut → HTML : texte échappé, shortcodes du catalogue en images. `adresse(fichier)` : adresse de l'image. */
export function emojisEnHtml(texte, catalogue, adresse) {
  return segmenterEmojis(texte, catalogue)
    .map((s) => ('emoji' in s ? baliseEmoji(s.emoji, adresse(catalogue[s.emoji])) : echapperHtml(s.texte)))
    .join('');
}

/**
 * HTML → HTML : shortcodes remplacés dans le texte seulement, jamais dans une balise ni un attribut
 * (`<a title=":casque:">` reste intact). Le HTML reçu est supposé sûr (déjà échappé ou nettoyé).
 */
export function emojisDansHtml(html, catalogue, adresse) {
  const s = String(html ?? '');
  if (!contientEmoji(s, catalogue)) return s;
  return s.split(/(<[^>]*>)/).map((partie) => (partie.startsWith('<')
    ? partie
    : segmenterEmojis(partie, catalogue).map((x) => ('emoji' in x ? baliseEmoji(x.emoji, adresse(catalogue[x.emoji])) : x.texte)).join(''))).join('');
}
