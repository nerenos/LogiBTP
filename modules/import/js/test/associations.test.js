import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { associerUnite, associerTaux, associerOption } from '../src/index.js';

// Jeu partagé avec Associations.cs (AssociationsTests) : rapprochement des référentiels de la reprise.
const jeu = JSON.parse(readFileSync(new URL('./associations-cas.json', import.meta.url), 'utf8'));

describe('reprise : rapprochement des référentiels (plan reprise-mde-optim, lot 4)', () => {
  for (const c of jeu.cas_unites) it(`unité « ${c.valeur} »`, () => expect(associerUnite(c.valeur, jeu.unites)).toBe(c.attendu));
  for (const c of jeu.cas_taux) it(`taux ${c.pourcentage}`, () => expect(associerTaux(c.pourcentage, jeu.taux)).toBe(c.attendu));
  for (const c of jeu.cas_options) {
    it(`option ${c.code}`, () => expect(associerOption({ code: c.code, libelle: c.libelle }, jeu.options)).toBe(c.attendu));
  }
});
