import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classesLignes, stylesLignes, erreursStyle, erreursStylesDocument } from '../src/index.js';

// Jeu partagé avec StylesLignes.cs (LogiBTP.Documents.Tests).
const fichier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/styles/01_styles_lignes.json');
const jeu = JSON.parse(fs.readFileSync(fichier, 'utf8'));

describe('styles des lignes (jeu partagé avec le C#)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => {
      expect(Object.fromEntries([...classesLignes(c.lignes)].map(([k, v]) => [String(k), v]))).toEqual(c.attendu.classes);
      expect(Object.fromEntries([...stylesLignes(c.lignes, c.contexte)].map(([k, v]) => [String(k), v]))).toEqual(c.attendu.styles);
    });
  }
  for (const v of jeu.validations) {
    it(`validation : ${v.nom}`, () => expect(v.document ? erreursStylesDocument(v.document) : erreursStyle(v.style)).toEqual(v.attendu));
  }
});
