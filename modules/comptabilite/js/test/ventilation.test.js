import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compteVentilation, MESSAGES_VENTILATION, ORIGINES_VENTILATION } from '../src/index.js';

// Jeu partagé avec ReglesVentilation.cs (LogiBTP.Comptabilite.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_ventilation.json'), 'utf8'));

describe('ventilation (jeu partagé)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => {
      const r = compteVentilation(c.entree, jeu.parametrage);
      expect(r).toEqual(c.attendu);
      if (r.erreur) expect(MESSAGES_VENTILATION[r.erreur]).toBeTruthy();
      if (r.origine) expect(ORIGINES_VENTILATION[r.origine]).toBeTruthy();
    });
  }
});
