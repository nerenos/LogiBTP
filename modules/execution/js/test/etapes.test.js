import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datesPrevues, etapesAValider, controlerAnnulation, etatExecution, etapeEnCours, controlerEtapes, MESSAGES_ETAPES } from '../src/index.js';

// Jeu partagé avec ReglesEtapes.cs (LogiBTP.Execution.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/02_etapes.json'), 'utf8'));
const liste = (valides, controles = []) => jeu.liste.map((e) => ({
  ...e, valide_le: valides.includes(e.code) ? '2026-11-02' : null, controle_le: controles.includes(e.code) ? '2026-11-02' : null,
}));

describe('étapes (jeu partagé)', () => {
  for (const c of jeu.dates) it(`dates : ${c.nom}`, () => expect(datesPrevues({ etapes: c.etapes, debut: c.debut, calendrier: c.calendrier })).toEqual(c.attendu));
  for (const c of jeu.validations) {
    it(`validation : ${c.nom}`, () => {
      const r = etapesAValider(liste(c.valides, c.controles), c.code);
      expect({ codes: r.codes, erreurs: r.erreurs, avertissements: r.avertissements }).toEqual(c.attendu);
    });
  }
  for (const c of jeu.annulations) it(`annulation : ${c.nom}`, () => expect(controlerAnnulation(liste(c.valides), c.code)).toEqual(c.attendu));
  for (const c of jeu.etats) {
    it(`état : ${c.nom}`, () => {
      expect(etatExecution(liste(c.valides), c.actuel)).toBe(c.attendu);
      expect(etapeEnCours(liste(c.valides))).toBe(c.en_cours);
    });
  }
  it('état sans étape', () => expect(etatExecution([], jeu.etat_sans_etape.actuel)).toBe(jeu.etat_sans_etape.attendu));
  for (const c of jeu.controles) it(`contrôle : ${c.nom}`, () => expect(controlerEtapes(c.etapes)).toEqual(c.attendu));
  it('chaque code a un libellé', () => {
    const codes = [...jeu.validations.flatMap((c) => [...c.attendu.erreurs, ...c.attendu.avertissements]), ...jeu.annulations.flatMap((c) => c.attendu), ...jeu.controles.flatMap((c) => c.attendu)];
    for (const c of codes) expect(MESSAGES_ETAPES[c]).toBeTruthy();
  });
});
