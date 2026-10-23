// Reconnaissance d'un courriel reçu (module Mail, lot 4), répliquée avec ReconnaissanceMail.cs (jeu partagé
// tests/cas/01_reconnaissance.json) : nature par les règles, score des candidats fournis par l'application, décision.

/** Accents remplacés par une table explicite (le C# tourne sans globalisation : pas de décomposition Unicode). */
const ACCENTS = {
  à: 'a', â: 'a', ä: 'a', á: 'a', ã: 'a', å: 'a', ç: 'c', é: 'e', è: 'e', ê: 'e', ë: 'e', î: 'i', ï: 'i', í: 'i', ì: 'i', ñ: 'n',
  ô: 'o', ö: 'o', ó: 'o', ò: 'o', õ: 'o', ù: 'u', û: 'u', ü: 'u', ú: 'u', ÿ: 'y', œ: 'oe', æ: 'ae', '’': "'",
};

export const SCORES = { NUMERO_OBJET: 70, NUMERO_TEXTE: 60, NUMERO_PIECE: 60, NUMERO_PIECE_TEXTE: 50, REFERENCE: 40, EXPEDITEUR: 20, FIL: 100, TIERS: 50 };
export const ZONES = ['objet', 'texte', 'pieces'];
export const ACTIONS = ['ALERTER', 'RATTACHER', 'IGNORER'];
export const NATURES = ['ARC', 'REPONSE_DEVIS', 'FACTURE_FOURNISSEUR', 'BL', 'RELANCE', 'AUTRE'];

/** Minuscules, accents retirés, espaces resserrés. */
export function normaliser(texte) {
  let r = '';
  for (const c of String(texte ?? '').toLowerCase()) r += ACCENTS[c] ?? c;
  return r.replace(/\s+/g, ' ').trim();
}

const alnum = (c) => c !== undefined && /[a-z0-9]/.test(c);

/** Le mot (ou l'expression) figure en entier dans le texte, sans casse ni accents. */
export function contientMot(texte, mot) {
  const t = normaliser(texte);
  const m = normaliser(mot);
  if (!m) return false;
  for (let i = t.indexOf(m); i >= 0; i = t.indexOf(m, i + 1)) {
    if (!alnum(t[i - 1]) && !alnum(t[i + m.length])) return true;
  }
  return false;
}

/** Première règle (ordre, puis code) qui s'applique : expéditeur par suffixe, un des mots dans les zones choisies (toutes si aucune). */
export function regleApplicable(entree, regles) {
  const zones = { objet: entree.objet ?? '', texte: entree.texte ?? '', pieces: (entree.pieces ?? []).join(' ') };
  const triees = [...(regles ?? [])].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0) || String(a.code).localeCompare(String(b.code)));
  return triees.find((r) => {
    if (r.expediteur && !normaliser(entree.de).endsWith(normaliser(r.expediteur))) return false;
    const mots = r.mots ?? [];
    if (mots.length === 0) return Boolean(r.expediteur);
    const dans = r.dans?.length ? r.dans : ZONES;
    return mots.some((m) => dans.some((z) => contientMot(zones[z] ?? '', m)));
  }) ?? null;
}

/** Score d'un candidat (numéro, références, expéditeur) ; null si ni numéro ni référence n'est trouvé. */
function scorer(entree, c) {
  const indices = [];
  if (c.numero) {
    if (contientMot(entree.objet, c.numero)) indices.push('NUMERO_OBJET');
    else if (contientMot(entree.texte, c.numero)) indices.push('NUMERO_TEXTE');
    else if ((entree.pieces ?? []).some((p) => contientMot(p, c.numero))) indices.push('NUMERO_PIECE');
    else if (contientMot(entree.texte_pieces, c.numero)) indices.push('NUMERO_PIECE_TEXTE');
  }
  const textes = [entree.objet, entree.texte, entree.texte_pieces];
  if ((c.references ?? []).some((r) => r && r.length >= 4 && textes.some((t) => contientMot(t, r)))) indices.push('REFERENCE');
  if (indices.length === 0) return null;
  if (c.tiers_id != null && (entree.expediteur_tiers ?? []).includes(c.tiers_id)) indices.push('EXPEDITEUR');
  return { type: c.type, id: String(c.id), score: Math.min(100, indices.reduce((s, i) => s + SCORES[i], 0)), indices };
}

/**
 * Reconnaissance : { nature, regle, service, decision (IGNORE, RATTACHE, PROPOSE, A_RAPPROCHER), retenus, propositions, alerte }.
 * Fil (réponse à un envoi) : rattaché, score 100. Un seul candidat au-dessus du seuil haut : rattaché ; au-dessus du seuil
 * bas : proposé. Alerte : rattaché, courriel non automatique, action de la règle ALERTER (défaut).
 */
export function reconnaitre(entree, regles, seuils = { haut: 80, bas: 40 }) {
  const regle = regleApplicable(entree, regles);
  const props = [];
  const ajouter = (p) => {
    const e = props.find((x) => x.type === p.type && x.id === p.id);
    if (!e) props.push(p);
    else if (p.score > e.score) Object.assign(e, p);
  };
  for (const f of entree.fil ?? []) ajouter({ type: f.type, id: String(f.id), score: SCORES.FIL, indices: ['FIL'] });
  for (const c of entree.candidats ?? []) { const p = scorer(entree, c); if (p) ajouter(p); }
  for (const t of entree.tiers ?? []) {
    if (!props.some((x) => x.type === t.type && x.id === String(t.id))) props.push({ type: t.type, id: String(t.id), score: SCORES.TIERS, indices: ['TIERS'] });
  }
  props.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const action = regle?.action ?? 'ALERTER';
  let decision = 'A_RAPPROCHER';
  let retenus = [];
  const hauts = props.filter((p) => p.score >= seuils.haut);
  if (action === 'IGNORER') decision = 'IGNORE';
  else if ((entree.fil ?? []).length) { decision = 'RATTACHE'; retenus = props.filter((p) => p.indices.includes('FIL')); }
  else if (hauts.length === 1) { decision = 'RATTACHE'; retenus = hauts; }
  else if (props.some((p) => p.score >= seuils.bas)) decision = 'PROPOSE';
  return {
    nature: regle?.nature ?? null, regle: regle?.code ?? null, service: regle?.service ?? null, decision,
    retenus: retenus.map(({ type, id, score }) => ({ type, id, score })), propositions: props,
    alerte: decision === 'RATTACHE' && !entree.automatique && action === 'ALERTER',
  };
}
