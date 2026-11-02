import { describe, it, expect } from 'vitest';
import { seriesEvolution, echelle, INDICATEUR as I, COMPOSANTE as C } from '../src/index.js';

const A = (indicateur, composante, pa, pr, pv) => ({ ordre_id: null, nat_id: 11, indicateur, composante, pa, pr, pv, heures: null, nb: 1, pa_periode: 0, pr_periode: 0, pv_periode: 0, heures_periode: null });

describe('évolution d\'un chantier', () => {
  const points = [
    { date: '2026-09-30', agregats: [A(I.BUDGET, C.VENTE, 600, 660, 1000), A(I.BUDGET_EXECUTION, C.VENTE, 700, 770, 1000), A(I.DEBOURSE, C.MO, 100, 110, 0)] },
    { date: '2026-11-02', agregats: [A(I.BUDGET, C.VENTE, 600, 660, 1000), A(I.BUDGET_EXECUTION, C.VENTE, 700, 770, 1000), A(I.DEBOURSE, C.MO, 900, 990, 0),
      A(I.FACTURE, C.VENTE, 0, 0, 400), A(I.PREVU_DEBOURSE, C.ACHAT, 50, 50, 0)] },
  ];
  it('séries du bloc de résultats et des colonnes, au PR', () => {
    const { series: s, dates } = seriesEvolution(points);
    expect(dates).toEqual(['2026-09-30', '2026-11-02']);
    expect(s.budget.map(String)).toEqual(['1000', '1000']);
    expect(s.facture.map(String)).toEqual(['0', '400']);
    expect(s.depense.map(String)).toEqual(['110', '990']);
    // Terminaison : dépensé + dépense prévue + reste du budget d'exécution s'il en reste (770 − 1040 < 0 → 1040).
    expect(s.terminaison.map(String)).toEqual(['770', '1040']);
    expect(s.marge.map(String)).toEqual(['230', '-40']);
    expect(s.taux[1].toString()).toBe('-4');
  });
  it('au PA : marge brute', () => {
    const { series: s } = seriesEvolution(points, 'PA');
    expect(s.terminaison.map(String)).toEqual(['700', '950']);
    expect(s.marge.map(String)).toEqual(['300', '50']);
  });
  it('échelle : zéro compris, pas « joli »', () => {
    const e = echelle([1040, 230, -40].map(String));
    // Étendue 1 080 sur 4 intervalles = 270 → pas de 500 (premier pas « joli » au-dessus).
    expect(e.pas.toString()).toBe('500');
    expect(e.graduations.map(String)).toEqual(['-500', '0', '500', '1000', '1500']);
    expect(echelle([]).max.toString()).toBe('1');
  });
});
