import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { etatOrdre, etatsServices, controlerParcours, MESSAGES_EXECUTION } from '../src/index.js';

// Jeu partagé avec ReglesEtats.cs (LogiBTP.Execution.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_etats.json'), 'utf8'));
const etapes = (e) => (typeof e === 'string' ? jeu.parcours[e] : e ?? []);

describe('états (jeu partagé)', () => {
  for (const c of jeu.ordres) it(`ordre : ${c.nom}`, () => expect(etatOrdre(c.ordre)).toBe(c.attendu));
  for (const c of jeu.services) it(`services : ${c.nom}`, () => expect(etatsServices({ etapes: etapes(c.parcours), ordres: c.ordres, manuels: c.manuels })).toEqual(c.attendu));
  for (const c of jeu.controles) it(`parcours : ${c.nom}`, () => expect(controlerParcours(etapes(c.etapes))).toEqual(c.attendu));
  it('chaque code a un libellé', () => { for (const c of jeu.controles.flatMap((x) => x.attendu)) expect(MESSAGES_EXECUTION[c]).toBeTruthy(); });
});
