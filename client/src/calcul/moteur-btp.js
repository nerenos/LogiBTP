import { D, Dz, S, ZERO, UN, coef, arrondir, arr6, ErreurCalcul } from '@logibtp/socle';
import { MoteurDocument, TL, estChiffree, estPied, union } from '@logibtp/document';
import { Portees, EvaluateurMetre, evaluerVariable, repartirVariables } from '@logibtp/metre';
import {
  COLONNES_DOCUMENT_BTP, COLONNES_LIGNE_BTP, COLONNES_DECIMALES_BTP, COLONNES_PRIX_CALCULES_BTP, COLONNES_QTE_CALCULEES_BTP,
} from './colonnes-btp.js';

/**
 * Moteur de calcul d'un devis BTP : spécialise MoteurDocument (module Document) et s'appuie sur le
 * module Métré pour les métrés et les variables de calcul.
 *
 * Ajouts BTP : variables ($$, $ titre, @@ ouvrage, @ ligne), métrés, coefficient de perte, déboursé
 * (PA × FG × bénéfice), ouvrages en mode déboursé (D) ou somme des PV (V), PV fixe et ventilation avec
 * ligne d'écart d'arrondi, PV affiché fixe et coefficient de frais annexes, montants PA / PR.
 * Réplique exacte de MoteurDevisBtp (C#).
 */
export class MoteurDevisBtp extends MoteurDocument {
  constructor(entree) {
    super(entree);
    const e = this.entree;
    this.mode = this.doc.ent_mode_calcul_ouvrage ?? 'V';
    this.metres = e.metres ?? [];
    this.metreLignes = e.metre_lignes ?? [];
    this.variables = e.variables ?? [];
    this.fixe = new Map();
    this.pvVentiles = new Set();
    this.ecartsCrees = new Map();
    this.metreDeLigne = new Map();
    this.coefFa = UN;
    // $ : titres englobants (la ligne elle-même si c'est un titre) ; @@ : ouvrages englobants.
    this.portees = new Portees({
      chaine: (portee, ligneId) => {
        const type = portee === '$' ? TL.TITRE : portee === '@@' ? TL.OUVRAGE : null;
        const res = [];
        if (type === null) return res;
        for (let x = this.parId.get(ligneId); x; x = this.parent(x)) if (x.lig_tyl_id === type) res.push(x.lig_id);
        return res;
      },
      messagePortee: (p) => (p === '$' ? 'Aucun titre parent pour une variable $' : p === '@@' ? 'Aucun ouvrage parent pour une variable @@' : `Portée inconnue ${p}`),
    });
  }

  /** Les lignes d'écart d'arrondi sont supprimées puis recréées si nécessaire (section 10). */
  preparerLignes(lignes) {
    this.prochainId = Math.min(0, ...lignes.map((l) => Number(l.lig_id))) - 1;
    this.ecartsExistants = new Map();
    const res = [];
    for (const l of lignes) {
      if (l.lig_is_ecart_arrondi) this.ecartsExistants.set(l.lig_parent_id, l);
      else res.push(l);
    }
    return res;
  }

  get colonnesDocument() { return union(super.colonnesDocument, COLONNES_DOCUMENT_BTP); }
  get colonnesLigne() { return union(super.colonnesLigne, COLONNES_LIGNE_BTP); }
  get colonnesDecimales() { return union(super.colonnesDecimales, COLONNES_DECIMALES_BTP); }
  get colonnesPrixCalcules() { return union(super.colonnesPrixCalcules, COLONNES_PRIX_CALCULES_BTP); }
  get colonnesQteCalculees() { return union(super.colonnesQteCalculees, COLONNES_QTE_CALCULEES_BTP); }

  composantes(ouvrage) {
    return super.composantes(ouvrage).filter((c) => !c.lig_is_ecart_arrondi);
  }

  estNumerotee(l) {
    return super.estNumerotee(l) && !l.lig_is_ecart_arrondi;
  }

  lireVariable(portee, nom, ligne) {
    return this.portees.lire(portee, nom, ligne?.lig_id ?? null);
  }

  // ---------------------------------------------------------------- validation : blocages de prix

  validerLigne(l) {
    let fixe = null;
    if (l.lig_pv_fixe) fixe = 'PV';
    if (l.lig_pv_affiche_fixe) {
      if (fixe) this.erreur(l.lig_id, 'BLOCAGES_EXCLUSIFS', 'PV fixe et PV affiché fixe sont exclusifs : seul le PV fixe est retenu', false);
      else if (!this.estLigneDePrix(l)) this.erreur(l.lig_id, 'PV_AFFICHE_FIXE', 'Le PV affiché fixe est réservé aux lignes de prix', false);
      else fixe = 'AFF';
    }
    if (fixe === 'PV' && D(l.lig_pv) === null) { this.avertir(l.lig_id, 'PV_FIXE_VIDE', 'PV fixe sans valeur : blocage ignoré'); fixe = null; }
    if (fixe === 'AFF' && D(l.lig_pv_affiche) === null) { this.avertir(l.lig_id, 'PV_FIXE_VIDE', 'PV affiché fixe sans valeur : blocage ignoré'); fixe = null; }
    if (fixe && l.lig_tyl_id === TL.OUVRAGE && this.enfantsDe(l.lig_id).length === 0) {
      this.erreur(l.lig_id, 'OUVRAGE_SANS_COMPOSANTE',
        'Prix fixe interdit sur un ouvrage sans composante : ajoutez des composantes ou transformez la ligne en élément', false);
      fixe = null;
    }
    if (fixe && estChiffree(l)) this.fixe.set(l.lig_id, fixe);
  }

  // ---------------------------------------------------------------- passe 1 : variables, métrés, quantités

  evaluerVariable(v, ligne) {
    evaluerVariable(v, { resolveur: this.resolveur(ligne, 'calcul'), portees: this.portees, ligneId: ligne?.lig_id ?? null });
  }

  avantQuantites() {
    for (const v of this.variables) v.var_valeur = null;
    const { document, parLigne, parMetre } = repartirVariables(this.variables);
    this.varsParLigne = parLigne;
    this.varsParMetre = parMetre;
    for (const v of document) {
      try { this.evaluerVariable(v, null); } catch (e) { this.capturer(e, null); }
    }
  }

  quantiteBase(l) {
    l.lig_qte_base = null;
    const metre = l.lig_mtr_id !== null && l.lig_mtr_id !== undefined ? this.metres.find((m) => m.mtr_id === l.lig_mtr_id) : null;
    this.metreDeLigne.set(l.lig_id, metre ?? null);
    this.qteEnCours = l;
    try {
      if (metre) {
        new EvaluateurMetre({
          resolveur: this.resolveur(l, 'calcul'),
          affecter: (portee, nom, valeur) => this.portees.affecter(portee, nom, '=', valeur, l.lig_id),
        }).evaluer(metre, this.metreLignes);
      }
      if ((l.lig_qte_source ?? 'S') === 'M') {
        if (!metre) throw new ErreurCalcul('METRE_ABSENT', 'La quantité est issue d\'un métré absent');
        return D(metre.mtr_resultat);
      }
      return Dz(l.lig_qte);
    } finally {
      this.qteEnCours = null;
    }
  }

  quantiteVendue(l, base) {
    return arrondir(base.times(coef(l.lig_coef_perte)), l.lig_precision_qte ?? 2);
  }

  ecrireQuantites(l, base, qv, totale) {
    l.lig_qte_base = S(arr6(base));
    super.ecrireQuantites(l, base, qv, totale);
  }

  apresLigne(l) {
    // Variables de l'onglet Définition du métré : sorties du métré, évaluées après ses lignes et après
    // la quantité (elles peuvent lire le résultat, les variables du métré et lig_qte_vendue).
    const metre = estChiffree(l) ? this.metreDeLigne.get(l.lig_id) : null;
    if (metre) for (const v of this.varsParMetre.get(metre.mtr_id) ?? []) this.evaluerVariable(v, l);
    for (const v of this.varsParLigne.get(l.lig_id) ?? []) this.evaluerVariable(v, l);
  }

  // ---------------------------------------------------------------- passe 2 : prix, PV fixes

  prixLigne(l) {
    const fixe = this.fixe.get(l.lig_id) ?? null;
    if (!this.estCompose(l)) {
      this.prixElement(l, fixe);
      return;
    }
    let pa = ZERO, pr = ZERO, pv = ZERO, pvNat = ZERO;
    for (const c of this.composantes(l)) {
      const x = this.px.get(c.lig_id);
      if (!x) continue;
      const q = this.qu(c, l);
      pa = pa.plus(q.times(x.pa));
      pr = pr.plus(q.times(x.pr));
      pv = pv.plus(q.times(x.pv));
      pvNat = pvNat.plus(q.times(x.pvNat));
    }
    let res;
    if (this.mode === 'D') {
      const fg = coef(l.lig_coef_fg), bn = coef(l.lig_coef_benef);
      pa = arr6(pa);
      const prD = arr6(pa.times(fg));
      const pvD = arr6(prD.times(bn));
      res = { pa, pr: prD, pv: pvD, pvNat: pvD, coefFg: fg, coefBenef: bn };
    } else {
      res = { pa: arr6(pa), pr: arr6(pr), pv: arr6(pv), pvNat: arr6(pvNat), coefFg: null, coefBenef: null };
    }
    this.px.set(l.lig_id, res);
    if (fixe === 'PV') this.ventiler(l, D(l.lig_pv));
  }

  prixElement(l, fixe) {
    const fg = coef(l.lig_coef_fg), bn = coef(l.lig_coef_benef);
    const pa = D(l.lig_pa);
    if (fixe === 'PV') {
      const pvFixe = D(l.lig_pv);
      if (pa === null || pa.isZero()) {
        // Prix non défini : PA = PR = PV = prix fixe, coefficients à 1.
        this.px.set(l.lig_id, { pa: pvFixe, pr: pvFixe, pv: pvFixe, pvNat: pvFixe, coefFg: UN, coefBenef: UN });
      } else {
        const pr = arr6(pa.times(fg));
        this.px.set(l.lig_id, {
          pa, pr, pv: pvFixe, pvNat: arr6(pr.times(bn)), coefFg: fg,
          coefBenef: pr.isZero() ? bn : arr6(pvFixe.div(pr)),
        });
      }
      return;
    }
    const pr = arr6((pa ?? ZERO).times(fg));
    const pv = arr6(pr.times(bn));
    this.px.set(l.lig_id, { pa: pa ?? ZERO, pr, pv, pvNat: pv, coefFg: fg, coefBenef: bn });
  }

  supprimerEcartCree(ouvrage) {
    const e = this.ecartsCrees.get(ouvrage.lig_id);
    if (!e) return;
    this.ecartsCrees.delete(ouvrage.lig_id);
    this.ecartsExistants.set(ouvrage.lig_id, e);
    this.lignes = this.lignes.filter((l) => l !== e);
    this.parId.delete(e.lig_id);
    this.enfants.set(ouvrage.lig_id, this.enfantsDe(ouvrage.lig_id).filter((l) => l !== e));
    this.px.delete(e.lig_id);
  }

  /** Répartit un PV fixe sur l'ouvrage (section 10). Le PV de l'ouvrage reste la valeur fixe. */
  ventiler(ouvrage, pvFixe) {
    const x = this.px.get(ouvrage.lig_id);
    this.supprimerEcartCree(ouvrage);

    if (this.mode === 'D') {
      if (x.pr.isZero()) {
        Object.assign(x, { pa: pvFixe, pr: pvFixe, pv: pvFixe, coefFg: UN, coefBenef: UN });
      } else {
        x.coefBenef = arr6(pvFixe.div(x.pr));
        x.pv = pvFixe;
      }
      return;
    }

    const comps = this.composantes(ouvrage).filter((c) => this.px.has(c.lig_id));
    const qus = comps.map((c) => this.qu(c, ouvrage));
    const contribs = comps.map((c, i) => qus[i].times(this.px.get(c.lig_id).pvNat));
    const somme = contribs.reduce((a, b) => a.plus(b), ZERO);
    let principale = null;

    if (!somme.isZero()) {
      const k = pvFixe.div(somme);
      const pvs = comps.map((c) => arrondir(this.px.get(c.lig_id).pvNat.times(k), c.lig_precision_pv ?? 2));
      let im = 0;
      for (let i = 1; i < contribs.length; i++) if (contribs[i].gt(contribs[im])) im = i;
      principale = comps[im];
      const total = pvs.reduce((a, pv, i) => a.plus(qus[i].times(pv)), ZERO);
      const ecart = pvFixe.minus(total);
      if (!qus[im].isZero()) pvs[im] = arrondir(pvs[im].plus(ecart.div(qus[im])), principale.lig_precision_pv ?? 2);
      comps.forEach((c, i) => this.appliquerPvVentile(c, pvs[i]));
    }

    let pa = ZERO, pr = ZERO, total = ZERO;
    comps.forEach((c, i) => {
      const y = this.px.get(c.lig_id);
      pa = pa.plus(qus[i].times(y.pa));
      pr = pr.plus(qus[i].times(y.pr));
      total = total.plus(qus[i].times(y.pv));
    });
    const residu = arr6(pvFixe.minus(total));
    if (!residu.isZero()) {
      this.creerEcart(ouvrage, residu, principale);
      pa = pa.plus(residu);
      pr = pr.plus(residu);
    }
    Object.assign(x, { pa: arr6(pa), pr: arr6(pr), pv: pvFixe });
  }

  appliquerPvVentile(c, pv) {
    const y = this.px.get(c.lig_id);
    this.pvVentiles.add(c.lig_id);
    if (this.estCompose(c)) {
      y.pv = pv;
      this.ventiler(c, pv);
      return;
    }
    if (y.pr.isZero()) {
      // Composante sans déboursé : PA = PR = PV, coefficients à 1.
      if (!pv.isZero()) Object.assign(y, { pa: pv, pr: pv, coefFg: UN, coefBenef: UN });
      y.pv = pv;
      return;
    }
    y.pv = pv;
    y.coefBenef = arr6(pv.div(y.pr));
  }

  creerEcart(ouvrage, residu, principale) {
    const existant = this.ecartsExistants.get(ouvrage.lig_id);
    this.ecartsExistants.delete(ouvrage.lig_id);
    const id = existant ? existant.lig_id : this.prochainId--;
    const reference = principale ?? this.enfantsDe(ouvrage.lig_id)[0] ?? null;
    const typeQte = principale ? (principale.lig_qte_type ?? 'R') : 'R';
    // Quantité 1 en relatif, quantité de l'ouvrage en absolu : dans les deux cas une unité par unité d'ouvrage.
    const qte = typeQte === 'A' ? Dz(ouvrage.lig_qte_vendue) : UN;
    const ordre = Math.max(0, ...this.enfantsDe(ouvrage.lig_id).map((c) => c.lig_ordre)) + 1;
    const r = S(residu);
    const l = {
      lig_id: id,
      lig_ent_id: ouvrage.lig_ent_id ?? 0,
      lig_parent_id: ouvrage.lig_id,
      lig_chemin: null,
      lig_ordre: ordre,
      lig_tyl_id: TL.ELEMENT,
      lig_numerotation: null,
      lig_num_depart: null,
      lig_num_manuelle: false,
      lig_code: null,
      lig_libelle_html: 'Ajustement d\'arrondi',
      lig_libelle_affiche: null,
      lig_libelle_brut: null,
      lig_art_id: null,
      lig_nat_id: reference?.lig_nat_id ?? null,
      lig_ptv_id: reference?.lig_ptv_id ?? null,
      lig_cpt_code: null,
      lig_fichier_id: null,
      lig_qte: S(qte),
      lig_qte_type: typeQte,
      lig_mtr_id: null,
      lig_qte_source: 'S',
      lig_qte_base: S(qte),
      lig_coef_perte: '1',
      lig_qte_vendue: S(qte),
      lig_qte_totale: S(arr6(Dz(ouvrage.lig_qte_totale))),
      lig_unt_code: null,
      lig_precision_qte: 6,
      lig_pa: r, lig_coef_fg: '1', lig_pr: r, lig_coef_benef: '1', lig_pv: r,
      lig_coef_fa: '1', lig_coef_prorata: '1', lig_pv_affiche: null, lig_coef_remise: '1', lig_pv_remise: null,
      lig_precision_pv: 6,
      lig_pv_fixe: false,
      lig_pv_affiche_fixe: false,
      lig_type_prix: ouvrage.lig_type_prix ?? 'V',
      lig_variante_de_id: null,
      lig_is_ecart_arrondi: true,
      lig_st_depuis_id: null,
      lig_montant_pa: null, lig_montant_pr: null, lig_montant_ht: null,
      lig_pied_mode: null, lig_pied_base: null, lig_pied_base_id: null, lig_pied_sens: null, lig_pied_valeur: null, lig_pied_is_fa: false,
      lig_etiquette: null,
      lig_base_calcul: null, lig_montant_tva: null,
      lig_tva_id: null, lig_taux_tva: null,
      lig_commentaire: null,
      lig_is_non_editee: true,
      lig_origine_id: null,
      lig_proprietes: {},
    };
    this.lignes.push(l);
    this.parId.set(id, l);
    if (!this.enfants.has(ouvrage.lig_id)) this.enfants.set(ouvrage.lig_id, []);
    this.enfants.get(ouvrage.lig_id).push(l);
    this.ecartsCrees.set(ouvrage.lig_id, l);
    this.px.set(id, { pa: residu, pr: residu, pv: residu, pvNat: residu, coefFg: UN, coefBenef: UN });
    this.traitees.add(id);
  }

  // ---------------------------------------------------------------- après les prix : frais annexes

  lignesDePrixEnTotal() {
    return this.ordre.filter((l) => !estPied(l) && this.estLigneDePrix(l) && !this.horsTotal(l)
      && !this.enErreur.has(l.lig_id) && this.px.has(l.lig_id));
  }

  /**
   * Coefficient de prorata de la ligne : appliqué au prix affiché après la ventilation des frais annexes, avant la
   * remise. Il n'entre pas dans le calcul du coefficient de frais annexes (un PV affiché imposé en est d'abord retiré).
   */
  prorata(l) { return coef(l.lig_coef_prorata); }

  /** PV affiché imposé hors prorata. */
  afficheHorsProrata(l) {
    const k = this.prorata(l);
    return k.eq(UN) ? D(l.lig_pv_affiche) : arr6(D(l.lig_pv_affiche).div(k));
  }

  apresPrix() {
    let F = ZERO, A = ZERO, P = ZERO;
    for (const l of this.lignesDePrixEnTotal()) {
      const qv = Dz(l.lig_qte_vendue);
      if (this.fixe.get(l.lig_id) === 'AFF') A = A.plus(this.afficheHorsProrata(l).times(qv));
      else F = F.plus(this.px.get(l.lig_id).pv.times(qv));
    }
    for (const p of this.enfantsDe(null)) {
      if (!estPied(p) || p.lig_tyl_id === TL.TVA || !p.lig_pied_is_fa || (p.lig_type_prix ?? 'V') !== 'V') continue;
      if ((p.lig_pied_mode ?? 'M') !== 'M') {
        this.erreur(p.lig_id, 'FA_POURCENTAGE', 'Un frais annexe ventilé doit être saisi en montant', false);
        continue;
      }
      P = P.plus(arrondir(Dz(p.lig_pied_valeur), this.precMontant).times(p.lig_pied_sens === -1 ? -1 : 1));
    }

    let c = UN;
    if (!P.isZero()) {
      if (F.gt(0)) {
        // Racine positive de F·c² − (F + P − A)·c − A = 0.
        const b = F.plus(P).minus(A);
        c = arr6(b.plus(b.times(b).plus(F.times(A).times(4)).sqrt()).div(F.times(2)));
      } else if (A.gt(P)) {
        c = arr6(A.div(A.minus(P)));
      } else {
        this.erreur(null, 'FRAIS_ANNEXES', 'Les frais annexes doivent rester inférieurs à la somme des prix affichés fixes');
      }
    }
    this.coefFa = c;

    for (const l of this.ordre) {
      if (this.fixe.get(l.lig_id) !== 'AFF' || !this.px.has(l.lig_id)) continue;
      const pvFixe = arr6(this.afficheHorsProrata(l).div(c));
      if (this.estCompose(l)) {
        this.px.get(l.lig_id).pv = pvFixe;
        this.ventiler(l, pvFixe);
      } else {
        const y = this.px.get(l.lig_id);
        if (y.pr.isZero()) Object.assign(y, { pa: pvFixe, pr: pvFixe, pv: pvFixe, coefFg: UN, coefBenef: UN });
        else Object.assign(y, { pv: pvFixe, coefBenef: arr6(pvFixe.div(y.pr)) });
      }
    }
    this.reconstruireOrdre();
  }

  // ---------------------------------------------------------------- montants, totaux, pied

  get champsMontants() {
    return [...super.champsMontants, 'lig_pr', 'lig_pv_affiche', 'lig_montant_pa', 'lig_montant_pr'];
  }

  pvAffiche(l, y, prec) {
    return this.fixe.get(l.lig_id) === 'AFF' ? D(l.lig_pv_affiche) : arrondir(y.pv.times(this.coefFa).times(this.prorata(l)), prec);
  }

  ecrireMontants(l, y, montants) {
    super.ecrireMontants(l, y, montants);
    const { pvAff, qv } = montants;
    const pm = this.precMontant;
    l.lig_pa = S(y.pa);
    l.lig_pr = S(y.pr);
    if (y.coefFg) l.lig_coef_fg = S(y.coefFg);
    if (y.coefBenef) l.lig_coef_benef = S(y.coefBenef);
    l.lig_coef_fa = S(this.coefFa);
    l.lig_pv_affiche = S(pvAff);
    l.lig_montant_pa = S(arrondir(qv.times(y.pa), pm));
    l.lig_montant_pr = S(arrondir(qv.times(y.pr), pm));
    if (this.pvVentiles.has(l.lig_id)) l.lig_pv_fixe = true;
  }

  get champsCumules() {
    return [...super.champsCumules, 'lig_montant_pa', 'lig_montant_pr'];
  }

  /** Frais annexe déjà ventilé dans les prix, ou poste pour mémoire : affiché, hors cumul. */
  horsCumulPied(p) {
    return !!p.lig_pied_is_fa || super.horsCumulPied(p);
  }

  ecrireTotaux(tva, cumul) {
    this.doc.ent_coef_fa = S(this.coefFa);
    super.ecrireTotaux(tva, cumul);
  }

  completerResultat(resultat) {
    return {
      ...resultat,
      metres: this.metres,
      metre_lignes: this.metreLignes,
      variables: this.variables,
      lignes_supprimees: [...this.ecartsExistants.values()].map((l) => l.lig_id),
    };
  }
}

/** Calcul d'un devis BTP. */
export function calculerDocument(entree) {
  return new MoteurDevisBtp(entree).calculer();
}
