import { Dz, S, ZERO } from '@logibtp/socle';

// Reste à payer et pointage (CONCEPTION-MARCHES-REGLEMENTS.md, Q15 à Q17), répliqué dans ResteAPayer.cs
// (jeu modules/reglement/tests/cas/01_reste.json).
//
// Une échéance (montant signé : négatif pour un avoir) est pointée par des règlements ou des cautions ; reste = montant
// − pointé ; réglée quand |reste| ≤ seuil. Une pièce additionne ses échéances : REGLEE (reste nul au seuil près),
// PARTIELLE (quelque chose est pointé), A_REGLER. Un règlement peut pointer plusieurs échéances (une facture et un avoir :
// compensation) ; son reste non pointé (trop-perçu) = montant − somme des pointages. Proposition de pointage : le montant
// disponible est réparti sur les échéances ouvertes de même signe, de la plus ancienne à la plus récente (sans date en
// dernier), sans dépasser leur reste. Imputation sur une facture suivante (décision du 31/10/2026) : un avoir (reste
// négatif) ou le trop-perçu d'un règlement s'impute sur une échéance à régler au plus du plus petit des deux restes.

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

/**
 * Montant imputable au plus : disponible = reste d'un avoir (négatif) ou non pointé d'un règlement, reste = reste de
 * l'échéance à régler (positif) ; 0 si l'un des deux est nul ou si l'échéance n'est pas à régler.
 */
export function maximumImputation(disponible, reste) {
  const d = Dz(disponible).abs();
  const r = Dz(reste);
  if (!r.gt(ZERO) || d.isZero()) return S(ZERO);
  return S(d.lt(r) ? d : r);
}

/**
 * Cautions de retenue de garantie (décision du 31/10/2026, lot F) : une caution remplace la retenue (la part cautionnée
 * n'est pas retenue : elle est exigible avec la pièce) ; elle couvre plusieurs retenues et une retenue peut n'être
 * couverte qu'en partie. Le montant cautionné se consomme en premier, des pièces les plus anciennes aux plus récentes
 * (date de la pièce, sans date en dernier, puis identifiant) ; la retenue non couverte reste retenue jusqu'à sa
 * libération une fois les cautions épuisées. Une caution couvre les retenues de son objet (marché), ou toutes celles du
 * tiers sans objet ; les cautions de l'objet passent avant celles sans objet, puis par date et identifiant ; une caution
 * levée (mainlevée) ne couvre plus les pièces datées de sa mainlevée ou après.
 * cautions [{ id, objet, date, montant, mainlevee }], retenues [{ id, objet, date_piece, montant }] (montants positifs ;
 * une retenue nulle ou négative n'est pas couverte) → { allocations [{ caution, retenue, montant }],
 * retenues [{ id, cautionne, retenu }] (ordre d'entrée), cautions [{ id, consomme, disponible }] (ordre d'entrée) }.
 */
export function consommerCautions(cautions, retenues) {
  const parId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  const dispo = new Map(cautions.map((c) => [c.id, Dz(c.montant)]));
  const ordreCautions = [...cautions].sort((a, b) => (a.objet === null || a.objet === undefined ? 1 : 0) - (b.objet === null || b.objet === undefined ? 1 : 0)
    || String(a.date ?? '9999-12-31').localeCompare(String(b.date ?? '9999-12-31')) || parId(a, b));
  const ordreRetenues = [...retenues].sort((a, b) => String(a.date_piece ?? '9999-12-31').localeCompare(String(b.date_piece ?? '9999-12-31')) || parId(a, b));
  const allocations = [];
  const couvert = new Map();
  for (const r of ordreRetenues) {
    let reste = Dz(r.montant);
    if (!reste.gt(ZERO)) continue;
    for (const c of ordreCautions) {
      if (!reste.gt(ZERO)) break;
      const sansObjet = c.objet === null || c.objet === undefined;
      if (!sansObjet && String(c.objet) !== String(r.objet ?? '')) continue;
      if (c.mainlevee && (!r.date_piece || String(r.date_piece) >= String(c.mainlevee))) continue;
      const d = dispo.get(c.id);
      if (!d.gt(ZERO)) continue;
      const m = d.lt(reste) ? d : reste;
      allocations.push({ caution: c.id, retenue: r.id, montant: S(m) });
      dispo.set(c.id, d.minus(m));
      couvert.set(r.id, (couvert.get(r.id) ?? ZERO).plus(m));
      reste = reste.minus(m);
    }
  }
  return {
    allocations,
    retenues: retenues.map((r) => {
      const c = couvert.get(r.id) ?? ZERO;
      return { id: r.id, cautionne: S(c), retenu: S(Dz(r.montant).gt(ZERO) ? Dz(r.montant).minus(c) : Dz(r.montant)) };
    }),
    cautions: cautions.map((c) => ({ id: c.id, consomme: S(Dz(c.montant).minus(dispo.get(c.id))), disponible: S(dispo.get(c.id)) })),
  };
}

/**
 * Part d'une retenue exigible avec sa pièce (cautionnée) qui reste à pointer : cautionné − pointé, entre 0 et le reste
 * de l'échéance (les règlements pointent d'abord la part cautionnée).
 */
export function exigibleCaution(cautionne, pointe, reste) {
  const e = Dz(cautionne).minus(Dz(pointe));
  if (!e.gt(ZERO) || !Dz(reste).gt(ZERO)) return S(ZERO);
  return S(e.lt(Dz(reste)) ? e : Dz(reste));
}
