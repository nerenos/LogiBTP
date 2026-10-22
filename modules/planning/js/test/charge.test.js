import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculerCharge, versMinutes } from '../src/index.js';

// Jeu partagé avec ReglesCharge.cs (LogiBTP.Planning.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_charge.json'), 'utf8'));
const plages = (p) => (typeof p === 'string' ? jeu.plages[p] : p ?? []).map(([d, f]) => [versMinutes(d), versMinutes(f)]);

describe('charge (jeu partagé)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => {
      expect(calculerCharge({
        jours: c.jours,
        ressources: c.ressources.map((r) => ({ ...r, plages: plages(r.plages) })),
        absences: (c.absences ?? []).map((a) => ({ ...a, debut: versMinutes(a.debut), fin: versMinutes(a.fin) })),
        taches: c.taches.map((t) => ({ ...t, debut: versMinutes(t.debut), fin: versMinutes(t.fin), plages_service: plages(t.plages_service) })),
      })).toEqual(c.attendu);
    });
  }
});
