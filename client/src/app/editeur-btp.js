import { texte, texteHtml, icone } from '@logibtp/socle/dictionnaire';
import { CFG_LIGNES as C, parId, ancetres, descendants, formatNombre, formatLibre, lireNombre, echapper, ouvrirDialogue } from '@logibtp/socle/ui';
import {
  EditeurDocument, ReglesDocument, PressePapiers, correspondance, modifierColonne, insererColonnes,
} from '@logibtp/document/ui';
import { estFamilleAchat } from '@logibtp/document';
import { DictionnaireMetre } from '@logibtp/metre/ui';
import { calculerDocument, TL, estChiffree, natureObligatoire } from '../calcul/index.js';
import { FONCTIONS_BTP } from '../calcul/fonctions-btp.js';
import { compteLigne, libelleCompte, relationTiers } from './comptes.js';
import { fraisRecus, bilanTranche } from './frais-annexes.js';
import { unitesArticle, conversionUnite } from './bibliotheque/appel.js';

// Spécialisation BTP de l'éditeur du module Document : moteur de devis BTP, colonnes de déboursé, PV fixe,
// lignes d'écart d'arrondi calculées, métrés et variables (module Métré). L'éditeur sert aussi d'hôte au
// panneau de métré (interface décrite dans PanneauMetre).

/** Règles BTP : coefficients hérités de l'ouvrage, exclusivité des blocages de prix, quantité saisie. */
export class ReglesBtp extends ReglesDocument {
  get champsHeritesOuvrage() { return ['lig_coef_fg', 'lig_coef_benef', ...super.champsHeritesOuvrage]; }

  /** Le prorata reste sur les lignes vendues : une ligne entrée dans un ouvrage (et son contenu) repasse à 1. */
  appliquerContexte(brouillon, id, tauxTva) {
    super.appliquerContexte(brouillon, id, tauxTva);
    const lignes = brouillon.lignes;
    if (!this.ouvrageAncetre(lignes, id)) return;
    const ids = new Set([id, ...descendants(C, lignes, id)]);
    for (const l of lignes) if (ids.has(l.lig_id)) l.lig_coef_prorata = 1;
  }

  apresModification(brouillon, id, champ) {
    super.apresModification(brouillon, id, champ);
    const l = brouillon.lignes.find((x) => x.lig_id === id);
    if (!l) return;
    if (champ === 'lig_pv_fixe' && l.lig_pv_fixe) l.lig_pv_affiche_fixe = false;
    if (champ === 'lig_pv_affiche_fixe' && l.lig_pv_affiche_fixe) l.lig_pv_fixe = false;
    if (champ === 'lig_qte' && l.lig_qte_source === 'M') l.lig_qte_source = 'S';
  }
}

/**
 * Presse-papiers BTP : les métrés (scripts), les variables et les clés de ventilation des frais annexes suivent les
 * lignes copiées. Une clé est recréée sur la copie comme si elle avait été saisie sur la nouvelle ligne : clé de ligne
 * d'une ligne copiée (sa tranche de frais copiée avec elle, ou la même tranche quand on colle dans le même document sous la même tranche
 * parente),
 * clé d'élément ou de nature d'une tranche de frais copiée (ses clés de ligne vers des lignes non copiées sont perdues).
 */
export class PressePapiersBtp extends PressePapiers {
  extraireComplements(saisie, garder) {
    const metres = saisie.metres.filter((m) => garder.has(m.mtr_lig_id));
    const mids = new Set(metres.map((m) => m.mtr_id));
    return {
      metres,
      variables: saisie.variables.filter((v) => (v.var_lig_id !== null && garder.has(v.var_lig_id)) || (v.var_mtr_id !== null && mids.has(v.var_mtr_id))),
      ventilations: (saisie.ventilations ?? []).filter((k) => garder.has(k.vfr_source_lig_id) || (k.vfr_cible === 'LIGNE' && garder.has(k.vfr_lig_id))),
    };
  }

  renumeroterComplements(contenu, lignes, lig, compteur) {
    const metres = contenu.metres ?? [], variables = contenu.variables ?? [];
    const mtr = new Map();
    for (const m of metres) mtr.set(m.mtr_id, compteur.suivant());
    const vars = variables.map(() => compteur.suivant());
    contenu.lignes.forEach((source, i) => { lignes[i].lig_mtr_id = correspondance(mtr, source.lig_mtr_id); });
    return {
      metres: metres.map((m) => ({ ...structuredClone(m), mtr_id: mtr.get(m.mtr_id), mtr_lig_id: lig.get(m.mtr_lig_id) })),
      variables: variables.map((v, i) => ({
        ...structuredClone(v), var_id: vars[i], var_lig_id: correspondance(lig, v.var_lig_id), var_mtr_id: correspondance(mtr, v.var_mtr_id),
      })),
      ventilations: (contenu.ventilations ?? [])
        .filter((k) => k.vfr_cible !== 'LIGNE' || lig.has(k.vfr_lig_id))
        .map((k) => ({
          ...structuredClone(k), vfr_id: compteur.suivant(),
          vfr_source_lig_id: lig.has(k.vfr_source_lig_id) ? lig.get(k.vfr_source_lig_id) : k.vfr_source_lig_id,
          vfr_lig_id: k.vfr_cible === 'LIGNE' ? lig.get(k.vfr_lig_id) : null,
          // Tranche de frais restée dans le document d'origine : la clé ne vaut que si l'on colle dans ce document.
          _source_externe: !lig.has(k.vfr_source_lig_id),
        })),
      source_ent_id: contenu.source_ent_id ?? null,
    };
  }

  insererComplements(d, copie) {
    d.metres.push(...copie.metres);
    d.variables.push(...copie.variables.map((v) => ({ ...v, var_ent_id: d.document.ent_id })));
  }

  /**
   * Clés de ventilation, une fois les lignes placées : une clé vers une tranche de frais restée dans le document ne
   * suit la ligne que si l'on colle dans ce document et sous la même tranche parente (portée de la tranche de frais) ;
   * ailleurs la ligne revient au prorata (décision du 31/10/2026).
   */
  apresPlacement(d, copie) {
    const memeDocument = (copie.source_ent_id ?? null) === (d.document.ent_id ?? null);
    const index = parId(C, d.lignes);
    const dansPortee = (k) => {
      const source = index.get(k.vfr_source_lig_id);
      if (!memeDocument || !source) return false;
      if (k.vfr_cible !== 'LIGNE') return true;
      const portee = source.lig_parent_id ?? null;
      return portee === null || ancetres(C, d.lignes, k.vfr_lig_id).some((a) => a.lig_id === portee);
    };
    const cles = (copie.ventilations ?? [])
      .filter((k) => !k._source_externe || dansPortee(k))
      .map(({ _source_externe, ...k }) => ({ ...k, vfr_ent_id: d.document.ent_id ?? null }));
    if (cles.length) (d.ventilations ??= []).push(...cles);
  }
}

/**
 * Dictionnaire BTP : règles de portée du moteur — $$ document, $ titre (et titres englobants), @@ ouvrage
 * (et ouvrages englobants), @ ligne courante ; seules les variables définies avant la ligne sont lisibles.
 */
export class DictionnaireBtp extends DictionnaireMetre {
  /** Fonctions BTP des scripts (celles du moteur) : complétion, dictionnaire et contrôle de l'éditeur. */
  fonctions() { return FONCTIONS_BTP; }

  entrees(ligId, options = {}) {
    const lignes = this.hote.saisie.lignes;
    this.index = parId(C, lignes);
    const ligne = this.index.get(ligId);
    if (!ligne) return [];
    this.rang = new Map(this.hote.resultat.lignes.map((l, i) => [l.lig_id, i]));
    const chaine = [ligne, ...ancetres(C, lignes, ligId)];
    this.titres = new Set(chaine.filter((x) => x.lig_tyl_id === TL.TITRE).map((x) => x.lig_id));
    this.ouvrages = new Set(chaine.filter((x) => x.lig_tyl_id === TL.OUVRAGE).map((x) => x.lig_id));
    return super.entrees(ligId, options);
  }

  #contexte(proprietaire, type) {
    if (!proprietaire) return null;
    if (proprietaire.lig_tyl_id === type) return proprietaire.lig_id;
    return ancetres(C, this.hote.saisie.lignes, proprietaire.lig_id).find((a) => a.lig_tyl_id === type)?.lig_id ?? null;
  }

  accessible(portee, proprietaireId, ligId) {
    const proprietaire = proprietaireId === null ? null : this.index.get(proprietaireId);
    if (proprietaire && (this.rang.get(proprietaire.lig_id) ?? Infinity) > (this.rang.get(ligId) ?? Infinity)) return false;
    switch (portee) {
      case '$$': return true;
      case '$': return this.titres.has(this.#contexte(proprietaire, TL.TITRE));
      case '@@': return this.ouvrages.has(this.#contexte(proprietaire, TL.OUVRAGE));
      case '@': return proprietaire?.lig_id === ligId;
      default: return false;
    }
  }

  donnees(ligId, { pourDefinition = false } = {}) {
    const ligne = this.index.get(ligId);
    const res = this.hote.resultat;
    // Données lisibles par un métré (avant la quantité vendue : ni prix calculés, ni quantités calculées).
    const cles = ['lig_qte', 'lig_unt_code', 'lig_code', 'lig_libelle_html', 'lig_pa', 'lig_coef_perte', 'lig_coef_fg', 'lig_coef_benef',
      'lig_coef_remise', 'lig_poids', 'lig_surface', 'lig_volume', 'lig_hauteur', 'lig_largeur', 'lig_epaisseur', 'lig_longueur'];
    if (pourDefinition) cles.push('lig_qte_vendue', 'lig_qte_totale');
    const liste = cles.map((col) => [col, texte(`document_btp.donnees.${col}`)]);
    const brut = (v) => (typeof v === 'string' && v.includes('<') ? v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : v);
    const entrees = liste.map(([col, lib]) => ({ valeur: `{{${col}}}`, libelle: lib, detail: brut(ligne[col]) ?? '', groupe: texte('document_btp.donnees.groupe_ligne') }));
    const doc = this.hote.saisie.document;
    for (const col of ['ent_numero', 'ent_date', 'ent_objet', 'ent_notre_reference', 'ent_reference_externe', 'ent_validite_jours',
      'ent_mode_calcul_ouvrage', 'ent_precision_montant']) {
      entrees.push({ valeur: `{{document.${col}}}`, libelle: texte(`document_btp.donnees.${col}`), detail: doc?.[col] ?? '', groupe: texte('document_btp.donnees.groupe_entete') });
    }
    const parent = this.index.get(ligne.lig_parent_id);
    if (parent && estChiffree(parent)) {
      const pc = res.lignes.find((l) => l.lig_id === parent.lig_id);
      entrees.push({ valeur: `{{document_ligne[${parent.lig_id}].lig_qte_vendue}}`, libelle: texte('document_btp.donnees.qte_parent'), detail: pc?.lig_qte_vendue ?? '', groupe: texte('document_btp.donnees.groupe_ligne') });
    }
    if (ligne.lig_art_id) entrees.push({ valeur: '{{article.art_poids}}', libelle: texte('document_btp.donnees.art_poids'), detail: '', groupe: texte('document_btp.donnees.groupe_article') });
    return entrees;
  }
}

/** Éditeur de devis BTP : spécialise EditeurDocument et sert d'hôte au panneau de métré. */
export class EditeurDevisBtp extends EditeurDocument {
  constructor(conteneur, { ouvrirMetre, ...options }) {
    // options.appelerCode / options.rechercher : appel de la bibliothèque (colonne Code, F3), fournis par l'hôte.
    super(conteneur, options);
    this.ouvrirMetreExterne = ouvrirMetre;
  }

  creerRegles() { return new ReglesBtp(); }
  creerPressePapiers() { return new PressePapiersBtp(); }
  calculer(entree) { return calculerDocument(entree); }

  entree(saisie) {
    return { ...super.entree(saisie), metres: saisie.metres, variables: saisie.variables, ventilations: saisie.ventilations ?? [] };
  }

  identifiants(saisie, resultat) {
    return [
      ...super.identifiants(saisie, resultat),
      ...saisie.metres.map((m) => m.mtr_id), ...saisie.variables.map((v) => v.var_id),
      ...(saisie.ventilations ?? []).map((k) => k.vfr_id),
    ];
  }

  nouvelleLigne(id, type, entId) {
    return {
      ...super.nouvelleLigne(id, type, entId),
      lig_qte_source: 'S', lig_coef_perte: 1, lig_pa: null, lig_coef_fg: 1, lig_coef_benef: 1, lig_coef_prorata: 1,
      lig_pv_fixe: false, lig_pv_affiche_fixe: false, lig_is_ecart_arrondi: false, lig_pied_is_fa: false,
    };
  }

  estLigneCalculee(l) { return !!l.lig_is_ecart_arrondi; }

  /**
   * Bon de livraison : les composantes d'un ouvrage ne se saisissent pas, elles suivent la quantité livrée de l'ouvrage
   * (CONCEPTION-ACHATS-MARCHES.md, Q23, 13.8).
   */
  saisissable(l) {
    if (!super.saisissable(l)) return false;
    if (!/_RECEPTION$/.test(this.definition.type?.tyd_code ?? '')) return true;
    const parent = l.lig_parent_id === null || l.lig_parent_id === undefined ? null : this.saisie.lignes.find((x) => x.lig_id === l.lig_parent_id);
    return parent?.lig_tyl_id !== TL.OUVRAGE;
  }

  /** Plan : part ventilée d'une tranche de frais annexes (ventilé / prévu). */
  complementTranche(ligne) {
    const b = bilanTranche(this.resultat, ligne.lig_id);
    if (!b || Number(b.prevu) === 0) return null;
    return texte('document_btp.editeur.ventile', { pct: formatLibre(Math.round(Number(b.ventile) / Number(b.prevu) * 1000) / 10, 1) });
  }

  libelleType(r) { return r.estCalculee ? texte('document_btp.editeur.ecart') : super.libelleType(r); }

  apresSuppression(d, supprimees) {
    const metres = new Set(d.metres.filter((x) => supprimees.has(x.mtr_lig_id)).map((x) => x.mtr_id));
    d.metres = d.metres.filter((x) => !metres.has(x.mtr_id));
    d.variables = d.variables.filter((v) => !supprimees.has(v.var_lig_id) && !metres.has(v.var_mtr_id));
  }

  /**
   * Date de livraison par défaut des lignes (lot 9, A24a) : livraison confirmée par l'accusé de réception, sinon livraison
   * prévue, sinon date de besoin (réservation) ; ↔ f_date_livraison_ligne (db/238) lue par la projection du stock.
   */
  dateLivraisonDefaut() {
    const d = this.saisie.document;
    return d.ent_arc_livraison ?? d.ent_date_livraison ?? d.ent_date_besoin ?? null;
  }

  colonnes() {
    const chiffree = (l) => this.saisissable(l) && estChiffree(l);
    const colonnes = super.colonnes();
    const qte = colonnes.find((c) => c.cle === 'qte');
    const metreQte = (r) => estChiffree(r.calcule) && r.calcule.lig_qte_source === 'M';
    modifierColonne(colonnes, 'qte', {
      valeur: (r) => (metreQte(r) ? `${icone('document_btp_metre')} ${qte.valeur(r)}` : qte.valeur(r)),
      titreCellule: (r) => (metreQte(r) ? texte('document_btp.editeur.qte_metre', { icone: icone('document_btp_metre') }) : qte.titreCellule?.(r) ?? ''),
    });
    // Nature (comme les articles de la bibliothèque) : obligatoire sur les lignes de prix pour valider.
    const nature = (id) => (this.natures ?? []).find((n) => n.id === Number(id));
    const manquante = (r) => !r.virtuelle && natureObligatoire(r.item) && (r.item.lig_nat_id === null || r.item.lig_nat_id === undefined);
    insererColonnes(colonnes, 'qte', [{
      cle: 'nature', titre: texte('document_btp.colonnes.nature'), classe: 'col-nature', editeur: 'select', editable: chiffree,
      champ: () => 'lig_nat_id', lire: (l) => l.lig_nat_id ?? '',
      options: () => [{ valeur: '', libelle: '—' }, ...(this.natures ?? []).filter((n) => n.actif !== false).map((n) => ({ valeur: n.id, libelle: `${n.code} – ${n.libelle}` }))],
      valeur: (r) => (r.virtuelle || !estChiffree(r.item) ? '' : nature(r.item.lig_nat_id)?.code ?? (r.item.lig_nat_id ? `#${r.item.lig_nat_id}` : '')),
      classeCellule: (r) => (manquante(r) ? 'manquant' : ''),
      titreCellule: (r) => (manquante(r) ? texte('document_btp.editeur.nature_obligatoire') : nature(r.item?.lig_nat_id)?.libelle ?? ''),
    }, {
      // Compte comptable : celui de la ligne, sinon le compte hérité (nature, tiers) souligné ; saisie libre proposant le plan de comptes.
      cle: 'compte', titre: texte('document_btp.colonnes.compte'), classe: 'col-compte', editeur: 'liste', editable: chiffree,
      champ: () => 'lig_cpt_code', lire: (l) => l.lig_cpt_code ?? '',
      suggestions: () => (this.comptes ?? []).filter((c) => c.actif !== false).map((c) => ({ valeur: c.code, libelle: c.libelle })),
      valeur: (r) => {
        const c = r.virtuelle ? null : this.compteLigne(r.item);
        if (!c) return '';
        return c.herite ? { html: `<u class="compte-herite">${echapper(c.code)}</u>` } : c.code;
      },
      titreCellule: (r) => {
        const c = r.virtuelle ? null : this.compteLigne(r.item);
        if (!c) return '';
        const lib = libelleCompte(c.code, this.comptes);
        return c.herite ? texte('document_btp.editeur.compte_herite', { libelle: lib, detail: c.detail }) : lib;
      },
    }]);
    // Chantier de la ligne (achats, db/248) : celui de la ligne, sinon celui de l'entête (souligné) ; facture de plusieurs
    // chantiers : entête vide, chantier par ligne (repris du document source).
    if (estFamilleAchat(this.definition.type?.tyd_famille)) {
      const chantier = (id) => (this.chantiers ?? []).find((c) => c.id === Number(id));
      insererColonnes(colonnes, 'qte', [{
        cle: 'chantier', titre: texte('document_btp.editeur.chantier.titre'), classe: 'col-chantier', editeur: 'select', editable: chiffree,
        champ: () => 'lig_cha_id', lire: (l) => l.lig_cha_id ?? '',
        options: () => [{ valeur: '', libelle: texte('document_btp.editeur.chantier.entete') }, ...(this.chantiers ?? []).map((c) => ({ valeur: c.id, libelle: `${c.code} – ${c.libelle ?? ''}` }))],
        valeur: (r) => {
          if (r.virtuelle || !estChiffree(r.item)) return '';
          if (r.item.lig_cha_id) return chantier(r.item.lig_cha_id)?.code ?? `#${r.item.lig_cha_id}`;
          const e = chantier(this.saisie.document.ent_chantier_id);
          return e ? { html: `<u class="compte-herite">${echapper(e.code)}</u>` } : '';
        },
        titreCellule: (r) => {
          if (r.virtuelle || !estChiffree(r.item)) return '';
          const c = chantier(r.item.lig_cha_id ?? this.saisie.document.ent_chantier_id);
          if (!c) return texte('document_btp.editeur.chantier.sans');
          return `${c.code} – ${c.libelle ?? ''}${r.item.lig_cha_id ? '' : ` ${texte('document_btp.editeur.chantier.herite')}`}`;
        },
      }]);
    }
    insererColonnes(colonnes, 'pv', [
      {
        cle: 'pa', titre: texte('document_btp.colonnes.pa'), classe: 'col-nombre', ...this.colonneNombre('lig_pa', (l) => chiffree(l) && !this.estCompose(l)),
        valeur: (r) => (estChiffree(r.calcule) ? formatNombre(r.calcule.lig_pa, 2) : ''),
      },
      {
        cle: 'fg', titre: texte('document_btp.colonnes.fg'), classe: 'col-coef', ...this.colonneNombre('lig_coef_fg', chiffree),
        valeur: (r) => (estChiffree(r.calcule) ? this.coefAffiche(r.calcule.lig_coef_fg, this.coefsDefaut?.fg) : ''),
      },
      {
        cle: 'benef', titre: texte('document_btp.colonnes.benef'), classe: 'col-coef', ...this.colonneNombre('lig_coef_benef', chiffree),
        valeur: (r) => (estChiffree(r.calcule) ? this.coefAffiche(r.calcule.lig_coef_benef, this.coefsDefaut?.benef) : ''),
      },
      {
        // Prorata : appliqué au prix affiché après les frais annexes, avant la remise (lignes de prix).
        cle: 'prorata', titre: texte('document_btp.colonnes.prorata'), classe: 'col-coef',
        ...this.colonneNombre('lig_coef_prorata', (l) => chiffree(l) && this.regles.estLigneDePrix(this.saisie.lignes, l)),
        valeur: (r) => (this.regles.estLigneDePrix(this.saisie.lignes, r.item) && Number(r.calcule.lig_coef_prorata ?? 1) !== 1
          ? this.coefAffiche(r.calcule.lig_coef_prorata, 1) : ''),
      },
      {
        // Frais annexes reçus (ventilation des tranches F) et coefficient qui en résulte.
        cle: 'coef_fa', titre: texte('document_btp.colonnes.coef_fa'), classe: 'col-coef',
        valeur: (r) => (!r.virtuelle && estChiffree(r.calcule) && Number(r.calcule.lig_coef_fa ?? 1) !== 1 ? this.coefAffiche(r.calcule.lig_coef_fa, 1) : ''),
        titreCellule: () => texte('document_btp.editeur.coef_fa'),
      },
      {
        cle: 'fa_recus', titre: texte('document_btp.colonnes.fa_recus'), classe: 'col-nombre',
        valeur: (r) => {
          const v = r.virtuelle ? null : fraisRecus(this.resultat, r.item.lig_id);
          return v ? formatNombre(v, this.saisie.document.ent_precision_montant ?? 2) : '';
        },
        titreCellule: () => texte('document_btp.editeur.fa_recus'),
      },
    ]);
    // Saisir un PV impose un prix fixe (avant frais annexes et remise) ; vider la cellule le retire.
    modifierColonne(colonnes, 'pv', {
      editable: chiffree,
      lire: (l) => (l.lig_pv_fixe ? formatLibre(l.lig_pv) : ''),
      valeur: (r) => this.baseAffichee(r.calcule) ?? (estChiffree(r.calcule) ? `${r.item.lig_pv_fixe ? `${icone('verrou')} ` : r.calcule.lig_pv_fixe ? `${icone('document_btp_pv_impose')} ` : ''}${formatNombre(r.calcule.lig_pv, r.calcule.lig_precision_pv ?? 2)}` : ''),
      titreCellule: (r) => (!estChiffree(r.calcule) || this.baseAffichee(r.calcule) !== null ? ''
        : r.item.lig_pv_fixe ? texte('document_btp.editeur.pv_fixe', { icone: icone('verrou') })
          : r.calcule.lig_pv_fixe ? texte('document_btp.editeur.pv_impose', { icone: icone('document_btp_pv_impose') }) : ''),
    });
    modifierColonne(colonnes, 'pvnet', {
      valeur: (r) => (estChiffree(r.calcule) ? `${r.item.lig_pv_affiche_fixe ? `${icone('verrou')} ` : ''}${formatNombre(r.calcule.lig_pv_remise, r.calcule.lig_precision_pv ?? 2)}` : ''),
      titreCellule: (r) => (estChiffree(r.calcule) && r.item.lig_pv_affiche_fixe ? texte('document_btp.editeur.pv_affiche_fixe', { icone: icone('verrou') }) : ''),
    });
    // Frais annexes et coefficient de prorata réservés aux ventes (règle FRAIS_ANNEXES, P11).
    if (this.definition.regles && this.definition.regles.FRAIS_ANNEXES === false) {
      return colonnes.filter((c) => !['prorata', 'coef_fa', 'fa_recus'].includes(c.cle));
    }
    return colonnes;
  }

  // ------------------------------------------------------------ unités de l'article (D2, D3)

  /** Identifiant de l'élément de la bibliothèque lié à la ligne, ou null. */
  idElement(l) {
    const id = l?.lig_art_id ?? l?.lig_proprietes?.element?.id;
    return id === null || id === undefined ? null : Number(id);
  }

  /**
   * Élément lié à la ligne s'il est déjà lu (cache de la page), sinon null ; la lecture est lancée par
   * `chargerElement(id)` posé par la page (service de la bibliothèque). Un élément supprimé reste à null.
   */
  elementLigne(l, { charger = true } = {}) {
    const id = this.idElement(l);
    if (id === null || !this.chargerElement) return null;
    this.elements ??= new Map();
    if (!this.elements.has(id)) {
      if (!charger) return null;
      this.elements.set(id, null);
      Promise.resolve(this.chargerElement(id)).then((e) => this.elements.set(id, e ?? null), () => {});
    }
    return this.elements.get(id);
  }

  /** Ligne courante : son élément est lu d'avance (liste des unités, conversion). */
  selectionChangee(id) {
    const l = this.saisie?.lignes.find((x) => x.lig_id === id);
    if (l) this.elementLigne(l);
  }

  /** Unités de l'article en tête (vente, stock, unités déclarées avec leur équivalence), puis les autres unités. */
  suggestionsUnites(ligne) {
    const autres = super.suggestionsUnites(ligne);
    const e = ligne ? this.elementLigne(ligne) : null;
    const unites = unitesArticle(e);
    if (!unites.length) return autres;
    const libelles = new Map((this.definition.unites ?? []).map((u) => [u.unt_code, u.unt_libelle]));
    const article = texte('document_btp.editeur.unites.article');
    const tete = unites.map((u) => ({
      valeur: u.unite, groupe: article, libelle: libelles.get(u.unite) ?? u.unite,
      detail: u.role !== 'STOCK' && u.ratio ? texte('document_btp.editeur.unites.equivalence', { unite: u.unite, ratio: formatLibre(u.ratio.toString(), 6), stock: e.unite_stock })
        : texte(`document_btp.editeur.unites.role_${u.role.toLowerCase()}`),
    }));
    const codes = new Set(unites.map((u) => u.unite));
    const groupe = texte('document_btp.editeur.unites.autres');
    return [...tete, ...autres.filter((o) => !codes.has(o.valeur)).map((o) => ({ ...o, groupe }))];
  }

  /**
   * Unité changée sur une ligne liée à un article (D3) : avec une correspondance, la conversion du prix (et de la
   * quantité) est proposée ; le choix peut valoir pour tout le document (Q6). Une seule étape d'annulation.
   */
  changerUnite(id, unite) {
    const l = this.saisie.lignes.find((x) => x.lig_id === id);
    if (!l || this.fige || this.champVerrouille(l, 'lig_unt_code')) return false;
    const e = this.elementLigne(l, { charger: false });
    const conv = e ? conversionUnite(e, l, l.lig_unt_code, unite) : null;
    const aPrix = conv && (conv.pa !== null || conv.pv !== null);
    if (!aPrix) return false;
    const appliquer = (choix) => {
      if (choix === null || choix === undefined) return;
      this.magasin.modifier((d) => {
        const x = d.lignes.find((y) => y.lig_id === id);
        if (!x) return;
        x.lig_unt_code = unite;
        if (choix !== 'AUCUN') {
          if (conv.pa !== null) x.lig_pa = conv.pa;
          if (conv.pv !== null) x.lig_pv = conv.pv;
          if (choix === 'PRIX_QTE' && conv.qte !== null && x.lig_qte_source !== 'M') x.lig_qte = conv.qte;
          if (x.lig_proprietes?.element) x.lig_proprietes = { ...x.lig_proprietes, element: { ...x.lig_proprietes.element, unite, ratio: conv.ratio } };
        }
        this.regles.apresModification(d, id, 'lig_unt_code');
      }, texte('document_btp.etapes.unite_convertie'));
    };
    if (this.choixConversion) { appliquer(this.choixConversion); return true; }
    const pm = l.lig_precision_pv ?? 2;
    const prix = (avant, apres) => texte('document_btp.editeur.unites.prix', { avant: formatNombre(avant, pm), apres: formatNombre(apres, pm), unite_avant: l.lig_unt_code, unite_apres: unite });
    const lignes = [
      conv.pa !== null ? `<li>${texteHtml('document_btp.editeur.unites.pa')} ${echapper(prix(l.lig_pa, conv.pa))}</li>` : '',
      conv.pv !== null ? `<li>${texteHtml('document_btp.editeur.unites.pv_fixe')} ${echapper(prix(l.lig_pv, conv.pv))}</li>` : '',
    ].join('');
    const qteModifiable = conv.qte !== null && l.lig_qte_source !== 'M';
    const lire = (v) => (d) => {
      if (d.querySelector('[data-memoriser]')?.checked) this.choixConversion = v;
      return v;
    };
    ouvrirDialogue({
      titre: texte('document_btp.editeur.unites.titre'),
      html: `<p>${texteHtml('document_btp.editeur.unites.equivalence_titre', { apres: unite, facteur: formatLibre(conv.facteur.toString(), 6), avant: l.lig_unt_code })}</p>
        <ul>${lignes}</ul>
        ${qteModifiable ? `<p class="aide">${texteHtml('document_btp.editeur.unites.qte', { avant: formatLibre(l.lig_qte, 6), apres: formatLibre(conv.qte, 6), unite_avant: l.lig_unt_code, unite_apres: unite })}</p>` : ''}
        <label class="case"><input type="checkbox" data-memoriser> ${texteHtml('document_btp.editeur.unites.memoriser')}</label>`,
      boutons: [
        { libelle: texte('document_btp.editeur.unites.convertir'), valeur: lire('PRIX'), principal: true },
        ...(qteModifiable ? [{ libelle: texte('document_btp.editeur.unites.convertir_qte'), valeur: lire('PRIX_QTE') }] : []),
        { libelle: texte('document_btp.editeur.unites.aucun'), valeur: lire('AUCUN') },
      ],
      valeurAnnulation: null,
    }).then(appliquer).finally(() => this.grille.focus?.());
    return true;
  }

  /**
   * Choix « ne plus demander pour ce document » de la conversion d'unité (Q6) : gardé dans le navigateur par document,
   * repris à la réouverture (PRIX, PRIX_QTE ou AUCUN).
   */
  get choixConversion() {
    const cle = this.#cleConversion();
    if (!cle) return this._choixConversion ?? null;
    try { return localStorage.getItem(cle) ?? this._choixConversion ?? null; } catch { return this._choixConversion ?? null; }
  }

  set choixConversion(choix) {
    this._choixConversion = choix;
    const cle = this.#cleConversion();
    if (!cle) return;
    try { if (choix) localStorage.setItem(cle, choix); else localStorage.removeItem(cle); } catch { /* stockage indisponible : mémoire seule */ }
  }

  #cleConversion() {
    const id = this.saisie?.document?.ent_groupe_id ?? this.saisie?.document?.ent_id;
    return id && Number(id) > 0 ? `logibtp.conversionUnite.${id}` : null;
  }

  /**
   * Compte comptable (grille ou détail) : code sans espaces, 20 caractères ; vide = compte hérité. Unité (détail de la
   * ligne) : même conversion du prix que dans la grille.
   */
  modifierLigne(id, champ, valeur) {
    if (champ === 'lig_unt_code') {
      const unite = String(valeur ?? '').trim().slice(0, 10) || null;
      if (this.changerUnite(id, unite)) return;
      valeur = unite;
    }
    super.modifierLigne(id, champ, champ === 'lig_cpt_code' ? String(valeur ?? '').trim().slice(0, 20) || null : valeur);
  }

  modifierCellule(id, champ, brut, colonne) {
    if (champ === 'lig_unt_code' && this.changerUnite(id, String(brut ?? '').trim().slice(0, 10) || null)) return true;
    if (champ === 'lig_cpt_code') {
      this.modifierLigne(id, champ, brut);
      return true;
    }
    if (champ === 'lig_nat_id') {
      this.magasin.modifier((d) => { d.lignes.find((y) => y.lig_id === id).lig_nat_id = brut === '' || brut === null ? null : Number(brut); }, texte('document_btp.etapes.nature'));
      return true;
    }
    if (champ === 'lig_cha_id') {
      this.magasin.modifier((d) => { d.lignes.find((y) => y.lig_id === id).lig_cha_id = brut === '' || brut === null ? null : Number(brut); }, texte('document_btp.etapes.chantier_ligne'));
      return true;
    }
    if (champ !== 'lig_pv') return super.modifierCellule(id, champ, brut, colonne);
    const valeur = lireNombre(brut);
    if (valeur === undefined) { this.surMessage?.(texte('document_btp.editeur.nombre_invalide')); return false; }
    this.magasin.modifier((d) => {
      const x = d.lignes.find((y) => y.lig_id === id);
      x.lig_pv = valeur;
      x.lig_pv_fixe = valeur !== null;
      this.regles.apresModification(d, id, 'lig_pv_fixe');
    }, texte('document_btp.etapes.pv_fixe'));
    return true;
  }

  /**
   * Compte comptable de la ligne ({ code, herite, origine, detail } ou null) : règle de comptes.js, avec les natures,
   * les taux de TVA, le type du document et la règle de ventilation posée par la page (regleVentilation).
   */
  compteLigne(l) {
    return compteLigne(l, {
      natures: this.natures ?? [], typeDocument: this.definition.type?.tyd_code ?? null,
      tauxTva: this.definition.taux_tva ?? [], regle: this.regleVentilation ?? null, compteTiers: this.compteTiersDocument(),
    });
  }

  /**
   * Compte de produit ou de charge du tiers du document (relation selon la famille), lu une fois par tiers par
   * `chargerComptesTiers(id)` posé par la page ; la grille est redessinée à son arrivée. null : inconnu ou aucun.
   */
  compteTiersDocument() {
    const id = Number(this.saisie?.document?.ent_tiers_id) || null;
    if (!id || !this.chargerComptesTiers) return null;
    this.comptesTiers ??= new Map();
    if (!this.comptesTiers.has(id)) {
      this.comptesTiers.set(id, {});
      Promise.resolve(this.chargerComptesTiers(id)).then((c) => {
        this.comptesTiers.set(id, c ?? {});
        if (c && Object.values(c).some(Boolean)) this.grille?.rendre();
      }).catch(() => {});
    }
    return this.comptesTiers.get(id)?.[relationTiers(this.definition.type?.tyd_famille ?? 'V')] ?? null;
  }

  /** Variables de libellé : données génériques + variables de calcul et de métré. */
  variablesLibelle() {
    const calcul = new Set();
    for (const v of this.resultat.variables) calcul.add(`${v.var_portee}${v.var_nom}`);
    for (const m of this.saisie.metres) if (m.mtr_variable) calcul.add(m.mtr_variable.trim());
    return [...super.variablesLibelle(), ...[...calcul].sort().map((v) => ({ valeur: `{{${v}}}`, libelle: texte('document_btp.donnees.variable', { variable: `{{${v}}}` }) }))];
  }

  actions() {
    return { ...super.actions(), ouvrirMetre: (id) => this.creerMetre(id) };
  }

  // ---------------------------------------------------------------- hôte du panneau de métré

  metreDeLigne(ligId) {
    const l = this.saisie.lignes.find((x) => x.lig_id === ligId);
    return l && this.saisie.metres.some((m) => m.mtr_id === l.lig_mtr_id) ? l.lig_mtr_id : null;
  }

  /** Section du document : son métré présente les variables du document ($$). */
  variablesDocumentSur(ligId) { return this.saisie.lignes.find((x) => x.lig_id === ligId)?.lig_tyl_id === TL.SECTION; }

  peutAvoirMetre(ligId) {
    const l = this.saisie.lignes.find((x) => x.lig_id === ligId);
    return !!l && estChiffree(l) && !l.lig_is_ecart_arrondi;
  }

  /** F4 : ouvre le métré de la ligne chiffrée, en le créant au besoin (une seule étape d'annulation). */
  creerMetre(id) {
    const l = this.saisie.lignes.find((x) => x.lig_id === id);
    if (this.variablesDocumentSur(id)) { this.ouvrirMetreExterne?.(id, null); return; }
    if (!this.peutAvoirMetre(id)) { this.surMessage?.(texte('document_btp.editeur.metre_chiffrees')); return; }
    let mtrId = this.metreDeLigne(id);
    if (mtrId === null) {
      mtrId = this.magasin.prochainId();
      // Script de départ : la quantité saisie.
      const script = `// ${texte('document_btp.editeur.metre_commentaire')}\nRenvoyer ${l.lig_qte ? String(l.lig_qte).replace(',', '.') : '0'}`;
      this.magasin.modifier((d) => {
        d.metres.push({ mtr_id: mtrId, mtr_lig_id: id, mtr_libelle: null, mtr_unt_code: l.lig_unt_code ?? null, mtr_variable: null, mtr_resultat: null, mtr_script: script });
        const x = d.lignes.find((y) => y.lig_id === id);
        x.lig_mtr_id = mtrId;
        x.lig_qte_source = 'M';
      }, texte('document_btp.etapes.creation_metre'));
    }
    this.ouvrirMetreExterne?.(id, mtrId);
  }
}
