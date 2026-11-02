// Évolution d'un chantier (ANALYSE-MODULE-ANALYSE.md § 10.3, lot 8) : séries des graphiques tirées des agrégats de
// chaque photo (faits tels que connus alors) et d'aujourd'hui, par les mêmes calculs que le Détail et le bloc de
// résultats ; échelle et graduations d'un axe. Calculs en décimal, jamais en Number (les pixels seuls en Number).
import { Dz } from '@logibtp/socle';
import { COUT, valeursColonnes } from './indicateurs.js';
import { blocResultats } from './resultats.js';

/**
 * Séries d'évolution. points : [{ date, type, libelle, agregats }] du serveur (du plus ancien au plus récent) ; cout :
 * PA ou PR. Rend { dates, points, series: { budget, facture, depense, terminaison, marge, taux } } : budget PV, facturé
 * cumulé, dépensé (engagé + déboursé), coût à terminaison et marge à terminaison (brute au PA, nette au PR) du bloc de
 * résultats (saisies prévisionnelles comprises), taux de marge (null sans PV).
 */
export function seriesEvolution(points, cout = COUT.PR) {
  const s = { budget: [], facture: [], depense: [], terminaison: [], marge: [], taux: [] };
  for (const p of points) {
    const v = valeursColonnes(p.agregats ?? [], cout);
    const previsionnel = blocResultats({ agregats: p.agregats ?? [] }).lignes.find((l) => l.code === 'previsionnel');
    const auPa = cout === COUT.PA;
    s.budget.push(v.budget_pv);
    s.facture.push(v.facture);
    s.depense.push(v.depense);
    s.terminaison.push(auPa ? previsionnel.pa : previsionnel.pr);
    s.marge.push(auPa ? previsionnel.brute : previsionnel.nette);
    s.taux.push(auPa ? previsionnel.taux_brute : previsionnel.taux_nette);
  }
  return { dates: points.map((p) => p.date), points, series: s };
}

/**
 * Échelle d'un axe de montants : bornes arrondies au pas « 1, 2, 2,5 ou 5 × 10ⁿ » le plus proche de `graduations`
 * intervalles, zéro toujours compris. valeurs : Decimal (null ignorés). Rend { min, max, pas, graduations } en Decimal.
 */
export function echelle(valeurs, graduations = 4) {
  const v = valeurs.filter((x) => x !== null && x !== undefined).map(Dz);
  let min = v.reduce((m, x) => (x.lessThan(m) ? x : m), Dz(0));
  let max = v.reduce((m, x) => (x.greaterThan(m) ? x : m), Dz(0));
  if (min.equals(max)) max = min.plus(1);
  const brut = max.minus(min).dividedBy(graduations);
  const puissance = Dz(10).pow(Math.floor(Math.log10(Number(brut.toString()))));
  const pas = [1, 2, 2.5, 5, 10].map((k) => puissance.times(k)).find((p) => p.greaterThanOrEqualTo(brut));
  min = min.dividedBy(pas).floor().times(pas);
  max = max.dividedBy(pas).ceil().times(pas);
  const l = [];
  for (let x = min; x.lessThanOrEqualTo(max); x = x.plus(pas)) l.push(x);
  return { min, max, pas, graduations: l };
}
