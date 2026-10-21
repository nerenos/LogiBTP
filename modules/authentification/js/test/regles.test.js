import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlerPseudo, controlerMotDePasse, etatCompte, controlerCompte, suggererPseudo, MESSAGES_AUTH } from '../src/index.js';

// Jeux partagés avec ReglesCompte.cs (LogiBTP.Authentification.Tests).
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const jeu = (f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));

describe('pseudo (jeu partagé)', () => {
  const j = jeu('01_pseudo.json');
  for (const c of j.cas) it(c.nom, () => expect(controlerPseudo(c.code, j.reserves)).toEqual(c.attendu));
});

describe('mot de passe (jeu partagé)', () => {
  const j = jeu('02_mot_de_passe.json');
  for (const c of j.cas) it(c.nom, () => expect(controlerMotDePasse(c.mdp, j.politique, c.pseudo)).toEqual(c.attendu));
});

describe('état du compte (jeu partagé)', () => {
  const j = jeu('03_etat_compte.json');
  for (const c of j.cas) it(c.nom, () => expect(etatCompte(c.compte, j.maintenant)).toEqual(c.attendu));
});

describe('compte saisi (jeu partagé)', () => {
  const j = jeu('04_compte.json');
  for (const c of j.cas) it(c.nom, () => expect(controlerCompte(c.saisie, c.personne, j.profils, j.aujourdhui)).toEqual(c.attendu));
});

describe('messages et suggestion', () => {
  it('chaque code a un libellé', () => {
    const codes = [...jeu('01_pseudo.json').cas, ...jeu('02_mot_de_passe.json').cas, ...jeu('04_compte.json').cas].flatMap((c) => c.attendu);
    for (const c of codes) expect(MESSAGES_AUTH[c]).toBeTruthy();
  });
  it('pseudo proposé sans accents', () => {
    expect(suggererPseudo('Jean-Pierre', 'Lefèvre')).toBe('j.lefevre');
    expect(suggererPseudo('Lœtitia', "D'Orléans")).toBe('l.dorleans');
    expect(suggererPseudo('', 'Müller')).toBe('muller');
    expect(controlerPseudo(suggererPseudo('Zoé', 'Garçon'))).toEqual([]);
  });
});
