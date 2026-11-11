import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ETAPE_CONTROLE, NIVEAU_CONTROLE, PROFIL_FACTURE, SYNTAXE } from '../src/codes.js';
import { RACINE_MODULE, SCHEMATRONS, compilerSchematrons } from '../outils/schematrons.js';
import { validerFacture } from '../outils/valider.js';

// CDAR D22B (lot 5) : XSD CDAR D22B puis schematron BR-FR-CDV (FNFE 1.4.0.04), standard « fatal », sur les exemples FNFE
// (cdar/fnfe) et sur les statuts écrits par LogiBTP (cdar/logibtp : fichiers de référence de CdarTests.cs, écrits par
// Formats/Cdar.cs ; ils restent identiques à l'écriture tant que CdarTests passe).
const DOSSIER = join(RACINE_MODULE, 'tests', 'exemples', 'cdar');
const fichiersDe = (sous) => readdirSync(join(DOSSIER, sous)).filter((f) => f.endsWith('.xml')).sort()
  .map((f) => join(sous, f));
const FNFE = fichiersDe('fnfe');
const LOGIBTP = fichiersDe('logibtp');
const LONG = 60_000;

const fatals = (r) => r.controles.filter((c) => c.niveau === NIVEAU_CONTROLE.FATAL);
const lire = (relatif) => readFileSync(join(DOSSIER, relatif), 'utf8');

beforeAll(async () => {
  await compilerSchematrons({ schematrons: [SCHEMATRONS.BR_FR_CDV, SCHEMATRONS.BR_FR_CDV_WARNING] });
}, 600_000);

describe('CDAR valides (XSD et BR-FR-CDV)', () => {
  it('les deux jeux sont présents', () => {
    expect(FNFE).toHaveLength(59);
    expect(LOGIBTP.length).toBeGreaterThanOrEqual(15);
  });
  for (const f of [...FNFE, ...LOGIBTP]) {
    it(f, async () => {
      const r = await validerFacture(join(DOSSIER, f));
      expect(fatals(r)).toEqual([]);
      expect([r.syntaxe, r.profil, r.valide]).toEqual([SYNTAXE.CDAR, PROFIL_FACTURE.NON_DEFINI, true]);
      expect(r.etapes.map((e) => e.etape)).toEqual([ETAPE_CONTROLE.XSD, ETAPE_CONTROLE.FRANCE]);
      expect(r.etapes.at(-1).controle).toBe('BR-FR-CDV-Schematron-CDAR.xslt');
    }, LONG);
  }
});

describe('CDAR altérés : erreur attendue', () => {
  const regles = async (xml) => fatals(await validerFacture(xml)).map((c) => c.regle);

  it('BR-FR-CDV-14 : Encaissée sans taux de TVA', async () => {
    const xml = lire('logibtp/CDV-212_Encaissee.xml').replace('<ram:ValuePercent>20.00</ram:ValuePercent>', '');
    expect(await regles(xml)).toContain('BR-FR-CDV-14_MDT-207');
  }, LONG);

  it('BR-FR-CDV-15 : Refusée sans motif', async () => {
    const xml = lire('logibtp/CDV-210_Refusee.xml').replace(/<ram:SpecifiedDocumentStatus>[\s\S]*<\/ram:SpecifiedDocumentStatus>/, '');
    expect(await regles(xml)).toContain('BR-FR-CDV-15_MDT-113');
  }, LONG);

  it('BR-FR-CDV-CL-09 : motif non autorisé pour Rejetée', async () => {
    const xml = lire('logibtp/CDV-213_Rejetee.xml').replace('<ram:ReasonCode>DOUBLON</ram:ReasonCode>', '<ram:ReasonCode>TX_TVA_ERR</ram:ReasonCode>');
    expect(await regles(xml)).toContain('BR-FR-CDV-CL-09_MDT-113_213');
  }, LONG);

  it('BR-FR-CDV-08 : destinataire acheteur sans adresse électronique', async () => {
    const xml = lire('logibtp/CDV-209_Completee.xml').replace(/<ram:URIUniversalCommunication>\s*<ram:URIID schemeID="0225">200000008<\/ram:URIID>\s*<\/ram:URIUniversalCommunication>/, '');
    expect(await regles(xml)).toContain('BR-FR-CDV-08_MDT-73');
  }, LONG);

  it('XSD : élément inconnu, le schematron n\'est pas lancé', async () => {
    const xml = lire('logibtp/CDV-204_Prise_en_charge.xml').replace('<ram:TypeCode>23</ram:TypeCode>', '<ram:Inconnu>23</ram:Inconnu>');
    const r = await validerFacture(xml);
    expect(r.valide).toBe(false);
    expect(r.etapes.map((e) => e.etape)).toEqual([ETAPE_CONTROLE.XSD]);
  }, LONG);
});
