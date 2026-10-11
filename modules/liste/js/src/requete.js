import { motsRecherche, normaliser } from './normaliser.js';

// Sémantique des requêtes de liste (référence du serveur, utilisée par le fournisseur en mémoire et les jeux
// de test partagés modules/liste/tests/cas) :
//   recherche   chaque mot doit être contenu (sans casse ni accents) dans au moins une colonne de recherche,
//               sur le texte brut de la donnée (valeur::text côté SQL)
//   segments    { colonne: [valeurs] } : la valeur (en texte, null = vide) doit être l'une des valeurs retenues
//   tri         [{ colonne, sens }] puis identifiant croissant ; vides toujours en dernier
//   pagination  par clé (keyset) : le curseur est la liste des valeurs de tri de la dernière ligne, puis son ID

const estVide = (v) => v === null || v === undefined;

/** Texte brut d'une donnée, comme valeur::text en SQL. */
export function texteBrut(v) {
  if (estVide(v)) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

export function filtrer(lignes, { recherche, segments }, colonnesRecherche) {
  const mots = motsRecherche(recherche ?? '');
  const seg = Object.entries(segments ?? {}).filter(([, v]) => Array.isArray(v) && v.length);
  return lignes.filter((l) => {
    for (const [col, valeurs] of seg) {
      const t = texteBrut(l[col]);
      if (!valeurs.some((v) => (v === null ? t === null : t === String(v)))) return false;
    }
    if (!mots.length) return true;
    const textes = colonnesRecherche.map((c) => normaliser(texteBrut(l[c]) ?? ''));
    return mots.every((m) => textes.some((t) => t.includes(m)));
  });
}

/** Comparaison de deux valeurs de tri non vides : nombres, booléens, puis textes. */
export function comparerCle(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Clé de tri d'une ligne : valeurs des colonnes de tri, puis ID. */
export const cleTri = (ligne, tri) => [...tri.map((t) => ligne[t.colonne] ?? null), ligne._id];

/** Compare deux clés de tri (vides en dernier quel que soit le sens, ID croissant en dernier recours). */
export function comparerCles(ka, kb, tri) {
  for (let i = 0; i < tri.length; i++) {
    const a = ka[i], b = kb[i];
    const va = estVide(a), vb = estVide(b);
    if (va || vb) {
      if (va !== vb) return va ? 1 : -1;
      continue;
    }
    const c = comparerCle(a, b);
    if (c !== 0) return tri[i].sens === 'desc' ? -c : c;
  }
  return comparerCle(ka[tri.length], kb[tri.length]);
}

export function trier(lignes, tri) {
  return [...lignes].sort((a, b) => comparerCles(cleTri(a, tri), cleTri(b, tri), tri));
}

/** Lot suivant : lignes strictement après le curseur, dans l'ordre de tri. */
export function lot(lignesTriees, tri, apres, taille) {
  const debut = apres ? lignesTriees.findIndex((l) => comparerCles(cleTri(l, tri), apres, tri) > 0) : 0;
  const lignes = debut < 0 ? [] : lignesTriees.slice(debut, debut + taille);
  const suite = debut >= 0 && debut + taille < lignesTriees.length && lignes.length ? cleTri(lignes.at(-1), tri) : null;
  return { lignes, suite };
}

/** Lignes jusqu'au curseur inclus (contrôle des lignes chargées), toutes si curseur nul. */
export function jusqua(lignesTriees, tri, curseur) {
  return curseur ? lignesTriees.filter((l) => comparerCles(cleTri(l, tri), curseur, tri) <= 0) : lignesTriees;
}

/** Comptes par valeur d'une colonne de segment (texte brut, null = vide), triés par valeur. */
export function comptesSegment(lignes, colonne) {
  const m = new Map();
  for (const l of lignes) {
    const t = texteBrut(l[colonne]);
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return [...m].map(([valeur, nombre]) => ({ valeur, nombre }))
    .sort((a, b) => (a.valeur === null ? 1 : b.valeur === null ? -1 : comparerCle(a.valeur, b.valeur)));
}

/** Empreinte d'une ligne (détection des modifications) : opaque, calculée par le serveur en md5. */
export function empreinte(ligne) {
  const s = JSON.stringify(ligne);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
