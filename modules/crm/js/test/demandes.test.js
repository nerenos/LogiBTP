import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlerDemande, MESSAGES_DEMANDE } from '../src/index.js';

// Jeu partagé avec ReglesDemande.cs (LogiBTP.Crm.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/03_demandes.json'), 'utf8'));

describe('contrôle des demandes (jeu partagé avec le C#)', () => {
  for (const c of jeu.demandes) it(c.nom, () => expect(controlerDemande(c.demande)).toEqual(c.attendu));
  it('chaque code a un libellé', () => { for (const c of jeu.demandes.flatMap((x) => x.attendu)) expect(MESSAGES_DEMANDE[c]).toBeTruthy(); });
});
