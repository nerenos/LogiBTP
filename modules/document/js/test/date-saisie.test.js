import { describe, it, expect } from 'vitest';
import { lireDateSaisie } from '../ui/editeur-document.js';

// Date de livraison saisie dans la grille (lot 9, A24a).
describe('lecture d’une date saisie', () => {
  const ref = new Date(2026, 9, 26);
  it('accepte JJ/MM/AAAA, JJ/MM/AA, JJ/MM et ISO', () => {
    expect(lireDateSaisie('03/11/2026', ref)).toBe('2026-11-03');
    expect(lireDateSaisie('3.11.27', ref)).toBe('2027-11-03');
    expect(lireDateSaisie('15/12', ref)).toBe('2026-12-15');
    expect(lireDateSaisie('2027-1-5', ref)).toBe('2027-01-05');
  });
  it('vide = null, date impossible ou illisible = undefined', () => {
    expect(lireDateSaisie('  ', ref)).toBeNull();
    expect(lireDateSaisie('31/02/2027', ref)).toBeUndefined();
    expect(lireDateSaisie('demain', ref)).toBeUndefined();
  });
});
