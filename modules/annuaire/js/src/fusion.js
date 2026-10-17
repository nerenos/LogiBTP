// Fusion d'une personne (tiers provisoire) dans une autre : valeurs retenues champ par champ. Réplique de
// PlanFusion.cs (jeu tests/cas/04_fusion.json). Les fiches sont des lignes de la table personne (colonnes per_*) ;
// le cœur ajoute ses colonnes (per_cli_*…), toutes fusionnables sauf les colonnes techniques ci-dessous.
//
// Règle : pour chaque colonne, la valeur choisie (choix[colonne] = 'source' | 'cible'), sinon celle de la cible, ou
// celle de la source quand la cible est vide (null, texte vide). Un booléen n'est jamais vide. Conflit : les deux sont
// renseignées et diffèrent (comparaison sur le texte, nombres sans zéros inutiles). Relations (casquettes) : union,
// dans l'ordre de la cible. Champs supplémentaires (per_proprietes) : même règle par clé (choix['+cle']).

/** Colonnes jamais fusionnées : identité de la fiche, hiérarchie, statut provisoire, dates techniques. */
export const COLONNES_NON_FUSIONNEES = [
  'per_id', 'per_code', 'per_parent_id', 'per_casquettes', 'per_proprietes', 'per_societe_base', 'per_cree_le', 'per_modifie_le',
  'per_provisoire', 'per_provisoire_par', 'per_provisoire_le', 'per_valide_par', 'per_valide_le',
];

const NOMBRE = /^-?\d+(\.\d+)?$/;

/** Texte de comparaison d'une valeur : nombres sans zéros inutiles, booléens en true / false. */
export function texteFusion(v) {
  if (v === null || v === undefined) return '';
  const t = String(v).trim();
  if (NOMBRE.test(t) && t.includes('.')) return t.replace(/0+$/, '').replace(/\.$/, '');
  return t;
}

const vide = (v) => typeof v !== 'boolean' && texteFusion(v) === '';

function choisir(cle, s, k, choix, conflits) {
  if (!vide(s) && !vide(k) && texteFusion(s) !== texteFusion(k)) conflits.push(cle);
  if (choix[cle] === 'source') return s ?? null;
  if (choix[cle] === 'cible') return k ?? null;
  return vide(k) ? s ?? null : k;
}

/**
 * Plan de fusion. source, cible : lignes de personne { per_…: valeur, per_casquettes: [codes], per_proprietes: {} } ;
 * choix : { colonne | '+cle': 'source' | 'cible' }. Renvoie { valeurs : colonnes à écrire sur la cible (celles qui
 * changent), casquettes, proprietes, conflits : colonnes puis '+cle', triés }.
 */
export function planFusion(source, cible, choix = {}) {
  const conflits = [];
  const valeurs = {};
  const colonnes = [...new Set([...Object.keys(cible ?? {}), ...Object.keys(source ?? {})])]
    .filter((c) => c.startsWith('per_') && !COLONNES_NON_FUSIONNEES.includes(c)).sort();
  for (const c of colonnes) {
    const v = choisir(c, source?.[c], cible?.[c], choix, conflits);
    if (texteFusion(v) !== texteFusion(cible?.[c]) || (typeof v === 'boolean' && v !== cible?.[c])) valeurs[c] = v;
  }
  const ps = source?.per_proprietes ?? {}, pk = cible?.per_proprietes ?? {};
  const proprietes = {};
  for (const cle of [...new Set([...Object.keys(pk), ...Object.keys(ps)])].sort()) {
    const v = choisir(`+${cle}`, ps[cle], pk[cle], choix, conflits);
    if (v !== null && v !== undefined) proprietes[cle] = v;
  }
  const casquettes = [...(cible?.per_casquettes ?? [])];
  for (const c of source?.per_casquettes ?? []) if (!casquettes.includes(c)) casquettes.push(c);
  return { valeurs, casquettes, proprietes, conflits };
}

/** Mots sans portée pour repérer un doublon de nom (formes juridiques, articles), en minuscules. */
export const MOTS_IGNORES_DOUBLON = [
  'sa', 'sas', 'sasu', 'sarl', 'eurl', 'sci', 'snc', 'scop', 'selarl', 'gie', 'ei', 'eirl', 'scp',
  'societe', 'société', 'ets', 'etablissements', 'établissements', 'entreprise', 'groupe',
  'et', 'de', 'des', 'du', 'la', 'le', 'les', 'l', 'd', 'the', 'and',
];

/**
 * Mots d'un nom (raison sociale) comparés pour repérer un doublon : séparés par tout ce qui n'est ni lettre ni chiffre,
 * en minuscules, sans les formes juridiques ni les articles, d'au moins deux caractères. Chaque mot doit se retrouver
 * (sans accents ni casse) dans la raison sociale ou le nom commercial d'une fiche existante.
 */
export function motsDoublon(nom) {
  return String(nom ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((m) => m.length >= 2 && !MOTS_IGNORES_DOUBLON.includes(m));
}
