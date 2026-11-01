// Compteurs et événements du matériel (lot 5c-2 des demandes du 25/10/2026), répliqués dans ReglesCompteurs.cs (jeu
// tests/ressources/05_compteurs.json) : relevés datés en heures (H) ou kilomètres (KM), deux unités au plus par
// matériel (M7) ; un relevé ne descend pas sous le précédent de la même unité, sauf remise à zéro (compteur remplacé)
// ou rectification (valeur corrigée, motif obligatoire : FM2 de l'analyse d'ergonomie) ;
// compteur à une date ; série cumulée (les remises à zéro ajoutent la valeur atteinte avant elles) ; contrôle d'un
// événement (panne, sinistre, accident, immobilisation, contrôle, entretien, plein de carburant, autre).
// Relevés ordonnés par date puis par ordre de saisie ; dates ISO comparées en texte.

import { icone, textesParCode } from '@logibtp/socle/dictionnaire';

export const UNITES_COMPTEUR = ['H', 'KM'];
export const LIBELLES_UNITE = textesParCode('ressources_btp.compteurs.unites', ['H', 'KM']);
export const COMPTEURS_MATERIEL = { H: ['H'], KM: ['KM'], H_KM: ['H', 'KM'], AUCUN: [] };

export const TYPES_EVENEMENT = ['PANNE', 'SINISTRE', 'ACCIDENT', 'IMMOBILISATION', 'CONTROLE', 'ENTRETIEN', 'CARBURANT', 'AUTRE'];
export const LIBELLES_EVENEMENT = textesParCode('ressources_btp.compteurs.evenements', ['PANNE', 'SINISTRE', 'ACCIDENT', 'IMMOBILISATION', 'CONTROLE', 'ENTRETIEN', 'CARBURANT', 'AUTRE']);
export const ICONES_EVENEMENT = Object.fromEntries(['PANNE', 'SINISTRE', 'ACCIDENT', 'IMMOBILISATION', 'CONTROLE', 'ENTRETIEN', 'CARBURANT', 'AUTRE'].map((c) => [c, icone(`ressources_btp_evenement_${c.toLowerCase()}`)]));

export const MESSAGES_COMPTEURS = textesParCode('ressources_btp.compteurs.erreurs', ['REL_UNITE', 'REL_DATE', 'REL_VALEUR', 'REL_DECROISSANT', 'REL_MOTIF', 'EVT_TYPE', 'EVT_DATE', 'EVT_LIBELLE', 'EVT_LITRES', 'EVT_COUT']);

const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nombre = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Unités suivies d'un matériel selon son réglage (H, KM, H_KM, AUCUN). */
export function unitesCompteurs(reglage) {
  return COMPTEURS_MATERIEL[reglage] ?? [];
}

const valable = (r) => UNITES_COMPTEUR.includes(r.unite) && Boolean(r.date) && nombre(r.valeur) !== null && nombre(r.valeur) >= 0;

/** Relevés valables d'une unité avec leur indice, par date puis ordre de saisie. */
function ordonnes(releves, unite) {
  return releves.map((r, i) => ({ r, i })).filter(({ r }) => r.unite === unite && valable(r))
    .sort((a, b) => ordinal(a.r.date, b.r.date) || a.i - b.i);
}

/** Erreurs d'une liste de relevés [{ code, releve }], triées par relevé puis code. */
export function controlerReleves(unites, releves) {
  const r = [];
  releves.forEach((x, i) => {
    if (!unites.includes(x.unite)) r.push({ code: 'REL_UNITE', releve: i });
    if (!x.date) r.push({ code: 'REL_DATE', releve: i });
    if (nombre(x.valeur) === null || nombre(x.valeur) < 0) r.push({ code: 'REL_VALEUR', releve: i });
    if (x.rectification && !String(x.commentaire ?? '').trim()) r.push({ code: 'REL_MOTIF', releve: i });
  });
  for (const unite of UNITES_COMPTEUR) {
    const l = ordonnes(releves, unite);
    for (let k = 1; k < l.length; k++) {
      if (!l[k].r.remise && !l[k].r.rectification && nombre(l[k].r.valeur) < nombre(l[k - 1].r.valeur)) r.push({ code: 'REL_DECROISSANT', releve: l[k].i });
    }
  }
  return r.sort((a, b) => a.releve - b.releve || ordinal(a.code, b.code));
}

/** Valeur du compteur à une date : dernier relevé valable de l'unité à cette date ou avant, null sinon. */
export function compteurA(releves, unite, date) {
  const l = ordonnes(releves, unite).filter(({ r }) => r.date <= date);
  return l.length ? nombre(l.at(-1).r.valeur) : null;
}

/** Série cumulée d'une unité [{ releve, date, valeur, cumul }] : une remise à zéro ajoute la valeur atteinte avant elle. */
export function cumuls(releves, unite) {
  let decalage = 0;
  let precedent = null;
  return ordonnes(releves, unite).map(({ r, i }) => {
    const valeur = nombre(r.valeur);
    if (r.remise && precedent !== null) decalage += precedent;
    precedent = valeur;
    return { releve: i, date: r.date, valeur, cumul: valeur + decalage };
  });
}

/** Codes d'erreur d'un événement, triés. */
export function controlerEvenement(e) {
  const r = [];
  if (!TYPES_EVENEMENT.includes(e.type)) r.push('EVT_TYPE');
  if (!e.date || (e.fin && e.fin < e.date)) r.push('EVT_DATE');
  if (e.type !== 'CARBURANT' && !String(e.libelle ?? '').trim()) r.push('EVT_LIBELLE');
  if (e.type === 'CARBURANT' && !(nombre(e.litres) > 0)) r.push('EVT_LITRES');
  if (nombre(e.cout) !== null && nombre(e.cout) < 0) r.push('EVT_COUT');
  return r.sort(ordinal);
}
