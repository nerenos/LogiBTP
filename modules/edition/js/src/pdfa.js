// Option PDF/A-3 (niveau B par défaut) du rendu PDF, générique : le module ne connaît aucun format de facture.
// L'appelant fournit les fichiers associés (octets, nom, type MIME, relation AFRelationship) et, s'il en a besoin,
// les schémas d'extension XMP de ses propriétés (déclarés dans pdfaExtension:schemas, comme l'exige PDF/A).
// Ajouts au document : métadonnées XMP (non compressées, UTF-8), OutputIntent sRGB (profil ICC livré ou fourni),
// fichiers incorporés (EmbeddedFiles, /AF du catalogue), identifiant du fichier (/ID) tiré des entrées : déterministe.
import { PDFName, PDFString, PDFHexString, PDFNumber } from 'pdf-lib';
import { base64VersOctets } from './base64.js';
import { PROFIL_SRGB_BASE64 } from './profil-srgb.js';

/** Relations autorisées par PDF/A-3 (ISO 19005-3, AFRelationship). */
export const RELATIONS_PDFA = Object.freeze(['Source', 'Data', 'Alternative', 'Supplement', 'Unspecified']);

const CONDITION_SRGB = 'sRGB IEC61966-2.1';
let profilSrgb = null;
/** Octets du profil ICC sRGB livré (lu une fois). */
export function profilSrgbLivre() {
  if (!profilSrgb) profilSrgb = base64VersOctets(PROFIL_SRGB_BASE64);
  return profilSrgb;
}

/** Chaîne → octets UTF-8 (TextEncoder absent de Jint). */
export function utf8(s) {
  const o = [];
  const t = String(s);
  for (let i = 0; i < t.length; i++) {
    let c = t.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < t.length) {
      const d = t.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) o.push(c);
    else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(o);
}

const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Date XMP (ISO 8601 en UTC, sans millisecondes) : même instant que les dates D: de pdf-lib (UTC, « Z »). */
const dateXmp = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Date PDF D:AAAAMMJJHHmmSSZ (UTC), comme pdf-lib pour le dictionnaire Info. */
const datePdf = (d) => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;

/** Empreinte de 16 octets (quatre FNV-1a 32 bits à graines distinctes) : identifiant /ID déterministe. */
export function empreinte16(morceaux) {
  const h = [0x811c9dc5, 0x01000193, 0x050c5d1f, 0x2b5f9e1d];
  const ajouter = (o) => {
    for (let i = 0; i < o.length; i++) {
      for (let k = 0; k < 4; k++) h[k] = Math.imul(h[k] ^ o[i] ^ (k * 0x55), 0x01000193) >>> 0;
    }
  };
  for (const m of morceaux) ajouter(typeof m === 'string' ? utf8(m) : m);
  return h.map((x) => x.toString(16).padStart(8, '0')).join('').toUpperCase();
}

/** Octets d'une entrée : Uint8Array (octets) ou chaîne base64 (base64, option venue du serveur en JSON). */
const octetsDe = (x) => (x?.octets instanceof Uint8Array ? x.octets : typeof x?.base64 === 'string' ? base64VersOctets(x.base64) : null);

/**
 * Vérifie et normalise l'option (erreur explicite en cas de fichier ou de relation invalide). Octets des fichiers et
 * du profil en Uint8Array (octets, icc) ou en base64 (base64, icc_base64) : même option en JSON depuis le serveur.
 */
export function normaliserPdfa(pdfa) {
  const partie = pdfa.partie ?? 3;
  const conformite = String(pdfa.conformite ?? 'B').toUpperCase();
  if (partie !== 3 || !['A', 'B', 'U'].includes(conformite)) throw new Error(`PDF/A : partie ${partie} ou conformité ${conformite} non prise en charge`);
  const fichiers = (pdfa.fichiers ?? []).map((f, i) => {
    const octets = octetsDe(f);
    if (!f?.nom || !octets) throw new Error(`PDF/A : fichier associé ${i + 1} sans nom ou sans octets`);
    const relation = f.relation ?? 'Unspecified';
    if (!RELATIONS_PDFA.includes(relation)) throw new Error(`PDF/A : relation ${relation} invalide (${RELATIONS_PDFA.join(', ')})`);
    return { nom: String(f.nom), octets, type: f.type ?? 'application/octet-stream', relation, description: f.description ?? '' };
  });
  const noms = new Set();
  for (const f of fichiers) {
    if (noms.has(f.nom)) throw new Error(`PDF/A : fichier associé ${f.nom} en double`);
    noms.add(f.nom);
  }
  return { partie, conformite, fichiers, schemas: pdfa.schemas ?? [], icc: pdfa.icc instanceof Uint8Array ? pdfa.icc : pdfa.icc_base64 ? base64VersOctets(pdfa.icc_base64) : null, condition: pdfa.condition ?? CONDITION_SRGB };
}

/**
 * Paquet XMP : Dublin Core, xmp, pdf, pdfaid, puis schémas d'extension de l'appelant (déclaration pdfaExtension et
 * valeurs). schemas : [{ schema (description), espace (URI), prefixe, proprietes: [{ nom, type ('Text'…),
 * categorie ('external' | 'internal'), description, valeur }] }].
 */
export function paquetXmp({ titre, auteur, sujet, createur, producteur, date, partie, conformite, schemas }) {
  const d = dateXmp(date);
  const l = [];
  l.push('<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>');
  l.push('<x:xmpmeta xmlns:x="adobe:ns:meta/">');
  l.push('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
  l.push('<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">');
  l.push('<dc:format>application/pdf</dc:format>');
  l.push(`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(titre)}</rdf:li></rdf:Alt></dc:title>`);
  if (auteur) l.push(`<dc:creator><rdf:Seq><rdf:li>${xml(auteur)}</rdf:li></rdf:Seq></dc:creator>`);
  if (sujet) l.push(`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xml(sujet)}</rdf:li></rdf:Alt></dc:description>`);
  l.push('</rdf:Description>');
  l.push('<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">');
  l.push(`<xmp:CreatorTool>${xml(createur)}</xmp:CreatorTool>`);
  l.push(`<xmp:CreateDate>${d}</xmp:CreateDate>`);
  l.push(`<xmp:ModifyDate>${d}</xmp:ModifyDate>`);
  l.push(`<xmp:MetadataDate>${d}</xmp:MetadataDate>`);
  l.push('</rdf:Description>');
  l.push('<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">');
  l.push(`<pdf:Producer>${xml(producteur)}</pdf:Producer>`);
  l.push('</rdf:Description>');
  l.push('<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">');
  l.push(`<pdfaid:part>${partie}</pdfaid:part>`);
  l.push(`<pdfaid:conformance>${conformite}</pdfaid:conformance>`);
  l.push('</rdf:Description>');
  if (schemas.length) {
    l.push('<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">');
    l.push('<pdfaExtension:schemas><rdf:Bag>');
    for (const s of schemas) {
      l.push('<rdf:li rdf:parseType="Resource">');
      l.push(`<pdfaSchema:schema>${xml(s.schema)}</pdfaSchema:schema>`);
      l.push(`<pdfaSchema:namespaceURI>${xml(s.espace)}</pdfaSchema:namespaceURI>`);
      l.push(`<pdfaSchema:prefix>${xml(s.prefixe)}</pdfaSchema:prefix>`);
      l.push('<pdfaSchema:property><rdf:Seq>');
      for (const p of s.proprietes ?? []) {
        l.push(`<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${xml(p.nom)}</pdfaProperty:name><pdfaProperty:valueType>${xml(p.type ?? 'Text')}</pdfaProperty:valueType><pdfaProperty:category>${xml(p.categorie ?? 'external')}</pdfaProperty:category><pdfaProperty:description>${xml(p.description)}</pdfaProperty:description></rdf:li>`);
      }
      l.push('</rdf:Seq></pdfaSchema:property>');
      l.push('</rdf:li>');
    }
    l.push('</rdf:Bag></pdfaExtension:schemas>');
    l.push('</rdf:Description>');
    for (const s of schemas) {
      const valeurs = (s.proprietes ?? []).filter((p) => p.valeur !== undefined && p.valeur !== null);
      if (!valeurs.length) continue;
      l.push(`<rdf:Description rdf:about="" xmlns:${s.prefixe}="${xml(s.espace)}">`);
      for (const p of valeurs) l.push(`<${s.prefixe}:${p.nom}>${xml(p.valeur)}</${s.prefixe}:${p.nom}>`);
      l.push('</rdf:Description>');
    }
  }
  l.push('</rdf:RDF>');
  l.push('</x:xmpmeta>');
  l.push('<?xpacket end="w"?>');
  return l.join('\n');
}

const estAscii = (s) => /^[\x20-\x7e]*$/.test(s);
const textePdf = (s) => (estAscii(s) ? PDFString.of(s.replace(/[\\()]/g, (c) => `\\${c}`)) : PDFHexString.fromText(s));

/**
 * Applique l'option au document pdf-lib (après les pages, avant l'enregistrement).
 * @param doc PDFDocument ; @param pdfa option normalisée ; @param infos { titre, auteur, sujet, createur, producteur,
 *        date (Date) } ; @param flux (octets, dict) → flux PDF (compressé ou non selon l'appelant) ; @param morceaux
 *        entrées de l'empreinte /ID (contenus des pages).
 */
export function appliquerPdfa(doc, pdfa, infos, flux, morceaux) {
  const ctx = doc.context;
  const catalogue = doc.catalog;

  // Métadonnées XMP, jamais compressées (PDF/A : pas de /Filter sur le flux de métadonnées).
  const xmp = utf8(paquetXmp({ ...infos, partie: pdfa.partie, conformite: pdfa.conformite, schemas: pdfa.schemas }));
  catalogue.set(PDFName.of('Metadata'), ctx.register(ctx.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })));

  // OutputIntent : profil RGB (les couleurs du rendu sont en DeviceRGB).
  const icc = pdfa.icc ?? profilSrgbLivre();
  const refIcc = ctx.register(flux(icc, { N: 3 }));
  const intention = ctx.obj({
    Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of(pdfa.condition),
    Info: PDFString.of(pdfa.condition), DestOutputProfile: refIcc,
  });
  catalogue.set(PDFName.of('OutputIntents'), ctx.obj([intention]));

  // Fichiers associés : flux EmbeddedFile (type MIME, date, taille), spécification de fichier avec AFRelationship,
  // arbre de noms EmbeddedFiles trié et tableau /AF du catalogue.
  if (pdfa.fichiers.length) {
    const dateD = PDFString.of(datePdf(infos.date));
    const specs = pdfa.fichiers.map((f) => {
      const refFlux = ctx.register(flux(f.octets, {
        Type: 'EmbeddedFile', Subtype: f.type,
        Params: ctx.obj({ Size: PDFNumber.of(f.octets.length), CreationDate: dateD, ModDate: dateD }),
      }));
      const spec = ctx.obj({
        Type: 'Filespec', F: textePdf(f.nom), UF: PDFHexString.fromText(f.nom),
        EF: ctx.obj({ F: refFlux, UF: refFlux }), AFRelationship: f.relation,
        ...(f.description ? { Desc: textePdf(f.description) } : {}),
      });
      return { nom: f.nom, ref: ctx.register(spec) };
    });
    const tries = [...specs].sort((a, b) => (a.nom < b.nom ? -1 : a.nom > b.nom ? 1 : 0));
    const noms = [];
    for (const s of tries) noms.push(PDFHexString.fromText(s.nom), s.ref);
    catalogue.set(PDFName.of('Names'), ctx.obj({ EmbeddedFiles: ctx.obj({ Names: ctx.obj(noms) }) }));
    catalogue.set(PDFName.of('AF'), ctx.obj(specs.map((s) => s.ref)));
  }

  // Identifiant du fichier (/ID du trailer, exigé par PDF/A) : empreinte des entrées, mêmes octets partout.
  const id = empreinte16([
    infos.titre ?? '', infos.auteur ?? '', infos.sujet ?? '', dateXmp(infos.date), ...morceaux,
    ...pdfa.fichiers.flatMap((f) => [f.nom, f.relation, f.type, f.octets]),
  ]);
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
}
