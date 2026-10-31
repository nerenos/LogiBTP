import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dz } from '@logibtp/socle';
import {
  controlerFormule, coefficient, coefficientPiece, regulariser, lireTermes, ecrireTermes, ajouterMois, ERREUR_REVISION, MESSAGES_REVISION,
} from '../src/app/structure/revision.js';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/revision');
const j = JSON.parse(fs.readFileSync(path.join(dossier, '01_revision.json'), 'utf8'));
const egal = (a, b) => (a === null || b === null ? a === b : Dz(a).equals(Dz(b)));

describe('révision des prix (jeu 01_revision.json)', () => {
  it.each(j.formules.map((c) => [c.nom, c]))('formule : %s', (_, c) => {
    expect(controlerFormule(c.formule)).toEqual(c.attendu);
  });

  it.each(j.coefficients.map((c) => [c.nom, c]))('coefficient : %s', (_, c) => {
    const r = coefficient(c.formule, j.series, c.mois_zero, c.mois_index);
    expect(egal(r.coef, c.attendu.coef)).toBe(true);
    expect(r.provisoire).toBe(c.attendu.provisoire);
    expect(r.manquants).toEqual(c.attendu.manquants);
  });

  it.each(j.pieces.map((c) => [c.nom, c]))('pièce : %s', (_, c) => {
    const r = coefficientPiece(c.parametres, j.series, c.mois_piece);
    expect(egal(r.coef, c.attendu.coef)).toBe(true);
    expect(r.mois_index).toBe(c.attendu.mois_index);
  });

  it.each(j.regularisations.map((c) => [c.nom, c]))('régularisation : %s', (_, c) => {
    const r = regulariser(c.periodes, c.precision);
    expect(r.map((x) => x.id)).toEqual(c.attendu.map((x) => x.id));
    r.forEach((x, i) => {
      expect(egal(x.revision, c.attendu[i].revision)).toBe(true);
      expect(egal(x.a_facturer, c.attendu[i].a_facturer)).toBe(true);
    });
  });

  it('chaque erreur a son message', () => {
    for (const code of Object.values(ERREUR_REVISION)) expect(MESSAGES_REVISION[code]).toBeTruthy();
  });

  it('saisie des termes et mois', () => {
    expect(lireTermes('bt01 0,5 ; BT06: 0.35')).toEqual([{ index: 'BT01', poids: '0.5' }, { index: 'BT06', poids: '0.35' }]);
    expect(lireTermes('BT01')).toBeNull();
    expect(ecrireTermes([{ index: 'BT01', poids: '0.85' }])).toBe('BT01 0,85');
    expect(ajouterMois('2025-01', -3)).toBe('2024-10');
    expect(ajouterMois('2025-11-20', 2)).toBe('2026-01');
  });
});
