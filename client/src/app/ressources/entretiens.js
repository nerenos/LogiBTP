// Plans et échéances d'entretien du matériel (lot 5c-4 des demandes du 25/10/2026), répliqués dans ReglesEntretiens.cs
// (jeu tests/ressources/06_entretiens.json) : plans effectifs d'un matériel (type parent, puis type, puis matériel :
// un plan de même code remplace le précédent, un plan inactif le retire ; M6) ; compteur cumulé à une date et usage
// moyen par jour ; échéance d'un plan (heures, kilomètres, mois : le premier atteint déclenche) et état.
// Dates ISO ; valeurs de compteurs en nombres (jamais des montants).

import { texte } from '@logibtp/socle/dictionnaire';
import { ajouterJours, ajouterMois, joursEntre } from '@logibtp/socle';
import { cumuls } from './compteurs.js';

export const ETATS_ECHEANCE = {
  EN_RETARD: { get libelle() { return texte('ressources_btp.entretiens.etats.EN_RETARD'); }, classe: 'erreur' },
  A_PREVOIR: { get libelle() { return texte('ressources_btp.entretiens.etats.A_PREVOIR'); }, classe: 'attention' },
  OK: { get libelle() { return texte('ressources_btp.entretiens.etats.OK'); }, classe: 'ok' },
  INCONNU: { get libelle() { return texte('ressources_btp.entretiens.etats.INCONNU'); }, classe: 'neutre' },
};
export const SEUIL_ENTRETIEN = 30;
export const JOURS_MOYENNE = 90;

const arrondi4 = (x) => Math.round(x * 10000) / 10000;

/** Plans effectifs : listes du plus général au plus précis ; même code = remplacé, inactif = retiré. */
export function plansEffectifs(listes) {
  const r = new Map();
  for (const liste of listes) {
    for (const p of liste) {
      if (p.actif === false) r.delete(p.code);
      else r.set(p.code, p);
    }
  }
  return [...r.values()];
}

/** Compteur cumulé d'une unité à une date (dernier point de la série cumulée à cette date ou avant), null sinon. */
export function cumulA(releves, unite, date) {
  const l = cumuls(releves, unite).filter((p) => p.date <= date);
  return l.length ? l.at(-1).cumul : null;
}

/**
 * Usage moyen par jour d'une unité à une date, sur la période des `jours` précédents : du dernier point au début de
 * la période (sinon le premier point) au dernier point à la date ; null sous sept jours d'écart. Arrondi à 4 décimales.
 */
export function moyenneUsage(releves, unite, date, jours = JOURS_MOYENNE) {
  const l = cumuls(releves, unite).filter((p) => p.date <= date);
  if (!l.length) return null;
  const debut = ajouterJours(date, -jours);
  const avant = l.filter((p) => p.date <= debut);
  const premier = avant.length ? avant.at(-1) : l[0];
  const dernier = l.at(-1);
  const ecart = joursEntre(premier.date, dernier.date);
  return ecart < 7 ? null : arrondi4((dernier.cumul - premier.cumul) / ecart);
}

/**
 * Échéance d'un plan { heures, km, mois } depuis la référence { date, H, KM } (dernier entretien, sinon mise en
 * service) au point courant { date, H, KM } avec les usages moyens { H, KM } : critères [{ critere, echeance, reste,
 * date }], date la plus proche, état EN_RETARD (un critère atteint), A_PREVOIR (date à moins de `seuil` jours), OK,
 * INCONNU (aucun critère calculable).
 */
export function echeanceEntretien({ plan, reference, courant, moyennes = {}, seuil = SEUIL_ENTRETIEN }) {
  const criteres = [];
  for (const [critere, periode] of [['H', plan.heures], ['KM', plan.km]]) {
    if (!(Number(periode) > 0) || courant[critere] === null || courant[critere] === undefined) continue;
    const echeance = Number(reference?.[critere] ?? 0) + Number(periode);
    const reste = echeance - Number(courant[critere]);
    const moy = Number(moyennes[critere]);
    const date = reste <= 0 ? courant.date : moy > 0 ? ajouterJours(courant.date, Math.ceil(reste / moy)) : null;
    criteres.push({ critere, echeance, reste, date });
  }
  if (Number(plan.mois) > 0 && reference?.date) {
    const echeance = ajouterMois(reference.date, Number(plan.mois));
    criteres.push({ critere: 'MOIS', echeance, reste: joursEntre(courant.date, echeance), date: echeance });
  }
  const dates = criteres.map((c) => c.date).filter(Boolean).sort();
  const date = dates[0] ?? null;
  const etat = !criteres.length ? 'INCONNU'
    : criteres.some((c) => c.reste <= 0) ? 'EN_RETARD'
      : date && date <= ajouterJours(courant.date, seuil) ? 'A_PREVOIR' : 'OK';
  return { criteres, date, etat };
}
