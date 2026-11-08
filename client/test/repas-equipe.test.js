import { describe, it, expect } from 'vitest';
import { membresRepas, corpsRepas } from '../src/app/pointage/repas.js';

// Repas dans la saisie d'équipe de la borne : le chef déclare un restaurant pour les membres cochés.
describe('borne : repas d’équipe', () => {
  const repas = { date: '2026-11-08', restaurant_id: 4 };
  it('équipe de trois, un décoché : deux repas envoyés', () => {
    const corps = corpsRepas({ jeton: 'j', repas, equipe: [1, 2, 3], decoches: [2] });
    expect(corps.membres).toEqual([1, 3]);
    expect(corps.repas).toBe(repas);
  });
  it('tous cochés par défaut, sans doublon', () => {
    expect(membresRepas([1, 2, 2, 3])).toEqual([1, 2, 3]);
  });
  it('saisie individuelle : pas de membres', () => {
    expect(corpsRepas({ jeton: 'j', repas })).toEqual({ jeton: 'j', repas });
  });
});
