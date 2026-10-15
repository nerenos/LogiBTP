import {
  CFG_LIGNES as C, ordreAffichage, parId, placer, indenter, desindenter, decaler, supprimer, racinesSelection,
  Magasin, GrilleArbre, formatNombre, formatLibre, htmlSur, lireNombre, estHtml, decoderEntites, echapper,
  editerLibelle, lirePreferences, ecrirePreferences,
} from '@logibtp/socle/ui';
import { calculerDocument, TL, CODES_TL, estChiffree, estPied, accepteEnfants, estTranche, estTypeNumerote } from '../src/index.js';
import { ReglesDocument } from './regles.js';
import { PressePapiers } from './presse-papiers.js';

/** Libellés des totaux calculés et des groupes du pied (structure résultat.pied du moteur). */
export const LIBELLES_PIED = {
  TOTAL_HT: 'Total HT', HT_NET: 'Total HT net', TOTAL_TTC: 'Total TTC', SOUS_TOTAL: 'Sous-total', NET: 'Net à payer',
  HT: 'Postes de pied HT', TTC: 'Postes de pied TTC', TVA: 'TVA',
};

/** Identifiant de la tranche calculée « Pied du document » (lignes virtuelles : identifiants ≤ −9·10¹¹). */
export const ID_PIED = -9e11;

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

export const LIBELLES_TYPE_PRIX = { V: 'Vendu', O: 'Option', M: 'Pour mémoire', A: 'Variante' };

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
  constructor(conteneur, { definition, saisie, surSelection, surMessage, appelerCode = null, rechercher = null, vue = null }) {
    this.definition = definition;
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
    this.libellesUneLigne = lirePreferences().libelles === 'ligne';
    conteneur.classList.toggle('libelles-une-ligne', this.libellesUneLigne);
    this.magasin = new Magasin(saisie, {
      recalculer: (s) => this.calculer(this.entree(s)),
      identifiants: (s, r) => this.identifiants(s, r),
    });
    this.grille = new GrilleArbre(conteneur, {
      cle: 'lig_id',
      colonnes: this.colonnesAffichees(),
      lignes: (replies) => this.lignesGrille(replies),
      actions: this.actions(),
    });
    this.magasin.abonner(() => this.grille.rendre());
    this.grille.rendre();
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
  saisissable(l) { return !this.magasin?.lectureSeule && !l._virtuelle && !this.estLigneCalculee(l); }

  // ---------------------------------------------------------------- vues de colonnes

  /** Colonnes de la vue (dans son ordre), et colonnes système en mode débogage ; sans vue : toutes les colonnes. */
  colonnesAffichees() {
    const catalogue = this.colonnes();
    if (!this.vue?.colonnes?.length) return catalogue;
    const parCle = new Map(catalogue.map((c) => [c.cle, c]));
    const res = this.vue.colonnes.map((c) => parCle.get(c.cle)).filter(Boolean);
    if (!res.length) return catalogue;
    // La première colonne porte l'arborescence (repli des lignes).
    if (!res[0].arbre) res[0] = { ...res[0], arbre: true };
    if (this.vue.debogage) {
      const choisis = this.vue.systeme ?? [];
      res.push(...this.colonnesSysteme().filter((c) => !choisis.length || choisis.includes(c.champ)));
    }
    return res;
  }

  /** Vue de colonnes appliquée à la grille. */
  appliquerVue(vue) {
    this.vue = vue;
    this.grille.definirColonnes(this.colonnesAffichees());
    this.surVue?.(vue); // l'hôte suit le mode débogage de la vue
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

  /** Pastille : couleur de l'étiquette (haut gauche), couleur du mode de vente hors « vendu » (bas droite). */
  marqueur(r) {
    if (r.virtuelle) return null;
    const l = r.item;
    const e = l.lig_etiquette ? this.etiquettes().find((x) => x.code === l.lig_etiquette) : null;
    const t = (l.lig_type_prix ?? 'V') !== 'V' ? this.couleurTypePrix(l.lig_type_prix) : null;
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
      ${['V', 'O', 'M', 'A'].map((t) => ligne('data-type', t, this.couleurTypePrix(t)?.couleur, LIBELLES_TYPE_PRIX[t], types.has(t), compte.get(`t:${t}`))).join('')}
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
    if ((this.resultat.pied ?? []).some((e) => e.lig_id === id || e.lignes?.includes(id))) {
      for (const r of [...this.grille.replies]) if (r === ID_PIED || r <= -1e12) this.grille.replies.delete(r);
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
    if (this.magasin.lectureSeule) return false;
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
    const pied = this.resultat.pied ?? [];
    if (!pied.length) return lignes;
    const dansPied = new Set(pied.flatMap((e) => [...(e.lignes ?? []), ...(e.lig_id !== null ? [e.lig_id] : [])]));
    const parId = new Map(lignes.map((r) => [r.item.lig_id, r]));
    const res = lignes.filter((r) => !dansPied.has(r.item.lig_id) && !estPied(r.calcule));
    const p = [];
    const pm = this.saisie.document.ent_precision_montant ?? 2;
    // Identifiant stable par position dans le pied (le repli d'un groupe ne décale pas les suivants).
    const virtuelle = (cle, type, libelle, montant, { aEnfants = false, profondeur = 0, html = null, rang = 0 } = {}) => {
      const id = cle === 'PIED' ? ID_PIED : -1e12 - Number(cle.match(/\d+/)[0]) * 1000 - rang;
      return {
        item: { lig_id: id, _virtuelle: true, lig_parent_id: null },
        calcule: { lig_id: id, lig_libelle_affiche: html ?? echapper(libelle), lig_montant_ht: montant, _virtuelle: true },
        profondeur, aEnfants, messages: [], estCalculee: true, virtuelle: { cle, type },
      };
    };
    pied.forEach((e, i) => {
      if (e.genre === 'total') {
        if (!e.masque) p.push(virtuelle(`T${i}`, 'total', LIBELLES_PIED[e.cle] ?? e.cle, e.montant));
        return;
      }
      if (e.genre === 'ligne') {
        const r = parId.get(e.lig_id);
        if (r) p.push({ ...r, profondeur: 0 });
        return;
      }
      // Groupe : ligne calculée parente (ou la ligne de ventilation TVA saisie), puis ses lignes.
      const tvaSaisie = e.cle === 'TVA' ? parId.get(e.lignes?.[0]) : null;
      let parent;
      if (tvaSaisie) parent = { ...tvaSaisie, profondeur: 0, aEnfants: true };
      else parent = virtuelle(`G${i}`, 'groupe', LIBELLES_PIED[e.cle] ?? e.cle, e.montant, { aEnfants: true });
      p.push(parent);
      if (replies.has(parent.item.lig_id)) return;
      if (e.cle === 'TVA') {
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
    // Lignes de pied hors structure (ventilation TVA en double…) : à la fin.
    for (const r of lignes) if (estPied(r.calcule) && !dansPied.has(r.item.lig_id)) p.push(r);
    // Tout le pied dans une tranche repliable (montant : net à payer).
    const net = pied.at(-1)?.montant ?? null;
    res.push(virtuelle('PIED', 'tranche', 'Pied du document', net, { aEnfants: true }));
    if (!replies.has(ID_PIED)) res.push(...p.map((r) => ({ ...r, profondeur: r.profondeur + 1 })));
    return res;
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
      },
      {
        cle: 'type', titre: 'Type', classe: 'col-type', editeur: 'select', editable: saisissable,
        champ: () => 'lig_tyl_id', lire: (l) => l.lig_tyl_id,
        options: () => this.definition.types_ligne.map((t) => ({ valeur: t.tyl_id, libelle: t.tyl_libelle })),
        valeur: (r) => (r.virtuelle ? { total: 'Total', groupe: 'Groupe', tva: 'Taux', tranche: 'Pied' }[r.virtuelle.type] : this.libelleType(r)),
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
          ouvrir: (l) => editerLibelle({
            html: l.lig_libelle_html,
            titre: [this.resultat.lignes.find((x) => x.lig_id === l.lig_id)?.lig_numerotation, LIBELLES_TYPE[CODES_TL[l.lig_tyl_id]]].filter(Boolean).join(' · '),
            variables: this.variablesLibelle(),
          }),
        },
        enteteBouton: {
          texte: () => (this.libellesUneLigne ? '⇕' : '⇔'),
          titre: () => (this.libellesUneLigne ? 'Afficher les libellés en entier' : 'Afficher les libellés sur une seule ligne'),
          clic: () => {
            this.libellesUneLigne = !this.libellesUneLigne;
            ecrirePreferences({ libelles: this.libellesUneLigne ? 'ligne' : 'complet' });
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
    ];
  }

  /** Variables proposées dans l'éditeur de libellé : données de la ligne et du document. */
  variablesLibelle() {
    return [
      ['lig_qte_vendue', 'Quantité vendue'], ['lig_unt_code', 'Unité'], ['lig_pv_remise', 'PV net'], ['lig_montant_ht', 'Montant HT'],
      ['lig_numerotation', 'Numéro de ligne'], ['document.ent_numero', 'Numéro du document'], ['document.ent_objet', 'Objet du document'],
    ].map(([v, l]) => ({ valeur: `{{${v}}}`, libelle: `${l} – {{${v}}}` }));
  }

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
    // Saisie en ligne : texte simple, échappé (la mise en forme passe par l'éditeur riche).
    if (champ === 'lig_libelle_html') valeur = valeur.trim() === '' ? null : echapper(valeur);
    if (champ === 'lig_unt_code' && valeur.trim() === '') valeur = null;
    if (champ === 'lig_unt_code' && valeur) valeur = valeur.trim().slice(0, 10);
    this.modifierLigne(id, champ, valeur);
    return true;
  }

  actions() {
    const m = this.magasin;
    const taux = this.definition.taux_tva;
    const regles = this.regles;
    const pp = this.pressePapiers;
    return {
      modifier: (id, champ, texte, colonne) => this.modifierCellule(id, champ, texte, colonne),

      inserer: (position, refId, { memeType = false } = {}) => {
        const ref = this.saisie.lignes.find((x) => x.lig_id === refId);
        let pos = position;
        let type = TL.ELEMENT;
        if (ref) {
          if (pos === 'enfant' && !accepteEnfants(ref)) pos = 'apres';
          if (memeType || pos !== 'enfant') type = ref.lig_tyl_id === TL.TVA ? TL.PIED_TTC : ref.lig_tyl_id;
          if (!memeType && pos !== 'enfant' && (type === TL.SOUS_TOTAL || type === TL.TEXTE)) type = TL.ELEMENT;
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
        m.modifier((d) => {
          const racines = racinesSelection(C, d.lignes, ids);
          placer(C, d.lignes, racines, cibleId, position);
          for (const r of racines) regles.appliquerContexte(d, r.lig_id, taux);
        }, 'Déplacement');
        this.coupees.clear();
      },

      indenter: (ids) => m.modifier((d) => {
        for (const r of racinesSelection(C, d.lignes, ids)) {
          if (!estPied(r) && indenter(C, d.lignes, r.lig_id, accepteEnfants)) regles.appliquerContexte(d, r.lig_id, taux);
        }
      }, 'Descendre d\'un niveau'),

      desindenter: (ids) => m.modifier((d) => {
        for (const r of racinesSelection(C, d.lignes, ids).reverse()) {
          if (desindenter(C, d.lignes, r.lig_id)) regles.appliquerContexte(d, r.lig_id, taux);
        }
      }, 'Remonter d\'un niveau'),

      decaler: (id, sens) => m.modifier((d) => { decaler(C, d.lignes, id, sens); }, 'Ordre'),

      supprimer: (ids) => {
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
        (r.calcule.lig_type_prix ?? 'V') !== 'V' ? 'hors-total' : '',
        r.calcule.lig_is_non_editee ? 'non-editee' : '',
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
