import { texte } from '@logibtp/socle/dictionnaire';
import { D, arrondir } from '@logibtp/socle';
import { estChiffree, estPied, estTranche } from '../calcul/index.js';

// Calculs de l'onglet Analyse (sans interface) : feuilles analysées, agrégats par groupe et forçage d'un montant.
//
// Feuille : ligne chiffrée sans composante, quantité totale dans le document qt. Pour une feuille :
//   déboursé = qt × PA ; revient = qt × PR ; PV = qt × PV (avant frais annexes) ; PV avec FA = PV × c (coefficient de
//   frais annexes de la ligne de prix : frais reçus des tranches de frais) ; FA = PV avec FA − PV ; prix client = PV avec FA × prorata × remise de la ligne vendue ;
//   PV remisé sans FA ni prorata = PV × remise.
//   Marge brute = prix client − déboursé ; marge nette = PV remisé sans FA ni prorata − revient.
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

/** Montants d'une feuille (nombres) ; coefficient de frais annexes de sa ligne de prix (à défaut, `coefFa`). */
export function montantsFeuille(f, coefFa) {
  const qt = Number(f.ligne.lig_qte_totale ?? 0);
  const p = f.prix;
  coefFa = Number(p.lig_coef_fa ?? coefFa ?? 1);
  const prorata = Number(p.lig_coef_prorata ?? 1); // ligne vendue qui porte la feuille
  const remise = Number(p.lig_coef_remise ?? 1);
  const ds = qt * Number(f.ligne.lig_pa ?? 0);
  const rev = qt * Number(f.ligne.lig_pr ?? 0);
  const pv = qt * Number(f.ligne.lig_pv ?? 0);
  const pvFa = pv * coefFa;
  return { ds, rev, pv, pvFa, fa: pvFa - pv, client: pvFa * prorata * remise, pvRemise: pv * remise, avantProrata: pvFa * remise };
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
  rev: { champ: 'lig_coef_fg', get libelle() { return texte('analyse_btp.montants.rev'); }, base: (f) => D(f.ligne.lig_pa ?? 0), facteur: () => D(1) },
  pv: { champ: 'lig_coef_benef', get libelle() { return texte('analyse_btp.montants.pv'); }, base: (f) => D(f.ligne.lig_pr ?? 0), facteur: () => D(1) },
  client: {
    champ: 'lig_coef_benef', get libelle() { return texte('analyse_btp.montants.client'); }, base: (f) => D(f.ligne.lig_pr ?? 0),
    facteur: (f, c) => {
      const p = f.prix;
      return D(p.lig_coef_fa ?? c).times(D(p.lig_coef_prorata ?? 1)).times(D(p.lig_coef_remise ?? 1));
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
  if (!adj.length || variable.isZero()) return { erreur: texte('analyse_btp.erreurs.sans_ligne', { montant: m.libelle }) };
  const k = T.minus(fixe).div(variable);
  if (k.lte(0)) return { erreur: texte('analyse_btp.erreurs.trop_faible', { fixe: arrondir(fixe, 2) }) };

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

// ---------------------------------------------------------------- éléments regroupés par code et libellé

/** Valeurs d'un élément comparées entre les lignes d'un groupe (champ du résultat de calcul). */
export const VALEURS_ELEMENT = {
  pa: { champ: 'lig_pa', get titre() { return texte('analyse_btp.valeurs.pa'); }, decimales: 4 },
  fg: { champ: 'lig_coef_fg', get titre() { return texte('analyse_btp.valeurs.fg'); }, decimales: 4, coef: true },
  pr: { champ: 'lig_pr', get titre() { return texte('analyse_btp.valeurs.pr'); }, decimales: 4 },
  benef: { champ: 'lig_coef_benef', get titre() { return texte('analyse_btp.valeurs.benef'); }, decimales: 4, coef: true },
  pv: { champ: 'lig_pv', get titre() { return texte('analyse_btp.valeurs.pv'); }, decimales: 4 },
};

/** Clé de regroupement d'un élément : code et libellé (sans balises), insensible à la casse et aux espaces. */
export const cleElement = (l) => `${String(l.lig_code ?? '').trim().toUpperCase()}|${String(l.lig_libelle_brut ?? '').replace(/\s+/g, ' ').trim().toLowerCase()}`;

/**
 * Éléments (lignes de type Élément, hors lignes d'écart du moteur) regroupés par code et libellé : quantité totale,
 * montant (Σ qt × PV), unités, natures, et pour chaque valeur le minimum et le maximum (divergente si différents).
 */
export function elementsAnalyse(feuilles) {
  const groupes = new Map();
  for (const f of feuilles) {
    const l = f.ligne;
    if (l.lig_tyl_id !== 3 || l.lig_is_ecart_arrondi) continue;
    const cle = cleElement(l);
    if (!groupes.has(cle)) groupes.set(cle, { cle, code: l.lig_code ?? '', libelle: l.lig_libelle_brut ?? '', feuilles: [], unites: new Set(), natures: new Set(), qt: 0, montant: 0, valeurs: {} });
    const g = groupes.get(cle);
    g.feuilles.push(f);
    g.unites.add(l.lig_unt_code ?? '');
    g.natures.add(f.nature);
    const qt = Number(l.lig_qte_totale ?? 0);
    g.qt += qt;
    g.montant += qt * Number(l.lig_pv ?? 0);
    for (const [k, v] of Object.entries(VALEURS_ELEMENT)) {
      const x = l[v.champ] === null || l[v.champ] === undefined ? null : Number(l[v.champ]);
      if (x === null) continue;
      const s = g.valeurs[k] ?? { min: x, max: x };
      g.valeurs[k] = { min: Math.min(s.min, x), max: Math.max(s.max, x) };
    }
  }
  for (const g of groupes.values()) for (const s of Object.values(g.valeurs)) s.divergent = Math.abs(s.max - s.min) > 1e-9;
  return [...groupes.values()].sort((a, b) => b.montant - a.montant || a.libelle.localeCompare(b.libelle));
}

/**
 * Modifications de saisie pour écrire une valeur sur les lignes d'un groupe d'éléments : PA, FG et bénéfice
 * directement ; PR par le coefficient de frais généraux (PR / PA) ; PV en prix fixe. Renvoie Map(lig_id → champs) ou
 * une erreur.
 */
export function modificationsElement(groupe, cle, valeur) {
  const v = D(valeur);
  const modifs = new Map();
  for (const f of groupe.feuilles) {
    const id = f.ligne.lig_id;
    if (cle === 'pa') modifs.set(id, { lig_pa: Number(v) });
    else if (cle === 'fg') modifs.set(id, { lig_coef_fg: Number(v) });
    else if (cle === 'benef') modifs.set(id, { lig_coef_benef: Number(v) });
    else if (cle === 'pr') {
      const pa = D(f.ligne.lig_pa ?? 0);
      if (pa.isZero()) return { erreur: texte('analyse_btp.erreurs.pr_sans_pa', { element: groupe.libelle || groupe.code }) };
      modifs.set(id, { lig_coef_fg: Number(arrondir(v.div(pa), 6)) });
    } else if (cle === 'pv') modifs.set(id, { lig_pv: Number(v), lig_pv_fixe: true, lig_pv_affiche_fixe: false });
  }
  return { modifs };
}

/**
 * Nouvelle quantité totale d'un groupe d'éléments, reventilée au prorata des quantités totales actuelles. Quantité
 * totale d'une ligne = quantité vendue (saisie × coefficient de perte, arrondie à la précision de la ligne) × quantité
 * de l'ouvrage parent (relative) ou × quantité totale / quantité vendue de l'ouvrage (absolue). La quantité saisie
 * (lig_qte) est calculée à rebours ; une ligne dont la quantité venait d'un métré repasse en quantité saisie (le métré
 * reste attaché, désactivé). Les plus fortes lignes absorbent l'arrondi, les plus faibles affinent.
 * Renvoie { qtes: Map(lig_id → lig_qte), metres: lignes dont le métré est désactivé, ecart } ou { erreur }.
 */
export function repartirQuantite(groupe, cible, resultat) {
  const parId = new Map(resultat.lignes.map((l) => [l.lig_id, l]));
  const facteur = (l) => {
    const p = parId.get(l.lig_parent_id);
    if (!p || !(p.lig_tyl_id === 2 || p.lig_tyl_id === 3)) return D(1);
    const pqt = D(p.lig_qte_totale ?? 0);
    if ((l.lig_qte_type ?? 'R') !== 'A') return pqt;
    const pqv = D(p.lig_qte_vendue ?? 0);
    return pqv.isZero() ? D(0) : pqt.div(pqv);
  };
  const perte = (f) => D(f.saisie?.lig_coef_perte ?? f.ligne.lig_coef_perte ?? 1);
  const prec = (f) => Number(f.saisie?.lig_precision_qte ?? f.ligne.lig_precision_qte ?? 2);
  const totale = (f, qte) => arrondir(D(qte).times(perte(f)), prec(f)).times(facteur(f.ligne));
  const lignes = groupe.feuilles.filter((f) => !facteur(f.ligne).isZero() && !perte(f).isZero());
  if (!lignes.length) return { erreur: texte('analyse_btp.erreurs.sans_quantite') };
  const T = D(cible);
  const actuelles = lignes.map((f) => D(f.ligne.lig_qte_totale ?? 0));
  const somme = actuelles.reduce((s, x) => s.plus(x), D(0));
  const qtes = new Map();
  lignes.forEach((f, i) => {
    // Prorata des quantités totales actuelles (parts égales si elles sont toutes nulles).
    const part = somme.isZero() ? T.div(lignes.length) : T.times(actuelles[i]).div(somme);
    qtes.set(f.ligne.lig_id, arrondir(part.div(facteur(f.ligne)).div(perte(f)), prec(f)));
  });
  const atteint = () => lignes.reduce((s, f) => s.plus(totale(f, qtes.get(f.ligne.lig_id))), D(0));
  // Les plus fortes lignes absorbent l'arrondi, puis les plus faibles affinent (pas : précision de la quantité × quantité de l'ouvrage).
  const ordre = [...lignes].sort((a, b) => totale(b, qtes.get(b.ligne.lig_id)).cmp(totale(a, qtes.get(a.ligne.lig_id))));
  for (const f of ordre) {
    const ecart = T.minus(atteint());
    if (ecart.abs().lt(1e-9)) break;
    const id = f.ligne.lig_id;
    const corrige = arrondir(qtes.get(id).plus(ecart.div(facteur(f.ligne)).div(perte(f))), prec(f));
    if (corrige.gte(0)) qtes.set(id, corrige);
  }
  const metres = lignes.filter((f) => (f.saisie?.lig_qte_source ?? 'S') === 'M').length;
  return { qtes: new Map([...qtes].map(([id, q]) => [id, Number(q)])), metres, ecart: Number(T.minus(atteint())) };
}

// ---------------------------------------------------------------- prix rechargés depuis la bibliothèque

const egal = (a, b) => (a === null || a === undefined || a === '' ? b === null || b === undefined || b === '' : b !== null && b !== undefined && b !== '' && D(a).eq(D(b)));

/**
 * Prix du jour de la bibliothèque sur des lignes d'éléments (feuilles filtrées de l'analyse). `trouves` : Map(lig_id →
 * { element, rapprochement }) — élément lié (lig_art_id) ou, pour une ligne sans lien, élément de même code proposé
 * au rapprochement ; `prixUnite(element, unite)` : { pa, pv } dans l'unité de la ligne (lève une erreur sinon).
 * Règles (CONCEPTION-DOCUMENTS-EVOLUTIONS.md, lot D) : PA rechargé, coefficients conservés ; PV fixe en bibliothèque :
 * PV rechargé en PV fixe (le bénéfice suit) ; ligne à PV fixe : son PV est conservé (le bénéfice suit), avec une alerte
 * si la bibliothèque impose aussi un PV. Renvoie les lignes à présenter : { id, code, libelle, unite, element,
 * rapprochement, champs (null : rien à écrire), avant, apres, alerte }.
 */
export function rechargementPrix(feuilles, trouves, prixUnite) {
  const res = [];
  for (const f of feuilles) {
    const l = f.saisie ?? f.ligne;
    const base = { id: l.lig_id, code: l.lig_code ?? '', libelle: f.ligne.lig_libelle_brut ?? '', unite: l.lig_unt_code ?? '' };
    const t = trouves.get(l.lig_id);
    if (!t?.element) {
      res.push({ ...base, champs: null, sansCorrespondance: !l.lig_art_id, alerte: texte(l.lig_art_id ? 'analyse_btp.prix.introuvable' : l.lig_code ? 'analyse_btp.prix.sans_code' : 'analyse_btp.prix.sans_lien') });
      continue;
    }
    const e = t.element;
    if (e.type !== 'ARTICLE') {
      res.push({ ...base, element: e, rapprochement: t.rapprochement, champs: null, alerte: texte('analyse_btp.prix.type', { type: e.type }) });
      continue;
    }
    let p;
    try { p = prixUnite(e, l.lig_unt_code); } catch (x) {
      res.push({ ...base, element: e, rapprochement: t.rapprochement, champs: null, alerte: x.message ?? String(x) });
      continue;
    }
    const pvFixeBib = e.pv_fixe === true || e.pv_fixe === 'true';
    const pvFixeLigne = Boolean(l.lig_pv_fixe || l.lig_pv_affiche_fixe);
    const champs = { lig_pa: p.pa };
    let alerte = null;
    if (pvFixeBib && !pvFixeLigne) Object.assign(champs, { lig_pv: p.pv, lig_pv_fixe: true });
    if (pvFixeBib && pvFixeLigne) alerte = texte('analyse_btp.prix.pv_fixe');
    if (t.rapprochement) champs.lig_art_id = e.id;
    const avant = { pa: l.lig_pa ?? null, pv: f.ligne.lig_pv ?? null };
    const apres = { pa: p.pa, pv: champs.lig_pv ?? null };
    const change = t.rapprochement || !egal(avant.pa, apres.pa) || (champs.lig_pv !== undefined && (!egal(avant.pv, apres.pv) || !l.lig_pv_fixe));
    if (!change && !alerte) continue;
    res.push({ ...base, element: e, rapprochement: Boolean(t.rapprochement), champs: change ? champs : null, avant, apres, alerte });
  }
  return res;
}
