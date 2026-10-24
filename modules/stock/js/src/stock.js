import { Dz, S } from '@logibtp/socle';

// Stock d'un article dans un lieu à une date-heure (ANALYSE-MODULE-STOCK.md § 3.1, S5), répliqué dans ReglesStock.cs
// (jeu modules/stock/tests/cas/01_stock.json) : le dernier comptage de date-heure ≤ T, plus les mouvements datés
// après ce comptage et jusqu'à T. Dates-heures à la minute ; un mouvement de la même minute qu'un comptage est réputé
// déjà compté. Un article jamais compté : somme des mouvements jusqu'à T.

/** Date-heure ramenée à la minute (« AAAA-MM-JJTHH:MM ») ; une date seule vaut minuit. */
export function minute(date) {
  if (date === null || date === undefined || date === '') return null;
  const s = String(date).replace(' ', 'T');
  return s.length === 10 ? `${s}T00:00` : s.slice(0, 16);
}

/** Dernier comptage de date-heure ≤ fin (le dernier de la liste à date égale), en ignorant ceux de `exclure`. */
function dernierComptage(comptages, fin, exclure = null) {
  let base = null;
  for (const c of comptages) {
    if (c === exclure) continue;
    const d = minute(c.date);
    if (d <= fin && (base === null || d >= minute(base.date))) base = c;
  }
  return base;
}

/**
 * Stock à la date-heure t. Entrée : { mouvements: [{ date, quantite }], comptages: [{ date, quantite }] } d'un seul
 * article et d'un seul lieu. Résultat : { quantite, comptage } (date-heure du comptage de départ, ou null).
 */
export function stockA({ mouvements = [], comptages = [] }, t, { exclure = null } = {}) {
  const fin = minute(t);
  const base = dernierComptage(comptages, fin, exclure);
  const depuis = base ? minute(base.date) : null;
  let q = base ? Dz(base.quantite) : Dz(0);
  for (const m of mouvements) {
    const d = minute(m.date);
    if (d <= fin && (depuis === null || d > depuis)) q = q.plus(Dz(m.quantite));
  }
  return { quantite: S(q), comptage: depuis };
}

/**
 * Écart d'un comptage : quantité comptée − stock calculé juste avant (comptages antérieurs et mouvements jusqu'à sa
 * minute comprise, ce comptage et ceux de la même minute écartés).
 */
export function ecartComptage(entree, comptage) {
  const d = minute(comptage.date);
  const autres = (entree.comptages ?? []).filter((c) => c !== comptage && minute(c.date) !== d);
  const avant = stockA({ mouvements: entree.mouvements, comptages: autres }, d);
  return { avant: avant.quantite, compte: S(Dz(comptage.quantite)), ecart: S(Dz(comptage.quantite).minus(Dz(avant.quantite))) };
}
