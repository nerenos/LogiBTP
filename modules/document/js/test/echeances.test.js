import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculerEcheances } from '../src/index.js';

// Jeu partagé avec Echeances.cs (LogiBTP.Documents.Tests).
const fichier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/echeances/01_echeances.json');

describe('échéancier d\'une pièce (jeu partagé avec le C#)', () => {
  for (const c of JSON.parse(fs.readFileSync(fichier, 'utf8')).cas) {
    it(c.nom, () => expect(calculerEcheances(c)).toEqual(c.attendu));
  }
});
