import { describe, it, expect } from 'vitest';
import { TYPES_FICHE } from '../src/app/fiches/definitions.js';
import { decouperJetons } from '@logibtp/socle/ui';

describe('mots-clés de la fiche élément en jetons', () => {
  const champ = TYPES_FICHE.element.definition.champs.find((c) => c.colonne === 'ele_mots_cles');
  it('champ texte au format jetons, colonne ele_mots_cles inchangée', () => {
    expect(champ.type).toBe('texte');
    expect(champ.format).toBe('jetons');
  });
  it('« béton, coffrage » → deux jetons, réécrit « béton, coffrage »', () => {
    const jetons = decouperJetons('béton, coffrage');
    expect(jetons).toEqual(['béton', 'coffrage']);
    expect(jetons.join(', ')).toBe('béton, coffrage');
  });
});
