import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  lireZip, analyserXml, rtfEnHtml, rtfEnTexte, lireFichierOptim, convertirOptim,
  associerUnite, associerNature, associerTaux, associerOption, lireFichierCarburant,
} from '../src/index.js';

/** Archive zip minimale (un fichier compressé en deflate). */
function zip(nom, contenu) {
  const donnees = Buffer.from(contenu, 'utf8');
  const comp = deflateRawSync(donnees);
  const n = Buffer.from(nom, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(donnees.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(donnees.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const debutCentral = 30 + n.length + comp.length;
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10); fin.writeUInt32LE(46 + n.length, 12); fin.writeUInt32LE(debutCentral, 16);
  return new Uint8Array(Buffer.concat([local, n, comp, central, n, fin]));
}

const rtf = (t) => `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}}{\\*\\generator Riched20 10.0;}\\viewkind4\\uc1 \n\\pard\\fs18 ${t}\\par\n}`;
const L = (o) => `<Ligne>${Object.entries({
  IsFA: 0, IsVideTexte: 0, IsSousDetail: 0, IsOption: 0, IsNonEdite: 0, IsSautPageAvant: 0, PTV_Code: '', Ordre: 1, TypeLigne: 1,
  FTY_Code: '', FTY_Libelle: '', FTY_LibelleRgp: '', NumLigne: '', Code: '', Libelle: '', LibelleRTF: '', LibUnite: '', Qte: 0, QteFixe: 0,
  PAU: 0, PctFG: 0, PRU: 0, PGU: 0, PctVte: 0, PVU: 0, MntHT: 0, IsMntFixe: 0, TxTVA: '', ...o,
}).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</Ligne>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Devis><Entete><Chantier>Parking Nord</Chantier><Reference>D1.00</Reference><DateDoc>20250918</DateDoc><Libelle>Parking &amp; voirie</Libelle>
<Redacteur>A. Girard</Redacteur><RefExt>CDE-77</RefExt><NosRef></NosRef><ModeReglCode>Vir45</ModeReglCode><ModeReglLib>Virement à 45 jours</ModeReglLib><TxTVA_Def>0.2</TxTVA_Def><MtHT>1000</MtHT><MtTTC>1200</MtTTC></Entete>
<Annuaires><Annuaire><ADR_RaisonSociale>Ville de Caen</ADR_RaisonSociale><IsClient>1</IsClient><IsTiersPayeur>1</IsTiersPayeur><Email>a@b.fr</Email></Annuaire><Annuaire><ADR_RaisonSociale/><IsProjetCh>1</IsProjetCh></Annuaire></Annuaires>
<Complements><Complement><TypeComplement>VTLTVA</TypeComplement></Complement></Complements>
<Lignes>
${L({ Identifiant: 1, IdentifiantParent: 0, TypeLigne: 4, NumLigne: 7, LibelleRTF: rtf('\\ul\\b VOIRIE') })}
${L({ Identifiant: 2, IdentifiantParent: 1, NumLigne: '7.1', Couleur: 'COUL_02', LibUnite: 'M2', Qte: 100, PAU: 10, PctFG: 0.05, PRU: 10.5, PctVte: 0.2, PVU: 12.6, MntHT: 1260, TxTVA: 0.2, FTY_Code: 'MT', FTY_LibelleRgp: 'MATERIAUX', LibelleRTF: rtf("Enrob\\'e9s \\u339?uvre") })}
${L({ Identifiant: 3, IdentifiantParent: 1, Ordre: 2, TypeLigne: 2, NumLigne: '7.3', LibUnite: 'U', Qte: 4, PctVte: 0.1, Libelle: 'Ouvrage', IsSautPageAvant: 1 })}
${L({ Identifiant: 4, IdentifiantParent: 3, IsSousDetail: 1, LibUnite: 'H', Qte: 2, PAU: 30, PRU: 30, FTY_Code: 'Chef', FTY_LibelleRgp: "MAIN D'OEUVRE", NbHU: 2 })}
${L({ Identifiant: 5, IdentifiantParent: 3, IsSousDetail: 1, Ordre: 2, LibUnite: 'U', Qte: 0.25, QteFixe: 1, PAU: 100, PRU: 100 })}
${L({ Identifiant: 6, IdentifiantParent: 1, Ordre: 3, IsVideTexte: 1, Libelle: 'suite du texte' })}
${L({ Identifiant: 8, IdentifiantParent: 0, Ordre: 2, TypeLigne: 4, IsFA: 1, NumLigne: 2, Libelle: 'Globalisations' })}
${L({ Identifiant: 9, IdentifiantParent: 8, TypeLigne: 3, IsFA: 1, Libelle: 'Phase' })}
${L({ Identifiant: 10, IdentifiantParent: 1, Ordre: 4, NumLigne: '7.4', LibUnite: 'm²', Qte: 10, PAU: 0, PRU: 0, PGU: 5, PctVte: 0.15, PVU: 5.75, IsMntFixe: 1, IdentifiantPrixIdem: 2 })}
</Lignes>
<Parametres><Parametre><TypeParam>Appli</TypeParam><Code>VALIDITE_OFFRE</Code><Libelle>Durée de validité de l'offre (en mois)</Libelle><Num1>2</Num1></Parametre><Parametre><TypeParam>Couleur</TypeParam><Code>COUL_02</Code><Libelle>A vérifier</Libelle><Txt1>COUL_02.png</Txt1><Num1>5938673</Num1></Parametre></Parametres>
</Devis>`;

describe('Module Import : lecture', () => {
  it('lit une archive zip compressée', async () => {
    const f = lireZip(zip('Devis.xml', 'Bonjour œuvre'));
    expect(f.map((x) => x.nom)).toEqual(['Devis.xml']);
    expect(new TextDecoder().decode(await f[0].lire())).toBe('Bonjour œuvre');
  });

  it('analyse le XML (entités, auto-fermantes, attributs, CDATA)', () => {
    const x = analyserXml('<?xml version="1.0"?><a n="1"><b>x &amp; y&#13;</b><c/><d><![CDATA[<z>]]></d></a>');
    expect(x.nom).toBe('a');
    expect(x.attributs.n).toBe('1');
    expect(x.enfants.map((e) => [e.nom, e.texte])).toEqual([['b', 'x & y\r'], ['c', ''], ['d', '<z>']]);
    expect(() => analyserXml('<a><b></a>')).toThrow();
  });

  it('convertit le RTF en HTML (gras, souligné, accents, unicode, paragraphes)', () => {
    expect(rtfEnHtml(rtf("\\b Enrob\\'e9s\\b0  et mise en \\u339?uvre"))).toBe('<b>Enrobés</b> et mise en œuvre');
    expect(rtfEnHtml(rtf('\\ul\\b TITRE'))).toBe('<b><u>TITRE</u></b>');
    expect(rtfEnHtml(rtf('Ligne 1\\par Ligne 2\\line suite'))).toBe('<p>Ligne 1</p><p>Ligne 2<br>suite</p>');
    expect(rtfEnTexte(rtf('a < b\\par c'))).toBe('a < b\nc');
  });
});

describe('Module Import : OptimBTP', () => {
  it('lit l\'archive .optim et reprend l\'entête et les intervenants', async () => {
    const d = await lireFichierOptim(zip('Devis.xml', XML));
    expect(d.entete).toMatchObject({ reference: 'D1.00', date: '2025-09-18', objet: 'Parking & voirie', chantier: 'Parking Nord', taux_tva_defaut: 20 });
    expect(d.entete.mode_reglement).toEqual({ code: 'Vir45', libelle: 'Virement à 45 jours' });
    expect(d.entete).toMatchObject({ notre_reference: 'D1.00', reference_externe: 'CDE-77', redacteur: 'A. Girard', validite_jours: 60 });
    expect(d.couleurs).toEqual([{ code: 'COUL_02', libelle: 'A vérifier', couleur: '#f19d5a', image: 'COUL_02.png' }]);
    expect(d.lignes.find((l) => l.id === '2').etiquette).toMatchObject({ code: 'COUL_02', libelle: 'A vérifier' });
    expect(d.intervenants).toHaveLength(1);
    expect(d.intervenants[0]).toMatchObject({ nom: 'Ville de Caen', roles: ['CLIENT', 'PAYEUR'], email: 'a@b.fr' });
    expect(d.avertissements.join()).toMatch(/2 ligne\(s\) de globalisation/);
  });

  it('convertit les lignes : types, numérotation, prix, coefficients, composantes', () => {
    const d = convertirOptim(XML);
    const par = Object.fromEntries(d.lignes.map((l) => [l.id, l]));
    expect(d.lignes.map((l) => `${l.id}:${l.type}`)).toEqual(['1:TITRE', '2:ELEMENT', '3-saut:SAUT_PAGE', '3:OUVRAGE', '4:ELEMENT', '5:ELEMENT', '6:TEXTE', '10:ELEMENT']);
    expect(par[1]).toMatchObject({ libelle_html: '<b><u>VOIRIE</u></b>', numero: '7', num_depart: '7' });
    expect(par[2]).toMatchObject({ libelle_html: 'Enrobés œuvre', unite: 'M2', qte: 100, prix_achat: 10, coef_fg: 1.05, coef_benef: 1.2, taux_tva: 20 });
    expect(par[2].num_depart).toBeUndefined();
    expect(par[3]).toMatchObject({ num_depart: '3', coef_benef: 1.1 });
    // Composantes : coefficient de vente de la ligne de prix, quantité fixe rendue absolue pour l'ouvrage.
    expect(par[4]).toMatchObject({ composante: true, qte: 2, coef_benef: 1.1, nature: { code: 'Chef', regroupement: "MAIN D'OEUVRE" } });
    expect(par[5]).toMatchObject({ qte: 1, qte_absolue: true });
    // Globalisation : déboursé PGU, prix de vente fixe.
    expect(par[10]).toMatchObject({ prix_achat: 5, coef_fg: 1, coef_benef: 1.15, pv_fixe: 5.75 });
    expect(par[10].num_depart).toBeUndefined();
    expect(d.lignes.some((l) => l.id === '8' || l.id === '9')).toBe(false);
  });

  it('liste les champs non repris qui ont une valeur', () => {
    const d = convertirOptim(XML);
    const champs = d.non_repris.map((x) => `${x.zone}.${x.champ}`);
    expect(champs).toEqual(expect.arrayContaining(['Lignes.NbHU', 'Lignes.IdentifiantPrixIdem', 'Intervenant Ville de Caen.Email']));
    for (const repris of ['Entête.Chantier', 'Entête.Reference', 'Entête.Redacteur', 'Entête.RefExt', 'Paramètres.VALIDITE_OFFRE', 'Paramètres.COUL_02', 'Lignes.Couleur']) expect(champs).not.toContain(repris);
    expect(champs).not.toContain('Lignes.PAU');
    expect(d.non_repris.find((x) => x.champ === 'NbHU')).toMatchObject({ nombre: 1, lignes: ['4'], valeurs: ['2'] });
  });

  it('refuse un fichier qui n\'est pas un devis OptimBTP', () => {
    expect(() => convertirOptim('<Facture/>')).toThrow(/Devis/);
  });
});

describe('Module Import : correspondances', () => {
  it('rapproche unités, natures, taux et options', () => {
    const unites = [{ code: 'm2', libelle: 'Mètre carré' }, { code: 'u', libelle: 'Unité' }, { code: 'ft', libelle: 'Forfait' }];
    expect(['M2', 'm²', 'U', 'FFT', 'Forfait', 'XYZ'].map((u) => associerUnite(u, unites))).toEqual(['m2', 'm2', 'u', 'ft', 'ft', null]);
    const natures = [{ id: 1, code: 'MO', libelle: 'Main-d\'œuvre', regroupement: 'MO' }, { id: 2, code: 'MAT', libelle: 'Matériaux', regroupement: 'MATERIAUX' },
      { id: 3, code: 'LOC', libelle: 'Location', regroupement: 'ENGIN' }, { id: 4, code: 'ST', libelle: 'Sous-traitance', regroupement: 'SOUS_TRAITANCE' }];
    expect([
      { code: 'MT', libelle: 'Matériaux', regroupement: 'MATERIAUX' }, { code: 'Chef', libelle: 'MO Chef', regroupement: "MAIN D'OEUVRE" },
      { code: 'Engin', libelle: 'Engin', regroupement: 'MATERIEL et LOCATION' }, { code: 'ST', libelle: 'x', regroupement: 'SOUS-TRAITANCE' }, { code: 'ZZ' },
    ].map((n) => associerNature(n, natures))).toEqual([2, 1, 3, 4, null]);
    expect(associerTaux(20, [{ id: 4, taux: 20, categorie: 'A' }, { id: 1, taux: '20.000000', categorie: 'N' }])).toBe(1);
    expect(associerOption({ code: 'Vir45', libelle: 'Virement à 45 jours' }, [{ code: 'CHQ', libelle: 'Chèque' }, { code: 'VIR', libelle: 'Virement' }])).toBe('VIR');
  });
});

describe('cartes carburant (plan materiel-suites, MO6)', () => {
  const FICHIER = [
    'Date;Numéro carte;Plaque;Litres;Montant;Km',
    '05/11/2026;7001;AB-123-CD;45,5;"82,35";120 450',
    '06/11/2026;;EF-456-GH;30;55,10;',
    '',
    '31/02/2026;7002;AB-123-CD;20;40;100',
    '07/11/2026;7003;AB-123-CD;abc;40;100',
    '08/11/2026;;;20;40;100',
  ].join('\r\n');

  it('fichier d exemple : pleins lus, lignes mal formées signalées', () => {
    const { pleins, erreurs } = lireFichierCarburant(FICHIER);
    expect(pleins).toEqual([
      { rang: 1, date: '2026-11-05', carte: '7001', immatriculation: 'AB-123-CD', litres: '45.5', montant: '82.35', kilometrage: '120450' },
      { rang: 2, date: '2026-11-06', carte: '', immatriculation: 'EF-456-GH', litres: '30', montant: '55.10', kilometrage: '' },
    ]);
    expect(erreurs.map((e) => e.rang)).toEqual([4, 5, 6]);
  });

  it('en-tête sans colonne des litres : fichier refusé', () => {
    const r = lireFichierCarburant('Date;Carte\r\n05/11/2026;7001');
    expect(r.pleins).toEqual([]);
    expect(r.erreurs[0].rang).toBe(0);
  });

  it('correspondances du fournisseur : colonnes, séparateur et date ISO', () => {
    const c = { separateur: ',', formatDate: 'AAAA-MM-JJ', colonnes: { date: ['jour'], carte: ['pan'], litres: ['vol'] } };
    const { pleins } = lireFichierCarburant('Jour,PAN,Vol\n2026-11-05,9,12.5', c);
    expect(pleins[0]).toMatchObject({ date: '2026-11-05', carte: '9', litres: '12.5', montant: '' });
  });
});
