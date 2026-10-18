// Rendu PDF (pdf-lib, sans DOM) : même arbre de pages que l'aperçu. Exécuté dans le navigateur (hors ligne, aperçu
// téléchargé) et dans Jint côté serveur (impression tracée, GED). pdf-lib porte la structure du document, les polices
// (sous-ensembles, encodage par la même table caractère → glyphe que la mesure) et les images ; les flux de contenu
// des pages sont écrits ici en texte (beaucoup plus rapide dans Jint que les opérateurs de pdf-lib) avec des nombres
// formatés à trois décimales : mêmes entrées = mêmes octets, dans le navigateur comme dans Jint.
import { PDFDocument, PDFName } from 'pdf-lib';
import { fontkitEdition, cleFace } from './polices.js';
import { rectanglesQr } from './codes.js';
import { mmVersPt } from './unites.js';

/** Nombre PDF : trois décimales au plus, sans zéro inutile ni « -0 ». */
function nb(v) {
  const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

const composantes = (hex) => {
  const h = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '#000000'))?.[1] ?? '000000';
  return [0, 2, 4].map((i) => nb(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ');
};

/** Flux de contenu (caractères ASCII et octets de texte encodés en hexadécimal) → octets. */
function octetsTexte(s) {
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff;
  return o;
}

const tiret = (t) => (t.pointille ? `[${nb(mmVersPt(t.epaisseur * 4))} ${nb(mmVersPt(t.epaisseur * 3))}] 0 d ` : '');

/**
 * @param resultat { pages } (editer)
 * @param polices instance de Polices (octets des faces)
 * @param opts { ressources: { code: { type: 'png'|'jpeg', octets } }, titre, auteur, sujet, date (ISO),
 *               annexes ([Uint8Array] : PDF ajoutés à la fin), compresser (défaut vrai), deflate (compression zlib fournie par l'hôte, à la place de pako : Jint),
 *               chronos (objet rempli des durées) }
 * @returns Promise<Uint8Array>
 */
export async function produirePdf(resultat, polices, opts = {}) {
  const chronos = opts.chronos ?? null;
  let t0 = Date.now();
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkitEdition);
  const date = opts.date ? new Date(opts.date) : new Date(Date.UTC(2000, 0, 1));
  doc.setTitle(opts.titre ?? 'Édition', { showInWindowTitleBar: true });
  if (opts.auteur) doc.setAuthor(opts.auteur);
  if (opts.sujet) doc.setSubject(opts.sujet);
  doc.setCreator('LogiBTP');
  doc.setProducer('LogiBTP – module Édition');
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  doc.setLanguage('fr-FR');
  const compresser = opts.compresser !== false;

  const policesPdf = new Map();
  const policePdf = async (style) => {
    const f = polices.face(style);
    const cle = cleFace(f.famille, f.graisse, f.italique) + (style.tnum ? '|tnum' : '');
    let p = policesPdf.get(cle);
    if (!p) {
      p = await doc.embedFont(f.octets, { subset: true, features: style.tnum ? { tnum: true } : {} });
      policesPdf.set(cle, p);
    }
    return p;
  };
  const images = new Map();
  const imagePdf = async (code) => {
    if (images.has(code)) return images.get(code);
    const r = opts.ressources?.[code];
    let img = null;
    if (r?.octets) img = r.type === 'jpeg' ? await doc.embedJpg(r.octets) : await doc.embedPng(r.octets);
    images.set(code, img);
    return img;
  };

  for (const page of resultat.pages) {
    const H = mmVersPt(page.hauteur);
    const pg = doc.addPage([mmVersPt(page.largeur), H]);
    const noms = new Map(); // police ou image → nom de ressource de la page
    const nomPolice = (font) => {
      let n = noms.get(font);
      if (!n) { n = pg.node.newFontDictionary('F', font.ref).asString(); noms.set(font, n); }
      return n;
    };
    const nomImage = (img) => {
      let n = noms.get(img);
      if (!n) { n = pg.node.newXObject('Im', img.ref).asString(); noms.set(img, n); }
      return n;
    };
    const c = [];
    const X = (mm) => nb(mmVersPt(mm));
    const Y = (mm) => nb(H - mmVersPt(mm));
    for (const e of page.elements) {
      if (e.t === 'texte') {
        if (!e.texte) continue;
        const font = await policePdf(e.style);
        const hex = font.encodeText(e.texte).toString();
        let pos = `1 0 0 1 ${X(e.x)} ${Y(e.y)} Tm`;
        if (e.rotation) {
          const a = (-e.rotation * Math.PI) / 180;
          pos = `${nb(Math.cos(a))} ${nb(Math.sin(a))} ${nb(-Math.sin(a))} ${nb(Math.cos(a))} ${X(e.x)} ${Y(e.y)} Tm`;
        }
        c.push(`BT ${nomPolice(font)} ${nb(e.style.taille)} Tf ${composantes(e.style.couleur)} rg ${pos} ${hex} Tj ET`);
      } else if (e.t === 'rect') {
        const geo = `${X(e.x)} ${Y(e.y + e.h)} ${X(e.l)} ${X(e.h)} re`;
        if (e.fond) c.push(`q ${composantes(e.fond)} rg ${geo} f Q`);
        if (e.trait) c.push(`q ${composantes(e.trait.couleur)} RG ${X(e.trait.epaisseur)} w ${tiret(e.trait)}${geo} S Q`);
      } else if (e.t === 'ligne') {
        if (!e.trait) continue;
        c.push(`q ${composantes(e.trait.couleur)} RG ${X(e.trait.epaisseur)} w 0 J ${tiret(e.trait)}${X(e.x1)} ${Y(e.y1)} m ${X(e.x2)} ${Y(e.y2)} l S Q`);
      } else if (e.t === 'image') {
        const img = await imagePdf(e.ressource);
        if (!img) continue;
        const L = mmVersPt(e.l); const Hh = mmVersPt(e.h); const x = mmVersPt(e.x); const b = H - mmVersPt(e.y + e.h);
        // Matrice de l'image selon l'orientation EXIF (3 : demi-tour, 6 : quart horaire, 8 : quart antihoraire).
        const o = e.orientation ?? 1;
        const m = o === 6 ? [0, -L, Hh, 0, x, b + Hh] : o === 8 ? [0, L, -Hh, 0, x + L, b] : o === 3 ? [-L, 0, 0, -Hh, x + L, b + Hh] : [L, 0, 0, Hh, x, b];
        c.push(`q ${m.map(nb).join(' ')} cm ${nomImage(img)} Do Q`);
      } else if (e.t === 'qr') {
        const k = mmVersPt(e.module);
        const x0 = mmVersPt(e.x); const y0 = H - mmVersPt(e.y);
        const rects = rectanglesQr(e.rangees).map((r) => `${nb(x0 + r.x * k)} ${nb(y0 - (r.y + 1) * k)} ${nb(r.l * k)} ${nb(k)} re`).join(' ');
        c.push(`q 0 0 0 rg ${rects} f Q`);
      }
    }
    const contenu = c.join('\n');
    let flux;
    if (!compresser) flux = doc.context.stream(contenu);
    else if (opts.deflate) flux = doc.context.stream(opts.deflate(octetsTexte(contenu)), { Filter: 'FlateDecode' });
    else flux = doc.context.flateStream(contenu);
    pg.node.set(PDFName.of('Contents'), doc.context.register(flux));
  }
  // Annexes PDF (conditions générales, plans de la GED) ajoutées à la fin.
  for (const annexe of opts.annexes ?? []) {
    const source = await PDFDocument.load(annexe, { ignoreEncryption: true, updateMetadata: false });
    for (const pg of await doc.copyPages(source, source.getPageIndices())) doc.addPage(pg);
  }
  if (chronos) { chronos.dessin = Date.now() - t0; t0 = Date.now(); }
  const octets = await doc.save({ useObjectStreams: false });
  if (chronos) chronos.enregistrement = Date.now() - t0;
  return octets;
}
