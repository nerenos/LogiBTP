import { motsRecherche, normaliser } from './normaliser.js';

// Sémantique des requêtes de liste (référence du serveur, utilisée par le fournisseur en mémoire et les jeux
// de test partagés modules/liste/tests/cas) :
//   types       types d'élément du thème de la vue (vide = tous) : la ligne doit être de l'un de ces types
//   filtres     filtres fixes de la vue (définition) : toujours appliqués, en ET, avant tout le reste
//   recherche   chaque mot doit être contenu (sans casse ni accents) dans au moins une colonne de recherche,
//               sur le texte brut de la donnée (valeur::text côté SQL)
//   segments    { colonne: [valeurs] } : la valeur (en texte, null = vide) doit être l'une des valeurs retenues ;
//               colonne multivaluée (tableau) : l'une de ses valeurs doit être retenue (null = tableau vide ou absent)
//   tri         [{ colonne, sens }] puis identifiant croissant ; vides toujours en dernier
//   pagination  par clé (keyset) : le curseur est la liste des valeurs de tri de la dernière ligne, puis son ID

const estVide = (v) => v === null || v === undefined;

/** Texte brut d'une donnée, comme valeur::text en SQL (tableau : valeurs jointes par « , », comme array_to_string). */
export function texteBrut(v) {
  if (estVide(v)) return null;
  if (Array.isArray(v)) return v.filter((x) => !estVide(x)).map(String).join(', ');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/**
 * Colonne d'état d'utilisation des sources (A en service, N ne plus utiliser, S en sommeil) : une source qui la porte
 * masque les lignes en sommeil, sauf si la vue les montre (définition `sommeil: true`). Même règle que
 * ConstructeurRequete.FiltresEffectifs côté C#.
 */
export const COLONNE_USAGE = 'usage';

/**
 * Filtres fixes effectifs d'une vue : les siens (colonnes connues), plus le masquage des lignes en sommeil (opérateur
 * interne `sommeil` : usage différent de S, vide compris) si la source a l'état d'utilisation.
 */
export function filtresEffectifs(definition, connues) {
  const filtres = (definition.filtres ?? []).filter((f) => connues.has(f.colonne));
  if (connues.has(COLONNE_USAGE) && !definition.sommeil) filtres.push({ colonne: COLONNE_USAGE, op: 'sommeil' });
  return filtres;
}

/** Opérateurs des filtres fixes d'une vue (même liste que ConstructeurRequete.OperateursVue côté C#). */
export const OPERATEURS_VUE = [
  ['=', 'égal à'], ['<>', 'différent de'], ['>', 'supérieur à'], ['>=', 'supérieur ou égal à'], ['<', 'inférieur à'],
  ['<=', 'inférieur ou égal à'], ['entre', 'entre'], ['contient', 'contient'], ['commence', 'commence par'],
  ['finit', 'se termine par'], ['dans', 'parmi (valeurs séparées par ;)'], ['vide', 'est vide'], ['nonvide', 'n\'est pas vide'],
  ['vrai', 'est coché (vrai)'], ['faux', 'n\'est pas coché (faux)'],
];

const vraiTexte = (v) => ['true', 'vrai', '1', 'oui', 't'].includes(String(v ?? '').trim().toLowerCase());

/** Comparaison d'une donnée avec la valeur saisie dans le filtre (nombre, booléen ou texte). */
function comparerFiltre(v, ref) {
  if (typeof v === 'number') return v - Number(String(ref ?? '').replace(',', '.'));
  if (typeof v === 'boolean') return Number(v) - Number(vraiTexte(ref));
  return comparerCle(String(v), String(ref ?? ''));
}

/** La ligne satisfait-elle un filtre fixe de la vue ({ colonne, op, valeur, valeur2, valeurs }) ? */
export function correspondFiltreVue(ligne, f) {
  const v = ligne[f.colonne];
  const vide = v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  const texte = normaliser(texteBrut(v) ?? '');
  switch (f.op) {
    case 'sommeil': return v !== 'S';
    case 'vide': return vide;
    case 'nonvide': return !vide;
    case 'vrai': return v === true;
    case 'faux': return v === false;
    case 'dans':
      if (Array.isArray(v)) return v.some((e) => (f.valeurs ?? []).some((x) => String(e) === String(x)));
      return !estVide(v) && (f.valeurs ?? []).some((x) => texteBrut(v) === String(x));
    case 'contient': return !estVide(v) && texte.includes(normaliser(f.valeur));
    case 'commence': return !estVide(v) && texte.startsWith(normaliser(f.valeur));
    case 'finit': return !estVide(v) && texte.endsWith(normaliser(f.valeur));
    default: break;
  }
  if (estVide(v)) return false;
  const c = comparerFiltre(v, f.valeur);
  switch (f.op) {
    case '=': return c === 0;
    case '<>': return c !== 0;
    case '>': return c > 0;
    case '>=': return c >= 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    case 'entre': return c >= 0 && comparerFiltre(v, f.valeur2) <= 0;
    default: return false;
  }
}

export function filtrer(lignes, { recherche, segments, filtres, types }, colonnesRecherche) {
  const mots = motsRecherche(recherche ?? '');
  const seg = Object.entries(segments ?? {}).filter(([, v]) => Array.isArray(v) && v.length);
  return lignes.filter((l) => {
    if (types?.length && !types.includes(String(l._type))) return false;
    if (filtres?.length && !filtres.every((f) => correspondFiltreVue(l, f))) return false;
    for (const [col, valeurs] of seg) {
      if (Array.isArray(l[col]) || (l[col] === null && valeurs.some((v) => v === null))) {
        if (!correspondSegmentTableau(l[col], valeurs)) return false;
        continue;
      }
      const t = texteBrut(l[col]);
      if (!valeurs.some((v) => (v === null ? t === null : t === String(v)))) return false;
    }
    if (!mots.length) return true;
    const textes = colonnesRecherche.map((c) => normaliser(texteBrut(l[c]) ?? ''));
    return mots.every((m) => textes.some((t) => t.includes(m)));
  });
}

/** Segment sur une colonne multivaluée : l'une des valeurs retenue, ou null retenu et tableau vide ou absent. */
function correspondSegmentTableau(v, valeurs) {
  const elements = (v ?? []).filter((x) => !estVide(x)).map(String);
  return valeurs.some((x) => (x === null ? elements.length === 0 : elements.includes(String(x))));
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

/**
 * Comptes par valeur d'une colonne de segment (texte brut, null = vide), triés par valeur ; colonne multivaluée :
 * chaque valeur du tableau est comptée (tableau vide = vide).
 */
export function comptesSegment(lignes, colonne) {
  const m = new Map();
  const compter = (t) => m.set(t, (m.get(t) ?? 0) + 1);
  for (const l of lignes) {
    const v = l[colonne];
    if (Array.isArray(v)) {
      const elements = [...new Set(v.filter((x) => !estVide(x)).map(String))];
      if (!elements.length) compter(null);
      elements.forEach(compter);
    } else compter(texteBrut(v));
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
