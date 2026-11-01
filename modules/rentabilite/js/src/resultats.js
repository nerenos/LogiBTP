// Bloc de résultats sur les PV du Détail (ANALYSE-MODULE-ANALYSE.md § 4.8, décisions Q15, Q16) : lignes Budget,
// Réalisé, Facturé, Reste à facturer, Prévisionnel ; colonnes HT des lignes, postes de pied par libellé, HT net, marge
// brute (HT des lignes − PA) et nette (HT des lignes − PR) en montant et en %. Chaque ligne met en face de son PV le coût
// du § 4.8. En période, les flux (budget, facturé, déboursé) sont ceux de la période, les restes au cumul.
import { Dz } from '@logibtp/socle';
import { INDICATEUR, COMPOSANTE } from './codes.js';
import { filtrerOrdre } from './indicateurs.js';

/** Lignes du bloc, dans l'ordre d'affichage. */
export const LIGNES_RESULTATS = Object.freeze(['budget', 'realise', 'facture', 'reste_facturer', 'previsionnel']);

const somme = (agregats, filtre, champ, periode) => agregats.filter(filtre)
  .reduce((s, a) => {
    const v = a[periode ? `${champ}_periode` : champ];
    return v === null || v === undefined ? s : s.plus(Dz(v));
  }, Dz(0));

const pourcent = (a, b) => (b.isZero() ? null : a.times(100).dividedBy(b));

/** Postes par libellé (Map libellé → Decimal) d'un indicateur. */
function postesDe(postes, indicateur, periode) {
  const m = new Map();
  for (const p of postes.filter((x) => x.indicateur === indicateur)) {
    m.set(p.libelle, (m.get(p.libelle) ?? Dz(0)).plus(Dz(periode ? p.pv_periode : p.pv)));
  }
  return m;
}

const totalPostes = (m) => [...m.values()].reduce((s, v) => s.plus(v), Dz(0));

/**
 * Bloc de résultats. agregats : ceux du Détail ; postes : [{ ordre_id, indicateur, libelle, pv, pv_periode }] ;
 * ordre : comme le Détail (undefined = tout, 0 = sans ordre) ; periode : flux de la période.
 * Rend { libelles (postes, dans l'ordre), lignes: [{ code, lignes, postes: Map, net, pa, pr, brute, taux_brute, nette,
 * taux_nette }] } ; une ligne sans poste a `postes` vide et `net` = `lignes`.
 */
export function blocResultats({ agregats, postes = [], ordre, periode = false }) {
  const a = filtrerOrdre(agregats, ordre);
  const p = filtrerOrdre(postes, ordre);
  const ind = (i, ...composantes) => (x) => x.indicateur === i && (!composantes.length || composantes.includes(x.composante));
  const sansPoste = (i) => (x) => x.indicateur === i && x.composante !== COMPOSANTE.POSTE;
  const flux = (filtre, champ) => somme(a, filtre, champ, periode);
  const cumul = (filtre, champ) => somme(a, filtre, champ, false);

  // Coûts (PA et PR) : budget, déboursé (flux) ; dépensé et reste à dépenser (cumul).
  const cout = (champ) => {
    const depense = cumul(ind(INDICATEUR.ENGAGE), champ).plus(cumul(ind(INDICATEUR.DEBOURSE), champ));
    const reste = cumul(sansPoste(INDICATEUR.BUDGET_EXECUTION), champ).minus(depense);
    return { budget: flux(sansPoste(INDICATEUR.BUDGET), champ), debourse: flux(ind(INDICATEUR.DEBOURSE), champ), depense, reste };
  };
  const pa = cout('pa');
  const pr = cout('pr');

  const budgetLignes = flux(sansPoste(INDICATEUR.BUDGET), 'pv');
  const budgetPostes = postesDe(p, INDICATEUR.BUDGET, periode);
  // Réalisé (Q15) : lignes des factures après déduction du précédent, sans les factures d'acompte ni les postes.
  const realiseLignes = flux(ind(INDICATEUR.FACTURE, COMPOSANTE.VENTE), 'pv');
  const factureLignes = flux(sansPoste(INDICATEUR.FACTURE), 'pv');
  const facturePostes = postesDe(p, INDICATEUR.FACTURE, periode);
  // Reste à facturer : au cumul (budget − facturé), par libellé de poste.
  const resteLignes = cumul(sansPoste(INDICATEUR.BUDGET), 'pv').minus(cumul(sansPoste(INDICATEUR.FACTURE), 'pv'));
  const restePostes = new Map(postesDe(p, INDICATEUR.BUDGET, false));
  for (const [l, v] of postesDe(p, INDICATEUR.FACTURE, false)) restePostes.set(l, (restePostes.get(l) ?? Dz(0)).minus(v));

  const ligne = (code, lignes, postesLigne, coutPa, coutPr) => {
    const brute = lignes.minus(coutPa);
    const nette = lignes.minus(coutPr);
    return {
      code, lignes, postes: postesLigne, net: lignes.plus(totalPostes(postesLigne)), pa: coutPa, pr: coutPr,
      brute, taux_brute: pourcent(brute, lignes), nette, taux_nette: pourcent(nette, lignes),
    };
  };
  const lignes = [
    ligne('budget', budgetLignes, budgetPostes, pa.budget, pr.budget),
    ligne('realise', realiseLignes, new Map(), pa.debourse, pr.debourse),
    ligne('facture', factureLignes, facturePostes, pa.debourse, pr.debourse),
    ligne('reste_facturer', resteLignes, restePostes, pa.reste, pr.reste),
    // Prévisionnel à terminaison : budget PV (cumul) ; dépensé + reste à dépenser (saisies prévisionnelles : lot 6).
    ligne('previsionnel', cumul(sansPoste(INDICATEUR.BUDGET), 'pv'), postesDe(p, INDICATEUR.BUDGET, false),
      pa.depense.plus(pa.reste), pr.depense.plus(pr.reste)),
  ];
  const libelles = [...new Set(lignes.flatMap((l) => [...l.postes.keys()]))].sort((x, y) => x.localeCompare(y, 'fr'));
  return { libelles, lignes };
}
