// Lecture d'une archive zip dans le navigateur (et sous Node) : répertoire central, fichiers stockés ou compressés
// (deflate, décompressé par DecompressionStream). Pas de chiffrement ni de zip64 : les exports des logiciels de
// chiffrage n'en utilisent pas.

import { texte } from '@logibtp/socle/dictionnaire';

const SIG_FIN = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Fichiers de l'archive : [{ nom, taille, lire() → Promise<Uint8Array> }]. octets : ArrayBuffer ou Uint8Array. */
export function lireZip(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  const v = new DataView(o.buffer, o.byteOffset, o.byteLength);
  let fin = -1;
  for (let i = o.length - 22; i >= Math.max(0, o.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === SIG_FIN) { fin = i; break; }
  }
  if (fin < 0) throw new Error(texte('import.zip.central'));
  const nombre = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const decodeur = new TextDecoder();
  const fichiers = [];
  for (let k = 0; k < nombre; k++) {
    if (v.getUint32(p, true) !== SIG_CENTRAL) throw new Error(texte('import.zip.entree'));
    const drapeaux = v.getUint16(p + 8, true);
    const methode = v.getUint16(p + 10, true);
    const compresse = v.getUint32(p + 20, true);
    const taille = v.getUint32(p + 24, true);
    const lgNom = v.getUint16(p + 28, true);
    const lgExtra = v.getUint16(p + 30, true);
    const lgComm = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nom = decodeur.decode(o.subarray(p + 46, p + 46 + lgNom));
    p += 46 + lgNom + lgExtra + lgComm;
    if (nom.endsWith('/')) continue;
    fichiers.push({
      nom,
      taille,
      lire: async () => {
        if (drapeaux & 1) throw new Error(texte('import.zip.chiffre', { nom }));
        if (v.getUint32(local, true) !== SIG_LOCAL) throw new Error(texte('import.zip.locale', { nom }));
        const debut = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const donnees = o.subarray(debut, debut + compresse);
        if (methode === 0) return donnees.slice();
        if (methode !== 8) throw new Error(texte('import.zip.methode', { nom, methode }));
        const flux = new Blob([donnees]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(flux).arrayBuffer());
      },
    });
  }
  return fichiers;
}
