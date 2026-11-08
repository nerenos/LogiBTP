// Règles du bandeau sans interface (testables sous Node) : téléphone et menus simplifiés.

/** Largeur (px) en dessous de laquelle le bandeau passe en mode téléphone (menus derrière un bouton, infos en icônes). */
export const LARGEUR_TELEPHONE = 700;

/** Requête média du mode téléphone. */
export const MEDIA_TELEPHONE = `(max-width: ${LARGEUR_TELEPHONE}px)`;

const liste = (e) => (typeof e === 'function' ? e() : e) ?? null;

/**
 * Menus affichés par le bandeau : la liste réduite `simplifie` (fournie par l'application) tant que `complet` est faux,
 * sinon les menus complets. Sans liste réduite : toujours les menus complets.
 */
export function menusAffiches(menus, simplifie = null, complet = false) {
  const reduits = liste(simplifie);
  return reduits && !complet ? reduits : (menus ?? []);
}

/** Bascule entre menus simplifiés et complets proposée seulement quand une liste réduite existe. */
export function basculeProposee(simplifie) {
  return Boolean(liste(simplifie));
}
