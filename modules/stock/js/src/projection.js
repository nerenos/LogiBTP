import { D, Dz, S } from '@logibtp/socle';

// Projection du disponible d'un article dans un lieu (ANALYSE-MODULE-STOCK.md § 5.4, S13, S14, S15), répliquée dans
// ReglesProjection.cs (jeu modules/stock/tests/cas/04_projection.json) : à partir du stock présent, les entrées
// attendues (reste à recevoir des commandes, à leur date de livraison prévue) et les sorties prévues (reste des
// réservations, à leur date de besoin) sont cumulées jour par jour ; un événement daté avant aujourd'hui compte à
// aujourd'hui et est signalé en retard ; le même jour, les entrées passent avant les sorties. Chaque réservation est
// servie avec le disponible de son jour (jamais négatif) ; son manque est couvert le premier jour où le disponible
// redevient positif ou nul. Proposition de commande : sous le mini à l'horizon → maxi (sinon mini) − disponible le
// plus bas, arrondi au conditionnement supérieur.

const jour = (d) => String(d).slice(0, 10);

/**
 * Entrée : { stock, aujourdhui, evenements: [{ id, type: 'ENTREE' | 'SORTIE', date, quantite }] } (quantités positives).
 * Résultat : { points: [{ date, entrees, sorties, disponible }], premiere_rupture, minimum: { date, disponible },
 * reservations: [{ id, date, demande, servi, manque, couverte_le }], retards: [id] }.
 */
export function projeter({ stock = 0, aujourdhui, evenements = [] }) {
  const auj = jour(aujourdhui);
  const retards = [];
  const evs = evenements.map((e, i) => {
    let d = jour(e.date);
    if (d < auj) { retards.push(e.id); d = auj; }
    return { ...e, d, i, q: Dz(e.quantite) };
  }).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.type === b.type ? a.i - b.i : a.type === 'ENTREE' ? -1 : 1)));
  let dispo = Dz(stock);
  const points = [];
  const reservations = [];
  const ouvertes = [];
  let premiere = dispo.lt(0) ? auj : null;
  let minimum = { date: auj, disponible: S(dispo) };
  for (const e of evs) {
    let p = points.at(-1);
    if (!p || p.date !== e.d) { p = { date: e.d, entrees: Dz(0), sorties: Dz(0), disponible: dispo }; points.push(p); }
    if (e.type === 'ENTREE') {
      dispo = dispo.plus(e.q);
      p.entrees = p.entrees.plus(e.q);
    } else {
      const servi = Dz(0).plus(dispo.gt(0) ? (dispo.gte(e.q) ? e.q : dispo) : 0);
      const r = { id: e.id, date: e.d, demande: S(e.q), servi: S(servi), manque: S(e.q.minus(servi)), couverte_le: e.q.minus(servi).isZero() ? e.d : null };
      reservations.push(r);
      if (!r.couverte_le) ouvertes.push(r);
      dispo = dispo.minus(e.q);
      p.sorties = p.sorties.plus(e.q);
    }
    p.disponible = dispo;
    if (dispo.lt(0) && premiere === null) premiere = e.d;
    if (dispo.lt(D(minimum.disponible))) minimum = { date: e.d, disponible: S(dispo) };
    if (dispo.gte(0)) for (const r of ouvertes.splice(0)) r.couverte_le = e.d;
  }
  return {
    points: points.map((p) => ({ date: p.date, entrees: S(p.entrees), sorties: S(p.sorties), disponible: S(p.disponible) })),
    premiere_rupture: premiere, minimum, reservations, retards,
  };
}

/** Disponible le plus bas jusqu'à une date (incluse), stock présent compris. */
export function minimumJusqua(projection, stock, date) {
  let min = Dz(stock);
  for (const p of projection.points) if (p.date <= jour(date) && D(p.disponible).lt(min)) min = D(p.disponible);
  return S(min);
}

/**
 * Proposition de réapprovisionnement : { mini, maxi, disponible (le plus bas à l'horizon), conditionnement (quantité
 * en unité de stock d'une unité d'achat, 1 par défaut) } → { quantite (unité de stock), unites_achat } ou null si le
 * disponible ne passe pas sous le mini.
 */
export function proposer({ mini, maxi = null, disponible, conditionnement = 1 }) {
  const m = D(mini);
  if (m === null || !Dz(disponible).lt(m)) return null;
  const cible = D(maxi) ?? m;
  const besoin = cible.minus(Dz(disponible));
  if (besoin.lte(0)) return null;
  const c = D(conditionnement) ?? Dz(1);
  const unites = c.gt(0) ? besoin.div(c).ceil() : besoin.ceil();
  return { quantite: S(c.gt(0) ? unites.times(c) : unites), unites_achat: S(unites) };
}
