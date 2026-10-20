import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlerRappel, etatRappel, MESSAGES_RAPPEL, comparerRappels } from '../src/index.js';

// Jeu partagé avec ReglesRappel.cs (LogiBTP.Crm.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_rappels.json'), 'utf8'));

describe('rappels (jeu partagé avec le C#)', () => {
  for (const c of jeu.controles) it(`contrôle : ${c.nom}`, () => expect(controlerRappel(c.rappel, c.note)).toEqual(c.attendu));
  for (const c of jeu.etats) it(`état : ${c.nom}`, () => expect(etatRappel(c.rappel, c.note, c.seuils, new Date(c.maintenant))).toEqual(c.attendu));
  it('chaque code a un libellé', () => { for (const c of jeu.controles.flatMap((x) => x.attendu)) expect(MESSAGES_RAPPEL[c]).toBeTruthy(); });
  it('rouge, orange, vert puis la référence la plus proche', () => {
    const l = [{ couleur: 'VERT', reference: 'b' }, { couleur: 'ROUGE', reference: 'z' }, { couleur: 'ORANGE', reference: 'a' }, { couleur: 'VERT', reference: 'a' }];
    expect(l.sort(comparerRappels).map((x) => `${x.couleur}${x.reference}`)).toEqual(['ROUGEz', 'ORANGEa', 'VERTa', 'VERTb']);
  });
});
