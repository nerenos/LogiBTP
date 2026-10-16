import { extension } from './fichiers.js';

// Extraction du texte d'un contenu pour l'indexation plein texte et la classification, côté navigateur (fournisseur
// mémoire : démo hors ligne, tests). Le serveur extrait avec ExtractionTexte.cs (PdfPig pour les PDF, bureautique) ;
// ici : textes, HTML, mails .eml et PDF simples (chaînes des opérateurs Tj / TJ, flux non compressés ou Flate).

export const ETATS_INDEX = Object.freeze({ A_FAIRE: 'A_FAIRE', FAIT: 'FAIT', SANS_TEXTE: 'SANS_TEXTE', ECHEC: 'ECHEC' });
export const TEXTE_MAX = 1_000_000;

const TEXTES = ['txt', 'csv', 'md', 'json', 'xml', 'log', 'eml'];

const nettoyer = (t) => String(t ?? '').replace(/\0/g, '').replace(/[ \t\r\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, TEXTE_MAX);

const html = (t) => t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function inflate(octets) {
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

const latin1 = (octets) => Array.from(octets, (o) => String.fromCharCode(o)).join('');

/** Chaînes PDF littérales d'un flux de contenu (Tj, TJ, ', "). */
function chainesPdf(flux) {
  const morceaux = [];
  const chaine = /\((?:\\.|[^\\)])*\)/g;
  for (const bloc of flux.match(/\[(?:[^\]]*)\]\s*TJ|\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")/g) ?? []) {
    morceaux.push((bloc.match(chaine) ?? []).map((s) => s.slice(1, -1)
      .replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[e] ?? String.fromCharCode(parseInt(e, 8))))).join(''));
  }
  return morceaux.join('\n');
}

async function pdf(blob) {
  const octets = new Uint8Array(await blob.arrayBuffer());
  const texte = latin1(octets);
  const parties = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  for (let m = re.exec(texte); m; m = re.exec(texte)) {
    const debut = m.index + m[0].length;
    const fin = texte.indexOf('endstream', debut);
    if (fin < 0) break;
    let contenu = octets.subarray(debut, fin);
    if (/\/FlateDecode/.test(m[1])) {
      try { contenu = await inflate(contenu); } catch { continue; }
    } else if (/\/Filter/.test(m[1])) continue;
    parties.push(chainesPdf(latin1(contenu)));
    re.lastIndex = fin;
  }
  return parties.join('\n');
}

/** → { texte, etat } (texte null si rien d'extrait). */
export async function extraireTexte(blob, nomFichier, typeMime = '') {
  const ext = extension(nomFichier);
  try {
    let texte = null;
    if (ext === 'pdf') texte = await pdf(blob);
    else if (ext === 'html' || ext === 'htm') texte = html(await blob.text());
    else if (TEXTES.includes(ext) || /^text\//.test(typeMime ?? '')) texte = await blob.text();
    texte = nettoyer(texte);
    return texte ? { texte, etat: ETATS_INDEX.FAIT } : { texte: null, etat: ETATS_INDEX.SANS_TEXTE };
  } catch {
    return { texte: null, etat: ETATS_INDEX.ECHEC };
  }
}
