import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { montantPrevu, controlerFacturation, comparerFacturation, moisEntre } from '../src/index.js';

// Jeu partagé avec Facturation.cs (LogiBTP.Rentabilite.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_facturation.json'), 'utf8'));

describe('prévisionnel de facturation (jeu partagé)', () => {
  for (const c of jeu.montants) it(`montant : ${c.nom}`, () => expect(montantPrevu(c.mode, c.valeur, c.budget).toFixed(2)).toBe(c.attendu));
  for (const c of jeu.controles) {
    it(`contrôle : ${c.nom}`, () => expect(controlerFacturation(c.lignes, c.budget).map(({ index, code }) => ({ index, code }))).toEqual(c.attendu));
  }
});

describe('comparaison au facturé', () => {
  const r = comparerFacturation({
    courant: '2026-11-01',
    facture: [{ mois: '2026-09-01', pv: '1000' }, { mois: '2026-10-01', pv: '1500' }, { mois: '2026-10-01', pv: '-100' }],
    prevu: [{ mois: '2026-10-01', montant: '2000' }, { mois: '2026-11-01', montant: '3000' }, { mois: '2027-01-01', montant: '500' }],
    reference: [{ mois: '2026-10-01', montant: '1800' }],
  });
  const l = Object.fromEntries(r.lignes.map((x) => [x.mois, x]));
  it('mois affichés : du plus ancien connu à onze mois après le mois en cours', () => {
    expect(r.lignes[0].mois).toBe('2026-09-01');
    expect(r.lignes.at(-1).mois).toBe('2027-10-01');
    expect(moisEntre('2026-11-15', '2027-01-01')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
  it('facturé, prévu, écart et référence par mois', () => {
    expect(l['2026-10-01'].facture.toString()).toBe('1400');
    expect(l['2026-10-01'].ecart.toString()).toBe('-600');
    expect(l['2026-10-01'].reference.toString()).toBe('1800');
    expect(l['2026-09-01'].prevu).toBeNull();
    expect(l['2026-12-01'].ecart).toBeNull();
  });
  it('atterrissage : facturé des mois passés, prévu à partir du mois en cours', () => {
    expect(l['2026-11-01'].atterrissage.toString()).toBe('5400'); // 1000 + 1400 + 3000
    expect(r.total.atterrissage.toString()).toBe('5900');
    expect(r.total.facture.toString()).toBe('2400');
    expect(r.total.prevu.toString()).toBe('5500');
  });
});
