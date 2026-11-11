import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parametresEmission } from '../src/calcul/emission-fe.js';

// Jeu partagé avec src/LogiBTP.Calcul/EmissionFeBtp.cs (tests/LogiBTP.Calcul.Tests/EmissionFeTests.cs).
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/emission-fe');
const j = JSON.parse(fs.readFileSync(path.join(dossier, '01_emission.json'), 'utf8'));

describe('paramètres d\'émission BTP (jeu 01_emission.json)', () => {
  it.each(j.cas.map((c) => [c.nom, c]))('%s', (_, c) => {
    const entree = { natures_fe: j.natures_fe, mentions: j.mentions, ...c.entree };
    expect(parametresEmission(entree)).toEqual(c.attendu);
  });

  it('chaque type de vente émis donne son BT-3 et son cadre', () => {
    const types = new Set(j.cas.filter((c) => c.attendu).map((c) => c.type_document));
    expect([...types].sort()).toEqual(['V_AVOIR', 'V_FACTURE', 'V_FACTURE_ACOMPTE', 'V_FACTURE_AVT']);
  });
});
