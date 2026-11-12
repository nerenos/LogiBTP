// Option PDF/A-3 du rendu PDF (lot 18 de la facturation électronique) : structure, fichiers associés, déterminisme.
import { describe, it, expect, beforeAll } from 'vitest';
import { polices } from './aide.js';
import { editer, produirePdf, profilSrgbLivre, paquetXmp, normaliserPdfa, RELATIONS_PDFA, octetsVersBase64 } from '../src/index.js';

let p;
beforeAll(async () => { p = await polices(); });

const latin1 = (o) => Buffer.from(o).toString('latin1');
const modele = { bandes: [{ contenu: { type: 'champ', valeur: 'Pièce {{n}}' } }] };
const xml = new TextEncoder().encode('<donnees>é</donnees>');
const option = (sup = {}) => ({
  fichiers: [{ nom: 'donnees.xml', octets: xml, type: 'text/xml', relation: 'Data', description: 'Données' }],
  schemas: [{ schema: 'Essai', espace: 'urn:essai#', prefixe: 'essai', proprietes: [{ nom: 'NomFichier', description: 'Nom', valeur: 'donnees.xml' }] }],
  ...sup,
});
const produire = (pdfa, sup = {}) => produirePdf(editer(modele, { n: 1 }, { polices: p }), p,
  { titre: 'Essai & <titre>', auteur: 'Société', date: '2026-10-18T00:00:00Z', compresser: false, pdfa, ...sup });

describe('PDF/A-3', () => {
  it('profil sRGB livré : ICC version 2.1, moniteur RGB → XYZ, taille cohérente', () => {
    const icc = profilSrgbLivre();
    expect(icc.length).toBe(8796);
    expect((icc[0] << 24 | icc[1] << 16 | icc[2] << 8 | icc[3]) >>> 0).toBe(icc.length);
    expect(latin1(icc.slice(12, 24))).toBe('mntrRGB XYZ ');
    expect(latin1(icc.slice(36, 40))).toBe('acsp');
    expect(icc[8]).toBe(2);
  });

  it('catalogue : Metadata non compressé, OutputIntent sRGB, EmbeddedFiles, /AF, /ID', async () => {
    const t = latin1(await produire(option(), { compresser: true }));
    expect(t.startsWith('%PDF-1.7\n%')).toBe(true);
    expect(t).toMatch(/\/Type \/Metadata\n\/Subtype \/XML\n\/Length \d+\n>>/); // sans /Filter
    expect(t).toMatch(/\/S \/GTS_PDFA1\n\/OutputConditionIdentifier \(sRGB IEC61966-2\.1\)/);
    expect(t).toMatch(/\/DestOutputProfile \d+ 0 R/);
    expect(t).toMatch(/\/Type \/EmbeddedFile\n\/Subtype \/text#2Fxml\n\/Params <<\n\/Size 21\n/);
    expect(t).toMatch(/\/AFRelationship \/Data/);
    expect(t).toMatch(/\/EmbeddedFiles <<\n\/Names \[ <FEFF[0-9A-F]+> \d+ 0 R \]/);
    expect(t).toMatch(/\/AF \[ \d+ 0 R \]/);
    expect(t).toMatch(/\/ID \[ <[0-9A-F]{32}> <[0-9A-F]{32}> \]/);
  });

  it('XMP : pdfaid, Dublin Core cohérent avec Info, schéma d’extension de l’appelant et ses valeurs, échappement', () => {
    const x = paquetXmp({ titre: 'A & <B>', auteur: 'Société', sujet: 'S', createur: 'C', producteur: 'P', date: new Date('2026-10-18T00:00:00Z'),
      partie: 3, conformite: 'B', schemas: option().schemas });
    expect(x).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(x).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(x).toContain('<rdf:li xml:lang="x-default">A &amp; &lt;B&gt;</rdf:li>');
    expect(x).toContain('<xmp:CreateDate>2026-10-18T00:00:00Z</xmp:CreateDate>');
    expect(x).toContain('<pdfaSchema:prefix>essai</pdfaSchema:prefix>');
    expect(x).toContain('<pdfaProperty:name>NomFichier</pdfaProperty:name>');
    expect(x).toContain('<essai:NomFichier>donnees.xml</essai:NomFichier>');
    expect(x.startsWith('<?xpacket begin="﻿"')).toBe(true);
    expect(x.endsWith('<?xpacket end="w"?>')).toBe(true);
  });

  it('déterministe : mêmes entrées, mêmes octets ; fichier différent, autre /ID', async () => {
    const a = await produire(option());
    const b = await produire(option());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const id = (o) => /\/ID \[ <([0-9A-F]+)>/.exec(latin1(o))[1];
    const c = await produire(option({ fichiers: [{ nom: 'donnees.xml', octets: new TextEncoder().encode('<autre/>'), type: 'text/xml', relation: 'Data' }] }));
    expect(id(c)).not.toBe(id(a));
  });

  it('octets en base64 (option venue du serveur en JSON) : même PDF qu’en Uint8Array', async () => {
    const a = await produire(option());
    const f = option().fichiers[0];
    const b = await produire(option({ fichiers: [{ ...f, octets: undefined, base64: octetsVersBase64(xml) }], icc_base64: octetsVersBase64(profilSrgbLivre()) }));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('sans option : ni Metadata, ni OutputIntents, ni /ID (PDF habituel inchangé)', async () => {
    const t = latin1(await produire(undefined));
    expect(t).not.toContain('/OutputIntents');
    expect(t).not.toContain('/Metadata');
    expect(t).not.toContain('/ID [');
  });

  it('refus : relation inconnue, fichier sans octets ou en double, partie non prise en charge', () => {
    expect(RELATIONS_PDFA).toContain('Alternative');
    expect(() => normaliserPdfa({ fichiers: [{ nom: 'a', octets: xml, relation: 'Facture' }] })).toThrow(/relation/);
    expect(() => normaliserPdfa({ fichiers: [{ nom: 'a' }] })).toThrow(/sans octets/);
    expect(() => normaliserPdfa({ fichiers: [{ nom: 'a', octets: xml }, { nom: 'a', octets: xml }] })).toThrow(/double/);
    expect(() => normaliserPdfa({ partie: 2 })).toThrow(/partie/);
    expect(normaliserPdfa({ fichiers: [{ nom: 'a', octets: xml }] }).fichiers[0].relation).toBe('Unspecified');
  });
});
