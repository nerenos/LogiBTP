import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlerSemaine, MESSAGES_POINTAGE, lireDuree, ecrireDuree, lundiDe, joursSemaine } from '../src/index.js';

// Jeu partagé avec ReglesPointage.cs (LogiBTP.Pointage.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_controles.json'), 'utf8'));

describe('contrôles (jeu partagé)', () => {
  for (const c of jeu.cas) it(c.nom, () => expect(controlerSemaine({ parametres: c.parametres, pointages: c.pointages })).toEqual(c.attendu));
  it('chaque code a un libellé', () => { for (const c of jeu.cas.flatMap((x) => x.attendu)) expect(MESSAGES_POINTAGE[c.code]).toBeTruthy(); });
});

describe('durées et semaines', () => {
  it('lit les durées', () => {
    expect(['7:30', '7h30', '7h', '7,5', '7.25', '', '8', 'x', '7:75'].map(lireDuree)).toEqual([450, 450, 420, 450, 435, 0, 480, null, null]);
  });
  it('écrit les durées', () => expect([450, 0, 65].map(ecrireDuree)).toEqual(['7:30', '', '1:05']));
  it('lundi et jours', () => {
    expect(lundiDe('2026-10-25')).toBe('2026-10-19');
    expect(lundiDe('2026-10-19')).toBe('2026-10-19');
    expect(joursSemaine('2026-10-26')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  });
});
