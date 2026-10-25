import { CFG_LIGNES as C, parId, ancetres, descendants, formatNombre, formatLibre, lireNombre, echapper } from '@logibtp/socle/ui';
import {
  EditeurDocument, ReglesDocument, PressePapiers, correspondance, modifierColonne, insererColonnes, LIBELLES_TYPE,
} from '@logibtp/document/ui';
import { DictionnaireMetre } from '@logibtp/metre/ui';
import { calculerDocument, TL, CODES_TL, estChiffree, natureObligatoire } from '../calcul/index.js';
import { FONCTIONS_BTP } from '../calcul/fonctions-btp.js';
import { compteLigne, libelleCompte } from './comptes.js';
import { fraisRecus, bilanTranche } from './frais-annexes.js';

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
 * d'une ligne copiée (sa tranche de frais copiée avec elle, ou la même tranche quand on colle dans le même document),
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
    const memeDocument = (copie.source_ent_id ?? null) === (d.document.ent_id ?? null);
    const cles = (copie.ventilations ?? [])
      .filter((k) => !k._source_externe || (memeDocument && d.lignes.some((l) => l.lig_id === k.vfr_source_lig_id)))
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
    const liste = [
      ['lig_qte', 'Quantité saisie'], ['lig_unt_code', 'Unité'], ['lig_code', 'Code'],
      ['lig_libelle_html', 'Libellé (modifiable par le script : libellé calculé)'],
      ['lig_pa', 'Prix d\'achat'], ['lig_coef_perte', 'Coefficient de perte'], ['lig_coef_fg', 'Coefficient de frais généraux'],
      ['lig_coef_benef', 'Coefficient de bénéfice'], ['lig_coef_remise', 'Coefficient de remise'],
      ['lig_poids', 'Poids (kg, élément)'], ['lig_surface', 'Surface (m², élément)'], ['lig_volume', 'Volume (m³, élément)'],
      ['lig_hauteur', 'Hauteur (m, élément)'], ['lig_largeur', 'Largeur (m, élément)'], ['lig_epaisseur', 'Épaisseur (m, élément)'],
      ['lig_longueur', 'Longueur (m, élément)'],
    ];
    if (pourDefinition) liste.push(['lig_qte_vendue', 'Quantité vendue'], ['lig_qte_totale', 'Quantité totale']);
    const brut = (v) => (typeof v === 'string' && v.includes('<') ? v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : v);
    const entrees = liste.map(([col, lib]) => ({ valeur: `{{${col}}}`, libelle: lib, detail: brut(ligne[col]) ?? '', groupe: 'Ligne' }));
    const doc = this.hote.saisie.document;
    for (const [col, lib] of [
      ['ent_numero', 'Numéro du document'], ['ent_date', 'Date du document'], ['ent_objet', 'Objet'],
      ['ent_notre_reference', 'Notre référence'], ['ent_reference_externe', 'Référence externe'], ['ent_validite_jours', 'Validité (jours)'],
      ['ent_mode_calcul_ouvrage', 'Mode de calcul des ouvrages (D / V / B)'], ['ent_precision_montant', 'Décimales des montants'],
    ]) entrees.push({ valeur: `{{document.${col}}}`, libelle: lib, detail: doc?.[col] ?? '', groupe: 'Entête' });
    const parent = this.index.get(ligne.lig_parent_id);
    if (parent && estChiffree(parent)) {
      const pc = res.lignes.find((l) => l.lig_id === parent.lig_id);
      entrees.push({ valeur: `{{document_ligne[${parent.lig_id}].lig_qte_vendue}}`, libelle: 'Quantité de l\'ouvrage parent', detail: pc?.lig_qte_vendue ?? '', groupe: 'Ligne' });
    }
    if (ligne.lig_art_id) entrees.push({ valeur: '{{article.art_poids}}', libelle: 'Poids de l\'article', detail: '', groupe: 'Article' });
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
    return `ventilé ${formatLibre(Math.round(Number(b.ventile) / Number(b.prevu) * 1000) / 10, 1)} %`;
  }

  libelleType(r) { return r.estCalculee ? 'Écart' : super.libelleType(r); }

  apresSuppression(d, supprimees) {
    const metres = new Set(d.metres.filter((x) => supprimees.has(x.mtr_lig_id)).map((x) => x.mtr_id));
    d.metres = d.metres.filter((x) => !metres.has(x.mtr_id));
    d.variables = d.variables.filter((v) => !supprimees.has(v.var_lig_id) && !metres.has(v.var_mtr_id));
  }

  colonnes() {
    const chiffree = (l) => this.saisissable(l) && estChiffree(l);
    const colonnes = super.colonnes();
    const qte = colonnes.find((c) => c.cle === 'qte');
    const metreQte = (r) => estChiffree(r.calcule) && r.calcule.lig_qte_source === 'M';
    modifierColonne(colonnes, 'qte', {
      valeur: (r) => (metreQte(r) ? `ⓜ ${qte.valeur(r)}` : qte.valeur(r)),
      titreCellule: (r) => (metreQte(r) ? 'ⓜ Quantité calculée par le métré de la ligne (F4 : ouvrir le métré)' : qte.titreCellule?.(r) ?? ''),
    });
    // Nature (comme les articles de la bibliothèque) : obligatoire sur les lignes de prix pour valider.
    const nature = (id) => (this.natures ?? []).find((n) => n.id === Number(id));
    const manquante = (r) => !r.virtuelle && natureObligatoire(r.item) && (r.item.lig_nat_id === null || r.item.lig_nat_id === undefined);
    insererColonnes(colonnes, 'qte', [{
      cle: 'nature', titre: 'Nature', classe: 'col-nature', editeur: 'select', editable: chiffree,
      champ: () => 'lig_nat_id', lire: (l) => l.lig_nat_id ?? '',
      options: () => [{ valeur: '', libelle: '—' }, ...(this.natures ?? []).filter((n) => n.actif !== false).map((n) => ({ valeur: n.id, libelle: `${n.code} – ${n.libelle}` }))],
      valeur: (r) => (r.virtuelle || !estChiffree(r.item) ? '' : nature(r.item.lig_nat_id)?.code ?? (r.item.lig_nat_id ? `#${r.item.lig_nat_id}` : '')),
      classeCellule: (r) => (manquante(r) ? 'manquant' : ''),
      titreCellule: (r) => (manquante(r) ? 'Nature obligatoire pour valider le document' : nature(r.item?.lig_nat_id)?.libelle ?? ''),
    }, {
      // Compte comptable : celui de la ligne, sinon le compte hérité (nature, tiers) souligné ; saisie libre proposant le plan de comptes.
      cle: 'compte', titre: 'Compte', classe: 'col-compte', editeur: 'liste', editable: chiffree,
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
        return c.herite ? `${lib} — hérité (${c.detail}) : saisir un compte pour l'imposer à la ligne` : lib;
      },
    }]);
    insererColonnes(colonnes, 'pv', [
      {
        cle: 'pa', titre: 'PA', classe: 'col-nombre', ...this.colonneNombre('lig_pa', (l) => chiffree(l) && !this.estCompose(l)),
        valeur: (r) => (estChiffree(r.calcule) ? formatNombre(r.calcule.lig_pa, 2) : ''),
      },
      {
        cle: 'fg', titre: 'FG', classe: 'col-coef', ...this.colonneNombre('lig_coef_fg', chiffree),
        valeur: (r) => (estChiffree(r.calcule) ? this.coefAffiche(r.calcule.lig_coef_fg, this.coefsDefaut?.fg) : ''),
      },
      {
        cle: 'benef', titre: 'Bénéf.', classe: 'col-coef', ...this.colonneNombre('lig_coef_benef', chiffree),
        valeur: (r) => (estChiffree(r.calcule) ? this.coefAffiche(r.calcule.lig_coef_benef, this.coefsDefaut?.benef) : ''),
      },
      {
        // Prorata : appliqué au prix affiché après les frais annexes, avant la remise (lignes de prix).
        cle: 'prorata', titre: 'Prorata', classe: 'col-coef',
        ...this.colonneNombre('lig_coef_prorata', (l) => chiffree(l) && this.regles.estLigneDePrix(this.saisie.lignes, l)),
        valeur: (r) => (this.regles.estLigneDePrix(this.saisie.lignes, r.item) && Number(r.calcule.lig_coef_prorata ?? 1) !== 1
          ? this.coefAffiche(r.calcule.lig_coef_prorata, 1) : ''),
      },
      {
        // Frais annexes reçus (ventilation des tranches F) et coefficient qui en résulte.
        cle: 'coef_fa', titre: 'Coef. FA', classe: 'col-coef',
        valeur: (r) => (!r.virtuelle && estChiffree(r.calcule) && Number(r.calcule.lig_coef_fa ?? 1) !== 1 ? this.coefAffiche(r.calcule.lig_coef_fa, 1) : ''),
        titreCellule: () => 'Coefficient de frais annexes : 1 + frais reçus / montant hors frais',
      },
      {
        cle: 'fa_recus', titre: 'FA reçus', classe: 'col-nombre',
        valeur: (r) => {
          const v = r.virtuelle ? null : fraisRecus(this.resultat, r.item.lig_id);
          return v ? formatNombre(v, this.saisie.document.ent_precision_montant ?? 2) : '';
        },
        titreCellule: () => 'Frais annexes reçus par la ligne (somme des parts des tranches de frais)',
      },
    ]);
    // Saisir un PV impose un prix fixe (avant frais annexes et remise) ; vider la cellule le retire.
    modifierColonne(colonnes, 'pv', {
      editable: chiffree,
      lire: (l) => (l.lig_pv_fixe ? formatLibre(l.lig_pv) : ''),
      valeur: (r) => this.baseAffichee(r.calcule) ?? (estChiffree(r.calcule) ? `${r.item.lig_pv_fixe ? '🔒 ' : r.calcule.lig_pv_fixe ? '⇣ ' : ''}${formatNombre(r.calcule.lig_pv, r.calcule.lig_precision_pv ?? 2)}` : ''),
      titreCellule: (r) => (!estChiffree(r.calcule) || this.baseAffichee(r.calcule) !== null ? ''
        : r.item.lig_pv_fixe ? '🔒 PV fixe saisi (avant frais annexes et remise) : vider la cellule pour le retirer'
          : r.calcule.lig_pv_fixe ? '⇣ PV imposé par la ventilation du prix fixe d\'un ouvrage parent' : ''),
    });
    modifierColonne(colonnes, 'pvnet', {
      valeur: (r) => (estChiffree(r.calcule) ? `${r.item.lig_pv_affiche_fixe ? '🔒 ' : ''}${formatNombre(r.calcule.lig_pv_remise, r.calcule.lig_precision_pv ?? 2)}` : ''),
      titreCellule: (r) => (estChiffree(r.calcule) && r.item.lig_pv_affiche_fixe ? '🔒 PV affiché fixe (avec frais annexes) : les frais annexes s\'ajustent' : ''),
    });
    // Frais annexes et coefficient de prorata réservés aux ventes (règle FRAIS_ANNEXES, P11).
    if (this.definition.regles && this.definition.regles.FRAIS_ANNEXES === false) {
      return colonnes.filter((c) => !['prorata', 'coef_fa', 'fa_recus'].includes(c.cle));
    }
    return colonnes;
  }

  /** Compte comptable (grille ou détail) : code sans espaces, 20 caractères ; vide = compte hérité. */
  modifierLigne(id, champ, valeur) {
    super.modifierLigne(id, champ, champ === 'lig_cpt_code' ? String(valeur ?? '').trim().slice(0, 20) || null : valeur);
  }

  modifierCellule(id, champ, texte, colonne) {
    if (champ === 'lig_cpt_code') {
      this.modifierLigne(id, champ, texte);
      return true;
    }
    if (champ === 'lig_nat_id') {
      this.magasin.modifier((d) => { d.lignes.find((y) => y.lig_id === id).lig_nat_id = texte === '' || texte === null ? null : Number(texte); }, 'Nature');
      return true;
    }
    if (champ !== 'lig_pv') return super.modifierCellule(id, champ, texte, colonne);
    const valeur = lireNombre(texte);
    if (valeur === undefined) { this.surMessage?.('Nombre invalide'); return false; }
    this.magasin.modifier((d) => {
      const x = d.lignes.find((y) => y.lig_id === id);
      x.lig_pv = valeur;
      x.lig_pv_fixe = valeur !== null;
      this.regles.apresModification(d, id, 'lig_pv_fixe');
    }, 'PV fixe');
    return true;
  }

  /**
   * Compte comptable de la ligne ({ code, herite, origine, detail } ou null) : règle de comptes.js, avec les natures,
   * les taux de TVA, le type du document et la règle de ventilation posée par la page (regleVentilation).
   */
  compteLigne(l) {
    return compteLigne(l, {
      natures: this.natures ?? [], famille: this.definition.type?.tyd_famille ?? 'V', typeDocument: this.definition.type?.tyd_code ?? null,
      tauxTva: this.definition.taux_tva ?? [], regle: this.regleVentilation ?? null,
    });
  }

  /** Variables de libellé : données génériques + variables de calcul et de métré. */
  variablesLibelle() {
    const calcul = new Set();
    for (const v of this.resultat.variables) calcul.add(`${v.var_portee}${v.var_nom}`);
    for (const m of this.saisie.metres) if (m.mtr_variable) calcul.add(m.mtr_variable.trim());
    return [...super.variablesLibelle(), ...[...calcul].sort().map((v) => ({ valeur: `{{${v}}}`, libelle: `Variable {{${v}}}` }))];
  }

  actions() {
    return { ...super.actions(), ouvrirMetre: (id) => this.creerMetre(id) };
  }

  // ---------------------------------------------------------------- hôte du panneau de métré

  titreLigne(ligId) {
    const l = this.resultat.lignes.find((x) => x.lig_id === ligId);
    return `${l?.lig_numerotation ?? ''} ${l?.lig_libelle_brut ?? LIBELLES_TYPE[CODES_TL[l?.lig_tyl_id]] ?? ''}`;
  }

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
    if (!this.peutAvoirMetre(id)) { this.surMessage?.('Le métré concerne les lignes chiffrées (F4 sur la section : variables du document)'); return; }
    let mtrId = this.metreDeLigne(id);
    if (mtrId === null) {
      mtrId = this.magasin.prochainId();
      // Script de départ : la quantité saisie.
      const script = `// Métré de la ligne\nRenvoyer ${l.lig_qte ? String(l.lig_qte).replace(',', '.') : '0'}`;
      this.magasin.modifier((d) => {
        d.metres.push({ mtr_id: mtrId, mtr_lig_id: id, mtr_libelle: null, mtr_unt_code: l.lig_unt_code ?? null, mtr_variable: null, mtr_resultat: null, mtr_script: script });
        const x = d.lignes.find((y) => y.lig_id === id);
        x.lig_mtr_id = mtrId;
        x.lig_qte_source = 'M';
      }, 'Création du métré');
    }
    this.ouvrirMetreExterne?.(id, mtrId);
  }
}
