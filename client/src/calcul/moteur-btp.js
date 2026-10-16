import { D, Dz, S, ZERO, UN, coef, arrondir, arr6, ErreurCalcul, analyserReference, echapperHtml, texteBrut } from '@logibtp/socle';
import { MoteurDocument, TL, estChiffree, estPied, union } from '@logibtp/document';
import {
  Portees, evaluerVariable, repartirVariables, evaluerScriptMetre, lignesVariablesScript, messageErreurScript,
} from '@logibtp/metre';
import {
  COLONNES_DOCUMENT_BTP, COLONNES_LIGNE_BTP, COLONNES_DECIMALES_BTP, COLONNES_PRIX_CALCULES_BTP, COLONNES_QTE_CALCULEES_BTP,
} from './colonnes-btp.js';

/**
 * Moteur de calcul d'un devis BTP : spécialise MoteurDocument (module Document) et s'appuie sur le
 * module Métré pour les métrés et les variables de calcul.
 *
 * Ajouts BTP : variables ($$, $ titre, @@ ouvrage, @ ligne), métrés, coefficient de perte, déboursé
 * (PA × FG × bénéfice), ouvrages en mode déboursé (D), somme des PV (V) ou bordereau (B : PV fixe sans ventilation),
 * PV fixe et ventilation avec ligne d'écart d'arrondi, PV affiché fixe et coefficient de frais annexes (lignes de pied
 * « frais annexe ventilé » et lignes de type de prix F, hors total), montants PA / PR.
 * Métrés en script (module Métré) : quantité renvoyée, erreurs non bloquantes (la quantité saisie est conservée),
 * libellé calculé ({{lig_libelle_html}} inscriptible), variables non locales régénérées à chaque calcul.
 * Réplique exacte de MoteurDevisBtp (C#).
 */

/**
 * Libellé écrit par un script : le texte ajouté avant ou après le libellé courant (HTML sûr) est échappé ; un texte
 * qui ne le contient pas est échappé en entier.
 */
export function libelleEcrit(avant, ecrit) {
  if (ecrit.startsWith(avant)) return avant + echapperHtml(ecrit.slice(avant.length));
  if (ecrit.endsWith(avant)) return echapperHtml(ecrit.slice(0, ecrit.length - avant.length)) + avant;
  return echapperHtml(ecrit);
}
/**
 * Clé d'un élément pour la ventilation des frais annexes : code (majuscules) et libellé saisi sans balises (minuscules,
 * espaces réduits). Réplique de MoteurDevisBtp.CleElementVentilation (C#).
 */
export function cleElementVentilation(l, libelleHtml = l.lig_libelle_html) {
  return `${String(l.lig_code ?? '').trim().toUpperCase()}|${texteBrut(libelleHtml ?? '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

export class MoteurDevisBtp extends MoteurDocument {
  constructor(entree) {
    super(entree);
    const e = this.entree;
    this.mode = this.doc.ent_mode_calcul_ouvrage ?? 'V';
    this.metres = e.metres ?? [];
    // Variables des métrés : produites par leur script à chaque calcul, jamais évaluées comme définitions.
    const toutes = e.variables ?? [];
    const scripts = new Set(this.metres.map((m) => m.mtr_id));
    this.variables = toutes.filter((v) => !scripts.has(v.var_mtr_id));
    this.variablesScript = new Map();
    for (const v of toutes) {
      if (!scripts.has(v.var_mtr_id)) continue;
      if (!this.variablesScript.has(v.var_mtr_id)) this.variablesScript.set(v.var_mtr_id, []);
      this.variablesScript.get(v.var_mtr_id).push(v);
    }
    this.prochainVarId = Math.min(0, ...toutes.map((v) => Number(v.var_id))) - 1;
    this.libellesScript = new Map();
    this.scripts = [];
    this.fixe = new Map();
    this.pvVentiles = new Set();
    this.ecartsCrees = new Map();
    this.metreDeLigne = new Map();
    this.coefFa = UN;
    // Frais annexes : clés saisies (ventilation_frais), coefficients par ligne, détail et bilan par tranche de frais.
    this.ventilations = e.ventilations ?? [];
    this.coefsFa = new Map();
    this.partsFa = new Map();
    this.ventilationsLignes = [];
    this.frais = [];
    this.ecartsFaReels = new Map();
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
      if (metre) this.evaluerScript(l, metre);
      if ((l.lig_qte_source ?? 'S') === 'M') {
        if (!metre) throw new ErreurCalcul('METRE_ABSENT', 'La quantité est issue d\'un métré absent');
        // Script sans résultat (sans « Renvoyer » ou en erreur) : la quantité saisie est conservée.
        return metre.mtr_resultat === null ? Dz(l.lig_qte) : D(metre.mtr_resultat);
      }
      return Dz(l.lig_qte);
    } finally {
      this.qteEnCours = null;
    }
  }

  /** Script du métré de la ligne : erreurs non bloquantes, libellé calculé, lignes de variables. */
  evaluerScript(l, metre) {
    const r = evaluerScriptMetre(metre, {
      resoudre: this.resolveurScript(l), ecrire: (ref, valeur) => this.ecrireScript(l, ref, valeur), portees: this.portees, ligneId: l.lig_id,
    });
    for (const e of r.erreurs) this.erreur(l.lig_id, e.code, messageErreurScript(e), false);
    if (r.erreurs.length > 0) this.libellesScript.delete(l.lig_id);
    else if (r.resultat === null && (l.lig_qte_source ?? 'S') === 'M') {
      this.avertir(l.lig_id, 'METRE_SANS_RESULTAT', 'Le métré ne renvoie pas de quantité (« Renvoyer » absent) : quantité saisie conservée');
    }
    this.variablesScript.set(metre.mtr_id, lignesVariablesScript(metre, r, this.variablesScript.get(metre.mtr_id) ?? [], {
      entId: this.doc.ent_id ?? null, nouvelId: () => this.prochainVarId--,
    }));
    this.scripts.push({ mtr_id: metre.mtr_id, lig_id: l.lig_id, resultat: r.resultat, erreurs: r.erreurs, avertissements: r.avertissements });
  }

  /** Lecture d'un script : variables et données typées ; {{lig_libelle_html}} = libellé courant (déjà écrit par le script). */
  resolveurScript(l) {
    return (texte) => {
      const ref = analyserReference(texte);
      if (ref.genre === 'variable') return this.lireVariable(ref.portee, ref.nom, l);
      if (!ref.table && ref.colonne === 'lig_libelle_html') return this.libellesScript.get(l.lig_id) ?? l.lig_libelle_html ?? '';
      return this.lireDonnee(ref, l, 'calcul').valeur;
    };
  }

  /** Écriture d'un script : seul le libellé de la ligne ({{lig_libelle_html}}), dans le libellé calculé. */
  ecrireScript(l, texte, valeur) {
    const ref = analyserReference(texte);
    if (ref.genre !== 'donnee' || ref.table || ref.colonne !== 'lig_libelle_html') {
      throw new ErreurCalcul('ECRITURE_INTERDITE', `{{${texte}}} ne peut pas être modifié par un métré (seul {{lig_libelle_html}} l'est)`);
    }
    if (typeof valeur !== 'string') throw new ErreurCalcul('TYPE', 'Libellé : chaîne attendue');
    this.libellesScript.set(l.lig_id, libelleEcrit(this.libellesScript.get(l.lig_id) ?? l.lig_libelle_html ?? '', valeur));
  }

  sourceLibelle(l) {
    return this.libellesScript.get(l.lig_id) ?? super.sourceLibelle(l);
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

    // Bordereau (B) : prix unitaire imposé comme dans un BPU ; le sous-détail garde ses prix (PA, PR = sommes des
    // composantes), sans ventilation ni écart d'arrondi.
    if (this.mode === 'B') {
      x.pv = pvFixe;
      return;
    }

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

  /** Lignes de prix vendues entrant dans le total (base du coefficient moyen de frais annexes). */
  lignesDePrixEnTotal() {
    return this.ordre.filter((l) => !estPied(l) && this.estLigneDePrix(l) && !this.horsTotal(l)
      && !this.enErreur.has(l.lig_id) && this.px.has(l.lig_id));
  }

  /**
   * Coefficient de prorata de la ligne vendue (ligne de prix ; une composante d'ouvrage n'en a pas) : appliqué au prix
   * affiché après les frais annexes, avant la remise.
   */
  prorata(l) { return this.estLigneDePrix(l) && !this.estFraisAnnexes(l) ? coef(l.lig_coef_prorata) : UN; }

  /** PV affiché imposé hors prorata. */
  afficheHorsProrata(l) {
    const k = this.prorata(l);
    return k.eq(UN) ? D(l.lig_pv_affiche) : arr6(D(l.lig_pv_affiche).div(k));
  }

  /**
   * Coefficient de frais annexes de la ligne : celui de sa ligne de prix (une composante suit son ouvrage, sauf en
   * mode bordereau où les frais restent sur l'ouvrage) ; 1 pour les frais eux-mêmes.
   */
  coefFaDe(l) {
    if (this.estFraisAnnexes(l)) return UN;
    let x = l;
    if (!this.estLigneDePrix(l)) {
      if (this.mode === 'B') return UN;
      while (x && !this.estLigneDePrix(x)) x = this.parent(x);
      if (!x) return UN;
    }
    return this.coefsFa.get(x.lig_id) ?? UN;
  }

  /** Montant HT d'une ligne de frais annexes (PV remisé × quantité vendue). */
  montantFraisAnnexes(l) {
    const prec = l.lig_precision_pv ?? 2;
    const pvRem = arrondir(this.pvAffiche(l, this.px.get(l.lig_id), prec).times(coef(l.lig_coef_remise)), prec);
    return arrondir(Dz(l.lig_qte_vendue).times(pvRem), this.precMontant);
  }

  /** Type de prix effectif : le premier type non vendu de la ligne ou de ses ancêtres. */
  typePrixEffectif(l) {
    for (let x = l; x; x = this.parent(x)) if ((x.lig_type_prix ?? 'V') !== 'V') return x.lig_type_prix;
    return 'V';
  }

  /** Tranche F de plus haut niveau contenant la ligne (null : la ligne n'est pas dans une tranche de frais annexes). */
  uniteDe(l) {
    let u = null;
    for (let x = l; x; x = this.parent(x)) if (x.lig_tyl_id === TL.TITRE && (x.lig_type_prix ?? 'V') === 'F') u = x;
    return u && this.estFraisAnnexes(l) ? u : null;
  }

  /** Feuilles chiffrées du sous-arbre d'une ligne de prix (la ligne elle-même si elle n'a pas de composante). */
  feuillesDe(l) {
    const enfants = this.enfantsDe(l.lig_id).filter(estChiffree);
    if (!enfants.length) return [l];
    return enfants.flatMap((c) => this.feuillesDe(c));
  }

  /** Poids d'une feuille : quantité totale × PV (montant avant frais annexes, comme l'onglet Analyse). */
  poidsFeuille(x) {
    const y = this.px.get(x.lig_id);
    return y ? Dz(x.lig_qte_totale).times(y.pv) : ZERO;
  }

  /**
   * Répartit `montant` sur des cibles { w } au prorata des poids (parts égales si tous sont nuls), arrondi au montant ;
   * la cible de plus fort poids (la première à égalité) absorbe l'écart d'arrondi.
   */
  repartirMontant(montant, cibles) {
    if (!cibles.length) return [];
    const W = cibles.reduce((s, c) => s.plus(c.w), ZERO);
    const parts = cibles.map((c) => arrondir(W.isZero() ? montant.div(cibles.length) : montant.times(c.w).div(W), this.precMontant));
    let im = 0;
    for (let i = 1; i < cibles.length; i++) if (cibles[i].w.gt(cibles[im].w)) im = i;
    parts[im] = parts[im].plus(montant.minus(parts.reduce((s, p) => s.plus(p), ZERO)));
    return parts;
  }

  /**
   * Unités de frais annexes : tranches (titres) F de plus haut niveau. Leurs frais sont ventilés sur les lignes de prix
   * de la tranche parente (portée), qui doit être dans une section ; une ligne cumule les parts de toutes ses portées.
   * Clés (ventilation_frais) par priorité : ligne > élément > nature de l'unité > nature globale ; sans aucune clé,
   * prorata du montant hors frais ; avec des clés, le reste n'est pas ventilé (FA_ECART). Lignes à PV affiché fixe
   * exclues ; options / variantes (et pour mémoire) selon ent_fa_lignes, dans la base (ent_fa_mode B) ou au coefficient
   * moyen des lignes vendues de la portée (C).
   */
  ventilerFraisAnnexes() {
    const pm = this.precMontant;
    const horsVente = this.doc.ent_fa_lignes ?? 'V';
    const modeBase = (this.doc.ent_fa_mode ?? 'C') === 'B';
    const parties = new Map(); // lig_id → somme des parts
    const ajouter = (u, l, montant, vfrId) => {
      if (montant.isZero()) return;
      this.ventilationsLignes.push({ vfl_source_lig_id: u.lig_id, vfl_lig_id: l.lig_id, vfl_montant: S(montant), vfl_vfr_id: vfrId });
      parties.set(l.lig_id, (parties.get(l.lig_id) ?? ZERO).plus(montant));
    };
    this.partsFa = parties;

    for (const l of this.ordre) {
      if (estPied(l) && l.lig_pied_is_fa) {
        this.avertir(l.lig_id, 'FA_PIED', 'Frais annexe de pied non ventilé : à remplacer par une tranche de frais annexes');
      }
      if (!estPied(l) && this.estLigneDePrix(l) && this.estFraisAnnexes(l) && !this.uniteDe(l)) {
        this.avertir(l.lig_id, 'FA_HORS_TRANCHE', 'Ligne de frais annexes hors d\'une tranche de frais annexes : non ventilée');
      }
    }

    const unites = this.ordre.filter((l) => l.lig_tyl_id === TL.TITRE && this.uniteDe(l) === l);
    for (const u of unites) {
      const prevu = this.ordre
        .filter((l) => this.estLigneDePrix(l) && this.descendDe(l, u) && !this.enErreur.has(l.lig_id) && this.px.has(l.lig_id))
        .reduce((s, l) => s.plus(this.montantFraisAnnexes(l)), ZERO);
      const portee = this.parent(u);
      const bilan = { lig_id: u.lig_id, portee_id: portee?.lig_id ?? null, prevu, ventile: ZERO, cles: false, receptrices: new Set() };
      this.frais.push(bilan);
      let section = false;
      for (let x = portee; x; x = this.parent(x)) if (x.lig_tyl_id === TL.SECTION) section = true;
      if (!section) {
        this.avertir(u.lig_id, 'FA_HORS_SECTION', 'Tranche de frais annexes hors d\'une section : non ventilée');
        continue;
      }

      // Lignes de prix de la portée : réceptrices R (base), dérivées D (coefficient moyen, mode C) ou exclues X.
      const statut = new Map();
      for (const l of this.ordre) {
        if (estPied(l) || !this.estLigneDePrix(l) || !this.descendDe(l, portee) || this.estFraisAnnexes(l) || l.lig_is_ecart_arrondi
          || this.enErreur.has(l.lig_id) || !this.px.has(l.lig_id)) continue;
        const base = arr6(this.px.get(l.lig_id).pv.times(Dz(l.lig_qte_vendue)));
        const type = this.typePrixEffectif(l);
        const eligible = type === 'V' || ((type === 'O' || type === 'A') && horsVente !== 'V') || (type === 'M' && horsVente === 'OAM');
        const role = !eligible || this.fixe.get(l.lig_id) === 'AFF' || base.lte(0) ? 'X' : type === 'V' || modeBase ? 'R' : 'D';
        statut.set(l.lig_id, { l, base, role });
      }
      const receptrices = [...statut.values()].filter((s) => s.role === 'R');
      bilan.receptrices = new Set(receptrices.map((s) => s.l.lig_id));
      if (!receptrices.length) {
        this.avertir(u.lig_id, 'FA_SANS_RECEPTRICE', 'Aucune ligne pour recevoir les frais annexes de la tranche');
        continue;
      }

      const globale = (k) => k.vfr_source_lig_id === null || k.vfr_source_lig_id === undefined;
      const cles = this.ventilations.filter((k) => k.vfr_source_lig_id === u.lig_id || (globale(k) && k.vfr_cible === 'NATURE'));
      bilan.cles = cles.length > 0;
      const couvertes = new Set();
      if (!bilan.cles) {
        const parts = this.repartirMontant(prevu, receptrices.map((s) => ({ w: s.base })));
        receptrices.forEach((s, i) => ajouter(u, s.l, parts[i], null));
        bilan.ventile = prevu;
      } else {
        // Clés en % : réparties ensemble pour que 100 % fassent exactement le montant prévu.
        const enPct = cles.filter((k) => k.vfr_mode === 'P' && Dz(k.vfr_valeur).gte(0));
        const totalPct = enPct.reduce((s, k) => s.plus(Dz(k.vfr_valeur)), ZERO);
        const montantsPct = new Map();
        const partsPct = this.repartirMontant(arrondir(prevu.times(totalPct).div(100), pm), enPct.map((k) => ({ w: Dz(k.vfr_valeur) })));
        enPct.forEach((k, i) => montantsPct.set(k, partsPct[i]));
        // Clé en montant : par unité de quantité pour une ligne, total pour un élément ou une nature.
        const montantCle = (k, cible) => {
          if (k.vfr_mode === 'P') return montantsPct.get(k) ?? null;
          const v = D(k.vfr_valeur);
          if (v === null || v.lt(0)) return null;
          return arrondir(cible ? v.times(Dz(cible.lig_qte_vendue)) : v, pm);
        };

        // 1. Clés de ligne.
        const niveauLigne = [];
        for (const k of cles.filter((x) => x.vfr_cible === 'LIGNE' && x.vfr_source_lig_id === u.lig_id)) {
          const s = statut.get(k.vfr_lig_id);
          if (!s) { this.avertir(u.lig_id, 'FA_CLE_ORPHELINE', `Clé de ventilation sur une ligne absente de la portée (${k.vfr_lig_id})`); continue; }
          if (s.role === 'X') { this.avertir(u.lig_id, 'FA_CLE_BLOQUEE', `Clé de ventilation sur une ligne qui ne reçoit pas de frais (${k.vfr_lig_id})`); continue; }
          const montant = montantCle(k, s.l);
          if (montant === null) { this.avertir(u.lig_id, 'FA_CLE_ORPHELINE', 'Clé de ventilation de valeur invalide'); continue; }
          niveauLigne.push(s.l.lig_id);
          ajouter(u, s.l, montant, k.vfr_id ?? null);
          if (s.role === 'R') bilan.ventile = bilan.ventile.plus(montant);
        }
        for (const id of niveauLigne) couvertes.add(id);

        // 2. Éléments, 3. natures de l'unité, 4. natures globales : au prorata des feuilles visées des lignes non couvertes.
        const niveaux = [
          cles.filter((x) => x.vfr_cible === 'ELEMENT' && x.vfr_source_lig_id === u.lig_id),
          cles.filter((x) => x.vfr_cible === 'NATURE' && x.vfr_source_lig_id === u.lig_id),
          cles.filter((x) => x.vfr_cible === 'NATURE' && globale(x)),
        ];
        for (const niveau of niveaux) {
          const vues = [];
          for (const k of niveau) {
            const vise = k.vfr_cible === 'ELEMENT'
              ? (x) => x.lig_tyl_id === TL.ELEMENT && !x.lig_is_ecart_arrondi && cleElementVentilation(x, this.sourceLibelle(x)) === k.vfr_element
              : (x) => !x.lig_is_ecart_arrondi && x.lig_nat_id !== null && x.lig_nat_id !== undefined && Number(x.lig_nat_id) === Number(k.vfr_nat_id);
            const cibles = [];
            for (const s of receptrices) {
              if (couvertes.has(s.l.lig_id)) continue;
              const w = this.feuillesDe(s.l).filter(vise).reduce((t, x) => t.plus(this.poidsFeuille(x)), ZERO);
              if (w.gt(0)) cibles.push({ l: s.l, w });
            }
            if (!cibles.length) {
              this.avertir(u.lig_id, 'FA_CLE_ORPHELINE', `Clé de ventilation sans ligne visée (${k.vfr_cible === 'ELEMENT' ? k.vfr_element : `nature ${k.vfr_nat_id}`})`);
              continue;
            }
            const montant = montantCle(k, null);
            if (montant === null) { this.avertir(u.lig_id, 'FA_CLE_ORPHELINE', 'Clé de ventilation de valeur invalide'); continue; }
            const parts = this.repartirMontant(montant, cibles);
            cibles.forEach((c, i) => { ajouter(u, c.l, parts[i], k.vfr_id ?? null); vues.push(c.l.lig_id); });
            bilan.ventile = bilan.ventile.plus(montant);
          }
          for (const id of vues) couvertes.add(id);
        }
        if (!bilan.ventile.eq(prevu)) this.avertir(u.lig_id, 'FA_ECART', `Frais annexes ventilés ${S(bilan.ventile)} pour ${S(prevu)} prévus`);
      }

      // Mode C : options et variantes reçoivent le coefficient moyen des lignes vendues de la portée.
      const baseR = receptrices.reduce((s, x) => s.plus(x.base), ZERO);
      for (const s of statut.values()) {
        if (s.role !== 'D' || couvertes.has(s.l.lig_id) || baseR.isZero()) continue;
        ajouter(u, s.l, arrondir(s.base.times(bilan.ventile).div(baseR), pm), null);
      }
    }

    // Coefficient de chaque ligne qui reçoit des frais : 1 + parts / montant hors frais.
    for (const [id, part] of parties) {
      const l = this.parId.get(id);
      const base = this.px.get(id).pv.times(Dz(l.lig_qte_vendue));
      if (!base.isZero()) this.coefsFa.set(id, arr6(UN.plus(part.div(base))));
    }
  }

  apresPrix() {
    // PV affiché fixe : prix imposé hors frais annexes (la ligne ne reçoit pas de frais).
    for (const l of this.ordre) {
      if (this.fixe.get(l.lig_id) !== 'AFF' || !this.px.has(l.lig_id)) continue;
      const pvFixe = this.afficheHorsProrata(l);
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
    this.ventilerFraisAnnexes();

    // Coefficient moyen du document (information) : lignes vendues.
    let base = ZERO, avec = ZERO;
    for (const l of this.lignesDePrixEnTotal()) {
      const b = this.px.get(l.lig_id).pv.times(Dz(l.lig_qte_vendue));
      base = base.plus(b);
      avec = avec.plus(b).plus(this.partsFa.get(l.lig_id) ?? ZERO);
    }
    this.coefFa = base.isZero() ? UN : arr6(avec.div(base));
  }

  // ---------------------------------------------------------------- montants, totaux, pied

  get champsMontants() {
    return [...super.champsMontants, 'lig_pr', 'lig_pv_affiche', 'lig_montant_pa', 'lig_montant_pr'];
  }

  pvAffiche(l, y, prec) {
    return this.fixe.get(l.lig_id) === 'AFF' ? D(l.lig_pv_affiche) : arrondir(y.pv.times(this.coefFaDe(l)).times(this.prorata(l)), prec);
  }

  ecrireMontants(l, y, montants) {
    super.ecrireMontants(l, y, montants);
    const { pvAff, qv } = montants;
    const pm = this.precMontant;
    l.lig_pa = S(y.pa);
    l.lig_pr = S(y.pr);
    if (y.coefFg) l.lig_coef_fg = S(y.coefFg);
    if (y.coefBenef) l.lig_coef_benef = S(y.coefBenef);
    l.lig_coef_fa = S(this.coefFaDe(l));
    l.lig_pv_affiche = S(pvAff);
    l.lig_montant_pa = S(arrondir(qv.times(y.pa), pm));
    l.lig_montant_pr = S(arrondir(qv.times(y.pr), pm));
    if (this.pvVentiles.has(l.lig_id)) l.lig_pv_fixe = true;
    // Frais réellement ventilés (après arrondi du PV) : montant HT avec frais − montant HT sans frais.
    if (this.partsFa.has(l.lig_id)) {
      const prec = l.lig_precision_pv ?? 2;
      const sans = arrondir(arrondir(y.pv.times(this.prorata(l)), prec).times(coef(l.lig_coef_remise)), prec);
      this.ecartsFaReels.set(l.lig_id, D(l.lig_montant_ht).minus(arrondir(qv.times(sans), pm)));
    }
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
      variables: [...this.variables, ...[...this.variablesScript.values()].flat()],
      scripts: this.scripts,
      lignes_supprimees: [...this.ecartsExistants.values()].map((l) => l.lig_id),
      ventilations: this.ventilations,
      ventilations_lignes: this.ventilationsLignes,
      frais_annexes: this.bilanFrais(),
    };
  }

  /**
   * Bilan par tranche de frais annexes : prévu, ventilé (clés), ventilé réel (montants HT après arrondi du PV, la
   * différence de chaque ligne répartie entre ses tranches au prorata de leurs parts) et écart = prévu − ventilé.
   */
  bilanFrais() {
    const pm = this.precMontant;
    return this.frais.map((b) => {
      let reel = ZERO;
      for (const v of this.ventilationsLignes) {
        if (v.vfl_source_lig_id !== b.lig_id || !b.receptrices.has(v.vfl_lig_id)) continue;
        const total = this.partsFa.get(v.vfl_lig_id);
        const diff = this.ecartsFaReels.get(v.vfl_lig_id);
        if (!total || total.isZero() || !diff) continue;
        reel = reel.plus(diff.times(D(v.vfl_montant)).div(total));
      }
      return {
        lig_id: b.lig_id, portee_id: b.portee_id, cles: b.cles,
        prevu: S(b.prevu), ventile: S(b.ventile), ventile_reel: S(arrondir(reel, pm)), ecart: S(b.prevu.minus(b.ventile)),
      };
    });
  }
}

/** Calcul d'un devis BTP. */
export function calculerDocument(entree) {
  return new MoteurDevisBtp(entree).calculer();
}
