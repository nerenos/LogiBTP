// Dépendances et tâches liées du planning, règle répliquée dans ReglesDependances.cs (jeu
// modules/planning/tests/cas/03_dependances.json), ANALYSE-MODULE-PLANNING.md P8, P9 : fin → début (FD) ou début →
// début (DD), décalage en jours calendaires (CAL) ou ouvrés (OUV : minuit du N-ième jour ouvré après la date de
// référence), mode FIXE (la tâche suivante démarre au plus tôt permis, en cascade) ou ALERTE (seulement signalée si
// elle démarre trop tôt) ; dépendances circulaires refusées ; tâche liée hors de la période de sa tâche principale
// signalée. Instants en minutes depuis 1970 (temps.js).

import { textesParCode } from '@logibtp/socle/dictionnaire';
import { dateDe, versMinutes } from './temps.js';

/** Messages des contrôles des dépendances, par code (module Personnalisation). */
export const MESSAGES_DEPENDANCES = textesParCode('planning.dependances.erreurs', ['DEP_SOI', 'DEP_DOUBLON', 'DEP_CYCLE', 'DEP_TYPE', 'DEP_VIOLEE', 'LIEE_HORS']);

/**
 * Début au plus tôt permis par une dépendance : base = fin (FD) ou début (DD) de la tâche précédente ; CAL : base +
 * décalage × 1 440 ; OUV : décalage 0 = base, sinon minuit du N-ième jour ouvré (`jours_ouvres`, dates triées ou
 * ensemble) strictement après la date de la base ; null si les jours ouvrés manquent.
 */
export function debutMinimum(dep, de, joursOuvres = []) {
  const base = dep.type === 'DD' ? de.debut : de.fin;
  const n = dep.decalage ?? 0;
  if (dep.unite !== 'OUV' || n === 0) return base + n * 1440;
  const jour = dateDe(base);
  const suivants = [...joursOuvres].filter((d) => d > jour).sort();
  return suivants.length >= n ? versMinutes(suivants[n - 1]) : null;
}

/** Contrôle d'un ensemble de dépendances [{ de, vers, type, unite }] : codes dans l'ordre (soi, type, doublon, cycle). */
export function controlerDependances(deps) {
  const r = [];
  if (deps.some((d) => d.de === d.vers)) r.push('DEP_SOI');
  if (deps.some((d) => !['FD', 'DD'].includes(d.type) || !['CAL', 'OUV'].includes(d.unite ?? 'CAL') || !['FIXE', 'ALERTE'].includes(d.mode ?? 'FIXE'))) r.push('DEP_TYPE');
  const cles = deps.map((d) => `${d.de}>${d.vers}`);
  if (new Set(cles).size !== cles.length) r.push('DEP_DOUBLON');
  if (ordreTopologique(deps) === null) r.push('DEP_CYCLE');
  return r;
}

/** Ordre topologique des tâches citées (Kahn, clés triées à égalité) ; null s'il y a un cycle. */
export function ordreTopologique(deps) {
  const noeuds = [...new Set(deps.flatMap((d) => [String(d.de), String(d.vers)]))].sort();
  const entrees = new Map(noeuds.map((n) => [n, 0]));
  for (const d of deps) if (d.de !== d.vers) entrees.set(String(d.vers), entrees.get(String(d.vers)) + 1);
  const prets = noeuds.filter((n) => entrees.get(n) === 0);
  const r = [];
  while (prets.length) {
    prets.sort();
    const n = prets.shift();
    r.push(n);
    for (const d of deps.filter((x) => String(x.de) === n && x.de !== x.vers)) {
      const v = String(d.vers);
      entrees.set(v, entrees.get(v) - 1);
      if (entrees.get(v) === 0) prets.push(v);
    }
  }
  return r.length === noeuds.length ? r : null;
}

/**
 * Propagation des dépendances FIXE dans l'ordre topologique (durée des tâches gardée) puis contrôle : `taches`
 * [{ cle, debut, fin, parent }], `deps`, `jours_ouvres` → { taches: tâches déplacées [{ cle, debut, fin }] (ordre
 * topologique), alertes [{ code, de?, vers?, tache?, minimum? }] (dépendances ALERTE violées, tâches liées hors de leur
 * principale) }.
 */
export function propagerDependances({ taches = [], deps = [], jours_ouvres = [] }) {
  const ordre = ordreTopologique(deps) ?? [];
  const parCle = new Map(taches.map((t) => [String(t.cle), { ...t }]));
  const deplacees = [];
  for (const n of ordre) {
    const t = parCle.get(n);
    if (!t) continue;
    let min = null;
    for (const d of deps.filter((x) => String(x.vers) === n && (x.mode ?? 'FIXE') === 'FIXE')) {
      const de = parCle.get(String(d.de));
      const m = de ? debutMinimum(d, de, jours_ouvres) : null;
      if (m != null && (min == null || m > min)) min = m;
    }
    if (min != null && min !== t.debut) {
      const duree = t.fin - t.debut;
      t.debut = min;
      t.fin = min + duree;
      deplacees.push({ cle: t.cle, debut: t.debut, fin: t.fin });
    }
  }
  const alertes = [];
  for (const d of deps.filter((x) => x.mode === 'ALERTE')) {
    const de = parCle.get(String(d.de));
    const vers = parCle.get(String(d.vers));
    const m = de && vers ? debutMinimum(d, de, jours_ouvres) : null;
    if (m != null && vers.debut < m) alertes.push({ code: 'DEP_VIOLEE', de: d.de, vers: d.vers, minimum: m });
  }
  for (const t of parCle.values()) {
    const p = t.parent == null ? null : parCle.get(String(t.parent));
    if (p && (t.debut < p.debut || t.fin > p.fin)) alertes.push({ code: 'LIEE_HORS', tache: t.cle });
  }
  return { taches: deplacees, alertes };
}
