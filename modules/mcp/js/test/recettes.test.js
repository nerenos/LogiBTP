import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parametresPrompt, controlerRecette, recettePermise, remplirPrompt } from '../src/index.js';

// Jeu partagé avec ReglesRecettes.cs (LogiBTP.Mcp.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/03_recettes.json'), 'utf8'));

describe('règles des recettes (jeu partagé avec le C#)', () => {
  for (const c of jeu.marques) it(`marques : ${c.nom}`, () => expect(parametresPrompt(c.prompt)).toEqual(c.attendu));
  for (const c of jeu.controles) it(`contrôle : ${c.nom}`, () => expect(controlerRecette(c.recette, jeu.catalogue)).toEqual(c.attendu));
  for (const c of jeu.permises) it(`permise : ${c.nom}`, () => expect(recettePermise(c.recette, c.permis)).toBe(c.attendu));
  for (const c of jeu.remplissages) it(`remplissage : ${c.nom}`, () => expect(remplirPrompt(c.recette, c.valeurs)).toEqual(c.attendu));
  it('valeur bornée à 500 caractères', () => {
    const { texte } = remplirPrompt({ prompt: '{t}', parametres: [{ nom: 't', type: 'TEXTE' }] }, { t: 'x'.repeat(600) });
    expect(texte).toHaveLength(500);
  });
});
