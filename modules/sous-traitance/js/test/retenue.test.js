import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liberationRetenue, MESSAGES_RETENUE } from '../src/index.js';

// Jeu partagé avec ReglesRetenue.cs (LogiBTP.SousTraitance.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/04_retenue.json'), 'utf8'));

describe('libération de la retenue (jeu partagé)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => {
      const r = liberationRetenue({ reception: c.reception, reserves: c.reserves, leveesLe: c.levees_le }, c.aujourdhui);
      expect(r).toEqual(c.attendu);
      if (r.motif) expect(MESSAGES_RETENUE[r.motif]).toBeTruthy();
    });
  }
});
