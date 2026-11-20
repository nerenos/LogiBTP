import { pairesParCode } from '@logibtp/socle/dictionnaire';
import { GESTION_ELEMENT, SCENARIO_PA, ACTION_MAJ_PA, MOTIF_MAJ_PA, SOURCE_PA_REFERENCE } from './codes.js';
import { D, S, arr6, evaluerExpression, ErreurCalcul, aujourdhui } from '@logibtp/socle';

// Prix et unités d'un élément de bibliothèque. Même calcul que CalculElement.cs (jeu partagé
// modules/bibliotheque/tests/cas/01_calcul.json). Les prix sont exprimés par unité de stock, à 6 décimales.
//
// Conversion d'unités : chaque unité utilisable donne la quantité en unité de stock pour 1 unité, par une formule sur
// les données techniques de l'élément (ex. acier stocké au ml : kg → 1 / {{poids_ml}}, t → 1000 / {{poids_ml}}).
// Un prix exprimé dans une unité u vaut, par unité de stock : prix / ratio(u).
//
// Scénarios de prix d'achat : FIXE (PA saisi), FOURNISSEUR_PRINCIPAL (tarif principal en vigueur), DERNIER_PA,
// MEILLEUR_MIN / MEILLEUR_MAX (tarifs en vigueur), PMP (prix moyen pondéré). Prix d'un tarif : prix public remisé
// (prix public × (1 − remise 1 %) × (1 − remise 2 %), arrondi à 6 décimales) s'il est renseigné, sinon le prix saisi
// (prixNetTarif, lot 8 des demandes du 25/10/2026). Dernier PA et PMP sont alimentés par les
// futurs modules Achats et Stock. Puis PR = PA × coef FG ; PV = PR × coef bénéfice (ou PV fixe : le coefficient est
// déduit) ; PV net = PV × coef de remise.

export const SCENARIOS_PA = pairesParCode('bibliotheque.scenarios', ['FIXE', 'FOURNISSEUR_PRINCIPAL', 'DERNIER_PA', 'MEILLEUR_MIN', 'MEILLEUR_MAX', 'PMP']);
export const GESTIONS = pairesParCode('bibliotheque.gestions', [GESTION_ELEMENT.STOCK, GESTION_ELEMENT.ACHAT, GESTION_ELEMENT.SOUS_TRAITANCE, GESTION_ELEMENT.NON_GERE]);

/** Quantité en unité de stock pour 1 unité (Dec). Erreur UNITE si l'unité n'est pas déclarée. */
export function ratio(unite, { unite_stock, unites = [], donnees = {} }) {
  if (!unite || unite === unite_stock) return D(1);
  const u = unites.find((x) => x.unite === unite);
  if (!u) throw new ErreurCalcul('UNITE', `Unité ${unite} sans correspondance avec l'unité de stock ${unite_stock}`);
  const r = evaluerExpression(String(u.formule ?? ''), (ref) => {
    const v = D(donnees[ref]);
    if (v === null) throw new ErreurCalcul('DONNEE', `Donnée technique ${ref} non renseignée`);
    return v;
  });
  if (r.lte(0)) throw new ErreurCalcul('RATIO', `Correspondance ${unite} nulle ou négative`);
  return r;
}

/** Prix net d'un tarif (Dec) : prix public remisé s'il est renseigné (remises en %), sinon le prix saisi. */
export function prixNetTarif(t) {
  const publics = D(t.prix_public);
  if (publics === null) return D(t.prix);
  const facteur = (r) => D(1).minus((D(r) ?? D(0)).div(100));
  return arr6(publics.times(facteur(t.remise1)).times(facteur(t.remise2)));
}

const enVigueur = (t, date) => (!t.debut || String(t.debut).slice(0, 10) <= date) && (!t.fin || String(t.fin).slice(0, 10) >= date);

/** PA par unité de stock selon le scénario (Dec ou null), et les alertes rencontrées. */
export function prixAchat(e, date) {
  const alertes = [];
  const parStock = (t) => {
    try { return prixNetTarif(t).div(ratio(t.unite, e)); } catch (x) { alertes.push(x.code ?? 'UNITE'); return null; }
  };
  const tarifs = (e.tarifs ?? []).filter((t) => enVigueur(t, date));
  let pa = null;
  switch (e.scenario ?? 'FIXE') {
    case 'FIXE': pa = D(e.pa_fixe); break;
    case 'DERNIER_PA': pa = D(e.dernier_pa); break;
    case 'PMP': pa = D(e.pmp); break;
    case 'FOURNISSEUR_PRINCIPAL': {
      const t = tarifs.find((x) => x.principal);
      pa = t ? parStock(t) : null;
      break;
    }
    case 'MEILLEUR_MIN':
    case 'MEILLEUR_MAX': {
      const prix = tarifs.map(parStock).filter((x) => x !== null);
      if (prix.length) pa = prix.reduce((a, b) => ((e.scenario === 'MEILLEUR_MIN' ? b.lt(a) : b.gt(a)) ? b : a));
      break;
    }
    default: throw new ErreurCalcul('SCENARIO', `Scénario de prix d'achat inconnu : ${e.scenario}`);
  }
  if (pa === null) alertes.push('PA_INDISPONIBLE');
  return { pa: pa === null ? null : arr6(pa), alertes };
}

/**
 * Calcul complet. Entrée : { unite_stock, unites, donnees, scenario, pa_fixe, dernier_pa, pmp, tarifs: [{ prix,
 * prix_public, remise1, remise2, unite, principal, debut, fin }], coef_fg, coef_benef, pv, pv_fixe, coef_remise }. Sortie (textes décimaux) : { pa, pr, pv,
 * coef_benef, pv_net, prix_unites: [{ unite, ratio, pa, pr, pv_net }], alertes }.
 */
export function calculerElement(e, date = aujourdhui()) {
  const { pa, alertes } = prixAchat(e, date);
  const coefFg = D(e.coef_fg) ?? D(1);
  let coefBenef = D(e.coef_benef) ?? D(1);
  const pr = pa === null ? null : arr6(pa.times(coefFg));
  let pv;
  if (e.pv_fixe) {
    pv = D(e.pv) === null ? null : arr6(D(e.pv));
    if (pv !== null && pr !== null && !pr.isZero()) coefBenef = arr6(pv.div(pr));
  } else pv = pr === null ? null : arr6(pr.times(coefBenef));
  const pvNet = pv === null ? null : arr6(pv.times(D(e.coef_remise) ?? D(1)));
  const prixUnites = [];
  for (const unite of [e.unite_stock, ...(e.unites ?? []).map((u) => u.unite)]) {
    if (!unite || prixUnites.some((p) => p.unite === unite)) continue;
    try {
      const r = ratio(unite, e);
      const fois = (v) => (v === null ? null : S(arr6(v.times(r))));
      prixUnites.push({ unite, ratio: S(arr6(r)), pa: fois(pa), pr: fois(pr), pv_net: fois(pvNet) });
    } catch (x) {
      prixUnites.push({ unite, ratio: null, pa: null, pr: null, pv_net: null, erreur: x.code ?? 'UNITE' });
      if (!alertes.includes(x.code)) alertes.push(x.code ?? 'UNITE');
    }
  }
  return { pa: S(pa), pr: S(pr), pv: S(pv), coef_benef: S(coefBenef), pv_net: S(pvNet), prix_unites: prixUnites, alertes };
}

/** Quantité convertie d'une unité à l'autre en passant par l'unité de stock (Dec). */
export function convertir(quantite, de, vers, e) {
  return D(quantite).times(ratio(de, e)).div(ratio(vers, e));
}

/** Code d'appel d'un élément depuis une bibliothèque : le code seul dans la même bibliothèque, sinon « BIB:CODE ». */
export function codeAppel(element, bibliothequeCourante) {
  return element.bib_code && element.bib_code !== bibliothequeCourante ? `${element.bib_code}:${element.code}` : element.code;
}

/** Analyse d'un code d'appel « BIB:CODE » ou « CODE » (bibliothèque par défaut fournie). */
export function analyserCodeAppel(saisie, bibliothequeParDefaut) {
  const s = String(saisie ?? '').trim();
  const i = s.indexOf(':');
  return i > 0 ? { bibliotheque: s.slice(0, i).toUpperCase(), code: s.slice(i + 1).trim() } : { bibliotheque: bibliothequeParDefaut, code: s };
}

// ---------------------------------------------------------------- coefficients par période
// Même règle que CoefficientsElement.cs (jeu partagé modules/bibliotheque/tests/cas/02_coefficients.json). Pour chaque
// coefficient (frais généraux, bénéfice) : imposé par l'élément, sinon la période de la nature de l'élément en vigueur
// à la date (dernier début ≤ date, coefficient renseigné), sinon la période globale, sinon la valeur par défaut.

export const TYPES_NATURE = pairesParCode('bibliotheque.types_nature', ['MO', 'ENGIN', 'MATERIAUX', 'SOUS_TRAITANCE', 'FRAIS', 'FACTURATION_INTERNE', 'AMORTISSEMENT', 'DIVERS']);

function periodeEnVigueur(periodes, natId, champ, date) {
  return periodes
    .filter((p) => (p.nat_id ?? null) === natId && String(p.debut).slice(0, 10) <= date && p[champ] !== null && p[champ] !== undefined && p[champ] !== '')
    .sort((a, b) => String(b.debut).localeCompare(String(a.debut)))[0] ?? null;
}

/** Coefficient effectif et sa source { portee: 'impose' | 'nature' | 'global' | 'defaut', debut }. */
function coefficient(e, periodes, date, champ, defaut) {
  if (e[`${champ}_impose`] === true || e[`${champ}_impose`] === 'true') return { valeur: S(D(e[champ]) ?? D(defaut)), source: { portee: 'impose', debut: null } };
  const nat = e.nat_id === null || e.nat_id === undefined || e.nat_id === '' ? null : Number(e.nat_id);
  const p = (nat !== null ? periodeEnVigueur(periodes, nat, champ, date) : null) ?? periodeEnVigueur(periodes, null, champ, date);
  if (p) return { valeur: S(D(p[champ])), source: { portee: p.nat_id === null || p.nat_id === undefined ? 'global' : 'nature', debut: String(p.debut).slice(0, 10) } };
  return { valeur: S(D(defaut) ?? D(1)), source: { portee: 'defaut', debut: null } };
}

/**
 * Coefficients effectifs d'un élément : { coef_fg, coef_benef, sources: { coef_fg, coef_benef } }.
 * e : { nat_id, coef_fg, coef_fg_impose, coef_benef, coef_benef_impose } ; periodes : [{ nat_id, debut, coef_fg, coef_benef }].
 */
export function coefficientsEffectifs(e, periodes = [], date = aujourdhui(), { coef_fg_defaut = 1, coef_benef_defaut = 1 } = {}) {
  const fg = coefficient(e, periodes, date, 'coef_fg', coef_fg_defaut);
  const benef = coefficient(e, periodes, date, 'coef_benef', coef_benef_defaut);
  return { coef_fg: fg.valeur, coef_benef: benef.valeur, sources: { coef_fg: fg.source, coef_benef: benef.source } };
}

/**
 * Règle du premier tarif d'un élément (réplique de PremierTarif.Appliquer en C#) : le premier tarif saisi devient principal ;
 * un élément sans PA saisi (scénario FIXE, PA fixe nul ou zéro) passe au scénario FOURNISSEUR_PRINCIPAL.
 */
export function reglePremierTarif(autresTarifs, principalDemande, scenario, paFixe) {
  if (autresTarifs > 0) return { principal: principalDemande, scenario: scenario ?? SCENARIO_PA.FIXE };
  const sansPa = (scenario ?? SCENARIO_PA.FIXE) === SCENARIO_PA.FIXE && (D(paFixe ?? null) === null || D(paFixe).isZero());
  return { principal: true, scenario: sansPa ? SCENARIO_PA.FOURNISSEUR_PRINCIPAL : (scenario ?? SCENARIO_PA.FIXE) };
}

// ---------------------------------------------------------------- PA de référence et plan de mise à jour
// Même règle que PaReference.cs (jeu partagé modules/bibliotheque/tests/cas/04_mise_a_jour_pa.json). Les tarifs de l'entrée
// portent en plus `id` et `tiers_id` (fournisseur de l'annuaire).

/** Tarif de l'élément pour un fournisseur de l'annuaire, en vigueur à la date : principal d'abord, puis début le plus récent. */
function tarifDuFournisseur(e, tiersId, date) {
  if (tiersId === null || tiersId === undefined || tiersId === '') return null;
  const candidats = (e.tarifs ?? []).filter((t) => String(t.tiers_id ?? '') === String(tiersId) && enVigueur(t, date));
  const debut = (t) => (t.debut ? String(t.debut).slice(0, 10) : '');
  return candidats
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (Number(!!b.t.principal) - Number(!!a.t.principal)) || debut(b.t).localeCompare(debut(a.t)) || a.i - b.i)[0]?.t ?? null;
}

/**
 * PA de référence d'un élément (par unité de stock) : avec un fournisseur, le tarif de l'article pour ce fournisseur s'il
 * existe, sinon le PA effectif du scénario. Retour { pa, source, tarif_id, alertes }.
 */
export function paReference(e, date = aujourdhui(), tiersId = null) {
  const t = tarifDuFournisseur(e, tiersId, date);
  if (t) {
    try {
      return { pa: S(arr6(prixNetTarif(t).div(ratio(t.unite, e)))), source: SOURCE_PA_REFERENCE.TARIF_FOURNISSEUR, tarif_id: t.id ?? null, alertes: [] };
    } catch (x) {
      const r = prixAchat(e, date);
      return { pa: S(r.pa), source: SOURCE_PA_REFERENCE.PA_EFFECTIF, tarif_id: null, alertes: [x.code ?? 'UNITE', ...r.alertes] };
    }
  }
  const r = prixAchat(e, date);
  return { pa: S(r.pa), source: SOURCE_PA_REFERENCE.PA_EFFECTIF, tarif_id: null, alertes: r.alertes };
}

const sansEcriture = (motif) => ({ action: ACTION_MAJ_PA.AUCUNE, motif, pa_fixe: null, tarif: null });

/** Tarif existant ramené à un nouveau prix net (par unité du tarif) : prix public recalculé, remises conservées. */
function tarifRecalcule(t, pa, e) {
  const net = arr6(pa.times(ratio(t.unite, e)));
  let prixPublic = null;
  let remise1 = null;
  let remise2 = null;
  let prix = net;
  if (D(t.prix_public) !== null) {
    const facteur = D(1).minus((D(t.remise1) ?? D(0)).div(100)).times(D(1).minus((D(t.remise2) ?? D(0)).div(100)));
    if (facteur.gt(0)) {
      prixPublic = arr6(net.div(facteur));
      remise1 = D(t.remise1);
      remise2 = D(t.remise2);
      prix = prixNetTarif({ prix: net, prix_public: prixPublic, remise1, remise2 });
    }
  }
  return { id: t.id ?? null, tiers_id: t.tiers_id ?? null, unite: t.unite, prix: S(prix), prix_public: S(prixPublic), remise1: S(remise1), remise2: S(remise2), debut: null };
}

/**
 * Plan de mise à jour de la bibliothèque pour un nouveau PA (par unité de stock) et un fournisseur éventuel de la pièce.
 * Retour { action, motif, pa_fixe, tarif } : PA_FIXE (pa_fixe), TARIF (tarif existant mis à jour), NOUVEAU_TARIF (tarif à
 * créer pour le fournisseur, début à la date), AUCUNE (motif).
 */
export function planMiseAJourPa(e, nouveauPa, date = aujourdhui(), tiersId = null) {
  const pa = D(nouveauPa);
  if (pa === null || pa.lt(0)) return sansEcriture(MOTIF_MAJ_PA.PA_INVALIDE);
  const scenario = e.scenario ?? SCENARIO_PA.FIXE;
  const parTarif = [SCENARIO_PA.FOURNISSEUR_PRINCIPAL, SCENARIO_PA.MEILLEUR_MIN, SCENARIO_PA.MEILLEUR_MAX].includes(scenario);
  const aFournisseur = tiersId !== null && tiersId !== undefined && tiersId !== '';
  try {
    const duFournisseur = tarifDuFournisseur(e, tiersId, date);
    if (duFournisseur) return { action: ACTION_MAJ_PA.TARIF, motif: null, pa_fixe: null, tarif: tarifRecalcule(duFournisseur, pa, e) };
    if (aFournisseur && parTarif) {
      return { action: ACTION_MAJ_PA.NOUVEAU_TARIF, motif: null, pa_fixe: null,
        tarif: { id: null, tiers_id: tiersId, unite: e.unite_stock, prix: S(arr6(pa)), prix_public: null, remise1: null, remise2: null, debut: date } };
    }
    switch (scenario) {
      case SCENARIO_PA.FIXE: return { action: ACTION_MAJ_PA.PA_FIXE, motif: null, pa_fixe: S(arr6(pa)), tarif: null };
      case SCENARIO_PA.FOURNISSEUR_PRINCIPAL: {
        const principal = (e.tarifs ?? []).filter((t) => enVigueur(t, date)).find((t) => t.principal);
        return principal ? { action: ACTION_MAJ_PA.TARIF, motif: null, pa_fixe: null, tarif: tarifRecalcule(principal, pa, e) } : sansEcriture(MOTIF_MAJ_PA.TARIF_PRINCIPAL_ABSENT);
      }
      default: return sansEcriture(MOTIF_MAJ_PA.SCENARIO_CALCULE);
    }
  } catch (x) {
    if (x instanceof ErreurCalcul) return sansEcriture(MOTIF_MAJ_PA.UNITE_TARIF);
    throw x;
  }
}
