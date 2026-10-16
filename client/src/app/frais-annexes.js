import { D, arrondir } from '@logibtp/socle';
import { calculerDocument } from '../calcul/index.js';

// Ventilation des frais annexes côté saisie (CONCEPTION-VENTILATION-FRAIS.md) : les tranches F sont ventilées par le
// moteur (moteur-btp.js, ventilerFraisAnnexes) selon les clés de saisie.ventilations ; ce module fournit les lectures
// du résultat (parts d'une ligne, bilan d'une tranche, clés orphelines) et les actions qui réécrivent les clés :
// figer (clés de ligne en montant par unité, comme le serveur à la validation) et répartir le reste.

export const LIBELLES_FA_LIGNES = {
  V: 'Lignes vendues seulement',
  OA: 'Aussi les options et variantes',
  OAM: 'Aussi les options, variantes et lignes pour mémoire',
};
export const LIBELLES_FA_MODE = {
  C: 'Au coefficient moyen des lignes vendues (sans réduire leur part)',
  B: 'Dans la base de répartition (les lignes vendues reçoivent moins)',
};
export const LIBELLES_CIBLE = { LIGNE: 'Ligne', ELEMENT: 'Élément', NATURE: 'Nature' };
export const CODES_FA = ['FA_ECART', 'FA_SANS_RECEPTRICE', 'FA_CLE_ORPHELINE', 'FA_CLE_BLOQUEE', 'FA_HORS_SECTION', 'FA_HORS_TRANCHE', 'FA_PIED'];

/** Bilan d'une tranche de frais (résultat du moteur) : { lig_id, portee_id, cles, prevu, ventile, ventile_reel, ecart }. */
export function bilanTranche(resultat, ligId) {
  return (resultat.frais_annexes ?? []).find((b) => b.lig_id === ligId) ?? null;
}

/** Parts de frais reçues par une ligne : [{ source, montant, vfr_id }]. */
export function partsLigne(resultat, ligId) {
  return (resultat.ventilations_lignes ?? []).filter((v) => v.vfl_lig_id === ligId)
    .map((v) => ({ source: v.vfl_source_lig_id, montant: D(v.vfl_montant), vfr_id: v.vfl_vfr_id }));
}

/** Total des frais reçus par une ligne (null : aucun). */
export function fraisRecus(resultat, ligId) {
  const parts = partsLigne(resultat, ligId);
  return parts.length ? parts.reduce((s, p) => s.plus(p.montant), D(0)) : null;
}

/** La ligne `ligId` est-elle dans la portée de la tranche de frais `bilan` (descendante de la tranche parente) ? */
export function dansPortee(lignes, bilan, ligId) {
  if (bilan.portee_id === null || bilan.portee_id === undefined) return false;
  const parId = new Map(lignes.map((l) => [l.lig_id, l]));
  for (let x = parId.get(parId.get(ligId)?.lig_parent_id); x; x = parId.get(x.lig_parent_id)) if (x.lig_id === bilan.portee_id) return true;
  return false;
}

/** Messages de ventilation des frais annexes (avertissements du moteur). */
export function messagesFrais(resultat) {
  return (resultat.avertissements ?? []).filter((a) => CODES_FA.includes(a.code));
}

/**
 * Clés de ligne en montant par unité de quantité qui reproduisent la ventilation calculée (toutes les tranches, ou la
 * tranche `source`). Réplique de SpecialisationBtp.FigerVentilation (C#), appliquée par le serveur à la validation.
 */
export function figerVentilation(resultat, { source = null, prochainId = (() => { let n = 0; return () => --n; })() } = {}) {
  const parId = new Map(resultat.lignes.map((l) => [l.lig_id, l]));
  const groupes = new Map();
  for (const v of resultat.ventilations_lignes ?? []) {
    if (source !== null && v.vfl_source_lig_id !== source) continue;
    const cle = `${v.vfl_source_lig_id}|${v.vfl_lig_id}`;
    const g = groupes.get(cle) ?? { source: v.vfl_source_lig_id, ligne: v.vfl_lig_id, montant: D(0) };
    g.montant = g.montant.plus(D(v.vfl_montant));
    groupes.set(cle, g);
  }
  const cles = [];
  for (const g of groupes.values()) {
    const qv = D(parId.get(g.ligne)?.lig_qte_vendue ?? 0);
    if (!qv || qv.isZero()) continue;
    cles.push({
      vfr_id: prochainId(), vfr_ent_id: resultat.document.ent_id ?? null, vfr_source_lig_id: g.source, vfr_cible: 'LIGNE',
      vfr_lig_id: g.ligne, vfr_element: null, vfr_nat_id: null, vfr_mode: 'M', vfr_valeur: Number(arrondir(g.montant.div(qv), 6)),
    });
  }
  return cles;
}

/**
 * Répartir le reste d'une tranche (13.3) : la ventilation actuelle est figée en clés de ligne, et le montant non
 * ventilé (prévu − ventilé) est réparti au prorata du montant hors frais sur les lignes réceptrices qui ne reçoivent
 * encore rien de cette tranche (sur toutes les réceptrices si toutes reçoivent déjà). Les lignes réceptrices et leur
 * poids viennent du calcul de la tranche sans clé (prorata). Renvoie les nouvelles clés de la tranche, ou null.
 */
export function repartirReste(entree, resultat, source, prochainId) {
  const bilan = bilanTranche(resultat, source);
  if (!bilan) return null;
  const reste = D(bilan.prevu).minus(D(bilan.ventile));
  const figees = figerVentilation(resultat, { source, prochainId });
  if (reste.isZero()) return figees;
  // Calcul sans les clés de la tranche : parts au prorata sur toutes les lignes réceptrices.
  const sansCles = calculerDocument({ ...entree, ventilations: (entree.ventilations ?? []).filter((k) => k.vfr_source_lig_id !== source && k.vfr_source_lig_id !== null && k.vfr_source_lig_id !== undefined) });
  const recues = new Set((resultat.ventilations_lignes ?? []).filter((v) => v.vfl_source_lig_id === source).map((v) => v.vfl_lig_id));
  const toutes = (sansCles.ventilations_lignes ?? []).filter((v) => v.vfl_source_lig_id === source && v.vfl_vfr_id === null);
  const cibles = toutes.filter((v) => !recues.has(v.vfl_lig_id));
  const base = cibles.length ? cibles : toutes;
  if (!base.length) return null;
  const precision = resultat.document.ent_precision_montant ?? 2;
  const poids = base.map((v) => D(v.vfl_montant));
  const total = poids.reduce((s, p) => s.plus(p), D(0));
  const parts = poids.map((p) => arrondir(total.isZero() ? reste.div(base.length) : reste.times(p).div(total), precision));
  let im = 0;
  poids.forEach((p, i) => { if (p.gt(poids[im])) im = i; });
  parts[im] = parts[im].plus(reste.minus(parts.reduce((s, p) => s.plus(p), D(0))));
  const parId = new Map(resultat.lignes.map((l) => [l.lig_id, l]));
  const parLigne = new Map(figees.map((k) => [k.vfr_lig_id, k]));
  base.forEach((v, i) => {
    const qv = D(parId.get(v.vfl_lig_id)?.lig_qte_vendue ?? 0);
    if (qv.isZero()) return;
    const k = parLigne.get(v.vfl_lig_id);
    const ajout = parts[i].div(qv);
    if (k) k.vfr_valeur = Number(arrondir(D(k.vfr_valeur).plus(ajout), 6));
    else {
      figees.push({
        vfr_id: prochainId(), vfr_ent_id: resultat.document.ent_id ?? null, vfr_source_lig_id: source, vfr_cible: 'LIGNE',
        vfr_lig_id: v.vfl_lig_id, vfr_element: null, vfr_nat_id: null, vfr_mode: 'M', vfr_valeur: Number(arrondir(ajout, 6)),
      });
    }
  });
  return figees;
}

/** Remplace les clés de la tranche `source` (toutes les clés si null) dans le brouillon `d`. */
export function remplacerCles(d, source, cles) {
  d.ventilations = [...(d.ventilations ?? []).filter((k) => source !== null && k.vfr_source_lig_id !== source), ...cles];
}

/** Clé de ligne de la tranche `source` pour la ligne `ligId` dans les clés saisies. */
export function cleLigne(ventilations, source, ligId) {
  return (ventilations ?? []).find((k) => k.vfr_cible === 'LIGNE' && k.vfr_source_lig_id === source && k.vfr_lig_id === ligId) ?? null;
}

/**
 * Écrit (ou retire si `valeur` est vide) une clé dans le brouillon `d`. `cible` : { vfr_cible, vfr_lig_id |
 * vfr_element | vfr_nat_id }, `source` nulle pour une nature globale.
 */
export function ecrireCle(d, source, cible, mode, valeur, prochainId) {
  d.ventilations ??= [];
  const meme = (k) => (k.vfr_source_lig_id ?? null) === source && k.vfr_cible === cible.vfr_cible
    && (cible.vfr_cible === 'LIGNE' ? k.vfr_lig_id === cible.vfr_lig_id : cible.vfr_cible === 'ELEMENT' ? k.vfr_element === cible.vfr_element : Number(k.vfr_nat_id) === Number(cible.vfr_nat_id));
  const i = d.ventilations.findIndex(meme);
  if (valeur === null || valeur === undefined || valeur === '') {
    if (i >= 0) d.ventilations.splice(i, 1);
    return;
  }
  const cle = {
    vfr_id: i >= 0 ? d.ventilations[i].vfr_id : prochainId(), vfr_ent_id: d.document.ent_id ?? null, vfr_source_lig_id: source,
    vfr_cible: cible.vfr_cible, vfr_lig_id: cible.vfr_lig_id ?? null, vfr_element: cible.vfr_element ?? null, vfr_nat_id: cible.vfr_nat_id ?? null,
    vfr_mode: mode, vfr_valeur: Number(valeur),
  };
  if (i >= 0) d.ventilations[i] = cle; else d.ventilations.push(cle);
}
