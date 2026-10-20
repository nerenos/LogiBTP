import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { etatPlan, indiceSuivant } from '../src/index.js';

// Jeu partagé avec ReglesValidation.cs (LogiBTP.Crm.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/04_validations.json'), 'utf8'));

describe('suivi des validations (jeu partagé avec le C#)', () => {
  for (const c of jeu.plans) it(`plan : ${c.nom}`, () => expect(etatPlan(c.plan, jeu.statuts, jeu.aujourdhui)).toEqual(c.attendu));
  for (const c of jeu.indices_suivants) it(`indice après ${c.indice}`, () => expect(indiceSuivant(c.indice)).toBe(c.attendu));
});
