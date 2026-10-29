import {
  CFG_LIGNES as C, ordreAffichage, parId, placer, indenter, desindenter, decaler, supprimer, racinesSelection,
  Magasin, GrilleArbre, formatNombre, formatLibre, htmlSur, lireNombre, estHtml, decoderEntites, echapper,
  editerLibelle, lirePreferences, ecrirePreferences, enfants, libelleRaccourci,
} from '@logibtp/socle/ui';
import { Dz } from '@logibtp/socle';
import { calculerDocument, TL, CODES_TL, estChiffree, estPied, accepteEnfants, estTranche, estTypeNumerote, etatSolde, regle } from '../src/index.js';
import { ReglesDocument } from './regles.js';
import { PressePapiers } from './presse-papiers.js';

/** Date saisie dans la grille (JJ/MM/AAAA, JJ/MM/AA, JJ/MM de l'année en cours, AAAA-MM-JJ) en ISO ; null si vide, undefined si illisible. */
export function lireDateSaisie(texte, aujourdhui = new Date()) {
  const t = String(texte ?? '').trim();
  if (t === '') return null;
  let a; let m; let j;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const fr = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (iso) [, a, m, j] = iso.map(Number);
  else if (fr) { j = Number(fr[1]); m = Number(fr[2]); a = fr[3] ? Number(fr[3].length === 2 ? `20${fr[3]}` : fr[3]) : aujourdhui.getFullYear(); }
  else return undefined;
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return undefined;
  return d.toISOString().slice(0, 10);
}

/** Date ISO affichée JJ/MM/AAAA. */
const dateCourte = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** Libellés des totaux calculés et des groupes du pied (structure résultat.pied du moteur). */
/** Variables des textes d'introduction et de conclusion : données de l'entête et totaux (éditeur et paramétrage). */
export function variablesTexteDocument() {
  return [
    ['ent_numero', 'Numéro du document'], ['ent_date', 'Date'], ['ent_objet', 'Objet'], ['ent_notre_reference', 'Notre référence'],
    ['ent_reference_externe', 'Référence externe'], ['ent_validite_jours', 'Validité (jours)'], ['ent_date_validite', 'Fin de validité'],
    ['ent_total_ht', 'Total HT'], ['ent_total_tva', 'Total TVA'], ['ent_total_ttc', 'Total TTC'], ['ent_net_a_payer', 'Net à payer'],
  ].map(([v, l]) => ({ valeur: `{{${v}}}`, libelle: `${l} – {{${v}}}` }));
}

export const LIBELLES_PIED = {
  TOTAL_HT: 'Total HT', HT_NET: 'Total HT net', TOTAL_TTC: 'Total TTC', SOUS_TOTAL: 'Sous-total', NET: 'Net à payer',
  HT: 'Postes de pied HT', TTC: 'Postes de pied TTC', TVA: 'TVA',
};

/** Identifiant de la tranche calculée « Pied du document » (lignes virtuelles : identifiants ≤ −9·10¹¹). */
export const ID_PIED = -9e11;

/** Colonnes du reste à solder (documents issus d'une transformation : BL, factures, avoirs). */
export const COLONNES_RESTE = ['qte_parent', 'reste', 'solde'];

/** Colonnes de l'avancement (situations, factures d'avancement). */
export const COLONNES_AVANCEMENT = ['avt_pct_prec', 'avt_pct', 'avt_qte', 'avt_montant', 'avt_precedent'];
/**
 * Structure de pied pour l'affichage : un sous-total saisi entre deux groupes de postes HT (remise, sous-total,
 * compte prorata) rejoint un seul groupe « Postes de pied HT », au même niveau que les postes ; montant du groupe =
 * somme des deux groupes. Le calcul n'est pas touché.
 */
function regrouperSousTotauxHt(pied) {
  const res = [];
  for (let i = 0; i < pied.length; i++) {
    const e = pied[i];
    const avant = res.at(-1);
    const apres = pied[i + 1];
    const groupeHt = (x) => x?.genre === 'groupe' && x.cle === 'HT';
    if (e.genre === 'ligne' && groupeHt(avant) && groupeHt(apres)) {
      res[res.length - 1] = {
        ...avant, lignes: [...(avant.lignes ?? []), e.lig_id, ...(apres.lignes ?? [])], montant: Dz(avant.montant).plus(Dz(apres.montant)).toString(),
      };
      i++;
      continue;
    }
    res.push(e);
  }
  return res;
}

// Champs libres d'une ligne reprise du parent dans un document d'avancement (avec la saisie de l'avancement, avt:…).
const CHAMPS_LIBRES_AVANCEMENT = ['lig_commentaire', 'lig_etiquette', 'lig_is_non_editee', 'lig_solde'];
// Colonnes de ventilation (clés des documents transformés) dans un document d'avancement : [clé, colonne d'avancement, titre].
export const ALIAS_AVANCEMENT = [
  ['qte_parent', 'avt_qte_marche', 'Qté parent'], ['montant_parent', 'avt_montant_marche', 'Montant parent'],
  ['pct_prec', 'avt_pct_prec', '% préc.'], ['qte_prec', 'avt_qte_prec', 'Qté préc.'], ['montant_prec', 'avt_precedent', 'Montant préc.'],
  ['pct_periode', 'avt_pct_periode', '% période'],
  ['pct_cumul', 'avt_pct', '% cumul'], ['qte_cumul', 'avt_qte', 'Qté cumul'], ['montant_cumul', 'avt_montant', 'Montant cumul'],
];

/** Libellés des bases de calcul d'une ligne de pied (lig_pied_base). */
export const LIBELLES_BASE_PIED = { CUMUL: 'Cumul à ce point', TOTAL_HT: 'Total HT du corps', HT_NET: 'Dernier total HT net', TOTAL_TTC: 'Total TTC du corps', LIGNE: 'Sous-total de pied' };

const lireJson = (v, defaut) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return defaut; } })() : v ?? defaut);

/** Texte brut d'une valeur (colonnes système du mode débogage). */
const texteSysteme = (v) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Types MIME des éléments glissés depuis une autre fenêtre (bibliothèque) et type de ligne créé : un article donne
 * un élément, un ouvrage un ouvrage avec ses composantes, un ensemble une tranche (titre) avec ses lignes.
 */
export const TYPES_DEPOT = {
  'application/x-logibtp-article': TL.ELEMENT, 'application/x-logibtp-ouvrage': TL.OUVRAGE, 'application/x-logibtp-ensemble': TL.TITRE,
};

export const LIBELLES_TYPE_PRIX = { V: 'Vendu', O: 'Option', M: 'Pour mémoire', A: 'Variante', F: 'Frais annexes' };

export const LIBELLES_TYPE = {
  TITRE: 'Titre', OUVRAGE: 'Ouvrage', ELEMENT: 'Élément', TEXTE: 'Texte', SOUS_TOTAL: 'S-total',
  IMAGE: 'Image', SAUT_PAGE: 'Saut', PIED_HT: 'Pied HT', PIED_TTC: 'Pied TTC', TVA: 'TVA', SECTION: 'Section',
};

/** Remplace (fusionne) la colonne `cle` d'une liste de colonnes. */
export function modifierColonne(colonnes, cle, modif) {
  const i = colonnes.findIndex((c) => c.cle === cle);
  if (i >= 0) colonnes[i] = { ...colonnes[i], ...modif };
  return colonnes;
}

/** Insère des colonnes avant la colonne `cle` (à la fin si elle n'existe pas). */
export function insererColonnes(colonnes, avantCle, nouvelles) {
  const i = colonnes.findIndex((c) => c.cle === avantCle);
  colonnes.splice(i < 0 ? colonnes.length : i, 0, ...nouvelles);
  return colonnes;
}

/**
 * Éditeur d'un document (classe mère) : état de saisie, recalcul local à chaque modification, grille des lignes.
 * Les panneaux (entête, détail, totaux…) s'abonnent au magasin.
 *
 * Points de spécialisation : calculer (moteur), entree, identifiants, nouvelleLigne, creerRegles, creerPressePapiers,
 * colonnes, saisissable, estLigneCalculee, variablesLibelle, apresSuppression, actions.
 *
 * Options de l'hôte : appelerCode(ligId, code) (saisie dans la colonne Code : appel d'une référence, ex. bibliothèque),
 * rechercher(ligId) (F3 : recherche d'une référence), vue (vue de colonnes : { colonnes: [{ cle }], debogage, systeme }).
 *
 * Affichage : pastille de début de ligne (étiquette en haut à gauche, mode de vente en bas à droite), colonnes de la
 * vue choisie (colonnes système en mode débogage), pied en tranches (postes HT, TVA par taux, postes TTC) avec les
 * totaux calculés (un total égal au suivant n'est pas affiché).
 */
export class EditeurDocument {
  /** `pied` : false pour une saisie sans pied (composition d'un ouvrage) : ni tranche du pied, ni lignes de pied. */
  constructor(conteneur, { definition, saisie, surSelection, surMessage, appelerCode = null, rechercher = null, vue = null, pied = true }) {
    this.definition = definition;
    this.avecPied = pied;
    this.vue = vue;
    this.filtre = null;
    // Filtre d'affichage par pastille : étiquettes ('' : sans étiquette) et modes de vente (V, O, M, A).
    this.filtreMarqueurs = { etiquettes: new Set(), types: new Set() };
    this.appelerCode = appelerCode;
    this.rechercherExterne = rechercher;
    this.surSelection = surSelection;
    this.surMessage = surMessage;
    this.regles = this.creerRegles();
    this.pressePapiers = this.creerPressePapiers();
    this.coupees = new Set();
    // Document issu d'une transformation : libellés sur une ligne par défaut (préférence propre à ces documents) et
    // ouvrages repliés à l'ouverture (composantes masquées), pour privilégier la ventilation.
    this.transforme = EditeurDocument.estTransforme(saisie);
    const preferences = lirePreferences();
    this.libellesUneLigne = (this.transforme ? preferences.libellesTransformes ?? 'ligne' : preferences.libelles) === 'ligne';
    conteneur.classList.toggle('libelles-une-ligne', this.libellesUneLigne);
    conteneur.classList.toggle('document-transforme', this.transforme);
    this.magasin = new Magasin(saisie, {
      recalculer: (s) => this.figerResultat(this.calculer(this.entree(s)), s),
      identifiants: (s, r) => this.identifiants(s, r),
    });
    this.grille = new GrilleArbre(conteneur, {
      cle: 'lig_id',
      colonnes: this.colonnesAffichees(),
      lignes: (replies) => this.lignesGrille(replies),
      actions: this.actions(),
    });
    this.magasin.abonner(() => this.grille.rendre());
    if (this.transforme) for (const id of this.lignesRepliables({ ouvrages: true })) this.grille.replies.add(id);
    this.grille.rendre();
  }

  // ---------------------------------------------------------------- document d'avancement

  /** Situation, facture d'avancement, reprise : lignes reprises du marché, seuls l'avancement et le commentaire se saisissent. */
  get estAvancement() {
    return Boolean(this.saisie.document.ent_avt_presentation) || ['S', 'F', 'R'].includes(this.definition.type?.tyd_avancement);
  }

  /** Ligne reprise du document parent (commande du marché) dans un document d'avancement. */
  ligneDuParent(l) { return this.estAvancement && l?.lig_origine_id !== null && l?.lig_origine_id !== undefined; }

  /**
   * Champ non modifiable : sur une ligne reprise du parent d'un document d'avancement, tout sauf l'avancement (avt:…),
   * le commentaire du document et l'affichage (étiquette, impression).
   */
  champVerrouille(l, champ) {
    if (!this.ligneDuParent(l) || champ === null || champ === undefined) return false;
    return !String(champ).startsWith('avt:') && !CHAMPS_LIBRES_AVANCEMENT.includes(champ);
  }

  /** Règle LIGNES_AUTORISEES (R11) : TEXTE_PIED = seuls du texte et des lignes de pied s'ajoutent (documents d'avancement). */
  get lignesLimitees() {
    return regle(this.definition, 'LIGNES_AUTORISEES', this.estAvancement ? 'TEXTE_PIED' : 'TOUTES') === 'TEXTE_PIED';
  }

  /** Lignes ajoutables : selon la règle, toutes, ou du texte et des lignes de pied seulement. */
  ajoutAutorise(lignes) {
    return !this.lignesLimitees || lignes.every((l) => l.lig_tyl_id === TL.TEXTE || estPied(l));
  }

  /**
   * Poste de pied ajouté depuis un groupe vide du pied (document ou section) : un poste HT se place avant la ventilation
   * TVA, les postes TTC et les sous-totaux de pied de sa portée (sinon à la fin), un poste TTC à la fin de la racine,
   * précédé d'une ligne de ventilation TVA s'il n'y en a pas (sans elle, le moteur calculerait le poste avant la TVA).
   * Retourne l'identifiant de la nouvelle ligne.
   */
  insererPoste({ cle, section }, valeurs = {}) {
    const type = cle === 'HT' ? TL.PIED_HT : TL.PIED_TTC;
    const id = this.magasin.prochainId();
    const taux = this.definition.taux_tva;
    this.magasin.modifier((d) => {
      if (type === TL.PIED_TTC && !enfants(C, d.lignes, section).some((l) => l.lig_tyl_id === TL.TVA)) {
        d.lignes.push({ ...this.nouvelleLigne(id - 1, TL.TVA, d.document.ent_id), lig_libelle_html: 'TVA' });
        placer(C, d.lignes, [d.lignes.at(-1)], section, section === null ? 'racine' : 'enfant');
      }
      d.lignes.push({ ...this.nouvelleLigne(id, type, d.document.ent_id), ...valeurs, lig_id: id, lig_tyl_id: type });
      const x = d.lignes.at(-1);
      const freres = enfants(C, d.lignes, section).filter((l) => l !== x);
      const suivant = type === TL.PIED_HT
        ? freres.find((l, i) => l.lig_tyl_id === TL.TVA || l.lig_tyl_id === TL.PIED_TTC
          || (l.lig_tyl_id === TL.SOUS_TOTAL && freres.slice(0, i).some((f) => estPied(f))))
        : null;
      if (suivant) placer(C, d.lignes, [x], suivant.lig_id, 'avant');
      else if (section !== null) placer(C, d.lignes, [x], section, 'enfant');
      else placer(C, d.lignes, [x], null, 'racine');
      this.regles.appliquerContexte(d, id, taux);
    }, 'Poste de pied');
    return id;
  }

  /** Aucune ligne reprise du parent parmi les lignes (suppression, déplacement d'un document d'avancement). */
  #sansLigneDuParent(ids, action) {
    const parId = new Map(this.saisie.lignes.map((l) => [l.lig_id, l]));
    if (!ids.some((id) => this.ligneDuParent(parId.get(id)))) return true;
    this.surMessage?.(`${action} impossible : ligne reprise du document parent`);
    return false;
  }

  /** Colonnes saisissables seulement si le champ n'est pas verrouillé (lignes reprises d'un document d'avancement). */
  #verrouiller(colonnes) {
    if (!this.estAvancement) return colonnes;
    return colonnes.map((c) => (typeof c.editable !== 'function' ? c
      : { ...c, editable: (l) => c.editable(l) && !this.champVerrouille(l, c.champ?.(l) ?? null) }));
  }

  /**
   * Document figé (validé) : on affiche ce qui a été validé, sans recalcul (P5) — valeurs enregistrées de l'entête et des
   * lignes reportées sur le résultat du moteur (seules les données d'affichage dérivées viennent du calcul).
   */
  figerResultat(r, s) {
    const statut = this.definition.statuts?.find((x) => x.std_id === s.document?.ent_std_id);
    if (!(s.document?.ent_verrouille || statut?.std_modifiable === false) || !r?.lignes) return r;
    const parId = new Map(s.lignes.map((l) => [l.lig_id, l]));
    const garder = (cible, source) => {
      for (const [k, v] of Object.entries(source)) if (v !== null && v !== undefined && k in cible && typeof v !== 'object') cible[k] = v;
    };
    for (const l of r.lignes) { const e = parId.get(l.lig_id); if (e) garder(l, e); }
    if (r.document) garder(r.document, s.document);
    return r;
  }

  /** Document issu d'une transformation (lignes liées à un parent) ou document d'avancement. */
  static estTransforme(saisie) {
    return Boolean(saisie.document?.ent_avt_presentation) || (saisie.lignes ?? []).some((l) => l.lig_origine_id);
  }

  get saisie() { return this.magasin.saisie; }
  get resultat() { return this.magasin.resultat; }

  // ---------------------------------------------------------------- spécialisation

  creerRegles() { return new ReglesDocument(); }
  creerPressePapiers() { return new PressePapiers(); }

  /** Moteur de calcul local. */
  calculer(entree) { return calculerDocument(entree); }

  entree(saisie) {
    const statut = this.definition.statuts?.find((s) => s.std_id === saisie.document.ent_std_id);
    return {
      document: saisie.document,
      lignes: saisie.lignes,
      taux_tva: this.definition.taux_tva,
      entites: saisie.entites ?? {},
      options: { libelles_figes: statut ? !statut.std_modifiable : false },
    };
  }

  /** Nouvelle ligne avec les valeurs par défaut du DDL. */
  nouvelleLigne(id, type, entId) {
    const pied = type === TL.PIED_HT || type === TL.PIED_TTC;
    return {
      lig_id: id, lig_ent_id: entId ?? 0, lig_parent_id: null, lig_ordre: 0, lig_tyl_id: type,
      lig_numerotation: null, lig_num_depart: null, lig_num_manuelle: false, lig_libelle_html: '',
      lig_qte: null, lig_qte_type: null, lig_precision_qte: 2, lig_pv: null, lig_coef_remise: 1, lig_precision_pv: 2,
      lig_type_prix: 'V', lig_pied_mode: pied ? 'P' : null, lig_pied_base: null, lig_pied_sens: pied ? -1 : null,
      lig_pied_valeur: null, lig_tva_id: null, lig_is_non_editee: false, lig_proprietes: {},
    };
  }

  /** ID déjà utilisés (lignes saisies et calculées, compléments) : base des ID temporaires négatifs. */
  identifiants(saisie, resultat) {
    return [...saisie.lignes.map((l) => l.lig_id), ...(resultat?.lignes ?? []).map((l) => l.lig_id)];
  }

  /** Ligne modifiable par l'utilisateur (une ligne calculée par le moteur ou un total du pied ne l'est pas). */
  saisissable(l) { return !this.magasin?.lectureSeule && !this.fige && !l._virtuelle && !this.estLigneCalculee(l); }

  /** Date de livraison par défaut des lignes (ISO) : aucune ici ; l'application la lit dans l'entête (point d'accroche). */
  dateLivraisonDefaut() { return null; }

  /** Document figé : validé (verrouillé) ou dans un statut non modifiable ; les lignes se consultent seulement. */
  get fige() {
    const d = this.saisie.document;
    const statut = this.definition.statuts?.find((s) => s.std_id === d.ent_std_id);
    return Boolean(d.ent_verrouille) || statut?.std_modifiable === false;
  }

  // ---------------------------------------------------------------- vues de colonnes

  /** Colonnes de la vue (dans son ordre), et colonnes système en mode débogage ; sans vue : toutes les colonnes. */
  colonnesAffichees() {
    const catalogue = this.#verrouiller(this.colonnes());
    if (!this.vue?.colonnes?.length) return catalogue;
    const parCle = new Map(catalogue.map((c) => [c.cle, c]));
    // Document issu d'une transformation : colonnes du reste à solder ajoutées après la quantité si la vue n'en a
    // aucune (vues créées avant elles).
    const colonnesVue = [...this.vue.colonnes];
    const ajouter = (cles, equivalentes = []) => {
      if (colonnesVue.some((c) => cles.includes(c.cle) || equivalentes.includes(c.cle))) return;
      const i = colonnesVue.findIndex((c) => c.cle === 'qte');
      colonnesVue.splice(i < 0 ? colonnesVue.length : i + 1, 0, ...cles.map((cle) => ({ cle })));
    };
    if (this.restes?.parLigne.size) ajouter(COLONNES_RESTE);
    // Document d'avancement : colonnes de l'avancement après la quantité si la vue n'en a aucune.
    if (this.saisie.document.ent_avt_presentation) ajouter(COLONNES_AVANCEMENT, ALIAS_AVANCEMENT.map(([cle]) => cle));
    // Largeur réglée (px) portée par la vue ; la première colonne porte l'arborescence (repli des lignes).
    const res = colonnesVue.filter((c) => parCle.has(c.cle))
      .map((c, i) => ({ ...parCle.get(c.cle), ...(c.titre ? { titre: c.titre } : {}), largeur: c.largeur ?? null, arbre: i === 0 }));
    if (!res.length) return catalogue;
    if (this.vue.debogage) {
      const choisis = this.vue.systeme ?? [];
      res.push(...this.colonnesSysteme().filter((c) => !choisis.length || choisis.includes(c.champ)));
    }
    return res;
  }

  /**
   * Restes à solder d'un document issu d'une transformation (GET /documents/{id}/restes, posé par l'hôte) :
   * { seuil_pct, seuil_qte, lignes: [{ lig_id, source_lig_id, etape, qte_parent, autres, autres_brouillons, solde }] }.
   * Ajoute les colonnes Qté parent, Reste et Soldé ; null les retire.
   */
  definirRestes(restes) {
    this.restes = restes?.lignes?.length
      ? { seuilPct: restes.seuil_pct ?? 0, seuilQte: restes.seuil_qte ?? 0, parLigne: new Map(restes.lignes.map((l) => [l.lig_id, l])) }
      : null;
    this.grille.definirColonnes(this.colonnesAffichees());
  }

  /**
   * État de solde d'une ligne : { info, etat, avant } ou null. etat : avec la quantité en cours de saisie et la case
   * Soldé ; avant : sans ce document (ligne déjà entièrement transformée ou soldée ailleurs).
   */
  soldeLigne(r) {
    const info = r.virtuelle ? null : this.restes?.parLigne.get(r.item.lig_id);
    if (!info) return null;
    const base = { qte_parent: info.qte_parent, solde: info.solde, seuil_pct: this.restes.seuilPct, seuil_qte: this.restes.seuilQte };
    return {
      info,
      etat: etatSolde({ ...base, transforme: Dz(info.autres).plus(Dz(r.calcule.lig_qte_vendue)), force: Boolean(r.item.lig_solde) }),
      avant: etatSolde({ ...base, transforme: info.autres, force: false }),
    };
  }

  /** Vue de colonnes appliquée à la grille. */
  appliquerVue(vue) {
    this.vue = vue;
    this.grille.definirColonnes(this.colonnesAffichees());
    this.surVue?.(vue); // l'hôte suit le mode débogage de la vue
  }

  /**
   * Colonnes déplacées ou redimensionnées dans la grille ([{ cle, largeur }]) : la vue affichée prend cet ordre et ces
   * largeurs (colonnes système exclues : elles restent à la fin) ; l'hôte les mémorise (surDisposition(vue)).
   */
  modifierDisposition(disposition) {
    const colonnes = disposition.filter((c) => !c.cle.startsWith('sys:')).map(({ cle, largeur }) => (largeur ? { cle, largeur } : { cle }));
    this.vue = { debogage: false, systeme: [], ...this.vue, colonnes };
    // La grille a déjà appliqué l'ordre et les largeurs ; colonnes redéfinies si l'arborescence n'est plus portée
    // par la première colonne seule.
    if (this.grille.o.colonnes.some((c, i) => Boolean(c.arbre) !== (i === 0))) this.grille.definirColonnes(this.colonnesAffichees());
    this.surDisposition?.(this.vue);
  }

  /** Champs des lignes (saisie et calcul) affichables en mode débogage, plus les contrôles de la ligne. */
  champsSysteme() {
    const champs = new Set();
    for (const l of [...this.saisie.lignes, ...(this.resultat?.lignes ?? [])]) for (const k of Object.keys(l)) champs.add(k);
    return ['_controles', ...[...champs].filter((k) => !k.startsWith('_')).sort()];
  }

  /** Colonnes système (débogage) : valeurs brutes calculées, en lecture seule. */
  colonnesSysteme() {
    return this.champsSysteme().map((champ) => ({
      cle: `sys:${champ}`, champ, titre: champ === '_controles' ? 'Contrôles' : champ, classe: 'col-systeme', editable: () => false,
      valeur: (r) => (champ === '_controles' ? r.messages.map((m) => m.code).join(' ') : r.virtuelle ? '' : texteSysteme(r.calcule[champ] ?? r.item[champ])),
    }));
  }

  // ---------------------------------------------------------------- étiquettes et pastille

  /** Étiquettes de lignes : globales (définition), complétées ou personnalisées par le document (ent_etiquettes). */
  etiquettes() {
    const m = new Map((this.definition.etiquettes ?? []).filter((e) => e.actif !== false).map((e) => [e.code, { ...e, origine: 'globale' }]));
    for (const e of lireJson(this.saisie.document.ent_etiquettes, [])) {
      if (e?.code) m.set(e.code, { ...m.get(e.code), ...e, origine: m.has(e.code) ? 'personnalisee' : 'document' });
    }
    return [...m.values()];
  }

  couleurTypePrix(type) { return (this.definition.couleurs_type_prix ?? []).find((c) => c.type === type) ?? null; }

  /** Type de prix effectif : celui de la ligne, sinon hérité de la tranche (ou de l'ouvrage) englobante. */
  typePrixEffectif(l) {
    if ((l.lig_type_prix ?? 'V') !== 'V') return l.lig_type_prix;
    if (this.typesPrixDe?.resultat !== this.resultat) {
      this.typesPrixDe = { resultat: this.resultat, parId: new Map((this.resultat?.lignes ?? []).map((x) => [x.lig_id, x])) };
    }
    const parId = this.typesPrixDe.parId;
    for (let x = parId.get(l.lig_parent_id); x; x = parId.get(x.lig_parent_id)) if ((x.lig_type_prix ?? 'V') !== 'V') return x.lig_type_prix;
    return 'V';
  }

  /** Complément affiché après le montant d'une tranche dans le plan (ventilation des frais annexes… en spécialisation). */
  complementTranche(_ligne) { return null; }

  /** Demi-pastille du mode de vente (hors « vendu ») : { fond, libelle } ou null. */
  pastilleTypePrix(l) {
    const type = this.typePrixEffectif(l);
    if (type === 'V') return null;
    const c = this.couleurTypePrix(type);
    return { fond: `linear-gradient(135deg, transparent 50%, ${c?.couleur ?? 'var(--discret)'} 50%)`, libelle: c?.libelle ?? LIBELLES_TYPE_PRIX[type] ?? type };
  }

  /** Pastille : couleur de l'étiquette (haut gauche), couleur du mode de vente hors « vendu » (bas droite). */
  marqueur(r) {
    if (r.virtuelle) return null;
    const l = r.item;
    const e = l.lig_etiquette ? this.etiquettes().find((x) => x.code === l.lig_etiquette) : null;
    const type = this.typePrixEffectif(l);
    const t = type !== 'V' ? this.couleurTypePrix(type) ?? { libelle: LIBELLES_TYPE_PRIX[type] ?? type, couleur: '#94a3b8' } : null;
    const c1 = e?.couleur ?? null, c2 = t?.couleur ?? null;
    const fond = c1 && c2 ? `linear-gradient(135deg, ${c1} 50%, ${c2} 50%)` : c1 ?? (c2 ? `linear-gradient(135deg, transparent 50%, ${c2} 50%)` : 'transparent');
    const titre = [e ? e.libelle : (l.lig_etiquette ? `Étiquette ${l.lig_etiquette}` : 'Sans étiquette'), t?.libelle].filter(Boolean).join(' · ');
    return { fond, titre: `${titre} — cliquer pour choisir l'étiquette` };
  }

  /** Choix de l'étiquette (lignes sélectionnées si la ligne en fait partie). */
  choisirEtiquette(id, ancre) {
    document.querySelector('.menu-etiquettes')?.remove();
    const ids = this.grille.selection.includes(id) ? this.grille.selection : [id];
    const lignes = ids.filter((x) => this.saisie.lignes.some((l) => l.lig_id === x));
    if (!lignes.length) return;
    if (this.magasin.lectureSeule) { this.magasin.surRefus?.(); return; }
    const menu = document.createElement('div');
    menu.className = 'menu-etiquettes';
    menu.innerHTML = `${this.etiquettes().map((e) => `<button type="button" data-code="${echapper(e.code)}"><span class="pastille" style="background:${echapper(e.couleur)}"></span>${echapper(e.libelle)}${e.origine === 'document' ? ' <small>(document)</small>' : ''}</button>`).join('')}
      <button type="button" data-code=""><span class="pastille"></span>Aucune étiquette</button>`;
    const r = ancre.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 2}px`;
    document.body.append(menu);
    const fermer = () => { menu.remove(); document.removeEventListener('mousedown', dehors, true); };
    const dehors = (e) => { if (!menu.contains(e.target)) fermer(); };
    document.addEventListener('mousedown', dehors, true);
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-code]');
      if (!b) return;
      fermer();
      this.magasin.modifier((d) => { for (const l of d.lignes) if (lignes.includes(l.lig_id)) l.lig_etiquette = b.dataset.code || null; }, 'Étiquette');
      this.grille.focus();
    });
  }

  /** Ligne créée par le moteur (écart d'arrondi…). */
  estLigneCalculee(_l) { return false; }

  /** Compléments à retirer avec des lignes supprimées (métrés…). */
  apresSuppression(_brouillon, _supprimees) {}

  // ---------------------------------------------------------------- lignes affichées

  lignesGrille(replies) {
    const calc = this.resultat.lignes;
    const saisies = parId(C, this.saisie.lignes);
    const erreurs = new Map();
    for (const e of [...this.resultat.erreurs, ...this.resultat.avertissements]) {
      if (e.lig_id === null) continue;
      if (!erreurs.has(e.lig_id)) erreurs.set(e.lig_id, []);
      erreurs.get(e.lig_id).push(e);
    }
    const avecEnfants = new Set(calc.map((l) => l.lig_parent_id).filter((p) => p !== null));
    const lignes = ordreAffichage(C, calc, replies).map(({ item, profondeur }) => ({
      item: saisies.get(item.lig_id) ?? item,
      calcule: item,
      profondeur,
      aEnfants: avecEnfants.has(item.lig_id),
      messages: erreurs.get(item.lig_id) ?? [],
      estCalculee: this.estLigneCalculee(item),
    }));
    return this.filtrerLignes(this.lignesPied(lignes, replies));
  }

  /**
   * Filtres d'affichage : tranche (titre ou pied : la tranche et ses descendants), puis pastilles (lignes dont
   * l'étiquette et le mode de vente sont cochés, avec leurs tranches parentes pour le contexte).
   */
  filtrerLignes(lignes) {
    let res = lignes;
    if (this.filtre !== null && this.filtre !== undefined) {
      const i = res.findIndex((r) => r.item.lig_id === this.filtre);
      if (i >= 0) {
        const base = res[i].profondeur;
        let j = i + 1;
        while (j < res.length && res[j].profondeur > base) j += 1;
        res = res.slice(i, j).map((r) => ({ ...r, profondeur: r.profondeur - base }));
      }
    }
    if (!this.filtreMarqueursActif()) return res;
    const parId = new Map(this.saisie.lignes.map((l) => [l.lig_id, l]));
    const garder = new Set();
    const trouvees = new Set(this.saisie.lignes.filter((l) => this.correspondMarqueurs(l)).map((l) => l.lig_id));
    for (const id of trouvees) {
      for (let x = parId.get(id); x && !garder.has(x.lig_id); x = parId.get(x.lig_parent_id)) garder.add(x.lig_id);
    }
    // Contenu des lignes trouvées (composantes d'un ouvrage…) affiché aussi, sauf les sous-tranches.
    for (const l of this.saisie.lignes) {
      if (estTranche(l)) continue;
      for (let x = parId.get(l.lig_parent_id); x; x = parId.get(x.lig_parent_id)) {
        if (trouvees.has(x.lig_id) && !estTranche(x)) { garder.add(l.lig_id); break; }
      }
    }
    return res.filter((r) => garder.has(r.item.lig_id));
  }

  filtreMarqueursActif() { return this.filtreMarqueurs.etiquettes.size > 0 || this.filtreMarqueurs.types.size > 0; }

  correspondMarqueurs(l) {
    const { etiquettes, types } = this.filtreMarqueurs;
    return (!etiquettes.size || etiquettes.has(l.lig_etiquette ?? '')) && (!types.size || types.has(l.lig_type_prix ?? 'V'));
  }

  /** Filtre par pastille : étiquettes et modes de vente cochés (ensembles vides : pas de filtre). */
  filtrerMarqueurs({ etiquettes = [], types = [] } = {}) {
    this.filtreMarqueurs = { etiquettes: new Set(etiquettes), types: new Set(types) };
    this.grille.rendre();
    this.majEntetePoignee();
    this.surFiltre?.(this.filtre);
  }

  /** Tous les filtres d'affichage retirés (tranche et pastilles). */
  retirerFiltres() {
    document.querySelector('.menu-filtre-marqueurs')?.remove();
    this.filtreMarqueurs = { etiquettes: new Set(), types: new Set() };
    this.majEntetePoignee();
    this.filtrer(null);
  }

  /** Description des filtres actifs (bandeau au-dessus de la grille), null sans filtre. */
  descriptionFiltres() {
    const parts = [];
    if (this.filtre !== null) {
      const l = this.resultat.lignes.find((x) => x.lig_id === this.filtre);
      parts.push(`tranche ${l ? `${l.lig_numerotation ?? ''} ${l.lig_libelle_brut ?? ''}`.trim() : 'Pied du document'}`);
    }
    const { etiquettes, types } = this.filtreMarqueurs;
    if (etiquettes.size) {
      const libelles = new Map(this.etiquettes().map((e) => [e.code, e.libelle]));
      parts.push(`étiquettes ${[...etiquettes].map((c) => (c ? libelles.get(c) ?? c : 'sans étiquette')).join(', ')}`);
    }
    if (types.size) parts.push(`modes de vente ${[...types].map((t) => LIBELLES_TYPE_PRIX[t] ?? t).join(', ')}`);
    return parts.length ? parts.join(' · ') : null;
  }

  /** Bouton de filtre dans l'entête de la colonne des pastilles. */
  entetePoignee(th) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filtre-marqueurs';
    b.textContent = '⏷';
    b.title = 'Filtrer par étiquette et mode de vente';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => { e.stopPropagation(); this.menuFiltreMarqueurs(b); });
    th.append(b);
    this.boutonFiltreMarqueurs = b;
    this.majEntetePoignee();
  }

  majEntetePoignee() {
    this.boutonFiltreMarqueurs?.classList.toggle('actif', Boolean(this.filtreMarqueurs) && this.filtreMarqueursActif());
  }

  menuFiltreMarqueurs(ancre) {
    if (document.querySelector('.menu-filtre-marqueurs')) { document.querySelector('.menu-filtre-marqueurs').remove(); return; }
    document.querySelector('.menu-etiquettes')?.remove();
    const { etiquettes, types } = this.filtreMarqueurs;
    const compte = new Map();
    for (const l of this.saisie.lignes) {
      const k = `e:${l.lig_etiquette ?? ''}`;
      compte.set(k, (compte.get(k) ?? 0) + 1);
      const t = `t:${l.lig_type_prix ?? 'V'}`;
      compte.set(t, (compte.get(t) ?? 0) + 1);
    }
    const ligne = (attr, valeur, couleur, libelle, coche, n) => `<label><input type="checkbox" ${attr}="${echapper(valeur)}" ${coche ? 'checked' : ''}>
      <span class="pastille" style="${couleur ? `background:${echapper(couleur)}` : ''}"></span>${echapper(libelle)} <small>${n ?? 0}</small></label>`;
    const menu = document.createElement('div');
    menu.className = 'menu-etiquettes menu-filtre-marqueurs';
    menu.innerHTML = `<strong>Étiquettes</strong>
      ${this.etiquettes().map((e) => ligne('data-etq', e.code, e.couleur, e.libelle, etiquettes.has(e.code), compte.get(`e:${e.code}`))).join('')}
      ${ligne('data-etq', '', null, 'Sans étiquette', etiquettes.has(''), compte.get('e:'))}
      <strong>Modes de vente</strong>
      ${Object.keys(LIBELLES_TYPE_PRIX).map((t) => ligne('data-type', t, this.couleurTypePrix(t)?.couleur, LIBELLES_TYPE_PRIX[t], types.has(t), compte.get(`t:${t}`))).join('')}
      <div class="boutons"><button type="button" data-effacer>Effacer</button></div>`;
    const r = ancre.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 2}px`;
    document.body.append(menu);
    const fermer = () => { menu.remove(); document.removeEventListener('mousedown', dehors, true); };
    const dehors = (e) => { if (!menu.contains(e.target) && e.target !== ancre) fermer(); };
    document.addEventListener('mousedown', dehors, true);
    const appliquer = () => this.filtrerMarqueurs({
      etiquettes: [...menu.querySelectorAll('[data-etq]:checked')].map((x) => x.dataset.etq),
      types: [...menu.querySelectorAll('[data-type]:checked')].map((x) => x.dataset.type),
    });
    menu.addEventListener('change', appliquer);
    menu.querySelector('[data-effacer]').addEventListener('click', () => {
      menu.querySelectorAll('input').forEach((x) => { x.checked = false; });
      appliquer();
    });
  }

  /** Coefficient coloré : < 1 rouge, entre 1 et la valeur par défaut orange, à partir de la valeur par défaut vert. */
  coefAffiche(valeur, defaut = 1, decimales = 4) {
    if (valeur === null || valeur === undefined || valeur === '') return '';
    const v = Number(valeur);
    const d = Number(defaut ?? 1);
    const s = document.createElement('span');
    s.className = v < 1 ? 'coef-bas' : v < d ? 'coef-moyen' : 'coef-ok';
    s.textContent = formatLibre(valeur, decimales);
    s.title = v < 1 ? 'Coefficient inférieur à 1' : v < d ? `Coefficient inférieur à la valeur par défaut (${formatLibre(d)})` : `Coefficient au moins égal à la valeur par défaut (${formatLibre(d)})`;
    return s;
  }

  /** Affichage limité à une tranche (null : tout afficher) ; la saisie et le calcul portent toujours sur tout le document. */
  filtrer(id) {
    this.filtre = id ?? null;
    if (this.filtre !== null) this.deplierAscendants(this.filtre);
    this.grille.rendre();
    if (this.filtre !== null) {
      this.grille.selectionner(this.filtre);
      this.grille.tbody.querySelector(`tr[data-id="${this.filtre}"]`)?.scrollIntoView({ block: 'end' });
    }
    this.surFiltre?.(this.filtre);
  }

  /** Lignes repliables de la grille (lignes avec enfants, pied compris) ; ouvrages : lignes d'ouvrage seulement. */
  lignesRepliables({ ouvrages = false } = {}) {
    return this.lignesGrille(new Set()).filter((r) => r.aEnfants && (!ouvrages || r.item.lig_tyl_id === TL.OUVRAGE)).map((r) => r.item.lig_id);
  }

  /** Toutes les lignes repliables (ou tous les ouvrages) sont repliées. */
  toutReplie(options = {}) {
    const ids = this.lignesRepliables(options);
    return ids.length > 0 && ids.every((id) => this.grille.replies.has(id));
  }

  /**
   * Replie les ouvrages (ou toutes les lignes), ou les déplie s'ils sont déjà tous repliés. La ligne courante, si elle
   * devient masquée, est remplacée par sa ligne visible la plus proche (ligne repliée qui la contient).
   */
  basculerPlis(options = {}) {
    const ids = this.lignesRepliables(options);
    const replier = !this.toutReplie(options);
    for (const id of ids) {
      if (replier) this.grille.replies.add(id);
      else this.grille.replies.delete(id);
    }
    this.grille.rendre();
    const courant = this.grille.courant;
    if (replier && courant !== null && courant !== undefined && !this.grille.index?.has(courant)) {
      const parId = new Map(this.saisie.lignes.map((l) => [l.lig_id, l]));
      let l = parId.get(courant);
      while (l && !this.grille.index?.has(l.lig_id)) l = parId.get(l.lig_parent_id);
      if (l) this.grille.selectionner(l.lig_id);
    }
    return replier;
  }

  /** Les tranches parentes d'une ligne sont dépliées (la ligne devient visible). */
  deplierAscendants(id) {
    const parId = new Map(this.saisie.lignes.map((l) => [l.lig_id, l]));
    let l = parId.get(id);
    while (l && l.lig_parent_id !== null) {
      this.grille.replies.delete(l.lig_parent_id);
      l = parId.get(l.lig_parent_id);
    }
  }

  /** Va à une ligne : tranches parentes dépliées, filtre retiré si la ligne est hors du filtre, ligne en haut de la grille. */
  allerA(id, { focus = true } = {}) {
    this.deplierAscendants(id);
    // Ligne du pied : la tranche du pied et ses groupes sont dépliés.
    const structures = [this.resultat.pied ?? [], ...(this.resultat.pieds_sections ?? []).map((s) => s.pied)];
    if (structures.some((pied) => pied.some((e) => e.lig_id === id || e.lignes?.includes(id)))) {
      for (const r of [...this.grille.replies]) if (r <= ID_PIED) this.grille.replies.delete(r);
    }
    this.grille.rendre();
    if ((this.filtre !== null || this.filtreMarqueursActif()) && !this.grille.index?.has(id)) this.retirerFiltres();
    this.grille.selectionner(id);
    this.grille.tbody.querySelector(`tr[data-id="${id}"]`)?.scrollIntoView({ block: focus ? 'start' : 'center' });
    if (focus) this.grille.focus();
  }

  /** Texte du badge pendant un glisser : comment la ligne sera intégrée. */
  libelleDepot(cibleId, position) {
    const c = this.saisie.lignes.find((l) => l.lig_id === cibleId);
    if (!c) return position;
    const nom = `${this.resultat.lignes.find((l) => l.lig_id === cibleId)?.lig_numerotation ?? ''} ${String(c.lig_libelle_html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`.trim().slice(0, 40);
    if (position === 'enfant') return c.lig_tyl_id === TL.OUVRAGE ? `Comme composante de « ${nom} »` : `Dans « ${nom} » (en fin)`;
    return `${position === 'avant' ? 'Avant' : 'Après'} « ${nom} » (même niveau)`;
  }

  /** Dépôt glissé depuis une autre fenêtre : type de ligne déduit du type MIME (article : élément, ouvrage). */
  depotExterneAutorise(cibleId, position, types) {
    if (this.magasin.lectureSeule || this.lignesLimitees) return false;
    const type = types.map((t) => TYPES_DEPOT[t]).find(Boolean);
    const cible = this.saisie.lignes.find((l) => l.lig_id === cibleId);
    if (!type || !cible) return false;
    const fictive = { lig_id: -9e15, lig_parent_id: null, lig_ordre: 0, lig_tyl_id: type };
    return this.regles.depotAutorise([...this.saisie.lignes, fictive], [fictive.lig_id], cible, position);
  }

  /** Données déposées : transmises à l'hôte (surDepotExterne), qui insère l'élément à la position. */
  deposerExterne(cibleId, position, dt) {
    const type = Object.keys(TYPES_DEPOT).find((t) => dt.types.includes(t));
    let donnees = null;
    try { donnees = JSON.parse(dt.getData(type)); } catch { donnees = null; }
    if (!donnees) return;
    this.surDepotExterne?.(donnees, cibleId, position);
  }

  /** Lignes marquées par la recherche (surlignées), la ligne courante de la recherche ; null : aucune. */
  marquer(ids, courant = null) {
    this.marques = ids ? { ids, courant } : null;
    this.grille.rendre();
  }

  /**
   * Pied en tranches : les lignes de pied sont regroupées sous des lignes calculées (postes de pied HT, TVA détaillée
   * par taux, postes de pied TTC), entre les totaux calculés (total HT, HT net, TTC, net à payer) ; un total égal au
   * suivant n'est pas affiché (une seule ligne).
   */
  lignesPied(lignes, replies) {
    this.groupesVides = new Map();
    if (!this.avecPied) return lignes.filter((r) => !estPied(r.calcule));
    const pied = this.resultat.pied ?? [];
    if (!pied.length) return lignes;
    const sections = this.resultat.pieds_sections ?? [];
    const ids = (structure) => structure.flatMap((e) => [...(e.lignes ?? []), ...(e.lig_id !== null ? [e.lig_id] : [])]);
    const dansPied = new Set([...ids(pied), ...sections.flatMap((s) => ids(s.pied))]);
    const parId = new Map(lignes.map((r) => [r.item.lig_id, r]));
    const res = lignes.filter((r) => !dansPied.has(r.item.lig_id) && !estPied(r.calcule));
    this.groupesVides = new Map();
    // Pied de chaque section (document à plusieurs sections) : tranche repliable à la fin de la section.
    sections.forEach((s, k) => {
      const section = parId.get(s.lig_id);
      if (!section || replies.has(s.lig_id)) return;
      const i = res.indexOf(section);
      let fin = i + 1;
      while (fin < res.length && res[fin].profondeur > section.profondeur) fin++;
      const tranche = this.ligneVirtuelle(`PS${k}`, 'tranche', 'Pied de la section', s.pied.at(-1)?.montant ?? null,
        { aEnfants: true, profondeur: section.profondeur + 1, id: ID_PIED - (k + 1) });
      const contenu = replies.has(tranche.item.lig_id) ? []
        : this.structurePied(s.pied, { parId, replies, decalage: (k + 1) * 1e9, tvaDetaillee: false, section: s.lig_id })
          .map((r) => ({ ...r, profondeur: r.profondeur + section.profondeur + 2 }));
      res.splice(fin, 0, tranche, ...contenu);
    });
    const p = this.structurePied(pied, { parId, replies, decalage: 0, tvaDetaillee: true, global: sections.length > 0 });
    // Lignes de pied hors structure (ventilation TVA en double…) : à la fin.
    for (const r of lignes) if (estPied(r.calcule) && !dansPied.has(r.item.lig_id)) p.push(r);
    // Tout le pied dans une tranche repliable (montant : net à payer).
    const net = pied.at(-1)?.montant ?? null;
    res.push(this.ligneVirtuelle('PIED', 'tranche', sections.length ? 'Pied global' : 'Pied du document', net, { aEnfants: true, id: ID_PIED }));
    if (!replies.has(ID_PIED)) res.push(...p.map((r) => ({ ...r, profondeur: r.profondeur + 1 })));
    return res;
  }

  /**
   * Ligne calculée du pied (jamais saisissable) ; identifiant stable par position dans le pied (le repli d'un groupe ne
   * décale pas les suivants), décalé pour le pied d'une section.
   */
  ligneVirtuelle(cle, type, libelle, montant, { aEnfants = false, profondeur = 0, html = null, rang = 0, decalage = 0, id = null, titre = null } = {}) {
    const lig = id ?? -1e12 - decalage - Number(cle.match(/\d+/)[0]) * 1000 - rang;
    return {
      item: { lig_id: lig, _virtuelle: true, lig_parent_id: null },
      calcule: { lig_id: lig, lig_libelle_affiche: html ?? echapper(libelle), lig_libelle_brut: titre, lig_montant_ht: montant, _virtuelle: true },
      profondeur, aEnfants, messages: [], estCalculee: true, virtuelle: { cle, type },
    };
  }

  /**
   * Lignes d'une structure de pied (résultat.pied ou pied d'une section) : totaux calculés, sous-totaux saisis, groupes
   * (ligne calculée ou ligne de ventilation TVA saisie, puis leurs lignes), lignes consolidées du pied global.
   */
  structurePied(pied, { parId, replies, decalage, tvaDetaillee, global = false, section = null }) {
    pied = regrouperSousTotauxHt(pied);
    const p = [];
    const pm = this.saisie.document.ent_precision_montant ?? 2;
    const virtuelle = (cle, type, libelle, montant, o = {}) => this.ligneVirtuelle(cle, type, libelle, montant, { ...o, decalage });
    // Groupes de postes toujours présents : vides, ce sont des lignes d'accueil pour ajouter un poste (jamais imprimées).
    // Postes HT : pied du document ou d'une section (pas le pied global, R PIED_GLOBAL) ; postes TTC : racine seulement.
    const ajoutable = !this.fige && !this.magasin?.lectureSeule;
    const manque = (cle) => ajoutable && !pied.some((e) => e.genre === 'groupe' && e.cle === cle);
    const vide = (cle) => {
      const r = virtuelle(cle === 'HT' ? 'E90' : 'E91', 'vide', LIBELLES_PIED[cle], null, {
        html: `${echapper(LIBELLES_PIED[cle])} <small class="pied-vide">aucun — ${echapper(libelleRaccourci('insererApres') || 'Ctrl+Entrée')} pour en ajouter</small>`,
      });
      this.groupesVides?.set(r.item.lig_id, { cle, section });
      p.push(r);
    };
    let ttc = !(manque('TTC') && section === null);
    pied.forEach((e, i) => {
      if (e.genre === 'total') {
        if (e.cle === 'NET' && !ttc) { vide('TTC'); ttc = true; }
        if (!e.masque) p.push(virtuelle(`T${i}`, 'total', LIBELLES_PIED[e.cle] ?? e.cle, e.montant));
        if (e.cle === 'TOTAL_HT' && !global && manque('HT')) vide('HT');
        if (e.cle === 'TOTAL_TTC' && !ttc) { vide('TTC'); ttc = true; }
        return;
      }
      if (e.genre === 'ligne') {
        const r = parId.get(e.lig_id);
        if (r) p.push({ ...r, profondeur: 0 });
        return;
      }
      if (e.genre === 'consolide') {
        // Ligne du pied global : lignes de même nature et de même libellé des pieds de section.
        const detail = e.mode === 'P' && e.taux !== null ? ` ${formatLibre(e.taux)} %` : e.mode === 'C' && e.taux !== null ? ` × ${formatLibre(e.taux)}` : '';
        const base = e.base !== null ? ` <small>sur ${formatNombre(e.base, pm)}</small>` : '';
        p.push(virtuelle(`C${i}`, 'consolide', e.libelle, e.montant, {
          profondeur: 0, html: `${echapper(e.libelle || LIBELLES_PIED[e.cle] || e.cle)}${echapper(detail)}${base}`,
          titre: e.libelle,
        }));
        return;
      }
      // Groupe : ligne calculée parente (ou la ligne de ventilation TVA saisie), puis ses lignes.
      const tvaSaisie = e.cle === 'TVA' && !global ? parId.get(e.lignes?.[0]) : null;
      let parent;
      if (tvaSaisie) parent = { ...tvaSaisie, profondeur: 0, aEnfants: tvaDetaillee };
      else parent = virtuelle(`G${i}`, 'groupe', LIBELLES_PIED[e.cle] ?? e.cle, e.montant, { aEnfants: true });
      p.push(parent);
      if (replies.has(parent.item.lig_id)) return;
      if (e.cle === 'TVA') {
        if (!tvaDetaillee) return;
        for (const t of this.resultat.tva) {
          const libelle = `${t.tva_code} · ${formatLibre(t.tva_taux)} % sur ${formatNombre(t.tva_base_ht, pm)}${t.tva_mention ? ` — ${t.tva_mention}` : ''}`;
          p.push(virtuelle(`V${i}-${t.tva_code}`, 'tva', libelle, t.tva_montant_net, { profondeur: 1, rang: 1 + this.resultat.tva.indexOf(t) }));
        }
        return;
      }
      for (const id of e.lignes ?? []) {
        const r = parId.get(id);
        if (r) p.push({ ...r, profondeur: 1 });
      }
    });
    return p;
  }

  /** Base d'une ligne de pied en pourcentage ou coefficient (« sur 1 200,00 », origine en infobulle), sinon null. */
  baseAffichee(c) {
    if (!estPied(c) || c.lig_tyl_id === TL.TVA || !c.lig_pied_mode || c.lig_pied_mode === 'M' || c.lig_base_calcul === null || c.lig_base_calcul === undefined) return null;
    const s = document.createElement('span');
    s.className = 'base-pied';
    s.textContent = `sur ${formatNombre(c.lig_base_calcul, this.saisie.document.ent_precision_montant ?? 2)}`;
    s.title = `Base : ${this.libelleBasePied(c)}`;
    return s;
  }

  /** Texte de la base d'une ligne de pied en pourcentage ou coefficient. */
  libelleBasePied(c) {
    if (c.lig_pied_base === 'LIGNE') {
      const st = this.resultat.lignes.find((x) => x.lig_id === c.lig_pied_base_id);
      return st ? `Sous-total : ${st.lig_libelle_brut || st.lig_id}` : 'Sous-total introuvable';
    }
    return LIBELLES_BASE_PIED[c.lig_pied_base ?? 'CUMUL'];
  }

  libelleTaux = (id) => this.definition.taux_tva.find((t) => t.ttv_id === id)?.ttv_code ?? '—';

  libelleType(r) { return LIBELLES_TYPE[CODES_TL[r.item.lig_tyl_id]] ?? ''; }

  /** Colonne numérique saisissable (texte libre converti, vide = null). */
  colonneNombre(champ, editable) {
    return {
      editeur: 'nombre', editable, champ: () => champ,
      lire: (l) => (l[champ] === null || l[champ] === undefined ? '' : formatLibre(l[champ])),
    };
  }

  colonnes() {
    const saisissable = (l) => this.saisissable(l);
    const chiffree = (l) => saisissable(l) && estChiffree(l);
    return [
      {
        cle: 'num', titre: 'N°', classe: 'col-num', arbre: true, editeur: 'texte',
        editable: (l) => saisissable(l) && estTypeNumerote(l),
        champ: () => 'lig_numerotation', lire: (l) => (l.lig_num_manuelle ? l.lig_numerotation ?? '' : ''),
        valeur: (r) => (r.calcule.lig_numerotation ?? '') + (r.item.lig_num_manuelle ? ' ✎' : ''),
        titreCellule: (r) => (r.item?.lig_num_manuelle ? '✎ Numéro saisi manuellement (vider la cellule : numérotation automatique)' : ''),
      },
      {
        cle: 'type', titre: 'Type', classe: 'col-type', editeur: 'select', editable: saisissable,
        champ: () => 'lig_tyl_id', lire: (l) => l.lig_tyl_id,
        options: () => this.definition.types_ligne.map((t) => ({ valeur: t.tyl_id, libelle: t.tyl_libelle })),
        valeur: (r) => (r.virtuelle ? { total: 'Total', groupe: 'Groupe', vide: 'Groupe', tva: 'Taux', tranche: 'Pied', consolide: 'Consolidé' }[r.virtuelle.type] : this.libelleType(r)),
      },
      {
        // Code d'appel d'une référence (article…) : résolu par l'hôte ; sinon texte libre. Section sans code : numéro
        // du document qu'elle représente (le document lui-même ; plus tard, chaque document intégré).
        cle: 'code', titre: 'Code', classe: 'col-code', editeur: 'texte', editable: saisissable,
        champ: () => 'lig_code', lire: (l) => l.lig_code ?? '',
        valeur: (r) => r.calcule.lig_code ?? (r.item?.lig_tyl_id === TL.SECTION ? this.saisie.document.ent_numero ?? '' : ''),
      },
      {
        // Saisie en ligne pour un texte simple ; éditeur de mise en forme au double-clic.
        cle: 'libelle', titre: 'Libellé', classe: 'col-libelle', editeur: 'texte', editable: saisissable,
        champ: () => 'lig_libelle_html',
        lire: (l) => (estHtml(l.lig_libelle_html) ? l.lig_libelle_html : decoderEntites(l.lig_libelle_html ?? '')),
        valeur: (r) => ({
          html: htmlSur(r.calcule.lig_libelle_affiche ?? r.item.lig_libelle_html ?? ''),
          titre: this.libellesUneLigne ? r.calcule.lig_libelle_brut ?? '' : null,
        }),
        riche: {
          auto: (l) => estHtml(l.lig_libelle_html),
          disponible: (l) => !l._virtuelle,
          ouvrir: (l) => editerLibelle({
            html: l.lig_libelle_html,
            titre: [this.resultat.lignes.find((x) => x.lig_id === l.lig_id)?.lig_numerotation, LIBELLES_TYPE[CODES_TL[l.lig_tyl_id]]].filter(Boolean).join(' · '),
            variables: this.variablesLibelle(),
          }),
          // Libellé non modifiable (document validé, ligne reprise du parent) : mise en forme en consultation.
          consulter: (l) => (l._virtuelle ? null : editerLibelle({
            html: this.resultat.lignes.find((x) => x.lig_id === l.lig_id)?.lig_libelle_affiche ?? l.lig_libelle_html,
            titre: [this.resultat.lignes.find((x) => x.lig_id === l.lig_id)?.lig_numerotation, LIBELLES_TYPE[CODES_TL[l.lig_tyl_id]], 'lecture seule'].filter(Boolean).join(' · '),
            lecture: true,
          })),
        },
        enteteBouton: {
          texte: () => (this.libellesUneLigne ? '⇕' : '⇔'),
          titre: () => (this.libellesUneLigne ? 'Afficher les libellés en entier' : 'Afficher les libellés sur une seule ligne'),
          clic: () => {
            this.libellesUneLigne = !this.libellesUneLigne;
            ecrirePreferences({ [this.transforme ? 'libellesTransformes' : 'libelles']: this.libellesUneLigne ? 'ligne' : 'complet' });
            this.grille.conteneur.classList.toggle('libelles-une-ligne', this.libellesUneLigne);
          },
        },
      },
      {
        cle: 'qte', titre: 'Qté', classe: 'col-nombre', editeur: 'nombre',
        editable: (l) => chiffree(l) || (saisissable(l) && (l.lig_tyl_id === TL.PIED_HT || l.lig_tyl_id === TL.PIED_TTC)),
        champ: (l) => (estPied(l) ? 'lig_pied_valeur' : 'lig_qte'),
        lire: (l) => formatLibre(estPied(l) ? l.lig_pied_valeur : l.lig_qte),
        valeur: (r) => {
          const c = r.calcule;
          if (estPied(c)) {
            if (c.lig_tyl_id === TL.TVA) return '';
            if (c.lig_pied_mode === 'C') return `× ${formatLibre(c.lig_pied_valeur)}`;
            return `${formatLibre(c.lig_pied_valeur)}${c.lig_pied_mode === 'P' ? ' %' : ' €'}`;
          }
          if (!estChiffree(c)) return '';
          return formatNombre(c.lig_qte_vendue, c.lig_precision_qte ?? 2);
        },
      },
      ...this.colonnesReste(saisissable),
      ...this.colonnesAvancement(saisissable),
      ...this.colonnesVentilationAvancement(saisissable),
      {
        cle: 'unite', titre: 'U', classe: 'col-unite', editeur: 'liste', editable: chiffree,
        champ: () => 'lig_unt_code', lire: (l) => l.lig_unt_code ?? '', valeur: (r) => r.calcule.lig_unt_code ?? '',
        suggestions: () => this.suggestionsUnites(),
      },
      {
        cle: 'pv', titre: 'PV', classe: 'col-nombre', ...this.colonneNombre('lig_pv', (l) => chiffree(l) && !this.estCompose(l)),
        valeur: (r) => this.baseAffichee(r.calcule) ?? (estChiffree(r.calcule) ? formatNombre(r.calcule.lig_pv, r.calcule.lig_precision_pv ?? 2) : ''),
      },
      {
        cle: 'remise', titre: 'Remise', classe: 'col-coef', ...this.colonneNombre('lig_coef_remise', chiffree),
        valeur: (r) => (estChiffree(r.calcule) && Number(r.calcule.lig_coef_remise) !== 1 ? this.coefAffiche(r.calcule.lig_coef_remise, 1) : ''),
      },
      {
        cle: 'pvnet', titre: 'PV net', classe: 'col-nombre', editable: () => false,
        valeur: (r) => (estChiffree(r.calcule) ? formatNombre(r.calcule.lig_pv_remise, r.calcule.lig_precision_pv ?? 2) : ''),
      },
      {
        cle: 'montant', titre: 'Montant HT', classe: 'col-nombre col-montant', editable: () => false,
        valeur: (r) => {
          const c = r.calcule;
          if (c.lig_tyl_id === TL.TVA) return formatNombre(c.lig_montant_tva, 2);
          return formatNombre(c.lig_montant_ht, this.saisie.document.ent_precision_montant ?? 2);
        },
      },
      {
        cle: 'tva', titre: 'TVA', classe: 'col-tva', editeur: 'select',
        editable: (l) => saisissable(l) && (l.lig_tyl_id === TL.TITRE || this.regles.estLigneDePrix(this.saisie.lignes, l) || l.lig_tyl_id === TL.PIED_HT),
        champ: () => 'lig_tva_id', lire: (l) => l.lig_tva_id ?? '',
        options: () => [{ valeur: '', libelle: '—' }, ...this.definition.taux_tva.map((t) => ({ valeur: t.ttv_id, libelle: t.ttv_code }))],
        valeur: (r) => {
          const l = r.item;
          if (l.lig_tyl_id === TL.TITRE) {
            const h = this.regles.heterogeneiteTva(this.saisie.lignes, l, this.libelleTaux);
            const s = document.createElement('span');
            s.textContent = l.lig_tva_id ? this.libelleTaux(l.lig_tva_id) : '';
            if (h.heterogene) {
              const m = document.createElement('span');
              m.className = 'tva-heterogene';
              m.textContent = ' ◆';
              m.title = h.detail;
              s.appendChild(m);
            }
            return s;
          }
          return l.lig_tva_id ? this.libelleTaux(l.lig_tva_id) : '';
        },
      },
      {
        // Commentaire interne de la ligne (non imprimé) : première ligne dans la cellule, texte entier en bulle.
        cle: 'commentaire', titre: 'Commentaire', classe: 'col-commentaire', editeur: 'texte', editable: saisissable,
        champ: () => 'lig_commentaire', lire: (l) => l.lig_commentaire ?? '',
        valeur: (r) => {
          if (r.virtuelle) return '';
          const parent = r.item.lig_proprietes?.commentaire_parent;
          if (!r.item.lig_commentaire && parent) return { html: `<i class="commentaire-parent">${echapper(String(parent).split('\n')[0])}</i>` };
          return String(r.item.lig_commentaire ?? '').split('\n')[0];
        },
        titreCellule: (r) => {
          if (r.virtuelle) return '';
          const parent = r.item.lig_proprietes?.commentaire_parent;
          return [r.item.lig_commentaire, parent ? `Parent : ${parent}` : null].filter(Boolean).join('\n\n');
        },
      },
      {
        // Date de livraison de la ligne (019l) : la sienne, sinon la date par défaut de l'entête fournie par l'application
        // (dateLivraisonDefaut), en italique : elle suit alors tout changement de l'entête. Vider la cellule revient au défaut.
        cle: 'livraison', titre: 'Livraison', classe: 'col-date', editeur: 'texte',
        editable: (l) => saisissable(l) && this.regles.estLigneDePrix(this.saisie.lignes, l),
        champ: () => 'lig_date_livraison', lire: (l) => dateCourte(l.lig_date_livraison),
        valeur: (r) => {
          if (r.virtuelle || !this.regles.estLigneDePrix(this.saisie.lignes, r.item)) return '';
          if (r.item.lig_date_livraison) return dateCourte(r.item.lig_date_livraison);
          const defaut = this.dateLivraisonDefaut();
          return defaut ? { html: `<i class="date-defaut">${dateCourte(defaut)}</i>` } : '';
        },
        titreCellule: (r) => (r.virtuelle || r.item.lig_date_livraison || !this.dateLivraisonDefaut() ? '' : "Date de l'entête : saisir une date pour l'imposer à la ligne"),
      },
      {
        // Commentaire de la ligne du document parent (repris à la transformation d'avancement), en lecture seule.
        cle: 'commentaire_parent', titre: 'Commentaire parent', classe: 'col-commentaire', editable: () => false,
        valeur: (r) => (r.virtuelle ? '' : String(r.item.lig_proprietes?.commentaire_parent ?? '').split('\n')[0]),
        titreCellule: (r) => (r.virtuelle ? '' : r.item.lig_proprietes?.commentaire_parent ?? ''),
      },
    ];
  }

  /**
   * Colonnes du reste à solder (document issu d'une transformation, restes posés par definirRestes) : quantité et
   * montant HT du parent, quantité et montant des documents précédents (autres documents à la même étape, brouillons
   * compris), cumul (précédent + ce document) et % du parent, reste (parent − autres documents − ce document −
   * soldé), case Soldé (solde la ligne du parent à la validation ; « seuil » : soldée automatiquement, le reste étant
   * sous le seuil des paramètres).
   */
  colonnesReste(saisissable) {
    if (!this.restes?.parLigne.size) return [];
    const precision = (r) => r.calcule.lig_precision_qte ?? 2;
    const pm = () => this.saisie.document.ent_precision_montant ?? 2;
    const avec = (r, f) => { const s = this.soldeLigne(r); return s ? f(s.info, r) : ''; };
    const qteCumul = (i, r) => Dz(i.autres).plus(Dz(r.calcule.lig_qte_vendue));
    const montantCumul = (i, r) => Dz(i.autres_montant).plus(Dz(r.calcule.lig_montant_ht));
    // % du parent : de la quantité ; une ligne sans quantité (forfait) : du montant.
    const pct = (i, qte, montant) => {
      const [n, d] = Dz(i.qte_parent).isZero() ? [Dz(montant), Dz(i.montant_parent)] : [Dz(qte), Dz(i.qte_parent)];
      return d.isZero() ? '' : formatNombre(n.div(d).times(100).toDecimalPlaces(2).toString(), 2);
    };
    return [
      {
        cle: 'qte_parent', titre: 'Qté parent', classe: 'col-nombre', editable: () => false,
        valeur: (r) => avec(r, (i) => formatNombre(i.qte_parent, precision(r))),
        titreCellule: (r) => (this.soldeLigne(r) ? 'Quantité de la ligne du document parent' : ''),
      },
      {
        cle: 'montant_parent', titre: 'Montant parent', classe: 'col-nombre', editable: () => false,
        valeur: (r) => avec(r, (i) => formatNombre(i.montant_parent, pm())),
        titreCellule: (r) => (this.soldeLigne(r) ? 'Montant HT de la ligne du document parent' : ''),
      },
      {
        cle: 'pct_prec', titre: '% préc.', classe: 'col-coef', editable: () => false,
        valeur: (r) => avec(r, (i) => pct(i, i.autres, i.autres_montant)),
        titreCellule: (r) => (this.soldeLigne(r) ? 'Part du parent reprise par les documents précédents' : ''),
      },
      {
        cle: 'qte_prec', titre: 'Qté préc.', classe: 'col-nombre', editable: () => false,
        valeur: (r) => avec(r, (i) => formatNombre(i.autres, precision(r))),
        titreCellule: (r) => avec(r, (i) => `Quantité des documents précédents à la même étape${Dz(i.autres_brouillons).isZero() ? '' : ` (dont brouillons ${formatNombre(i.autres_brouillons, precision(r))})`}`),
      },
      {
        cle: 'montant_prec', titre: 'Montant préc.', classe: 'col-nombre', editable: () => false,
        valeur: (r) => avec(r, (i) => formatNombre(i.autres_montant, pm())),
        titreCellule: (r) => (this.soldeLigne(r) ? 'Montant HT des documents précédents à la même étape' : ''),
      },
      {
        cle: 'pct_periode', titre: '% période', classe: 'col-coef', editable: () => false,
        valeur: (r) => avec(r, (i) => pct(i, r.calcule.lig_qte_vendue, r.calcule.lig_montant_ht)),
        titreCellule: (r) => (this.soldeLigne(r) ? 'Part du parent reprise par ce document' : ''),
      },
      {
        cle: 'qte_cumul', titre: 'Qté cumul', classe: 'col-nombre', editable: () => false,
        valeur: (r) => avec(r, (i) => formatNombre(qteCumul(i, r).toString(), precision(r))),
        titreCellule: (r) => (this.soldeLigne(r) ? 'Quantité cumulée : documents précédents + ce document' : ''),
      },
      {
        cle: 'montant_cumul', titre: 'Montant cumul', classe: 'col-nombre', editable: () => false,
        valeur: (r) => avec(r, (i) => formatNombre(montantCumul(i, r).toString(), pm())),
        titreCellule: (r) => (this.soldeLigne(r) ? 'Montant HT cumulé : documents précédents + ce document' : ''),
      },
      {
        cle: 'pct_cumul', titre: '% cumul', classe: 'col-coef', editable: () => false,
        valeur: (r) => avec(r, (i) => pct(i, qteCumul(i, r), montantCumul(i, r))),
        titreCellule: (r) => (this.soldeLigne(r) ? 'Part cumulée du parent (quantité, ou montant sans quantité)' : ''),
      },
      {
        cle: 'reste', titre: 'Reste', classe: 'col-nombre col-reste', editable: () => false,
        valeur: (r) => { const s = this.soldeLigne(r); return s ? formatNombre(s.etat.reste, precision(r)) : ''; },
        classeCellule: (r) => { const s = this.soldeLigne(r); return s && Dz(s.etat.reste).isNegative() ? 'reste-negatif' : ''; },
        titreCellule: (r) => {
          const s = this.soldeLigne(r);
          if (!s) return '';
          const f = (v) => formatNombre(v, precision(r));
          return `Reste à solder = parent ${f(s.info.qte_parent)} − autres documents ${f(s.info.autres)}`
            + `${Dz(s.info.autres_brouillons).isZero() ? '' : ` (dont brouillons ${f(s.info.autres_brouillons)})`}`
            + ` − ce document ${f(r.calcule.lig_qte_vendue)}${Dz(s.info.solde).isZero() ? '' : ` − soldé ${f(s.info.solde)}`}`;
        },
      },
      {
        cle: 'solde', titre: 'Soldé', classe: 'col-solde', editeur: 'select',
        editable: (l) => saisissable(l) && this.restes.parLigne.has(l.lig_id),
        champ: () => 'lig_solde', lire: (l) => (l.lig_solde ? '1' : ''),
        options: () => [{ valeur: '', libelle: '—' }, { valeur: '1', libelle: 'Soldée' }],
        valeur: (r) => {
          const s = this.soldeLigne(r);
          if (!s) return '';
          return r.item.lig_solde ? '✔' : s.etat.soldee ? { html: '<span class="solde-seuil">✔ seuil</span>' } : '';
        },
        titreCellule: (r) => {
          const s = this.soldeLigne(r);
          if (!s) return '';
          if (r.item.lig_solde) return 'Ligne soldée : à la validation, le reste de la ligne du parent est clos';
          return s.etat.soldee ? 'Reste sous le seuil des paramètres : la ligne sera soldée à la validation' : 'Choisir « Soldée » pour clore le reste sans attendre';
        },
      },
    ];
  }

  /**
   * Colonnes de l'avancement (CONCEPTION-ACHATS-MARCHES.md, Q24) : % précédent, % / quantité / montant cumulés
   * (saisissables : le mode suit la dernière saisie, marquée ✎), montant précédent ; la colonne Montant HT donne la
   * période (facture d'avancement) ou le cumul (situation). Sur un titre ou une section : % cumulé de ses lignes, une
   * saisie l'applique à toutes.
   */
  colonnesAvancement(saisissable) {
    if (!this.saisie.document.ent_avt_presentation) return [];
    const nombre = (v, d = 2) => (formatNombre(v, d));
    const avt = (l) => Boolean(l?.lig_avt_mode);
    const tranche = (l) => estTranche(l) && this.lignesAvancement(l.lig_id).length > 0;
    const saisi = (r, mode, texte) => (r.item.lig_avt_mode === mode ? { html: `<b>${echapper(texte)}</b> ✎` } : texte);
    return [
      {
        cle: 'avt_pct_prec', titre: '% préc.', classe: 'col-coef', editable: () => false,
        valeur: (r) => (avt(r.item) ? nombre(r.item.lig_avt_pct_precedent, 2) : ''),
        titreCellule: () => '% cumulé du dernier document d\'avancement validé (facture ou reprise)',
      },
      {
        cle: 'avt_pct', titre: '% cumul', classe: 'col-coef', editeur: 'nombre',
        editable: (l) => saisissable(l) && (avt(l) || tranche(l)),
        champ: () => 'avt:P', lire: (l) => (avt(l) ? formatLibre(l.lig_avt_mode === 'P' ? l.lig_avt_valeur : this.calculee(l)?.lig_avt_pct) : ''),
        valeur: (r) => {
          if (avt(r.item)) return saisi(r, 'P', nombre(r.calcule.lig_avt_pct, 2));
          return tranche(r.item) ? nombre(this.pctTranche(r.item.lig_id), 2) : '';
        },
        titreCellule: (r) => (tranche(r.item) ? 'Saisir un % pour l\'appliquer à toutes les lignes de la tranche' : avt(r.item) ? 'Avancement cumulé en % du montant de la ligne du marché' : ''),
      },
      {
        cle: 'avt_pct_periode', titre: '% période', classe: 'col-coef', editable: () => false,
        valeur: (r) => (avt(r.item) && r.calcule.lig_avt_pct !== null && r.calcule.lig_avt_pct !== undefined
          ? nombre(Dz(r.calcule.lig_avt_pct).minus(Dz(r.item.lig_avt_pct_precedent)).toString(), 2) : ''),
        titreCellule: () => 'Avancement de la période : % cumulé − % précédent',
      },
      {
        cle: 'avt_qte', titre: 'Qté cumul', classe: 'col-nombre', editeur: 'nombre', editable: (l) => saisissable(l) && avt(l) && !estPied(l),
        champ: () => 'avt:Q', lire: (l) => formatLibre(l.lig_avt_mode === 'Q' ? l.lig_avt_valeur : this.calculee(l)?.lig_avt_qte_cumul),
        valeur: (r) => (avt(r.item) ? saisi(r, 'Q', nombre(r.calcule.lig_avt_qte_cumul, r.calcule.lig_precision_qte ?? 2)) : ''),
        titreCellule: (r) => (avt(r.item) ? `Quantité du marché : ${nombre(r.item.lig_avt_qte_marche, r.calcule.lig_precision_qte ?? 2)}` : ''),
      },
      {
        cle: 'avt_montant', titre: 'Montant cumul', classe: 'col-nombre', editeur: 'nombre', editable: (l) => saisissable(l) && avt(l),
        champ: () => 'avt:M', lire: (l) => formatLibre(l.lig_avt_mode === 'M' ? l.lig_avt_valeur : this.calculee(l)?.lig_avt_montant_cumul),
        valeur: (r) => (avt(r.item) ? saisi(r, 'M', nombre(r.calcule.lig_avt_montant_cumul, this.saisie.document.ent_precision_montant ?? 2)) : ''),
        titreCellule: (r) => (avt(r.item) ? `Montant du marché : ${nombre(r.item.lig_avt_montant_marche)}` : ''),
      },
      {
        cle: 'avt_qte_marche', titre: 'Qté marché', classe: 'col-nombre', editable: () => false,
        valeur: (r) => (avt(r.item) && !estPied(r.item) ? nombre(r.item.lig_avt_qte_marche, r.calcule.lig_precision_qte ?? 2) : ''),
        titreCellule: () => 'Quantité de la ligne du marché (commande parente)',
      },
      {
        cle: 'avt_montant_marche', titre: 'Montant marché', classe: 'col-nombre', editable: () => false,
        valeur: (r) => (avt(r.item) ? nombre(r.item.lig_avt_montant_marche, this.saisie.document.ent_precision_montant ?? 2) : ''),
        titreCellule: () => 'Montant HT de la ligne du marché (commande parente)',
      },
      {
        cle: 'avt_qte_prec', titre: 'Qté préc.', classe: 'col-nombre', editable: () => false,
        valeur: (r) => (avt(r.item) ? nombre(r.item.lig_avt_qte_precedent, r.calcule.lig_precision_qte ?? 2) : ''),
        titreCellule: () => 'Quantité cumulée du dernier document d\'avancement validé',
      },
      {
        cle: 'avt_precedent', titre: 'Montant préc.', classe: 'col-nombre', editable: () => false,
        valeur: (r) => (avt(r.item) ? nombre(r.item.lig_avt_montant_precedent, this.saisie.document.ent_precision_montant ?? 2) : ''),
        titreCellule: () => 'Montant cumulé du dernier document d\'avancement validé',
      },
    ];
  }

  /**
   * Document d'avancement : les colonnes de ventilation des documents transformés (parent, précédent, période, cumul)
   * y désignent les valeurs d'avancement (marché, précédent, période, cumul saisissable), pour partager les vues.
   */
  colonnesVentilationAvancement(saisissable) {
    if (!this.saisie.document.ent_avt_presentation || this.restes?.parLigne.size) return [];
    const parCle = new Map(this.colonnesAvancement(saisissable).map((c) => [c.cle, c]));
    return ALIAS_AVANCEMENT.filter(([, source]) => parCle.has(source)).map(([cle, source, titre]) => ({ ...parCle.get(source), cle, titre }));
  }

  /** Ligne calculée correspondant à une ligne saisie. */
  calculee(l) { return this.resultat?.lignes.find((x) => x.lig_id === l.lig_id) ?? null; }

  /** Lignes d'avancement d'une tranche (descendantes avec un mode d'avancement). */
  lignesAvancement(id) {
    const parId = new Map(this.saisie.lignes.map((l) => [l.lig_id, l]));
    const dans = (l) => { for (let x = parId.get(l.lig_parent_id); x; x = parId.get(x.lig_parent_id)) if (x.lig_id === id) return true; return false; };
    return this.saisie.lignes.filter((l) => l.lig_avt_mode && dans(l));
  }

  /** % cumulé d'une tranche : montants cumulés / montants du marché de ses lignes. */
  pctTranche(id) {
    let m = Dz(null);
    let mc = Dz(null);
    for (const l of this.lignesAvancement(id)) {
      m = m.plus(Dz(this.calculee(l)?.lig_avt_montant_cumul));
      mc = mc.plus(Dz(l.lig_avt_montant_marche));
    }
    return mc.isZero() ? null : m.div(mc).times(100).toDecimalPlaces(2).toString();
  }

  /** Variables proposées dans l'éditeur de libellé : données de la ligne et du document. */
  variablesLibelle() {
    return [
      ['lig_qte_vendue', 'Quantité vendue'], ['lig_unt_code', 'Unité'], ['lig_pv_remise', 'PV net'], ['lig_montant_ht', 'Montant HT'],
      ['lig_numerotation', 'Numéro de ligne'], ['document.ent_numero', 'Numéro du document'], ['document.ent_objet', 'Objet du document'],
    ].map(([v, l]) => ({ valeur: `{{${v}}}`, libelle: `${l} – {{${v}}}` }));
  }

  /** Variables proposées dans les textes d'introduction et de conclusion (niveau du document). */
  variablesTexte() { return variablesTexteDocument(); }

  /** Unités du référentiel, complétées par les unités saisies librement dans le document. */
  suggestionsUnites() {
    const connues = (this.definition.unites ?? []).map((u) => ({ valeur: u.unt_code, libelle: u.unt_libelle }));
    const codes = new Set(connues.map((u) => u.valeur));
    const saisies = [...new Set(this.saisie.lignes.map((l) => l.lig_unt_code).filter((c) => c && !codes.has(c)))]
      .sort().map((c) => ({ valeur: c, libelle: 'Saisie libre', detail: 'dans ce document' }));
    return [...connues, ...saisies];
  }

  estCompose(l) {
    return l.lig_tyl_id === TL.OUVRAGE && this.saisie.lignes.some((x) => x.lig_parent_id === l.lig_id);
  }

  // ---------------------------------------------------------------- actions

  modifierLigne(id, champ, valeur) {
    if (this.fige) { this.surMessage?.('Document validé : consultation seule'); return; }
    if (this.champVerrouille(this.saisie.lignes.find((x) => x.lig_id === id), champ)) {
      this.surMessage?.('Information reprise du document parent : non modifiable');
      return;
    }
    this.magasin.modifier((d) => {
      const l = d.lignes.find((x) => x.lig_id === id);
      if (!l) return;
      l[champ] = valeur;
      this.regles.apresModification(d, id, champ);
    }, `Modification ${champ}`);
  }

  /**
   * Saisie d'une cellule : renvoie true si la valeur est acceptée. Une spécialisation traite ses champs
   * puis délègue le reste à super.modifierCellule.
   */
  modifierCellule(id, champ, texte, colonne) {
    const m = this.magasin;
    if (this.champVerrouille(this.saisie.lignes.find((x) => x.lig_id === id), champ)) {
      this.surMessage?.('Information reprise du document parent : non modifiable');
      return false;
    }
    const taux = this.definition.taux_tva;
    let valeur = texte;
    if (colonne.editeur === 'nombre') {
      valeur = lireNombre(texte);
      if (valeur === undefined) { this.surMessage?.('Nombre invalide'); return false; }
    }
    if (champ === 'lig_tyl_id') {
      const type = Number(texte);
      const l = this.saisie.lignes.find((x) => x.lig_id === id);
      const aEnfants = this.saisie.lignes.some((x) => x.lig_parent_id === id);
      if (aEnfants && !accepteEnfants({ lig_tyl_id: type })) { this.surMessage?.('Ce type n\'accepte pas de lignes enfants'); return false; }
      if (estPied({ lig_tyl_id: type }) !== estPied(l) && (l.lig_parent_id !== null || aEnfants)) { this.surMessage?.('Les lignes de pied sont au niveau racine'); return false; }
      if (type === TL.SECTION && l.lig_parent_id !== null) { this.surMessage?.('Une section est au niveau racine'); return false; }
      if (!this.ajoutAutorise([{ lig_tyl_id: type }])) { this.surMessage?.('Ce document n\'accepte que du texte et des lignes de pied'); return false; }
      m.modifier((d) => {
        const x = d.lignes.find((y) => y.lig_id === id);
        x.lig_tyl_id = type;
        if (estPied(x)) { x.lig_pied_mode ??= 'P'; x.lig_pied_sens ??= -1; }
        this.regles.appliquerContexte(d, id, taux);
      }, 'Type de ligne');
      return true;
    }
    if (champ === 'lig_code') {
      const code = String(texte ?? '').trim();
      if (code && this.appelerCode) { this.appelerCode(id, code); return true; }
      this.modifierLigne(id, 'lig_code', code || null);
      return true;
    }
    if (champ === 'lig_tva_id') valeur = texte === '' ? null : Number(texte);
    if (champ === 'lig_solde') valeur = texte === '1' || texte === true;
    // Avancement : la saisie fixe le mode (P, Q, M) et sa valeur ; sur une tranche, le % s'applique à toutes ses lignes.
    if (champ.startsWith('avt:')) {
      const mode = champ.slice(4);
      const ids = this.saisie.lignes.find((x) => x.lig_id === id)?.lig_avt_mode ? [id] : this.lignesAvancement(id).map((x) => x.lig_id);
      m.modifier((d) => {
        for (const x of d.lignes.filter((y) => ids.includes(y.lig_id))) {
          x.lig_avt_mode = mode;
          x.lig_avt_valeur = valeur === null ? '0' : valeur;
        }
      }, 'Avancement');
      return true;
    }
    // Saisie en ligne : texte simple, échappé (la mise en forme passe par l'éditeur riche).
    if (champ === 'lig_libelle_html') valeur = valeur.trim() === '' ? null : echapper(valeur);
    if (champ === 'lig_unt_code' && valeur.trim() === '') valeur = null;
    if (champ === 'lig_unt_code' && valeur) valeur = valeur.trim().slice(0, 10);
    if (champ === 'lig_commentaire') valeur = valeur.trim() === '' ? null : valeur;
    if (champ === 'lig_date_livraison') {
      valeur = lireDateSaisie(texte);
      if (valeur === undefined) { this.surMessage?.('Date de livraison : JJ/MM/AAAA'); return false; }
    }
    this.modifierLigne(id, champ, valeur);
    return true;
  }

  actions() {
    const actions = this.#actions();
    for (const nom of ['modifier', 'modifierRiche', 'inserer', 'deplacer', 'indenter', 'desindenter', 'decaler', 'supprimer', 'dupliquer', 'coller']) {
      const action = actions[nom];
      actions[nom] = (...args) => {
        if (this.fige) { this.surMessage?.('Document validé : consultation seule'); return nom === 'modifier' ? false : undefined; }
        return action(...args);
      };
    }
    return actions;
  }

  #actions() {
    const m = this.magasin;
    const taux = this.definition.taux_tva;
    const regles = this.regles;
    const pp = this.pressePapiers;
    return {
      modifier: (id, champ, texte, colonne) => this.modifierCellule(id, champ, texte, colonne),
      colonnesModifiees: (disposition) => this.modifierDisposition(disposition),

      inserer: (position, refId, { memeType = false } = {}) => {
        const groupeVide = this.groupesVides?.get(refId);
        if (groupeVide) return this.insererPoste(groupeVide);
        const ref = this.saisie.lignes.find((x) => x.lig_id === refId);
        let pos = position;
        let type = TL.ELEMENT;
        if (ref) {
          if (pos === 'enfant' && !accepteEnfants(ref)) pos = 'apres';
          if (memeType || pos !== 'enfant') type = ref.lig_tyl_id === TL.TVA ? TL.PIED_TTC : ref.lig_tyl_id;
          if (!memeType && pos !== 'enfant' && (type === TL.SOUS_TOTAL || type === TL.TEXTE)) type = TL.ELEMENT;
        }
        // Lignes limitées (règle) : une ligne de pied dans le pied, du texte ailleurs (jamais dans un ouvrage).
        if (this.lignesLimitees && !estPied({ lig_tyl_id: type })) {
          type = TL.TEXTE;
          if (pos === 'enfant' && ref && !estTranche(ref)) pos = 'apres';
        }
        const id = m.prochainId();
        m.modifier((d) => {
          d.lignes.push(this.nouvelleLigne(id, type, d.document.ent_id));
          const x = d.lignes.at(-1);
          placer(C, d.lignes, [x], ref ? refId : null, ref ? pos : 'racine');
          regles.appliquerContexte(d, id, taux);
          if (regles.estLigneDePrix(d.lignes, x) && x.lig_tva_id === null) x.lig_tva_id = regles.tauxParDefaut(d.lignes, id, taux);
        }, 'Insertion');
        return id;
      },

      deplacer: (ids, cibleId, position) => {
        if (!this.#sansLigneDuParent(ids, 'Déplacement')) return;
        m.modifier((d) => {
          const racines = racinesSelection(C, d.lignes, ids);
          placer(C, d.lignes, racines, cibleId, position);
          for (const r of racines) regles.appliquerContexte(d, r.lig_id, taux);
        }, 'Déplacement');
        this.coupees.clear();
      },

      indenter: (ids) => this.#sansLigneDuParent(ids, 'Changement de niveau') && m.modifier((d) => {
        for (const r of racinesSelection(C, d.lignes, ids)) {
          if (!estPied(r) && indenter(C, d.lignes, r.lig_id, accepteEnfants)) regles.appliquerContexte(d, r.lig_id, taux);
        }
      }, 'Descendre d\'un niveau'),

      desindenter: (ids) => this.#sansLigneDuParent(ids, 'Changement de niveau') && m.modifier((d) => {
        for (const r of racinesSelection(C, d.lignes, ids).reverse()) {
          if (desindenter(C, d.lignes, r.lig_id)) regles.appliquerContexte(d, r.lig_id, taux);
        }
      }, 'Remonter d\'un niveau'),

      decaler: (id, sens) => this.#sansLigneDuParent([id], 'Déplacement') && m.modifier((d) => { decaler(C, d.lignes, id, sens); }, 'Ordre'),

      supprimer: (ids) => {
        if (!this.#sansLigneDuParent(ids, 'Suppression')) return;
        const suivante = this.#ligneApres(ids);
        m.modifier((d) => {
          const supprimees = supprimer(C, d.lignes, racinesSelection(C, d.lignes, ids).map((r) => r.lig_id));
          this.apresSuppression(d, supprimees);
        }, 'Suppression');
        if (suivante !== null) this.grille.selectionner(suivante);
      },

      dupliquer: (ids) => {
        const contenu = pp.extraire(this.saisie, ids, { entId: this.saisie.document.ent_id, coupe: false });
        this.#insererContenu(contenu, contenu.racines.at(-1), 'Dupliquer');
      },

      copier: async (ids, couper) => {
        const contenu = pp.extraire(this.saisie, ids, { entId: this.saisie.document.ent_id, coupe: couper });
        await pp.ecrire(contenu);
        this.coupees = couper ? new Set(contenu.lignes.map((l) => l.lig_id)) : new Set();
        this.grille.rendre();
        this.surMessage?.(`${contenu.racines.length} ligne(s) ${couper ? 'coupée(s)' : 'copiée(s)'}`);
      },

      coller: async (refId) => {
        const contenu = await pp.lire();
        if (!contenu) { this.surMessage?.('Presse-papiers vide ou non compatible'); return; }
        const memeDocument = contenu.source_ent_id === this.saisie.document.ent_id;
        const presentes = contenu.racines.every((id) => this.saisie.lignes.some((l) => l.lig_id === id));
        if (contenu.coupe && memeDocument && presentes) {
          // Couper-coller dans le même document : déplacement, les ID, compléments et liens sont conservés.
          if (contenu.racines.includes(refId)) return;
          if (!regles.depotAutorise(this.saisie.lignes, contenu.racines, this.saisie.lignes.find((l) => l.lig_id === refId), 'apres')) {
            this.surMessage?.('Position de collage interdite');
            return;
          }
          this.grille.o.actions.deplacer(contenu.racines, refId, 'apres');
          pp.oublierCoupe();
          return;
        }
        this.#insererContenu(contenu, refId, 'Coller');
      },

      modifierRiche: (id, champ, html) => this.modifierLigne(id, champ, html),
      rechercher: (id) => this.rechercherExterne?.(id),
      annuler: () => m.annuler(),
      retablir: () => m.retablir(),

      depotAutorise: (ids, cibleId, position) => {
        const cible = this.saisie.lignes.find((l) => l.lig_id === cibleId);
        if (!cible) return false;
        return regles.depotAutorise(this.saisie.lignes, racinesSelection(C, this.saisie.lignes, ids).map((r) => r.lig_id), cible, position);
      },

      libelleDepot: (cibleId, position) => this.libelleDepot(cibleId, position),
      depotExterne: {
        types: Object.keys(TYPES_DEPOT),
        autorise: (cibleId, position, types) => this.depotExterneAutorise(cibleId, position, types),
        deposer: (cibleId, position, dt) => this.deposerExterne(cibleId, position, dt),
      },
      marqueur: (r) => this.marqueur(r),
      entetePoignee: (th) => this.entetePoignee(th),
      choisirMarqueur: (id, ancre) => this.choisirEtiquette(id, ancre),

      classeLigne: (r) => [
        r.virtuelle ? `pied-calcule pied-${r.virtuelle.type}` : '',
        `type-${(CODES_TL[r.calcule.lig_tyl_id] ?? '').toLowerCase()}`,
        r.estCalculee ? 'calculee' : '',
        r.messages.some((x) => this.resultat.erreurs.includes(x)) ? 'erreur' : r.messages.length ? 'avertissement' : '',
        !r.virtuelle && this.typePrixEffectif(r.calcule) !== 'V' ? 'hors-total' : '',
        !r.virtuelle && r.calcule.lig_tyl_id === TL.TITRE && r.calcule.lig_type_prix === 'F' ? 'tranche-frais' : '',
        r.calcule.lig_is_non_editee ? 'non-editee' : '',
        this.restes && Number(r.calcule.lig_qte_vendue ?? 0) === 0 && this.soldeLigne(r)?.avant.soldee ? 'ligne-soldee' : '',
        this.coupees.has(r.item.lig_id) ? 'coupee' : '',
        this.marques?.ids.has(r.item.lig_id) ? (r.item.lig_id === this.marques.courant ? 'trouvee trouvee-courante' : 'trouvee') : '',
      ].join(' '),

      titreLigne: (r) => r.messages.map((x) => x.message).join('\n'),
      selection: (id) => this.surSelection?.(id),
    };
  }

  #ligneApres(ids) {
    const lignes = this.grille.lignesAffichees;
    const sel = new Set(ids);
    const i = lignes.findIndex((r) => sel.has(r.item.lig_id));
    const apres = lignes.slice(i + 1).find((r) => !sel.has(r.item.lig_id) && !r.estCalculee);
    const avant = lignes.slice(0, Math.max(0, i)).reverse().find((r) => !r.estCalculee);
    return (apres ?? avant)?.item.lig_id ?? null;
  }

  /**
   * Insère un contenu (sous-arbres et compléments, format du presse-papiers) après la ligne de référence, ou à sa place
   * (remplacer : la ligne de référence est retirée dans la même étape d'annulation). Renvoie l'ID de la première racine.
   */
  insererContenu(contenu, refId, libelle, { remplacer = false, position = 'apres' } = {}) {
    if (!this.ajoutAutorise(contenu.lignes ?? [])) {
      this.surMessage?.('Document d\'avancement : seuls du texte et des lignes de pied s\'ajoutent');
      return null;
    }
    const copie = this.pressePapiers.renumeroter(contenu, this.magasin.prochainId());
    const ref = this.saisie.lignes.find((l) => l.lig_id === refId);
    if (ref && !this.regles.depotAutorise([...this.saisie.lignes, ...copie.lignes], copie.racines, ref, position)) {
      this.surMessage?.('Position d\'insertion interdite');
      return null;
    }
    this.magasin.modifier((d) => {
      d.lignes.push(...copie.lignes);
      this.pressePapiers.insererComplements(d, copie);
      const racines = copie.racines.map((id) => d.lignes.find((l) => l.lig_id === id));
      placer(C, d.lignes, racines, ref ? refId : null, ref ? position : 'racine');
      if (ref && remplacer) this.apresSuppression(d, supprimer(C, d.lignes, [refId]));
      for (const r of racines) this.regles.appliquerContexte(d, r.lig_id, this.definition.taux_tva);
    }, libelle);
    this.grille.selectionner(copie.racines[0]);
    return copie.racines[0];
  }

  /** Insère une copie (nouveaux ID temporaires) des sous-arbres après la ligne de référence. */
  #insererContenu(contenu, refId, libelle) {
    const copie = this.pressePapiers.renumeroter(contenu, this.magasin.prochainId());
    const ref = this.saisie.lignes.find((l) => l.lig_id === refId);
    if (ref && !this.regles.depotAutorise([...this.saisie.lignes, ...copie.lignes], copie.racines, ref, 'apres')) {
      this.surMessage?.('Position de collage interdite');
      return;
    }
    this.magasin.modifier((d) => {
      d.lignes.push(...copie.lignes);
      this.pressePapiers.insererComplements(d, copie);
      const racines = copie.racines.map((id) => d.lignes.find((l) => l.lig_id === id));
      placer(C, d.lignes, racines, ref ? refId : null, ref ? 'apres' : 'racine');
      for (const r of racines) this.regles.appliquerContexte(d, r.lig_id, this.definition.taux_tva);
    }, libelle);
    this.grille.selectionner(copie.racines[0]);
  }
}
