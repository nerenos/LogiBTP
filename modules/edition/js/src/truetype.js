// Polices intégrées aux PDF : sous-ensembles TrueType rendus conformes pour tous les lecteurs (Acrobat compris).
// Le découpage de fontkit écrit la signature Apple « true » et des sommes de contrôle nulles ; une police intégrée
// doit porter la signature 0x00010000, des sommes de contrôle exactes par table et l'ajustement de la table head
// (spécification OpenType), et son nom PDF un préfixe de sous-ensemble de six majuscules (ISO 32000, § 9.6.4).

const u32 = (o, i) => ((o[i] << 24) >>> 0) + (o[i + 1] << 16) + (o[i + 2] << 8) + o[i + 3];
const ecrire32 = (o, i, v) => { o[i] = (v >>> 24) & 255; o[i + 1] = (v >>> 16) & 255; o[i + 2] = (v >>> 8) & 255; o[i + 3] = v & 255; };

/** Somme de contrôle OpenType : somme des mots de 32 bits (gros-boutiste), zone complétée par des zéros. */
function somme(o, debut, longueur) {
  let s = 0;
  const fin = debut + longueur;
  for (let i = debut; i < fin; i += 4) {
    const mot = ((o[i] ?? 0) * 16777216) + (((i + 1 < fin ? o[i + 1] : 0) ?? 0) << 16) + (((i + 2 < fin ? o[i + 2] : 0) ?? 0) << 8) + ((i + 3 < fin ? o[i + 3] : 0) ?? 0);
    s = (s + mot) >>> 0;
  }
  return s;
}

/**
 * Police TrueType normalisée (copie) : signature 0x00010000, sommes de contrôle des tables, ajustement de head.
 * Un fichier qui n'est pas une police TrueType est rendu tel quel.
 */
export function normaliserTrueType(octets) {
  const o = new Uint8Array(octets);
  if (o.length < 12) return o;
  const signature = u32(o, 0);
  const TRUE = 0x74727565; // « true »
  if (signature !== TRUE && signature !== 0x00010000) return o;
  ecrire32(o, 0, 0x00010000);
  const nb = (o[4] << 8) | o[5];
  let head = -1;
  for (let t = 0; t < nb; t++) {
    const e = 12 + t * 16;
    const tag = String.fromCharCode(o[e], o[e + 1], o[e + 2], o[e + 3]);
    const debut = u32(o, e + 8);
    const longueur = u32(o, e + 12);
    if (tag === 'head') { head = debut; ecrire32(o, debut + 8, 0); }
    ecrire32(o, e + 4, somme(o, debut, longueur));
  }
  if (head >= 0) ecrire32(o, head + 8, (0xB1B0AFBA - somme(o, 0, o.length)) >>> 0);
  return o;
}

/** Préfixe de sous-ensemble déterministe (six majuscules) tiré du nom de la face : mêmes octets partout. */
export function prefixeSousEnsemble(nom) {
  let h = 2166136261;
  for (const c of nom) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  let s = '';
  for (let i = 0; i < 6; i++) { s += String.fromCharCode(65 + (h % 26)); h = Math.floor(h / 26) + (i + 1) * 7919; }
  return s;
}
