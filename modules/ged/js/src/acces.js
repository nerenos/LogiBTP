// Confidentialité et restrictions d'accès d'un document de la GED. Même règle que AccesGed.cs (filtre des requêtes)
// et jeu partagé modules/ged/tests/cas/06_acces.json.
//   - l'auteur du dépôt (cree_par) et les accès listés (profils, utilisateurs) voient toujours le document ;
//   - SECRET : personne d'autre, pas même un administrateur ;
//   - CONFIDENTIEL : en plus, les administrateurs ;
//   - PUBLIC, INTERNE : tout le monde, sauf si des accès sont listés (alors réservé à ces accès et aux administrateurs).

export const CONFIDENTIALITES = [
  ['PUBLIC', 'Public'], ['INTERNE', 'Interne'], ['CONFIDENTIEL', 'Confidentiel'], ['SECRET', 'Secret'],
];

const NIVEAUX = { PUBLIC: 0, INTERNE: 1, CONFIDENTIEL: 2, SECRET: 3 };

export const libelleConfidentialite = (code) => CONFIDENTIALITES.find(([c]) => c === code)?.[1] ?? code ?? '';

/** Niveau le plus strict de deux confidentialités (null ignoré). */
export function plusStricte(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return NIVEAUX[b] > NIVEAUX[a] ? b : a;
}

/** Utilisateur : { code, profil } ; administrateur = profil ADMIN. */
export function accesAutorise(doc, { code, profil }) {
  const profils = doc.acces_profils ?? [];
  const utilisateurs = doc.acces_utilisateurs ?? [];
  if (doc.cree_par === code || profils.includes(profil) || utilisateurs.includes(code)) return true;
  const niveau = doc.confidentialite ?? 'INTERNE';
  if (niveau === 'SECRET') return false;
  if (profil === 'ADMIN') return true;
  return niveau !== 'CONFIDENTIEL' && profils.length === 0 && utilisateurs.length === 0;
}

/** Changer la confidentialité ou les accès : auteur du dépôt ou administrateur. */
export const peutChangerAcces = (doc, { code, profil }) => profil === 'ADMIN' || doc.cree_par === code;
