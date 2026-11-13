import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { echeanceProposition, etatProposition, controlerDecision } from '../src/index.js';

// Jeu partagé avec ReglesPropositions.cs (LogiBTP.Mcp.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_propositions.json'), 'utf8'));

describe('règles de la file des propositions (jeu partagé avec le C#)', () => {
  for (const c of jeu.echeances) it(`échéance : ${c.nom}`, () => expect(echeanceProposition(c.aujourdhui, c.jours)).toBe(c.attendu));
  for (const c of jeu.etats) it(`état : ${c.nom}`, () => expect(etatProposition(c.etat, c.echeance, c.aujourdhui)).toBe(c.attendu));
  for (const c of jeu.decisions) it(`décision : ${c.nom}`, () => expect(controlerDecision(c.proposition, c.decision, c.aujourdhui)).toEqual(c.attendu));
});
