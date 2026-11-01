import { textesParCode } from '@logibtp/socle/dictionnaire';

// Modes d'ouverture d'une fiche ; le mode peut changer une fois la fiche ouverte (consultation → modification…).
export const MODES = Object.freeze({
  CONSULTATION: 'consultation',
  MODIFICATION: 'modification',
  CREATION: 'creation',
  COPIE: 'copie',
});

export const LIBELLES_MODES = textesParCode('fiche.modes', Object.values(MODES));

/** Le mode permet-il la saisie ? */
export const enSaisie = (mode) => mode !== MODES.CONSULTATION;

/** Titre d'une fiche : modèle « [prenom] [nom] » complété par les valeurs (champ inconnu ou vide : retiré). */
export function titreFiche(modele, valeurs) {
  return String(modele ?? '').replace(/\[([a-z0-9_]+)\]/gi, (_, code) => valeurs?.[code] ?? '').replace(/\s+/g, ' ').trim();
}
