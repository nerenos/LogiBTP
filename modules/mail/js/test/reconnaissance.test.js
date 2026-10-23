import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliser, contientMot, reconnaitre } from '../src/index.js';

// Jeu partagé avec ReconnaissanceMail.cs (LogiBTP.Mail.Tests).
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const jeu = JSON.parse(fs.readFileSync(path.join(dossier, '01_reconnaissance.json'), 'utf8'));

describe('reconnaissance (jeu partagé)', () => {
  for (const c of jeu.normalisation) it(`normaliser « ${c.texte} »`, () => expect(normaliser(c.texte)).toBe(c.attendu));
  for (const c of jeu.mots) it(`mot « ${c.mot} » dans « ${c.texte} »`, () => expect(contientMot(c.texte, c.mot)).toBe(c.attendu));
  for (const c of jeu.cas) it(c.nom, () => expect(reconnaitre(c.entree, jeu.regles, jeu.seuils)).toEqual(c.attendu));
});
