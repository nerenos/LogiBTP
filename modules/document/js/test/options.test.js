import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unitesOptionnelles } from '../src/index.js';

// Jeu partagé avec Options.cs (LogiBTP.Documents.Tests).
const fichier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/options/01_unites.json');

describe('unités d\'options et de variantes (jeu partagé avec le C#)', () => {
  for (const c of JSON.parse(fs.readFileSync(fichier, 'utf8')).cas) {
    it(c.nom, () => expect(unitesOptionnelles(c.lignes)).toEqual(c.attendu));
  }
});
