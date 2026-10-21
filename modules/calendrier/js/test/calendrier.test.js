import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  paques, datesRegle, joursFermes, controlerRegle, semaineDuCycle, journee, ajouterMinutesTravail, minutesTravail, prochainTravail,
  controlerCalendrier, MESSAGES_CALENDRIER, lirePlages, ecrirePlages, duree, jourSemaine,
} from '../src/index.js';

// Jeux partagés avec ReglesCalendrier.cs (LogiBTP.Calendrier.Tests).
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const jeu = (f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));

describe('jours fermés (jeu partagé)', () => {
  const j = jeu('01_feries.json');
  for (const c of j.paques) it(`Pâques ${c.annee}`, () => expect(paques(c.annee)).toBe(c.attendu));
  for (const c of j.regles) it(`règle : ${c.nom}`, () => expect(datesRegle(c.regle, c.annee)).toEqual(c.attendu));
  for (const c of j.fermes) it(`période : ${c.nom}`, () => expect(joursFermes(c.regles, c.du, c.au)).toEqual(c.attendu));
  for (const c of j.controles) it(`contrôle : ${c.nom}`, () => expect(controlerRegle(c.regle)).toEqual(c.attendu));
});

describe('temps de travail (jeu partagé)', () => {
  const j = jeu('02_travail.json');
  const cal = (c) => c.valeur ?? j.calendriers[c.calendrier];
  for (const c of j.semaines) it(`semaine : ${c.nom}`, () => expect(semaineDuCycle(cal(c), c.date)).toBe(c.attendu));
  for (const c of j.journees) it(`journée : ${c.nom}`, () => expect(journee(cal(c), j.fermes, c.date)).toEqual(c.attendu));
  for (const c of j.ajouts) {
    it(`ajout : ${c.nom}`, () => {
      if (c.erreur) expect(() => ajouterMinutesTravail(cal(c), j.fermes, c.debut, c.minutes)).toThrow(expect.objectContaining({ code: c.erreur }));
      else expect(ajouterMinutesTravail(cal(c), j.fermes, c.debut, c.minutes)).toBe(c.attendu);
    });
  }
  for (const c of j.durees) it(`durée : ${c.nom}`, () => expect(minutesTravail(cal(c), j.fermes, c.debut, c.fin)).toBe(c.attendu));
  for (const c of j.prochains) {
    it(`prochain : ${c.nom}`, () => {
      if (c.erreur) expect(() => prochainTravail(cal(c), j.fermes, c.instant)).toThrow(expect.objectContaining({ code: c.erreur }));
      else expect(prochainTravail(cal(c), j.fermes, c.instant)).toBe(c.attendu);
    });
  }
  for (const c of j.controles) it(`contrôle : ${c.nom}`, () => expect(controlerCalendrier(cal(c))).toEqual(c.attendu));
  it('chaque code a un libellé', () => {
    for (const c of [...j.controles.flatMap((x) => x.attendu), ...jeu('01_feries.json').controles.flatMap((x) => x.attendu), 'CALENDRIER_VIDE']) expect(MESSAGES_CALENDRIER[c]).toBeTruthy();
  });
});

describe('saisie des plages', () => {
  it('lit et écrit', () => {
    expect(lirePlages('8:00-12:00 13h30-17h')).toEqual([{ debut: 480, fin: 720 }, { debut: 810, fin: 1020 }]);
    expect(lirePlages('')).toEqual([]);
    expect(lirePlages('8-12 ; 13-17')).toEqual([{ debut: 480, fin: 720 }, { debut: 780, fin: 1020 }]);
    expect(lirePlages('matin')).toBeNull();
    expect(ecrirePlages([{ debut: 480, fin: 720 }, { debut: 810, fin: 1020 }])).toBe('8:00-12:00 13:30-17:00');
    expect(duree(450)).toBe('7 h 30');
    expect(duree(480)).toBe('8 h');
    expect(jourSemaine('2026-10-21')).toBe(3);
  });
});
