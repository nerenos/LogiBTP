import { PageBase } from '@logibtp/navigation';
import { rendreDotationsSalarie } from '../stock/magasin.js';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { ArborescenceBtp } from '../ged/arborescence.js';
import { CLASSES_FICHE } from '../fiches/classes.js';
import { PanneauSuivi } from '../crm/panneau-suivi.js';
import { FilCrm } from '../crm/fil.js';
import { rendreComptePersonne } from '../comptes/comptes.js';
import { rendreHabilitations, rendreMissions, rendreHabilitationsExigees } from '../ressources/ressources-ui.js';
import { LISTE_PAR_TYPE } from '../application.js';

const ICONES = { salarie: '👷', materiel: '🚜', element: '📚', personne: '🏢', individu: '👤', projet: '🎯', affaire: '🗂', chantier: '🏗', marche: '📜' };

/**
 * Fiche d'un élément (module Fiche) : /fiche/<type>/<id>, /fiche/<type>/nouveau (création). Fermer la fiche (✕ ou
 * Échap) revient à la page précédente de la fenêtre (la liste), sinon à la liste du type. Quitter la page passe
 * par la fermeture de la fiche : confirmation des modifications et libération du verrou.
 */
/** Fiches qui portent un onglet Suivi (module CRM). */
const TYPES_SUIVI = new Set(['personne', 'individu', 'projet', 'affaire', 'chantier', 'marche']);

export class PageFiche extends PageBase {
  async ouvrir() {
    const app = this.app;
    const { type } = this.params;
    const nouveau = this.params.id === 'nouveau';
    const Classe = CLASSES_FICHE[type];
    if (!Classe) throw new Error(`Type de fiche inconnu : ${type}`);
    this.icone = ICONES[type] ?? '🗂';
    this.titre = nouveau ? `Nouvelle fiche ${type}` : `Fiche ${type} ${this.params.id}`;
    this.conteneur.innerHTML = '<div class="page-fiche"><div class="page-fiche-corps"></div></div>';
    const s = await app.services();
    this.fiche = new Classe({
      conteneur: this.conteneur.querySelector('.page-fiche-corps'), fournisseur: s.fiche, type,
      id: nouveau ? null : this.params.id, mode: nouveau ? 'creation' : 'consultation',
      message: (t, n) => app.message(t, n),
      peutParametrer: app.estAdmin(),
      // Impression de la fiche (module Édition) avec les autres boutons de la fiche.
      actions: [{
        icone: '🖨', libelle: 'Imprimer', titre: 'Aperçu et impression de la fiche (modèle d’édition)', visible: app.enLigne,
        action: () => app.naviguer(`/edition?source=fiche&id=${encodeURIComponent(`${type}/${this.fiche?.id ?? this.params.id}`)}`, { nouvelleFenetre: true }),
      }],
      // Élément de bibliothèque : référentiels, tarifs, GED (image, notices), définition du document de composition.
      services: s, definitionDocument: () => app.definitionDocument(), utilisateur: app.utilisateur(), admin: app.estAdmin(),
      // Annuaire : fiche liée (personne, individu, élément) dans la fenêtre, ou dans une nouvelle avec Ctrl / Maj.
      ouvrirUrl: (url, e) => app.naviguer(url, { nouvelleFenetre: Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey)) }),
      ouvrirFiche: ({ type: t, id }, e) => app.naviguer(`/fiche/${t}/${id}`, { nouvelleFenetre: Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey)) }),
      // Onglet Pièces jointes : vue simplifiée de la GED, limitée aux documents de l'élément.
      // Arborescence : la fiche est la racine (projet, affaire, chantier, marché : structure et documents rattachés).
      ged: ({ conteneur, type: typeElement, id: idElement, libelle, modifiable }) => new ExplorateurGed(conteneur, {
        fournisseur: s.ged, contexte: { type_element: typeElement, id_element: String(idElement), libelle, icone: ICONES[typeElement] }, compact: true,
        arborescence: new ArborescenceBtp({ type_element: typeElement, id_element: String(idElement), libelle, icone: ICONES[typeElement] }, { structure: s.structure }),
        ouvrirUrl: (url) => app.naviguer(url, { nouvelleFenetre: true }),
        modifiable, admin: app.estAdmin(), utilisateur: app.utilisateur(), message: (t, n) => app.message(t, n),
      }),
      // Onglet Suivi (module CRM actif, en ligne) : notes, tâches et courriels des tiers, contacts et de la structure.
      suivi: app.enLigne && app.moduleActif('crm') && TYPES_SUIVI.has(type) ? (corps, { type: t, id }) => {
        const p = new PanneauSuivi(corps, { app, type: t, id });
        p.ouvrir().catch((e) => app.erreur(e));
        return p;
      } : null,
      // Onglet Fil des fiches affaire et chantier (module CRM actif, en ligne) : fil d'actualité de l'élément.
      fil: app.enLigne && app.moduleActif('crm') ? (corps, { type: t, id, libelle }) => {
        const fil = new FilCrm(corps, { app, element: { type: t, id: String(id) }, libelle });
        fil.ouvrir().catch((e) => app.erreur(e));
        return fil;
      } : null,
      moduleActif: (code) => app.moduleActif(code),
      // Onglet Compte de la fiche salarié (module Authentification) : administrateur en ligne.
      compte: app.enLigne && app.estAdmin() ? (corps, p) => rendreComptePersonne(corps, { app, ...p }).catch((e) => app.erreur(e)) : null,
      // Référentiel des ressources (en ligne) : habilitations, missions d'intérim, habilitations exigées d'un matériel.
      dotations: app.enLigne && app.moduleActif('stock') ? (corps, p) => rendreDotationsSalarie(corps, {
        ...p, naviguer: (url, e) => app.naviguer(url, { nouvelleFenetre: Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey)) }),
      }).catch((e) => app.erreur(e)) : null,
      ressources: app.enLigne ? {
        habilitations: (corps, p) => rendreHabilitations(corps, { app, ...p }).catch((e) => app.erreur(e)),
        missions: (corps, p) => rendreMissions(corps, { app, annuaire: s.annuaire, ...p }).catch((e) => app.erreur(e)),
        exigees: (corps, p) => rendreHabilitationsExigees(corps, { app, ...p }).catch((e) => app.erreur(e)),
      } : null,
      surEnregistre: (f, { cree }) => {
        app.publier('enregistre', { type, ids: [f.id, `SAL-${f.id}`, `MAT-${f.id}`], cree });
        if (cree) app.routeur.remplacerUrl(`/fiche/${type}/${f.id}`);
        this.#titre();
      },
      // Fiche supprimée : les listes ouvertes se contrôlent (ligne disparue).
      surSupprime: (id) => app.publier('enregistre', { type, ids: [id], cree: true }),
      surFerme: () => {
        this.ferme = true;
        if (!this.enQuittant) app.fermerPage(LISTE_PAR_TYPE[type] ?? '/');
      },
    });
    // Rechargement ou retour : onglet de la fiche retrouvé (ignoré s'il n'existe plus).
    if (this.affichage?.section) this.fiche.section = this.affichage.section;
    await this.fiche.ouvrir();
    // Copie demandée par une liste (/fiche/<type>/<id>?copie=1) : nouvelle fiche à partir de celle-ci.
    if (!nouveau && this.requete.copie === '1') {
      await this.fiche.copier();
      app.routeur.remplacerUrl(`/fiche/${type}/${this.params.id}`);
    }
    this.#titre();
    // Le titre suit les changements de mode et d'enregistrement.
    this.observateur = new MutationObserver(() => this.#titre());
    this.observateur.observe(this.conteneur, { subtree: true, childList: true, characterData: true });
  }

  #titre() {
    const h = this.conteneur.querySelector('.fiche-titre h2')?.textContent?.trim();
    if (h && h !== this.titre) { this.titre = h; this.app.majPage(); }
  }

  get modifiee() { return !this.ferme && Boolean(this.fiche?.modifiee); }

  etatAffichage() { return this.fiche?.section ? { section: this.fiche.section } : null; }

  async quitter() {
    if (this.ferme || !this.fiche) return true;
    this.enQuittant = true;
    try { return await this.fiche.fermer(); } finally { this.enQuittant = false; }
  }

  /** Fermeture sans confirmation (session fermée, fenêtre fermée) : le verrou est libéré. */
  async liberer() {
    if (this.ferme || !this.fiche) return;
    this.enQuittant = true;
    await this.fiche.fermer({ sansConfirmation: true });
  }

  enregistrer() { if (this.fiche?.mode !== 'consultation') this.fiche.enregistrer(); }

  echap() { this.fiche?.fermer(); }

  fermer() {
    this.observateur?.disconnect();
    if (!this.ferme) this.liberer().catch(() => {});
  }
}
