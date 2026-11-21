import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nomZoneValide, erreursCreationZone, porteeZone, zonesDuType, proposerColonneZone, lireValeursZone, ecrireValeursZone,
  controleDeErreurZone, demandeCreationZone, ERREUR_ZONE_ENTETE, TYPE_ZONE_ENTETE,
} from '../src/index.js';

// Jeu partagé avec ZonesEntete.cs (LogiBTP.Documents.Tests).
const fichier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/zones/01_zones_entete.json');
const jeu = JSON.parse(fs.readFileSync(fichier, 'utf8'));

describe('zones d\'entête (jeu partagé avec le C#)', () => {
  for (const n of jeu.noms) it(`nom ${n.colonne}`, () => expect(nomZoneValide(n.colonne)).toBe(n.attendu));
  for (const v of jeu.validations) it(`validation : ${v.nom}`, () => expect(erreursCreationZone(v.zone)).toEqual(v.attendu));
  for (const p of jeu.portees) it(`portée de ${p.zone}`, () => expect(porteeZone(jeu.zones.find((z) => z.colonne === p.zone))).toBe(p.attendu));
  for (const d of jeu.documents) {
    it(`zones d'un document : ${d.nom}`, () => expect(zonesDuType(jeu.zones, d.famille, d.type).map((z) => z.colonne)).toEqual(d.attendu));
  }
});

describe('zones d\'entête : aides de l\'écran de paramétrage', () => {
  it('nom proposé d\'après le libellé', () => {
    expect(proposerColonneZone('Référence du marché')).toBe('x_reference_du_marche');
    expect(proposerColonneZone('3 étages')).toBe('x_n_3_etages');
    expect(proposerColonneZone('')).toBe('x_');
    expect(nomZoneValide(proposerColonneZone('Référence du marché'))).toBe(true);
  });
  it('valeurs d\'une liste en lignes, dans les deux sens', () => {
    const v = lireValeursZone('a\nb | Bravo\n\n  c  ');
    expect(v).toEqual([{ valeur: 'a', libelle: 'a' }, { valeur: 'b', libelle: 'Bravo' }, { valeur: 'c', libelle: 'c' }]);
    expect(ecrireValeursZone(v)).toBe('a\nb | Bravo\nc');
  });
  it('contrôle de l\'écran d\'une erreur', () => {
    expect(controleDeErreurZone(ERREUR_ZONE_ENTETE.VALEURS)).toBe('valeurs');
    expect(controleDeErreurZone(ERREUR_ZONE_ENTETE.PORTEE_INVALIDE)).toBe('portee');
    expect(controleDeErreurZone(ERREUR_ZONE_ENTETE.EXISTE)).toBe('colonne');
  });
  it('demande de création : un booléen n\'est jamais obligatoire, valeurs seulement pour une liste', () => {
    const d = demandeCreationZone({ colonne: ' x_a ', type: TYPE_ZONE_ENTETE.CASE_A_COCHER, libelle: 'A', obligatoire: true, valeurs: 'z', famille: 'V' });
    expect(d).toMatchObject({ colonne: 'x_a', obligatoire: false, valeurs: null, famille: 'V', type_document: null, groupe: null, ordre: 0 });
  });
});
