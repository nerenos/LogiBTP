// Normalisation de la recherche « contient » : sans casse ni accents. Même résultat que la fonction
// SQL f_sans_accent (lower(unaccent(...))) du module : ligatures développées, diacritiques retirés.

const SPECIAUX = { 'œ': 'oe', 'Œ': 'oe', 'æ': 'ae', 'Æ': 'ae', 'ß': 'ss', 'ø': 'o', 'Ø': 'o', 'đ': 'd', 'Đ': 'd', 'ł': 'l', 'Ł': 'l' };

export function normaliser(texte) {
  if (texte === null || texte === undefined) return '';
  return String(texte)
    .replace(/[œŒæÆßøØđĐłŁ]/g, (c) => SPECIAUX[c])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Mots de la recherche : chaque mot doit être contenu dans au moins une colonne de recherche. */
export const motsRecherche = (q) => normaliser(q).split(/\s+/).filter(Boolean);
