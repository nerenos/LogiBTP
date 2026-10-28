// Types de fichiers : aperçu possible (images, PDF, textes, mails) ou téléchargement, icônes, tailles.
import { dateLocale } from '@logibtp/socle';

const EXTENSIONS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
  pdf: ['pdf'],
  texte: ['txt', 'csv', 'log', 'md', 'json', 'xml'],
  mail: ['eml', 'msg'],
};

export const extension = (nom) => (/\.([a-z0-9]+)$/i.exec(String(nom ?? ''))?.[1] ?? '').toLowerCase();

/** Genre d'aperçu d'un fichier : 'image', 'pdf', 'texte', 'mail' ou null (téléchargement seulement). */
export function genreApercu(nomFichier, typeMime = '') {
  const ext = extension(nomFichier);
  for (const [genre, liste] of Object.entries(EXTENSIONS)) if (liste.includes(ext)) return genre;
  if (/^image\//.test(typeMime)) return 'image';
  if (typeMime === 'application/pdf') return 'pdf';
  if (/^text\//.test(typeMime)) return 'texte';
  return null;
}

export const estMail = (nomFichier) => ['eml', 'msg'].includes(extension(nomFichier));

export function icone(doc) {
  if (doc.nature === 'mail') return '✉️';
  const ext = extension(doc.version?.nom_fichier ?? doc.nom_fichier);
  if (EXTENSIONS.image.includes(ext)) return '🖼️';
  if (ext === 'pdf') return '📕';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return '📗';
  if (['zip', '7z', 'rar'].includes(ext)) return '🗜️';
  if (['dwg', 'dxf'].includes(ext)) return '📐';
  return '📄';
}

export function formatTaille(octets) {
  if (octets === null || octets === undefined) return '';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  let v = Number(octets), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}

/** Titre proposé pour un fichier déposé : nom sans extension, séparateurs remplacés par des espaces. */
export const titreDepuisNom = (nom) => String(nom ?? '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

/** Date du fichier (dernière modification) au format ISO, sinon aujourd'hui. */
export const dateDepuisFichier = (f) => dateLocale(f?.lastModified || Date.now());
