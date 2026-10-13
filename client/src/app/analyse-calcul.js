import { D, arrondir } from '@logibtp/socle';
import { estChiffree, estPied, estTranche } from '../calcul/index.js';

// Calculs de l'onglet Analyse (sans interface) : feuilles analysées, agrégats par groupe et forçage d'un montant.
//
// Feuille : ligne chiffrée sans composante, quantité totale dans le document qt. Pour une feuille :
//   déboursé = qt × PA ; revient = qt × PR ; PV = qt × PV (avant frais annexes) ; PV avec FA = PV × c (coefficient de
//   frais annexes du document) ; FA = PV avec FA − PV ; prix client = PV avec FA × prorata × remise de la ligne vendue ;
//   PV remisé sans FA = PV × prorata × remise.
//   Marge brute = prix client − déboursé ; marge nette = PV remisé sans FA − revient.
// Les montants sont les vraies valeurs : un montant saisi recalcule les coefficients des feuilles du groupe, puis les
// plus fortes feuilles absorbent l'écart d'arrondi ; en dernier recours, une ligne d'écart d'arrondi est ajoutée.

/** Feuilles du résultat dans la portée (null : document), options et lignes pour mémoire comprises ou non. */
export function feuillesAnalyse(resultat, saisie, { portee = null, horsTotal = false } = {}) {
  const parId = new Map(resultat.lignes.map((l) => [l.lig_id, l]));
  const saisies = new Map(saisie.lignes.map((l) => [l.lig_id, l]));
  const avecComposantes = new Set(resultat.lignes.filter((l) => estChiffree(l) && l.lig_parent_id !== null).map((l) => l.lig_parent_id));
  const res = [];
  for (const l of resultat.lignes) {
    if (!estChiffree(l) || avecComposantes.has(l.lig_id) || estPied(l)) continue;
    const chaine = [];
    for (let x = l; x; x = parId.get(x.lig_parent_id)) chaine.push(x);
    const hors = chaine.some((x) => (x.lig_type_prix ?? 'V') !== 'V');
    if (hors && !horsTotal) continue;
    if (portee !== null && !chaine.some((x) => x.lig_id === portee)) continue;
    const prix = [...chaine].reverse().find(estChiffree) ?? l;
    res.push({
      ligne: l, saisie: saisies.get(l.lig_id) ?? null, prix, chaine, hors, nature: l.lig_nat_id ?? null,
      tranches: chaine.filter(estTranche).map((t) => t.lig_id),
    });
  }
  return res;
}

/** Montants d'une feuille (nombres). */
export function montantsFeuille(f, coefFa) {
  const qt = Number(f.ligne.lig_qte_totale ?? 0);
  const p = f.prix;
  const prorata = Number(p.lig_coef_prorata ?? 1); // ligne vendue qui porte la feuille
  const remise = Number(p.lig_coef_remise ?? 1);
  const ds = qt * Number(f.ligne.lig_pa ?? 0);
  const rev = qt * Number(f.ligne.lig_pr ?? 0);
  const pv = qt * Number(f.ligne.lig_pv ?? 0);
  const pvFa = pv * coefFa;
  return { ds, rev, pv, pvFa, fa: pvFa - pv, client: pvFa * prorata * remise, pvRemise: pv * prorata * remise, avantProrata: pvFa * remise };
}

/** Agrégat d'un groupe de feuilles : montants, coefficients moyens pondérés et marges. */
export function agreger(feuilles, coefFa) {
  const s = { nb: feuilles.length, ds: 0, rev: 0, pv: 0, pvFa: 0, fa: 0, client: 0, pvRemise: 0, avantProrata: 0 };
  for (const f of feuilles) {
    const m = montantsFeuille(f, coefFa);
    for (const k of ['ds', 'rev', 'pv', 'pvFa', 'fa', 'client', 'pvRemise', 'avantProrata']) s[k] += m[k];
  }
  const ratio = (a, b) => (b ? a / b : null);
  return {
    ...s,
    fg: ratio(s.rev, s.ds), benef: ratio(s.pv, s.rev), coefFa: ratio(s.pvFa, s.pv), prorata: ratio(s.client, s.avantProrata),
    global: ratio(s.client, s.ds),
    margeBrute: s.client - s.ds, tauxBrute: ratio(s.client - s.ds, s.client),
    margeNette: s.pvRemise - s.rev, tauxNette: ratio(s.pvRemise - s.rev, s.pvRemise),
  };
}

/**
 * Montants forçables : revient (coefficient de frais généraux), PV avant FA et prix client (coefficient de bénéfice).
 * `base` : valeur unitaire multipliée par le coefficient ; `facteur` : passage de la valeur unitaire au montant.
 */
export const MONTANTS_FORCABLES = {
  rev: { champ: 'lig_coef_fg', libelle: 'revient', base: (f) => D(f.ligne.lig_pa ?? 0), facteur: () => D(1) },
  pv: { champ: 'lig_coef_benef', libelle: 'PV avant frais annexes', base: (f) => D(f.ligne.lig_pr ?? 0), facteur: () => D(1) },
  client: {
    champ: 'lig_coef_benef', libelle: 'prix client', base: (f) => D(f.ligne.lig_pr ?? 0),
    facteur: (f, c) => {
      const p = f.prix;
      return D(c).times(D(p.lig_coef_prorata ?? 1)).times(D(p.lig_coef_remise ?? 1));
    },
  },
};

/** Feuille dont le coefficient pilote le montant (pas d'écart d'arrondi, pas de prix imposé, base non nulle). */
function ajustable(f, cle, modeDebourse) {
  if (f.ligne.lig_is_ecart_arrondi) return false;
  if (modeDebourse && f.prix !== f.ligne) return false;
  if (MONTANTS_FORCABLES[cle].base(f).isZero()) return false;
  if (cle !== 'rev') {
    // PV imposé (saisi, affiché ou ventilé) : le bénéfice est recalculé par le moteur.
    for (const x of f.chaine) if (estChiffree(x) && (x.lig_pv_fixe || x.lig_pv_affiche_fixe)) return false;
  }
  return true;
}

/**
 * Coefficients à écrire pour que le montant `cle` du groupe vaille `cible` (au centime), et ligne d'écart éventuelle.
 * Renvoie { coefs: Map(lig_id → coefficient), ecart: montant résiduel ou null, nature, erreur }.
 */
export function forcerMontant(feuilles, cle, cible, { coefFa = 1, modeDebourse = false } = {}) {
  const m = MONTANTS_FORCABLES[cle];
  const c = D(coefFa);
  const T = arrondir(D(cible), 2);
  const qt = (f) => D(f.ligne.lig_qte_totale ?? 0);
  const coefActuel = (f) => D(f.saisie?.[m.champ] ?? f.ligne[m.champ] ?? 1);
  const unite = (f, k) => arrondir(m.base(f).times(k), 6);
  const contribution = (f, k) => qt(f).times(unite(f, k)).times(m.facteur(f, c));
  const actuelle = (f) => {
    const v = cle === 'rev' ? D(f.ligne.lig_pr ?? 0) : D(f.ligne.lig_pv ?? 0);
    return qt(f).times(v).times(m.facteur(f, c));
  };

  const adj = feuilles.filter((f) => ajustable(f, cle, modeDebourse) && !qt(f).isZero());
  const fixes = feuilles.filter((f) => !adj.includes(f));
  const fixe = fixes.reduce((s, f) => s.plus(actuelle(f)), D(0));
  const variable = adj.reduce((s, f) => s.plus(actuelle(f)), D(0));
  if (!adj.length || variable.isZero()) return { erreur: `Aucune ligne dont le coefficient pilote le ${m.libelle} dans ce groupe` };
  const k = T.minus(fixe).div(variable);
  if (k.lte(0)) return { erreur: `Montant trop faible : les lignes à prix imposé valent déjà ${arrondir(fixe, 2)}` };

  const coefs = new Map(adj.map((f) => [f.ligne.lig_id, arrondir(coefActuel(f).times(k), 6)]));
  const total = () => adj.reduce((s, f) => s.plus(contribution(f, coefs.get(f.ligne.lig_id))), fixe);
  let S = total();
  // Les plus fortes contributions absorbent l'écart d'arrondi.
  const ordre = [...adj].sort((a, b) => contribution(b, coefs.get(b.ligne.lig_id)).abs().cmp(contribution(a, coefs.get(a.ligne.lig_id)).abs()));
  for (const f of ordre.slice(0, 20)) {
    if (arrondir(S, 2).eq(T)) break;
    const id = f.ligne.lig_id;
    const avant = contribution(f, coefs.get(id));
    const voulu = avant.plus(T.minus(S)); // contribution souhaitée
    const base = m.base(f).times(qt(f)).times(m.facteur(f, c));
    const nouveau = arrondir(voulu.div(base), 6);
    if (nouveau.lte(0)) continue;
    coefs.set(id, nouveau);
    S = S.minus(avant).plus(contribution(f, nouveau));
  }
  const reste = T.minus(S);
  const ecart = arrondir(S, 2).eq(T) ? null : reste;
  // Nature de la ligne d'écart : celle de la plus forte contribution.
  return { coefs, ecart, nature: ordre[0]?.nature ?? null };
}

/** Prix d'achat d'une ligne d'écart (quantité 1, coefficients 1) qui apporte `ecart` au montant `cle`. */
export function paEcart(cle, ecart, coefFa = 1) {
  return cle === 'client' ? arrondir(D(ecart).div(D(coefFa)), 6) : arrondir(D(ecart), 6);
}
