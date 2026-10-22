import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculerTache, MESSAGES_CALCUL, versMinutes, depuisMinutes, retirerAbsences } from '../src/index.js';

// Jeu partagé avec ReglesPlanning.cs (LogiBTP.Planning.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_calcul.json'), 'utf8'));
const plages = (p) => (typeof p === 'string' ? jeu.plages[p] : p ?? []).map(([d, f]) => [versMinutes(d), versMinutes(f)]);
const m = (s) => (s == null ? s : versMinutes(s));

describe('calcul des tâches (jeu partagé)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => {
      const r = calculerTache({
        mode: c.mode, debut: m(c.debut), fin: m(c.fin), heures: c.heures, nb_ressources: c.nb_ressources,
        ressources: (c.ressources ?? []).map((x) => ({ ...x, plages: plages(x.plages) })),
        absences: (c.absences ?? []).map((a) => ({ ...a, debut: m(a.debut), fin: m(a.fin) })),
        plages_defaut: plages(c.plages_defaut),
      });
      expect({ ...r, debut: undefined, fin: r.fin == null ? null : depuisMinutes(r.fin) }).toEqual({ ...c.attendu, debut: undefined });
      for (const e of r.erreurs) expect(MESSAGES_CALCUL[e]).toBeTruthy();
    });
  }
  it('retire les absences', () => {
    expect(retirerAbsences([[0, 100], [200, 300]], [{ debut: 50, fin: 250 }])).toEqual([[0, 50], [250, 300]]);
  });
});
