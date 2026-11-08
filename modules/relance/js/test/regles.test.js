import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regleParDefaut, controlerRegle, niveauAtteint, relanceDue, relancesDues, regrouper } from '../src/index.js';

// Jeu partagé avec ReglesRelance.cs (LogiBTP.Relances.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_niveaux.json'), 'utf8'));
const regle = (r) => (typeof r === 'string' ? jeu.regles[r] : r);
const piece = (p) => ({ ...p, regle: p.regle ? regle(p.regle) : undefined });

describe('règle des niveaux et relances dues (jeu partagé avec le C#)', () => {
  for (const c of jeu.defauts) it(`défaut : ${c.nature}`, () => expect(regleParDefaut(c.nature)).toEqual(c.attendu));
  for (const c of jeu.controles) it(`contrôle : ${c.nom}`, () => expect(controlerRegle(regle(c.regle), c.nature)).toEqual(c.attendu));
  for (const c of jeu.niveaux) it(`niveau : ${c.nom}`, () => expect(niveauAtteint(regle(c.regle), c.depart, c.date)).toEqual(c.attendu));
  for (const c of jeu.dues) it(`due : ${c.nom}`, () => expect(relanceDue(regle(c.regle), piece(c.piece), c.date, c.seuil ?? 0)).toEqual(c.attendu));
  for (const c of jeu.groupes) {
    it(`groupes : ${c.nom}`, () => {
      const regles = Object.fromEntries(Object.entries(c.regles).map(([n, r]) => [n, regle(r)]));
      expect(regrouper(relancesDues(regles, c.pieces.map(piece), c.date))).toEqual(c.attendu);
    });
  }
});
