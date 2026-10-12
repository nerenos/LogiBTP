// Graphe relationnel de l'annuaire autour d'une fiche (personne ou individu) : hiérarchie des personnes, liens typés entre
// personnes, rattachements des individus. Parcours en largeur jusqu'à la profondeur demandée (niveau de représentation) ;
// les niveaux supérieurs de la fiche de départ sont toujours présents (le groupe en haut). Réplique de GrapheAnnuaire.cs
// (jeu partagé modules/annuaire/tests/cas/03_graphe.json).
//
// Données : { niveaux: [{ code, ordre, icone }], types_lien: [{ code, libelle, libelle_inverse }],
//   personnes: [{ id, parent_id, niveau, raison_sociale, casquettes, actif, ville }], individus: [{ id, libelle, actif }],
//   rattachements: [{ id, per_id, ind_id, fonction, principal, actif }], liens: [{ id, per_id, cible_id, tli_code }] }
// Options : profondeur (1 à 5), contacts (individus rattachés), liens (liens typés), max_contacts (au-delà : un nœud
// « + N contacts » qui les résume).
//
// Résultat : { noeuds: [{ cle, type, id, libelle, niveau, ordre, icone, casquettes, actif, sous_titre, distance, depart, reste }],
//   aretes: [{ cle, de, vers, type, libelle, actif }] } ; nœuds triés par ordre puis clé, arêtes par clé.
// Clés : P<id> (personne), I<id> (individu), G<id> (contacts résumés d'une personne) ; ordre d'un individu : 1000.

export const PROFONDEUR_MAX = 5;
export const ORDRE_INDIVIDU = 1000;

const actif = (x) => x?.actif !== false;

export function construireGraphe(donnees, depart, { profondeur = 1, contacts = true, liens = true, max_contacts = 8 } = {}) {
  const prof = Math.min(Math.max(Number(profondeur) || 1, 1), PROFONDEUR_MAX);
  const personnes = new Map(donnees.personnes.map((p) => [Number(p.id), p]));
  const individus = new Map(donnees.individus.map((i) => [Number(i.id), i]));
  const niveaux = new Map(donnees.niveaux.map((n) => [n.code, n]));
  const typesLien = new Map((donnees.types_lien ?? []).map((t) => [t.code, t]));
  const enfants = new Map();
  for (const p of donnees.personnes) {
    if (p.parent_id === null || p.parent_id === undefined) continue;
    if (!enfants.has(Number(p.parent_id))) enfants.set(Number(p.parent_id), []);
    enfants.get(Number(p.parent_id)).push(Number(p.id));
  }
  const ratsPersonne = new Map(), ratsIndividu = new Map();
  for (const r of donnees.rattachements) {
    for (const [m, k] of [[ratsPersonne, Number(r.per_id)], [ratsIndividu, Number(r.ind_id)]]) {
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
  }
  // Contacts d'une personne : actifs, principaux, puis ordre de rattachement.
  for (const l of ratsPersonne.values()) l.sort((a, b) => Number(actif(b)) - Number(actif(a)) || Number(!!b.principal) - Number(!!a.principal) || a.id - b.id);
  const liensPar = new Map();
  for (const l of liens ? donnees.liens : []) {
    for (const k of [Number(l.per_id), Number(l.cible_id)]) {
      if (!liensPar.has(k)) liensPar.set(k, []);
      liensPar.get(k).push(l);
    }
  }

  const distances = new Map();   // clé → distance
  const resumes = new Map();     // personne → nombre de contacts non affichés
  const cle = (type, id) => `${type === 'personne' ? 'P' : 'I'}${id}`;
  const voisins = (k) => {
    const id = Number(k.slice(1));
    const v = [];
    if (k[0] === 'P') {
      const p = personnes.get(id);
      if (p?.parent_id !== null && p?.parent_id !== undefined && personnes.has(Number(p.parent_id))) v.push(`P${p.parent_id}`);
      for (const e of [...(enfants.get(id) ?? [])].sort((a, b) => a - b)) v.push(`P${e}`);
      for (const l of [...(liensPar.get(id) ?? [])].sort((a, b) => a.id - b.id)) v.push(`P${Number(l.per_id) === id ? l.cible_id : l.per_id}`);
      if (contacts) {
        const rats = (ratsPersonne.get(id) ?? []).filter((r) => individus.has(Number(r.ind_id)));
        rats.slice(0, max_contacts).forEach((r) => v.push(`I${r.ind_id}`));
        if (rats.length > max_contacts) resumes.set(id, rats.length - max_contacts);
      }
    } else if (contacts) {
      for (const r of [...(ratsIndividu.get(id) ?? [])].sort((a, b) => a.id - b.id)) if (personnes.has(Number(r.per_id))) v.push(`P${r.per_id}`);
    }
    return v;
  };

  const k0 = cle(depart.type, Number(depart.id));
  if (!(k0[0] === 'P' ? personnes : individus).has(Number(depart.id))) return { noeuds: [], aretes: [] };
  distances.set(k0, 0);
  let frontiere = [k0];
  for (let d = 1; d <= prof && frontiere.length; d++) {
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
  // Résumés des contacts : seulement pour les personnes dont les voisins ont été parcourus (distance < profondeur).
  for (const [id] of [...resumes]) if (!(distances.get(`P${id}`) < prof)) resumes.delete(id);
  // Niveaux supérieurs de la fiche de départ (ou des personnes d'un individu de départ) : toujours présents.
  const remonter = (id) => {
    for (let p = personnes.get(id), vus = new Set(); p && p.parent_id !== null && p.parent_id !== undefined && !vus.has(p.id); p = personnes.get(Number(p.parent_id))) {
      vus.add(p.id);
      const k = `P${p.parent_id}`;
      if (!personnes.has(Number(p.parent_id))) break;
      if (!distances.has(k)) distances.set(k, (distances.get(`P${p.id}`) ?? 0) + 1);
    }
  };
  if (k0[0] === 'P') remonter(Number(depart.id));
  else for (const r of ratsIndividu.get(Number(depart.id)) ?? []) if (distances.has(`P${r.per_id}`)) remonter(Number(r.per_id));

  const noeuds = [];
  for (const [k, distance] of distances) {
    const id = Number(k.slice(1));
    if (k[0] === 'P') {
      const p = personnes.get(id);
      const n = niveaux.get(p.niveau);
      noeuds.push({ cle: k, type: 'personne', id, libelle: p.raison_sociale, niveau: p.niveau, ordre: n?.ordre ?? 0, icone: n?.icone ?? null,
        casquettes: [...(p.casquettes ?? [])], actif: actif(p), sous_titre: p.ville ?? null, distance, depart: k === k0, reste: null });
    } else {
      const i = individus.get(id);
      noeuds.push({ cle: k, type: 'individu', id, libelle: i.libelle, niveau: null, ordre: ORDRE_INDIVIDU, icone: '👤', casquettes: [], actif: actif(i),
        sous_titre: null, distance, depart: k === k0, reste: null });
    }
  }
  for (const [id, n] of resumes) {
    noeuds.push({ cle: `G${id}`, type: 'groupe', id, libelle: `+ ${n} contact${n > 1 ? 's' : ''}`, niveau: null, ordre: ORDRE_INDIVIDU, icone: '👥', casquettes: [],
      actif: true, sous_titre: null, distance: distances.get(`P${id}`) + 1, depart: false, reste: n });
  }

  const presents = new Set(noeuds.map((n) => n.cle));
  const aretes = [];
  for (const p of donnees.personnes) {
    if (p.parent_id === null || p.parent_id === undefined) continue;
    const de = `P${p.parent_id}`, vers = `P${p.id}`;
    if (presents.has(de) && presents.has(vers)) aretes.push({ cle: `H${p.id}`, de, vers, type: 'hierarchie', libelle: null, actif: actif(p) });
  }
  for (const l of liens ? donnees.liens : []) {
    const de = `P${l.per_id}`, vers = `P${l.cible_id}`;
    if (presents.has(de) && presents.has(vers)) aretes.push({ cle: `L${l.id}`, de, vers, type: 'lien', libelle: typesLien.get(l.tli_code)?.libelle ?? l.tli_code, actif: true });
  }
  if (contacts) {
    for (const r of donnees.rattachements) {
      const de = `P${r.per_id}`, vers = `I${r.ind_id}`;
      if (presents.has(de) && presents.has(vers)) aretes.push({ cle: `R${r.id}`, de, vers, type: 'rattachement', libelle: r.fonction ?? null, actif: actif(r) });
    }
  }
  for (const [id] of resumes) aretes.push({ cle: `G${id}`, de: `P${id}`, vers: `G${id}`, type: 'groupe', libelle: null, actif: true });

  const rang = (k) => ({ P: 0, I: 1, G: 2 }[k[0]] * 1e9 + Number(k.slice(1)));
  noeuds.sort((a, b) => a.ordre - b.ordre || rang(a.cle) - rang(b.cle));
  aretes.sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  return { noeuds, aretes };
}

/** Fusion de deux graphes (développement d'un nœud) : nœuds et arêtes par clé, plus petite distance conservée. */
export function fusionnerGraphes(a, b) {
  const noeuds = new Map(a.noeuds.map((n) => [n.cle, { ...n }]));
  for (const n of b.noeuds) {
    const x = noeuds.get(n.cle);
    if (!x) noeuds.set(n.cle, { ...n, depart: false });
    else if (x.type === 'groupe' && n.type === 'groupe') x.reste = Math.min(x.reste, n.reste);
  }
  const aretes = new Map([...a.aretes, ...b.aretes].map((x) => [x.cle, x]));
  // Nœud développé (départ du second graphe) sans résumé : tous ses contacts sont affichés, l'ancien résumé disparaît.
  const developpe = b.noeuds.find((n) => n.depart && n.type === 'personne');
  if (developpe && !b.noeuds.some((n) => n.cle === `G${developpe.id}`)) {
    noeuds.delete(`G${developpe.id}`);
    aretes.delete(`G${developpe.id}`);
  }
  return { noeuds: [...noeuds.values()], aretes: [...aretes.values()] };
}

/**
 * Disposition en couches : une couche par ordre de niveau des personnes (groupe en haut, …, agences, dépôts), ordre dans
 * chaque couche par barycentre des voisins (moins de croisements), positions x sans chevauchement autour du barycentre.
 * Les contacts (individus, résumés) sont en colonnes sous les couches, chaque colonne à l'aplomb de sa personne (la
 * première rattachée) : la largeur du graphe ne dépend que des personnes. Renvoie { positions: Map(clé → { x, y, couche }), couches }.
 */
export function disposerGraphe(graphe, { ecartX = 210, ecartY = 130, ecartContact = 38, iterations = 4 } = {}) {
  const estContact = (n) => n.type !== 'personne';
  const personnes = graphe.noeuds.filter((n) => !estContact(n));
  const ordres = [...new Set(personnes.map((n) => n.ordre))].sort((a, b) => a - b);
  const couches = ordres.map((o) => personnes.filter((n) => n.ordre === o).map((n) => n.cle));
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

  // Contacts : une colonne par personne (la première personne voisine), sous la dernière couche de personnes.
  const colonnes = new Map();
  for (const n of graphe.noeuds.filter(estContact)) {
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
