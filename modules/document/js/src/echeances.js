import { Dz, arrondir, S, ZERO } from '@logibtp/socle';

// Échéancier d'une pièce (CONCEPTION-MARCHES-REGLEMENTS.md, Q19 à Q21), répliqué dans Echeances.cs
// (jeu modules/document/tests/echeances/01_echeances.json).
//
// Condition de paiement : lignes { pct, delai (jours), base, jour, mode } ; base NET (date + délai), FIN_MOIS (date +
// délai, puis fin de ce mois), JOUR (date + délai, puis le prochain jour « jour » du mois, le dernier jour si le mois est
// plus court). Montants : pourcentage du net à payer arrondi, la dernière échéance prend le reste. Sans ligne : une
// échéance au comptant. Retenue de garantie : échéance de nature RETENUE sans date (libération à la réception + 1 an).

/** Modes de règlement : [code, libellé] (mêmes codes que le mode de règlement des tiers). */
export const MODES_REGLEMENT = [
  ['VIREMENT', 'Virement'], ['PRELEVEMENT', 'Prélèvement'], ['CHEQUE', 'Chèque'], ['LCR', 'LCR'], ['CB', 'Carte bancaire'], ['ESPECES', 'Espèces'],
];

/** Montant retenu (positif) d'une pièce : postes de pied marqués retenue de garantie, dans le net à payer. */
export function montantRetenue(lignes) {
  return S((lignes ?? []).filter((l) => l.lig_pied_retenue && l.lig_type_prix !== 'M').reduce((t, l) => t.minus(Dz(l.lig_montant_ht)), ZERO));
}

const jourMs = 86400000;
const versDate = (iso) => { const [a, m, j] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, j)); };
const versIso = (d) => d.toISOString().slice(0, 10);
const finDeMois = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));

/** Date d'échéance d'une ligne de condition à partir de la date de la pièce (ISO). */
export function dateEcheance(dateIso, ligne) {
  const d = new Date(versDate(dateIso).getTime() + (Number(ligne.delai) || 0) * jourMs);
  if (ligne.base === 'FIN_MOIS') return versIso(finDeMois(d));
  if (ligne.base === 'JOUR') {
    const jour = Number(ligne.jour) || 1;
    const dans = (annee, mois) => new Date(Date.UTC(annee, mois, Math.min(jour, finDeMois(new Date(Date.UTC(annee, mois, 1))).getUTCDate())));
    let e = dans(d.getUTCFullYear(), d.getUTCMonth());
    if (e < d) e = dans(d.getUTCFullYear(), d.getUTCMonth() + 1);
    return versIso(e);
  }
  return versIso(d);
}

/**
 * Échéances : [{ rang, date, montant, mode, nature }] (montants en chaînes décimales).
 * e : { date (ISO), montant (net à payer), lignes, retenue (montant retenu, positif), mode (par défaut), precision }.
 */
export function calculerEcheances({ date, montant, lignes = [], retenue = null, mode = null, precision = 2 }) {
  const total = Dz(montant);
  const conditions = lignes.length ? lignes : [{ pct: 100, delai: 0, base: 'NET' }];
  let reste = total;
  const res = conditions.map((l, i) => {
    const m = i === conditions.length - 1 ? reste : arrondir(total.times(Dz(l.pct)).div(100), precision);
    reste = reste.minus(m);
    return { rang: i + 1, date: dateEcheance(date, l), montant: S(m), mode: l.mode ?? mode ?? null, nature: 'NORMALE' };
  });
  const r = Dz(retenue);
  if (!r.equals(ZERO)) res.push({ rang: res.length + 1, date: null, montant: S(r), mode: mode ?? null, nature: 'RETENUE' });
  return res;
}
