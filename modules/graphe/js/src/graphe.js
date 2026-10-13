// Module Graphe : graphe de nœuds et d'arêtes, indépendant du métier (annuaire, structure des affaires, parcours des
// documents…). Chaque module construit son graphe (parcours de ses données) dans ce format, puis le confie à la vue
// (ui/vue-graphe.js) qu'il spécialise.
//
// Graphe : { noeuds: [{ cle, type, id, libelle, ordre, icone, sous_titre, actif, distance, depart, ... }],
//   aretes: [{ cle, de, vers, type, libelle, actif }] }
//   cle : identifiant unique du nœud (ex. P12) ; type : nature du nœud ou de l'arête, interprétée par la spécialisation ;
//   ordre : couche de la disposition (plus petit en haut) ; distance : nombre de sauts depuis le départ ; depart : nœud
//   de départ ; les autres propriétés sont libres (casquettes, niveau…).

/**
 * Parcours en largeur depuis la clé de départ : voisins(cle) → clés voisines, jusqu'à la profondeur demandée.
 * Renvoie Map(clé → distance), le départ à 0.
 */
export function parcourirEnLargeur(depart, voisins, profondeur) {
  const distances = new Map([[depart, 0]]);
  let frontiere = [depart];
  for (let d = 1; d <= profondeur && frontiere.length; d++) {
    const suivante = [];
    for (const k of frontiere) {
      for (const v of voisins(k)) {
        if (distances.has(v)) continue;
        distances.set(v, d);
        suivante.push(v);
      }
    }
    frontiere = suivante;
  }
  return distances;
}

/**
 * Fusion de deux graphes (développement d'un nœud) : nœuds et arêtes par clé ; un nœud déjà présent est gardé, un nœud
 * nouveau n'est jamais le départ. fusionnerNoeud(existant, nouveau) : ajustement d'un nœud présent dans les deux ;
 * apres(resultat, b) : règles de la spécialisation (ex. résumé de contacts retiré).
 */
export function fusionnerGraphes(a, b, { fusionnerNoeud = null, apres = null } = {}) {
  const noeuds = new Map(a.noeuds.map((n) => [n.cle, { ...n }]));
  for (const n of b.noeuds) {
    const x = noeuds.get(n.cle);
    if (!x) noeuds.set(n.cle, { ...n, depart: false });
    else fusionnerNoeud?.(x, n);
  }
  const aretes = new Map([...a.aretes, ...b.aretes].map((x) => [x.cle, x]));
  apres?.({ noeuds, aretes }, b);
  return { noeuds: [...noeuds.values()], aretes: [...aretes.values()] };
}

/**
 * Disposition en couches : une couche par valeur d'ordre des nœuds principaux (plus petit en haut), ordre dans chaque
 * couche par barycentre des voisins (moins de croisements), positions x sans chevauchement autour du barycentre.
 * Les nœuds « en colonne » (enColonne(n) : contacts, détails…) sont empilés sous les couches, chaque colonne à
 * l'aplomb de son premier voisin principal : la largeur du graphe ne dépend que des nœuds principaux.
 * Renvoie { positions: Map(clé → { x, y, couche }), couches }.
 */
export function disposerGraphe(graphe, { ecartX = 210, ecartY = 130, ecartContact = 38, iterations = 4, enColonne = (n) => n.colonne === true } = {}) {
  const principaux = graphe.noeuds.filter((n) => !enColonne(n));
  const ordres = [...new Set(principaux.map((n) => n.ordre ?? 0))].sort((a, b) => a - b);
  const couches = ordres.map((o) => principaux.filter((n) => (n.ordre ?? 0) === o).map((n) => n.cle));
  const coucheDe = new Map();
  couches.forEach((c, i) => c.forEach((k) => coucheDe.set(k, i)));
  const voisins = new Map(graphe.noeuds.map((n) => [n.cle, []]));
  for (const a of graphe.aretes) {
    if (!voisins.has(a.de) || !voisins.has(a.vers)) continue;
    voisins.get(a.de).push(a.vers);
    voisins.get(a.vers).push(a.de);
  }
  const x = new Map();
  couches.forEach((c) => c.forEach((k, i) => x.set(k, (i - (c.length - 1) / 2) * ecartX)));
  const barycentre = (k, sens) => {
    const v = voisins.get(k).filter((w) => coucheDe.has(w) && (sens > 0 ? coucheDe.get(w) < coucheDe.get(k) : coucheDe.get(w) > coucheDe.get(k)));
    return v.length ? v.reduce((s, w) => s + x.get(w), 0) / v.length : x.get(k);
  };
  // Positions sans chevauchement, au plus près des positions souhaitées (balayage), recentrées sur la moyenne souhaitée.
  const resoudre = (cles, souhait) => {
    const tries = [...cles].sort((a, b) => souhait.get(a) - souhait.get(b));
    const pos = tries.map((k) => souhait.get(k));
    for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + ecartX);
    const decalage = pos.length ? (pos.reduce((s, p) => s + p, 0) - tries.reduce((s, k) => s + souhait.get(k), 0)) / pos.length : 0;
    tries.forEach((k, i) => x.set(k, pos[i] - decalage));
    return tries;
  };
  for (let it = 0; it < iterations; it++) {
    for (let i = 1; i < couches.length; i++) couches[i] = resoudre(couches[i], new Map(couches[i].map((k) => [k, barycentre(k, 1)])));
    for (let i = couches.length - 2; i >= 0; i--) couches[i] = resoudre(couches[i], new Map(couches[i].map((k) => [k, barycentre(k, -1)])));
  }
  const positions = new Map();
  couches.forEach((c, i) => c.forEach((k) => positions.set(k, { x: x.get(k), y: i * ecartY, couche: i })));

  // Nœuds en colonne : une colonne par nœud principal (le premier voisin principal), sous la dernière couche.
  const colonnes = new Map();
  for (const n of graphe.noeuds.filter(enColonne)) {
    const parent = voisins.get(n.cle).find((w) => coucheDe.has(w)) ?? n.cle;
    if (!colonnes.has(parent)) colonnes.set(parent, []);
    colonnes.get(parent).push(n.cle);
  }
  const cles = [...colonnes.keys()];
  const souhait = new Map(cles.map((k) => [k, x.has(k) ? x.get(k) : 0]));
  resoudre(cles, souhait);
  const base = couches.length * ecartY;
  for (const k of cles) colonnes.get(k).forEach((c, i) => positions.set(c, { x: x.get(k), y: base + i * ecartContact, couche: couches.length + i }));
  return { positions, couches: [...couches, ...(cles.length ? [cles] : [])] };
}

/** Voisinage d'un nœud : le nœud, ses voisins et les arêtes qui les relient. */
export function voisinage(graphe, cle) {
  const noeuds = new Set([cle]);
  const aretes = new Set();
  for (const a of graphe.aretes) if (a.de === cle || a.vers === cle) { noeuds.add(a.de); noeuds.add(a.vers); aretes.add(a.cle); }
  return { noeuds, aretes };
}
