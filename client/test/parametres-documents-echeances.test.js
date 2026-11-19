import { describe, it, expect } from 'vitest';
import { lireEcheances, formaterEcheances } from '../src/app/pages/parametres-documents.js';

describe('échéances des conditions de paiement en texte', () => {
  it('lit et réécrit net, fin de mois, jour fixe et fin de mois le N', () => {
    const lignes = lireEcheances('30% 0j; 20% 30j FM; 20% 30j le 10; 30% 30j FM le 15 LCR');
    expect(lignes).toEqual([
      { pct: expect.anything(), delai: 0, base: 'NET' },
      { pct: expect.anything(), delai: 30, base: 'FIN_MOIS' },
      { pct: expect.anything(), delai: 30, base: 'JOUR', jour: 10 },
      { pct: expect.anything(), delai: 30, base: 'FIN_MOIS_JOUR', jour: 15, mode: 'LCR' },
    ]);
    expect(formaterEcheances(lignes)).toBe('30% 0j; 20% 30j FM; 20% 30j le 10; 30% 30j FM le 15 LCR');
    expect(lireEcheances('100% FM le 15')).toBeNull();
  });
});
