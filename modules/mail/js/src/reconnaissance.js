// Reconnaissance d'un courriel reçu (module Mail, lot 4), répliquée avec ReconnaissanceMail.cs (jeu partagé
// tests/cas/01_reconnaissance.json) : nature par les règles, score des candidats fournis par l'application, décision.
import { sansAccent } from '@logibtp/socle';
import { TYPE_RECONNAISSANCE, PRECISION_LIVRAISON } from './codes.js';


export const SCORES = { NUMERO_OBJET: 70, NUMERO_TEXTE: 60, NUMERO_PIECE: 60, NUMERO_PIECE_TEXTE: 50, REFERENCE: 40, EXPEDITEUR: 20, FIL: 100, TIERS: 50 };
export const ZONES = ['objet', 'texte', 'pieces'];
export const ACTIONS = ['ALERTER', 'RATTACHER', 'IGNORER'];
export const NATURES = ['ARC', 'REPONSE_DEVIS', 'FACTURE_FOURNISSEUR', 'BL', 'RELANCE', 'AUTRE'];

/** Minuscules, accents retirés (table du socle), apostrophe typographique droite, espaces resserrés. */
export function normaliser(texte) {
  return sansAccent(texte).replace(/’/g, "'").replace(/[\s\u0085﻿]+/g, ' ').trim();
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

/** Motifs par défaut d'un accusé de réception de commande (mots entiers, sans casse ni accents). */
export const MOTIFS_AR = ['accusé de réception', 'confirmation de commande', 'AR', 'ARC'];

const ECHAPPER = /[.*+?^${}()|[\]\\]/g;
const LIVRAISON = /livr[a-z]*[^0-9]{0,40}?(?:([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})|semaine\s*(?:n\s*°?\s*|no\s*)?([0-9]{1,2})(?:[/-]([0-9]{4}))?)/g;

const bissextile = (a) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
const joursDuMois = (a, m) => (m === 2 ? (bissextile(a) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);
/** Années reconnues (hors plage : pas de date proposée, comme côté C#). */
export const ANNEE_MIN = 2000;
export const ANNEE_MAX = 2099;
const anneeValable = (a) => a !== null && a !== undefined && a >= ANNEE_MIN && a <= ANNEE_MAX;
const deuxChiffres = (n) => String(n).padStart(2, '0');

/** Lundi de la semaine n (1 à 53) de l'année : le lundi de la semaine 1 est celui de la semaine du 4 janvier. */
function lundiDeSemaine(annee, semaine) {
  const quatre = new Date(0);
  quatre.setUTCFullYear(annee, 0, 4);
  const dow = (quatre.getUTCDay() + 6) % 7;
  quatre.setUTCDate(4 - dow + 7 * (semaine - 1));
  return quatre.toISOString().slice(0, 10);
}

/** Numéros candidats : un des préfixes (numérotation des commandes), séparateur facultatif, chiffres (groupes séparés par - ou /). */
function numerosCandidats(zones, prefixes) {
  const trouves = [];
  const ps = (prefixes ?? []).map(normaliser).filter(Boolean).map((p) => p.replace(ECHAPPER, '\\$&'));
  if (ps.length === 0) return trouves;
  const re = new RegExp(`(?<![a-z0-9])(?:${ps.join('|')})[-/ ]?[0-9]+(?:[-/][0-9]+)*(?![a-z0-9])`, 'g');
  for (const z of zones) {
    for (const m of normaliser(z).matchAll(re)) {
      const n = m[0].replace(/ /g, '').toUpperCase();
      if (!trouves.includes(n)) trouves.push(n);
    }
  }
  return trouves;
}

/** Première livraison annoncée (jj/mm/aaaa valide, ou semaine n) après un mot « livraison » ; null si aucune. */
function livraisonAnnoncee(zones, anneeReference) {
  for (const z of zones) {
    for (const m of normaliser(z).matchAll(LIVRAISON)) {
      if (m[4] !== undefined) {
        const semaine = Number(m[4]);
        if (semaine < 1 || semaine > 53) continue;
        const annee = m[5] !== undefined ? Number(m[5]) : anneeValable(anneeReference) ? anneeReference : null;
        if (m[5] !== undefined && !anneeValable(annee)) continue;
        return { date: annee === null ? null : lundiDeSemaine(annee, semaine), semaine, precision: PRECISION_LIVRAISON.SEMAINE };
      }
      const [j, mo, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!anneeValable(a) || mo < 1 || mo > 12 || j < 1 || j > joursDuMois(a, mo)) continue;
      return { date: `${a}-${deuxChiffres(mo)}-${deuxChiffres(j)}`, semaine: null, precision: PRECISION_LIVRAISON.JOUR };
    }
  }
  return null;
}

/**
 * Accusé de réception de commande (objet et corps du message, pas les pièces jointes) : { type (ACCUSE_RECEPTION ou null),
 * motif, numeros (candidats, objet d'abord), numero (le seul candidat, sinon null), date (jj/mm/aaaa ou lundi de la
 * semaine annoncée, ISO), semaine, precision (JOUR, SEMAINE ou null) }. Entrée : objet, texte, prefixes (numérotation des
 * commandes), annee_reference (année de la semaine sans année), motifs (défaut MOTIFS_AR).
 */
export function reconnaitreAccuse(entree) {
  const zones = [entree.objet ?? '', entree.texte ?? ''];
  const motif = (entree.motifs?.length ? entree.motifs : MOTIFS_AR).find((m) => zones.some((z) => contientMot(z, m))) ?? null;
  if (motif === null) return { type: null, motif: null, numeros: [], numero: null, date: null, semaine: null, precision: null };
  const numeros = numerosCandidats(zones, entree.prefixes);
  const l = livraisonAnnoncee(zones, entree.annee_reference);
  return {
    type: TYPE_RECONNAISSANCE.ACCUSE_RECEPTION, motif, numeros, numero: numeros.length === 1 ? numeros[0] : null,
    date: l?.date ?? null, semaine: l?.semaine ?? null, precision: l?.precision ?? null,
  };
}
