// Correspondances entre les valeurs d'un fichier importé et les référentiels de l'application (unités, natures,
// taux de TVA, listes de choix). Les référentiels sont fournis par l'application dans une forme neutre.

/** Texte comparable : sans accents, majuscules, lettres et chiffres seulement. */
export const normaliser = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const SYNONYMES_UNITE = {
  M2: ['M²', 'MCARRE', 'MQ'], M3: ['M³', 'MCUBE'], ML: ['MLIN', 'METRELINEAIRE'], U: ['UNITE', 'UN', 'P', 'PIECE'],
  FT: ['FORFAIT', 'FF', 'FFT', 'FORF'], ENS: ['ENSEMBLE'], H: ['HEURE', 'HR'], J: ['JOUR', 'JR'], T: ['TONNE', 'TN'],
  KG: ['KILO'], L: ['LITRE', 'LT'], PCE: ['PC', 'PCS'], SEM: ['SEMAINE'], MOIS: ['MS'],
};

/**
 * Code d'unité de l'application pour une unité importée (unites : [{ code, libelle, synonymes? }] ; synonymes
 * paramétrés de l'unité, puis ceux du module) ; null si inconnue.
 */
export function associerUnite(valeur, unites) {
  const cle = (s) => normaliser(String(s ?? '').replace('²', '2').replace('³', '3'));
  const v = cle(valeur);
  if (!v) return null;
  const direct = unites.find((u) => normaliser(u.code) === v || normaliser(u.libelle) === v || (u.synonymes ?? []).some((s) => cle(s) === v));
  if (direct) return direct.code;
  for (const [cible, synonymes] of Object.entries(SYNONYMES_UNITE)) {
    if (synonymes.map(normaliser).includes(v)) return unites.find((u) => normaliser(u.code) === cible)?.code ?? null;
  }
  return null;
}

// Regroupements de natures reconnus dans les libellés importés (« MAIN D'OEUVRE », « MATERIEL et LOCATION »…).
const REGROUPEMENTS = [
  ['MO', ['MAINDOEUVRE', 'MO', 'PERSONNEL']],
  ['MATERIAUX', ['MATERIAU', 'FOURNITURE', 'MT']],
  ['ENGIN', ['MATERIEL', 'LOCATION', 'ENGIN']],
  ['SOUS_TRAITANCE', ['SOUSTRAIT', 'ST']],
  ['PRESTATION', ['PRESTATION']],
];

/**
 * Nature de l'application pour une nature importée { code, libelle, regroupement }. natures : [{ id, code, libelle,
 * regroupement }]. Recherche par code, puis libellé, puis regroupement reconnu (première nature du regroupement).
 */
export function associerNature(source, natures) {
  if (!source) return null;
  const code = normaliser(source.code);
  const libelle = normaliser(source.libelle);
  const trouve = natures.find((n) => code && normaliser(n.code) === code)
    ?? natures.find((n) => libelle && normaliser(n.libelle) === libelle);
  if (trouve) return trouve.id;
  for (const texte of [source.regroupement, source.libelle, source.code].map(normaliser).filter(Boolean)) {
    for (const [rgn, mots] of REGROUPEMENTS) {
      if (mots.some((m) => (m.length <= 2 ? texte === m : texte.includes(m)))) {
        const n = natures.find((x) => normaliser(x.regroupement) === normaliser(rgn));
        if (n) return n.id;
      }
    }
  }
  return null;
}

/** Taux de TVA de l'application (taux : [{ id, taux, categorie }]) pour un pourcentage ; taux normaux en priorité. */
export function associerTaux(pourcentage, taux) {
  if (pourcentage === null || pourcentage === undefined) return null;
  const egaux = taux.filter((t) => Math.abs(Number(t.taux) - Number(pourcentage)) < 0.0001);
  return (egaux.find((t) => (t.categorie ?? 'N') === 'N') ?? egaux[0])?.id ?? null;
}

/** Option d'une liste de choix ({ code, libelle }) pour une valeur importée { code, libelle } : égalité puis préfixe. */
export function associerOption(valeur, options) {
  if (!valeur) return null;
  const vs = [valeur.code, valeur.libelle].map(normaliser).filter(Boolean);
  for (const o of options) if (vs.includes(normaliser(o.code)) || vs.includes(normaliser(o.libelle))) return o.code;
  for (const o of options) {
    const c = normaliser(o.code), l = normaliser(o.libelle);
    if (vs.some((v) => (c && v.startsWith(c)) || (l && v.startsWith(l)))) return o.code;
  }
  return null;
}
