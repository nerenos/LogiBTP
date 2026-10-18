// Polices livrées avec le module (dossier `polices/`, licence OFL) : Inter (police par défaut de la charte) et
// Libre Barcode 39 (codes-barres Code 39).
import { Polices } from './polices.js';

export const FACES_EDITION = Object.freeze([
  { famille: 'Inter', graisse: 400, italique: false, fichier: 'inter/Inter-Regular.ttf' },
  { famille: 'Inter', graisse: 400, italique: true, fichier: 'inter/Inter-Italic.ttf' },
  { famille: 'Inter', graisse: 500, italique: false, fichier: 'inter/Inter-Medium.ttf' },
  { famille: 'Inter', graisse: 500, italique: true, fichier: 'inter/Inter-MediumItalic.ttf' },
  { famille: 'Inter', graisse: 600, italique: false, fichier: 'inter/Inter-SemiBold.ttf' },
  { famille: 'Inter', graisse: 600, italique: true, fichier: 'inter/Inter-SemiBoldItalic.ttf' },
  { famille: 'Inter', graisse: 700, italique: false, fichier: 'inter/Inter-Bold.ttf' },
  { famille: 'Inter', graisse: 700, italique: true, fichier: 'inter/Inter-BoldItalic.ttf' },
  { famille: 'Libre Barcode 39', graisse: 400, italique: false, fichier: 'libre-barcode-39/LibreBarcode39-Regular.ttf' },
]);

/** Polices de l'édition chargées par `lire(fichier)` → octets (Uint8Array) ou promesse d'octets. */
export async function chargerPolices(lire, faces = FACES_EDITION) {
  const polices = new Polices();
  for (const f of faces) polices.ajouter(f.famille, { graisse: f.graisse, italique: f.italique }, await lire(f.fichier));
  return polices;
}
