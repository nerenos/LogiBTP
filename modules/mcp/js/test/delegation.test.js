import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionsModele, gardesFousActifs, estInterdit, droitsEffectifs, controlerDelegation, echeanceDelegation,
  appliquerQuota, classerOutil,
} from '../src/index.js';

// Jeu partagé avec ReglesDelegation.cs (LogiBTP.Mcp.Tests).
const jeu = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas/01_delegation.json'), 'utf8'));
const profil = (p) => jeu.profils[p];
const options = (c) => ({ catalogue: jeu.catalogue, noeuds: jeu.noeuds, interdits: c.interdits ?? [] });

describe('règles de délégation (jeu partagé avec le C#)', () => {
  for (const c of jeu.modeles) it(`modèle : ${c.modele}`, () => expect(actionsModele(c.modele)).toEqual(c.attendu));
  for (const c of jeu.actifs) it(`garde-fous actifs : ${c.nom}`, () => expect(gardesFousActifs(c.levables, c.leves)).toEqual(c.attendu));
  for (const c of jeu.interdits) it(`interdit : ${c.nom}`, () => expect(estInterdit(c.noeud, c.action, c.interdits ?? [])).toBe(c.attendu));
  for (const c of jeu.effectifs) {
    it(`droits effectifs : ${c.nom}`, () => expect(droitsEffectifs(profil(c.profil), c.plafond, c.gardes_fous, options(c))).toEqual(c.attendu));
  }
  for (const c of jeu.controles) it(`contrôle : ${c.nom}`, () => expect(controlerDelegation(c.delegation, c.delegant)).toEqual(c.attendu));
  for (const c of jeu.echeances) it(`échéance : ${c.nom}`, () => expect(echeanceDelegation(c.debut, c.jours, c.jours_max ?? null)).toBe(c.attendu));
  for (const c of jeu.quotas) it(`quota : ${c.nom}`, () => expect(appliquerQuota(c.demandes, c.deja, c.quotas ?? {})).toEqual(c.attendu));
  for (const c of jeu.classements) {
    it(`classement : ${c.nom}`, () => expect(classerOutil(c.outil, profil(c.profil), c.plafond, c.gardes_fous, options(c))).toBe(c.attendu));
  }
});
