import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emetteurDuSens, emetteursStatut, motifsAutorises, statutTerminal, motifObligatoire, obligatoirePpf, controlerStatut,
  statutsPosables, statutAffiche, MOTIF_STATUT, STATUT_CDV,
} from '../src/index.js';

// Jeu partagé avec ReglesCycleVie.cs (LogiBTP.FactureElectronique.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_cycle_vie.json'), 'utf8'));

describe('cycle de vie des factures (jeu partagé avec le C#)', () => {
  for (const c of jeu.sens) it(`rôle du sens ${c.sens}`, () => expect(emetteurDuSens(c.sens)).toBe(c.attendu));
  for (const c of jeu.proprietes) {
    it(`propriétés du statut ${c.statut}`, () => expect({
      emetteurs: emetteursStatut(c.statut),
      terminal: statutTerminal(c.statut),
      motif_obligatoire: motifObligatoire(c.statut),
      obligatoire_ppf: obligatoirePpf(c.statut),
    }).toEqual(c.attendu));
  }
  for (const c of jeu.motifs) {
    it(`motifs du statut ${c.statut} (${c.emetteur ?? 'tout émetteur'}${c.b2g ? ', B2G' : ''})`, () =>
      expect(motifsAutorises(c.statut, { emetteur: c.emetteur, b2g: c.b2g })).toEqual(c.attendu));
  }
  for (const c of jeu.controles) it(`contrôle : ${c.nom}`, () => expect(controlerStatut(c.entree)).toEqual(c.attendu));
  for (const c of jeu.posables) it(`posables : ${c.nom}`, () => expect(statutsPosables(c.sens, c.historique)).toEqual(c.attendu));
  for (const c of jeu.affiches) it(`affiché : ${c.nom}`, () => expect(statutAffiche(c.historique)).toBe(c.attendu));
});

describe('couverture du jeu', () => {
  it('chaque statut a ses propriétés dans le jeu', () => {
    const vus = new Set(jeu.proprietes.map((c) => c.statut));
    for (const s of Object.values(STATUT_CDV)) expect(vus.has(s)).toBe(true);
  });
  it('chaque motif est autorisé pour au moins un statut', () => {
    const autorises = new Set(jeu.motifs.flatMap((c) => c.attendu));
    expect([...autorises].sort()).toEqual(Object.values(MOTIF_STATUT).sort());
  });
});
