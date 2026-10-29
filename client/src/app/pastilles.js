// Pastilles d'état à libellé (classe pastille-compte : ok, attention, erreur, neutre…) : comptes, courriels, connexions,
// habilitations, échéances d'entretien.
import { echapper } from '@logibtp/socle/ui';

/** Pastille d'un libellé dans une classe d'état ; `titre` : bulle au survol. */
export const pastille = (libelle, classe = 'neutre', { titre } = {}) =>
  `<span class="pastille-compte ${classe}"${titre ? ` title="${echapper(titre)}"` : ''}>${echapper(libelle)}</span>`;

/** Pastille d'un état lu dans une table { ETAT: [libellé, classe] } (état inconnu : son code, neutre). */
export const pastilleTable = (table, etat, options) => {
  const [libelle, classe] = table[etat] ?? [etat, 'neutre'];
  return pastille(libelle, classe, options);
};
