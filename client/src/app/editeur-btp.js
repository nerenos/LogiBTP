import { CFG_LIGNES as C, parId, ancetres, formatNombre, formatLibre, lireNombre } from '@logibtp/socle/ui';
import {
  EditeurDocument, ReglesDocument, PressePapiers, correspondance, modifierColonne, insererColonnes, LIBELLES_TYPE,
} from '@logibtp/document/ui';
import { DictionnaireMetre } from '@logibtp/metre/ui';
import { calculerDocument, TL, CODES_TL, estChiffree } from '../calcul/index.js';

// Spécialisation BTP de l'éditeur du module Document : moteur de devis BTP, colonnes de déboursé, PV fixe,
// lignes d'écart d'arrondi calculées, métrés et variables (module Métré). L'éditeur sert aussi d'hôte au
// panneau de métré (interface décrite dans PanneauMetre).

/** Règles BTP : coefficients hérités de l'ouvrage, exclusivité des blocages de prix, quantité saisie. */
export class ReglesBtp extends ReglesDocument {
  get champsHeritesOuvrage() { return ['lig_coef_fg', 'lig_coef_benef', ...super.champsHeritesOuvrage]; }

  apresModification(brouillon, id, champ) {
    super.apresModification(brouillon, id, champ);
    const l = brouillon.lignes.find((x) => x.lig_id === id);
    if (!l) return;
    if (champ === 'lig_pv_fixe' && l.lig_pv_fixe) l.lig_pv_affiche_fixe = false;
    if (champ === 'lig_pv_affiche_fixe' && l.lig_pv_affiche_fixe) l.lig_pv_fixe = false;
    if (champ === 'lig_qte' && l.lig_qte_source === 'M') l.lig_qte_source = 'S';
  }
}

/** Presse-papiers BTP : les métrés, lignes de métré et variables suivent les lignes copiées. */
export class PressePapiersBtp extends PressePapiers {
  extraireComplements(saisie, garder) {
    const metres = saisie.metres.filter((m) => garder.has(m.mtr_lig_id));
    const mids = new Set(metres.map((m) => m.mtr_id));
    return {
      metres,
      metre_lignes: saisie.metre_lignes.filter((x) => mids.has(x.mli_mtr_id)),
      variables: saisie.variables.filter((v) => (v.var_lig_id !== null && garder.has(v.var_lig_id)) || (v.var_mtr_id !== null && mids.has(v.var_mtr_id))),
    };
  }

  renumeroterComplements(contenu, lignes, lig, compteur) {
    const metres = contenu.metres ?? [], metreLignes = contenu.metre_lignes ?? [], variables = contenu.variables ?? [];
    const mtr = new Map(), mli = new Map();
    for (const m of metres) mtr.set(m.mtr_id, compteur.suivant());
    for (const x of metreLignes) mli.set(x.mli_id, compteur.suivant());
    const vars = variables.map(() => compteur.suivant());
    contenu.lignes.forEach((source, i) => { lignes[i].lig_mtr_id = correspondance(mtr, source.lig_mtr_id); });
    return {
      metres: metres.map((m) => ({ ...structuredClone(m), mtr_id: mtr.get(m.mtr_id), mtr_lig_id: lig.get(m.mtr_lig_id) })),
      metre_lignes: metreLignes.map((x) => ({
        ...structuredClone(x), mli_id: mli.get(x.mli_id), mli_mtr_id: mtr.get(x.mli_mtr_id),
        mli_parent_id: correspondance(mli, x.mli_parent_id), mli_st_depuis_id: correspondance(mli, x.mli_st_depuis_id),
      })),
      variables: variables.map((v, i) => ({
        ...structuredClone(v), var_id: vars[i], var_lig_id: correspondance(lig, v.var_lig_id), var_mtr_id: correspondance(mtr, v.var_mtr_id),
      })),
    };
  }

  insererComplements(d, copie) {
    d.metres.push(...copie.metres);
    d.metre_lignes.push(...copie.metre_lignes);
    d.variables.push(...copie.variables.map((v) => ({ ...v, var_ent_id: d.document.ent_id })));
  }
}

/**
 * Dictionnaire BTP : règles de portée du moteur — $$ document, $ titre (et titres englobants), @@ ouvrage
 * (et ouvrages englobants), @ ligne courante ; seules les variables définies avant la ligne sont lisibles.
 */
export class DictionnaireBtp extends DictionnaireMetre {
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
    const liste = [['lig_qte', 'Quantité saisie'], ['lig_pa', 'Prix d\'achat'], ['lig_coef_perte', 'Coefficient de perte']];
    if (pourDefinition) liste.push(['lig_qte_vendue', 'Quantité vendue'], ['lig_qte_totale', 'Quantité totale']);
    const entrees = liste.map(([col, lib]) => ({ valeur: `{{${col}}}`, libelle: lib, detail: ligne[col] ?? '', groupe: 'Ligne' }));
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
    return { ...super.entree(saisie), metres: saisie.metres, metre_lignes: saisie.metre_lignes, variables: saisie.variables };
  }

  identifiants(saisie, resultat) {
    return [
      ...super.identifiants(saisie, resultat),
      ...saisie.metres.map((m) => m.mtr_id), ...saisie.metre_lignes.map((m) => m.mli_id), ...saisie.variables.map((v) => v.var_id),
    ];
  }

  nouvelleLigne(id, type, entId) {
    return {
      ...super.nouvelleLigne(id, type, entId),
      lig_qte_source: 'S', lig_coef_perte: 1, lig_pa: null, lig_coef_fg: 1, lig_coef_benef: 1,
      lig_pv_fixe: false, lig_pv_affiche_fixe: false, lig_is_ecart_arrondi: false, lig_pied_is_fa: false,
    };
  }

  estLigneCalculee(l) { return !!l.lig_is_ecart_arrondi; }

  libelleType(r) { return r.estCalculee ? 'Écart' : super.libelleType(r); }

  apresSuppression(d, supprimees) {
    const metres = new Set(d.metres.filter((x) => supprimees.has(x.mtr_lig_id)).map((x) => x.mtr_id));
    d.metres = d.metres.filter((x) => !metres.has(x.mtr_id));
    d.metre_lignes = d.metre_lignes.filter((x) => !metres.has(x.mli_mtr_id));
    d.variables = d.variables.filter((v) => !supprimees.has(v.var_lig_id) && !metres.has(v.var_mtr_id));
  }

  colonnes() {
    const chiffree = (l) => this.saisissable(l) && estChiffree(l);
    const colonnes = super.colonnes();
    const qte = colonnes.find((c) => c.cle === 'qte');
    modifierColonne(colonnes, 'qte', {
      valeur: (r) => {
        const v = qte.valeur(r);
        return estChiffree(r.calcule) && r.calcule.lig_qte_source === 'M' ? `ⓜ ${v}` : v;
      },
    });
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
    ]);
    // Saisir un PV impose un prix fixe (avant frais annexes et remise) ; vider la cellule le retire.
    modifierColonne(colonnes, 'pv', {
      editable: chiffree,
      lire: (l) => (l.lig_pv_fixe ? formatLibre(l.lig_pv) : ''),
      valeur: (r) => this.baseAffichee(r.calcule) ?? (estChiffree(r.calcule) ? `${r.item.lig_pv_fixe ? '🔒 ' : r.calcule.lig_pv_fixe ? '⇣ ' : ''}${formatNombre(r.calcule.lig_pv, r.calcule.lig_precision_pv ?? 2)}` : ''),
    });
    modifierColonne(colonnes, 'pvnet', {
      valeur: (r) => (estChiffree(r.calcule) ? `${r.item.lig_pv_affiche_fixe ? '🔒 ' : ''}${formatNombre(r.calcule.lig_pv_remise, r.calcule.lig_precision_pv ?? 2)}` : ''),
    });
    return colonnes;
  }

  modifierCellule(id, champ, texte, colonne) {
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

  /** Variables de libellé : données génériques + variables de calcul et de métré. */
  variablesLibelle() {
    const calcul = new Set();
    for (const v of this.resultat.variables) calcul.add(`${v.var_portee}${v.var_nom}`);
    for (const m of this.saisie.metres) if (m.mtr_variable) calcul.add(m.mtr_variable.trim());
    for (const x of this.saisie.metre_lignes) if (x.mli_variable) calcul.add(x.mli_variable.trim());
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

  peutAvoirMetre(ligId) {
    const l = this.saisie.lignes.find((x) => x.lig_id === ligId);
    return !!l && estChiffree(l) && !l.lig_is_ecart_arrondi;
  }

  /** F4 : ouvre le métré de la ligne chiffrée, en le créant au besoin (une seule étape d'annulation). */
  creerMetre(id) {
    const l = this.saisie.lignes.find((x) => x.lig_id === id);
    if (!this.peutAvoirMetre(id)) { this.surMessage?.('Le métré concerne les lignes chiffrées'); return; }
    let mtrId = this.metreDeLigne(id);
    if (mtrId === null) {
      mtrId = this.magasin.prochainId();
      const mliId = mtrId - 1;
      this.magasin.modifier((d) => {
        d.metres.push({ mtr_id: mtrId, mtr_lig_id: id, mtr_libelle: null, mtr_unt_code: l.lig_unt_code ?? null, mtr_variable: null, mtr_resultat: null });
        d.metre_lignes.push({ mli_id: mliId, mli_mtr_id: mtrId, mli_parent_id: null, mli_ordre: 1, mli_type: 'V', mli_operateur: '+', mli_formule: l.lig_qte ? String(l.lig_qte).replace('.', ',') : '', mli_commentaire: null });
        const x = d.lignes.find((y) => y.lig_id === id);
        x.lig_mtr_id = mtrId;
        x.lig_qte_source = 'M';
      }, 'Création du métré');
    }
    this.ouvrirMetreExterne?.(id, mtrId);
  }
}
