import { describe, it, expect } from 'vitest';
import { epaisseurTrait } from '../src/ui/signature.js';

describe('signature tracée', () => {
  it('épaisseur du trait : pression du stylet, sinon fixe', () => {
    expect(epaisseurTrait(0.5)).toBeCloseTo(2.5);
    expect(epaisseurTrait(0)).toBe(2.4);
    expect(epaisseurTrait(1)).toBe(2.4);
    expect(epaisseurTrait(undefined)).toBe(2.4);
  });
});
