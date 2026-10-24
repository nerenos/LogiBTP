import { D, Dz, S, arrondir } from '@logibtp/socle';
import { minute } from './stock.js';

// Valorisation d'un article (ANALYSE-MODULE-STOCK.md S4, S29, S30, S31), répliquée dans ReglesValorisation.cs (jeu
// modules/stock/tests/cas/02_prix.json). Les événements de tous les lieux sont rejoués dans l'ordre des dates-heures
// (à la minute ; à minute égale : mouvements, puis comptages, puis réévaluations, chacun dans l'ordre de la liste) :
// - entrée valorisée (quantité > 0 et prix) : PMP = (stock total × PMP + quantité × prix) / (stock total + quantité),
//   ou le prix si le stock total était nul ou négatif (arrondi à 6 décimales) ; elle devient le dernier prix d'achat ;
// - autre mouvement (sortie, transfert, retour sans prix) : quantité seulement, PMP inchangé ;
// - comptage : la quantité du lieu devient la quantité comptée (l'écart ne change pas le PMP) ;
// - réévaluation : le PMP devient la valeur saisie.
// Le prix d'une réception facturée est celui de la facture (l'application le reporte sur le mouvement) ; non facturée,
// il est provisoire. Sans achat : valeur de repli (PA de la bibliothèque), signalée.

export const METHODES_VALORISATION = { PMP: 'Prix moyen pondéré', DERNIER_PA: "Dernier prix d'achat" };

/**
 * Entrée : { mouvements: [{ id, lieu, date, quantite, prix?, provisoire? }], comptages: [{ lieu, date, quantite }],
 * reevaluations: [{ date, pmp }] } ; date : fin du rejeu (null : tout). Résultat : { pmp, dernier_pa, dernier_pa_id,
 * dernier_pa_date, provisoire, quantite (stock total), historique: [{ id, pmp }] (PMP à l'issue de chaque mouvement) }.
 */
export function valoriser({ mouvements = [], comptages = [], reevaluations = [] }, date = null) {
  const fin = minute(date);
  const evenements = [
    ...mouvements.map((m, i) => ({ d: minute(m.date), rang: 0, i, m })),
    ...comptages.map((c, i) => ({ d: minute(c.date), rang: 1, i, c })),
    ...reevaluations.map((r, i) => ({ d: minute(r.date), rang: 2, i, r })),
  ].filter((e) => fin === null || e.d <= fin)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.rang - b.rang || a.i - b.i));
  const quantites = new Map();
  const total = () => [...quantites.values()].reduce((s, q) => s.plus(q), Dz(0));
  let pmp = null;
  let dernier = null;
  const historique = [];
  for (const e of evenements) {
    if (e.m) {
      const q = Dz(e.m.quantite);
      const prix = D(e.m.prix);
      if (prix !== null && q.gt(0)) {
        const t = total();
        pmp = pmp === null || t.lte(0) ? prix : arrondir(t.times(pmp).plus(q.times(prix)).div(t.plus(q)), 6);
        dernier = e.m;
      }
      quantites.set(String(e.m.lieu), (quantites.get(String(e.m.lieu)) ?? Dz(0)).plus(q));
      historique.push({ id: e.m.id, pmp: S(pmp) });
    } else if (e.c) {
      quantites.set(String(e.c.lieu), Dz(e.c.quantite));
    } else {
      pmp = D(e.r.pmp);
    }
  }
  return {
    pmp: S(pmp), dernier_pa: dernier ? S(D(dernier.prix)) : null, dernier_pa_id: dernier?.id ?? null,
    dernier_pa_date: dernier ? minute(dernier.date) : null, provisoire: Boolean(dernier?.provisoire), quantite: S(total()), historique,
  };
}

/**
 * Valeur unitaire selon la méthode de la société (PMP ou DERNIER_PA) ; sans valeur, repli (PA de la bibliothèque) :
 * { valeur, source: 'PMP' | 'DERNIER_PA' | 'REPLI' | null, provisoire }.
 */
export function valeurUnitaire(resultat, methode, repli = null) {
  const v = methode === 'DERNIER_PA' ? resultat.dernier_pa : resultat.pmp;
  if (v !== null && v !== undefined) return { valeur: v, source: methode === 'DERNIER_PA' ? 'DERNIER_PA' : 'PMP', provisoire: methode === 'DERNIER_PA' && resultat.provisoire };
  const r = D(repli);
  return { valeur: r === null ? null : S(r), source: r === null ? null : 'REPLI', provisoire: false };
}
