// Calcul d'une tâche du planning, règle répliquée dans ReglesPlanning.cs (jeu modules/planning/tests/cas/01_calcul.json),
// ANALYSE-MODULE-PLANNING.md § 2.4, P1, P2 : heures de travail cumulées des ressources à capacité (une ressource
// matérielle occupe sans ajouter de capacité), au rythme de leurs plages travaillées (calendrier, absences retirées) ;
// sans ressource à capacité, `nb_ressources` ressources au calendrier par défaut (service). Instants en minutes depuis
// 1970 (temps.js), heures en minutes.
//   Mode 1 : début + heures → fin (première minute où le travail cumulé atteint les heures, arrondie à la minute).
//   Mode 2 : début + fin → heures.
//   Mode 3 (charge) : début, fin, heures → ventilation des heures par jour au prorata du temps travaillable.

import { textesParCode } from '@logibtp/socle/dictionnaire';
import { dateDe } from './temps.js';

/** Messages des erreurs du calcul, par code (module Personnalisation). */
export const MESSAGES_CALCUL = textesParCode('planning.calcul.erreurs', ['PLA_CALENDRIER', 'PLA_FIN', 'PLA_HEURES']);

/** Retire des plages [d, f] (triées) les intervalles d'absence. */
export function retirerAbsences(plages, absences) {
  let r = plages.map(([d, f]) => [d, f]);
  for (const a of absences) {
    const s = [];
    for (const [d, f] of r) {
      if (a.fin <= d || a.debut >= f) { s.push([d, f]); continue; }
      if (a.debut > d) s.push([d, a.debut]);
      if (a.fin < f) s.push([a.fin, f]);
    }
    r = s;
  }
  return r;
}

/** Contributeurs : { cle, poids, plages } (ressources à capacité, sinon calendrier par défaut × nombre). */
function contributeurs({ ressources = [], absences = [], plages_defaut = [], nb_ressources = 1 }) {
  const c = ressources.filter((r) => r.capacite !== false)
    .map((r) => ({ cle: r.cle, poids: 1, plages: retirerAbsences(r.plages ?? [], absences.filter((a) => a.ressource === r.cle)) }));
  return c.length ? c : [{ cle: null, poids: Math.max(1, nb_ressources), plages: plages_defaut.map(([d, f]) => [d, f]) }];
}

/** Segments à rythme constant à partir de `debut` : [{ d, f, actifs: [indices] }] (rythme = somme des poids). */
function segments(contrib, debut, fin = Infinity) {
  const bornes = new Set([debut]);
  for (const c of contrib) for (const [d, f] of c.plages) { if (f > debut && d < fin) { bornes.add(Math.max(d, debut)); bornes.add(Math.min(f, fin)); } }
  const t = [...bornes].filter((x) => x <= fin).sort((a, b) => a - b);
  const r = [];
  for (let i = 0; i + 1 < t.length; i++) {
    const d = t[i];
    const f = t[i + 1];
    const actifs = [];
    contrib.forEach((c, k) => { if (c.plages.some(([a, b]) => a <= d && b >= f)) actifs.push(k); });
    if (actifs.length) r.push({ d, f, actifs });
  }
  return r;
}

const ajouter = (o, cle, v) => { if (cle != null && v) o[cle] = (o[cle] ?? 0) + v; };

/**
 * Calcule une tâche : { mode, debut, fin, heures, ressources [{ cle, capacite, plages [[d, f]] }], absences
 * [{ ressource, debut, fin }], plages_defaut, nb_ressources } → { debut, fin, heures, par_ressource, ventilation?,
 * erreurs }.
 */
export function calculerTache(t) {
  const mode = t.mode ?? 1;
  const contrib = contributeurs(t);
  const parRessource = {};
  const poids = (actifs) => actifs.reduce((s, k) => s + contrib[k].poids, 0);
  if (mode === 1) {
    if (!Number.isInteger(t.heures) || t.heures < 0) return { debut: t.debut, fin: null, heures: t.heures, par_ressource: {}, erreurs: ['PLA_HEURES'] };
    let reste = t.heures;
    if (reste === 0) return { debut: t.debut, fin: t.debut, heures: 0, par_ressource: {}, erreurs: [] };
    for (const s of segments(contrib, t.debut)) {
      const r = poids(s.actifs);
      const travail = (s.f - s.d) * r;
      if (travail >= reste) {
        const duree = Math.ceil(reste / r);
        for (const k of s.actifs) ajouter(parRessource, contrib[k].cle, duree * contrib[k].poids);
        return { debut: t.debut, fin: s.d + duree, heures: t.heures, par_ressource: parRessource, erreurs: [] };
      }
      reste -= travail;
      for (const k of s.actifs) ajouter(parRessource, contrib[k].cle, (s.f - s.d) * contrib[k].poids);
    }
    return { debut: t.debut, fin: null, heures: t.heures, par_ressource: {}, erreurs: ['PLA_CALENDRIER'] };
  }
  if (t.fin == null || t.fin < t.debut) return { debut: t.debut, fin: t.fin, heures: t.heures ?? null, par_ressource: {}, erreurs: ['PLA_FIN'] };
  const segs = segments(contrib, t.debut, t.fin);
  if (mode === 2) {
    let h = 0;
    for (const s of segs) {
      h += (s.f - s.d) * poids(s.actifs);
      for (const k of s.actifs) ajouter(parRessource, contrib[k].cle, (s.f - s.d) * contrib[k].poids);
    }
    return { debut: t.debut, fin: t.fin, heures: h, par_ressource: parRessource, erreurs: [] };
  }
  // Mode 3 : ventilation des heures saisies au prorata du temps travaillable de chaque jour (et de chaque ressource).
  if (!Number.isInteger(t.heures) || t.heures < 0) return { debut: t.debut, fin: t.fin, heures: t.heures, par_ressource: {}, ventilation: [], erreurs: ['PLA_HEURES'] };
  const jours = new Map();
  const parCle = new Map();
  let total = 0;
  for (const s of segs) {
    for (let d = s.d; d < s.f;) {
      const finJour = (Math.floor(d / 1440) + 1) * 1440;
      const f = Math.min(s.f, finJour);
      const w = (f - d) * poids(s.actifs);
      jours.set(dateDe(d), (jours.get(dateDe(d)) ?? 0) + w);
      for (const k of s.actifs) parCle.set(k, (parCle.get(k) ?? 0) + (f - d) * contrib[k].poids);
      total += w;
      d = f;
    }
  }
  if (total === 0) return { debut: t.debut, fin: t.fin, heures: t.heures, par_ressource: {}, ventilation: [], erreurs: t.heures ? ['PLA_CALENDRIER'] : [] };
  const repartir = (entrees) => {
    const r = entrees.map(([cle, w]) => [cle, Math.floor((t.heures * w) / total)]);
    const reste = t.heures - r.reduce((s, [, v]) => s + v, 0);
    if (reste) r[r.length - 1][1] += reste;
    return r;
  };
  const ventilation = repartir([...jours.entries()]).map(([date, minutes]) => ({ date, minutes }));
  for (const [k, v] of repartir([...parCle.entries()].sort((a, b) => a[0] - b[0]))) ajouter(parRessource, contrib[k].cle, v);
  return { debut: t.debut, fin: t.fin, heures: t.heures, par_ressource: parRessource, ventilation, erreurs: [] };
}
