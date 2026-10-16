import { Dz, arr6, ZERO, S } from '@logibtp/socle';

// Solde des lignes transformées (CONCEPTION-ACHATS-MARCHES.md, Q7 et Q8), répliqué dans Soldes.cs
// (jeu modules/document/tests/soldes/01_reste_solde.json).
//
// reste = quantité du parent − quantités transformées à l'étape (tous documents, celui en cours compris)
//         − quantités déjà soldées.
// La ligne est soldée si la case est cochée (force), ou si le reste passe sous un seuil : reste ≤ seuil en quantité,
// ou reste ≤ quantité du parent × seuil % / 100 (seuils 0 : soldée quand tout est transformé ; un reste négatif,
// transformé au-delà du parent, est toujours soldé). Une ligne de parent négative se lit au signe près.
// a_solder : quantité à écrire dans document_ligne_solde (reste positif d'une ligne soldée, 0 sinon), au signe du parent.

/**
 * État de solde d'une ligne : { reste, soldee, a_solder } (chaînes décimales exactes).
 * e : { qte_parent, transforme, solde, seuil_pct, seuil_qte, force }.
 */
export function etatSolde(e) {
  const parent = Dz(e.qte_parent);
  const signe = parent.isNegative() ? -1 : 1;
  const reste = arr6(parent.minus(Dz(e.transforme)).minus(Dz(e.solde)));
  const normal = reste.times(signe);
  const seuilPct = arr6(parent.abs().times(Dz(e.seuil_pct)).dividedBy(100));
  const soldee = Boolean(e.force) || normal.lte(Dz(e.seuil_qte)) || normal.lte(seuilPct);
  const aSolder = soldee && normal.gt(ZERO) ? reste : ZERO;
  return { reste: S(reste), soldee, a_solder: S(aSolder) };
}
