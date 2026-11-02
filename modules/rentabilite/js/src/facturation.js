// Prévisionnel de facturation (ANALYSE-MODULE-ANALYSE.md § 10.2, lot 7) : montant prévu d'un mois (montant HT saisi ou
// % du budget PV) et contrôle d'une prévision, répliqués dans Facturation.cs (jeu tests/cas/02_facturation.json) ;
// mois affichés et comparaison au facturé (atterrissage : facturé des mois passés, prévu du mois en cours et des
// suivants). Calculs en décimal, jamais en Number.
import { Dz, arrondir, ajouterMois, aujourdhui } from '@logibtp/socle';
import { MODE_FACTURATION, ERREUR_FACTURATION } from './codes.js';

const NOMBRE = /^-?\d+(\.\d+)?$/;
const MOIS = /^(\d{4})-(\d{2})-01$/;

/** Montant prévu (Decimal arrondi à 2 décimales) d'une valeur saisie : montant, ou % du budget PV. */
export function montantPrevu(mode, valeur, budget) {
  const v = Dz(valeur);
  return arrondir(mode === MODE_FACTURATION.POURCENT ? Dz(budget).times(v).dividedBy(100) : v, 2);
}

/**
 * Contrôle d'une prévision : [{ index, mois, code }], une erreur au plus par ligne (mois « AAAA-MM-01 », doublon, mode,
 * valeur numérique « 12.5 », pourcentage sans budget).
 */
export function controlerFacturation(lignes, budget) {
  const erreurs = [];
  const vus = new Set();
  lignes.forEach((l, index) => {
    const m = MOIS.exec(l.mois ?? '');
    let code = null;
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) code = ERREUR_FACTURATION.MOIS;
    else if (vus.has(l.mois)) code = ERREUR_FACTURATION.DOUBLON;
    else if (!Object.values(MODE_FACTURATION).includes(l.mode)) code = ERREUR_FACTURATION.MODE;
    else if (!NOMBRE.test(String(l.valeur ?? ''))) code = ERREUR_FACTURATION.VALEUR;
    else if (l.mode === MODE_FACTURATION.POURCENT && Dz(budget).isZero()) code = ERREUR_FACTURATION.BUDGET;
    if (m) vus.add(l.mois);
    if (code) erreurs.push({ index, mois: l.mois, code });
  });
  return erreurs;
}

/** Premier jour du mois d'une date « AAAA-MM-JJ ». */
export const moisDe = (date) => `${String(date).slice(0, 7)}-01`;

/** Mois de `du` à `au` inclus (premiers jours). */
export function moisEntre(du, au) {
  const l = [];
  for (let m = moisDe(du); m <= moisDe(au) && l.length < 240; m = ajouterMois(m, 1)) l.push(m);
  return l;
}

/**
 * Lignes de comparaison d'un chantier : pour chaque mois, facturé (réel), prévu (version courante), écart, prévu d'une
 * version de référence, cumuls ; atterrissage = facturé des mois passés + prévu du mois en cours et des suivants.
 * facture : [{ mois, pv }] ; prevu, reference : [{ mois, montant }] ; mois affichés : du plus ancien mois connu (au
 * moins deux mois avant le mois en cours) jusqu'au plus tardif (au moins onze mois après, au moins `jusqua`).
 */
export function comparerFacturation({ facture = [], prevu = [], reference = null, courant = moisDe(aujourdhui()), jusqua = null }) {
  const par = (l, champ) => {
    const m = new Map();
    for (const x of l) m.set(moisDe(x.mois), (m.get(moisDe(x.mois)) ?? Dz(0)).plus(Dz(x[champ])));
    return m;
  };
  const f = par(facture, 'pv');
  const p = par(prevu, 'montant');
  const r = reference ? par(reference, 'montant') : null;
  const connus = [...f.keys(), ...p.keys(), ...(r ? r.keys() : [])].sort();
  const debut = [connus[0], ajouterMois(courant, -2)].filter(Boolean).sort()[0];
  const fin = [connus.at(-1), ajouterMois(courant, 11), jusqua && moisDe(jusqua)].filter(Boolean).sort().at(-1);
  let cumulFacture = Dz(0);
  let cumulPrevu = Dz(0);
  let atterrissage = Dz(0);
  const lignes = moisEntre(debut, fin).map((mois) => {
    const facture_ = f.get(mois) ?? Dz(0);
    const prevu_ = p.get(mois) ?? null;
    cumulFacture = cumulFacture.plus(facture_);
    cumulPrevu = cumulPrevu.plus(prevu_ ?? Dz(0));
    atterrissage = atterrissage.plus(mois < courant ? facture_ : prevu_ ?? Dz(0));
    return {
      mois, passe: mois < courant, courant: mois === courant, facture: facture_, prevu: prevu_,
      ecart: prevu_ === null ? null : facture_.minus(prevu_), reference: r ? r.get(mois) ?? null : null,
      cumul_facture: cumulFacture, cumul_prevu: cumulPrevu, atterrissage,
    };
  });
  return { lignes, total: { facture: cumulFacture, prevu: cumulPrevu, atterrissage } };
}
