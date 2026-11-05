import { textesParCode } from '@logibtp/socle/dictionnaire';
import { Dz, S, ajouterJours, ajouterMois } from '@logibtp/socle';
import { minute } from './stock.js';
import { SUIVI_ARTICLE, UNITE_DUREE } from './codes.js';

// Lots et numéros de série (ANALYSE-MODULE-STOCK.md § 11, S24), répliqué dans ReglesTracabilite.cs (jeu
// modules/stock/tests/cas/05_tracabilite.json) : répartition d'une ligne de pièce entre ses lots (facultative, S24.2 :
// la quantité non répartie est « sans lot »), date limite proposée d'un lot d'article périssable (S24.7), stock par lot
// à une date-heure (dernier comptage de l'article — ses lignes de la même minute, par lot, le « sans lot » compris —
// puis les mouvements postérieurs, par lot).

/** Messages de la répartition, par code (module Personnalisation). */
export const MESSAGES_TRACABILITE = textesParCode('stock.tracabilite.erreurs',
  ['TRA_NUMERO_VIDE', 'TRA_QUANTITE', 'TRA_DOUBLON', 'TRA_DEPASSE', 'TRA_SERIE_UNITE', 'TRA_INCOMPLET']);

const vide = (v) => v === null || v === undefined || String(v).trim() === '';

/** Numéro de lot normalisé : espaces de tête et de fin retirés, espaces intérieurs réduits ; null s'il est vide. */
export function numeroLot(numero) {
  return vide(numero) ? null : String(numero).trim().replace(/\s+/g, ' ');
}

/**
 * Répartition d'une ligne (quantité en unité de stock, signée : seule sa valeur absolue compte) entre des lots [{ numero,
 * quantite }] ; suivi : AUCUN, LOT, SERIE. Résultat : { parts: [{ numero, quantite }], sans_lot, erreurs: [{ code, index }],
 * avertissements: [{ code }] } ; erreurs : numéro vide (TRA_NUMERO_VIDE), quantité nulle, négative ou illisible
 * (TRA_QUANTITE), même numéro deux fois sans tenir compte de la casse (TRA_DOUBLON), série de quantité autre que 1
 * (TRA_SERIE_UNITE), lots au-delà de la ligne (TRA_DEPASSE, index null) ; avertissement : article suivi dont une
 * partie reste sans lot (TRA_INCOMPLET).
 */
export function repartirLots({ quantite, lots = [], suivi = SUIVI_ARTICLE.AUCUN }) {
  const total = Dz(quantite).abs();
  const parts = [];
  const erreurs = [];
  const vus = new Set();
  let reparti = Dz(0);
  lots.forEach((l, index) => {
    const numero = numeroLot(l.numero);
    let q = null;
    try { q = vide(l.quantite) ? null : Dz(l.quantite); } catch { q = null; }
    if (numero === null) { erreurs.push({ code: 'TRA_NUMERO_VIDE', index }); return; }
    if (q === null || q.lte(0)) { erreurs.push({ code: 'TRA_QUANTITE', index }); return; }
    const cle = numero.toUpperCase();
    if (vus.has(cle)) { erreurs.push({ code: 'TRA_DOUBLON', index }); return; }
    vus.add(cle);
    if (suivi === SUIVI_ARTICLE.SERIE && !q.eq(1)) erreurs.push({ code: 'TRA_SERIE_UNITE', index });
    reparti = reparti.plus(q);
    parts.push({ numero, quantite: S(q) });
  });
  if (reparti.gt(total)) erreurs.push({ code: 'TRA_DEPASSE', index: null });
  const sansLot = reparti.gt(total) ? Dz(0) : total.minus(reparti);
  const avertissements = suivi !== SUIVI_ARTICLE.AUCUN && sansLot.gt(0) ? [{ code: 'TRA_INCOMPLET' }] : [];
  return { parts, sans_lot: S(sansLot), erreurs, avertissements };
}

/**
 * Date limite proposée d'un lot (« AAAA-MM-JJ ») : article périssable avec une durée théorique — date de fabrication,
 * sinon de réception, plus la durée en jours ou en mois (fin de mois ramenée) ; sinon null.
 */
export function dateLimiteLot({ perissable = false, duree = null, unite = UNITE_DUREE.MOIS }, { fabrication = null, reception = null }) {
  const base = fabrication || reception;
  if (!perissable || vide(duree) || !base) return null;
  const n = Number(duree);
  return unite === UNITE_DUREE.JOURS ? ajouterJours(base.slice(0, 10), n) : ajouterMois(base.slice(0, 10), n);
}

/**
 * Stock par lot d'un article dans un lieu à la date-heure t : { mouvements: [{ date, quantite, lot }], comptages: [{
 * date, quantite, lot }] } (lot : identifiant, ou null = sans lot). Le dernier comptage de date-heure ≤ t compte toutes
 * les lignes de sa minute (un lot absent est à 0) ; un mouvement de la même minute est réputé compté. Résultat : [{ lot,
 * quantite }] non nuls, lots par identifiant croissant puis le sans lot.
 */
export function stockParLot({ mouvements = [], comptages = [] }, t) {
  const fin = minute(t);
  let depuis = null;
  for (const c of comptages) {
    const d = minute(c.date);
    if (d <= fin && (depuis === null || d > depuis)) depuis = d;
  }
  const q = new Map();
  const ajouter = (lot, v) => { const k = lot ?? null; q.set(k, (q.get(k) ?? Dz(0)).plus(Dz(v))); };
  if (depuis !== null) for (const c of comptages) if (minute(c.date) === depuis) ajouter(c.lot, c.quantite);
  for (const m of mouvements) {
    const d = minute(m.date);
    if (d <= fin && (depuis === null || d > depuis)) ajouter(m.lot, m.quantite);
  }
  return [...q].filter(([, v]) => !v.eq(0))
    .sort(([a], [b]) => (a === null) - (b === null) || (a ?? 0) - (b ?? 0))
    .map(([lot, v]) => ({ lot, quantite: S(v) }));
}
