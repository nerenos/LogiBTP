import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlerNote, MESSAGES_NOTE } from '../src/index.js';

// Jeu partagé avec ReglesNote.cs (LogiBTP.Crm.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_note.json'), 'utf8'));

describe('contrôle des notes (jeu partagé avec le C#)', () => {
  for (const c of jeu.notes) it(c.nom, () => expect(controlerNote(c.note)).toEqual(c.attendu));
  it('chaque code a un libellé', () => {
    for (const c of jeu.notes.flatMap((x) => x.attendu)) expect(MESSAGES_NOTE[c]).toBeTruthy();
  });
});
