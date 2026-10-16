import { Dz, S, ZERO } from '@logibtp/socle';

// Reste à payer et pointage (CONCEPTION-MARCHES-REGLEMENTS.md, Q15 à Q17), répliqué dans ResteAPayer.cs
// (jeu modules/reglement/tests/cas/01_reste.json).
//
// Une échéance (montant signé : négatif pour un avoir) est pointée par des règlements ou des cautions ; reste = montant
// − pointé ; réglée quand |reste| ≤ seuil. Une pièce additionne ses échéances : REGLEE (reste nul au seuil près),
// PARTIELLE (quelque chose est pointé), A_REGLER. Un règlement peut pointer plusieurs échéances (une facture et un avoir :
// compensation) ; son reste non pointé (trop-perçu) = montant − somme des pointages. Proposition de pointage : le montant
// disponible est réparti sur les échéances ouvertes de même signe, de la plus ancienne à la plus récente (sans date en
// dernier), sans dépasser leur reste.

const egalAuSeuil = (reste, seuil) => reste.abs().lte(Dz(seuil));

/** État d'une échéance : { reste, reglee } ; e : { montant, pointe }. */
export function etatEcheance(e, seuil = 0) {
  const reste = Dz(e.montant).minus(Dz(e.pointe));
  return { reste: S(reste), reglee: egalAuSeuil(reste, seuil) };
}

/** État d'une pièce : { montant, pointe, reste, statut } ; échéances [{ montant, pointe }]. */
export function etatPiece(echeances, seuil = 0) {
  const montant = echeances.reduce((t, e) => t.plus(Dz(e.montant)), ZERO);
  const pointe = echeances.reduce((t, e) => t.plus(Dz(e.pointe)), ZERO);
  const reste = montant.minus(pointe);
  const statut = egalAuSeuil(reste, seuil) ? 'REGLEE' : pointe.isZero() ? 'A_REGLER' : 'PARTIELLE';
  return { montant: S(montant), pointe: S(pointe), reste: S(reste), statut };
}

/** Reste non pointé d'un règlement (trop-perçu s'il est positif) ; pointages [{ montant }]. */
export function nonPointe(montant, pointages) {
  return S(pointages.reduce((t, p) => t.minus(Dz(p.montant)), Dz(montant)));
}

/**
 * Répartition d'un montant disponible (positif : échéances positives ; négatif : échéances négatives) sur les
 * échéances ouvertes [{ id, date, reste }] : [{ id, montant }] (pointages non nuls).
 */
export function proposerPointage(disponible, echeances) {
  let reste = Dz(disponible);
  const signe = reste.isNegative() ? -1 : 1;
  const ordre = [...echeances]
    .filter((e) => Dz(e.reste).times(signe).gt(ZERO))
    .sort((a, b) => (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31') || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const res = [];
  for (const e of ordre) {
    if (!reste.times(signe).gt(ZERO)) break;
    const r = Dz(e.reste);
    const m = r.abs().lt(reste.abs()) ? r : reste;
    res.push({ id: e.id, montant: S(m) });
    reste = reste.minus(m);
  }
  return res;
}
