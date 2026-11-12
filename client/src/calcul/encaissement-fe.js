// Statut Encaissée (212) d'une facture émise (plans/facturation-electronique.md, lot 26 ; Q15, XP Z12-014 cas 26 et 34).
// Répliqué dans src/LogiBTP.Calcul/EncaissementFeBtp.cs (jeu tests/emission-fe/03_encaissement.json).
// - Concernée : cadre de services ou mixte (S*, M*) sans TVA sur les débits (BT-8 ≠ 5) ;
// - part des services : services / total des lignes vendues (mixte), 1 pour des services ;
// - montants encaissés au cumul c des pointages : total arrondi(c × services / total) réparti au prorata du TTC de chaque
//   taux, le dernier taux recevant le reste ; chaque
//   proposition = montant au nouveau cumul − déjà déclaré du taux (versements partiels et annulations compensés au centime,
//   facture entièrement payée = TTC exact de chaque taux) ;
// - annulation d'encaissement (pointage diminué ou supprimé après un envoi, cas 34) : écart de signe contraire.
import { D, Dz, S, ZERO, arrondir } from '@logibtp/socle';
import { CODE_EXIGIBILITE_TVA } from '@logibtp/facture-electronique';
import { NATURE_FE } from '../app/codes.js';
import { lignesVendues, natureLigne } from './emission-fe.js';

/** Facture concernée : cadre BT-23 de services ou mixte, et pas de TVA sur les débits (BT-8 = 5). */
export function concerneEncaissement(cadre, codeExigibilite) {
  return typeof cadre === 'string' && (cadre.startsWith('S') || cadre.startsWith('M')) && codeExigibilite !== CODE_EXIGIBILITE_TVA.DATE_FACTURE;
}

/** HT des lignes vendues de services et HT de toutes les lignes vendues (lig_montant_ht), en chaînes décimales. */
export function partServices(lignes, naturesFe = {}) {
  let services = ZERO;
  let total = ZERO;
  for (const l of lignesVendues(lignes)) {
    const m = Dz(l.lig_montant_ht);
    total = total.plus(m);
    if (natureLigne(l, naturesFe) === NATURE_FE.SERVICES) services = services.plus(m);
  }
  return { services: S(services), total: S(total) };
}

/** Ventilation regroupée par taux (ordre de première apparition), en décimaux. */
function parTaux(ventilation) {
  const r = [];
  for (const x of ventilation ?? []) {
    const taux = Dz(x.taux);
    const i = r.findIndex((y) => y.taux.equals(taux));
    if (i < 0) r.push({ taux, montant: Dz(x.montant) });
    else r[i].montant = r[i].montant.plus(Dz(x.montant));
  }
  return r;
}

function repartirDec(v, servicesHt, totalHt, cumul) {
  const ttc = v.reduce((s, x) => s.plus(x.montant), ZERO);
  if (ttc.isZero() || totalHt.isZero()) return v.map((x) => ({ taux: x.taux, montant: ZERO }));
  // Total arrondi une fois ; chaque taux au prorata, le dernier reçoit le reste (la somme suit le pointage).
  let reste = arrondir(cumul.times(servicesHt).div(totalHt), 2);
  return v.map((x, i) => {
    const montant = i === v.length - 1 ? reste : arrondir(cumul.times(x.montant).times(servicesHt).div(ttc.times(totalHt)), 2);
    reste = reste.minus(montant);
    return { taux: x.taux, montant };
  });
}

/** Montant encaissé de chaque taux au cumul des pointages ({ taux, montant } en chaînes). */
export function repartirEncaissement(ventilation, servicesHt, totalHt, cumul) {
  return repartirDec(parTaux(ventilation), D(servicesHt) ?? D(1), D(totalHt) ?? D(1), Dz(cumul))
    .map((x) => ({ taux: S(x.taux), montant: S(x.montant) }));
}

/**
 * Statuts Encaissée proposés pour les écarts d'une facture (écart nul : rien).
 * entree : { ventilation: [{ taux, montant }], services_ht, total_ht, declare: [{ taux, montant }], cumul, ecarts: [{ cle, montant }] }
 * → [{ cle, montant, annulation, encaissements: [{ taux, montant }] }] (montants en chaînes décimales).
 */
export function proposerEncaissements(entree) {
  const v = parTaux(entree.ventilation);
  const servicesHt = D(entree.services_ht) ?? D(1);
  const totalHt = D(entree.total_ht) ?? D(1);
  const ttc = v.reduce((s, x) => s.plus(x.montant), ZERO);
  const declare = new Map(v.map((x) => [S(x.taux), ZERO]));
  for (const d of entree.declare ?? []) {
    const k = S(Dz(d.taux));
    declare.set(k, (declare.get(k) ?? ZERO).plus(Dz(d.montant)));
  }
  let cumul = Dz(entree.cumul);
  const r = [];
  for (const ecart of entree.ecarts ?? []) {
    const montant = Dz(ecart.montant);
    if (montant.isZero()) continue;
    cumul = cumul.plus(montant);
    const encaissements = [];
    for (const a of repartirDec(v, servicesHt, totalHt, cumul)) {
      const k = S(a.taux);
      const m = a.montant.minus(declare.get(k));
      declare.set(k, a.montant);
      if (!m.isZero()) encaissements.push({ taux: k, montant: S(m) });
    }
    r.push({ cle: ecart.cle, montant: S(montant), annulation: montant.times(ttc).lt(0), encaissements });
  }
  return r;
}
