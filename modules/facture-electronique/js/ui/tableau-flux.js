// Module Facturation électronique, tableau des flux émis et reçus (fe_flux) : filtres par sens, état de la file, type,
// statut affiché, erreurs et jours de création (gardés dans le navigateur), pages par identifiant décroissant, relève
// à la demande, vérification de la chaîne du journal. Le module Liste ne s'y prête pas (ses vues sont générées par le
// cœur) : tableau propre au module. L'ouverture d'un flux est fournie par l'application.
import { texte, texteHtml, iconeHtml, messageErreur, existe } from '@logibtp/socle/dictionnaire';
import { echapper, creerCombo, champDate, alerter, formatDateHeure, lireStockage, ecrireStockage, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { SENS_FLUX, ETAT_FLUX, TYPE_FLUX, STATUT_CDV } from '../src/codes.js';
import { FILTRES_VIDES, filtresValables, requeteFlux, filtrerParStatut, pageSuivante, ajouterPage, graviteEtat, graviteStatut, actionsFlux, LIMITE_PAGE } from './modeles.js';
import { libelleEtat } from './chronologie.js';

export const GROUPE_RACCOURCIS_TABLEAU = 'facture_electronique_tableau';
declarerRaccourcis(GROUPE_RACCOURCIS_TABLEAU, {
  libelle: texte('facture_electronique.raccourcis.groupe_tableau'),
  actions: {
    actualiser: { libelle: texte('facture_electronique.raccourcis.actualiser'), defaut: 'Alt+Shift+R' },
    suivants: { libelle: texte('facture_electronique.raccourcis.suivants'), defaut: 'Alt+Shift+N' },
    relever: { libelle: texte('facture_electronique.raccourcis.relever'), defaut: 'Alt+Shift+L' },
    effacer: { libelle: texte('facture_electronique.raccourcis.effacer_filtres'), defaut: 'Alt+Shift+X' },
  },
});

/** Préférence d'affichage (navigateur) : filtres du tableau. */
export const PREFERENCE_FILTRES = 'logibtp.facture_electronique.tableau.filtres';

/** Types de flux proposés au filtre : factures et statuts (l'e-reporting viendra avec la partie B). */
const TYPES_FILTRE = [TYPE_FLUX.FACTURE_CLIENT, TYPE_FLUX.FACTURE_FOURNISSEUR, TYPE_FLUX.CDV_FACTURE_CLIENT, TYPE_FLUX.CDV_FACTURE_FOURNISSEUR];

/** Libellé d'un type de flux (code brut si le dictionnaire ne le connaît pas). */
export const libelleType = (t) => (existe(`facture_electronique.types.${t}`) ? texte(`facture_electronique.types.${t}`) : t);

/**
 * Tableau des flux. options : { peut: { modifier }, api: { flux(requete), relever(), verifierJournal() } (promesses),
 * ouvrirFlux(id, nouvelleFenetre), libelleElement(type, id), ouvrirElement(type, id, nouvelleFenetre) (facultatif),
 * apresEcriture(), erreur(e) }.
 */
export class TableauFlux {
  #zone;
  #o;
  #filtres = filtresValables(lireStockage(PREFERENCE_FILTRES, FILTRES_VIDES));
  #flux = [];
  #suivant = null;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { peut: {}, api: {}, ouvrirFlux: () => {}, libelleElement: (type, id) => texte('facture_electronique.element', { type, id }),
      apresEcriture: () => {}, erreur: (e) => alerter(messageErreur(e?.code, e?.message ?? String(e))), ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('change', (e) => this.#changement(e));
    this.#zone.addEventListener('keydown', (e) => this.#clavier(e));
  }

  get filtres() {
    return { ...this.#filtres };
  }

  /** Flux chargés, filtrés par statut affiché. */
  get flux() {
    return filtrerParStatut(this.#flux, this.#filtres.statut);
  }

  /** Recharge la première page avec les filtres. */
  async charger() {
    try {
      const page = (await this.#o.api.flux(requeteFlux(this.#filtres))) ?? [];
      this.#flux = page;
      this.#suivant = pageSuivante(page, LIMITE_PAGE);
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  /** Ajoute la page suivante. */
  async suivants() {
    if (this.#suivant === null) return;
    try {
      const page = (await this.#o.api.flux(requeteFlux(this.#filtres, { avant: this.#suivant }))) ?? [];
      this.#flux = ajouterPage(this.#flux, page);
      this.#suivant = pageSuivante(page, LIMITE_PAGE);
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  #rendre() {
    const f = this.#filtres;
    const lignes = this.flux;
    const ligne = (x) => {
      const a = actionsFlux(x);
      const element = x.type_element ? (this.#o.ouvrirElement
        ? `<button type="button" class="lien" data-element="${echapper(x.type_element)}" data-id-element="${echapper(x.id_element)}">${echapper(this.#o.libelleElement(x.type_element, x.id_element))}</button>`
        : echapper(this.#o.libelleElement(x.type_element, x.id_element))) : '';
      return `<tr data-flux="${x.id}">
        <td title="${echapper(texte(`facture_electronique.sens.${x.sens}`))}">${iconeHtml(x.sens === SENS_FLUX.SORTANT ? 'fe_sortant' : 'fe_entrant')}</td>
        <td>${echapper(libelleType(x.type))}</td><td>${echapper(x.numero ?? '')}</td><td>${echapper(x.nom)}</td>
        <td><span class="fe-pastille fe-${graviteEtat(x.etat)}">${echapper(libelleEtat(x.etat))}</span>${a.confirmerDepot ? ` ${iconeHtml('fe_depot')}` : ''}</td>
        <td>${x.statut_affiche ? `<span class="fe-pastille fe-${graviteStatut(x.statut_affiche)}">${echapper(libelleEtat(x.statut_affiche))}</span>` : ''}</td>
        <td>${element}</td><td class="montant">${x.essais || ''}</td><td>${echapper(formatDateHeure(x.cree_le))}</td>
        <td class="fe-erreur-courte" title="${echapper(x.derniere_erreur ?? '')}">${x.derniere_erreur ? `${iconeHtml('fe_avertissement')} ${echapper(x.derniere_erreur)}` : ''}</td>
        <td class="cellule-boutons"><button type="button" data-ouvrir="${x.id}" title="${echapper(texte('facture_electronique.tableau.ouvrir'))}">${iconeHtml('fe_ouvrir')}</button></td></tr>`;
    };
    const colonnes = ['sens', 'type', 'numero', 'nom', 'etat', 'statut', 'element', 'essais', 'cree_le', 'erreur', ''];
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('fe_flux')} ${texteHtml('facture_electronique.tableau.titre')}</h2>
      <div class="barre-outils">
        <span class="groupe-outils fe-filtres">
          <label>${texteHtml('facture_electronique.filtres.sens')} <span data-combo="sens"></span></label>
          <label>${texteHtml('facture_electronique.filtres.etat')} <span data-combo="etat"></span></label>
          <label>${texteHtml('facture_electronique.filtres.type')} <span data-combo="type"></span></label>
          <label>${texteHtml('facture_electronique.filtres.statut')} <span data-combo="statut"></span></label>
          <label>${texteHtml('facture_electronique.filtres.erreurs')} <span data-combo="erreurs"></span></label>
          <label>${texteHtml('facture_electronique.filtres.du')} <input type="date" data-filtre="du" value="${echapper(f.du)}"></label>
          <label>${texteHtml('facture_electronique.filtres.au')} <input type="date" data-filtre="au" value="${echapper(f.au)}"></label>
          <button type="button" data-effacer title="${echapper(texte('facture_electronique.filtres.effacer'))}">${iconeHtml('fe_effacer')}</button>
        </span>
        <span class="groupe-outils">
          <button type="button" data-actualiser title="${echapper(texte('commun.actualiser'))}">${iconeHtml('fe_actualiser')}</button>
          ${this.#o.peut.modifier && this.#o.api.relever ? `<button type="button" data-relever title="${echapper(texte('facture_electronique.tableau.relever_titre'))}">${iconeHtml('fe_relever')} ${texteHtml('facture_electronique.tableau.relever')}</button>` : ''}
          ${this.#o.api.verifierJournal ? `<button type="button" data-verifier title="${echapper(texte('facture_electronique.tableau.verifier_titre'))}">${iconeHtml('fe_verifier')}</button>` : ''}
        </span>
      </div>
      ${lignes.length ? `<table class="tableau-compact fe-table"><thead><tr>${colonnes.map((c) => `<th>${c ? texteHtml(`facture_electronique.colonnes.${c}`) : ''}</th>`).join('')}</tr></thead>
        <tbody>${lignes.map(ligne).join('')}</tbody></table>` : `<p class="aide">${texteHtml('facture_electronique.tableau.aucun')}</p>`}
      <p class="fe-actions"><span class="aide">${echapper(texte('facture_electronique.tableau.nombre', { nombre: lignes.length }))}</span>
        ${this.#suivant !== null ? `<button type="button" data-suivants>${iconeHtml('fe_suivants')} ${texteHtml('facture_electronique.tableau.suivants')}</button>` : ''}</p>`;
    const options = {
      sens: Object.values(SENS_FLUX).map((v) => ({ valeur: v, libelle: texte(`facture_electronique.sens.${v}`) })),
      etat: Object.values(ETAT_FLUX).map((v) => ({ valeur: v, libelle: texte(`facture_electronique.etats.${v}`) })),
      type: TYPES_FILTRE.map((v) => ({ valeur: v, libelle: libelleType(v) })),
      statut: Object.values(STATUT_CDV).map((v) => ({ valeur: v, libelle: libelleEtat(v) })),
      erreurs: [{ valeur: 'true', libelle: texte('facture_electronique.filtres.avec_erreurs') }, { valeur: 'false', libelle: texte('facture_electronique.filtres.sans_erreur') }],
    };
    for (const [cle, opts] of Object.entries(options)) {
      const c = creerCombo({ options: [{ valeur: '', libelle: texte('facture_electronique.filtres.tous') }, ...opts], valeur: f[cle], vide: false });
      c.dataset.filtre = cle;
      this.#zone.querySelector(`[data-combo="${cle}"]`).append(c);
    }
    this.#zone.querySelectorAll('input[type="date"]').forEach(champDate);
  }

  #filtrer(cle, valeur) {
    this.#filtres = { ...this.#filtres, [cle]: valeur ?? '' };
    ecrireStockage(PREFERENCE_FILTRES, this.#filtres);
    // Le statut affiché se filtre sur les flux chargés ; les autres filtres relisent le serveur.
    if (cle === 'statut') this.#rendre(); else this.charger();
  }

  /** Remet tous les filtres à vide. */
  effacerFiltres() {
    this.#filtres = { ...FILTRES_VIDES };
    ecrireStockage(PREFERENCE_FILTRES, this.#filtres);
    this.charger();
  }

  #changement(e) {
    const t = e.target;
    const cle = t.dataset.filtre;
    if (!cle) return;
    this.#filtrer(cle, t.classList.contains('combo') ? t.valeurCombo : t.value);
  }

  #clavier(e) {
    const action = actionDe(e, GROUPE_RACCOURCIS_TABLEAU);
    if (action === 'actualiser') this.charger();
    else if (action === 'suivants') this.suivants();
    else if (action === 'relever' && this.#o.peut.modifier) this.relever();
    else if (action === 'effacer') this.effacerFiltres();
    else return;
    e.preventDefault();
  }

  #clic(e) {
    const b = e.target.closest('button');
    const nouvelle = e.ctrlKey || e.metaKey;
    if (!b) {
      const tr = e.target.closest('tr[data-flux]');
      if (tr && e.detail === 2) this.#o.ouvrirFlux(Number(tr.dataset.flux), nouvelle);
      return;
    }
    if (b.dataset.ouvrir) this.#o.ouvrirFlux(Number(b.dataset.ouvrir), nouvelle);
    else if (b.dataset.element) this.#o.ouvrirElement?.(b.dataset.element, b.dataset.idElement, nouvelle);
    else if (b.matches('[data-actualiser]')) this.charger();
    else if (b.matches('[data-suivants]')) this.suivants();
    else if (b.matches('[data-effacer]')) this.effacerFiltres();
    else if (b.matches('[data-relever]')) this.relever();
    else if (b.matches('[data-verifier]')) this.verifierJournal();
  }

  /** Relève à la demande des flux de la plateforme (POST /releve), puis rechargement. */
  async relever() {
    try {
      await this.#o.api.relever();
      this.#o.apresEcriture();
    } catch (e) {
      this.#o.erreur(e);
    }
    await this.charger();
  }

  /** Vérification de la chaîne du journal (GET /journal/verification) : résultat dans une fenêtre. */
  async verifierJournal() {
    try {
      const v = await this.#o.api.verifierJournal();
      await alerter(v.ok ? texte('facture_electronique.journal.ok', { entrees: v.entrees })
        : texte('facture_electronique.journal.rompu', { rang: v.rang_rompu ?? '', raison: v.raison ?? '' }), {
        titre: texte('facture_electronique.journal.titre'),
        html: `<p>${echapper(v.ok ? texte('facture_electronique.journal.ok', { entrees: v.entrees }) : texte('facture_electronique.journal.rompu', { rang: v.rang_rompu ?? '', raison: v.raison ?? '' }))}</p>
          ${v.derniere_empreinte ? `<p class="aide">${texteHtml('facture_electronique.journal.empreinte')} <code>${echapper(v.derniere_empreinte)}</code></p>` : ''}`,
      });
    } catch (e) {
      this.#o.erreur(e);
    }
  }
}
