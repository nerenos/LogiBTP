import { describe, it, expect } from 'vitest';
import { extraireNomPlan, analyserFormatPlan, FORMAT_PLAN_DEFAUT } from '../src/plans.js';

describe('nom des fichiers de plans', () => {
  it('format par défaut : repère, nom, indice', () => {
    expect(extraireNomPlan('R01_Plan de masse_B.pdf')).toEqual({ repere: 'R01', nom: 'Plan de masse', lot: '', indice: 'B' });
  });
  it('indice final facultatif : vide (le premier)', () => {
    expect(extraireNomPlan('R01_Plan de masse.pdf')).toEqual({ repere: 'R01', nom: 'Plan de masse', lot: '', indice: '' });
  });
  it('le nom garde ses séparateurs', () => {
    expect(extraireNomPlan('C:\\plans\\GO-12_Coupe_AA_C.dwg', FORMAT_PLAN_DEFAUT)).toEqual({ repere: 'GO-12', nom: 'Coupe_AA', lot: '', indice: 'C' });
  });
  it('format avec lot et partie ignorée, tirets', () => {
    expect(extraireNomPlan('CHA01 - GO - R12 - Façade nord_sud - ind B.pdf', '{*} - {lot} - {repere} - {nom} - ind {indice}'))
      .toEqual({ repere: 'R12', nom: 'Façade nord sud', lot: 'GO', indice: 'B' });
  });
  it('nom non conforme : null', () => {
    expect(extraireNomPlan('plan.pdf')).toBeNull();
  });
  it('formats invalides', () => {
    expect(analyserFormatPlan('{repere}{nom}').erreur).toMatch(/séparés/);
    expect(analyserFormatPlan('{x}_{nom}').erreur).toMatch(/inconnu/);
    expect(analyserFormatPlan('plan').erreur).toMatch(/au moins/);
  });
});
