import { describe, it, expect } from 'vitest';
import { pctDepuisCoef, coefDepuisPct } from '../ui/editeur-document.js';

// Remises affichées et saisies en coefficient ou en % (préférence de l'utilisateur) : le document garde le coefficient.
describe('remise en % ou en coefficient', () => {
  it('coefficient → %', () => {
    expect(pctDepuisCoef('0.95')).toBe('5');
    expect(pctDepuisCoef(0.7)).toBe('30');
    expect(pctDepuisCoef('0.875')).toBe('12.5');
    expect(pctDepuisCoef('1.1')).toBe('-10');
    expect(pctDepuisCoef(null)).toBeNull();
  });
  it('% → coefficient, sans perte (décimal exact)', () => {
    expect(coefDepuisPct('5')).toBe('0.95');
    expect(coefDepuisPct('30')).toBe('0.7');
    expect(coefDepuisPct('12.345')).toBe('0.87655');
    expect(coefDepuisPct('0')).toBe('1');
    expect(coefDepuisPct('')).toBeNull();
  });
});
