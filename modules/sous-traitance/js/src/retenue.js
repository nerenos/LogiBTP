// Module Sous-traitance : libération de la retenue de garantie d'un marché (ANALYSE-MODULE-SOUS-TRAITANCE.md ST23).
// Règle partagée avec ReglesRetenue.cs (jeu tests/cas/04_retenue.json) : échéance = réception + 1 an (29 février →
// 28 février) ; réserves non levées : retenue bloquée ; réserves levées après l'échéance : libération à leur levée.

export const MESSAGES_RETENUE = {
  RET_RECEPTION: 'Travaux non réceptionnés : pas d\'échéance de libération',
  RET_RESERVES: 'Réserves non levées : la retenue reste bloquée',
};

const unAn = (date) => {
  const [a, m, j] = date.split('-').map(Number);
  const bissextile = (x) => (x % 4 === 0 && x % 100 !== 0) || x % 400 === 0;
  const jour = m === 2 && j === 29 && !bissextile(a + 1) ? 28 : j;
  return `${a + 1}-${String(m).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
};

/** Échéance de libération : { echeance, date (libération possible), bloquee, motif, liberable à la date du jour }. */
export function liberationRetenue({ reception, reserves = false, leveesLe = null }, aujourdhui) {
  if (!reception) return { echeance: null, date: null, bloquee: true, motif: 'RET_RECEPTION', liberable: false };
  const echeance = unAn(reception);
  if (reserves && !leveesLe) return { echeance, date: null, bloquee: true, motif: 'RET_RESERVES', liberable: false };
  const date = reserves && leveesLe > echeance ? leveesLe : echeance;
  return { echeance, date, bloquee: false, motif: null, liberable: aujourdhui >= date };
}
