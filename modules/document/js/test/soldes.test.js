import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { etatSolde } from '../src/index.js';

// Jeu partagé avec Soldes.cs (LogiBTP.Documents.Tests).
const fichier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/soldes/01_reste_solde.json');

describe('solde des lignes transformées (jeu partagé avec le C#)', () => {
  for (const c of JSON.parse(fs.readFileSync(fichier, 'utf8')).cas) {
    it(c.nom, () => expect(etatSolde(c)).toEqual(c.attendu));
  }
});
