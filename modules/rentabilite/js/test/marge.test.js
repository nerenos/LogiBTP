import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { margeChantier } from '../src/index.js';
import { Dz } from '@logibtp/socle';

// Jeu partagé avec Marges.cs (LogiBTP.Rentabilite.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/03_marge_produit_interne.json'), 'utf8'));

describe('marge avec produit interne (jeu partagé)', () => {
  for (const c of jeu.marges) {
    it(c.nom, () => {
      const m = margeChantier({ lignes: c.lignes, produitInterne: c.produit_interne, pa: c.pa, pr: c.pr });
      const a = c.attendu;
      expect(m.produit.toString()).toBe(a.produit);
      expect(m.brute.toString()).toBe(a.brute);
      expect(m.nette.toString()).toBe(a.nette);
      expect(m.taux_brute === null ? null : m.taux_brute.toFixed(2)).toBe(a.taux_brute);
      expect(m.taux_nette === null ? null : m.taux_nette.toFixed(2)).toBe(a.taux_nette);
    });
  }
  it('total société inchangé : crédit du suivi = heures valorisées ailleurs', () => {
    const total = jeu.repartition.heures_valorisees.reduce((s, v) => s.plus(Dz(v)), Dz(0));
    expect(total.toString()).toBe(jeu.repartition.produit_interne_suivi);
  });
});
