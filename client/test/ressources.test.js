import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ajouterMois, etatHabilitation, habilitationsManquantes, controlerHabilitation, controlerMissions, missionEnCours, MESSAGES_RESSOURCES,
} from '../src/app/ressources/regles.js';
import { finsPeriodes, periodesDepuisLignes, lignesDepuisPeriodes, controlerEquipe, MESSAGES_EQUIPES } from '../src/app/ressources/equipes.js';
import { controlerAffectations, affectationA } from '../src/app/ressources/affectations.js';
import { controlerReleves, compteurA, cumuls, controlerEvenement, MESSAGES_COMPTEURS } from '../src/app/ressources/compteurs.js';
import { plansEffectifs, cumulA, moyenneUsage, echeanceEntretien } from '../src/app/ressources/entretiens.js';

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

describe('équipes (jeu partagé)', () => {
  const j = jeu('03_equipes.json');
  for (const c of j.fins) it(`fins : ${c.nom}`, () => expect(finsPeriodes(c.periodes).map(({ du, au }) => ({ du, au }))).toEqual(c.attendu));
  for (const c of j.periodes) it(`compositions : ${c.nom}`, () => expect(periodesDepuisLignes(c.lignes, c.debuts)).toEqual(c.attendu));
  for (const c of j.lignes) it(`lignes : ${c.nom}`, () => expect(lignesDepuisPeriodes(c.periodes)).toEqual(c.attendu));
  for (const c of j.periodes) it(`aller-retour : ${c.nom}`, () => expect(lignesDepuisPeriodes(periodesDepuisLignes(c.lignes, c.debuts))).toEqual(lignesDepuisPeriodes(c.attendu)));
  for (const c of j.controles) it(`contrôle : ${c.nom}`, () => expect(controlerEquipe(c.equipe)).toEqual(c.attendu));
  it('chaque code a un libellé', () => { for (const c of j.controles.flatMap((x) => x.attendu)) expect(MESSAGES_EQUIPES[c.code]).toBeTruthy(); });
});

describe('affectations du matériel (jeu partagé)', () => {
  const j = jeu('04_affectations.json');
  for (const c of j.controles) it(`contrôle : ${c.nom}`, () => expect(controlerAffectations(c.materiel, c.affectations, { identifie: c.identifie ?? false })).toEqual(c.attendu));
  for (const c of j.a_date) {
    for (const [date, attendu] of Object.entries(c.dates)) it(`${c.nom} : ${date}`, () => expect(affectationA(c.affectations, date)).toBe(attendu));
  }
});

describe('compteurs et événements du matériel (jeu partagé)', () => {
  const j = jeu('05_compteurs.json');
  for (const c of j.controles) it(`relevés : ${c.nom}`, () => expect(controlerReleves(c.unites, c.releves)).toEqual(c.attendu));
  for (const c of j.a_date) {
    for (const [date, attendu] of Object.entries(c.dates)) it(`${c.nom} : ${date}`, () => expect(compteurA(c.releves, c.unite, date)).toBe(attendu));
  }
  for (const c of j.cumuls) it(`cumuls : ${c.nom}`, () => expect(cumuls(c.releves, c.unite)).toEqual(c.attendu));
  for (const c of j.evenements) it(`événement : ${c.nom}`, () => expect(controlerEvenement(c.evenement)).toEqual(c.attendu));
  it('messages de tous les codes', () => {
    const codes = [...j.controles.flatMap((c) => c.attendu.map((e) => e.code)), ...j.evenements.flatMap((c) => c.attendu)];
    for (const code of codes) expect(MESSAGES_COMPTEURS[code]).toBeTruthy();
  });
});

describe("plans et échéances d'entretien (jeu partagé)", () => {
  const j = jeu('06_entretiens.json');
  for (const c of j.plans) it(`plans : ${c.nom}`, () => expect(plansEffectifs(c.listes).map((p) => ({ code: p.code, heures: p.heures ?? null }))).toEqual(c.attendu));
  for (const [date, attendu] of Object.entries(j.cumuls)) it(`cumul au ${date}`, () => expect(cumulA(j.releves, 'H', date)).toBe(attendu));
  for (const c of j.moyennes) it(`usage moyen au ${c.date}`, () => expect(moyenneUsage(j.releves, 'H', c.date, c.jours)).toBe(c.attendu));
  for (const c of j.echeances) it(`échéance : ${c.nom}`, () => expect(echeanceEntretien({ plan: c.plan, reference: c.reference, courant: c.courant, moyennes: c.moyennes })).toEqual(c.attendu));
});
