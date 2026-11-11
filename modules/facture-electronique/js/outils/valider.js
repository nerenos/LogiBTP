// Validation d'une facture, d'un CDAR ou d'un flux 10 (e-reporting : XSD ereporting puis schematron Flux10) par les contrôles FNFE (note explicative 1.4.0) : étape 1 XSD de la syntaxe
// (xmllint-wasm), étape 2 schematron du profil (EN16931, EXTENDED-CTC-FR ou Factur-X), étape 3 BR-FR-Flux2 (BR-FR-CDV
// pour un CDAR), par SaxonJS. Outil de développement et de test seulement (Q6) : le serveur valide XSD + complétude.
//
//   npm run valider-facture -- <fichier.xml|fichier.pdf> [--warning] [--facturx] [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { validateXML } from 'xmllint-wasm';
import {
  ERREUR_FE, ETAPE_CONTROLE, NIVEAU_CONTROLE, PROFIL_FACTURE, SPECIFICATION_FACTURE, SYNTAXE,
} from '../src/codes.js';
import { DOSSIER_XSD, JEUX_XSD, SCHEMATRONS, cheminSef, compilerSchematrons, sefAJour } from './schematrons.js';

const SaxonJS = createRequire(import.meta.url)('saxon-js');

const NS = Object.freeze({
  CII: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  CDAR: 'urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100',
  UBL_INVOICE: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  UBL_CREDIT_NOTE: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
});

/** Erreur de l'outil, avec un code d'`ERREUR_FE`. */
export class ErreurValidation extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * XML Factur-X embarqué d'un PDF : premier flux (FlateDecode ou brut) dont le contenu est un CrossIndustryInvoice.
 * Lecture volontairement simple (le serveur passe par PdfPig, ExtractionFacturX.cs) : suffit aux PDF/A-3 Factur-X.
 */
export function extraireXmlFacturX(pdf) {
  if (!pdf.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw new ErreurValidation(ERREUR_FE.PDF_ILLISIBLE, 'Le fichier n\'est pas un PDF.');
  }
  const texte = pdf.toString('latin1');
  const motif = /stream\r?\n/g;
  for (let m = motif.exec(texte); m; m = motif.exec(texte)) {
    const debut = m.index + m[0].length;
    const fin = texte.indexOf('endstream', debut);
    if (fin < 0) break;
    const brut = pdf.subarray(debut, fin);
    let contenu;
    try { contenu = inflateSync(brut); } catch { contenu = brut; }
    const tete = contenu.subarray(0, 4096).toString('utf8');
    if (tete.includes('CrossIndustryInvoice')) return contenu.toString('utf8').replace(/\s+$/, '');
    motif.lastIndex = fin;
  }
  throw new ErreurValidation(ERREUR_FE.XML_ABSENT, 'Aucun XML Factur-X (CrossIndustryInvoice) embarqué dans le PDF.');
}

/** Syntaxe, BT-24 et racine d'un document XML déjà chargé par SaxonJS. */
function decrire(doc) {
  const [ns, nom, specification] = SaxonJS.XPath.evaluate(
    `(namespace-uri(/*), local-name(/*), normalize-space(string((
       /*:CrossIndustryInvoice/*:ExchangedDocumentContext/*:GuidelineSpecifiedDocumentContextParameter/*:ID,
       /*/*:CustomizationID)[1])))`, doc, { resultForm: 'array' });
  if (ns === NS.CII && nom === 'CrossIndustryInvoice') return { syntaxe: SYNTAXE.CII, specification };
  if (ns === NS.UBL_INVOICE && nom === 'Invoice') return { syntaxe: SYNTAXE.UBL, specification, avoir: false };
  if (ns === NS.UBL_CREDIT_NOTE && nom === 'CreditNote') return { syntaxe: SYNTAXE.UBL, specification, avoir: true };
  if (ns === NS.CDAR && nom === 'CrossDomainAcknowledgementAndResponse') return { syntaxe: SYNTAXE.CDAR, specification: '' };
  if (ns === '' && nom === 'Report') return { syntaxe: SYNTAXE.FRR, specification: '' };
  throw new ErreurValidation(ERREUR_FE.SYNTAXE_INCONNUE, `Racine non reconnue : {${ns}}${nom}`);
}

// Identifiants BT-24 propres à Factur-X : le XML est contrôlé en Factur-X même hors PDF.
const SPECIFICATIONS_FACTUR_X = [SPECIFICATION_FACTURE.BASIC_WL, SPECIFICATION_FACTURE.BASIC,
  SPECIFICATION_FACTURE.EXTENDED, SPECIFICATION_FACTURE.EXTENDED_ZUGFERD];

/**
 * Contrôles à enchaîner pour une syntaxe et un profil (BT-24). Factur-X (PDF, option ou BT-24 Factur-X) : XSD et
 * schematron Factur-X du profil ; CII seul : XSD D22B et schematron EN16931 ; EXTENDED-CTC-FR : schematron dédié
 * (CII ou UBL) ; UBL : XSD Invoice ou CreditNote. Étape 3 : BR-FR-Flux2 standard (« fatal ») ou WARNING.
 */
export function controlesAEnchainer({ syntaxe, specification, avoir = false, facturX = false, warning = false }) {
  if (syntaxe === SYNTAXE.CDAR) {
    // CDAR : XSD CDAR D22B puis BR-FR-CDV (pas de schematron de profil).
    return { profil: PROFIL_FACTURE.NON_DEFINI, facturX: false, xsd: JEUX_XSD.CDAR_D22B, schematrons: [
      { etape: ETAPE_CONTROLE.FRANCE, schematron: warning ? SCHEMATRONS.BR_FR_CDV_WARNING : SCHEMATRONS.BR_FR_CDV }] };
  }
  if (syntaxe === SYNTAXE.FRR) {
    // E-reporting (flux 10) : XSD ereporting puis schematron Flux10 (pas de version WARNING).
    return { profil: PROFIL_FACTURE.NON_DEFINI, facturX: false, xsd: JEUX_XSD.FLUX10, schematrons: [
      { etape: ETAPE_CONTROLE.FRANCE, schematron: SCHEMATRONS.FLUX10 }] };
  }
  const S = SPECIFICATION_FACTURE;
  const ubl = syntaxe === SYNTAXE.UBL;
  const fx = !ubl && (facturX || SPECIFICATIONS_FACTUR_X.includes(specification));
  let profil, xsd, schematron;
  if (ubl) {
    xsd = avoir ? JEUX_XSD.UBL_CREDIT_NOTE : JEUX_XSD.UBL_INVOICE;
    if (specification === S.EXTENDED_CTC_FR) [profil, schematron] = [PROFIL_FACTURE.EXTENDED_CTC_FR, SCHEMATRONS.EXTENDED_CTC_FR_UBL];
    else if (specification.startsWith(S.EN16931)) [profil, schematron] = [PROFIL_FACTURE.EN16931, SCHEMATRONS.EN16931_UBL];
  } else {
    switch (specification) {
      case S.BASIC_WL:
        [profil, xsd, schematron] = [PROFIL_FACTURE.BASIC, JEUX_XSD.FACTUR_X_BASIC_WL, SCHEMATRONS.FACTUR_X_BASIC_WL]; break;
      case S.BASIC:
        [profil, xsd, schematron] = [PROFIL_FACTURE.BASIC, JEUX_XSD.FACTUR_X_EN16931, SCHEMATRONS.FACTUR_X_EN16931]; break;
      case S.EN16931:
        [profil, xsd, schematron] = fx
          ? [PROFIL_FACTURE.EN16931, JEUX_XSD.FACTUR_X_EN16931, SCHEMATRONS.FACTUR_X_EN16931]
          : [PROFIL_FACTURE.EN16931, JEUX_XSD.CII_D22B, SCHEMATRONS.EN16931_CII];
        break;
      case S.EXTENDED: case S.EXTENDED_ZUGFERD:
        [profil, xsd, schematron] = [PROFIL_FACTURE.EXTENDED_CTC_FR, JEUX_XSD.FACTUR_X_EXTENDED, SCHEMATRONS.FACTUR_X_EXTENDED]; break;
      case S.EXTENDED_CTC_FR:
        [profil, xsd, schematron] = [PROFIL_FACTURE.EXTENDED_CTC_FR, fx ? JEUX_XSD.FACTUR_X_EXTENDED : JEUX_XSD.CII_D22B,
          SCHEMATRONS.EXTENDED_CTC_FR_CII];
        break;
      default: break;
    }
  }
  if (!schematron) {
    throw new ErreurValidation(ERREUR_FE.PROFIL_INCONNU, `Profil (BT-24) non reconnu : ${specification || 'absent'}`);
  }
  const france = ubl
    ? (warning ? SCHEMATRONS.BR_FR_UBL_WARNING : SCHEMATRONS.BR_FR_UBL)
    : (warning ? SCHEMATRONS.BR_FR_CII_WARNING : SCHEMATRONS.BR_FR_CII);
  return { profil, facturX: fx, xsd, schematrons: [
    { etape: ETAPE_CONTROLE.PROFIL, schematron }, { etape: ETAPE_CONTROLE.FRANCE, schematron: france }] };
}

// Fichiers d'un jeu XSD, préchargés dans le système de fichiers de xmllint-wasm (imports relatifs résolus).
const fichiersXsd = new Map();
function fichiersDuJeu(jeu) {
  if (!fichiersXsd.has(jeu.dossier)) {
    const racine = join(DOSSIER_XSD, jeu.dossier);
    const lister = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? lister(join(d, n)) : [join(d, n)]));
    fichiersXsd.set(jeu.dossier, lister(racine).map((f) => ({
      fileName: `xsd/${relative(racine, f).replaceAll('\\', '/')}`, contents: readFileSync(f) })));
  }
  return fichiersXsd.get(jeu.dossier);
}

async function controlerXsd(xml, jeu) {
  const fichiers = fichiersDuJeu(jeu);
  const principal = fichiers.find((f) => f.fileName === `xsd/${jeu.principal}`);
  const res = await validateXML({
    xml: { fileName: 'document.xml', contents: xml },
    schema: principal,
    preload: fichiers.filter((f) => f !== principal),
    maxMemoryPages: 4096,
  });
  return res.errors.map((e) => ({
    etape: ETAPE_CONTROLE.XSD, niveau: NIVEAU_CONTROLE.FATAL, regle: ETAPE_CONTROLE.XSD,
    message: e.message.trim(), emplacement: e.loc ? `ligne ${e.loc.lineNumber}` : '',
  }));
}

// Feuilles chargées une fois par processus.
const feuilles = new Map();
async function feuille(schematron) {
  if (!feuilles.has(schematron)) {
    if (!sefAJour(schematron)) await compilerSchematrons({ schematrons: [schematron] });
    feuilles.set(schematron, JSON.parse(readFileSync(cheminSef(schematron), 'utf8')));
  }
  return feuilles.get(schematron);
}

const NIVEAUX = Object.values(NIVEAU_CONTROLE);
// Chemin SVRL allégé : « /*:Invoice[namespace-uri()='…'][1]/*:ID[…][1] » → « /Invoice[1]/ID[1] ».
const emplacementCourt = (chemin) => chemin.replace(/\*:/g, '').replace(/\[namespace-uri\(\)='[^']*'\]/g, '');

async function controlerSchematron(doc, etape, schematron) {
  const resultat = SaxonJS.transform({ stylesheetInternal: await feuille(schematron), sourceNode: doc,
    destination: 'document' }, 'sync');
  const constats = SaxonJS.XPath.evaluate(
    `for $c in //svrl:failed-assert | //svrl:successful-report return map {
       'flag': string($c/@flag), 'id': string($c/@id), 'texte': normalize-space(string($c/svrl:text)),
       'emplacement': string($c/@location) }`,
    resultat.principalResult, { namespaceContext: { svrl: 'http://purl.oclc.org/dsdl/svrl' }, resultForm: 'array' });
  return constats.map((c) => ({
    etape,
    // Assertion sans attribut flag (schematrons Factur-X) : erreur, comme le veut ISO Schematron.
    niveau: NIVEAUX.includes(c.flag) ? c.flag : NIVEAU_CONTROLE.FATAL,
    regle: c.id || basename(schematron, '.xslt'),
    message: c.texte,
    emplacement: emplacementCourt(c.emplacement),
  }));
}

/**
 * Valide une facture (CII, UBL, XML Factur-X ou PDF Factur-X), un CDAR ou un flux 10 d'e-reporting.
 * @param {string|Buffer} source chemin de fichier, ou contenu (Buffer d'un PDF ou d'un XML, chaîne XML)
 * @param {{ warning?: boolean, facturX?: boolean }} options `warning` : versions WARNING de BR-FR (réception jusqu'au
 *   1er octobre 2026) ; `facturX` : XML CII contrôlé comme XML d'un Factur-X (forcé pour un PDF)
 * @returns {Promise<{ syntaxe, profil, specification, facturX, valide, etapes, controles }>} `valide` : aucun
 *   contrôle fatal ; `controles` : liste { etape, niveau, regle, message, emplacement } ; `etapes` : { etape, controle,
 *   duree } (ms). Une erreur XSD arrête l'enchaînement (les schematrons supposent une structure valide).
 */
export async function validerFacture(source, { warning = false, facturX = false } = {}) {
  const contenu = typeof source === 'string' && !source.trimStart().startsWith('<') ? readFileSync(source) : source;
  const octets = typeof contenu === 'string' ? Buffer.from(contenu, 'utf8') : contenu;
  const pdf = octets.subarray(0, 1024).toString('latin1').includes('%PDF-');
  const xml = pdf ? extraireXmlFacturX(octets) : octets.toString('utf8').replace(/^﻿/, '');
  let doc;
  try {
    doc = await SaxonJS.getResource({ text: xml, type: 'xml' });
  } catch (e) {
    throw new ErreurValidation(ERREUR_FE.XML_ILLISIBLE, `XML illisible : ${e.message}`);
  }
  const description = decrire(doc);
  const plan = controlesAEnchainer({ ...description, facturX: facturX || pdf, warning });
  const syntaxe = plan.facturX ? SYNTAXE.FACTUR_X : description.syntaxe;
  const etapes = [];
  const controles = [];
  const chronometrer = async (etape, controle, fn) => {
    const debut = performance.now();
    const constats = await fn();
    etapes.push({ etape, controle, duree: Math.round(performance.now() - debut) });
    controles.push(...constats);
    return constats;
  };
  let xsdValide = true;
  if (plan.xsd) {
    const erreurs = await chronometrer(ETAPE_CONTROLE.XSD, plan.xsd.principal, () => controlerXsd(xml, plan.xsd));
    xsdValide = erreurs.length === 0;
  }
  if (xsdValide) {
    for (const { etape, schematron } of plan.schematrons) {
      await chronometrer(etape, basename(schematron), () => controlerSchematron(doc, etape, schematron));
    }
  }
  return {
    syntaxe, profil: plan.profil, specification: description.specification, facturX: plan.facturX,
    valide: !controles.some((c) => c.niveau === NIVEAU_CONTROLE.FATAL), etapes, controles,
  };
}

// Ligne de commande : npm run valider-facture -- <fichier> [--warning] [--facturx] [--json]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const fichiers = args.filter((a) => !a.startsWith('--'));
  const json = args.includes('--json');
  if (!fichiers.length) {
    console.error('Usage : npm run valider-facture -- <fichier.xml|fichier.pdf>… [--warning] [--facturx] [--json]');
    process.exit(2);
  }
  let echec = false;
  for (const f of fichiers) {
    // Les chemins relatifs sont ceux du dossier d'où npm a été lancé (INIT_CWD), pas celui du workspace.
    const chemin = resolve(process.env.INIT_CWD ?? process.cwd(), f);
    try {
      const r = await validerFacture(chemin, { warning: args.includes('--warning'), facturX: args.includes('--facturx') });
      echec ||= !r.valide;
      if (json) { console.log(JSON.stringify({ fichier: f, ...r }, null, 2)); continue; }
      const fatals = r.controles.filter((c) => c.niveau === NIVEAU_CONTROLE.FATAL).length;
      console.log(`${r.valide ? 'VALIDE  ' : 'INVALIDE'} ${f} : ${r.syntaxe} ${r.profil}, ${fatals} erreur(s) fatale(s), `
        + `${r.controles.length - fatals} avertissement(s) ; ${r.etapes.map((e) => `${e.controle} ${e.duree} ms`).join(', ')}`);
      for (const c of r.controles) console.log(`  [${c.etape} ${c.niveau}] ${c.regle} : ${c.message}${c.emplacement ? ` (${c.emplacement})` : ''}`);
    } catch (e) {
      echec = true;
      console.log(`ERREUR   ${f} : ${e.code ?? ''} ${e.message}`);
    }
  }
  process.exit(echec ? 1 : 0);
}
