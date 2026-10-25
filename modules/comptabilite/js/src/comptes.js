// Règles des comptes comptables, répliquées dans ReglesComptes.cs (jeu modules/comptabilite/tests/cas/01_comptes.json) :
// compte général (chiffres, classe 1 à 9, longueur maximale ou complétion par des zéros à droite), compte de tiers
// (lettres et chiffres, longueur maximale), compte de tiers proposé (préfixe + code du tiers sans ses lettres de tête),
// classe d'un compte.

/** Longueur maximale d'un compte de tiers quand aucune n'est paramétrée. */
export const LONGUEUR_TIERS_MAX = 17;

export const MESSAGES_COMPTES = {
  CPT_VIDE: 'Compte vide',
  CPT_CARACTERES: 'Un compte général ne contient que des chiffres',
  CPT_CLASSE: 'Un compte général commence par un chiffre de 1 à 9 (classe)',
  CPT_LONGUEUR: 'Compte trop long',
  CPT_TIERS_CARACTERES: 'Un compte de tiers ne contient que des lettres et des chiffres',
};

const resultat = (code, erreur = null) => ({ code: erreur ? null : code, erreur });

/** Compte général normalisé : { code, erreur }. longueur : maximale (null = libre) ; completerZeros : 704 → 70400000. */
export function normaliserCompte(code, { longueur = null, completerZeros = false } = {}) {
  const c = String(code ?? '').trim();
  if (!c) return resultat(null, 'CPT_VIDE');
  if (!/^[0-9]+$/.test(c)) return resultat(null, 'CPT_CARACTERES');
  if (c[0] === '0') return resultat(null, 'CPT_CLASSE');
  if (longueur && c.length > longueur) return resultat(null, 'CPT_LONGUEUR');
  return resultat(longueur && completerZeros ? c.padEnd(longueur, '0') : c);
}

/** Compte de tiers (auxiliaire) normalisé : majuscules, lettres et chiffres, longueur maximale. */
export function normaliserCompteTiers(code, { longueur = null } = {}) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return resultat(null, 'CPT_VIDE');
  if (!/^[A-Z0-9]+$/.test(c)) return resultat(null, 'CPT_TIERS_CARACTERES');
  if (c.length > (longueur || LONGUEUR_TIERS_MAX)) return resultat(null, 'CPT_LONGUEUR');
  return resultat(c);
}

/**
 * Compte de tiers proposé : préfixe + code du tiers sans ses lettres de tête ni ses séparateurs (T000123 → C000123) ;
 * trop long : zéros de tête du code retirés autant qu'il le faut, sinon erreur CPT_LONGUEUR.
 */
export function proposerCompteTiers(prefixe, codeTiers, { longueur = null } = {}) {
  const p = String(prefixe ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  let code = String(codeTiers ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^[A-Z]+/, '');
  if (!code) return resultat(null, 'CPT_VIDE');
  const max = longueur || LONGUEUR_TIERS_MAX;
  while ((p + code).length > max && code.length > 1 && code[0] === '0') code = code.slice(1);
  return normaliserCompteTiers(p + code, { longueur: max });
}

/** Classe d'un compte (premier chiffre, 1 à 9) ou null. */
export function classeCompte(code) {
  const c = String(code ?? '').trim();
  return /^[1-9]/.test(c) ? Number(c[0]) : null;
}
