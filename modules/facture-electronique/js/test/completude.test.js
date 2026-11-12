import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  controlerCompletude, completudeBloquante, NIVEAU_COMPLETUDE, REGLE_COMPLETUDE, CADRES_NON_EMIS, TAUX_TVA_ADMIS,
} from '../src/index.js';

// Jeu partagé avec ReglesCompletude.Controler (C#) : contrôle de complétude d'une facture émise (lot 16).
const jeu = JSON.parse(fs.readFileSync(new URL('../../tests/cas/05_completude.json', import.meta.url), 'utf8'));

/** Applique les modifications d'un cas (chemin à points, index numérique ; null efface la valeur). */
function modifier(base, modifications) {
  const f = structuredClone(base);
  for (const [chemin, valeur] of Object.entries(modifications ?? {})) {
    const cles = chemin.split('.');
    let o = f;
    for (const [i, c] of cles.slice(0, -1).entries()) {
      if (o[c] === undefined || o[c] === null) o[c] = /^\d+$/.test(cles[i + 1]) ? [] : {};
      o = o[c];
    }
    o[cles.at(-1)] = valeur;
  }
  return f;
}

describe('complétude d’une facture émise', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => expect(controlerCompletude(modifier(jeu.base, c.modifications), { bloquant: c.bloquant ?? true })).toEqual(c.attendu));
  }
  it('chaque règle du jeu est un code', () => {
    const regles = Object.values(REGLE_COMPLETUDE);
    for (const c of jeu.cas) for (const e of c.attendu) expect(regles).toContain(e.regle);
  });
  it('bloquante si un écart est bloquant', () => {
    expect(completudeBloquante([])).toBe(false);
    expect(completudeBloquante([{ niveau: NIVEAU_COMPLETUDE.AVERTISSEMENT }])).toBe(false);
    expect(completudeBloquante([{ niveau: NIVEAU_COMPLETUDE.BLOQUANT }])).toBe(true);
  });
  it('facture vide : écarts sans exception', () => expect(completudeBloquante(controlerCompletude())).toBe(true));
  it('montants en nombres acceptés', () => {
    const f = modifier(jeu.base, { 'totaux.totalHt': 1255, 'lignes.0.prixNet': 25.5 });
    expect(controlerCompletude(f)).toEqual([]);
  });
  it('listes figées', () => {
    expect(Object.isFrozen(CADRES_NON_EMIS)).toBe(true);
    expect(Object.isFrozen(TAUX_TVA_ADMIS)).toBe(true);
  });
});
