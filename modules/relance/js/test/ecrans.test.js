import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { texte, existe, icone } from '@logibtp/socle/dictionnaire';
import { NATURE_RELANCE, MODE_RELANCE, ETAT_LOT_RELANCE, MOTIF_SUSPENSION, ERREUR_RELANCE } from '../src/index.js';

const dossier = new URL('../ui/', import.meta.url);
const sources = readdirSync(dossier).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(new URL(f, dossier), 'utf8')]);

describe('textes, icônes et conventions des écrans', () => {
  it('toute clé de texte statique existe dans le dictionnaire', () => {
    for (const [f, s] of sources) {
      for (const m of s.matchAll(/\b(?:texte|texteHtml)\('([a-z_.]+)'/g)) expect(existe(m[1]), `${f} : ${m[1]}`).toBe(true);
    }
  });
  it('toute icône utilisée existe', () => {
    for (const [f, s] of sources) {
      for (const m of s.matchAll(/iconeHtml\('([a-z_]+)'/g)) expect(icone(m[1]), `${f} : ${m[1]}`).not.toBe('');
    }
  });
  it('les textes composés par code existent pour chaque code', () => {
    for (const n of Object.values(NATURE_RELANCE)) expect(existe(`relance.natures.${n}`)).toBe(true);
    for (const m of Object.values(MODE_RELANCE)) expect(existe(`relance.modes.${m}`)).toBe(true);
    for (const e of Object.values(ETAT_LOT_RELANCE)) expect(existe(`relance.etats_lot.${e}`)).toBe(true);
    for (const m of Object.values(MOTIF_SUSPENSION)) expect(existe(`relance.motifs.${m}`)).toBe(true);
    for (const c of ['REGLE_SANS_NIVEAU', 'REGLE_TROP_DE_NIVEAUX', 'NIVEAU_RANG', 'NIVEAU_DELAI', 'NIVEAU_MODE', 'REGLE_INTERVALLE']) expect(existe(`relance.regle.erreurs.${ERREUR_RELANCE[c]}`)).toBe(true);
    for (const c of ['cible', 'motif', 'jusqu_au']) expect(existe(`relance.suspensions.manque.${c}`)).toBe(true);
    expect(texte('relance.niveau_n', { niveau: 2 })).toBe('Niveau 2');
  });
  it('aucune fenêtre, liste ou touche en dur', () => {
    for (const [f, s] of sources) {
      expect(s, f).not.toMatch(/\b(?:window\.)?(?:confirm|alert|prompt)\(/);
      expect(s, f).not.toMatch(/<select|createElement\('select'\)/);
      expect(s, f).not.toMatch(/e\.key\s*===/);
    }
  });
});
