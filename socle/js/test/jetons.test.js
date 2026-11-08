import { describe, it, expect } from 'vitest';
import { decouperJetons, ajouterJetons, retirerJeton } from '../src/ui/jetons.js';
import * as socle from '../src/ui/index.js';

describe('jetons (P2)', () => {
  it('collage « a, b » → deux jetons ; vides et espaces ignorés', () => {
    expect(decouperJetons('a, b')).toEqual(['a', 'b']);
    expect(decouperJetons(' béton ,, coffrage ; acier\n')).toEqual(['béton', 'coffrage', 'acier']);
    expect(decouperJetons('')).toEqual([]);
  });
  it('ajout par Entrée (un mot) ou par virgule, valeur initiale conservée', () => {
    expect(ajouterJetons(['x'], 'béton')).toEqual(['x', 'béton']);
    expect(ajouterJetons(['x'], 'béton,')).toEqual(['x', 'béton']);
    expect(ajouterJetons([], 'a, b')).toEqual(['a', 'b']);
  });
  it('doublon ignoré', () => {
    expect(ajouterJetons(['a'], 'a, b, b')).toEqual(['a', 'b']);
  });
  it('retrait', () => {
    expect(retirerJeton(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('composant exporté par le socle', () => {
    expect(typeof socle.creerJetons).toBe('function');
  });
});
