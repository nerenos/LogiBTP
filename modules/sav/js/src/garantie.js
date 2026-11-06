import { textesParCode } from '@logibtp/socle/dictionnaire';
import { ajouterJours, ajouterMois, joursEntre } from '@logibtp/socle';
import { ETAT_GARANTIE } from './codes.js';

// Équipements installés (ANALYSE-MODULE-STOCK.md § 11, S24.8 ; plans/stock.md, lot 2), répliqué dans ReglesGarantie.cs
// (jeu modules/sav/tests/cas/01_garantie.json) : numéro de série normalisé, fin de garantie (saisie, sinon pose + durée
// en mois, veille de l'anniversaire, fin de mois ramenée), état de la garantie à une date, contrôle d'un équipement.
// Dates « AAAA-MM-JJ ».

/** Messages du contrôle d'un équipement, par code (module Personnalisation). */
export const MESSAGES_EQUIPEMENT = textesParCode('sav.equipement.erreurs',
  ['SAV_NUMERO', 'SAV_ARTICLE', 'SAV_POSE_FUTURE', 'SAV_DUREE', 'SAV_FIN_AVANT_POSE']);

/** Durée de garantie la plus longue acceptée, en mois. */
export const DUREE_GARANTIE_MAX = 600;

const vide = (v) => v === null || v === undefined || String(v).trim() === '';
const jour = (d) => (vide(d) ? null : String(d).slice(0, 10));

/** Numéro de série normalisé : espaces de tête et de fin retirés, espaces intérieurs réduits ; null s'il est vide. */
export function numeroSerie(numero) {
  return vide(numero) ? null : String(numero).trim().replace(/\s+/g, ' ');
}

/** Durée en mois entière de 0 à DUREE_GARANTIE_MAX, null si vide, NaN si illisible ou hors bornes. */
function duree(v) {
  if (vide(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= DUREE_GARANTIE_MAX ? n : NaN;
}

/**
 * Fin de garantie (dernier jour couvert) : la fin saisie sur l'équipement ; sinon, avec une date de pose et une durée en
 * mois positive, la veille de l'anniversaire (pose + durée, fin de mois ramenée) ; sinon null.
 */
export function finGarantie({ pose = null, duree_mois = null, fin_saisie = null }) {
  if (!vide(fin_saisie)) return jour(fin_saisie);
  const n = duree(duree_mois);
  if (vide(pose) || !(n > 0)) return null;
  return ajouterJours(ajouterMois(jour(pose), n), -1);
}

/**
 * État de la garantie à la date : { etat, fin, jours_restants } ; SANS sans fin de garantie (jours_restants null), EN_COURS
 * jusqu'à la fin comprise (jours restants après la date, 0 le dernier jour), ECHUE après (jours_restants null).
 */
export function etatGarantie(equipement, date) {
  const fin = finGarantie(equipement);
  if (fin === null) return { etat: ETAT_GARANTIE.SANS, fin, jours_restants: null };
  const d = jour(date);
  if (d > fin) return { etat: ETAT_GARANTIE.ECHUE, fin, jours_restants: null };
  return { etat: ETAT_GARANTIE.EN_COURS, fin, jours_restants: joursEntre(d, fin) };
}

/**
 * Contrôle d'un équipement saisi (aujourd'hui : « AAAA-MM-JJ ») : codes d'erreur dans l'ordre — numéro de série vide
 * (SAV_NUMERO), article absent (SAV_ARTICLE), pose après aujourd'hui (SAV_POSE_FUTURE), durée de garantie illisible ou
 * hors de 0 à DUREE_GARANTIE_MAX mois (SAV_DUREE), fin de garantie saisie avant la pose (SAV_FIN_AVANT_POSE).
 */
export function controlerEquipement({ numero = null, article = null, pose = null, duree_mois = null, fin_saisie = null }, aujourdhui) {
  const erreurs = [];
  if (numeroSerie(numero) === null) erreurs.push('SAV_NUMERO');
  if (vide(article)) erreurs.push('SAV_ARTICLE');
  if (!vide(pose) && jour(pose) > jour(aujourdhui)) erreurs.push('SAV_POSE_FUTURE');
  if (Number.isNaN(duree(duree_mois))) erreurs.push('SAV_DUREE');
  if (!vide(pose) && !vide(fin_saisie) && jour(fin_saisie) < jour(pose)) erreurs.push('SAV_FIN_AVANT_POSE');
  return erreurs;
}
