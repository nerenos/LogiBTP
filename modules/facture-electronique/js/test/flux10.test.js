import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ETAPE_CONTROLE, NIVEAU_CONTROLE, PROFIL_FACTURE, SYNTAXE } from '../src/codes.js';
import { JEUX_XSD, RACINE_MODULE, SCHEMATRONS, compilerSchematrons } from '../outils/schematrons.js';
import { controlesAEnchainer, validerFacture } from '../outils/valider.js';

// E-reporting (flux 10, lot 19) : XSD ereporting puis schematron Flux10 (annexe 7 v1.8, paquet FNFE) sur les
// transmissions écrites par Formats/EcritureFlux10.cs (tests/ereporting : fichiers de référence d'EcritureFlux10Tests,
// jeux B2C et international ; identiques à l'écriture tant que EcritureFlux10Tests passe).
const DOSSIER = join(RACINE_MODULE, 'tests', 'ereporting');
const FICHIERS = readdirSync(DOSSIER).filter((f) => f.endsWith('.xml')).sort();
const LONG = 60_000;

const fatals = (r) => r.controles.filter((c) => c.niveau === NIVEAU_CONTROLE.FATAL);
const lire = (f) => readFileSync(join(DOSSIER, f), 'utf8');
// Les assertions du schematron Flux10 n'ont ni @id ni @flag (fatales) : la règle est le code en tête du message, « [G8.01] … ».
const regles = async (xml) => fatals(await validerFacture(xml)).map((c) => c.message.match(/^\[([A-Z0-9.]+)\]/)?.[1]);

beforeAll(async () => { await compilerSchematrons({ schematrons: [SCHEMATRONS.FLUX10] }); }, 600_000);

describe('flux 10 écrits : XSD et schematron Flux10 sans erreur fatale', () => {
  it('jeux B2C (10.3, 10.4, rectificative) et international (10.1, 10.2)', () => {
    expect(FICHIERS).toEqual(['B2C_10.3_RECTIFICATIVE.xml', 'B2C_10.3_TRANSACTIONS_AGREGEES.xml', 'B2C_10.4_PAIEMENTS_AGREGES.xml',
      'INT_10.1_TRANSACTIONS_UNITAIRES.xml', 'INT_10.2_PAIEMENTS_UNITAIRES.xml']);
  });
  for (const f of FICHIERS) {
    it(f, async () => {
      const r = await validerFacture(join(DOSSIER, f));
      expect(fatals(r)).toEqual([]);
      expect([r.syntaxe, r.profil, r.valide]).toEqual([SYNTAXE.FRR, PROFIL_FACTURE.NON_DEFINI, true]);
      expect(r.etapes.map((e) => e.etape)).toEqual([ETAPE_CONTROLE.XSD, ETAPE_CONTROLE.FRANCE]);
      expect(r.etapes.at(-1).controle).toBe('Flux10.xslt');
    }, LONG);
  }
});

describe('contrôles enchaînés pour un flux 10', () => {
  it('XSD ereporting puis Flux10', () => {
    const plan = controlesAEnchainer({ syntaxe: SYNTAXE.FRR, specification: '' });
    expect([plan.xsd, plan.profil, plan.schematrons]).toEqual([JEUX_XSD.FLUX10, PROFIL_FACTURE.NON_DEFINI,
      [{ etape: ETAPE_CONTROLE.FRANCE, schematron: SCHEMATRONS.FLUX10 }]]);
  });
});

// Mêmes altérations que EcritureFlux10Tests.Transmission_alteree_signalee (règle C# entre parenthèses) : le schematron les refuse.
describe('flux 10 altérés : erreur attendue', () => {
  const INT = 'INT_10.1_TRANSACTIONS_UNITAIRES.xml';
  const B2C = 'B2C_10.3_TRANSACTIONS_AGREGEES.xml';
  const PAI = 'B2C_10.4_PAIEMENTS_AGREGES.xml';
  const cas = [
    ['type de transmission CO (G8.01)', INT, (x) => x.replace('<TypeCode>IN</TypeCode>', '<TypeCode>CO</TypeCode>'), 'G8.01'],
    ['émetteur identifié par SIREN (G6.22)', INT, (x) => x.replace('<Id schemeId="0238">0001</Id>', '<Id schemeId="0002">200000008</Id>'), 'G6.22'],
    ['type 262 (G1.01)', INT, (x) => x.replace('<TypeCode>380</TypeCode>', '<TypeCode>262</TypeCode>'), 'G1.01'],
    ['cadre S3 (G1.02)', INT, (x) => x.replace('<ID>S1</ID>', '<ID>S3</ID>'), 'G1.02'],
    ['acheteur sans identifiant (G6.28)', INT, (x) => x.replace('<CompanyId schemeId="0223">DE123456789</CompanyId>', ''), 'G6.28'],
    ['taux de 19 % (G1.24)', INT, (x) => x.replace('<Percent>20</Percent>', '<Percent>19</Percent>'), 'G1.24'],
    ['période inversée (G6.25)', B2C, (x) => x.replace('<StartDate>20261101</StartDate>', '<StartDate>20261111</StartDate>'), 'G6.25'],
    ['catégorie de transactions inconnue (G1.68)', B2C, (x) => x.replace('<CategoryCode>TLB1</CategoryCode>', '<CategoryCode>TXX1</CategoryCode>'), 'G1.68'],
    ['encaissement en dollars (G6.27)', PAI, (x) => x.replace('<CurrencyCode>EUR</CurrencyCode>', '<CurrencyCode>USD</CurrencyCode>'), 'G6.27'],
    ['encaissement négatif (G1.16)', PAI, (x) => x.replace(/<Amount>([0-9])/, '<Amount>-$1'), 'G1.16'],
  ];
  for (const [nom, fichier, alterer, regle] of cas) {
    it(nom, async () => {
      const xml = alterer(lire(fichier));
      expect(xml).not.toBe(lire(fichier));
      expect(await regles(xml)).toContain(regle);
    }, LONG);
  }

  it('deux rapports (G6.29) : admis par le XSD, refusé par le schematron', async () => {
    const paiements = lire(PAI).match(/<PaymentsReport>[\s\S]*<\/PaymentsReport>/)[0];
    const xml = lire(B2C).replace('</Report>', `${paiements}\n</Report>`);
    expect(await regles(xml)).toContain('G6.29');
  }, LONG);

  it('XSD : élément inconnu, le schematron n\'est pas lancé', async () => {
    const r = await validerFacture(lire(B2C).replace('<TaxTotal>', '<Inconnu>1</Inconnu><TaxTotal>'));
    expect(r.valide).toBe(false);
    expect(r.etapes.map((e) => e.etape)).toEqual([ETAPE_CONTROLE.XSD]);
  }, LONG);
});
