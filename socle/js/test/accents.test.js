import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { sansAccent, normaliser, ACCENTUEES, BASES } from '../src/calcul/index.js';

const jeu = JSON.parse(readFileSync(new URL('../../tests/sans_accent.json', import.meta.url), 'utf8'));

describe('sans accents (jeu partagé avec SansAccent.cs)', () => {
  for (const c of jeu.cas) it(c.nom, () => expect(sansAccent(c.texte)).toBe(c.attendu));

  it('table = décomposition NFD de chaque lettre', () => {
    const bases = [...BASES];
    [...ACCENTUEES].forEach((c, i) => expect(c.normalize('NFD').replace(/\p{M}/gu, '')).toBe(bases[i]));
  });

  it('recherche : table puis décomposition des autres écritures', () => {
    expect(normaliser("Cœur d'ÉTÉ")).toBe("coeur d'ete");
    expect(normaliser('Ǣ')).toBe('æ');
    expect(normaliser(null)).toBe('');
  });
});
