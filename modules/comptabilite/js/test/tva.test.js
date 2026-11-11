import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposerEn16931, CATEGORIES_EN16931 } from '../src/index.js';

// Jeu partagé avec ReglesTva.cs (LogiBTP.Comptabilite.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/05_tva_en16931.json'), 'utf8'));

describe('TVA EN 16931 (jeu partagé)', () => {
  for (const c of jeu.cas) it(c.nom, () => expect(proposerEn16931(c.comportement)).toEqual(c.attendu));
  it('les propositions sont des catégories admises', () => {
    for (const c of jeu.cas) if (c.attendu) expect(CATEGORIES_EN16931).toContain(c.attendu.categorie);
  });
});
