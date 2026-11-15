import { D, Dz, S } from '@logibtp/socle';
import { projeter } from './projection.js';
import { NATURE_PART_APPRO, MOTIF_REAPPRO } from './codes.js';

// Ventilation des besoins d'une demande d'appro (ANALYSE-MODULE-MCP.md § 7.2, plan mcp.md lot 8, décision Q10),
// répliquée dans ReglesVentilation.cs (jeu modules/stock/tests/cas/07_ventilation.json). Besoins servis par date de
// besoin (puis ordre reçu), chacun dans cet ordre :
// 1) STOCK des dépôts, dépôt préféré d'abord puis les autres dans l'ordre reçu : prenable à la date de besoin = disponible
//    projeté le plus bas de cette date à la fin de la projection (projection.js : stock, entrées et sorties prévues, plus les
//    prélèvements des besoins déjà ventilés), jamais négatif ; aucune rupture n'est donc créée, mais le mini peut être franchi ;
// 2) COMMANDE en cours de l'article (reste à recevoir non affecté, hors des événements des dépôts), livrée au plus tard à la date
//    de besoin, la plus tôt livrée d'abord ; une date passée compte aujourd'hui ;
// 3) ACHAT du reste au fournisseur principal de l'article, au conditionnement supérieur.
// Puis, pour chaque dépôt dont un article prélevé finit sous son mini (disponible projeté le plus bas, prélèvements compris) :
// demande de réappro (MINI_FRANCHI) pour revenir au maxi, sinon au mini, avec les autres articles du dépôt dont le disponible le
// plus bas est au plus à `proche_mini` % au-dessus de leur mini (PROCHE_MINI, mini franchi compris), regroupés par fournisseur
// principal (ordre de première apparition). Quantités en unité de stock ; seul arrondi : `auConditionnement`.

export const PROCHE_MINI_DEFAUT = 20;

const jour = (d) => String(d).slice(0, 10);
const cle = (depot, article) => `${depot}\u0000${article}`;

/** Seul arrondi de la règle : quantité positive → unités d'achat entières (conditionnement > 0, sinon unité entière supérieure). */
export function auConditionnement(quantite, conditionnement = 1) {
  const q = Dz(quantite);
  const c = D(conditionnement) ?? Dz(1);
  const unites = c.gt(0) ? q.div(c).ceil() : q.ceil();
  return { quantite: c.gt(0) ? unites.times(c) : unites, unites_achat: unites };
}

const projection = (aujourdhui, e) => projeter({ stock: e.stock, aujourdhui, evenements: [...e.evenements, ...e.prelevements] });

/** Prenable à une date : disponible le plus bas de cette date (incluse, stock présent si aucun point avant) à la fin. */
function prenable(aujourdhui, e, date) {
  const points = projection(aujourdhui, e).points;
  let min = Dz(e.stock);
  for (const p of points) if (p.date <= date) min = D(p.disponible);
  for (const p of points) if (p.date > date && D(p.disponible).lt(min)) min = D(p.disponible);
  return min.gt(0) ? min : Dz(0);
}

const plusPetit = (a, b) => (a.lt(b) ? a : b);

/**
 * Entrée : { aujourdhui, besoins: [{ id, article, quantite, date_besoin, depot_prefere }],
 * depots: [{ id, articles: [{ article, stock, mini, maxi, evenements: [{ id, type, date, quantite }] }] }],
 * commandes: [{ id, article, reste, date_livraison, fournisseur }], articles: [{ article, fournisseur, conditionnement }],
 * proche_mini (%, 20 par défaut) }.
 * Résultat : { besoins: [{ id, article, quantite, parts: [{ nature: STOCK, depot, quantite } | { nature: COMMANDE, commande,
 * quantite } | { nature: ACHAT, fournisseur, quantite, unites_achat }] }] (ordre reçu), reappros: [{ depot, fournisseurs:
 * [{ fournisseur, lignes: [{ article, motif, disponible, mini, maxi, quantite, unites_achat }] }] }] (ordre des dépôts) }.
 */
export function ventiler({ aujourdhui, besoins = [], depots = [], commandes = [], articles = [], proche_mini = PROCHE_MINI_DEFAUT }) {
  const auj = jour(aujourdhui);
  const etats = new Map();
  for (const d of depots) {
    for (const a of d.articles ?? []) {
      etats.set(cle(d.id, a.article), { stock: Dz(a.stock), mini: D(a.mini), maxi: D(a.maxi), evenements: a.evenements ?? [], prelevements: [], preleve: Dz(0) });
    }
  }
  const fiches = new Map(articles.map((a) => [a.article, a]));
  const restes = commandes.map((c) => Dz(c.reste));
  const livraison = (c) => { const d = jour(c.date_livraison); return d < auj ? auj : d; };

  const ordre = besoins.map((b, i) => ({ b, i, d: jour(b.date_besoin) < auj ? auj : jour(b.date_besoin) }))
    .sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.i - y.i));
  const resultats = new Array(besoins.length);
  for (const { b, i, d } of ordre) {
    const parts = [];
    let reste = Dz(b.quantite);
    const ids = depots.map((x) => x.id);
    const rangs = ids.includes(b.depot_prefere) ? [b.depot_prefere, ...ids.filter((x) => x !== b.depot_prefere)] : ids;
    for (const depot of rangs) {
      if (!reste.gt(0)) break;
      const e = etats.get(cle(depot, b.article));
      if (!e) continue;
      const q = plusPetit(reste, prenable(auj, e, d));
      if (!q.gt(0)) continue;
      e.prelevements.push({ id: `V:${b.id}`, type: 'SORTIE', date: d, quantite: q });
      e.preleve = e.preleve.plus(q);
      reste = reste.minus(q);
      parts.push({ nature: NATURE_PART_APPRO.STOCK, depot, quantite: S(q) });
    }
    const eligibles = commandes.map((c, k) => ({ c, k })).filter(({ c }) => c.article === b.article && livraison(c) <= d)
      .sort((x, y) => (livraison(x.c) < livraison(y.c) ? -1 : livraison(x.c) > livraison(y.c) ? 1 : x.k - y.k));
    for (const { c, k } of eligibles) {
      if (!reste.gt(0)) break;
      const q = plusPetit(reste, restes[k]);
      if (!q.gt(0)) continue;
      restes[k] = restes[k].minus(q);
      reste = reste.minus(q);
      parts.push({ nature: NATURE_PART_APPRO.COMMANDE, commande: c.id, quantite: S(q) });
    }
    if (reste.gt(0)) {
      const f = fiches.get(b.article);
      const a = auConditionnement(reste, f?.conditionnement ?? 1);
      parts.push({ nature: NATURE_PART_APPRO.ACHAT, fournisseur: f?.fournisseur ?? null, quantite: S(a.quantite), unites_achat: S(a.unites_achat) });
    }
    resultats[i] = { id: b.id, article: b.article, quantite: S(Dz(b.quantite)), parts };
  }

  const p = Dz(proche_mini);
  const reappros = [];
  for (const depot of depots) {
    const franchis = [];
    const proches = [];
    for (const a of depot.articles ?? []) {
      const e = etats.get(cle(depot.id, a.article));
      if (e.mini === null) continue;
      const min = D(projection(auj, e).minimum.disponible);
      const ligne = { article: a.article, disponible: min, e };
      if (e.preleve.gt(0) && min.lt(e.mini)) franchis.push({ ...ligne, motif: MOTIF_REAPPRO.MINI_FRANCHI });
      else if (min.lte(e.mini.times(Dz(100).plus(p)).div(100))) proches.push({ ...ligne, motif: MOTIF_REAPPRO.PROCHE_MINI });
    }
    if (!franchis.length) continue;
    const groupes = [];
    for (const l of [...franchis, ...proches]) {
      const besoin = (l.e.maxi ?? l.e.mini).minus(l.disponible);
      if (!besoin.gt(0)) continue;
      const f = fiches.get(l.article);
      const q = auConditionnement(besoin, f?.conditionnement ?? 1);
      const fournisseur = f?.fournisseur ?? null;
      let g = groupes.find((x) => x.fournisseur === fournisseur);
      if (!g) { g = { fournisseur, lignes: [] }; groupes.push(g); }
      g.lignes.push({ article: l.article, motif: l.motif, disponible: S(l.disponible), mini: S(l.e.mini), maxi: S(l.e.maxi),
        quantite: S(q.quantite), unites_achat: S(q.unites_achat) });
    }
    reappros.push({ depot: depot.id, fournisseurs: groupes });
  }
  return { besoins: resultats, reappros };
}
