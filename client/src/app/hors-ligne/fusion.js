import { texte } from '@logibtp/socle/dictionnaire';
import { CHAMPS_SERVEUR } from './attente.js';

// Fusion à trois voies d'un document saisi hors ligne (mode hors ligne, lot 4) : version de départ (document du
// serveur au début de la saisie), saisie locale, version actuelle du serveur. Par entité (entête, lignes, métrés,
// variables, ventilations : clé = identifiant) puis par champ : ce qui n'a changé que d'un côté est pris d'office ;
// même champ changé des deux côtés, ou entité supprimée d'un côté et modifiée de l'autre : conflit, tranché par
// l'utilisateur (choix 'local' ou 'serveur', défaut : la saisie locale, sauf une suppression locale d'une entité
// modifiée sur le serveur, gardée). Version de départ inconnue : toute différence est un conflit.
// Après fusion : lignes dont le parent a disparu rattachées à leur parent restauré, ordre renuméroté par parent,
// entités gardées mais supprimées sur le serveur ré-identifiées (identifiants provisoires négatifs, références
// suivies). Le résultat est recalculé par le moteur dans la page document avant l'enregistrement.

/** Tables de la saisie fusionnées, avec leur clé. */
export const TABLES_FUSION = [['lignes', 'lig_id'], ['metres', 'mtr_id'], ['variables', 'var_id'], ['ventilations', 'vfr_id']];

/** Champs de l'entête jamais comparés : tenus par le serveur ou calculés. */
const IGNORES_DOCUMENT = new Set([...CHAMPS_SERVEUR, 'ent_total_ht', 'ent_total_tva', 'ent_total_ttc', 'ent_net_a_payer', 'ent_coef_fa']);

/** Champs des lignes calculés par les moteurs (ou dérivés) : jamais en conflit, recalculés après la fusion. */
const CALCULES_LIGNE = new Set([
  'lig_ent_id', 'lig_chemin', 'lig_ordre', 'lig_numerotation', 'lig_libelle_affiche', 'lig_libelle_brut',
  'lig_qte_vendue', 'lig_qte_totale', 'lig_qte_base', 'lig_pv_remise', 'lig_montant_ht', 'lig_montant_tva', 'lig_base_calcul', 'lig_taux_tva',
  'lig_pr', 'lig_coef_fa', 'lig_montant_pa', 'lig_montant_pr', 'lig_heures_realisees',
  'lig_avt_qte_marche', 'lig_avt_montant_marche', 'lig_avt_montant_precedent', 'lig_avt_qte_precedent', 'lig_avt_pct_precedent',
  'lig_avt_montant_cumul', 'lig_avt_qte_cumul', 'lig_avt_pct',
]);

/** Champ non comparé : calculé, ou prix calculé tant qu'il n'est imposé d'aucun côté. */
function ignore(table, champ, ...versions) {
  if (table === 'document') return IGNORES_DOCUMENT.has(champ);
  if (table !== 'lignes') return champ.endsWith('_ent_id');
  if (CALCULES_LIGNE.has(champ)) return true;
  const impose = (k) => versions.some((v) => v?.[k] === true || v?.[k] === 'true');
  if (champ === 'lig_pv') return !impose('lig_pv_fixe');
  if (champ === 'lig_pv_affiche') return !impose('lig_pv_affiche_fixe');
  return false;
}

const numerique = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));
const trie = (v) => (Array.isArray(v) ? v.map(trie) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, trie(v[k])])) : v);

/** Égalité de deux valeurs de champ (absent = null, nombres en texte ou non, objets sans ordre des clés). */
export function egal(a, b) {
  const x = a ?? null;
  const y = b ?? null;
  if (x === y) return true;
  if (x === null || y === null) return false;
  if (numerique(x) && numerique(y)) return Number(x) === Number(y);
  if (typeof x === 'object' || typeof y === 'object') return JSON.stringify(trie(x)) === JSON.stringify(trie(y));
  return false;
}

/** Entité inchangée par rapport à la version de départ (champs comparés seulement). */
function inchangee(table, base, v) {
  const champs = new Set([...Object.keys(base), ...Object.keys(v)]);
  return [...champs].every((k) => ignore(table, k, base, v) || egal(base[k], v[k]));
}

/** Texte court d'une entité pour l'écran d'arbitrage. */
export function libelleEntite(table, e) {
  if (!e) return '';
  if (table === 'document') return texte('hors_ligne_btp.entites.document');
  if (table === 'lignes') {
    const brut = String(e.lig_libelle_brut ?? e.lig_libelle_html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return [e.lig_code, brut.length > 70 ? `${brut.slice(0, 70)}…` : brut].filter(Boolean).join(' – ') || texte('hors_ligne_btp.entites.ligne', { id: e.lig_id });
  }
  if (table === 'metres') return texte('hors_ligne_btp.entites.metre', { id: e.mtr_lig_id });
  if (table === 'variables') return texte('hors_ligne_btp.entites.variable', { nom: e.var_nom ?? e.var_id });
  return texte('hors_ligne_btp.entites.ventilation', { id: e.vfr_id });
}

/**
 * Fusion des champs d'une entité présente des trois côtés (ou des deux, base inconnue). Les conflits sont ajoutés à
 * `conflits` ; `choix` (Map clé → 'local' | 'serveur') les tranche.
 */
function fusionnerChamps(table, id, base, local, serveur, choix, conflits, changements) {
  const res = {};
  let ici = false;
  let labas = false;
  for (const k of new Set([...Object.keys(local), ...Object.keys(serveur), ...Object.keys(base ?? {})])) {
    const l = local[k];
    const s = serveur[k];
    if (ignore(table, k, base, local, serveur)) {
      res[k] = base && !egal(l, base[k]) ? l : (k in serveur ? s : l);
      continue;
    }
    if (base && !egal(l, base[k])) ici = true;
    if (base && !egal(s, base[k])) labas = true;
    if (egal(l, s)) { res[k] = l; continue; }
    if (base && egal(l, base[k])) { res[k] = s; continue; }
    if (base && egal(s, base[k])) { res[k] = l; continue; }
    const cle = `${table}:${id}:${k}`;
    const c = choix.get(cle) ?? 'local';
    conflits.push({ cle, table, id, champ: k, nature: 'CHAMP', depart: base?.[k] ?? null, local: l ?? null, serveur: s ?? null, choix: c,
      libelle: libelleEntite(table, local) });
    res[k] = c === 'serveur' ? s : l;
  }
  if (!base) ici = labas = !inchangee(table, serveur, local);
  if (ici || labas) changements.push({ table, id, nature: 'MODIFICATION', cote: ici && labas ? 'deux' : ici ? 'ici' : 'serveur', libelle: libelleEntite(table, local) });
  return res;
}

/** Fusion d'une table (lignes, métrés…) par identifiant. */
function fusionnerTable(table, cle, depart, local, serveur, choix, conflits, changements) {
  const parId = (l) => new Map((l ?? []).map((x) => [x[cle], x]));
  const B = depart ? parId(depart) : null;
  const L = parId(local);
  const S = parId(serveur);
  const res = [];
  const ids = new Set([...L.keys(), ...S.keys(), ...(B ? B.keys() : [])]);
  for (const id of ids) {
    const b = B?.get(id);
    const l = L.get(id);
    const s = S.get(id);
    const libelle = libelleEntite(table, l ?? s ?? b);
    if (l && s) { res.push(fusionnerChamps(table, id, b, l, s, choix, conflits, changements)); continue; }
    if (!l && !s) continue; // supprimée des deux côtés
    // Présente d'un seul côté : ajout, suppression simple, ou suppression d'un côté et modification de l'autre.
    const connue = B !== null;
    // Compléments d'une ligne (métrés, variables, ventilations) : ils suivent le sort de leur ligne (retirés ensuite si
    // elle a disparu), jamais un conflit à eux seuls.
    if (table !== 'lignes' && (connue ? !(b && inchangee(table, b, l ?? s)) : true)) { res.push(l ?? s); continue; }
    if (l) {
      if (connue && !b) { res.push(l); changements.push({ table, id, nature: 'AJOUT', cote: 'ici', libelle }); continue; }
      if (!connue && id < 0) { res.push(l); changements.push({ table, id, nature: 'AJOUT', cote: 'ici', libelle }); continue; }
      if (connue && inchangee(table, b, l)) { changements.push({ table, id, nature: 'SUPPRESSION', cote: 'serveur', libelle }); continue; }
      const k = `${table}:${id}:*`;
      const c = choix.get(k) ?? 'local';
      conflits.push({ cle: k, table, id, champ: null, nature: 'SUPPRIME_SERVEUR', choix: c, libelle });
      if (c === 'local') res.push(l);
    } else {
      if (connue && !b) { res.push(s); changements.push({ table, id, nature: 'AJOUT', cote: 'serveur', libelle }); continue; }
      if (connue && inchangee(table, b, s)) { changements.push({ table, id, nature: 'SUPPRESSION', cote: 'ici', libelle }); continue; }
      const k = `${table}:${id}:*`;
      const c = choix.get(k) ?? 'serveur';
      conflits.push({ cle: k, table, id, champ: null, nature: 'SUPPRIME_ICI', choix: c, libelle });
      if (c === 'serveur') res.push(s);
    }
  }
  return res;
}

/** Lignes dont le parent n'est plus dans le résultat : parent restauré (saisie locale, sinon serveur). */
function reparerParents(lignes, local, serveur) {
  const ids = new Set(lignes.map((l) => l.lig_id));
  const sources = [...(local ?? []), ...(serveur ?? [])];
  for (let i = 0; i < lignes.length; i++) {
    const p = lignes[i].lig_parent_id;
    if (p === null || p === undefined || ids.has(p)) continue;
    const parent = sources.find((x) => x.lig_id === p);
    if (parent) { lignes.push({ ...parent }); ids.add(p); } else lignes[i] = { ...lignes[i], lig_parent_id: null };
  }
}

/**
 * Entités gardées dont l'identifiant positif n'existe plus sur le serveur : nouveaux identifiants négatifs, références
 * entre tables suivies (parents, variantes, bases de pied, métrés, variables, ventilations).
 */
export function reidentifier(saisie, serveur) {
  let min = 0;
  for (const [t, k] of TABLES_FUSION) for (const x of saisie[t] ?? []) if (x[k] < min) min = x[k];
  const cartes = {};
  for (const [t, k] of TABLES_FUSION) {
    const existe = new Set((serveur[t] ?? []).map((x) => x[k]));
    cartes[t] = new Map();
    for (const x of saisie[t] ?? []) if (x[k] > 0 && !existe.has(x[k])) cartes[t].set(x[k], --min);
  }
  const m = (t, id) => (id === null || id === undefined ? id : cartes[t].get(id) ?? id);
  return {
    ...saisie,
    lignes: (saisie.lignes ?? []).map((l) => ({
      ...l, lig_id: m('lignes', l.lig_id), lig_parent_id: m('lignes', l.lig_parent_id), lig_variante_de_id: m('lignes', l.lig_variante_de_id),
      lig_pied_base_id: m('lignes', l.lig_pied_base_id), lig_st_depuis_id: m('lignes', l.lig_st_depuis_id), lig_mtr_id: m('metres', l.lig_mtr_id),
    })),
    metres: (saisie.metres ?? []).map((x) => ({ ...x, mtr_id: m('metres', x.mtr_id), mtr_lig_id: m('lignes', x.mtr_lig_id) })),
    variables: (saisie.variables ?? []).map((v) => ({ ...v, var_id: m('variables', v.var_id), var_lig_id: m('lignes', v.var_lig_id), var_mtr_id: m('metres', v.var_mtr_id) })),
    ventilations: (saisie.ventilations ?? []).map((v) => ({
      ...v, vfr_id: m('ventilations', v.vfr_id), vfr_source_lig_id: m('lignes', v.vfr_source_lig_id), vfr_lig_id: m('lignes', v.vfr_lig_id),
    })),
  };
}

/** Ordre des lignes renuméroté 1, 2… sous chaque parent (ordre fusionné, puis identifiant). */
function renumeroter(lignes) {
  const groupes = new Map();
  for (const l of lignes) { const p = l.lig_parent_id ?? null; if (!groupes.has(p)) groupes.set(p, []); groupes.get(p).push(l); }
  for (const g of groupes.values()) {
    g.sort((a, b) => (Number(a.lig_ordre) - Number(b.lig_ordre)) || (a.lig_id - b.lig_id)).forEach((l, i) => { l.lig_ordre = i + 1; });
  }
}

/** Compléments rattachés à une ligne disparue : retirés ; métré disparu : la ligne n'y renvoie plus. */
function nettoyer(saisie) {
  const lignes = new Set(saisie.lignes.map((l) => l.lig_id));
  const metres = saisie.metres.filter((x) => lignes.has(x.mtr_lig_id));
  const mtr = new Set(metres.map((x) => x.mtr_id));
  return {
    ...saisie,
    lignes: saisie.lignes.map((l) => (l.lig_mtr_id !== null && l.lig_mtr_id !== undefined && !mtr.has(l.lig_mtr_id) ? { ...l, lig_mtr_id: null } : l)),
    metres,
    variables: saisie.variables.filter((v) => (v.var_lig_id === null || v.var_lig_id === undefined || lignes.has(v.var_lig_id))
      && (v.var_mtr_id === null || v.var_mtr_id === undefined || mtr.has(v.var_mtr_id))),
    ventilations: saisie.ventilations.filter((v) => lignes.has(v.vfr_lig_id) && (v.vfr_source_lig_id === null || v.vfr_source_lig_id === undefined || lignes.has(v.vfr_source_lig_id))),
  };
}

/**
 * Fusion : { depart (null : inconnue), local, serveur } (contenus { document, lignes, metres, variables,
 * ventilations }), `choix` : Map clé de conflit → 'local' | 'serveur'. Renvoie { saisie, conflits, changements } ; la
 * saisie porte l'identité du serveur (version comprise) : son enregistrement remplace la version actuelle.
 * `mode` 'ecraser' : la saisie locale entière, sur l'identité du serveur.
 */
export function fusionner({ depart = null, local, serveur }, { choix = new Map(), mode = 'fusion' } = {}) {
  const conflits = [];
  const changements = [];
  let saisie;
  if (mode === 'ecraser') {
    saisie = { ...local, document: { ...local.document } };
  } else {
    saisie = { ...serveur };
    saisie.document = fusionnerChamps('document', serveur.document.ent_id, depart?.document ?? null, local.document, serveur.document, choix, conflits, changements);
    for (const [t, k] of TABLES_FUSION) saisie[t] = fusionnerTable(t, k, depart ? depart[t] ?? [] : null, local[t] ?? [], serveur[t] ?? [], choix, conflits, changements);
  }
  for (const k of CHAMPS_SERVEUR) if (k in serveur.document) saisie.document[k] = serveur.document[k];
  for (const [t] of TABLES_FUSION) saisie[t] = (saisie[t] ?? []).map((x) => ({ ...x }));
  reparerParents(saisie.lignes, local.lignes, serveur.lignes);
  saisie = nettoyer(reidentifier(saisie, serveur));
  const id = saisie.document.ent_id;
  for (const l of saisie.lignes) l.lig_ent_id = id;
  for (const v of saisie.ventilations) v.vfr_ent_id = id;
  renumeroter(saisie.lignes);
  return { saisie, conflits, changements };
}

/**
 * Copie en brouillon de la saisie locale (document modifié ou validé sur le serveur entre-temps) : entête sans
 * identité ni numéro, toutes les entités en identifiants provisoires négatifs.
 */
export function copieLocale(local, idProvisoire) {
  const vide = { lignes: [], metres: [], variables: [], ventilations: [] };
  const s = reidentifier({ ...vide, ...local }, vide);
  const document = Object.fromEntries(Object.entries(local.document).filter(([k]) => !CHAMPS_SERVEUR.includes(k)));
  Object.assign(document, { ent_id: idProvisoire, ent_tyd_id: local.document.ent_tyd_id, ent_std_id: local.document.ent_std_id, ent_numero: null, ent_version: 1, ent_indice: null, ent_verrouille: false });
  for (const l of s.lignes) l.lig_ent_id = idProvisoire;
  for (const v of s.ventilations) v.vfr_ent_id = idProvisoire;
  return { ...s, document };
}
