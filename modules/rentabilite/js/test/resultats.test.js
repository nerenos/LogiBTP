import { describe, it, expect } from 'vitest';
import { blocResultats, lignesDetail, COLONNES_DETAIL, COLONNES_HEURES, INDICATEUR as I, COMPOSANTE as C } from '../src/index.js';

const A = (indicateur, composante, pa, pr, pv, { heures = null, ordre_id = null, nat_id = 11, periode = null } = {}) => ({
  ordre_id, nat_id, indicateur, composante, pa, pr, pv, heures, nb: 1,
  pa_periode: periode?.pa ?? 0, pr_periode: periode?.pr ?? 0, pv_periode: periode?.pv ?? 0, heures_periode: periode?.heures ?? null,
});
const AGREGATS = [
  A(I.BUDGET, C.VENTE, 600, 660, 1000, { heures: 20, periode: { pa: 600, pr: 660, pv: 1000, heures: 20 } }),
  A(I.BUDGET, C.POSTE, 0, 0, -50, { nat_id: null }),
  A(I.BUDGET_EXECUTION, C.VENTE, 700, 770, 1000, { heures: 24 }),
  A(I.ENGAGE, C.MO, 100, 110, 0, { heures: 4 }),
  A(I.DEBOURSE, C.MO, 300, 330, 0, { heures: 12, periode: { pa: 100, pr: 110, heures: 3 } }),
  A(I.FACTURE, C.VENTE, 0, 0, 400, { periode: { pv: 150 } }),
  A(I.FACTURE, C.ACOMPTE, 0, 0, 200, { nat_id: null }),
  A(I.FACTURE, C.POSTE, 0, 0, -220, { nat_id: null }),
];
const POSTES = [
  { ordre_id: null, indicateur: I.BUDGET, libelle: 'Remise', pv: -50, pv_periode: 0 },
  { ordre_id: null, indicateur: I.FACTURE, libelle: 'Remise', pv: -20, pv_periode: -5 },
  { ordre_id: null, indicateur: I.FACTURE, libelle: "Déduction d'acompte", pv: -200, pv_periode: 0 },
];

describe('Bloc de résultats', () => {
  const r = blocResultats({ agregats: AGREGATS, postes: POSTES });
  const l = Object.fromEntries(r.lignes.map((x) => [x.code, x]));
  it('budget : lignes, postes, HT net, marges sur le HT des lignes', () => {
    expect(r.libelles).toEqual(["Déduction d'acompte", 'Remise']);
    expect(l.budget.net.toString()).toBe('950');
    expect(l.budget.brute.toString()).toBe('400');
    expect(l.budget.taux_nette.toString()).toBe('34');
  });
  it('réalisé sans factures d\'acompte, facturé complet, coût = déboursé', () => {
    expect(l.realise.lignes.toString()).toBe('400');
    expect(l.realise.net.toString()).toBe('400');
    expect(l.facture.lignes.toString()).toBe('600');
    expect(l.facture.net.toString()).toBe('380');
    expect(l.facture.pr.toString()).toBe('330');
  });
  it('reste à facturer et prévisionnel', () => {
    expect(l.reste_facturer.lignes.toString()).toBe('400');
    expect(l.reste_facturer.postes.get('Remise').toString()).toBe('-30');
    expect(l.reste_facturer.postes.get("Déduction d'acompte").toString()).toBe('200');
    expect(l.reste_facturer.pa.toString()).toBe('300'); // 700 − (100 + 300)
    expect(l.previsionnel.pa.toString()).toBe('700');
    expect(l.previsionnel.taux_brute.toString()).toBe('30');
  });
  it('période : flux de la période, restes au cumul', () => {
    const p = Object.fromEntries(blocResultats({ agregats: AGREGATS, postes: POSTES, periode: true }).lignes.map((x) => [x.code, x]));
    expect(p.realise.lignes.toString()).toBe('150');
    expect(p.realise.pa.toString()).toBe('100');
    expect(p.facture.postes.get('Remise').toString()).toBe('-5');
    expect(p.reste_facturer.lignes.toString()).toBe('400');
  });
  it('marge sans base : % nul', () => {
    const v = blocResultats({ agregats: [], postes: [] }).lignes[0];
    expect(v.taux_brute).toBeNull();
  });
});

describe('Heures de main-d\'œuvre', () => {
  it('budget, budget d\'exécution, planifié, pointé, reste', () => {
    const l = lignesDetail({ agregats: AGREGATS, natures: [{ id: 11, code: 'MO', libelle: 'Pose', groupe: 'MO' }], colonnes: [...COLONNES_DETAIL, ...COLONNES_HEURES] });
    const v = l[0].valeurs;
    expect([v.h_budget, v.h_budget_execution, v.h_planifie, v.h_pointe, v.h_reste].map(String)).toEqual(['20', '24', '4', '12', '8']);
    const p = lignesDetail({ agregats: AGREGATS, natures: [], periode: true, colonnes: [...COLONNES_DETAIL, ...COLONNES_HEURES] })[0].valeurs;
    expect(p.h_pointe.toString()).toBe('3');
    expect(p.h_reste.toString()).toBe('8');
  });
});
