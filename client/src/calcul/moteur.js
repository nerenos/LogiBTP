import { Dec, D, Dz, S, ZERO, UN, coef, arrondir, arr6 } from './decimal.js';
import { evaluerExpression, ErreurCalcul } from './expression.js';
import { analyserReference } from './references.js';
import { Portees } from './portees.js';
import { evaluerMetre } from './metre.js';
import { numeroter } from './numerotation.js';
import { remplacerVariables, texteBrut } from './libelles.js';
import {
  TL, estChiffree, estPied, accepteEnfants,
  COLONNES_DOCUMENT, COLONNES_LIGNE, COLONNES_DECIMALES, COLONNES_PRIX_CALCULES, COLONNES_QTE_CALCULEES,
} from './types.js';

export const VERSION_MOTEUR = '0.1.0';

const parOrdre = (a, b) => ((a.var_ordre ?? 0) - (b.var_ordre ?? 0)) || (a.var_id - b.var_id);
const comparerCodes = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Calcul complet d'un document : fonction pure, sans accès au serveur (section 13).
 * L'entrée n'est pas modifiée ; le résultat contient le document, les lignes (ordre d'affichage),
 * les métrés, les variables, la ventilation de TVA, les erreurs et les avertissements.
 */
export function calculerDocument(entree) {
  return new Moteur(entree).calculer();
}

class Moteur {
  constructor(entree) {
    const e = structuredClone(entree);
    this.doc = e.document ?? {};
    this.options = e.options ?? {};
    this.metres = e.metres ?? [];
    this.metreLignes = e.metre_lignes ?? [];
    this.variables = e.variables ?? [];
    this.tauxTva = new Map((e.taux_tva ?? []).map((t) => [t.ttv_id, t]));
    this.entites = e.entites ?? {};
    this.erreurs = [];
    this.avertissements = [];
    this.precMontant = this.doc.ent_precision_montant ?? 2;
    this.mode = this.doc.ent_mode_calcul_ouvrage ?? 'V';

    const lignes = e.lignes ?? [];
    this.prochainId = Math.min(0, ...lignes.map((l) => Number(l.lig_id))) - 1;
    // Les lignes d'écart d'arrondi sont supprimées puis recréées si nécessaire (section 10).
    this.ecartsExistants = new Map();
    this.ecartsCrees = new Map();
    this.lignes = [];
    for (const l of lignes) {
      if (l.lig_is_ecart_arrondi) this.ecartsExistants.set(l.lig_parent_id, l);
      else this.lignes.push(l);
    }

    this.enErreur = new Set();
    this.traitees = new Set();
    this.qteEnCours = null;
    this.px = new Map();
    this.fixe = new Map();
    this.pvVentiles = new Set();
    this.coefFa = UN;
    this.tva = [];
    this.portees = new Portees(this);
    this.construireArbre();
  }

  // ---------------------------------------------------------------- arbre

  construireArbre() {
    this.parId = new Map(this.lignes.map((l) => [l.lig_id, l]));
    this.enfants = new Map();
    for (const l of this.lignes) {
      const p = l.lig_parent_id ?? null;
      if (!this.enfants.has(p)) this.enfants.set(p, []);
      this.enfants.get(p).push(l);
    }
    for (const liste of this.enfants.values()) this.trier(liste);
    this.reconstruireOrdre();
  }

  trier(liste) {
    liste.sort((a, b) => (a.lig_ordre - b.lig_ordre) || (a.lig_id - b.lig_id));
  }

  reconstruireOrdre() {
    this.ordre = [];
    const vus = new Set();
    const parcourir = (p) => {
      for (const l of this.enfantsDe(p)) {
        if (vus.has(l.lig_id)) continue;
        vus.add(l.lig_id);
        this.ordre.push(l);
        parcourir(l.lig_id);
      }
    };
    parcourir(null);
  }

  enfantsDe(id) {
    return this.enfants.get(id) ?? [];
  }

  parent(l) {
    return l.lig_parent_id === null || l.lig_parent_id === undefined ? null : this.parId.get(l.lig_parent_id) ?? null;
  }

  aUnAncetreOuvrage(l) {
    for (let x = this.parent(l); x; x = this.parent(x)) if (x.lig_tyl_id === TL.OUVRAGE) return true;
    return false;
  }

  /** Ligne chiffrée sans ancêtre Ouvrage : porte la TVA et entre dans les totaux. */
  estLigneDePrix(l) {
    return estChiffree(l) && !this.aUnAncetreOuvrage(l);
  }

  /** Type de prix hérité : Option, Pour mémoire et Variante sont hors total. */
  horsTotal(l, jusqua = null) {
    for (let x = l; x && x !== jusqua; x = this.parent(x)) if ((x.lig_type_prix ?? 'V') !== 'V') return true;
    return false;
  }

  composantes(ouvrage) {
    return this.enfantsDe(ouvrage.lig_id).filter((c) => estChiffree(c) && !c.lig_is_ecart_arrondi);
  }

  estCompose(l) {
    return l.lig_tyl_id === TL.OUVRAGE && this.enfantsDe(l.lig_id).length > 0;
  }

  /** Quantité d'une composante ramenée à l'unité d'ouvrage. */
  qu(c, ouvrage) {
    const qv = Dz(c.lig_qte_vendue);
    if ((c.lig_qte_type ?? 'R') === 'A') {
      const pq = Dz(ouvrage.lig_qte_vendue);
      return pq.isZero() ? ZERO : qv.div(pq);
    }
    return qv;
  }

  erreur(ligId, code, message, bloquante = true) {
    this.erreurs.push({ lig_id: ligId ?? null, code, message });
    if (bloquante && ligId !== null && ligId !== undefined) this.enErreur.add(ligId);
  }

  avertir(ligId, code, message) {
    this.avertissements.push({ lig_id: ligId ?? null, code, message });
  }

  // ---------------------------------------------------------------- références

  resolveur(ligne, phase) {
    return (texte) => {
      const ref = analyserReference(texte);
      if (ref.genre === 'variable') return this.portees.lire(ref.portee, ref.nom, ligne);
      const { valeur } = this.lireDonnee(ref, ligne, phase);
      return this.versDecimal(valeur, texte);
    };
  }

  versDecimal(v, texte) {
    if (v === null || v === undefined) return ZERO;
    if (v instanceof Dec) return v;
    if (typeof v === 'number') return new Dec(v);
    if (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim())) return new Dec(v.trim().replace(',', '.'));
    throw new ErreurCalcul('NON_NUMERIQUE', `{{${texte}}} n'est pas une valeur numérique`);
  }

  lireDonnee(ref, ligne, phase) {
    let entite;
    let colonnes = null;
    if (!ref.table) {
      entite = ligne ?? this.doc;
      colonnes = ligne ? COLONNES_LIGNE : COLONNES_DOCUMENT;
    } else if (ref.table === 'document') {
      entite = this.doc;
      colonnes = COLONNES_DOCUMENT;
    } else if (ref.table === 'document_ligne') {
      colonnes = COLONNES_LIGNE;
      if (ref.id !== null) {
        entite = this.parId.get(Number(ref.id));
        if (!entite) throw new ErreurCalcul('ENTITE_INTROUVABLE', `document_ligne[${ref.id}] introuvable`);
        if (phase === 'calcul' && entite !== ligne && !this.traitees.has(entite.lig_id)) {
          throw new ErreurCalcul('ORDRE', `La ligne ${ref.id} n'est pas encore calculée à ce point du document`);
        }
      } else {
        entite = ligne;
        if (!entite) throw new ErreurCalcul('PORTEE', 'Aucune ligne courante');
      }
    } else {
      entite = this.entiteLiee(ref.table, ref.id, ligne);
    }

    if (colonnes ? !colonnes.has(ref.colonne) : !(ref.colonne in entite)) {
      throw new ErreurCalcul('COLONNE_INCONNUE', `Colonne inconnue ${ref.table ? ref.table + '.' : ''}${ref.colonne}`);
    }
    if (phase === 'calcul' && colonnes) {
      if (COLONNES_PRIX_CALCULES.has(ref.colonne)) {
        throw new ErreurCalcul('PRIX_INTERDIT', `Une formule de quantité ne peut pas lire un prix calculé (${ref.colonne})`);
      }
      if (entite === this.qteEnCours && COLONNES_QTE_CALCULEES.has(ref.colonne)) {
        throw new ErreurCalcul('QTE_NON_CALCULEE', `La quantité de la ligne n'est pas encore calculée (${ref.colonne})`);
      }
    }
    const valeur = entite[ref.colonne];
    return { valeur: colonnes && COLONNES_DECIMALES.has(ref.colonne) ? D(valeur) : valeur, colonne: ref.colonne };
  }

  /** Entité liée par clé étrangère (article de la ligne) ou désignée par son ID (article[1542]). */
  entiteLiee(table, id, ligne) {
    const def = this.entites[table];
    if (!def) throw new ErreurCalcul('TABLE_INCONNUE', `Table inconnue : ${table}`);
    const cleId = `${def.prefixe}_id`;
    let cible = id;
    if (cible === null) {
      const courante = ligne ?? this.doc;
      const pref = ligne ? 'lig' : 'ent';
      const cle = [`${pref}_${def.prefixe}_id`, `${pref}_${table}_id`].find((c) => courante[c] !== null && courante[c] !== undefined);
      if (!cle) throw new ErreurCalcul('LIEN_INCONNU', `Aucun lien vers ${table} depuis l'entité courante`);
      cible = courante[cle];
    }
    const rec = (def.enregistrements ?? []).find((r) => String(r[cleId]) === String(cible));
    if (!rec) throw new ErreurCalcul('ENTITE_INTROUVABLE', `${table}[${cible}] introuvable`);
    return rec;
  }

  // ---------------------------------------------------------------- orchestration

  calculer() {
    this.valider();
    this.passeQuantites();
    this.passePrix();
    this.passeFraisAnnexes();
    this.passeMontants();
    this.passeTotaux();
    this.passePied();
    numeroter(this);
    this.passeLibelles();
    return this.resultat();
  }

  valider() {
    const vus = new Set(this.ordre.map((l) => l.lig_id));
    for (const l of this.lignes) {
      if (!vus.has(l.lig_id)) this.erreur(l.lig_id, 'ARBRE', 'Ligne hors arborescence (parent inconnu ou cycle)');
    }
    for (const l of this.ordre) {
      const p = this.parent(l);
      if (estPied(l) && p) this.erreur(l.lig_id, 'PIED_RACINE', 'Les lignes de pied sont au niveau racine');
      if (p && !accepteEnfants(p)) this.erreur(l.lig_id, 'PARENT_INVALIDE', 'Le type de la ligne parente n\'accepte pas d\'enfants');

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
  }

  // ---------------------------------------------------------------- passe 1 : variables, métrés, quantités

  passeQuantites() {
    for (const v of this.variables) v.var_valeur = null;
    const vars = [...this.variables].sort(parOrdre);
    const parLigne = new Map();
    const parMetre = new Map();
    for (const v of vars) {
      if (v.var_mtr_id !== null && v.var_mtr_id !== undefined) {
        if (!parMetre.has(v.var_mtr_id)) parMetre.set(v.var_mtr_id, []);
        parMetre.get(v.var_mtr_id).push(v);
      } else if (v.var_lig_id !== null && v.var_lig_id !== undefined) {
        if (!parLigne.has(v.var_lig_id)) parLigne.set(v.var_lig_id, []);
        parLigne.get(v.var_lig_id).push(v);
      } else {
        try { this.evaluerVariable(v, null); } catch (e) { this.capturer(e, null); }
      }
    }

    for (const l of this.ordre) {
      if (!estPied(l) && !this.enErreur.has(l.lig_id)) {
        try {
          if (estChiffree(l)) {
            const metre = this.calculerQuantite(l);
            // Variables de l'onglet Définition du métré : sorties du métré, évaluées après ses lignes
            // et après la quantité (elles peuvent lire le résultat, les variables du métré et lig_qte_vendue).
            if (metre) for (const v of parMetre.get(metre.mtr_id) ?? []) this.evaluerVariable(v, l);
          }
          for (const v of parLigne.get(l.lig_id) ?? []) this.evaluerVariable(v, l);
        } catch (e) {
          this.capturer(e, l.lig_id);
        }
      }
      this.traitees.add(l.lig_id);
    }
  }

  capturer(e, ligId) {
    if (!(e instanceof ErreurCalcul)) throw e;
    this.erreur(ligId, e.code, e.message);
  }

  evaluerVariable(v, ligne) {
    const val = evaluerExpression(v.var_formule, this.resolveur(ligne, 'calcul'));
    v.var_valeur = S(this.portees.affecter(v.var_portee, v.var_nom, v.var_operation ?? '=', val, ligne));
  }

  calculerQuantite(l) {
    l.lig_qte_base = null;
    l.lig_qte_vendue = null;
    l.lig_qte_totale = null;
    const metre = l.lig_mtr_id !== null && l.lig_mtr_id !== undefined ? this.metres.find((m) => m.mtr_id === l.lig_mtr_id) : null;
    let base;
    this.qteEnCours = l;
    try {
      if (metre) evaluerMetre(this, metre, l);
      if ((l.lig_qte_source ?? 'S') === 'M') {
        if (!metre) throw new ErreurCalcul('METRE_ABSENT', 'La quantité est issue d\'un métré absent');
        base = D(metre.mtr_resultat);
      } else {
        base = Dz(l.lig_qte);
      }
    } finally {
      this.qteEnCours = null;
    }

    const qv = arrondir(base.times(coef(l.lig_coef_perte)), l.lig_precision_qte ?? 2);
    const p = this.parent(l);
    let totale = qv;
    if (p && estChiffree(p)) {
      const pqv = Dz(p.lig_qte_vendue);
      const pqt = Dz(p.lig_qte_totale);
      if ((l.lig_qte_type ?? 'R') === 'A') totale = pqv.isZero() ? ZERO : qv.times(pqt).div(pqv);
      else totale = qv.times(pqt);
    }
    l.lig_qte_base = S(arr6(base));
    l.lig_qte_vendue = S(qv);
    l.lig_qte_totale = S(arr6(totale));
    return metre;
  }

  // ---------------------------------------------------------------- passes 2 et 3 : prix, PV fixes

  passePrix() {
    const recursif = (l) => {
      for (const c of this.enfantsDe(l.lig_id)) recursif(c);
      if (!estChiffree(l) || this.enErreur.has(l.lig_id)) return;
      this.prixLigne(l);
    };
    for (const l of this.enfantsDe(null)) recursif(l);
  }

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
      lig_coef_fa: '1', lig_pv_affiche: null, lig_coef_remise: '1', lig_pv_remise: null,
      lig_precision_pv: 6,
      lig_pv_fixe: false,
      lig_pv_affiche_fixe: false,
      lig_type_prix: ouvrage.lig_type_prix ?? 'V',
      lig_variante_de_id: null,
      lig_is_ecart_arrondi: true,
      lig_st_depuis_id: null,
      lig_montant_pa: null, lig_montant_pr: null, lig_montant_ht: null,
      lig_pied_mode: null, lig_pied_base: null, lig_pied_sens: null, lig_pied_valeur: null, lig_pied_is_fa: false,
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

  // ---------------------------------------------------------------- passe 4 : coefficient de frais annexes

  lignesDePrixEnTotal() {
    return this.ordre.filter((l) => !estPied(l) && this.estLigneDePrix(l) && !this.horsTotal(l)
      && !this.enErreur.has(l.lig_id) && this.px.has(l.lig_id));
  }

  passeFraisAnnexes() {
    let F = ZERO, A = ZERO, P = ZERO;
    for (const l of this.lignesDePrixEnTotal()) {
      const qv = Dz(l.lig_qte_vendue);
      if (this.fixe.get(l.lig_id) === 'AFF') A = A.plus(D(l.lig_pv_affiche).times(qv));
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
      const pvFixe = arr6(D(l.lig_pv_affiche).div(c));
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

  // ---------------------------------------------------------------- passe 5 : PV affiché, remise, montants

  passeMontants() {
    const pm = this.precMontant;
    for (const l of this.ordre) {
      if (!estChiffree(l)) continue;
      const y = this.px.get(l.lig_id);
      if (!y || this.enErreur.has(l.lig_id)) {
        for (const k of ['lig_pr', 'lig_pv_affiche', 'lig_pv_remise', 'lig_montant_pa', 'lig_montant_pr', 'lig_montant_ht']) l[k] = null;
        continue;
      }
      const prec = l.lig_precision_pv ?? 2;
      const pvAff = this.fixe.get(l.lig_id) === 'AFF' ? D(l.lig_pv_affiche) : arrondir(y.pv.times(this.coefFa), prec);
      const pvRem = arrondir(pvAff.times(coef(l.lig_coef_remise)), prec);
      const qv = Dz(l.lig_qte_vendue);
      l.lig_pa = S(y.pa);
      l.lig_pr = S(y.pr);
      l.lig_pv = S(y.pv);
      if (y.coefFg) l.lig_coef_fg = S(y.coefFg);
      if (y.coefBenef) l.lig_coef_benef = S(y.coefBenef);
      l.lig_coef_fa = S(this.coefFa);
      l.lig_pv_affiche = S(pvAff);
      l.lig_pv_remise = S(pvRem);
      l.lig_montant_pa = S(arrondir(qv.times(y.pa), pm));
      l.lig_montant_pr = S(arrondir(qv.times(y.pr), pm));
      l.lig_montant_ht = S(arrondir(qv.times(pvRem), pm));
      if (this.pvVentiles.has(l.lig_id)) l.lig_pv_fixe = true;
    }
  }

  // ---------------------------------------------------------------- passe 6 : sous-totaux et titres

  passeTotaux() {
    const corps = this.ordre.filter((l) => !estPied(l));
    const enTotal = (l) => this.estLigneDePrix(l) && !this.horsTotal(l) && !this.enErreur.has(l.lig_id) && l.lig_montant_ht !== null;
    const somme = (lignes) => {
      let ht = ZERO, pa = ZERO, pr = ZERO;
      for (const l of lignes) { ht = ht.plus(D(l.lig_montant_ht)); pa = pa.plus(Dz(l.lig_montant_pa)); pr = pr.plus(Dz(l.lig_montant_pr)); }
      return { ht, pa, pr };
    };
    const ecrire = (l, s) => { l.lig_montant_ht = S(s.ht); l.lig_montant_pa = S(s.pa); l.lig_montant_pr = S(s.pr); };

    corps.forEach((l, i) => {
      if (l.lig_tyl_id === TL.TITRE) {
        const desc = [];
        for (let j = i + 1; j < corps.length && this.descendDe(corps[j], l); j++) desc.push(corps[j]);
        ecrire(l, somme(desc.filter((x) => this.estLigneDePrix(x) && !this.horsTotal(x, l) && !this.enErreur.has(x.lig_id) && x.lig_montant_ht !== null)));
      } else if (l.lig_tyl_id === TL.SOUS_TOTAL) {
        let debut = 0;
        if (l.lig_st_depuis_id !== null && l.lig_st_depuis_id !== undefined) {
          const j = corps.findIndex((x) => x.lig_id === l.lig_st_depuis_id);
          if (j < 0 || j >= i || corps[j].lig_tyl_id !== TL.SOUS_TOTAL) {
            this.erreur(l.lig_id, 'SOUS_TOTAL_POINTE', 'Le sous-total pointé doit être un sous-total précédent');
            ecrire(l, { ht: ZERO, pa: ZERO, pr: ZERO });
            return;
          }
          debut = j + 1;
        }
        ecrire(l, somme(corps.slice(debut, i).filter(enTotal)));
      }
    });
    this.totalCorps = somme(corps.filter(enTotal)).ht;
  }

  descendDe(l, ancetre) {
    for (let x = this.parent(l); x; x = this.parent(x)) if (x === ancetre) return true;
    return false;
  }

  // ---------------------------------------------------------------- passe 7 : lignes de pied et TVA

  infoTaux(id, tauxLigne) {
    const t = this.tauxTva.get(id);
    return {
      ttv_id: id,
      code: t?.ttv_code ?? String(id),
      taux: D(tauxLigne) ?? D(t?.ttv_taux) ?? ZERO,
      categorie: t?.ttv_categorie ?? 'N',
      mention: t?.ttv_mention ?? null,
      base: ZERO,
    };
  }

  passePied() {
    const pm = this.precMontant;
    const bases = new Map();

    for (const l of this.ordre) {
      if (estPied(l) || !estChiffree(l)) continue;
      if (!this.estLigneDePrix(l)) {
        l.lig_tva_id = null;
        l.lig_taux_tva = null;
        continue;
      }
      if (l.lig_tva_id !== null && l.lig_tva_id !== undefined && D(l.lig_taux_tva) === null) {
        const t = this.tauxTva.get(l.lig_tva_id);
        if (t) l.lig_taux_tva = S(D(t.ttv_taux));
      }
      if (this.horsTotal(l) || this.enErreur.has(l.lig_id) || l.lig_montant_ht === null) continue;
      if (l.lig_tva_id === null || l.lig_tva_id === undefined) {
        this.erreur(l.lig_id, 'TVA_MANQUANTE', 'Taux de TVA manquant sur une ligne de prix', false);
        continue;
      }
      if (!bases.has(l.lig_tva_id)) bases.set(l.lig_tva_id, this.infoTaux(l.lig_tva_id, l.lig_taux_tva));
      const e = bases.get(l.lig_tva_id);
      e.base = e.base.plus(D(l.lig_montant_ht));
    }

    const totalHT = this.totalCorps;
    const totalTTC = totalHT.plus(this.calculerTva(bases).net);
    let cumul = totalHT;
    let tva = null;

    for (const p of this.enfantsDe(null)) {
      if (!estPied(p)) continue;
      p.lig_base_calcul = null;
      p.lig_montant_tva = null;
      if (p.lig_tyl_id === TL.TVA) {
        p.lig_montant_ht = null;
        if (tva) { this.erreur(p.lig_id, 'TVA_DOUBLE', 'Une seule ligne de ventilation TVA par document', false); continue; }
        tva = this.calculerTva(bases);
        p.lig_base_calcul = S(tva.base);
        p.lig_montant_tva = S(tva.net);
        cumul = cumul.plus(tva.net);
        continue;
      }
      const codeBase = p.lig_pied_base ?? 'CUMUL';
      const base = codeBase === 'TOTAL_HT' ? totalHT : codeBase === 'TOTAL_TTC' ? totalTTC : cumul;
      const sens = p.lig_pied_sens === -1 ? -1 : 1;
      const pourcentage = (p.lig_pied_mode ?? 'M') === 'P';
      const montant = (pourcentage ? arrondir(base.times(Dz(p.lig_pied_valeur)).div(100), pm) : arrondir(Dz(p.lig_pied_valeur), pm)).times(sens);
      p.lig_base_calcul = pourcentage ? S(base) : null;
      p.lig_montant_ht = S(montant);
      // Frais annexe déjà ventilé dans les prix, ou poste pour mémoire : affiché, hors cumul.
      if (p.lig_pied_is_fa || (p.lig_type_prix ?? 'V') !== 'V') continue;
      cumul = cumul.plus(montant);
      if (p.lig_tyl_id === TL.PIED_HT && !tva) this.repartirSurBases(bases, montant, p);
    }
    if (!tva) {
      tva = this.calculerTva(bases);
      cumul = cumul.plus(tva.net);
    }

    this.tva = tva.lignes;
    this.doc.ent_coef_fa = S(this.coefFa);
    this.doc.ent_total_ht = S(tva.base);
    this.doc.ent_total_tva = S(tva.net);
    this.doc.ent_total_ttc = S(tva.base.plus(tva.net));
    this.doc.ent_net_a_payer = S(cumul);
    this.doc.ent_version_calcul = VERSION_MOTEUR;
  }

  repartirSurBases(bases, montant, p) {
    if (p.lig_tva_id !== null && p.lig_tva_id !== undefined) {
      if (!bases.has(p.lig_tva_id)) bases.set(p.lig_tva_id, this.infoTaux(p.lig_tva_id, null));
      const e = bases.get(p.lig_tva_id);
      e.base = e.base.plus(montant);
      return;
    }
    const entrees = [...bases.values()].sort((a, b) => comparerCodes(a.code, b.code));
    if (entrees.length === 0) {
      this.erreur(p.lig_id, 'TVA_REPARTITION', 'Aucune base de TVA sur laquelle répartir le poste', false);
      return;
    }
    const total = entrees.reduce((s, e) => s.plus(e.base), ZERO);
    if (total.isZero()) {
      entrees[0].base = entrees[0].base.plus(montant);
      return;
    }
    let reste = montant;
    for (let i = 0; i < entrees.length - 1; i++) {
      const part = arrondir(montant.times(entrees[i].base).div(total), this.precMontant);
      entrees[i].base = entrees[i].base.plus(part);
      reste = reste.minus(part);
    }
    const der = entrees[entrees.length - 1];
    der.base = der.base.plus(reste);
  }

  /** Ventilation par taux selon la catégorie : Normale, Autoliquidation, Intracommunautaire, Exonérée. */
  calculerTva(bases) {
    const pm = this.precMontant;
    let base = ZERO, net = ZERO;
    const lignes = [...bases.values()].sort((a, b) => comparerCodes(a.code, b.code)).map((e) => {
      const b = arrondir(e.base, pm);
      const calcule = arrondir(b.times(e.taux).div(100), pm);
      let montant = calcule, annulation = ZERO;
      if (e.categorie === 'A') montant = ZERO;
      else if (e.categorie === 'I') annulation = calcule.neg();
      const n = montant.plus(annulation);
      base = base.plus(b);
      net = net.plus(n);
      return {
        tva_ttv_id: e.ttv_id,
        tva_code: e.code,
        tva_taux: S(e.taux),
        tva_categorie: e.categorie,
        tva_base_ht: S(b),
        tva_montant: S(montant),
        tva_montant_annulation: S(annulation),
        tva_montant_net: S(n),
        tva_mention: e.mention,
      };
    });
    return { lignes, base, net };
  }

  // ---------------------------------------------------------------- passe 8 : libellés

  passeLibelles() {
    if (this.options.libelles_figes) return;
    for (const l of this.ordre) {
      const resoudre = (texte) => {
        const ref = analyserReference(texte);
        if (ref.genre === 'variable') return { valeur: this.portees.lire(ref.portee, ref.nom, l), colonne: null };
        return this.lireDonnee(ref, l, 'libelle');
      };
      const { texte, inconnues } = remplacerVariables(l.lig_libelle_html, resoudre);
      for (const i of inconnues) this.avertir(l.lig_id, 'VARIABLE_LIBELLE', `Libellé : ${i.message}`);
      l.lig_libelle_affiche = texte;
      l.lig_libelle_brut = texteBrut(texte);
    }
  }

  // ---------------------------------------------------------------- résultat

  resultat() {
    const supprimees = [...this.ecartsExistants.values()].map((l) => l.lig_id);
    return {
      version_moteur: VERSION_MOTEUR,
      document: this.doc,
      lignes: this.ordre,
      metres: this.metres,
      metre_lignes: this.metreLignes,
      variables: this.variables,
      tva: this.tva,
      lignes_supprimees: supprimees,
      erreurs: this.erreurs,
      avertissements: this.avertissements,
    };
  }
}
