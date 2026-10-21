import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ajouterMois, etatHabilitation, habilitationsManquantes, controlerHabilitation, controlerMissions, missionEnCours, MESSAGES_RESSOURCES,
} from '../src/app/ressources/regles.js';

// Jeux partagés avec ReglesRessources.cs (tests/LogiBTP.Calcul.Tests/RessourcesTests.cs).
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/ressources');
const jeu = (f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));

describe('habilitations (jeu partagé)', () => {
  const j = jeu('01_habilitations.json');
  for (const c of j.mois) it(`mois : ${c.date} + ${c.n}`, () => expect(ajouterMois(c.date, c.n)).toBe(c.attendu));
  for (const c of j.etats) it(`état : ${c.nom}`, () => expect(etatHabilitation(c.h, j.types[c.h.code]?.duree_mois ?? null, c.date, c.seuil)).toEqual(c.attendu));
  for (const c of j.manquantes) it(`manquantes : ${c.nom}`, () => expect(habilitationsManquantes(c.exigees, c.habilitations, j.types, c.date)).toEqual(c.attendu));
  for (const c of j.controles) it(`contrôle : ${c.nom}`, () => expect(controlerHabilitation(c.h, j.types, c.element)).toEqual(c.attendu));
});

describe('missions (jeu partagé)', () => {
  const j = jeu('02_missions.json');
  for (const c of j.controles) it(`contrôle : ${c.nom}`, () => expect(controlerMissions(c.missions)).toEqual(c.attendu));
  for (const c of j.en_cours) it(`en cours : ${c.nom}`, () => expect(missionEnCours(c.missions, c.date)?.id ?? null).toBe(c.attendu));
  it('chaque code a un libellé', () => {
    const codes = [...jeu('01_habilitations.json').controles.flatMap((c) => c.attendu), ...j.controles.flatMap((c) => c.attendu.flatMap((x) => x.codes))];
    for (const c of codes) expect(MESSAGES_RESSOURCES[c]).toBeTruthy();
  });
});
