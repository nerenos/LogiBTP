import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ERREUR_FE, ETAPE_CONTROLE, NIVEAU_CONTROLE, PROFIL_FACTURE, SPECIFICATION_FACTURE, SYNTAXE,
} from '../src/codes.js';
import { RACINE_MODULE, SCHEMATRONS, compilerSchematrons } from '../outils/schematrons.js';
import { controlesAEnchainer, validerFacture } from '../outils/valider.js';

// Schematrons FNFE 1.4.0.04 par SaxonJS (lot 4). Les SEF sont compilés au premier lancement (une minute environ),
// puis réutilisés tant que les XSLT ne changent pas (npm run compiler-schematrons).
const EXEMPLES = join(RACINE_MODULE, 'tests', 'exemples');
const lister = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? lister(join(d, n)) : [join(d, n)]));
const fichiers = lister(EXEMPLES).filter((f) => /\.(xml|pdf)$/.test(f)).sort();
const lire = (chemin) => readFileSync(join(EXEMPLES, chemin), 'utf8');
const CII_EN16931 = 'cii/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml';
const UBL_EN16931 = 'ubl/en16931/UC1_F202500003_00-INV_20250701_EN16931_UBL_Commentee.xml';
const LONG = 60_000;

const fatals = (r) => r.controles.filter((c) => c.niveau === NIVEAU_CONTROLE.FATAL);
const etapes = (r) => r.etapes.map((e) => e.etape);

beforeAll(async () => { await compilerSchematrons(); }, 600_000);

describe('exemples FNFE et LogiBTP : aucune erreur fatale', () => {
  it('le jeu contient les exemples des trois syntaxes', () => expect(fichiers.length).toBeGreaterThanOrEqual(40));
  for (const f of fichiers) {
    const nom = relative(EXEMPLES, f);
    it(nom, async () => {
      const r = await validerFacture(f);
      expect(fatals(r)).toEqual([]);
      expect(r.valide).toBe(true);
      expect(etapes(r)).toEqual([ETAPE_CONTROLE.XSD, ETAPE_CONTROLE.PROFIL, ETAPE_CONTROLE.FRANCE]);
      const attendu = nom.startsWith('ubl/') || nom.endsWith('_UBL.xml') ? SYNTAXE.UBL
        : nom.startsWith('factur-x/') ? SYNTAXE.FACTUR_X : SYNTAXE.CII;
      expect(r.syntaxe).toBe(attendu);
    }, LONG);
  }
});

describe('cas altérés : erreur attendue', () => {
  it('BR-FR-01 : numéro de facture de plus de 35 caractères (CII, fatal)', async () => {
    const xml = lire(CII_EN16931).replace('<ram:ID>F202500003</ram:ID>', `<ram:ID>F${'1'.repeat(40)}</ram:ID>`);
    const r = await validerFacture(xml);
    expect(r.valide).toBe(false);
    expect(fatals(r).map((c) => [c.etape, c.regle])).toContainEqual([ETAPE_CONTROLE.FRANCE, 'BR-FR-01_BT-1']);
    const c = fatals(r).find((x) => x.regle === 'BR-FR-01_BT-1');
    expect(c.message).toMatch(/35 caractères/);
    expect(c.emplacement).toMatch(/^\/CrossIndustryInvoice\[1\]\/ExchangedDocument\[1\]\/ID\[1\]$/);
  }, LONG);

  it('version WARNING de BR-FR : la même erreur est un avertissement', async () => {
    const xml = lire(CII_EN16931).replace('<ram:ID>F202500003</ram:ID>', `<ram:ID>F${'1'.repeat(40)}</ram:ID>`);
    const r = await validerFacture(xml, { warning: true });
    expect(r.valide).toBe(true);
    expect(r.etapes.at(-1).controle).toBe('BR-FR-Flux2-Schematron-CII_WARNING.xslt');
    expect(r.controles.find((c) => c.regle === 'BR-FR-01_BT-1')?.niveau).toBe(NIVEAU_CONTROLE.AVERTISSEMENT);
  }, LONG);

  it('EN16931 : total TTC incohérent (schematron du profil, fatal)', async () => {
    const xml = lire(CII_EN16931).replace('<ram:GrandTotalAmount>12000.00</ram:GrandTotalAmount>',
      '<ram:GrandTotalAmount>12001.00</ram:GrandTotalAmount>');
    const r = await validerFacture(xml);
    expect(r.valide).toBe(false);
    expect(fatals(r).some((c) => c.etape === ETAPE_CONTROLE.PROFIL && c.regle.startsWith('BR-CO-'))).toBe(true);
  }, LONG);

  it('BR-FR-04 : type de facture non autorisé (UBL)', async () => {
    const xml = lire(UBL_EN16931).replace('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>',
      '<cbc:InvoiceTypeCode>326</cbc:InvoiceTypeCode>');
    const r = await validerFacture(xml);
    expect(r.syntaxe).toBe(SYNTAXE.UBL);
    expect(fatals(r).some((c) => c.etape === ETAPE_CONTROLE.FRANCE && c.regle.startsWith('BR-FR-04'))).toBe(true);
  }, LONG);

  it('XSD : élément inconnu, les schematrons ne sont pas lancés', async () => {
    const xml = lire(CII_EN16931).replace('<ram:TypeCode>380</ram:TypeCode>',
      '<ram:TypeCode>380</ram:TypeCode><ram:Inconnu>1</ram:Inconnu>');
    const r = await validerFacture(xml);
    expect(r.valide).toBe(false);
    expect(etapes(r)).toEqual([ETAPE_CONTROLE.XSD]);
    expect(fatals(r)[0]).toMatchObject({ etape: ETAPE_CONTROLE.XSD, regle: ETAPE_CONTROLE.XSD });
    expect(fatals(r)[0].message).toMatch(/Inconnu/);
  }, LONG);
});

describe('choix des contrôles selon la syntaxe et le profil', () => {
  const S = SPECIFICATION_FACTURE;
  const cas = [
    [{ syntaxe: SYNTAXE.CII, specification: S.EN16931 }, 'CrossIndustryInvoice_100pD22B.xsd', SCHEMATRONS.EN16931_CII, SCHEMATRONS.BR_FR_CII],
    [{ syntaxe: SYNTAXE.CII, specification: S.EN16931, facturX: true }, 'Factur-X_EN16931.xsd', SCHEMATRONS.FACTUR_X_EN16931, SCHEMATRONS.BR_FR_CII],
    [{ syntaxe: SYNTAXE.CII, specification: S.EXTENDED_CTC_FR }, 'CrossIndustryInvoice_100pD22B.xsd', SCHEMATRONS.EXTENDED_CTC_FR_CII, SCHEMATRONS.BR_FR_CII],
    [{ syntaxe: SYNTAXE.CII, specification: S.EXTENDED_CTC_FR, facturX: true }, 'Factur-X_EXTENDED.xsd', SCHEMATRONS.EXTENDED_CTC_FR_CII, SCHEMATRONS.BR_FR_CII],
    [{ syntaxe: SYNTAXE.CII, specification: S.BASIC_WL }, 'Factur-X_BASICWL.xsd', SCHEMATRONS.FACTUR_X_BASIC_WL, SCHEMATRONS.BR_FR_CII],
    [{ syntaxe: SYNTAXE.CII, specification: S.EXTENDED, warning: true }, 'Factur-X_EXTENDED.xsd', SCHEMATRONS.FACTUR_X_EXTENDED, SCHEMATRONS.BR_FR_CII_WARNING],
    [{ syntaxe: SYNTAXE.UBL, specification: S.EN16931 }, 'maindoc/UBL-Invoice-2.1.xsd', SCHEMATRONS.EN16931_UBL, SCHEMATRONS.BR_FR_UBL],
    [{ syntaxe: SYNTAXE.UBL, specification: S.EXTENDED_CTC_FR, avoir: true }, 'maindoc/UBL-CreditNote-2.1.xsd', SCHEMATRONS.EXTENDED_CTC_FR_UBL, SCHEMATRONS.BR_FR_UBL],
  ];
  for (const [entree, xsd, profil, france] of cas) {
    it(`${entree.syntaxe} ${entree.specification}${entree.facturX ? ' (Factur-X)' : ''}${entree.avoir ? ' (avoir)' : ''}`, () => {
      const plan = controlesAEnchainer(entree);
      expect([plan.xsd.principal, ...plan.schematrons.map((s) => s.schematron)]).toEqual([xsd, profil, france]);
    });
  }
  it('CDAR : BR-FR-CDV seul (XSD au lot 5)', () => {
    const plan = controlesAEnchainer({ syntaxe: SYNTAXE.CDAR });
    expect([plan.xsd, plan.profil, plan.schematrons]).toEqual([null, PROFIL_FACTURE.NON_DEFINI,
      [{ etape: ETAPE_CONTROLE.FRANCE, schematron: SCHEMATRONS.BR_FR_CDV }]]);
  });
  it('MINIMUM ou profil absent : PROFIL_INCONNU', () => {
    expect(() => controlesAEnchainer({ syntaxe: SYNTAXE.CII, specification: S.MINIMUM }))
      .toThrow(expect.objectContaining({ code: ERREUR_FE.PROFIL_INCONNU }));
    expect(() => controlesAEnchainer({ syntaxe: SYNTAXE.UBL, specification: '' }))
      .toThrow(expect.objectContaining({ code: ERREUR_FE.PROFIL_INCONNU }));
  });
});

describe('erreurs de lecture', () => {
  it('racine inconnue : SYNTAXE_INCONNUE', async () => {
    await expect(validerFacture('<facture/>')).rejects.toMatchObject({ code: ERREUR_FE.SYNTAXE_INCONNUE });
  });
  it('XML mal formé : XML_ILLISIBLE', async () => {
    await expect(validerFacture('<facture>')).rejects.toMatchObject({ code: ERREUR_FE.XML_ILLISIBLE });
  });
  it('PDF sans XML embarqué : XML_ABSENT', async () => {
    await expect(validerFacture(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nstream\nrien\nendstream\nendobj\n%%EOF')))
      .rejects.toMatchObject({ code: ERREUR_FE.XML_ABSENT });
  });
});
