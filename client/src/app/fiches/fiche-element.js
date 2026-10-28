import { urlFiche, TYPE_FICHE, urlDocument, MODULE_FACULTATIF } from '../codes.js';
import { GESTION_ELEMENT } from '@logibtp/bibliotheque';
import { ajouterJours, aujourdhui } from '@logibtp/socle';
import { MODES } from '@logibtp/fiche';
import { echapper, formatNombre, creerCombo, formatDate } from '@logibtp/socle/ui';
import { GestionVuesDocument } from '@logibtp/document/ui';
import { OngletPrix, OngletUnites, OngletTarifs } from '@logibtp/bibliotheque/ui';
import { rendreStockArticle } from '../stock/article.js';
import { PanneauMetre } from '@logibtp/metre/ui';
import { EditeurDevisBtp, DictionnaireBtp } from '../editeur-btp.js';
import { PanneauxBtp } from '../panneaux-btp.js';
import { calculerOuvrage, documentComposition } from '../bibliotheque/bibliotheque.js';
import { AppelBibliotheque } from '../bibliotheque/appel.js';
import { FicheLogiBTP } from './fiches.js';
import { sectionVariablesTranche, lierVariablesTranche } from '../variables-tranche.js';
import { api } from '../api.js';

// Fiche d'un élément de bibliothèque (module Fiche + module Bibliothèque) : référentiels en listes déroulantes,
// onglets Prix (scénarios, coefficients, remise, historique), Unités (correspondances par formule), Tarifs
// fournisseurs, Composition des ouvrages (éditeur de devis et métrés), Image et notices techniques (GED, DOE).

const json = (v, defaut) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return defaut; } })() : v ?? defaut);
const prix = (v) => (v === null || v === undefined || v === '' ? '—' : formatNombre(v, Math.abs(Number(v)) < 10 ? 4 : 2));
/** Valeurs par défaut d'un poste de pied : unité (obligatoire en base), poste HT en pourcentage déduit du cumul. */
const DEFAUTS_POSTE = { unite_stock: 'u', pied_niveau: 'HT', pied_mode: 'P', pied_base: 'CUMUL', pied_sens: 'DEDUCTION', pied_retenue: false, gestion: 'NON_GERE' };
const DEFAUTS_TEXTE = { unite_stock: 'u', gestion: 'NON_GERE' };
const L = (o) => ({ lig_ent_id: 0, lig_proprietes: {}, lig_coef_remise: 1, lig_precision_qte: 2, lig_precision_pv: 2, lig_type_prix: 'V', lig_qte_source: 'S', lig_coef_perte: 1, ...o });

export class FicheElement extends FicheLogiBTP {
  /**
   * options.services : { bibliotheque, ged } ; options.definitionDocument() : définition du document de composition ;
   * options.vuesDocument : fournisseur des vues de colonnes (vues(type), enregistrer, supprimer).
   */
  constructor(options) {
    super(options);
    this.services = options.services;
    this.definitionDocument = options.definitionDocument;
    this.vuesDocument = options.vuesDocument ?? null;
    this.utilisateur = options.utilisateur ?? 'demo';
    this.admin = options.admin ?? false;
    this.ouvrirUrl = options.ouvrirUrl ?? (() => {});
  }

  get bibliotheque() { return this.services.bibliotheque; }

  async ouvrir() {
    const b = this.bibliotheque;
    const [bibliotheques, familles, natures, regroupements, unites, parametres, periodes] = await Promise.all([
      b.bibliotheques(), b.familles(), b.natures(), b.regroupements(), b.unites(), b.parametres(), b.periodes()]);
    this.referentiels = { bibliotheques, familles, natures, regroupements, unites, parametres, periodes };
    await super.ouvrir();
    await this.#chargerImage();
  }

  valeursCreation() {
    const { bibliotheques, parametres } = this.referentiels;
    const demande = new URLSearchParams(globalThis.location?.search ?? '').get('type');
    const type = ['OUVRAGE', 'ENSEMBLE', 'POSTE_PIED', 'TEXTE'].includes(demande) ? demande : 'ARTICLE';
    return {
      ...super.valeursCreation(), type, bib_id: (bibliotheques.find((x) => x.defaut) ?? bibliotheques[0])?.id ?? null,
      // Coefficients non imposés : ceux de la nature ou globaux (calculés à l'enregistrement).
      scenario_pa: parametres.scenario_defaut, coef_fg: String(parametres.coef_fg_defaut), coef_benef: String(parametres.coef_benef_defaut), unites: [],
      coef_fg_impose: false, coef_benef_impose: false,
      ...(type === 'POSTE_PIED' ? DEFAUTS_POSTE : {}),
      ...(type === 'TEXTE' ? DEFAUTS_TEXTE : {}),
    };
  }

  /** Texte (TEXTE) : libellé seul, inséré comme ligne de texte ou dans les textes de l'édition (ni prix ni unités). */
  get texte() { return this.valeur('type') === 'TEXTE'; }

  /** Poste de pied (POSTE_PIED) : ni prix, ni unités, ni composition ; ses valeurs vont dans le pied des documents. */
  get poste() { return this.valeur('type') === 'POSTE_PIED'; }

  sousTitre(v) {
    const bib = this.referentiels.bibliotheques.find((b) => b.id === Number(v.bib_id));
    const fam = this.referentiels.familles.find((f) => f.id === Number(v.fam_id));
    return [bib && `${bib.code} – ${bib.libelle}`, fam?.chemin, { OUVRAGE: 'Ouvrage', ENSEMBLE: 'Ensemble', POSTE_PIED: 'Poste de pied', TEXTE: 'Texte' }[v.type] ?? 'Article'].filter(Boolean).join(' · ');
  }

  /** Nature isolant : le groupe Isolation (R, λ, U) n'apparaît que pour elle. */
  estIsolant() {
    return this.referentiels.natures.find((n) => n.id === Number(this.valeur('nat_id')))?.isolant === true;
  }

  sections() {
    const isolant = this.estIsolant();
    const poste = this.poste;
    // Poste de pied : son groupe à la place des données techniques, de l'isolation et de la gestion.
    // Texte : identification, classement, libellé et mots-clés seulement.
    const texte = this.texte;
    const garder = (g) => (texte ? !['techniques', 'isolation', 'poste', 'description'].includes(g.code)
      : poste ? !['techniques', 'isolation'].includes(g.code) : g.code !== 'poste' && (g.code !== 'isolation' || isolant));
    return super.sections().map((s) => (s.groupes ? { ...s, groupes: s.groupes.filter(garder) } : s))
      .map((s) => (s.groupes ? { ...s, champs: s.groupes.flatMap((g) => g.champs) } : s));
  }

  /** Encart : image de l'élément et prix par unité de stock. */
  rendreInformations(v) {
    if (this.id === null || v.type === 'TEXTE') return '';
    if (v.type === 'POSTE_PIED') {
      const mode = { P: ' %', C: ' (coefficient)', M: ' €' }[v.pied_mode] ?? '';
      return `<span class="info"><small>Poste ${echapper(v.pied_niveau ?? '')}</small><b>${v.pied_sens === 'AJOUT' ? '+' : '−'} ${echapper(String(v.pied_valeur ?? '—').replace('.', ','))}${mode}</b></span>`;
    }
    return `${this.urlImage ? `<img class="element-vignette" src="${echapper(this.urlImage)}" alt="">` : ''}
      <span class="info"><small>PA</small>${prix(v.pa)}</span><span class="info"><small>PR</small>${prix(v.pr)}</span>
      <span class="info"><small>PV net / ${echapper(v.unite_stock ?? '')}</small><b>${prix(v.pv_net)}</b></span>`;
  }

  /** Bibliothèque, famille (selon la bibliothèque) et nature : listes déroulantes des référentiels. */
  rendreChamp(champ, valeur) {
    // Type choisi à la création : un poste de pied reçoit ses valeurs par défaut ; groupes et onglets suivent le type.
    if (champ.code === 'type') {
      const el = super.rendreChamp(champ, valeur);
      el.addEventListener('change', () => {
        const defauts = this.poste ? DEFAUTS_POSTE : this.texte ? DEFAUTS_TEXTE : null;
        if (defauts) {
          for (const [c, v] of Object.entries(defauts)) if ([null, undefined, ''].includes(this.valeur(c))) this.definirValeur(c, v);
        }
        this.rendre();
      });
      return el;
    }
    // Isolation : l'épaisseur est celle des données techniques ; R calculé proposé (épaisseur en m / λ).
    if (champ.code === 'isolant_epaisseur') return super.rendreChamp({ ...champ, lecture_seule: true }, this.valeur('epaisseur'));
    if (champ.code === 'isolant_r') {
      const el = super.rendreChamp(champ, valeur);
      const e = Number(String(this.valeur('epaisseur') ?? '').replace(',', '.'));
      const l = Number(String(this.valeur('isolant_lambda') ?? '').replace(',', '.'));
      if (e > 0 && l > 0) {
        const r = Math.round((e / 1000 / l) * 100) / 100;
        const bloc = document.createElement('div');
        bloc.className = 'element-r';
        bloc.append(el);
        bloc.insertAdjacentHTML('beforeend', `<small class="aide">e / λ = ${String(r).replace('.', ',')}</small>`);
        return bloc;
      }
      return el;
    }
    if (!champ.reference) return super.rendreChamp(champ, valeur);
    const { bibliotheques, familles, natures, regroupements } = this.referentiels;
    const bib = Number(this.valeur('bib_id'));
    const options = {
      bibliotheque: bibliotheques.filter((b) => b.actif || b.id === Number(valeur)).map((b) => [b.id, `${b.code} – ${b.libelle}`]),
      famille: familles.filter((f) => f.bib_id === bib).map((f) => [f.id, f.chemin]),
      nature: natures.filter((n) => n.actif || n.id === Number(valeur)).map((n) => [n.id, `${n.libelle}${n.regroupement ? ` (${regroupements.find((r) => r.code === n.regroupement)?.libelle ?? n.regroupement})` : ''}`]),
    }[champ.reference];
    const lecture = !this.estEnSaisie() || (champ.saisie === 'creation' && this.mode === MODES.MODIFICATION);
    const el = document.createElement('select');
    el.className = 'fiche-saisie-champ';
    el.innerHTML = `<option value=""></option>${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(valeur ?? '') ? 'selected' : ''}>${echapper(l)}</option>`).join('')}`;
    el.disabled = lecture;
    el.addEventListener('change', () => {
      this.definirValeur(champ.code, el.value === '' ? null : el.value);
      if (champ.code === 'bib_id') { this.definirValeur('fam_id', null); this.rendre(); }
      if (champ.code === 'nat_id') this.rendre(); // groupe Isolation et coefficients selon la nature
    });
    return el;
  }

  #contexte(modifiable) {
    return {
      valeur: (c) => this.valeur(c), definir: (c, v) => this.definirValeur(c, v), valeurs: () => ({ ...this.valeurs(), proprietes: this.proprietes() }),
      modifiable, id: this.id, fournisseur: this.bibliotheque, message: this.message, unites: this.referentiels.unites, parametres: this.referentiels.parametres,
      periodes: this.referentiels.periodes,
      donnees: (this.definition.supplementaires ?? []).filter((s) => s.type === 'nombre').map((s) => ({ code: s.code, libelle: s.libelle })),
      surPrix: (p) => { Object.assign(this.fiche.valeurs, { pa: p.pa, pr: p.pr, pv: p.pv, coef_benef: p.coef_benef, pv_net: p.pv_net }); this.#majInformations(); },
    };
  }

  #majInformations() {
    const zone = this.conteneur.querySelector('.fiche-informations');
    const html = this.rendreInformations(this.valeurs());
    zone.hidden = !html;
    zone.innerHTML = html;
  }

  ongletsSpecifiques() {
    // Ouvrage et ensemble : onglet Composition (éditeur de devis) ; article : tarifs fournisseurs.
    const ouvrage = ['OUVRAGE', 'ENSEMBLE'].includes(this.valeur('type'));
    if (this.poste || this.texte) return this.ongletUtilisations();
    return [
      { code: 'prix', titre: 'Prix', champs: ['scenario_pa', 'pa_fixe', 'dernier_pa', 'pmp', 'coef_fg', 'coef_fg_impose', 'coef_benef', 'coef_benef_impose', 'pv', 'pv_fixe', 'coef_remise', 'commentaire_prix'],
        rendre: (corps, { modifiable }) => new OngletPrix(corps, this.#contexte(modifiable)) },
      { code: 'unites', titre: 'Unités', champs: ['unite_stock', 'unite_achat', 'unite_vente', 'unites'], rendre: (corps, { modifiable }) => new OngletUnites(corps, this.#contexte(modifiable)) },
      ...(ouvrage
        ? [{ code: 'composition', titre: 'Composition', champs: ['composition'], rendre: (corps, { modifiable }) => this.#composition(corps, modifiable).catch((e) => this.message(e.message, 'erreur')) }]
        : [{ code: 'tarifs', titre: 'Tarifs fournisseurs', rendre: (corps, { modifiable }) => new OngletTarifs(corps, this.#contexte(modifiable)) }]),
      // Module Stock : quantités par lieu, valorisation, PMP, emplacements, mouvements (article géré en stock).
      ...(this.id !== null && this.valeur('gestion') === GESTION_ELEMENT.STOCK && this.valeur('type') === 'ARTICLE' && this.moduleActif(MODULE_FACULTATIF.STOCK)
        ? [{ code: 'stock', titre: 'Stock', rendre: (corps) => rendreStockArticle(corps, { id: Number(this.id), message: this.message, naviguer: (url, e) => this.ouvrirUrl(url, e) })
          .catch((e) => { corps.innerHTML = `<p class="aide">${echapper(e.message)}</p>`; }) }]
        : []),
      // Image et notices : sous les groupes de l'onglet Article.
      { code: 'image', dans: 'article', titre: 'Image et notices', champs: ['image_ged'], rendre: (corps, { modifiable }) => this.#imageNotices(corps, modifiable).catch((e) => this.message(e.message, 'erreur')) },
      ...this.ongletUtilisations(),
    ];
  }

  // ---------------------------------------------------------------- utilisations (lot 7 : A18g, A18h)

  /** Onglet Utilisations (élément enregistré) : ouvrages et ensembles qui le composent, lignes des pièces d'achat. */
  ongletUtilisations() {
    if (this.id === null) return [];
    return [{ code: 'utilisations', titre: 'Utilisations', rendre: (corps) => this.#utilisations(corps).catch((e) => this.message(e.message, 'erreur')) }];
  }

  async #utilisations(corps) {
    const id = Number(this.id);
    const composes = await api.composesElement(id);
    const icone = { OUVRAGE: '🏗️', ENSEMBLE: '🧩' };
    const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
    const filtre = { periode: '365', encours: false };
    corps.innerHTML = `<div class="element-utilisations"><h3>Ouvrages et ensembles qui l'utilisent</h3>
      ${composes.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th></th><th>Code</th><th>Libellé</th><th>Quantité</th><th>U.</th></tr></thead><tbody>
        ${composes.map((c) => `<tr><td>${icone[c.type] ?? ''}</td><td><a href="${urlFiche(TYPE_FICHE.ELEMENT, c.id)}">${echapper(c.bib_code)}:${echapper(c.code)}</a></td>
          <td>${echapper(c.libelle ?? '')}</td><td class="nombre">${c.quantite !== null && c.quantite !== undefined ? formatNombre(c.quantite, 4) : ''}</td><td>${echapper(c.unite ?? '')}</td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Utilisé dans aucun ouvrage ni ensemble.</p>'}
      ${this.valeur('type') === 'ARTICLE' ? `<div class="titre-actions"><h3>Achats</h3><span class="titre-actions-boutons"><span data-periode></span>
        <label class="fiche-option"><input type="checkbox" data-encours> En cours seulement</label></span></div><div data-achats></div>` : ''}</div>`;
    const zone = corps.querySelector('[data-achats]');
    if (!zone) return;
    const charger = async () => {
      const du = filtre.periode === 'tout' ? null : ajouterJours(aujourdhui(), -Number(filtre.periode));
      const l = await api.achatsElement(id, { du, encours: filtre.encours });
      zone.innerHTML = l.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Date</th><th>Pièce</th><th>Type</th><th>Fournisseur</th><th>Statut</th>
          <th>Qté</th><th>U.</th><th>PU HT</th><th>Montant HT</th><th></th></tr></thead><tbody>
        ${l.map((a) => `<tr><td>${jour(a.date)}</td><td><a href="${urlDocument(a.ent_id)}">${echapper(a.numero ?? 'Brouillon')}</a></td><td>${echapper(a.type)}</td>
          <td>${echapper(a.tiers ?? '')}</td><td>${echapper(a.statut)}</td><td class="nombre">${formatNombre(a.qte ?? 0, 2)}</td><td>${echapper(a.unite ?? '')}</td>
          <td class="nombre">${prix(a.pu)}</td><td class="nombre">${formatNombre(a.montant ?? 0, 2)}</td><td>${a.en_cours ? '<span class="pastille-compte attention">En cours</span>' : a.solde ? '<span class="pastille-compte neutre">Soldée</span>' : ''}</td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucune ligne d\'achat sur la période.</p>';
    };
    const periode = creerCombo({ options: [['30', '1 mois'], ['182', '6 mois'], ['365', '1 an'], ['tout', 'Tout']].map(([valeur, libelle]) => ({ valeur, libelle })), valeur: filtre.periode, vide: false });
    periode.addEventListener('change', () => { filtre.periode = periode.valeurCombo; charger().catch((e) => this.message(e.message, 'erreur')); });
    corps.querySelector('[data-periode]').append(periode);
    corps.querySelector('[data-encours]').addEventListener('change', (e) => { filtre.encours = e.target.checked; charger().catch((x) => this.message(x.message, 'erreur')); });
    await charger();
  }

  // ---------------------------------------------------------------- composition d'un ouvrage

  get ensemble() { return this.valeur('type') === 'ENSEMBLE'; }

  #compositionInitiale() {
    if (this.ensemble) {
      // Ensemble : une tranche racine paramétrée (largeur, hauteur) ; ses lignes s'ajoutent dessous.
      return {
        mode: 'V', metres: [],
        variables: [
          { var_id: 101, var_lig_id: 1, var_mtr_id: null, var_portee: '$', var_nom: 'largeur', var_operation: '=', var_formule: '1', var_ordre: 1 },
          { var_id: 102, var_lig_id: 1, var_mtr_id: null, var_portee: '$', var_nom: 'hauteur', var_operation: '=', var_formule: '1', var_ordre: 2 },
        ],
        lignes: [L({ lig_id: 1, lig_parent_id: null, lig_ordre: 1, lig_tyl_id: 1, lig_libelle_html: this.valeur('libelle_html') || 'Ensemble' })],
      };
    }
    return {
      mode: 'D', metres: [], variables: [],
      lignes: [L({ lig_id: 1, lig_parent_id: null, lig_ordre: 1, lig_tyl_id: 2, lig_libelle_html: this.valeur('libelle_html') || 'Ouvrage', lig_qte: 1, lig_unt_code: this.valeur('unite_stock') ?? 'u' })],
    };
  }

  /**
   * Éditeur de devis sur la composition (lignes, métrés F4, variables) ; prix recalculés en direct. Sans pied (un
   * ouvrage n'a ni postes de pied ni TVA) ; natures et coefficients par défaut des référentiels ; vues de colonnes
   * comme les documents (modèle COMPOSITION : vue propre mémorisée) ; panneau de détail de la ligne à droite.
   */
  async #composition(corps, modifiable) {
    const composition = json(this.valeur('composition'), null) ?? this.#compositionInitiale();
    corps.innerHTML = `<div class="element-composition">
      <div class="element-composition-barre">
        <label ${this.ensemble ? 'hidden' : ''}>Calcul de l'ouvrage <span data-mode></span></label>
        ${modifiable ? '<button type="button" data-article title="Ou saisir un code dans la colonne Code, ou F3">＋ Élément de la bibliothèque</button>' : ''}
        <span class="groupe" data-vues></span>
        <span class="element-composition-totaux"></span>
      </div>
      ${this.ensemble ? '<div class="element-parametres"></div>' : ''}
      <div class="element-composition-corps"><div class="element-composition-grille"></div><aside class="element-composition-detail detail"></aside></div>
      <p class="aide">${this.ensemble
    ? 'Ensemble : lignes sous la tranche, vendues ou en option, variante, pour mémoire (détail de la ligne). Les paramètres de la tranche ({{$largeur}}…) sont repris par les métrés (F4) et les libellés ; le prix est celui des lignes vendues, chacune avec ses coefficients.'
    : `Quantités par unité d'ouvrage (${echapper(this.valeur('unite_stock') ?? '?')}). F4 sur une composante : métré. Les coefficients de l'élément (onglet Prix) s'appliquent à l'ouvrage.`}</p>
      <aside class="tiroir element-metre" hidden></aside></div>`;
    const combo = creerCombo({
      options: [{ valeur: 'D', libelle: "Déboursé : PR des composantes × coefficients de l'élément" }, { valeur: 'V', libelle: 'Somme des PV des composantes' }],
      valeur: composition.mode ?? 'D', vide: false,
    });
    combo.disabled = !modifiable;
    corps.querySelector('[data-mode]').append(combo);
    const definition = await this.definitionDocument();
    // Le métré est créé après l'éditeur, qui signale déjà sa sélection à sa construction.
    let metre = null;
    let editeur = null;
    // Composantes appelées dans la bibliothèque de l'ouvrage (colonne Code, F3, bouton).
    const bibOuvrage = () => this.referentiels.bibliotheques.find((b) => b.id === Number(this.valeur('bib_id')))?.code ?? null;
    const appel = new AppelBibliotheque({ fournisseur: this.bibliotheque, editeur: () => editeur, bibliotheque: bibOuvrage, message: this.message, postes: false });
    let panneaux = null;
    const detail = corps.querySelector('.element-composition-detail');
    editeur = new EditeurDevisBtp(corps.querySelector('.element-composition-grille'), {
      definition, pied: false,
      saisie: { document: documentComposition(composition.mode), lignes: composition.lignes, metres: composition.metres ?? [], variables: composition.variables ?? [] },
      surSelection: (id) => { metre?.suivre(id); panneaux?.rendreDetail(detail, id); },
      surMessage: (t) => this.message(t), ouvrirMetre: (ligId, mtrId) => metre.ouvrir(ligId, mtrId),
      appelerCode: (ligId, code) => (modifiable ? appel.appeler(ligId, code) : null), rechercher: (ligId) => (modifiable ? appel.rechercher(ligId) : null),
    });
    metre = new PanneauMetre(corps.querySelector('.element-metre'), editeur, {
      fermer: (ligId) => { editeur.grille.selectionner(ligId, { colonne: 3 }); editeur.grille.focus(); }, message: (t) => this.message(t), dictionnaire: new DictionnaireBtp(editeur),
    });
    // Natures (colonne et détail) et coefficients par défaut, comme la page document.
    editeur.natures = this.referentiels.natures;
    editeur.coefsDefaut = { fg: this.referentiels.parametres?.coef_fg_defaut ?? 1, benef: this.referentiels.parametres?.coef_benef_defaut ?? 1 };
    panneaux = new PanneauxBtp(editeur, { bibliotheques: this.referentiels.bibliotheques });
    if (this.vuesDocument) {
      const vues = new GestionVuesDocument(corps.querySelector('[data-vues]'), { editeur, fournisseur: this.vuesDocument, admin: () => this.admin, message: (t) => this.message(t) });
      vues.charger().catch((e) => this.message(e.message, 'erreur'));
    }
    editeur.magasin.lectureSeule = !modifiable;
    editeur.magasin.surRefus = () => this.message('Passez la fiche en modification pour changer la composition', 'avertissement');
    const mode = () => combo.valeurCombo;
    const totaux = () => {
      const c = { mode: mode(), lignes: editeur.saisie.lignes, metres: editeur.saisie.metres, variables: editeur.saisie.variables };
      let r;
      try { r = calculerOuvrage(c, { coef_fg: this.valeur('coef_fg'), coef_benef: this.valeur('coef_benef'), coef_remise: this.valeur('coef_remise') }); } catch (e) { r = { erreur: e.message }; }
      corps.querySelector('.element-composition-totaux').innerHTML = r.erreur ? `<span class="erreur">${echapper(r.erreur)}</span>`
        : `PA ${prix(r.pa)} · PR ${prix(r.pr)} · PV ${prix(r.pv)} · <b>PV net ${prix(r.pv_net)}</b> ${this.ensemble ? '(lignes vendues)' : `/ ${echapper(this.valeur('unite_stock') ?? '')}`}`;
      return c;
    };
    // Ensemble : paramètres de la tranche racine (variables $) au-dessus de la grille.
    const parametres = () => {
      const zone = corps.querySelector('.element-parametres');
      const racine = editeur.saisie.lignes.find((l) => l.lig_parent_id === null);
      if (!zone || !racine || zone.contains(document.activeElement)) return;
      zone.innerHTML = sectionVariablesTranche(editeur, racine.lig_id, { modifiable, titre: "Paramètres de l'ensemble ($)" });
      lierVariablesTranche(zone, editeur);
    };
    editeur.magasin.abonner(() => { this.definirValeur('composition', totaux()); parametres(); });
    parametres();
    combo.addEventListener('change', () => this.definirValeur('composition', totaux()));
    // Bouton : composante insérée après la ligne courante (sinon sous l'ouvrage).
    corps.querySelector('[data-article]')?.addEventListener('click', () => {
      const racine = editeur.saisie.lignes.find((l) => l.lig_parent_id === null);
      const courante = editeur.grille.courant;
      const enfant = editeur.saisie.lignes.find((l) => l.lig_id === courante && l.lig_parent_id !== null);
      appel.rechercher(enfant ? courante : editeur.saisie.lignes.filter((l) => l.lig_parent_id === racine?.lig_id).at(-1)?.lig_id ?? null).catch((e) => this.message(e.message, 'erreur'));
    });
    totaux();
  }

  // ---------------------------------------------------------------- image et notices techniques (GED)

  async #chargerImage() {
    this.urlImage = null;
    const id = this.valeur('image_ged');
    if (!id || !this.services.ged) return;
    try {
      const d = await this.services.ged.document(id);
      if (d.version) this.urlImage = this.services.ged.urlContenu(d.version.id);
    } catch { /* image retirée de la GED */ }
    this.#majInformations();
  }

  async #imageNotices(corps, modifiable) {
    const ged = this.services.ged;
    if (this.id === null) { corps.innerHTML = '<p class="aide">Enregistrez l\'élément pour lui associer une image et des notices techniques.</p>'; return; }
    const docs = await ged.lister({ type_element: TYPE_FICHE.ELEMENT, id_element: String(this.id) });
    const images = docs.filter((d) => d.version?.type_mime?.startsWith('image/'));
    const notices = docs.filter((d) => d.categorie === 'notice_technique');
    const choisie = Number(this.valeur('image_ged')) || null;
    corps.innerHTML = `<div class="element-medias">
      <fieldset class="fiche-groupe"><legend>Image de l'élément</legend>
        <div class="element-images">${images.map((d) => `<label class="element-image ${d.id === choisie ? 'choisie' : ''}">
          <img src="${echapper(ged.urlContenu(d.version.id))}" alt="${echapper(d.titre)}"><span><input type="radio" name="image" value="${d.id}" ${d.id === choisie ? 'checked' : ''} ${modifiable ? '' : 'disabled'}> ${echapper(d.titre)}</span></label>`).join('')
          || '<p class="aide">Aucune image : ajoutez-en une.</p>'}</div>
        <p><button type="button" data-ajout="image">＋ Ajouter une image</button>${choisie && modifiable ? ' <button type="button" data-retirer>Retirer l\'image</button>' : ''}
          ${modifiable ? '' : '<span class="aide"> Passez en modification pour choisir l\'image de l\'élément.</span>'}</p>
      </fieldset>
      <fieldset class="fiche-groupe"><legend>Notices techniques (DOE)</legend>
        ${notices.length ? `<ul class="element-notices">${notices.map((d) => `<li>📘 <a href="${echapper(ged.urlContenu(d.version.id, { telecharger: true }))}" target="_blank" rel="noopener">${echapper(d.titre)}</a>
          <small>${echapper(d.version?.nom_fichier ?? '')}${d.date_document ? ` · ${formatDate(d.date_document)}` : ''}</small></li>`).join('')}</ul>` : '<p class="aide">Aucune notice technique.</p>'}
        <p><button type="button" data-ajout="notice">＋ Ajouter une notice technique</button></p>
        <p class="aide">Les notices techniques (catégorie GED « Notice technique (DOE) ») seront jointes au dossier des ouvrages exécutés remis au client.</p>
      </fieldset>
      <input type="file" hidden data-fichier></div>`;
    corps.querySelectorAll('input[name="image"]').forEach((r) => r.addEventListener('change', () => {
      this.definirValeur('image_ged', r.value);
      this.#chargerImage();
      corps.querySelectorAll('.element-image').forEach((l) => l.classList.toggle('choisie', l.contains(r)));
    }));
    corps.querySelector('[data-retirer]')?.addEventListener('click', () => { this.definirValeur('image_ged', null); this.urlImage = null; this.#majInformations(); this.#imageNotices(corps, modifiable); });
    const entree = corps.querySelector('[data-fichier]');
    let genre = 'image';
    corps.querySelectorAll('[data-ajout]').forEach((b) => b.addEventListener('click', () => {
      genre = b.dataset.ajout;
      entree.accept = genre === 'image' ? 'image/*' : '';
      entree.click();
    }));
    entree.addEventListener('change', async () => {
      const fichier = entree.files[0];
      entree.value = '';
      if (!fichier) return;
      try {
        await ged.deposer({
          fichier, meta: {
            titre: fichier.name.replace(/\.[^.]+$/, ''), categorie: genre === 'image' ? 'photo' : 'notice_technique', type_element: TYPE_FICHE.ELEMENT, id_element: String(this.id),
            date_document: aujourdhui(), auteur: this.utilisateur,
          },
        });
        this.message(genre === 'image' ? 'Image ajoutée à la GED de l\'élément' : 'Notice technique ajoutée', 'succes');
        await this.#imageNotices(corps, modifiable);
      } catch (e) { this.message(e.message, 'erreur'); }
    });
  }
}
