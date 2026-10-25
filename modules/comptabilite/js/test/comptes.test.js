import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliserCompte, normaliserCompteTiers, proposerCompteTiers, classeCompte, MESSAGES_COMPTES } from '../src/index.js';

// Jeu partagé avec ReglesComptes.cs (LogiBTP.Comptabilite.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_comptes.json'), 'utf8'));

const avecMessage = (r) => { if (r.erreur) expect(MESSAGES_COMPTES[r.erreur]).toBeTruthy(); return r; };

describe('comptes généraux (jeu partagé)', () => {
  for (const c of jeu.generaux) {
    it(c.nom, () => expect(avecMessage(normaliserCompte(c.code, { longueur: c.longueur, completerZeros: c.completer }))).toEqual(c.attendu));
  }
});

describe('comptes de tiers (jeu partagé)', () => {
  for (const c of jeu.tiers) {
    it(c.nom, () => expect(avecMessage(normaliserCompteTiers(c.code, { longueur: c.longueur }))).toEqual(c.attendu));
  }
});

describe('comptes de tiers proposés (jeu partagé)', () => {
  for (const c of jeu.propositions) {
    it(c.nom, () => expect(avecMessage(proposerCompteTiers(c.prefixe, c.code_tiers, { longueur: c.longueur }))).toEqual(c.attendu));
  }
});

describe('classe (jeu partagé)', () => {
  for (const c of jeu.classes) it(String(c.code), () => expect(classeCompte(c.code)).toBe(c.attendu));
});
