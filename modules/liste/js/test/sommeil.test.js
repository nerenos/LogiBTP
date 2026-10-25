import { describe, it, expect } from 'vitest';
import { filtresEffectifs, filtrer } from '../src/requete.js';

// Fiches en sommeil (colonne usage = S) : masquées par défaut d'une source qui porte l'état d'utilisation, montrées
// si la vue le demande (même règle que ConstructeurRequete.MasqueSommeil : usage différent de S, vide compris).
describe('fiches en sommeil', () => {
  const lignes = [{ id: 1, usage: 'A' }, { id: 2, usage: 'N' }, { id: 3, usage: 'S' }, { id: 4, usage: null }];
  const connues = new Set(['id', 'usage']);
  it('masquées par défaut, « ne plus utiliser » et vide gardés', () => {
    expect(filtrer(lignes, { filtres: filtresEffectifs({ filtres: [] }, connues) }, []).map((l) => l.id)).toEqual([1, 2, 4]);
  });
  it('montrées par l\'option de la vue', () => {
    expect(filtresEffectifs({ filtres: [], sommeil: true }, connues)).toEqual([]);
  });
  it('sans effet sur une source sans état d\'utilisation', () => {
    expect(filtresEffectifs({ filtres: [] }, new Set(['id']))).toEqual([]);
  });
});
