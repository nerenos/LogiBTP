// Indicateurs du Détail (ANALYSE-MODULE-ANALYSE.md § 4, § 7) : colonnes (indicateur, champ, calcul), sens normal de chaque
// colonne pour les montants anormaux en rouge (§ 4.11), lignes regroupement › nature avec le total en haut, faits d'un
// chiffre regroupés par pièce (§ 8). Calculs en décimal (decimal.js du socle), jamais en Number.
import { Dz } from '@logibtp/socle';
import { texte } from '@logibtp/socle/dictionnaire';
import { INDICATEUR, COMPOSANTE } from './codes.js';

/** Sens normal d'une colonne : POSITIF (négatif en rouge), NEGATIF (positif en rouge : réductions), NUL (non nul en rouge), LIBRE. */
export const SENS = Object.freeze({ POSITIF: 'POSITIF', NEGATIF: 'NEGATIF', NUL: 'NUL', LIBRE: 'LIBRE' });

/** Coût affiché : PA ou PR (§ 5.5) ; le PV ne change pas. */
export const COUT = Object.freeze({ PA: 'PA', PR: 'PR' });

/**
 * Colonnes du Détail : `indicateurs` sommés sur `champ` (cout = PA ou PR selon le choix, pv), ou `calcul` à partir des
 * autres colonnes ; `teinte` = suffixe des variables `--rentabilite-<teinte>` du thème ; `faits` : indicateurs listés
 * par le double-clic.
 */
export const COLONNES_DETAIL = Object.freeze([
  { code: 'budget', indicateurs: [INDICATEUR.BUDGET], champ: 'cout', sens: SENS.POSITIF, teinte: 'budget' },
  { code: 'budget_execution', indicateurs: [INDICATEUR.BUDGET_EXECUTION], champ: 'cout', sens: SENS.POSITIF, teinte: 'budget-execution' },
  { code: 'engage', indicateurs: [INDICATEUR.ENGAGE], champ: 'cout', sens: SENS.POSITIF, teinte: 'engage' },
  { code: 'debourse', indicateurs: [INDICATEUR.DEBOURSE], champ: 'cout', sens: SENS.POSITIF, teinte: 'debourse' },
  { code: 'depense', indicateurs: [INDICATEUR.ENGAGE, INDICATEUR.DEBOURSE], champ: 'cout', sens: SENS.POSITIF, teinte: 'depense' },
  {
    code: 'reste_depenser', calcul: (v) => v.budget_execution.minus(v.depense), faits: [INDICATEUR.BUDGET_EXECUTION, INDICATEUR.ENGAGE, INDICATEUR.DEBOURSE],
    sens: SENS.POSITIF, teinte: 'reste-depenser',
  },
  { code: 'budget_pv', indicateurs: [INDICATEUR.BUDGET], champ: 'pv', sens: SENS.POSITIF, teinte: 'budget' },
  { code: 'facture', indicateurs: [INDICATEUR.FACTURE], champ: 'pv', sens: SENS.POSITIF, teinte: 'facture' },
  { code: 'reste_facturer', calcul: (v) => v.budget_pv.minus(v.facture), faits: [INDICATEUR.BUDGET, INDICATEUR.FACTURE], sens: SENS.POSITIF, teinte: 'reste-facturer' },
].map((c) => Object.freeze({ ...c, faits: c.faits ?? c.indicateurs })));

/** Libellé et bulle d'une colonne (module Personnalisation). */
export const libelleColonne = (c) => texte(`rentabilite.colonnes.${c.code}.libelle`);
export const infoColonne = (c) => texte(`rentabilite.colonnes.${c.code}.info`);

/** Montant anormal selon le sens de la colonne : null, ou la clé de la bulle (negatif, positif, non_nul). */
export function anomalie(valeur, sens) {
  const v = Dz(valeur);
  if (sens === SENS.POSITIF && v.isNegative() && !v.isZero()) return 'negatif';
  if (sens === SENS.NEGATIF && v.isPositive() && !v.isZero()) return 'positif';
  if (sens === SENS.NUL && !v.isZero()) return 'non_nul';
  return null;
}

/** Agrégats retenus pour un ordre : undefined / null = tout le chantier, 0 = « Sans ordre », sinon l'ordre. */
export function filtrerOrdre(agregats, ordre) {
  if (ordre === undefined || ordre === null || ordre === '') return agregats;
  const o = Number(ordre);
  return agregats.filter((a) => (o === 0 ? a.ordre_id === null || a.ordre_id === undefined : a.ordre_id === o));
}

/** Valeur de chaque colonne (Decimal) pour des agrégats ; `cout` : PA ou PR. */
export function valeursColonnes(agregats, cout = COUT.PR) {
  const champCout = cout === COUT.PA ? 'pa' : 'pr';
  const v = {};
  for (const c of COLONNES_DETAIL.filter((x) => !x.calcul)) {
    const champ = c.champ === 'pv' ? 'pv' : champCout;
    v[c.code] = agregats.filter((a) => c.indicateurs.includes(a.indicateur)).reduce((s, a) => s.plus(Dz(a[champ])), Dz(0));
  }
  for (const c of COLONNES_DETAIL.filter((x) => x.calcul)) v[c.code] = c.calcul(v);
  return v;
}

/**
 * Lignes du Détail : total en haut, puis chaque regroupement (dans l'ordre des natures) et ses natures, puis « Non
 * ventilé » (faits sans nature hors postes) et « Postes de pied » (composante POSTE). Chaque ligne porte le filtre des
 * faits qui la composent (`natures` : identifiants, 0 = sans nature ; `composante` : POSTE ou !POSTE).
 */
export function lignesDetail({ agregats, natures, ordre, cout = COUT.PR }) {
  const retenus = filtrerOrdre(agregats, ordre);
  const lignes = [{ type: 'total', code: 'total', libelle: texte('rentabilite.detail.total'), natures: null, composante: null, valeurs: valeursColonnes(retenus, cout) }];
  const postes = retenus.filter((a) => a.composante === COMPOSANTE.POSTE);
  const ventiles = retenus.filter((a) => a.composante !== COMPOSANTE.POSTE);
  const groupes = new Map();
  for (const n of natures) {
    const cle = n.groupe ?? '';
    if (!groupes.has(cle)) groupes.set(cle, { code: cle, libelle: n.groupe_libelle ?? (n.groupe || texte('rentabilite.detail.sans_groupe')), natures: [] });
    groupes.get(cle).natures.push(n);
  }
  for (const g of groupes.values()) {
    const ids = g.natures.map((n) => n.id);
    const duGroupe = ventiles.filter((a) => ids.includes(a.nat_id));
    if (!duGroupe.length) continue;
    lignes.push({ type: 'groupe', code: `groupe:${g.code}`, libelle: g.libelle, natures: ids, composante: `!${COMPOSANTE.POSTE}`, valeurs: valeursColonnes(duGroupe, cout) });
    for (const n of g.natures) {
      const deLaNature = ventiles.filter((a) => a.nat_id === n.id);
      if (!deLaNature.length) continue;
      lignes.push({ type: 'nature', code: `nature:${n.id}`, libelle: `${n.code} – ${n.libelle}`, natures: [n.id], composante: `!${COMPOSANTE.POSTE}`, valeurs: valeursColonnes(deLaNature, cout) });
    }
  }
  const sansNature = ventiles.filter((a) => a.nat_id === null || a.nat_id === undefined);
  if (sansNature.length) {
    lignes.push({ type: 'non_ventile', code: 'non_ventile', libelle: texte('rentabilite.detail.non_ventile'), info: texte('rentabilite.detail.non_ventile_info'),
      natures: [0], composante: `!${COMPOSANTE.POSTE}`, valeurs: valeursColonnes(sansNature, cout) });
  }
  if (postes.length) {
    lignes.push({ type: 'postes', code: 'postes', libelle: texte('rentabilite.detail.postes'), info: texte('rentabilite.detail.postes_info'),
      natures: null, composante: COMPOSANTE.POSTE, valeurs: valeursColonnes(postes, cout) });
  }
  return lignes;
}

/**
 * Faits d'un chiffre regroupés par pièce (§ 8) : sous-totaux par pièce (PA, PR, PV, heures), total ; pièces annulées et
 * leurs faits masqués sauf `annulees` (ils restent dans le total : ils se compensent avec leur avoir).
 */
export function regrouperFaits(faits, pieces, { annulees = false } = {}) {
  const somme = (l, champ) => l.reduce((s, f) => (f[champ] === null || f[champ] === undefined ? s : s.plus(Dz(f[champ]))), Dz(0));
  const totaux = (l) => ({ pa: somme(l, 'afa_montant_pa'), pr: somme(l, 'afa_montant_pr'), pv: somme(l, 'afa_montant_pv'), heures: somme(l, 'afa_heures') });
  const groupes = new Map();
  let masques = 0;
  for (const f of faits) {
    const piece = f.afa_ent_id ? pieces[f.afa_ent_id] ?? null : null;
    if (piece?.annulee && !annulees) { masques += 1; continue; }
    const cle = f.afa_ent_id ? `p${f.afa_ent_id}` : `s${f.afa_source_type}`;
    if (!groupes.has(cle)) groupes.set(cle, { cle, piece, source: f.afa_source_type, faits: [] });
    groupes.get(cle).faits.push(f);
  }
  const indicateurs = [...new Set(faits.map((f) => f.afa_indicateur))];
  return {
    groupes: [...groupes.values()].map((g) => ({ ...g, totaux: totaux(g.faits) })),
    total: totaux(faits),
    // Plusieurs indicateurs (reste à dépenser, à facturer) : un total par indicateur, la somme seule n'aurait pas de sens.
    parIndicateur: indicateurs.length > 1 ? indicateurs.map((i) => ({ indicateur: i, totaux: totaux(faits.filter((f) => f.afa_indicateur === i)) })) : [],
    masques,
  };
}
