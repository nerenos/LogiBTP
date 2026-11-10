// Couches de personnalisation du programme, dans l'ordre de surcharge : socle → modules → cœur (module Personnalisation).
// Un paquet qui fournit des textes, des icônes, des images ou des variables du thème a son dossier personnalisation/
// et s'ajoute ici (construction du client, serveur de développement, tests) ; modules par ordre alphabétique (les
// textes d'un module sont sous son préfixe, les erreurs sous erreurs.<CODE> : l'ordre ne change rien entre eux).
import { fileURLToPath } from 'node:url';

const dossier = (relatif) => fileURLToPath(new URL(relatif, import.meta.url));

export const COUCHES = [
  dossier('../../socle/js/personnalisation'),
  dossier('../../modules/annuaire/js/personnalisation'),
  dossier('../../modules/authentification/js/personnalisation'),
  dossier('../../modules/bibliotheque/js/personnalisation'),
  dossier('../../modules/calendrier/js/personnalisation'),
  dossier('../../modules/comptabilite/js/personnalisation'),
  dossier('../../modules/crm/js/personnalisation'),
  dossier('../../modules/document/js/personnalisation'),
  dossier('../../modules/droits/js/personnalisation'),
  dossier('../../modules/edition/js/personnalisation'),
  dossier('../../modules/entreprises-fr/js/personnalisation'),
  dossier('../../modules/execution/js/personnalisation'),
  dossier('../../modules/facture-electronique/js/personnalisation'),
  dossier('../../modules/fiche/js/personnalisation'),
  dossier('../../modules/ged/js/personnalisation'),
  dossier('../../modules/graphe/js/personnalisation'),
  dossier('../../modules/import/js/personnalisation'),
  dossier('../../modules/liste/js/personnalisation'),
  dossier('../../modules/mail/js/personnalisation'),
  dossier('../../modules/metre/js/personnalisation'),
  dossier('../../modules/navigation/js/personnalisation'),
  dossier('../../modules/oauth/personnalisation'),
  dossier('../../modules/planning/js/personnalisation'),
  dossier('../../modules/pointage/js/personnalisation'),
  dossier('../../modules/relance/js/personnalisation'),
  dossier('../../modules/rentabilite/js/personnalisation'),
  dossier('../../modules/sav/js/personnalisation'),
  dossier('../../modules/sous-traitance/js/personnalisation'),
  dossier('../../modules/stock/js/personnalisation'),
  dossier('.'),
];

/** Fichiers lus au démarrage, préchargés par index.html (même adresse que LOGO dans src/personnalisation.js). */
export const PRECHARGES = ['images/logo.svg'];
