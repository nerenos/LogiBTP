// Charge du planning, règle répliquée dans ReglesCharge.cs (jeu modules/planning/tests/cas/02_charge.json),
// ANALYSE-MODULE-PLANNING.md § 2.5, P3 à P6 : par service et par jour, capacité = minutes travaillables des ressources
// à capacité du service (service principal, absences retirées), planifié = minutes des ressources affectées occupées
// par leurs tâches (plages comprises dans la tâche) + heures des tâches théoriques ventilées sur le calendrier du
// service, disponible = capacité − planifié ; par ressource et par jour, sur-occupation quand le planifié dépasse sa
// capacité (tâches qui se chevauchent) ; matériels gérés par nombre : unités utilisées par jour comparées au stock.

import { dateDe } from './temps.js';
import { retirerAbsences, calculerTache } from './calcul.js';

/** Minutes des plages par jour (« AAAA-MM-JJ » → minutes), limitées à [debut, fin[. */
function parJour(plages, debut = -Infinity, fin = Infinity) {
  const r = new Map();
  for (const [d0, f0] of plages) {
    let d = Math.max(d0, debut);
    const f = Math.min(f0, fin);
    while (d < f) {
      const finJour = (Math.floor(d / 1440) + 1) * 1440;
      const g = Math.min(f, finJour);
      r.set(dateDe(d), (r.get(dateDe(d)) ?? 0) + g - d);
      d = g;
    }
  }
  return r;
}

const ajouter = (m, cle, v) => m.set(cle, (m.get(cle) ?? 0) + v);

/**
 * Charge : { jours [dates], ressources [{ cle, srv_id, capacite, quantite, plages }], absences [{ ressource, debut,
 * fin }], taches [{ cle, srv_id, debut, fin, heures, affectations [{ ressource, quantite }], plages_service }] } →
 * { services [{ srv_id, date, capacite, planifie, disponible }], surcharges [{ ressource, date, capacite, planifie,
 * taches }], materiels [{ ressource, date, utilise, stock }] } (triés par service ou ressource puis date).
 */
export function calculerCharge({ jours = [], ressources = [], absences = [], taches = [] }) {
  const dates = new Set(jours);
  const parCle = new Map(ressources.map((r) => [r.cle, r]));
  const effectives = new Map(ressources.map((r) => [r.cle, retirerAbsences(r.plages ?? [], absences.filter((a) => a.ressource === r.cle))]));
  const capacite = new Map();
  const capaciteRes = new Map();
  for (const r of ressources) {
    if (r.capacite === false) continue;
    for (const [d, m] of parJour(effectives.get(r.cle))) {
      if (!dates.has(d)) continue;
      ajouter(capacite, `${r.srv_id ?? 0}|${d}`, m);
      capaciteRes.set(`${r.cle}|${d}`, m);
    }
  }
  const planifie = new Map();
  const planifieRes = new Map();
  const tachesRes = new Map();
  const unites = new Map();
  for (const t of taches) {
    const capables = (t.affectations ?? []).filter((a) => parCle.get(a.ressource)?.capacite !== false && parCle.has(a.ressource));
    for (const a of t.affectations ?? []) {
      const r = parCle.get(a.ressource);
      if (r?.capacite === false && r.quantite != null) {
        for (let j = Math.floor(t.debut / 1440); j * 1440 < t.fin; j++) {
          const d = dateDe(j * 1440);
          if (dates.has(d)) ajouter(unites, `${r.cle}|${d}`, a.quantite ?? 1);
        }
      }
    }
    if (!capables.length) {
      const v = calculerTache({ mode: 3, debut: t.debut, fin: t.fin, heures: t.heures, plages_defaut: t.plages_service ?? [] });
      for (const x of v.ventilation ?? []) if (x.minutes && dates.has(x.date)) ajouter(planifie, `${t.srv_id ?? 0}|${x.date}`, x.minutes);
      continue;
    }
    for (const a of capables) {
      const r = parCle.get(a.ressource);
      for (const [d, m] of parJour(effectives.get(r.cle), t.debut, t.fin)) {
        if (!dates.has(d)) continue;
        ajouter(planifie, `${r.srv_id ?? 0}|${d}`, m);
        ajouter(planifieRes, `${r.cle}|${d}`, m);
        if (!tachesRes.has(`${r.cle}|${d}`)) tachesRes.set(`${r.cle}|${d}`, []);
        tachesRes.get(`${r.cle}|${d}`).push(t.cle);
      }
    }
  }
  const tri = (a, b) => { const x = `${a[0]}|${a[1]}`; const y = `${b[0]}|${b[1]}`; return x < y ? -1 : x > y ? 1 : 0; };
  const cles = [...new Set([...capacite.keys(), ...planifie.keys()])].map((k) => k.split('|')).sort((a, b) => Number(a[0]) - Number(b[0]) || (a[1] < b[1] ? -1 : 1));
  return {
    services: cles.map(([s, d]) => {
      const c = capacite.get(`${s}|${d}`) ?? 0;
      const p = planifie.get(`${s}|${d}`) ?? 0;
      return { srv_id: Number(s) || null, date: d, capacite: c, planifie: p, disponible: c - p };
    }),
    surcharges: [...planifieRes.entries()].filter(([k, p]) => p > (capaciteRes.get(k) ?? 0)).map(([k, p]) => k.split('|').concat(p)).sort(tri)
      .map(([ressource, date, p]) => ({ ressource, date, capacite: capaciteRes.get(`${ressource}|${date}`) ?? 0, planifie: p, taches: tachesRes.get(`${ressource}|${date}`) })),
    materiels: [...unites.entries()].map(([k, u]) => k.split('|').concat(u)).sort(tri)
      .map(([ressource, date, u]) => ({ ressource, date, utilise: u, stock: parCle.get(ressource).quantite })),
  };
}
