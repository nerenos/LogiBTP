import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculerVariables, controlerProfil, MESSAGES_PAIE, quantiteExport } from '../src/index.js';

// Jeu partagé avec ReglesPaie.cs (LogiBTP.Pointage.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/03_paie.json'), 'utf8'));
const profil = (c) => (c.profil ? jeu.profils[c.profil] : { rubriques: c.rubriques, regles: c.regles });

describe('variables de paie (jeu partagé)', () => {
  for (const c of jeu.calculs) {
    it(c.nom, () => expect(calculerVariables({ ...profil(c), jours: c.jours, semaine_complete: c.semaine_complete ?? true, agence: c.agence ?? null })).toEqual(c.attendu));
  }
  for (const c of jeu.controles) it(`profil : ${c.nom}`, () => expect(controlerProfil(profil(c))).toEqual(c.attendu));
  it('chaque code a un libellé', () => { for (const c of jeu.controles.flatMap((x) => x.attendu)) expect(MESSAGES_PAIE[c]).toBeTruthy(); });
  it('quantités exportées', () => expect([quantiteExport('H', 450), quantiteExport('H', 100), quantiteExport('NB', 3)]).toEqual([7.5, 1.67, 3]));
});
