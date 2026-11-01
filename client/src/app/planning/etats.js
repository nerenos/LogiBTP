// États facultatifs d'une tâche du planning (pla_tache.tac_etat) : page du planning et application de terrain.
import { textesParCode } from '@logibtp/socle/dictionnaire';


const CODES_ETAT = ['OPTION', 'PREVUE', 'CONFIRMEE', 'EN_COURS', 'TERMINEE'];
/** Libellés par code (module Personnalisation). */
export const ETATS_TACHE = textesParCode('planning_btp.etats', CODES_ETAT);
/** Couleur de la pastille de chaque état (combo du détail, barres) : variables du thème. */
export const COULEURS_ETAT = Object.freeze(Object.fromEntries(CODES_ETAT.map((c) => [c, `var(--planning-etat-${c.toLowerCase().replace('_', '-')})`])));
/** Origine d'une tâche créée par une saisie libre de l'application de terrain (TerrainBtp.OrigineTerrain). */
export const ORIGINE_TERRAIN = 'terrain';
