// Couches de personnalisation du programme, dans l'ordre de surcharge : socle → modules → cœur (module Personnalisation).
// Un paquet qui fournit des textes, des icônes, des images ou des variables du thème a son dossier personnalisation/
// et s'ajoute ici (construction du client, serveur de développement, tests).
import { fileURLToPath } from 'node:url';

const dossier = (relatif) => fileURLToPath(new URL(relatif, import.meta.url));

export const COUCHES = [
  dossier('../../socle/js/personnalisation'),
  dossier('../../modules/navigation/js/personnalisation'),
  dossier('.'),
];

/** Fichiers lus au démarrage, préchargés par index.html (même adresse que LOGO dans src/personnalisation.js). */
export const PRECHARGES = ['images/logo.svg'];
