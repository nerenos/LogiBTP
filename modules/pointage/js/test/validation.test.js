import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { etatValidation, controlerAction, exceptionsSemaine, MESSAGES_VALIDATION } from '../src/index.js';

// Jeu partagé avec ReglesValidation.cs (LogiBTP.Pointage.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_validation.json'), 'utf8'));

describe('validation (jeu partagé)', () => {
  for (const c of jeu.etats) it(`état : ${c.nom}`, () => expect(etatValidation(c)).toBe(c.attendu));
  for (const c of jeu.actions) it(`action : ${c.nom}`, () => expect(controlerAction(c)).toEqual(c.attendu));
  for (const c of jeu.exceptions) it(`exceptions : ${c.nom}`, () => expect(exceptionsSemaine(c)).toEqual(c.attendu));
  it('chaque code a un libellé', () => {
    for (const c of [...jeu.actions, ...jeu.exceptions].flatMap((x) => x.attendu)) expect(MESSAGES_VALIDATION[c]).toBeTruthy();
  });
});
