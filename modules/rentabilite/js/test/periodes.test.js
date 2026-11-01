import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lirePeriode, controlerPeriode, raccourciPeriode } from '../src/index.js';

// Jeu partagé avec Periodes.cs (LogiBTP.Rentabilite.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_periodes.json'), 'utf8'));

describe('périodes (jeu partagé)', () => {
  for (const c of jeu.lectures) it(`lecture : ${c.nom}`, () => expect(lirePeriode(c.texte, c.borne, jeu.reference)).toEqual(c.attendu));
  for (const c of jeu.controles) it(`contrôle : ${c.nom}`, () => expect(controlerPeriode(c.du, c.au)).toBe(c.attendu));
  for (const c of jeu.raccourcis) it(`raccourci : ${c.code}`, () => expect(raccourciPeriode(c.code, jeu.reference)).toEqual(c.attendu));
});
