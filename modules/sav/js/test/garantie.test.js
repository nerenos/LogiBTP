import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { numeroSerie, finGarantie, etatGarantie, controlerEquipement, MESSAGES_EQUIPEMENT } from '../src/index.js';

// Jeu partagé avec ReglesGarantie.cs (LogiBTP.Sav.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_garantie.json'), 'utf8'));

describe('numéro de série (jeu partagé)', () => {
  for (const c of jeu.numeros) it(c.nom, () => expect(numeroSerie(c.numero)).toBe(c.attendu));
});

describe('fin de garantie (jeu partagé)', () => {
  for (const c of jeu.fins) it(c.nom, () => expect(finGarantie(c)).toBe(c.attendu));
});

describe('état de la garantie (jeu partagé)', () => {
  for (const c of jeu.etats) it(c.nom, () => expect(etatGarantie(c, c.date)).toEqual(c.attendu));
});

describe("contrôle d'un équipement (jeu partagé)", () => {
  for (const c of jeu.controles) {
    it(c.nom, () => {
      const r = controlerEquipement(c.equipement, c.aujourdhui);
      expect(r).toEqual(c.attendu);
      for (const code of r) expect(MESSAGES_EQUIPEMENT[code]).toBeTruthy();
    });
  }
});
