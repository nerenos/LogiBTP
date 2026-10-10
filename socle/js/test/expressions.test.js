import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluerExpression, ErreurCalcul, analyserReference, D } from '../src/calcul/index.js';

// Jeu partagé avec LogiBTP.Socle.Tests (xUnit).
const fichier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/expressions.json');
const jeu = JSON.parse(fs.readFileSync(fichier, 'utf8'));

const resoudre = (ref) => {
  const r = analyserReference(ref);
  const cle = r.genre === 'variable' ? r.portee + r.nom : r.colonne;
  if (!(cle in jeu.variables)) throw new ErreurCalcul('VARIABLE_INCONNUE', `Variable {{${ref}}} non définie`);
  return D(jeu.variables[cle]);
};

describe('Analyseur d\'expressions', () => {
  for (const c of jeu.cas) {
    it(`« ${c.formule} »`, () => {
      if (c.erreur) {
        let code = null;
        try { evaluerExpression(c.formule, resoudre); } catch (e) { code = e.code; }
        expect(code).toBe(c.erreur);
      } else {
        expect(evaluerExpression(c.formule, resoudre).toString()).toBe(D(c.resultat).toString());
      }
    });
  }
});
