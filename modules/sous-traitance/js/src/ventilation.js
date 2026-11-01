import { textesParCode } from '@logibtp/socle/dictionnaire';
import { Dz, S, ZERO, arrondir } from '@logibtp/socle';

// Module Sous-traitance : ventilation d'une facture reçue sur les lignes de la commande (ANALYSE-MODULE-SOUS-TRAITANCE.md
// ST8, ST9, ST32). Règle partagée avec ReglesVentilation.cs (jeu tests/cas/02_ventilation.json) : le montant HT de la
// période est réparti au prorata du reste de chaque ligne (montant du marché − cumul précédent) ; une période négative
// (avoir) se répartit au prorata du cumul précédent ; la ligne de plus forte base absorbe l'arrondi. Montant saisi en
// cumul : période = cumul − total précédent. Sortie : cumul de chaque ligne (avancement en montant cumulé, mode M).
//
// lignes : [{ id, marche, precedent }] (montants) ; periode (ou cumul) ; precision : décimales des montants.

export const MESSAGES_VENTILATION = textesParCode('sous_traitance.ventilation.erreurs', ['VENT_SANS_LIGNE', 'VENT_SANS_RESTE', 'VENT_DEPASSEMENT']);

/** Ventile une période (ou un cumul : `cumul` renseigné) ; rend { lignes: [{ id, periode, cumul }], periode, erreurs }. */
export function ventilerFactureRecue({ lignes, periode = null, cumul = null, precision = 2 }) {
  const erreurs = [];
  if (!lignes.length) return { lignes: [], periode: '0', erreurs: ['VENT_SANS_LIGNE'] };
  const totalPrec = lignes.reduce((t, l) => t.plus(Dz(l.precedent)), ZERO);
  const p = arrondir(cumul !== null && cumul !== undefined ? Dz(cumul).minus(totalPrec) : Dz(periode), precision);
  const bases = lignes.map((l) => (p.isNegative() ? Dz(l.precedent) : Dz(l.marche).minus(Dz(l.precedent))).abs());
  const total = bases.reduce((t, b) => t.plus(b), ZERO);
  if (total.isZero() && !p.isZero()) return { lignes: [], periode: S(p), erreurs: [p.isNegative() ? 'VENT_SANS_LIGNE' : 'VENT_SANS_RESTE'] };
  if (!p.isNegative() && p.gt(total)) erreurs.push('VENT_DEPASSEMENT');
  // Ligne de plus forte base (la première en cas d'égalité) : elle reçoit l'écart d'arrondi.
  let max = 0;
  bases.forEach((b, i) => { if (b.gt(bases[max])) max = i; });
  const parts = bases.map((b) => (total.isZero() ? ZERO : arrondir(p.times(b).div(total), precision)));
  parts[max] = p.minus(parts.reduce((t, x, i) => (i === max ? t : t.plus(x)), ZERO));
  return {
    lignes: lignes.map((l, i) => ({ id: l.id, periode: S(parts[i]), cumul: S(Dz(l.precedent).plus(parts[i])) })),
    periode: S(p),
    erreurs,
  };
}
