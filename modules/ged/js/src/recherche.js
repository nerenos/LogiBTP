// Normalisation de la recherche dans la GED : ligatures développées (œ → oe, æ → ae, ß → ss, ø → o, đ → d, ł → l),
// accents et autres marques retirés (NFD), minuscules. Même règle que la fonction SQL f_ged_normaliser (colonne
// dge_recherche) et que NormalisationGed.cs (jeu tests/cas/03_normalisation.json).

const SPECIAUX = { 'œ': 'oe', 'Œ': 'oe', 'æ': 'ae', 'Æ': 'ae', 'ß': 'ss', 'ø': 'o', 'Ø': 'o', 'đ': 'd', 'Đ': 'd', 'ł': 'l', 'Ł': 'l' };

export function normaliserRecherche(texte) {
  if (texte === null || texte === undefined) return '';
  return String(texte).replace(/[œŒæÆßøØđĐłŁ]/g, (c) => SPECIAUX[c]).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Texte de recherche d'un document (métadonnées et mail), comme la colonne dge_recherche. */
export const texteRecherche = (d) => normaliserRecherche([d.titre, d.categorie ?? '', d.auteur ?? '', d.resume ?? '', d.notes ?? '',
  d.mail?.objet ?? '', d.mail?.de ?? '', d.mail?.a ?? '', d.mail?.cc ?? '', d.mail?.message ?? ''].join(' '));
