import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { debutMinimum, controlerDependances, propagerDependances, MESSAGES_DEPENDANCES, versMinutes, depuisMinutes } from '../src/index.js';

// Jeu partagé avec ReglesDependances.cs (LogiBTP.Planning.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/03_dependances.json'), 'utf8'));
const tache = (t) => ({ ...t, debut: versMinutes(t.debut), fin: versMinutes(t.fin) });

describe('dépendances (jeu partagé)', () => {
  for (const c of jeu.minimums) {
    it(`minimum : ${c.nom}`, () => {
      const m = debutMinimum(c.dep, tache(c.de), jeu.jours_ouvres);
      expect(m == null ? null : depuisMinutes(m)).toBe(c.attendu);
    });
  }
  for (const c of jeu.controles) it(`contrôle : ${c.nom}`, () => expect(controlerDependances(c.deps)).toEqual(c.attendu));
  for (const c of jeu.propagations) {
    it(`propagation : ${c.nom}`, () => {
      const r = propagerDependances({ taches: c.taches.map(tache), deps: c.deps, jours_ouvres: jeu.jours_ouvres });
      expect({
        taches: r.taches.map((t) => ({ ...t, debut: depuisMinutes(t.debut), fin: depuisMinutes(t.fin) })),
        alertes: r.alertes.map((a) => (a.minimum == null ? a : { ...a, minimum: depuisMinutes(a.minimum) })),
      }).toEqual(c.attendu);
    });
  }
  it('chaque code a un libellé', () => {
    for (const c of [...jeu.controles.flatMap((x) => x.attendu), 'DEP_VIOLEE', 'LIEE_HORS']) expect(MESSAGES_DEPENDANCES[c]).toBeTruthy();
  });
});
