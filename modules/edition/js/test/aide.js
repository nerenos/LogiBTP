// Outils des tests : polices de l'édition lues sur le disque.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chargerPolices } from '../src/index.js';

const dossier = fileURLToPath(new URL('../polices/', import.meta.url));
let cache = null;
export async function polices() {
  if (!cache) cache = await chargerPolices((f) => new Uint8Array(readFileSync(dossier + f)));
  return cache;
}
