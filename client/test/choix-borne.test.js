import { describe, it, expect } from 'vitest';
import { tuilesChoix, filtrerChoix, tuileExacte } from '../src/app/pointage/choix-borne.js';

// Choix du chantier ou de l'ordre à la borne (lot 10, A30) : filtre en direct sur plusieurs champs.
describe('borne : choix du chantier ou de l’ordre', () => {
  const tuiles = tuilesChoix(
    [{ id: 1, code: 'CH-001', libelle: 'École Jean Moulin', ville: 'Lyon', client: 'Ville de Lyon' },
      { id: 2, code: 'CH-002', libelle: 'Résidence Les Érables', ville: 'Villeurbanne', client: 'SCI Érables' }],
    [{ id: 10, cha_id: 2, numero: 'OE2026-00007', objet: 'Gros œuvre', type: "Ordre d'exécution" }],
  );

  it('chantiers puis ordres, ordre rattaché au code de son chantier', () => {
    expect(tuiles.map((t) => t.id)).toEqual([1, 2, 'o10']);
    expect(tuiles[2]).toMatchObject({ cha_id: 2, ent_id: 10, code: 'OE2026-00007', detail: "Ordre d'exécution · CH-002" });
  });

  it('filtre sur le code, le libellé, la ville et le client, sans accents, tous les mots', () => {
    expect(filtrerChoix(tuiles, 'ecole').map((t) => t.id)).toEqual([1]);
    expect(filtrerChoix(tuiles, 'erables').map((t) => t.id)).toEqual([2, 'o10']);
    expect(filtrerChoix(tuiles, 'villeurbanne gros').map((t) => t.id)).toEqual(['o10']);
    expect(filtrerChoix(tuiles, '  ').length).toBe(3);
  });

  it('code exact d’un chantier ou numéro d’un ordre', () => {
    expect(tuileExacte(tuiles, 'oe2026-00007')?.ent_id).toBe(10);
    expect(tuileExacte(tuiles, 'ch-001')?.cha_id).toBe(1);
    expect(tuileExacte(tuiles, 'CH-00')).toBeNull();
  });
});
