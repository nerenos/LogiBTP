import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conformite, ajouterMois, ETATS_PIECE } from '../src/index.js';

// Jeu partagé avec ReglesConformite.cs (LogiBTP.SousTraitance.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_conformite.json'), 'utf8'));

describe('conformité (jeu partagé)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => {
      const r = conformite({ exigences: jeu.exigences, pieces: c.pieces, ajustements: c.ajustements, contexte: c.contexte, aujourdhui: jeu.aujourdhui, portees: c.portees });
      expect(r.pieces.map((p) => ({ code: p.code, etat: p.etat, fin: p.fin, obligatoire: p.obligatoire, dge_id: p.dge_id }))).toEqual(c.attendu.pieces);
      expect(r.conforme).toBe(c.attendu.conforme);
      expect(r.a_echeance).toEqual(c.attendu.a_echeance);
      expect(r.bloquants).toEqual(c.attendu.bloquants);
      for (const p of r.pieces) expect(ETATS_PIECE[p.etat]).toBeTruthy();
    });
  }
  for (const m of jeu.mois) it(`mois : ${m.date} + ${m.mois}`, () => expect(ajouterMois(m.date, m.mois)).toBe(m.attendu));
});
