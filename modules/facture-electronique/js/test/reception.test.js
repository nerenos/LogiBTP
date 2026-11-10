import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { estFichierFacture, EXTENSIONS_FACTURE, TYPES_MIME_FACTURE } from '../src/index.js';

// Jeu partagé avec ReglesReception.EstFichierFacture (C#) : fichier proposé comme facture reçue hors plateforme (lot 14).
const jeu = JSON.parse(fs.readFileSync(new URL('../../tests/cas/03_fichiers_facture.json', import.meta.url), 'utf8'));

describe('fichier de facture reçue hors plateforme', () => {
  for (const c of jeu.cas) it(c.nom, () => expect(estFichierFacture(c.fichier, c.type)).toBe(c.attendu));
  it('listes figées', () => {
    expect(Object.isFrozen(EXTENSIONS_FACTURE)).toBe(true);
    expect(Object.isFrozen(TYPES_MIME_FACTURE)).toBe(true);
  });
});
