// Conservation des versions : même règle que RegleVersions côté C# (jeu partagé modules/ged/tests/cas/02_versions.json).
//   etape    (validation, envoi, signature…) : toutes conservées
//   edition  (dépôts, modifications)         : les N dernières conservées, les plus anciennes purgées
// La version courante (dernier numéro) n'est jamais purgée ; un document du coffre-fort ne perd aucune version.

export const GENRES = Object.freeze({ EDITION: 'edition', ETAPE: 'etape' });

export const ETAPES = [
  ['VALIDATION', 'Validation'], ['ENVOI', 'Envoi'], ['RECEPTION', 'Réception'], ['SIGNATURE', 'Signature'],
  ['REFUS', 'Refus'], ['ARCHIVAGE', 'Archivage'],
];

/** Numéros des éditions à purger. */
export function editionsAPurger(versions, conservees, { coffre = false } = {}) {
  if (coffre) return [];
  const courante = Math.max(...versions.map((v) => v.numero));
  const editions = versions.filter((v) => v.genre === GENRES.EDITION).sort((a, b) => b.numero - a.numero);
  return editions.slice(Math.max(conservees, 0)).map((v) => v.numero).filter((n) => n !== courante).sort((a, b) => a - b);
}

/** Versions affichées par défaut (éditions) ; les étapes ne sortent qu'en recherche de version antérieure. */
export const versionsVisibles = (versions) => versions.filter((v) => v.genre === GENRES.EDITION).sort((a, b) => b.numero - a.numero);
export const etapes = (versions) => versions.filter((v) => v.genre === GENRES.ETAPE).sort((a, b) => b.numero - a.numero);
