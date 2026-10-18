// Ressources images de l'édition (§ 3.13) : PNG et JPEG seulement, contrôlés au dépôt par ce même script (navigateur
// et serveur). Dimensions et résolution lues dans l'entête du fichier, sans décoder l'image.

const u16 = (o, i) => (o[i] << 8) | o[i + 1];
const u32 = (o, i) => ((o[i] << 24) >>> 0) + (o[i + 1] << 16) + (o[i + 2] << 8) + o[i + 3];

/**
 * Contrôle d'une image : { type: 'png'|'jpeg', largeur, hauteur (pixels), dpi, orientation (EXIF) } ou { erreur }.
 */
export function lireImage(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets ?? []);
  if (o.length > 24 && o[0] === 0x89 && o[1] === 0x50 && o[2] === 0x4e && o[3] === 0x47) return lirePng(o);
  if (o.length > 4 && o[0] === 0xff && o[1] === 0xd8) return lireJpeg(o);
  if (o.length > 4 && o[0] === 0x3c) return { erreur: 'Format SVG refusé : exporter le logo en PNG haute résolution' };
  return { erreur: 'Format d’image non accepté : PNG ou JPEG seulement' };
}

function lirePng(o) {
  const largeur = u32(o, 16);
  const hauteur = u32(o, 20);
  let dpi = null;
  let i = 8;
  while (i + 8 < o.length) {
    const lg = u32(o, i);
    const type = String.fromCharCode(o[i + 4], o[i + 5], o[i + 6], o[i + 7]);
    if (type === 'pHYs' && o[i + 16] === 1) dpi = Math.round(u32(o, i + 8) * 0.0254);
    if (type === 'IDAT' || type === 'IEND') break;
    i += 12 + lg;
  }
  return { type: 'png', largeur, hauteur, dpi };
}

function lireJpeg(o) {
  let i = 2;
  let dpi = null;
  let orientation = 1;
  let progressif = false;
  let composantes = 3;
  let largeur = 0; let hauteur = 0;
  while (i + 4 < o.length) {
    if (o[i] !== 0xff) { i++; continue; }
    const marque = o[i + 1];
    if (marque === 0xd8 || (marque >= 0xd0 && marque <= 0xd7) || marque === 0x01) { i += 2; continue; }
    const lg = u16(o, i + 2);
    if (marque === 0xe0 && String.fromCharCode(...o.slice(i + 4, i + 9)) === 'JFIF\0') {
      const unite = o[i + 11];
      const x = u16(o, i + 12);
      if (unite === 1) dpi = x; else if (unite === 2) dpi = Math.round(x * 2.54);
    }
    if (marque === 0xe1 && String.fromCharCode(...o.slice(i + 4, i + 8)) === 'Exif') orientation = orientationExif(o, i + 10) ?? 1;
    if ((marque >= 0xc0 && marque <= 0xcf) && marque !== 0xc4 && marque !== 0xc8 && marque !== 0xcc) {
      progressif = marque === 0xc2 || marque === 0xc6 || marque === 0xca || marque === 0xce;
      hauteur = u16(o, i + 5);
      largeur = u16(o, i + 7);
      composantes = o[i + 9];
      break;
    }
    i += 2 + lg;
  }
  if (!largeur || !hauteur) return { erreur: 'JPEG illisible (dimensions introuvables)' };
  if (composantes === 4) return { erreur: 'JPEG CMJN refusé : enregistrer l’image en RVB' };
  // Photos de téléphone : orientations 5 à 8 = image tournée d'un quart de tour.
  const tournee = orientation >= 5 && orientation <= 8;
  return { type: 'jpeg', largeur: tournee ? hauteur : largeur, hauteur: tournee ? largeur : hauteur, dpi, orientation, progressif };
}

function orientationExif(o, debut) {
  const le = o[debut] === 0x49;
  const r16 = (i) => (le ? o[i] | (o[i + 1] << 8) : u16(o, i));
  const r32 = (i) => (le ? (o[i] | (o[i + 1] << 8) | (o[i + 2] << 16) | (o[i + 3] << 24)) >>> 0 : u32(o, i));
  const ifd = debut + r32(debut + 4);
  const n = r16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (r16(e) === 0x0112) return r16(e + 8);
  }
  return null;
}
