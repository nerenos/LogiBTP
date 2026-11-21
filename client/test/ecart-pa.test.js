import { describe, it, expect } from 'vitest';
import { ecartPa, SENS_ECART_PA } from '../src/app/bibliotheque/ecart-pa.js';

// Écart de PA d'une ligne avec la bibliothèque (lot 9) : comparaison dans l'unité de la ligne.
describe('écart de PA avec la bibliothèque', () => {
  const element = { type: 'ARTICLE', unite_stock: 'm2', unite_vente: 'u', unites: [{ unite: 'u', formule: '2.5' }], donnees: {} };
  const reference = { ele_id: 1, pa: 10, source: 'PA_EFFECTIF', compose: false, empreinte: 'h' };
  const ligne = (pa, unite = 'm2') => ({ lig_pa: pa, lig_unt_code: unite });

  it('aucun écart : pas d\'indicateur', () => {
    expect(ecartPa(ligne(10), element, reference)).toBeNull();
  });

  it('plus cher et moins cher, tout écart', () => {
    expect(ecartPa(ligne(10.5), element, reference)).toMatchObject({ sens: SENS_ECART_PA.PLUS_CHER, pa_bibliotheque: '10', ecart: '0.5', pa_stock: '10.5' });
    expect(ecartPa(ligne(9.99), element, reference)).toMatchObject({ sens: SENS_ECART_PA.MOINS_CHER, ecart: '-0.01' });
  });

  it('comparaison dans l\'unité de la ligne, PA ramené à l\'unité de stock', () => {
    // 1 u = 2,5 m2 : la bibliothèque vaut 25 / u ; la ligne à 30 / u vaut 12 / m2.
    expect(ecartPa(ligne(30, 'u'), element, reference)).toMatchObject({ sens: SENS_ECART_PA.PLUS_CHER, pa_bibliotheque: '25', ecart: '5', pa_stock: '12' });
    expect(ecartPa(ligne(25, 'u'), element, reference)).toBeNull();
  });

  it('sans conversion possible, élément composé ou PA absent : pas d\'indicateur', () => {
    expect(ecartPa(ligne(30, 'pal'), element, reference)).toBeNull();
    expect(ecartPa(ligne(30, null), element, reference)).toBeNull();
    expect(ecartPa(ligne(30), element, { ...reference, compose: true })).toBeNull();
    expect(ecartPa(ligne(30), element, { ...reference, pa: null })).toBeNull();
    expect(ecartPa(ligne(null), element, reference)).toBeNull();
    expect(ecartPa(ligne(30), null, reference)).toBeNull();
  });

  it('arrondi de conversion sous le seuil : pas d\'écart', () => {
    expect(ecartPa(ligne(10.00001), element, reference)).toBeNull();
  });
});
