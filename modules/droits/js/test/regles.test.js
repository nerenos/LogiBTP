import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionsEffectives, porteeAccordee, autorise, accesSousArbre, cocher, decocher, reappliquer, controlerProfil, controlerLignes,
  MESSAGES_DROITS, ancetres,
} from '../src/index.js';

// Jeu partagé avec ReglesDroits.cs (LogiBTP.Droits.Tests).
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const j = JSON.parse(fs.readFileSync(path.join(dossier, '01_droits.json'), 'utf8'));

describe('droits effectifs (jeu partagé)', () => {
  for (const c of j.effectifs) {
    it(c.nom, () => {
      const e = actionsEffectives(j.droits, c.noeud);
      expect(e.source).toBe(c.source);
      expect(e.actions).toEqual(c.actions);
    });
  }
  for (const c of j.portees) it(c.nom, () => expect(porteeAccordee(j.droits, c.noeud, c.action)).toBe(c.attendu));
  for (const c of j.autorisations) it(c.nom, () => expect(autorise(j.droits, c.noeud, c.action, c.minimum)).toBe(c.attendu));
  for (const c of j.sous_arbres) it(c.nom, () => expect(accesSousArbre(j.droits, c.noeud, c.ecriture)).toBe(c.attendu));
  for (const c of j.total) it(c.nom, () => expect(porteeAccordee({ total: true, lignes: {} }, c.noeud, c.action)).toBe(c.attendu));
});

describe('saisie des droits (jeu partagé)', () => {
  for (const c of j.cascade) it(c.nom, () => expect(cocher(c.actions, c.action, c.portee)).toEqual(c.attendu));
  for (const c of j.decocher) it(c.nom, () => expect(decocher(c.actions, c.action)).toEqual(c.attendu));
  for (const c of j.reappliquer) it(c.nom, () => expect(Object.keys(reappliquer(j.droits.lignes, c.noeud)).sort()).toEqual(c.attendu));
  for (const c of j.profils) it(c.nom, () => expect(controlerProfil(c.profil)).toEqual(c.attendu));
  for (const c of j.controles.cas) it(c.nom, () => expect(controlerLignes(c.lignes, j.controles.catalogue)).toEqual(c.attendu));
});

describe('divers', () => {
  it('chaque code a un message', () => {
    const codes = [...j.profils.flatMap((c) => c.attendu), ...j.controles.cas.flatMap((c) => c.attendu.map((e) => e.code))];
    for (const c of codes) expect(MESSAGES_DROITS[c]).toBeTruthy();
  });
  it('ancêtres', () => expect(ancetres('a/b/c')).toEqual(['a/b/c', 'a/b', 'a']));
});
