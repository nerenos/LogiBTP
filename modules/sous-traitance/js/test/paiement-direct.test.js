import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { montantPaiementDirect, delaiAcceptation, controlerAcceptation, MESSAGES_PAIEMENT_DIRECT, ETATS_PAIEMENT_DIRECT } from '../src/index.js';

// Jeu partagé avec ReglesPaiementDirect.cs (LogiBTP.SousTraitance.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/03_plafonds.json'), 'utf8'));

describe('paiement direct (jeu partagé)', () => {
  for (const c of jeu.montants) it(`montant ${c.ht}/${c.ttc}`, () => expect(montantPaiementDirect(c)).toBe(c.attendu));
  for (const c of jeu.delais) it(`délai ${c.recue_le}`, () => expect(delaiAcceptation(c.recue_le, c.aujourdhui)).toEqual(c.attendu));
  for (const c of jeu.acceptations) {
    it(c.nom, () => {
      const r = controlerAcceptation({ demande: c.demande, accepte: c.accepte, cumulPrecedent: c.cumul_precedent, montantAgree: c.montant_agree, motif: c.motif });
      expect(r).toEqual(c.attendu);
      expect(ETATS_PAIEMENT_DIRECT[r.etat]).toBeTruthy();
      for (const e of r.erreurs) expect(MESSAGES_PAIEMENT_DIRECT[e]).toBeTruthy();
    });
  }
});
