import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { texte, texteHtml, existe } from '@logibtp/socle/dictionnaire';
import { REGLE_COMPLETUDE, NIVEAU_COMPLETUDE, NIVEAU_CONTROLE, SYNTAXE } from '@logibtp/facture-electronique';
import { compilerSchematrons } from '../../modules/facture-electronique/js/outils/schematrons.js';
import { validerFacture } from '../../modules/facture-electronique/js/outils/valider.js';
import { ECART_EMISSION_FE } from '../src/app/codes.js';
import { bandeauCompletudeFeHtml, libelleEcartFe, completudeFeVisible } from '../src/app/documents/completude-fe.js';

// Facturation électronique, lot 22 : pièces de vente de démonstration écrites par EmissionFactureTests.cs
// (tests/emission-fe/ecrits/, jeu 02_pieces.json) contrôlées par l'outil du module : XSD, schematron du profil et BR-FR-Flux2,
// en CII seul, en UBL et en XML Factur-X (CII sur le XSD et le schematron Factur-X EN16931).
const DOSSIER = fileURLToPath(new URL('../../tests/emission-fe/ecrits/', import.meta.url));
const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.xml')).sort();
const jeu = JSON.parse(readFileSync(new URL('../../tests/emission-fe/02_pieces.json', import.meta.url), 'utf8'));
const LONG = 60_000;
const fatals = (r) => r.controles.filter((c) => c.niveau === NIVEAU_CONTROLE.FATAL);

beforeAll(async () => { await compilerSchematrons(); }, 600_000);

describe('pièces de démonstration émises : aucune erreur fatale', () => {
  it('chaque pièce écrite a son CII et son UBL', () => {
    const ecrites = jeu.pieces.filter((p) => !p.attendu_emission).map((p) => p.nom);
    expect(fichiers).toEqual(ecrites.flatMap((n) => [`${n}_CII.xml`, `${n}_UBL.xml`]).sort());
    expect(ecrites).toEqual(expect.arrayContaining(['FACTURE', 'AVOIR', 'ACOMPTE', 'DEFINITIVE', 'AVOIR_ACOMPTE']));
  });
  for (const f of fichiers) {
    it(f, async () => {
      const r = await validerFacture(`${DOSSIER}${f}`);
      expect(fatals(r)).toEqual([]);
      expect(r.valide).toBe(true);
      expect(r.syntaxe).toBe(f.endsWith('_UBL.xml') ? SYNTAXE.UBL : SYNTAXE.CII);
    }, LONG);
    if (f.endsWith('_CII.xml')) {
      it(`${f} en Factur-X`, async () => {
        const r = await validerFacture(`${DOSSIER}${f}`, { facturX: true });
        expect(fatals(r)).toEqual([]);
        expect(r.syntaxe).toBe(SYNTAXE.FACTUR_X);
      }, LONG);
    }
  }
});

describe('bandeau de complétude de la pièce', () => {
  it('libellé de chaque règle de complétude et de chaque écart de l\'émission', () => {
    for (const r of Object.values(REGLE_COMPLETUDE)) expect(existe(`facture_electronique.completude.regles.${r}`), r).toBe(true);
    for (const n of Object.values(NIVEAU_COMPLETUDE)) expect(existe(`facture_electronique.completude.niveaux.${n}`), n).toBe(true);
    for (const c of Object.values(ECART_EMISSION_FE)) expect(existe(`document_btp.page.completude_fe.ecarts.${c}`), c).toBe(true);
    expect(libelleEcartFe({ regle: REGLE_COMPLETUDE.BR_FR_12 })).toBe(texte(`facture_electronique.completude.regles.${REGLE_COMPLETUDE.BR_FR_12}`));
    expect(libelleEcartFe({ regle: ECART_EMISSION_FE.IBAN_ABSENT }, true)).toBe(texte(`document_btp.page.completude_fe.ecarts.${ECART_EMISSION_FE.IBAN_ABSENT}`));
  });

  it('écarts bloquants, avertissements, pièce complète, type non émis', () => {
    const controle = {
      applicable: true, type_facture: '380', cadre: 'S1', bloquant: true,
      completude: [{ regle: REGLE_COMPLETUDE.BR_FR_12, niveau: NIVEAU_COMPLETUDE.BLOQUANT, donnee: 'BT-49', ligne: null },
        { regle: REGLE_COMPLETUDE.BR_FR_15, niveau: NIVEAU_COMPLETUDE.BLOQUANT, donnee: 'BT-151', ligne: '2' }],
      emission: [{ regle: ECART_EMISSION_FE.NUMERO_PROVISOIRE, niveau: NIVEAU_COMPLETUDE.AVERTISSEMENT, donnee: 'BT-1', ligne: null }],
    };
    const html = bandeauCompletudeFeHtml(controle);
    expect(html).toContain('probleme');
    expect((html.match(/data-ecart-fe=/g) ?? []).length).toBe(3);
    expect(html).toContain('BT-151');
    expect(html).toContain(texte('document_btp.page.completude_fe.bloquants', { nombre: 2 }));
    const complet = bandeauCompletudeFeHtml({ ...controle, completude: [], emission: [] });
    expect(complet).not.toContain('probleme');
    expect(complet).toContain(texteHtml('document_btp.page.completude_fe.complete'));
    expect(bandeauCompletudeFeHtml({ applicable: false })).toBe('');
    expect(bandeauCompletudeFeHtml(null)).toBe('');
  });

  it('visible : module actif, droit, pièce enregistrée d\'un type émis', () => {
    const types = { V_FACTURE: '380' };
    expect(completudeFeVisible({ moduleActif: true, peutConsulter: true, entId: 4, code: 'V_FACTURE', types })).toBe(true);
    expect(completudeFeVisible({ moduleActif: false, peutConsulter: true, entId: 4, code: 'V_FACTURE', types })).toBe(false);
    expect(completudeFeVisible({ moduleActif: true, peutConsulter: false, entId: 4, code: 'V_FACTURE', types })).toBe(false);
    expect(completudeFeVisible({ moduleActif: true, peutConsulter: true, entId: -4, code: 'V_FACTURE', types })).toBe(false);
    expect(completudeFeVisible({ moduleActif: true, peutConsulter: true, entId: 4, code: 'V_DEVIS', types })).toBe(false);
  });
});
