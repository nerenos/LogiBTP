// Normalisation de la recherche dans la GED : ligatures développées (œ → oe, æ → ae, ß → ss, ø → o, đ → d, ł → l),
// accents et autres marques retirés (NFD), minuscules. Même règle que la fonction SQL f_ged_normaliser (colonne
// dge_recherche) et que NormalisationGed.cs (jeu tests/cas/03_normalisation.json) : normaliser du socle.
import { normaliser } from '@logibtp/socle';

export const normaliserRecherche = normaliser;

/** Texte de recherche d'un document (métadonnées et mail), comme la colonne dge_recherche. */
export const texteRecherche = (d) => normaliserRecherche([d.titre, d.categorie ?? '', d.auteur ?? '', d.resume ?? '', d.notes ?? '',
  d.mail?.objet ?? '', d.mail?.de ?? '', d.mail?.a ?? '', d.mail?.cc ?? '', d.mail?.message ?? ''].join(' '));
