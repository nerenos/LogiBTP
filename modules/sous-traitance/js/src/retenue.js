// Module Sous-traitance : libération de la retenue de garantie d'un marché (ANALYSE-MODULE-SOUS-TRAITANCE.md ST23).
// Règle partagée avec ReglesRetenue.cs (jeu tests/cas/04_retenue.json) : échéance = réception + 1 an (29 février →
// 28 février) ; réserves non levées : retenue bloquée ; réserves levées après l'échéance : libération à leur levée.
import { ajouterMois } from '@logibtp/socle';

export const MESSAGES_RETENUE = {
  RET_RECEPTION: 'Travaux non réceptionnés : pas d\'échéance de libération',
  RET_RESERVES: 'Réserves non levées : la retenue reste bloquée',
};

/** Échéance de libération : { echeance, date (libération possible), bloquee, motif, liberable à la date du jour }. */
export function liberationRetenue({ reception, reserves = false, leveesLe = null }, aujourdhui) {
  if (!reception) return { echeance: null, date: null, bloquee: true, motif: 'RET_RECEPTION', liberable: false };
  const echeance = ajouterMois(reception, 12);
  if (reserves && !leveesLe) return { echeance, date: null, bloquee: true, motif: 'RET_RESERVES', liberable: false };
  const date = reserves && leveesLe > echeance ? leveesLe : echeance;
  return { echeance, date, bloquee: false, motif: null, liberable: aujourdhui >= date };
}
