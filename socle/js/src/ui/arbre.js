// Opérations génériques sur une liste d'éléments hiérarchiques (lignes de document ou lignes de métré).
// cfg = { id, parent, ordre } : noms des colonnes. parent + ordre sont la source de vérité.

export const CFG_LIGNES = { id: 'lig_id', parent: 'lig_parent_id', ordre: 'lig_ordre' };

const pid = (cfg, x) => x[cfg.parent] ?? null;

export function enfants(cfg, items, parentId) {
  return items
    .filter((x) => pid(cfg, x) === (parentId ?? null))
    .sort((a, b) => (a[cfg.ordre] - b[cfg.ordre]) || (a[cfg.id] - b[cfg.id]));
}

/** Parcours en profondeur : ordre d'affichage. `replies` : ID dont les enfants sont masqués. */
export function ordreAffichage(cfg, items, replies = null) {
  const res = [];
  const parcourir = (p, profondeur) => {
    for (const x of enfants(cfg, items, p)) {
      res.push({ item: x, profondeur });
      if (!replies || !replies.has(x[cfg.id])) parcourir(x[cfg.id], profondeur + 1);
    }
  };
  parcourir(null, 0);
  return res;
}

export function parId(cfg, items) {
  return new Map(items.map((x) => [x[cfg.id], x]));
}

export function ancetres(cfg, items, id) {
  const index = parId(cfg, items);
  const res = [];
  for (let x = index.get(index.get(id)?.[cfg.parent]); x; x = index.get(x[cfg.parent])) res.push(x);
  return res;
}

export function descendants(cfg, items, id) {
  const res = new Set();
  const pile = [id];
  while (pile.length) {
    const p = pile.pop();
    for (const x of items) if (pid(cfg, x) === p && !res.has(x[cfg.id])) { res.add(x[cfg.id]); pile.push(x[cfg.id]); }
  }
  return res;
}

/** Racines d'une sélection : éléments dont aucun ancêtre n'est sélectionné, dans l'ordre d'affichage. */
export function racinesSelection(cfg, items, ids) {
  const sel = new Set(ids);
  return ordreAffichage(cfg, items)
    .map((r) => r.item)
    .filter((x) => sel.has(x[cfg.id]) && !ancetres(cfg, items, x[cfg.id]).some((a) => sel.has(a[cfg.id])));
}

/** Renumérote les frères de 1 à n dans l'ordre courant. */
export function renumeroter(cfg, items, parentId) {
  enfants(cfg, items, parentId).forEach((x, i) => { x[cfg.ordre] = i + 1; });
}

/**
 * Place des éléments (déjà présents dans `items`) relativement à une cible.
 * position : 'avant' | 'apres' | 'enfant' (dernier enfant de la cible) | 'racine'.
 */
export function placer(cfg, items, elements, cibleId, position) {
  const index = parId(cfg, items);
  const cible = cibleId === null || cibleId === undefined ? null : index.get(cibleId);
  const nouveauParent = position === 'enfant' ? cible?.[cfg.id] ?? null : position === 'racine' ? null : cible ? pid(cfg, cible) : null;
  const anciensParents = new Set(elements.map((e) => pid(cfg, e)));
  const deplaces = new Set(elements.map((e) => e[cfg.id]));
  const freres = enfants(cfg, items, nouveauParent).filter((x) => !deplaces.has(x[cfg.id]));
  let rang = freres.length;
  if (cible && (position === 'avant' || position === 'apres')) {
    const i = freres.findIndex((x) => x[cfg.id] === cible[cfg.id]);
    rang = i < 0 ? freres.length : position === 'avant' ? i : i + 1;
  }
  freres.splice(rang, 0, ...elements);
  freres.forEach((x, i) => { x[cfg.parent] = nouveauParent; x[cfg.ordre] = i + 1; });
  for (const p of anciensParents) if (p !== nouveauParent) renumeroter(cfg, items, p);
}

/** Tab : l'élément devient le dernier enfant de son frère précédent. */
export function indenter(cfg, items, id, accepteEnfants) {
  const x = parId(cfg, items).get(id);
  const freres = enfants(cfg, items, pid(cfg, x));
  const i = freres.findIndex((f) => f[cfg.id] === id);
  if (i <= 0 || !accepteEnfants(freres[i - 1])) return false;
  placer(cfg, items, [x], freres[i - 1][cfg.id], 'enfant');
  return true;
}

/** Maj+Tab : l'élément remonte d'un niveau, juste après son parent. */
export function desindenter(cfg, items, id) {
  const index = parId(cfg, items);
  const x = index.get(id);
  const parent = index.get(pid(cfg, x));
  if (!parent) return false;
  placer(cfg, items, [x], parent[cfg.id], 'apres');
  return true;
}

/** Alt+↑ / Alt+↓ : échange avec le frère précédent ou suivant. */
export function decaler(cfg, items, id, sens) {
  const x = parId(cfg, items).get(id);
  const freres = enfants(cfg, items, pid(cfg, x));
  const i = freres.findIndex((f) => f[cfg.id] === id);
  const j = i + sens;
  if (j < 0 || j >= freres.length) return false;
  [freres[i], freres[j]] = [freres[j], freres[i]];
  freres.forEach((f, k) => { f[cfg.ordre] = k + 1; });
  return true;
}

/** Supprime des éléments et leurs sous-arbres ; renvoie les ID supprimés. */
export function supprimer(cfg, items, ids) {
  const aSupprimer = new Set();
  for (const id of ids) { aSupprimer.add(id); for (const d of descendants(cfg, items, id)) aSupprimer.add(d); }
  const parents = new Set(items.filter((x) => aSupprimer.has(x[cfg.id])).map((x) => pid(cfg, x)));
  for (let i = items.length - 1; i >= 0; i--) if (aSupprimer.has(items[i][cfg.id])) items.splice(i, 1);
  for (const p of parents) if (!aSupprimer.has(p)) renumeroter(cfg, items, p);
  return aSupprimer;
}
