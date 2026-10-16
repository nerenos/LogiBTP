import {
  Dec, D, Dz, S, ZERO, coef, arrondir, arr6,
  ErreurCalcul, analyserReference, remplacerVariables, texteBrut,
} from '@logibtp/socle';
import { numeroter } from './numerotation.js';
import {
  TL, estChiffree, estPied, estTypeNumerote, accepteEnfants, estTranche,
  COLONNES_DOCUMENT, COLONNES_LIGNE, COLONNES_DECIMALES, COLONNES_DATES, COLONNES_PRIX_CALCULES, COLONNES_QTE_CALCULEES,
} from './types.js';

export const VERSION_MOTEUR = '0.1.0';

const comparerCodes = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Lettres accentuées et ligatures (table explicite, identique dans MoteurDocument.cs : le C# tourne sans données de
// globalisation, sans décomposition Unicode).
const SANS_ACCENT = { 'À': 'a', 'Á': 'a', 'Â': 'a', 'Ã': 'a', 'Ä': 'a', 'Å': 'a', 'Æ': 'ae', 'Ç': 'c', 'È': 'e', 'É': 'e', 'Ê': 'e', 'Ë': 'e', 'Ì': 'i', 'Í': 'i', 'Î': 'i', 'Ï': 'i', 'Ñ': 'n', 'Ò': 'o', 'Ó': 'o', 'Ô': 'o', 'Õ': 'o', 'Ö': 'o', 'Ø': 'o', 'Ù': 'u', 'Ú': 'u', 'Û': 'u', 'Ü': 'u', 'Ý': 'y', 'ß': 'ss', 'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'æ': 'ae', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ÿ': 'y', 'Ā': 'a', 'ā': 'a', 'Ć': 'c', 'ć': 'c', 'Č': 'c', 'č': 'c', 'Ď': 'd', 'ď': 'd', 'Đ': 'd', 'đ': 'd', 'Ē': 'e', 'ē': 'e', 'Ė': 'e', 'ė': 'e', 'Ę': 'e', 'ę': 'e', 'Ě': 'e', 'ě': 'e', 'Ī': 'i', 'ī': 'i', 'Į': 'i', 'į': 'i', 'Ł': 'l', 'ł': 'l', 'Ń': 'n', 'ń': 'n', 'Ň': 'n', 'ň': 'n', 'Ō': 'o', 'ō': 'o', 'Œ': 'oe', 'œ': 'oe', 'Ř': 'r', 'ř': 'r', 'Ś': 's', 'ś': 's', 'Ş': 's', 'ş': 's', 'Š': 's', 'š': 's', 'Ū': 'u', 'ū': 'u', 'Ů': 'u', 'ů': 'u', 'Ű': 'u', 'ű': 'u', 'Ÿ': 'y', 'Ź': 'z', 'ź': 'z', 'Ż': 'z', 'ż': 'z', 'Ž': 'z', 'ž': 'z' };

/** Libellé comparé pour regrouper les lignes des pieds de section : sans accents ni casse, espaces réduits. */
export const normaliserLibelle = (texte) => String(texte ?? '').replace(/[^\x00-\x7f]/g, (c) => SANS_ACCENT[c] ?? c)
  .toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Moteur de calcul d'un document commercial générique (classe mère du module Document).
 * Fonction pure : l'entrée n'est pas modifiée, aucun accès au serveur.
 *
 * Méthode patron : `calculer()` enchaîne des étapes que le cœur ou un autre module redéfinit
 * (valider/validerLigne, avantQuantites/quantiteBase/quantiteVendue/apresLigne, prixLigne, apresPrix,
 * pvAffiche/ecrireMontants, champsCumules, horsCumulPied, ecrireTotaux, lireVariable, completerResultat…).
 *
 * Comportement générique : PV saisi (lig_pv), remise, ligne composée = somme de ses composantes
 * (quantités relatives ou absolues), sous-totaux, titres, lignes de pied séquentielles, TVA par catégorie,
 * numérotation et libellés avec variables de données. Réplique exacte de MoteurDocument (C#).
 */
export class MoteurDocument {
  constructor(entree) {
    const e = structuredClone(entree);
    this.entree = e;
    this.doc = e.document ?? {};
    this.options = e.options ?? {};
    this.tauxTva = new Map((e.taux_tva ?? []).map((t) => [t.ttv_id, t]));
    this.entites = e.entites ?? {};
    this.erreurs = [];
    this.avertissements = [];
    this.precMontant = this.doc.ent_precision_montant ?? 2;
    this.enErreur = new Set();
    this.traitees = new Set();
    this.qteEnCours = null;
    this.px = new Map();
    this.tva = [];
    this.pied = [];
    this.lignes = this.preparerLignes(e.lignes ?? []);
    this.construireArbre();
  }

  /** Lignes retenues pour le calcul (point de spécialisation : lignes calculées à recréer…). */
  preparerLignes(lignes) {
    return [...lignes];
  }

  // ---------------------------------------------------------------- colonnes (spécialisables)

  get colonnesDocument() { return COLONNES_DOCUMENT; }
  get colonnesLigne() { return COLONNES_LIGNE; }
  get colonnesDecimales() { return COLONNES_DECIMALES; }
  get colonnesDates() { return COLONNES_DATES; }
  get colonnesPrixCalcules() { return COLONNES_PRIX_CALCULES; }
  get colonnesQteCalculees() { return COLONNES_QTE_CALCULEES; }

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

  /** Ligne chiffrée sans ancêtre composé : porte la TVA et entre dans les totaux. */
  estLigneDePrix(l) {
    return estChiffree(l) && !this.aUnAncetreOuvrage(l);
  }

  /** Type de prix hérité : Option, Pour mémoire, Variante et Frais annexes sont hors total. */
  horsTotal(l, jusqua = null) {
    for (let x = l; x && x !== jusqua; x = this.parent(x)) if ((x.lig_type_prix ?? 'V') !== 'V') return true;
    return false;
  }

  /** Frais annexes (type F, hérité) : hors total, jamais imprimé ; ventilés sur les autres lignes en spécialisation. */
  estFraisAnnexes(l) {
    let f = false;
    for (let x = l; x; x = this.parent(x)) {
      const t = x.lig_type_prix ?? 'V';
      if (t === 'F') f = true;
      else if (t !== 'V') return false;
    }
    return f;
  }

  composantes(compose) {
    return this.enfantsDe(compose.lig_id).filter(estChiffree);
  }

  estCompose(l) {
    return l.lig_tyl_id === TL.OUVRAGE && this.enfantsDe(l.lig_id).length > 0;
  }

  /** Ligne numérotée (Titre, Ouvrage, Élément) ; spécialisable pour exclure des lignes calculées. */
  /** Les frais annexes (tranche F et son contenu) ne sont jamais édités : pas de numéro. */
  estNumerotee(l) {
    return estTypeNumerote(l) && !this.estFraisAnnexes(l);
  }

  /** Quantité d'une composante ramenée à l'unité du composé. */
  qu(c, compose) {
    const qv = Dz(c.lig_qte_vendue);
    if ((c.lig_qte_type ?? 'R') === 'A') {
      const pq = Dz(compose.lig_qte_vendue);
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

  capturer(e, ligId) {
    if (!(e instanceof ErreurCalcul)) throw e;
    this.erreur(ligId, e.code, e.message);
  }

  // ---------------------------------------------------------------- références

  /** Variable de calcul {{$$x}}, {{@x}}… : le document générique n'en définit pas (module Métré). */
  lireVariable(portee, nom) {
    throw new ErreurCalcul('VARIABLE_INCONNUE', `Variable {{${portee}${nom}}} non définie à ce point du document`);
  }

  resolveur(ligne, phase) {
    return (texte) => {
      const ref = analyserReference(texte);
      if (ref.genre === 'variable') return this.lireVariable(ref.portee, ref.nom, ligne);
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
      colonnes = ligne ? this.colonnesLigne : this.colonnesDocument;
    } else if (ref.table === 'document') {
      entite = this.doc;
      colonnes = this.colonnesDocument;
    } else if (ref.table === 'document_ligne') {
      colonnes = this.colonnesLigne;
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
      if (this.colonnesPrixCalcules.has(ref.colonne)) {
        throw new ErreurCalcul('PRIX_INTERDIT', `Une formule de quantité ne peut pas lire un prix calculé (${ref.colonne})`);
      }
      if (entite === this.qteEnCours && this.colonnesQteCalculees.has(ref.colonne)) {
        throw new ErreurCalcul('QTE_NON_CALCULEE', `La quantité de la ligne n'est pas encore calculée (${ref.colonne})`);
      }
    }
    const valeur = entite[ref.colonne];
    return { valeur: colonnes && this.colonnesDecimales.has(ref.colonne) ? D(valeur) : valeur, colonne: ref.colonne };
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

  // ---------------------------------------------------------------- orchestration (méthode patron)

  calculer() {
    this.valider();
    this.passeQuantites();
    this.passePrix();
    this.apresPrix();
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
      if (estPied(l) && p && !this.estSectionRacine(p)) this.erreur(l.lig_id, 'PIED_RACINE', 'Les lignes de pied sont au niveau racine ou dans une section');
      if (p && !accepteEnfants(p)) this.erreur(l.lig_id, 'PARENT_INVALIDE', 'Le type de la ligne parente n\'accepte pas d\'enfants');
      if (l.lig_tyl_id === TL.SECTION && p) this.erreur(l.lig_id, 'SECTION_RACINE', 'Une section est au niveau racine');
      if (this.estFraisAnnexes(l)) l.lig_is_non_editee = true;
      this.validerLigne(l);
    }
  }

  /** Contrôles propres à une spécialisation (blocages de prix…). */
  validerLigne() {}

  // ---------------------------------------------------------------- passe 1 : quantités

  // ---------------------------------------------------------------- avancement (situations, factures d'avancement)

  /**
   * Avancement d'une ligne de prix (CONCEPTION-ACHATS-MARCHES.md, Q24) : saisi en % (P), en quantité (Q) ou en montant
   * (M) cumulés ; la référence est le montant cumulé (le % pour une ligne sans prix), les deux autres valeurs en sont
   * déduites avec le montant et la quantité de la ligne du marché (lig_avt_montant_marche, lig_avt_qte_marche).
   * Présentation du document (ent_avt_presentation) : C cumul (situation : quantité et montant cumulés), P période
   * (facture d'avancement : cumul − précédent). Dépassement du marché refusé sauf option (LIGNE_DEPASSEE).
   * Renvoie null pour une ligne sans avancement.
   */
  avancement(l) {
    if (this.avancements.has(l.lig_id)) return this.avancements.get(l.lig_id);
    const mode = l.lig_avt_mode;
    if (!mode || !this.doc.ent_avt_presentation || !this.estLigneDePrix(l)) { this.avancements.set(l.lig_id, null); return null; }
    const pm = this.precMontant;
    const pq = l.lig_precision_qte ?? 2;
    const mc = Dz(l.lig_avt_montant_marche);
    const qc = Dz(l.lig_avt_qte_marche);
    const v = Dz(l.lig_avt_valeur);
    let m;
    let pct;
    let q;
    if (mode === 'M') m = arrondir(v, pm);
    else if (mode === 'Q') m = qc.isZero() ? ZERO : arrondir(mc.times(v).div(qc), pm);
    else m = arrondir(mc.times(v).div(100), pm);
    if (!mc.isZero()) pct = arr6(m.div(mc).times(100));
    else if (mode === 'P') pct = arr6(v);
    else if (mode === 'Q') pct = qc.isZero() ? ZERO : arr6(v.div(qc).times(100));
    else pct = ZERO;
    if (mode === 'Q') q = arrondir(v, pq);
    else if (!mc.isZero()) q = arrondir(qc.times(m).div(mc), pq);
    else q = arrondir(qc.times(pct).div(100), pq);
    const depasse = mc.isZero() ? pct.gt(100) : m.abs().gt(mc.abs());
    if (depasse && !this.doc.ent_avt_depassement) {
      this.erreur(l.lig_id, 'LIGNE_DEPASSEE', 'Avancement au-delà du montant du marché pour cette ligne', false);
    }
    l.lig_avt_montant_cumul = S(m);
    l.lig_avt_pct = S(pct);
    l.lig_avt_qte_cumul = S(q);
    const periode = this.doc.ent_avt_presentation === 'P';
    const a = {
      montant: periode ? m.minus(Dz(l.lig_avt_montant_precedent)) : m,
      qte: periode ? q.minus(Dz(l.lig_avt_qte_precedent)) : q,
    };
    this.avancements.set(l.lig_id, a);
    return a;
  }

  passeQuantites() {
    this.avancements = new Map();
    this.avantQuantites();
    for (const l of this.ordre) {
      if (!estPied(l) && !this.enErreur.has(l.lig_id)) {
        try {
          if (estChiffree(l)) this.calculerQuantite(l);
          this.apresLigne(l);
        } catch (e) {
          this.capturer(e, l.lig_id);
        }
      }
      this.traitees.add(l.lig_id);
    }
  }

  /** Avant la première ligne (variables du document…). */
  avantQuantites() {}

  /** Après la quantité de chaque ligne hors pied, dans l'ordre du document (variables de ligne…). */
  apresLigne() {}

  calculerQuantite(l) {
    l.lig_qte_vendue = null;
    l.lig_qte_totale = null;
    const base = this.quantiteBase(l);
    // Avancement : quantité cumulée (situation) ou de la période (facture d'avancement).
    const qv = this.avancement(l)?.qte ?? this.quantiteVendue(l, base);
    const p = this.parent(l);
    let totale = qv;
    if (p && estChiffree(p)) {
      const pqv = Dz(p.lig_qte_vendue);
      const pqt = Dz(p.lig_qte_totale);
      if ((l.lig_qte_type ?? 'R') === 'A') totale = pqv.isZero() ? ZERO : qv.times(pqt).div(pqv);
      else totale = qv.times(pqt);
    }
    this.ecrireQuantites(l, base, qv, totale);
  }

  /** Quantité de départ : la saisie (un métré, une formule… en spécialisation). */
  quantiteBase(l) {
    return Dz(l.lig_qte);
  }

  /** Quantité vendue arrondie à la précision de la ligne (coefficient de perte… en spécialisation). */
  quantiteVendue(l, base) {
    return arrondir(base, l.lig_precision_qte ?? 2);
  }

  ecrireQuantites(l, base, qv, totale) {
    l.lig_qte_vendue = S(qv);
    l.lig_qte_totale = S(arr6(totale));
  }

  // ---------------------------------------------------------------- passe 2 : prix

  passePrix() {
    const recursif = (l) => {
      for (const c of this.enfantsDe(l.lig_id)) recursif(c);
      if (!estChiffree(l) || this.enErreur.has(l.lig_id)) return;
      this.prixLigne(l);
    };
    for (const l of this.enfantsDe(null)) recursif(l);
  }

  /** Prix unitaire : PV saisi, ou somme des composantes d'une ligne composée. Renseigne this.px. */
  prixLigne(l) {
    if (!this.estCompose(l)) {
      this.px.set(l.lig_id, { pv: Dz(l.lig_pv) });
      return;
    }
    let pv = ZERO;
    for (const c of this.composantes(l)) {
      const x = this.px.get(c.lig_id);
      if (x) pv = pv.plus(this.qu(c, l).times(x.pv));
    }
    this.px.set(l.lig_id, { pv: arr6(pv) });
  }

  /** Après le calcul des prix (frais annexes, ventilations… en spécialisation). */
  apresPrix() {}

  // ---------------------------------------------------------------- passe 3 : remise et montants

  get champsMontants() {
    return ['lig_pv_remise', 'lig_montant_ht'];
  }

  passeMontants() {
    for (const l of this.ordre) {
      if (!estChiffree(l)) continue;
      const y = this.px.get(l.lig_id);
      if (!y || this.enErreur.has(l.lig_id)) {
        for (const k of this.champsMontants) l[k] = null;
        continue;
      }
      const prec = l.lig_precision_pv ?? 2;
      const pvAff = this.pvAffiche(l, y, prec);
      const pvRem = arrondir(pvAff.times(coef(l.lig_coef_remise)), prec);
      this.ecrireMontants(l, y, { pvAff, pvRem, qv: Dz(l.lig_qte_vendue) });
      // Avancement : le montant est le cumul (situation) ou la période (facture), pas quantité × prix.
      const a = this.avancement(l);
      if (a) l.lig_montant_ht = S(a.montant);
    }
  }

  /** PV avant remise, arrondi à la précision PV (frais annexes… en spécialisation). */
  pvAffiche(l, y, prec) {
    return arrondir(y.pv, prec);
  }

  ecrireMontants(l, y, { pvRem, qv }) {
    l.lig_pv = S(y.pv);
    l.lig_pv_remise = S(pvRem);
    l.lig_montant_ht = S(arrondir(qv.times(pvRem), this.precMontant));
  }

  // ---------------------------------------------------------------- passe 4 : sous-totaux et titres

  /** Montants cumulés par les titres et les sous-totaux (le premier est le montant HT). */
  get champsCumules() {
    return ['lig_montant_ht'];
  }

  /** Section à la racine : elle peut porter son propre pied (document à plusieurs sources). */
  estSectionRacine(l) {
    return l?.lig_tyl_id === TL.SECTION && !this.parent(l);
  }

  /**
   * Sous-total de pied : sous-total placé après une ligne de pied, à la racine ou dans une section à la racine ; il
   * vaut le cumul du pied à ce point et peut servir de base de calcul (lig_pied_base = LIGNE).
   */
  estSousTotalPied(l) {
    if (l.lig_tyl_id !== TL.SOUS_TOTAL) return false;
    const p = this.parent(l);
    if (p && !this.estSectionRacine(p)) return false;
    for (const x of this.enfantsDe(p ? p.lig_id : null)) {
      if (x === l) return false;
      if (estPied(x)) return true;
    }
    return false;
  }

  passeTotaux() {
    const corps = this.ordre.filter((l) => !estPied(l) && !this.estSousTotalPied(l));
    const champs = this.champsCumules;
    const enTotal = (l) => this.estLigneDePrix(l) && !this.horsTotal(l) && !this.enErreur.has(l.lig_id) && l.lig_montant_ht !== null;
    const somme = (lignes) => {
      const s = Object.fromEntries(champs.map((c) => [c, ZERO]));
      for (const l of lignes) for (const c of champs) s[c] = s[c].plus(c === 'lig_montant_ht' ? D(l[c]) : Dz(l[c]));
      return s;
    };
    const ecrire = (l, s) => { for (const c of champs) l[c] = S(s[c]); };

    corps.forEach((l, i) => {
      if (estTranche(l)) {
        const desc = [];
        for (let j = i + 1; j < corps.length && this.descendDe(corps[j], l); j++) desc.push(corps[j]);
        // Tranche de frais annexes : montant de ses frais (hors total du document).
        const fa = this.estFraisAnnexes(l);
        ecrire(l, somme(desc.filter((x) => this.estLigneDePrix(x) && (fa ? this.estFraisAnnexes(x) : !this.horsTotal(x, l))
          && !this.enErreur.has(x.lig_id) && x.lig_montant_ht !== null)));
      } else if (l.lig_tyl_id === TL.SOUS_TOTAL) {
        let debut = 0;
        if (l.lig_st_depuis_id !== null && l.lig_st_depuis_id !== undefined) {
          const j = corps.findIndex((x) => x.lig_id === l.lig_st_depuis_id);
          if (j < 0 || j >= i || corps[j].lig_tyl_id !== TL.SOUS_TOTAL) {
            this.erreur(l.lig_id, 'SOUS_TOTAL_POINTE', 'Le sous-total pointé doit être un sous-total précédent');
            ecrire(l, somme([]));
            return;
          }
          debut = j + 1;
        }
        ecrire(l, somme(corps.slice(debut, i).filter(enTotal)));
      }
    });
    this.totalCorps = somme(corps.filter(enTotal)).lig_montant_ht;
  }

  descendDe(l, ancetre) {
    for (let x = this.parent(l); x; x = this.parent(x)) if (x === ancetre) return true;
    return false;
  }

  // ---------------------------------------------------------------- passe 5 : lignes de pied et TVA

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

  /** Poste affiché mais hors du net à payer (pour mémoire ; frais annexes ventilés en spécialisation). */
  horsCumulPied(p) {
    return (p.lig_type_prix ?? 'V') !== 'V';
  }

  /**
   * Pied du document. Sans pied de section : un seul pied, à la racine. Avec des sections qui portent leur pied
   * (document créé depuis plusieurs documents, CONCEPTION-ACHATS-MARCHES.md Q20, Q21) : chaque section calcule son
   * pied sur ses lignes (pieds_sections), puis le pied global consolide les lignes des pieds de section de même nature
   * (type, mode, sens) et de même libellé, la TVA par taux, et ajoute les postes après TVA de la racine.
   */
  passePied() {
    for (const l of this.ordre) {
      if (estPied(l) || !estChiffree(l) || this.estLigneDePrix(l)) continue;
      l.lig_tva_id = null;
      l.lig_taux_tva = null;
    }
    const sections = this.enfantsDe(null).filter((s) => s.lig_tyl_id === TL.SECTION);
    const avecPied = sections.filter((s) => this.enfantsDe(s.lig_id).some(estPied));
    this.piedsSections = [];
    if (!avecPied.length) {
      const r = this.calculerPortee(this.ordre, this.enfantsDe(null));
      this.pied = this.masquerTotaux(r.pied);
      this.tva = r.tva.lignes;
      this.ecrireTotaux(r.tva, r.cumul);
      return;
    }
    if (sections.length < 2) {
      for (const s of avecPied) {
        this.erreur(s.lig_id, 'PIED_SECTION_INTERDIT', 'Un pied de section n\'existe que dans un document à plusieurs sections (plusieurs documents sources)', false);
      }
    }
    const portees = avecPied.map((s) => ({ s, r: this.calculerPortee(this.ordre.filter((l) => this.descendDe(l, s)), this.enfantsDe(s.lig_id)) }));
    const reste = this.calculerPortee(this.ordre.filter((l) => !avecPied.some((s) => l === s || this.descendDe(l, s))), []);
    this.piedsSections = portees.map(({ s, r }) => ({ lig_id: s.lig_id, pied: this.masquerTotaux(r.pied) }));
    this.consoliderPied(portees, reste);
  }

  /**
   * Pied d'une portée (document entier, ou section qui porte son pied) : lignes de la portée (bases de TVA, total HT)
   * et éléments du pied (lignes de pied et sous-totaux de pied, dans l'ordre). Renvoie { pied (montants décimaux,
   * totaux non masqués), tva, cumul, totalHT }.
   */
  calculerPortee(lignes, elements) {
    const pm = this.precMontant;
    const bases = new Map();
    let totalHT = ZERO;

    for (const l of lignes) {
      if (estPied(l) || !this.estLigneDePrix(l)) continue;
      if (l.lig_tva_id !== null && l.lig_tva_id !== undefined && D(l.lig_taux_tva) === null) {
        const t = this.tauxTva.get(l.lig_tva_id);
        if (t) l.lig_taux_tva = S(D(t.ttv_taux));
      }
      if (this.horsTotal(l) || this.enErreur.has(l.lig_id) || l.lig_montant_ht === null) continue;
      totalHT = totalHT.plus(D(l.lig_montant_ht));
      if (l.lig_tva_id === null || l.lig_tva_id === undefined) {
        this.erreur(l.lig_id, 'TVA_MANQUANTE', 'Taux de TVA manquant sur une ligne de prix', false);
        continue;
      }
      if (!bases.has(l.lig_tva_id)) bases.set(l.lig_tva_id, this.infoTaux(l.lig_tva_id, l.lig_taux_tva));
      const e = bases.get(l.lig_tva_id);
      e.base = e.base.plus(D(l.lig_montant_ht));
    }

    const totalTTC = totalHT.plus(this.calculerTva(bases).net);
    let cumul = totalHT;
    let tva = null;
    let htNet = totalHT;
    const sousTotaux = new Map();

    // Structure du pied (affichage) : totaux calculés et groupes (postes HT, TVA, postes TTC), dans l'ordre du calcul.
    const pied = [{ genre: 'total', cle: 'TOTAL_HT', montant: totalHT, lig_id: null }];
    let groupe = null;
    // Fermeture d'un groupe : suivi d'un total calculé, sauf s'il est fermé par un sous-total de pied saisi.
    const fermer = (avecTotal = true) => {
      if (!groupe) return;
      pied.push({ ...groupe, montant: groupe.montant });
      if (groupe.cle === 'HT' && !tva) htNet = cumul;
      if (!avecTotal) { groupe = null; return; }
      if (groupe.cle === 'HT' && !tva) {
        pied.push({ genre: 'total', cle: 'HT_NET', montant: cumul, lig_id: null });
      } else if (groupe.cle === 'TVA') pied.push({ genre: 'total', cle: 'TOTAL_TTC', montant: cumul, lig_id: null });
      else pied.push({ genre: 'total', cle: 'SOUS_TOTAL', montant: cumul, lig_id: null });
      groupe = null;
    };
    const dans = (cle, id, montant) => {
      if (groupe?.cle !== cle) { fermer(); groupe = { genre: 'groupe', cle, montant: ZERO, lignes: [] }; }
      if (id !== null) groupe.lignes.push(id);
      groupe.montant = groupe.montant.plus(montant);
    };

    for (const p of elements) {
      if (this.estSousTotalPied(p)) {
        fermer(false);
        for (const c of this.champsCumules) p[c] = c === 'lig_montant_ht' ? S(cumul) : null;
        sousTotaux.set(p.lig_id, cumul);
        pied.push({ genre: 'ligne', cle: 'SOUS_TOTAL', montant: cumul, lig_id: p.lig_id });
        continue;
      }
      if (!estPied(p)) continue;
      p.lig_base_calcul = null;
      p.lig_montant_tva = null;
      if (p.lig_tyl_id === TL.TVA) {
        p.lig_montant_ht = null;
        if (tva) { this.erreur(p.lig_id, 'TVA_DOUBLE', 'Une seule ligne de ventilation TVA par document', false); continue; }
        fermer();
        tva = this.calculerTva(bases);
        p.lig_base_calcul = S(tva.base);
        p.lig_montant_tva = S(tva.net);
        cumul = cumul.plus(tva.net);
        dans('TVA', p.lig_id, tva.net);
        fermer();
        continue;
      }
      const base = this.basePied(p, { cumul, totalHT, totalTTC, htNet, sousTotaux });
      const mode = p.lig_pied_mode ?? 'M';
      const sens = p.lig_pied_sens === -1 ? -1 : 1;
      const valeur = Dz(p.lig_pied_valeur);
      const montant = mode === 'P' ? arrondir(base.times(valeur).div(100), pm).times(sens)
        : mode === 'C' ? arrondir(base.times(valeur.minus(1)), pm)
          : arrondir(valeur, pm).times(sens);
      p.lig_base_calcul = mode === 'M' ? null : S(base);
      p.lig_montant_ht = S(montant);
      const hors = this.horsCumulPied(p);
      dans(p.lig_tyl_id === TL.PIED_HT ? 'HT' : 'TTC', p.lig_id, hors ? ZERO : montant);
      if (hors) continue;
      cumul = cumul.plus(montant);
      if (p.lig_tyl_id === TL.PIED_HT && !tva) this.repartirSurBases(bases, montant, p);
    }
    if (!tva) {
      fermer();
      tva = this.calculerTva(bases);
      cumul = cumul.plus(tva.net);
      dans('TVA', null, tva.net);
    }
    // Le dernier groupe n'a pas de sous-total : le net à payer le suit.
    if (groupe) { pied.push(groupe); groupe = null; }
    pied.push({ genre: 'total', cle: 'NET', montant: cumul, lig_id: null });
    return { pied, tva, cumul, totalHT };
  }

  /**
   * Pied global d'un document à pieds de section : total HT des sections (et des lignes hors section), lignes des
   * pieds de section consolidées par nature (type, mode, sens) et libellé (montants et bases additionnés, taux s'il est
   * commun), postes HT puis TVA additionnée par taux puis postes TTC, enfin les postes après TVA saisis à la racine
   * (un poste HT ou une ventilation TVA à la racine est refusé : PIED_GLOBAL).
   */
  consoliderPied(portees, reste) {
    const pm = this.precMontant;
    const totalHT = portees.reduce((s, { r }) => s.plus(r.totalHT), reste.totalHT);
    // TVA : somme des ventilations des portées, par code de taux.
    const parCode = new Map();
    for (const t of [...portees.flatMap(({ r }) => r.tva.lignes), ...reste.tva.lignes]) {
      const x = parCode.get(t.tva_code);
      if (!x) { parCode.set(t.tva_code, { ...t }); continue; }
      for (const k of ['tva_base_ht', 'tva_montant', 'tva_montant_annulation', 'tva_montant_net']) x[k] = S(D(x[k]).plus(D(t[k])));
    }
    const lignesTva = [...parCode.values()].sort((a, b) => comparerCodes(a.tva_code, b.tva_code));
    const tva = {
      lignes: lignesTva,
      base: lignesTva.reduce((s, t) => s.plus(D(t.tva_base_ht)), ZERO),
      net: lignesTva.reduce((s, t) => s.plus(D(t.tva_montant_net)), ZERO),
    };
    // Lignes des pieds de section regroupées (ordre de première apparition), avant ou après la TVA.
    const consolidees = new Map();
    const lignesTvaSections = [];
    for (const { s } of portees) {
      let apresTva = false;
      for (const p of this.enfantsDe(s.lig_id)) {
        const st = this.estSousTotalPied(p);
        if (!st && !estPied(p)) continue;
        if (p.lig_tyl_id === TL.TVA) { apresTva = true; lignesTvaSections.push(p.lig_id); continue; }
        if (!st && this.horsCumulPied(p)) continue;
        const phase = p.lig_tyl_id === TL.PIED_TTC || (st && apresTva) ? 'TTC' : 'HT';
        const mode = st ? null : p.lig_pied_mode ?? 'M';
        const sens = st ? null : p.lig_pied_sens === -1 ? -1 : 1;
        const libelle = texteBrut(p.lig_libelle_html ?? '');
        const cle = [phase, st ? 'ST' : p.lig_tyl_id, mode, sens, normaliserLibelle(libelle)].join('|');
        if (!consolidees.has(cle)) {
          consolidees.set(cle, {
            genre: 'consolide', cle: st ? 'SOUS_TOTAL' : phase, phase, libelle, mode, sens, montant: ZERO, base: null,
            taux: mode === 'P' || mode === 'C' ? D(p.lig_pied_valeur) : null, lignes: [],
          });
        }
        const c = consolidees.get(cle);
        c.lignes.push(p.lig_id);
        c.montant = c.montant.plus(Dz(p.lig_montant_ht));
        if (D(p.lig_base_calcul) !== null) c.base = (c.base ?? ZERO).plus(D(p.lig_base_calcul));
        if (c.taux !== null && !c.taux.equals(Dz(p.lig_pied_valeur))) c.taux = null;
      }
    }
    let cumul = totalHT;
    const pied = [{ genre: 'total', cle: 'TOTAL_HT', montant: totalHT, lig_id: null }];
    const ajouter = (phase) => {
      const liste = [...consolidees.values()].filter((c) => c.phase === phase);
      for (const c of liste) {
        pied.push(c);
        if (c.cle !== 'SOUS_TOTAL') cumul = cumul.plus(c.montant);
      }
      return liste.length > 0;
    };
    if (ajouter('HT')) pied.push({ genre: 'total', cle: 'HT_NET', montant: cumul, lig_id: null });
    const htNet = cumul;
    cumul = cumul.plus(tva.net);
    pied.push({ genre: 'groupe', cle: 'TVA', montant: tva.net, lig_id: null, lignes: lignesTvaSections });
    pied.push({ genre: 'total', cle: 'TOTAL_TTC', montant: cumul, lig_id: null });
    ajouter('TTC');
    const totalTTC = totalHT.plus(tva.net);
    // Postes après TVA de la racine (retenue de garantie…) et sous-totaux de pied de la racine.
    const sousTotaux = new Map();
    let groupe = null;
    const fermer = () => { if (groupe) { pied.push(groupe); groupe = null; } };
    for (const p of this.enfantsDe(null)) {
      if (this.estSousTotalPied(p)) {
        fermer();
        for (const c of this.champsCumules) p[c] = c === 'lig_montant_ht' ? S(cumul) : null;
        sousTotaux.set(p.lig_id, cumul);
        pied.push({ genre: 'ligne', cle: 'SOUS_TOTAL', montant: cumul, lig_id: p.lig_id });
        continue;
      }
      if (!estPied(p)) continue;
      p.lig_base_calcul = null;
      p.lig_montant_tva = null;
      if (p.lig_tyl_id !== TL.PIED_TTC) {
        p.lig_montant_ht = null;
        this.erreur(p.lig_id, 'PIED_GLOBAL', 'Avec des pieds de section, le pied du document ne reçoit que des postes après TVA', false);
        continue;
      }
      const base = this.basePied(p, { cumul, totalHT, totalTTC, htNet, sousTotaux });
      const mode = p.lig_pied_mode ?? 'M';
      const sens = p.lig_pied_sens === -1 ? -1 : 1;
      const valeur = Dz(p.lig_pied_valeur);
      const montant = mode === 'P' ? arrondir(base.times(valeur).div(100), pm).times(sens)
        : mode === 'C' ? arrondir(base.times(valeur.minus(1)), pm)
          : arrondir(valeur, pm).times(sens);
      p.lig_base_calcul = mode === 'M' ? null : S(base);
      p.lig_montant_ht = S(montant);
      const hors = this.horsCumulPied(p);
      if (!groupe) groupe = { genre: 'groupe', cle: 'TTC', montant: ZERO, lig_id: null, lignes: [] };
      groupe.lignes.push(p.lig_id);
      if (hors) continue;
      groupe.montant = groupe.montant.plus(montant);
      cumul = cumul.plus(montant);
    }
    fermer();
    pied.push({ genre: 'total', cle: 'NET', montant: cumul, lig_id: null });
    this.pied = this.masquerTotaux(pied);
    this.tva = tva.lignes;
    this.ecrireTotaux(tva, cumul);
  }

  /** Base d'une ligne de pied en pourcentage ou coefficient (lig_pied_base). */
  basePied(p, { cumul, totalHT, totalTTC, htNet, sousTotaux }) {
    switch (p.lig_pied_base ?? 'CUMUL') {
      case 'TOTAL_HT': return totalHT;
      case 'TOTAL_TTC': return totalTTC;
      case 'HT_NET': return htNet;
      case 'LIGNE': {
        const id = p.lig_pied_base_id;
        if (id !== null && id !== undefined && sousTotaux.has(Number(id))) return sousTotaux.get(Number(id));
        this.erreur(p.lig_id, 'PIED_BASE', 'La base doit être un sous-total de pied placé avant la ligne', false);
        return cumul;
      }
      default: return cumul;
    }
  }

  /**
   * Un total calculé égal au total suivant (calculé ou sous-total de pied saisi) est masqué : une seule ligne affichée.
   * Montants en chaînes.
   */
  masquerTotaux(pied) {
    return pied.map((e, i) => {
      const suivant = e.genre === 'total' && e.cle !== 'NET' ? pied.slice(i + 1).find((x) => x.genre !== 'groupe' && x.genre !== 'consolide') : null;
      const entree = {
        genre: e.genre, cle: e.cle, lig_id: e.lig_id ?? null, lignes: e.lignes ?? null, montant: S(e.montant),
        masque: !!suivant && e.montant.equals(suivant.montant),
      };
      // Ligne consolidée du pied global : libellé, mode, sens, base additionnée, taux commun.
      if (e.genre === 'consolide') Object.assign(entree, { libelle: e.libelle, mode: e.mode, sens: e.sens, base: e.base === null ? null : S(e.base), taux: e.taux === null ? null : S(e.taux) });
      return entree;
    });
  }

  /** Totaux de l'entête ; une spécialisation y ajoute ses propres valeurs. */
  ecrireTotaux(tva, cumul) {
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

  // ---------------------------------------------------------------- passe 6 : libellés

  /** Libellé HTML d'où part le libellé affiché (une spécialisation peut le calculer : métré en script…). */
  sourceLibelle(l) {
    return l.lig_libelle_html;
  }

  passeLibelles() {
    if (this.options.libelles_figes) return;
    for (const l of this.ordre) {
      const resoudre = (texte) => {
        const ref = analyserReference(texte);
        if (ref.genre === 'variable') return { valeur: this.lireVariable(ref.portee, ref.nom, l), type: null };
        const { valeur, colonne } = this.lireDonnee(ref, l, 'libelle');
        return { valeur, type: this.colonnesDates.has(colonne) ? 'date' : this.colonnesDecimales.has(colonne) ? 'decimale' : null };
      };
      const { texte, inconnues } = remplacerVariables(this.sourceLibelle(l), resoudre);
      for (const i of inconnues) this.avertir(l.lig_id, 'VARIABLE_LIBELLE', `Libellé : ${i.message}`);
      l.lig_libelle_affiche = texte;
      l.lig_libelle_brut = texteBrut(texte);
    }
  }

  // ---------------------------------------------------------------- résultat

  resultat() {
    return this.completerResultat({
      version_moteur: VERSION_MOTEUR,
      document: this.doc,
      lignes: this.ordre,
      tva: this.tva,
      pied: this.pied,
      pieds_sections: this.piedsSections,
      erreurs: this.erreurs,
      avertissements: this.avertissements,
    });
  }

  /** Ajout des données propres à une spécialisation (métrés, variables…). */
  completerResultat(resultat) {
    return resultat;
  }
}

/** Calcul d'un document générique. */
export function calculerDocument(entree) {
  return new MoteurDocument(entree).calculer();
}
