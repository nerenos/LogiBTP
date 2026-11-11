import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { estFichierFacture, EXTENSIONS_FACTURE, TYPES_MIME_FACTURE, controlerSousTraitance, ECART_RECEPTION, CODE_EXONERATION } from '../src/index.js';

// Jeu partagé avec ReglesReception.EstFichierFacture (C#) : fichier proposé comme facture reçue hors plateforme (lot 14).
const jeu = JSON.parse(fs.readFileSync(new URL('../../tests/cas/03_fichiers_facture.json', import.meta.url), 'utf8'));

describe('fichier de facture reçue hors plateforme', () => {
  for (const c of jeu.cas) it(c.nom, () => expect(estFichierFacture(c.fichier, c.type)).toBe(c.attendu));
  it('listes figées', () => {
    expect(Object.isFrozen(EXTENSIONS_FACTURE)).toBe(true);
    expect(Object.isFrozen(TYPES_MIME_FACTURE)).toBe(true);
  });
});

// Jeu partagé avec ReglesReception.ControlerSousTraitance (C#) : facture de sous-traitance reçue (lot 15).
const sousTraitance = JSON.parse(fs.readFileSync(new URL('../../tests/cas/04_sous_traitance.json', import.meta.url), 'utf8'));

describe('facture de sous-traitance reçue', () => {
  for (const c of sousTraitance.cas) {
    it(c.nom, () => expect(controlerSousTraitance({ cadre: c.cadre, payeur: c.payeur, tva: c.tva, autoliquidation: c.autoliquidation }))
      .toEqual({ paiementDirect: c.paiement_direct, ecarts: c.ecarts }));
  }
  it('sans argument : rien à signaler', () => expect(controlerSousTraitance()).toEqual({ paiementDirect: false, ecarts: [] }));
  it('codes figés', () => {
    expect(Object.isFrozen(ECART_RECEPTION)).toBe(true);
    expect(CODE_EXONERATION.AUTOLIQUIDATION).toBe('VATEX-FR-AE');
  });
});
