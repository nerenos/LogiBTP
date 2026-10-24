import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ventilerFactureRecue, MESSAGES_VENTILATION } from '../src/index.js';

// Jeu partagé avec ReglesVentilation.cs (LogiBTP.SousTraitance.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_ventilation.json'), 'utf8'));

describe('ventilation de la facture reçue (jeu partagé)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => {
      const r = ventilerFactureRecue({ lignes: c.lignes, periode: c.periode ?? null, cumul: c.cumul ?? null, precision: 2 });
      expect(r).toEqual(c.attendu);
      for (const e of r.erreurs) expect(MESSAGES_VENTILATION[e]).toBeTruthy();
    });
  }
});
