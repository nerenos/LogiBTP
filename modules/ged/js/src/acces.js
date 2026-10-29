// Confidentialité et restrictions d'accès d'un document de la GED. Même règle que AccesGed.cs (filtre des requêtes)
// et jeu partagé modules/ged/tests/cas/06_acces.json.
//   - l'auteur du dépôt (cree_par) et les accès listés (profils, utilisateurs) voient toujours le document ;
//   - SECRET : personne d'autre, pas même un administrateur ;
//   - CONFIDENTIEL : en plus, les administrateurs ;
//   - PUBLIC, INTERNE : tout le monde, sauf si des accès sont listés (alors réservé à ces accès et aux administrateurs).
import { NIVEAU_CONFIDENTIALITE, PROFIL } from '@logibtp/socle';

const N = NIVEAU_CONFIDENTIALITE;

export const CONFIDENTIALITES = [
  [N.PUBLIC, 'Public'], [N.INTERNE, 'Interne'], [N.CONFIDENTIEL, 'Confidentiel'], [N.SECRET, 'Secret'],
];

const NIVEAUX = Object.fromEntries(CONFIDENTIALITES.map(([c], i) => [c, i]));

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
  const niveau = doc.confidentialite ?? N.INTERNE;
  if (niveau === N.SECRET) return false;
  if (profil === PROFIL.ADMIN) return true;
  return niveau !== N.CONFIDENTIEL && profils.length === 0 && utilisateurs.length === 0;
}

/** Changer la confidentialité ou les accès : auteur du dépôt ou administrateur. */
export const peutChangerAcces = (doc, { code, profil }) => profil === PROFIL.ADMIN || doc.cree_par === code;
