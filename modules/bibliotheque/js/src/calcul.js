import { D, S, arr6, evaluerExpression, ErreurCalcul } from '@logibtp/socle';

// Prix et unités d'un élément de bibliothèque. Même calcul que CalculElement.cs (jeu partagé
// modules/bibliotheque/tests/cas/01_calcul.json). Les prix sont exprimés par unité de stock, à 6 décimales.
//
// Conversion d'unités : chaque unité utilisable donne la quantité en unité de stock pour 1 unité, par une formule sur
// les données techniques de l'élément (ex. acier stocké au ml : kg → 1 / {{poids_ml}}, t → 1000 / {{poids_ml}}).
// Un prix exprimé dans une unité u vaut, par unité de stock : prix / ratio(u).
//
// Scénarios de prix d'achat : FIXE (PA saisi), FOURNISSEUR_PRINCIPAL (tarif principal en vigueur), DERNIER_PA,
// MEILLEUR_MIN / MEILLEUR_MAX (tarifs en vigueur), PMP (prix moyen pondéré). Dernier PA et PMP sont alimentés par les
// futurs modules Achats et Stock. Puis PR = PA × coef FG ; PV = PR × coef bénéfice (ou PV fixe : le coefficient est
// déduit) ; PV net = PV × coef de remise.

export const SCENARIOS_PA = [
  ['FIXE', 'Prix fixe'], ['FOURNISSEUR_PRINCIPAL', 'Prix du fournisseur principal'], ['DERNIER_PA', "Dernier prix d'achat"],
  ['MEILLEUR_MIN', 'Meilleur prix fournisseur (minimum)'], ['MEILLEUR_MAX', 'Prix fournisseur maximum'], ['PMP', 'Prix moyen pondéré'],
];
export const GESTIONS = [['STOCK', 'Stock'], ['ACHAT', 'Achat'], ['SOUS_TRAITANCE', 'Sous-traitance'], ['NON_GERE', 'Non géré']];

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

const enVigueur = (t, date) => (!t.debut || String(t.debut).slice(0, 10) <= date) && (!t.fin || String(t.fin).slice(0, 10) >= date);

/** PA par unité de stock selon le scénario (Dec ou null), et les alertes rencontrées. */
export function prixAchat(e, date) {
  const alertes = [];
  const parStock = (t) => {
    try { return D(t.prix).div(ratio(t.unite, e)); } catch (x) { alertes.push(x.code ?? 'UNITE'); return null; }
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
 * Calcul complet. Entrée : { unite_stock, unites, donnees, scenario, pa_fixe, dernier_pa, pmp, tarifs: [{ prix, unite,
 * principal, debut, fin }], coef_fg, coef_benef, pv, pv_fixe, coef_remise }. Sortie (textes décimaux) : { pa, pr, pv,
 * coef_benef, pv_net, prix_unites: [{ unite, ratio, pa, pr, pv_net }], alertes }.
 */
export function calculerElement(e, date = new Date().toISOString().slice(0, 10)) {
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
