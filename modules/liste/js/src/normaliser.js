// Normalisation de la recherche « contient » : sans casse ni accents (normaliser du socle). Même résultat que la
// fonction SQL f_sans_accent du module : ligatures développées, diacritiques retirés, ponctuation conservée.
import { normaliser } from '@logibtp/socle';

export { normaliser };

/** Mots de la recherche : chaque mot doit être contenu dans au moins une colonne de recherche. */
export const motsRecherche = (q) => normaliser(q).split(/\s+/).filter(Boolean);
