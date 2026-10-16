import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { etatEcheance, etatPiece, nonPointe, proposerPointage } from '../src/index.js';

// Jeu partagé avec ResteAPayer.cs (LogiBTP.Reglements.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_reste.json'), 'utf8'));

describe('reste à payer et pointage (jeu partagé avec le C#)', () => {
  for (const c of jeu.echeances) it(`échéance : ${c.nom}`, () => expect(etatEcheance(c, c.seuil)).toEqual(c.attendu));
  for (const c of jeu.pieces) it(`pièce : ${c.nom}`, () => expect(etatPiece(c.echeances, c.seuil)).toEqual(c.attendu));
  for (const c of jeu.non_pointes) it(`règlement : ${c.nom}`, () => expect(nonPointe(c.montant, c.pointages)).toEqual(c.attendu));
  for (const c of jeu.propositions) it(`pointage : ${c.nom}`, () => expect(proposerPointage(c.disponible, c.echeances)).toEqual(c.attendu));
});
