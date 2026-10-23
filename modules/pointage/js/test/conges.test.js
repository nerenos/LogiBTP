import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlerConge, joursConge, totalJours, controlerTraitement } from '../src/index.js';

// Jeu partagé avec ReglesConges.cs (LogiBTP.Pointage.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/04_conges.json'), 'utf8'));

describe('congés (jeu partagé)', () => {
  for (const c of jeu.controles) it(`contrôle : ${c.nom}`, () => expect(controlerConge({ etat: 'DEMANDE', ...c.conge }, c.autres)).toEqual(c.attendu));
  for (const c of jeu.jours) it(`jours : ${c.nom}`, () => {
    const jours = joursConge(c.conge, c.travailles);
    expect(jours).toEqual(c.attendu);
    expect(totalJours(jours)).toBe(c.total);
  });
  for (const c of jeu.traitements) it(`traitement : ${c.nom}`, () => expect(controlerTraitement(c.action, c.conge, c.nature)).toEqual(c.attendu));
});
