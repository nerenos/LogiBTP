import { extension } from './fichiers.js';

// Lecture d'un mail déposé (.eml standard, .msg Outlook) : objet, expéditeur, destinataires, date, message et pièces
// jointes. Les bibliothèques ne sont chargées qu'au premier mail déposé.

const adresse = (a) => (a ? (a.name ? `${a.name} <${a.address ?? ''}>` : a.address ?? '') : '');
const adresses = (l) => (l ?? []).map(adresse).filter(Boolean).join(', ');

/** Texte brut d'un message HTML (pour l'affichage et la recherche). */
export function texteDeHtml(html) {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function lireEml(octets) {
  const { default: PostalMime } = await import('postal-mime');
  const m = await PostalMime.parse(octets);
  return {
    objet: m.subject ?? '',
    de: adresse(m.from),
    a: adresses(m.to),
    cc: adresses(m.cc),
    date: m.date ? new Date(m.date).toISOString() : null,
    message: m.text?.trim() || texteDeHtml(m.html),
    pieces: (m.attachments ?? []).filter((p) => p.disposition !== 'inline' || p.filename).map((p, i) => ({
      nom: p.filename || `piece-${i + 1}`, type: p.mimeType || 'application/octet-stream',
      contenu: p.content instanceof ArrayBuffer ? new Uint8Array(p.content) : new TextEncoder().encode(String(p.content ?? '')),
    })),
  };
}

async function lireMsg(octets) {
  const { default: MsgReader } = await import('@kenjiuno/msgreader');
  const lecteur = new MsgReader(octets);
  const m = lecteur.getFileData();
  const dest = (m.recipients ?? []);
  const liste = (type) => dest.filter((r) => (r.recipType ?? 'to') === type).map((r) => (r.name && r.email ? `${r.name} <${r.email}>` : r.email || r.name)).join(', ');
  return {
    objet: m.subject ?? '',
    de: m.senderName ? `${m.senderName}${m.senderEmail ? ` <${m.senderEmail}>` : ''}` : m.senderEmail ?? '',
    a: liste('to'),
    cc: liste('cc'),
    date: m.messageDeliveryTime || m.clientSubmitTime ? new Date(m.messageDeliveryTime || m.clientSubmitTime).toISOString() : null,
    message: m.body?.trim() || texteDeHtml(m.bodyHtml),
    pieces: (m.attachments ?? []).filter((p) => !p.attachmentHidden).map((p, i) => {
      const a = lecteur.getAttachment(p);
      return { nom: a.fileName || p.fileName || `piece-${i + 1}`, type: p.attachMimeTag || 'application/octet-stream', contenu: a.content };
    }),
  };
}

/** Lecture d'un fichier mail : { objet, de, a, cc, date, message, pieces: [{ nom, type, contenu }] }. */
export async function lireMail(fichier) {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  return extension(fichier.name) === 'msg' ? lireMsg(octets.buffer) : lireEml(octets);
}
