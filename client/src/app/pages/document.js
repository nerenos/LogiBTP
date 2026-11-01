import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlDocument, TYPE_FICHE, TYPE_DOCUMENT, TYPES_SOUS_TRAITABLES, MODULE_FACULTATIF, SUJET_FENETRE } from '../codes.js';
import { FAMILLE_DOCUMENT, STATUT_DOCUMENT, STATUTS_HORS_VIGUEUR, estFamilleAchat } from '@logibtp/document';
import { PageBase } from '@logibtp/navigation';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { ArborescenceBtp } from '../ged/arborescence.js';
import { echapper, formatNombre, actionDe, libelleRaccourci, basculerAideMemoire, fermerAideMemoire, confirmer, ouvrirDialogue, ouvrirModale, saisir } from '@logibtp/socle/ui';
import { D, aujourdhui } from '@logibtp/socle';
import { ONGLETS_DOCUMENT } from '../raccourcis.js';
import { Disposition, GestionVuesDocument, PlanDocument, RechercheLignes, NotificationsDocument } from '@logibtp/document/ui';
import { PanneauMetre, messagesMetres } from '@logibtp/metre/ui';
import { VERSION_MOTEUR, controlesSaisie, controlesValidation, LIBELLES_CONTROLE_SAISIE } from '../../calcul/index.js';
import { api } from '../api.js';
import { lireAttente, ecrireAttente, retirerAttente, marquerAttente, estHorsLigne, ETATS_ATTENTE, urlAttente, ETAT_ATTENTE } from '../hors-ligne/attente.js';
import { envoyerDocument, SUJET_ATTENTE } from '../hors-ligne/synchro.js';
import { appliquerReponse } from '../documents/reponse.js';
import { sousTraiter } from '../sous-traitance/sous-traiter.js';
import { EditeurDevisBtp, DictionnaireBtp } from '../editeur-btp.js';
import { PanneauxBtp, individusSociete, individusStructure } from '../panneaux-btp.js';
import { AnalyseCoefficients } from '../analyse-coefs.js';
import { messagesFrais } from '../frais-annexes.js';
import { EnvoiBibliotheque } from '../bibliotheque/envoi.js';
import { AppelBibliotheque } from '../bibliotheque/appel.js';
import { completerRattachement, creerFicheCodeLibre, codePrevisionnel } from '../structure/structure.js';
import { proposerMarche } from '../structure/marche-commande.js';
import { transformerDocument } from '../documents/transformation.js';
import { confirmerAvertissements } from '../documents/avertissements.js';
import { proposerMarcheSousTraitance } from '../structure/marche-sous-traitance.js';
import { choisirSources } from '../documents/sources.js';

/** Types alimentés par d'autres documents (ajout de sources en brouillon) ; types créés depuis un marché. */
const TYPES_SOURCES = /_(RECEPTION|FACTURE|FACTURE_AVT|SITUATION|AVOIR)$/;
const MARCHE_TYPES = [TYPE_DOCUMENT.V_RECEPTION, TYPE_DOCUMENT.V_SITUATION, TYPE_DOCUMENT.V_FACTURE_AVT];
import { afficherTracabilite } from '../documents/tracabilite.js';
import { afficherReglements } from '../documents/reglements-document.js';
import { ouvrirImport, creerDepuisImport, rendreBandeauImport, tracabiliteImport } from '../import/devis-a-verifier.js';
import { formatImport } from '../import/formats.js';
import { PanneauSuivi } from '../crm/panneau-suivi.js';
import { voisins } from '../suite-liste.js';

// Document (devis, facture…) dans l'éditeur du cœur, toujours lu dans la base : /document/<id>,
// /document/nouveau?type=<code>, /document/import?jeton=<jeton> (devis importé à vérifier avant sa création, ouvert
// par la page d'import).

/** Barre et zones de la page (textes et icônes lus dans le dictionnaire). */
const enteteDock = (titre, fermer = '') => `
        <header class="dock-entete">
          <span class="dock-titre">${titre}</span>
          <div class="dock-boutons">
            <button data-dock="gauche" title="${texteHtml('document_btp.page.dock.gauche')}">${iconeHtml('document_btp_ancrer_gauche')}</button>
            <button data-dock="bas" title="${texteHtml('document_btp.page.dock.bas')}">${iconeHtml('document_btp_ancrer_bas')}</button>
            <button data-dock="droite" title="${texteHtml('document_btp.page.dock.droite')}">${iconeHtml('document_btp_ancrer_droite')}</button>
            <button data-action="reduire" title="${texteHtml('document_btp.page.dock.reduire')}">${iconeHtml('document_reduire')}</button>
            ${fermer ? `<button data-action="fermer" title="${fermer}">${iconeHtml('retirer')}</button>` : ''}
          </div>
        </header>`;
const separateur = (cote) => `<div class="separateur" data-sep="${cote}" title="${texteHtml('document_btp.page.separateur')}"></div>`;

const gabarit = () => `
  <div class="document-barre">
    <nav class="onglets" role="tablist">
      <button role="tab" data-onglet-vue="entete" title="${texteHtml('document_btp.page.onglets.entete_aide')}">${texteHtml('document_btp.page.onglets.entete')}</button>
      <button role="tab" data-onglet-vue="lignes" title="${texteHtml('document_btp.page.onglets.lignes_aide')}">${texteHtml('document_btp.page.onglets.lignes')}</button>
      <button role="tab" data-onglet-vue="analyse" title="${texteHtml('document_btp.page.onglets.analyse_aide')}">${texteHtml('document_btp.page.onglets.analyse')}</button>
      <button role="tab" data-onglet-vue="pieces" title="${texteHtml('document_btp.page.onglets.pieces_aide')}">${texteHtml('document_btp.page.onglets.pieces')}</button>
      <button role="tab" data-onglet-vue="tracabilite" title="${texteHtml('document_btp.page.onglets.tracabilite_aide')}">${texteHtml('document_btp.page.onglets.tracabilite')}</button>
      <button role="tab" data-onglet-vue="suivi" title="${texteHtml('document_btp.page.onglets.suivi_aide')}" hidden>${texteHtml('document_btp.page.onglets.suivi')}</button>
      <button role="tab" data-onglet-vue="reglements" title="${texteHtml('document_btp.page.onglets.reglements_aide')}">${texteHtml('document_btp.page.onglets.reglements')}</button>
    </nav>
    <div class="groupe">
      <button data-action="annuler" title="${texteHtml('document_btp.page.annuler')}">${iconeHtml('document_btp_annuler')}</button>
      <button data-action="retablir" title="${texteHtml('document_btp.page.retablir')}">${iconeHtml('document_btp_retablir')}</button>
      <button data-action="bibliotheque" title="${texteHtml('document_btp.page.bibliotheque_aide')}">${iconeHtml('document_textes')} ${texteHtml('document_btp.page.bibliotheque')}</button>
      <button data-action="precedent" hidden>${iconeHtml('precedent')}</button>
      <button data-action="suivant" hidden>${iconeHtml('suivant')}</button>
    </div>
    <span class="groupe" data-vues></span>
    <span class="groupe"><button data-basculer-dock="plan" title="${texteHtml('document_btp.page.plan_aide')}">${iconeHtml('document_btp_plan')} ${texteHtml('document_btp.page.plan')}</button>
      <button data-basculer-dock="notifications" class="compteur-notifications" title="${texteHtml('document_btp.page.notifications_aide')}">${iconeHtml('avertissement')} 0</button>
      <button data-action="rechercher" title="${texteHtml('document_btp.page.rechercher')}">${iconeHtml('rechercher')}</button></span>
    <!-- Calé à droite : Enregistrer (clic) et ses suites dans le menu ▾, puis Aperçu, Envoyer, Fermer en icônes. -->
    <div class="groupe barre-droite">
      <span class="bouton-menu bouton-menu-superchamps">
        <button data-action="enregistrer" class="principal" title="${texteHtml('document_btp.page.enregistrer_aide')}">${texteHtml('document_btp.page.enregistrer')}</button><button type="button" class="principal bouton-menu-fleche" data-ouvrir-actions title="${texteHtml('document_btp.page.actions_aide')}" aria-label="${texteHtml('document_btp.page.actions_libelle')}" aria-haspopup="menu">${iconeHtml('replier')}</button>
        <div class="menu-deroulant-contenu menu-actions-document" role="menu" data-menu-actions hidden>
        <button role="menuitem" class="mo-ligne" data-action="valider" title="${texteHtml('document_btp.page.actions.valider_aide')}">${texteHtml('document_btp.page.actions.valider')}</button>
        <button role="menuitem" class="mo-ligne" data-action="envoyer" title="${texteHtml('document_btp.page.actions.envoyer_aide')}" hidden>${texteHtml('document_btp.page.actions.envoyer')}</button>
        <button role="menuitem" class="mo-ligne" data-action="valider-tiers" title="${texteHtml('document_btp.page.actions.valider_tiers_aide')}" hidden>${texteHtml('document_btp.page.actions.valider_tiers')}</button>
        <button role="menuitem" class="mo-ligne" data-action="rejeter" title="${texteHtml('document_btp.page.actions.rejeter_aide')}" hidden>${texteHtml('document_btp.page.actions.rejeter')}</button>
        <button role="menuitem" class="mo-ligne" data-action="numero" title="${texteHtml('document_btp.page.actions.numero_aide')}" hidden>${texteHtml('document_btp.page.actions.numero')}</button>
        <button role="menuitem" class="mo-ligne" data-action="devalider" title="${texteHtml('document_btp.page.actions.devalider_aide')}" hidden>${texteHtml('document_btp.page.actions.devalider')}</button>
        <button role="menuitem" class="mo-ligne" data-action="transformer" title="${texteHtml('document_btp.page.actions.transformer_aide')}">${texteHtml('document_btp.page.actions.transformer')}</button>
        <button role="menuitem" class="mo-ligne" data-action="annuler-avoir" title="${texteHtml('document_btp.page.actions.annuler_avoir_aide')}" hidden>${texteHtml('document_btp.page.actions.annuler_avoir')}</button>
        <button role="menuitem" class="mo-ligne" data-action="consultation" title="${texteHtml('document_btp.page.actions.consultation_aide')}" hidden>${texteHtml('document_btp.page.actions.consultation', { icone: icone('document_btp_consultation') })}</button>
        <button role="menuitem" class="mo-ligne" data-action="sous-traiter" title="${texteHtml('document_btp.page.actions.sous_traiter_aide')}" hidden>${texteHtml('document_btp.page.actions.sous_traiter', { icone: icone('document_btp_sous_traiter') })}</button>
        <button role="menuitem" class="mo-ligne" data-action="sources" title="${texteHtml('document_btp.page.actions.sources_aide')}" hidden>${texteHtml('document_btp.page.actions.sources', { icone: icone('ajouter') })}</button>
        </div>
      </span>
      <button data-action="apercu" class="bouton-icone" title="${texteHtml('document_btp.page.apercu_aide')}" aria-label="${texteHtml('document_btp.page.apercu')}">${iconeHtml('document_btp_apercu')}</button>
      <button data-action="courriel" class="bouton-icone" title="${texteHtml('document_btp.page.courriel_aide', { icone: icone('document_btp_envoyer') })}" aria-label="${texteHtml('document_btp.page.courriel')}">${iconeHtml('document_btp_envoyer')}</button>
      <button data-action="fermer-page" class="bouton-icone" title="${texteHtml('document_btp.page.fermer_aide')}" aria-label="${texteHtml('document_btp.page.fermer')}">${iconeHtml('retirer')}</button>
    </div>
  </div>
  <div class="document-verrou" hidden></div>
  <div class="document-attente" hidden></div>
  <div class="document-import" hidden></div>
  <main class="document-zone">
    <section id="vue-entete" class="vue vue-entete" role="tabpanel">
      <div id="entete" class="panneau entete"></div>
      <section id="totaux-entete" class="panneau totaux-entete"></section>
    </section>
    <section id="vue-analyse" class="vue vue-analyse" role="tabpanel"></section>
    <section id="vue-pieces" class="vue vue-pieces" role="tabpanel"></section>
    <section id="vue-tracabilite" class="vue vue-tracabilite" role="tabpanel"></section>
    <section id="vue-suivi" class="vue vue-suivi" role="tabpanel"></section>
    <section id="vue-reglements" class="vue vue-reglements" role="tabpanel"></section>
    <section id="vue-lignes" class="vue vue-lignes" role="tabpanel">
      <div class="zone-dock" data-zone="gauche"></div>
      ${separateur('gauche')}
      <div class="zone-lignes">
        <section id="ecarts" class="panneau ecarts" hidden></section>
        <div class="barre-filtre" hidden></div>
        <div id="recherche-lignes" hidden></div>
        <div id="grille"></div>
        <footer class="pied-lignes">
          <div id="totaux" class="totaux-compacts"></div>
          <span class="aide aide-raccourcis" data-aide-raccourcis role="button" tabindex="0" title="${texteHtml('document_btp.page.raccourcis_aide')}">${texteHtml('document_btp.page.raccourcis')} ${iconeHtml('document_btp_info')}</span>
        </footer>
      </div>
      ${separateur('droite')}
      <div class="zone-dock" data-zone="droite"></div>
      ${separateur('bas')}
      <div class="zone-dock" data-zone="bas"></div>
      <aside class="dock" data-dock-id="plan">${enteteDock(texteHtml('document_btp.page.dock.plan'), texteHtml('document_btp.page.dock.plan_fermer'))}
        <div class="dock-contenu"><section id="plan"></section></div>
      </aside>
      <aside class="dock" data-dock-id="detail">${enteteDock(texteHtml('document_btp.page.dock.detail'))}
        <div class="dock-contenu">
          <section id="detail" class="detail"></section>
          <section id="controles" class="controles" hidden></section>
        </div>
      </aside>
      <aside class="dock" data-dock-id="notifications">${enteteDock(texteHtml('document_btp.page.dock.notifications'), texteHtml('document_btp.page.dock.notifications_fermer', { icone: icone('avertissement') }))}
        <div class="dock-contenu"><section id="notifications"></section></div>
      </aside>
    </section>
  </main>
  <aside id="metre" class="tiroir" hidden></aside>`;

/**
 * Définitions de tous les types de documents lues une fois par session en ligne : gardées par le service worker, elles
 * permettent de créer hors ligne un document d'un type jamais ouvert sur ce poste.
 */
function prechargerDefinitions(types) {
  try {
    if (sessionStorage.getItem('logibtp.definitions')) return;
    sessionStorage.setItem('logibtp.definitions', '1');
  } catch { return; }
  setTimeout(async () => {
    for (const t of types) await api.definition(t.tyd_code).catch(() => {});
  }, 5000);
}

/** Contenu de saisie à partir d'un document complet renvoyé par l'API. */
const versSaisie = (d) => ({
  document: d.document, lignes: d.lignes, metres: d.metres ?? [], variables: d.variables ?? [], ventilations: d.ventilations ?? [],
  // Échéancier enregistré et règlement du tiers (lecture seule, section Règlement de l'entête).
  echeances: d.echeances ?? [], reglement_tiers: d.reglement_tiers ?? null,
});

export class PageDocument extends PageBase {
  icone = icone('document_btp_page');

  $(s) { return this.conteneur.querySelector(s); }

  async ouvrir() {
    const app = this.app;
    this.conteneur.innerHTML = gabarit();
    this.conteneur.classList.add('page-document');
    this.disposition = new Disposition({
      racine: this.conteneur,
      // Notifications du document : en bas, ouvertes par le compteur ⚠ de la barre (Alt+7).
      docks: { notifications: { position: 'bas', reduit: false, visible: false } },
      surOnglet: (o) => {
        if (o === 'lignes') this.editeur?.grille.focus();
        if (o === 'analyse') this.analyse?.rendre();
        if (o === 'pieces') this.afficherPieces();
        if (o === 'tracabilite') this.afficherTracabilite();
        if (o === 'suivi') this.afficherSuivi();
        if (o === 'reglements') this.afficherReglements();
      },
      // Plan fermé : le filtre d'affichage qu'il a posé est retiré.
      surDock: (id, visible) => { if (id === 'plan' && !visible && this.editeur?.filtre !== null) this.editeur?.filtrer(null); },
    });
    const actions = {
      enregistrer: () => this.enregistrer(), valider: () => this.valider(), transformer: () => this.transformer(),
      precedent: () => this.precedent(), suivant: () => this.suivant(),
      envoyer: () => this.etapeCycle((id) => api.envoyer(id), texte('document_btp.page.cycle.envoye')),
      'valider-tiers': () => this.etapeCycle((id) => api.validerTiers(id), texte('document_btp.page.cycle.valide_tiers')),
      devalider: async () => {
        const motif = await saisir(texte('document_btp.page.cycle.devalider_motif'), '', { obligatoire: true });
        if (!motif?.trim()) return;
        try {
          const nouveau = await api.devalider(this.editeur.saisie.document.ent_id, motif.trim());
          this.app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [this.editeur.saisie.document.ent_id, nouveau.document.ent_id] });
          this.app.message(texte('document_btp.page.cycle.nouvelle_version', { indice: nouveau.document.ent_indice }), 'succes');
          await this.app.naviguer(urlDocument(nouveau.document.ent_id));
        } catch (e) { this.app.erreur(e); }
      },
      numero: () => this.changerNumero(),
      rejeter: async () => {
        const motif = await saisir(texte('document_btp.page.cycle.rejet_motif'), '', { obligatoire: true });
        if (motif?.trim()) this.etapeCycle((id) => api.rejeter(id, motif.trim()), texte('document_btp.page.cycle.rejete'));
      },
      sources: () => this.ajouterSources(),
      consultation: () => this.lotConsultation(),
      'sous-traiter': () => this.sousTraiter(),
      'annuler-avoir': () => this.annulerParAvoir(),
      annuler: () => this.editeur?.magasin.annuler(), retablir: () => this.editeur?.magasin.retablir(),
      // Bibliothèque dans une autre fenêtre (liste de tous les éléments) ; l'insertion reste par F3 ou par code.
      bibliotheque: () => app.naviguer('/liste/bibliotheque?vue=14', { nouvelleFenetre: true }),
      rechercher: () => { this.disposition.onglet('lignes'); this.recherche?.ouvrir(); },
      // Aperçu : l'édition lit le document enregistré (les modifications en cours n'y sont pas).
      apercu: () => {
        const id = this.editeur?.saisie.document.ent_id;
        if (!id || id < 0) { app.message(texte('document_btp.page.enregistrer_avant_edition'), 'avertissement'); return; }
        if (this.modifiee) app.message(texte('document_btp.page.apercu_non_enregistre'), 'avertissement');
        app.naviguer(`/edition?source=document&id=${id}`, { nouvelleFenetre: true });
      },
      // Courriel : destinataires, modèle et pièces « à envoyer » proposés par l'application (module Mail).
      courriel: () => {
        const id = this.editeur?.saisie.document.ent_id;
        if (!id || id < 0) { app.message(texte('document_btp.page.enregistrer_avant_courriel'), 'avertissement'); return; }
        app.naviguer(`/mail/nouveau?type=document&id=${id}`, { nouvelleFenetre: true });
      },
      'fermer-page': () => app.fermerPage('/liste/documents'),
      // Notifications : panneau affiché ou masqué, suivante / précédente (F8, Maj+F8) à partir de la ligne courante.
      notifications: () => this.disposition.afficher('notifications'),
      notificationSuivante: () => this.allerNotification(1),
      notificationPrecedente: () => this.allerNotification(-1),
    };
    // Raccourcis ⓘ : bulle au survol, aide-mémoire complet (fenêtre déplaçable) au clic.
    const aide = this.conteneur.querySelector('[data-aide-raccourcis]');
    aide.addEventListener('click', () => this.aideRaccourcis());
    aide.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.aideRaccourcis(); } });
    this.#voisinage();
    this.conteneur.querySelector('.document-barre').addEventListener('click', (e) => {
      const plan = e.target.closest('[data-basculer-dock]');
      if (plan) { this.disposition.afficher(plan.dataset.basculerDock); return; }
      // Menu ▾ du bouton Enregistrer : ouvert ou fermé ; refermé par toute action.
      const menu = this.$('[data-menu-actions]');
      if (e.target.closest('[data-ouvrir-actions]')) { menu.hidden = !menu.hidden; if (!menu.hidden) menu.querySelector('button:not([hidden]):not(:disabled)')?.focus(); return; }
      menu.hidden = true;
      const b = e.target.closest('button[data-action]');
      if (b && actions[b.dataset.action]) Promise.resolve(actions[b.dataset.action]()).catch((x) => app.erreur(x));
    });
    // Raccourcis de la page (groupe document, personnalisables) : Alt+1… onglets, Ctrl+F recherche dans les lignes
    // (sans filtre, à la place de celle du navigateur ; onglet Analyse : dans la liste des éléments), fonctions de la barre.
    this.clavier = (e) => {
      if (e.defaultPrevented) return;
      const action = actionDe(e, 'document');
      if (!action) return;
      if (ONGLETS_DOCUMENT[action]) { e.preventDefault(); this.disposition.onglet(ONGLETS_DOCUMENT[action]); return; }
      if (action === 'rechercher') {
        if (!this.recherche) return;
        e.preventDefault();
        if (this.disposition.p.onglet === 'analyse') { this.analyse?.ouvrirRecherche(); return; }
        this.disposition.onglet('lignes');
        this.recherche.ouvrir();
        return;
      }
      if (actions[action]) { e.preventDefault(); Promise.resolve(actions[action]()).catch((x) => app.erreur(x)); }
    };
    document.addEventListener('keydown', this.clavier);
    // Menu des actions du document : refermé par un clic ailleurs ou Échap.
    this.fermerMenuActions = (e) => {
      const menu = this.conteneur.querySelector('[data-menu-actions]');
      if (!menu || menu.hidden || (e.type === 'keydown' ? e.key !== 'Escape' : menu.parentElement.contains(e.target))) return;
      menu.hidden = true;
      if (e.type === 'keydown') e.stopPropagation();
    };
    document.addEventListener('pointerdown', this.fermerMenuActions, true);
    document.addEventListener('keydown', this.fermerMenuActions, true);
    document.body.classList.add('avec-document');
    // Bibliothèque : appel par code (colonne Code), F3, bibliothèque du document (entête).
    const s = await app.services();
    this.bibliotheques = await s.bibliotheque.bibliotheques().catch(() => []);
    // Structure des affaires : listes de choix du rattachement (entête) et marché proposé à la validation d'une commande.
    this.servicesStructure = s.structure;
    this.servicesFiche = s.fiche;
    this.servicesAnnuaire = s.annuaire;
    this.servicesGed = s.ged;
    this.structure = await s.structure?.referentiels().catch(() => null) ?? null;
    // Mise à jour ou création d'éléments de la bibliothèque depuis les lignes du document.
    this.envoi = new EnvoiBibliotheque({
      fiche: s.fiche, bibliotheque: s.bibliotheque, editeur: () => this.editeur, bibDocument: () => this.appel.bibDocument(),
      message: (t, n) => app.message(t, n),
    });
    // Coefficients par défaut (bibliothèque) : couleur des coefficients des lignes.
    const params = await s.bibliotheque.parametres?.().catch(() => null);
    this.coefsDefaut = { fg: params?.coef_fg_defaut ?? 1, benef: params?.coef_benef_defaut ?? 1 };
    this.natures = await s.bibliotheque.natures?.().catch(() => []) ?? [];
    this.comptes = await api.comptesComptables().catch(() => []);
    // Règle de ventilation du module Comptabilité (compte hérité des lignes).
    this.regleVentilation = await api.comptabilite.regle().catch(() => null);
    this.appel = new AppelBibliotheque({
      fournisseur: s.bibliotheque, editeur: () => this.editeur, message: (t, n) => app.message(t, n),
      bibliotheque: () => this.bibliotheques.find((b) => b.id === Number(this.editeur?.saisie.document.ent_bib_id))?.code ?? null,
    });

    const { id } = this.params;
    this.types = await api.typesDocument();
    // Saisie faite hors ligne envoyée au serveur (par cette fenêtre ou une autre) : identifiants définitifs repris.
    this.desabonnerEnvoi = app.abonner(SUJET_FENETRE.HORS_LIGNE_ENVOYE, (e) => this.#surEnvoiHorsLigne(e));
    // File changée (conflit ou refus noté par l'envoi) : bandeau de la saisie hors ligne relu.
    this.desabonnerAttente = app.abonner(SUJET_ATTENTE, async () => {
      const id = this.editeur?.saisie.document.ent_id;
      if (id === undefined || !this.attente) return;
      this.attente = await lireAttente(app.utilisateur(), id).catch(() => this.attente);
      this.rafraichir();
    });
    if (!app.apiPerdue) prechargerDefinitions(this.types);
    // Création depuis les listes : /document/nouveau?type=<code> ; depuis un marché : &marche=<id> (rattachement).
    if (id === 'nouveau') {
      await this.nouveau(this.requete.type ?? TYPE_DOCUMENT.V_DEVIS);
      if (this.requete.marche) await this.rattacher({ ...this.editeur.saisie.document, ent_marche_id: Number(this.requete.marche) });
    } else if (id === 'import') {
      await ouvrirImport(this, this.requete.jeton);
    } else await this.chargerDocument(Number(id));
  }

  async chargerDocument(id) {
    await this.liberer();
    this.importEnCours = null;
    // Saisie enregistrée sur ce poste (hors ligne) et pas encore envoyée : rouverte telle quelle.
    this.attente = await lireAttente(this.app.utilisateur(), id).catch(() => null);
    if (!this.attente && id < 0) throw new Error(texte('document_btp.page.hors_ligne_introuvable'));
    const complet = this.attente?.saisie ?? await api.document(id);
    // Version du serveur au début de la saisie : base de la fusion si le document change entre-temps (lot 4).
    this.depart = this.attente ? null : complet;
    const type = this.types.find((t) => t.tyd_id === complet.document.ent_tyd_id);
    const definition = await api.definition(type.tyd_code);
    await this.charger(definition, complet);
    await this.prendreVerrou();
  }

  // ---------------------------------------------------------------- verrou de modification (en ligne)

  /** Document modifiable par cet utilisateur (statut, validation, droit) : il est alors verrouillé à l'ouverture. */
  #modifiable() {
    const ed = this.editeur;
    const doc = ed.saisie.document;
    const statut = ed.definition.statuts?.find((s) => s.std_id === doc.ent_std_id);
    return statut?.std_modifiable !== false && !doc.ent_verrouille && (ed.definition.droits ?? []).includes('MODIFIER');
  }

  /**
   * Prise (ou renouvellement) du verrou. Pris par un autre utilisateur : lecture seule et bandeau. Le verrou n'expire
   * pas : seul un administrateur peut lever celui d'une fenêtre fermée ou d'une connexion perdue. Le même utilisateur
   * reprend son propre verrou sans avertissement.
   */
  async prendreVerrou() {
    // Document créé hors ligne (pas encore sur le serveur) : rien à verrouiller.
    if (!this.editeur || !this.#modifiable() || this.editeur.saisie.document.ent_id < 0) { this.#etatVerrou(null); return; }
    this.jeton ??= crypto.randomUUID();
    const id = this.editeur.saisie.document.ent_id;
    clearInterval(this.battement);
    // Serveur injoignable : saisie permise (enregistrée sur ce poste), verrou repris au retour de l'API.
    let r;
    try {
      r = await api.verrouillerDocument(id, this.jeton);
    } catch (e) {
      if (!estHorsLigne(e)) throw e;
      r = null;
    }
    this.verrouAReprendre = r === null;
    this.verrouDetenu = r?.ok ? id : null;
    this.#etatVerrou(r && !r.ok ? r.verrou : null);
    // Battement : dernière activité (information pour l'administrateur) ; détecte un déverrouillage forcé.
    this.battement = setInterval(() => {
      if (this.verrouAReprendre && !this.app.apiPerdue) { this.prendreVerrou().catch(() => {}); return; }
      if (!this.verrouDetenu) return;
      api.verrouillerDocument(this.verrouDetenu, this.jeton).then((x) => {
        if (!x.ok) { this.verrouDetenu = null; this.#etatVerrou(x.verrou); this.app.message(texte('document_btp.page.verrou.repris', { utilisateur: x.verrou?.utilisateur }), 'erreur'); }
      }).catch(() => {});
    }, 30000);
  }

  #etatVerrou(verrou) {
    this.bloque = verrou;
    const zone = this.$('.document-verrou');
    const magasin = this.editeur?.magasin;
    if (magasin) {
      magasin.lectureSeule = Boolean(verrou);
      magasin.surRefus = () => this.app.message(texte('document_btp.page.verrou.lecture_seule', { utilisateur: verrou?.utilisateur }), 'avertissement');
    }
    zone.hidden = !verrou;
    if (verrou) {
      const h = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      // Plus de battement depuis deux minutes : fenêtre fermée ou poste hors ligne (sa saisie sera envoyée à son retour).
      const inactif = Date.now() - Date.parse(verrou.vu) > 120000;
      zone.innerHTML = `${iconeHtml('verrou')} ${texteHtml('document_btp.page.verrou.ouvert_html', { utilisateur: verrou.utilisateur, depuis: h(verrou.depuis) })}
        <span class="aide">${texteHtml(inactif ? 'document_btp.page.verrou.inactif' : 'document_btp.page.verrou.actif', { vu: h(verrou.vu) })}</span>
        <button type="button" data-verrou="reessayer">${texteHtml('document_btp.page.verrou.reessayer')}</button>
        ${this.app.estAdmin() ? `<button type="button" data-verrou="forcer" class="danger" title="${texteHtml('document_btp.page.verrou.forcer_aide')}">${texteHtml('document_btp.page.verrou.forcer')}</button>` : ''}`;
      zone.querySelector('[data-verrou="reessayer"]').addEventListener('click', () => this.prendreVerrou().catch((e) => this.app.erreur(e)));
      zone.querySelector('[data-verrou="forcer"]')?.addEventListener('click', async () => {
        if (!await confirmer(texte('document_btp.page.verrou.confirmer', { utilisateur: verrou.utilisateur }))) return;
        try {
          await api.forcerDeverrouillageDocument(this.editeur.saisie.document.ent_id);
          await this.prendreVerrou();
          this.app.message(texte('document_btp.page.verrou.deverrouille'), 'succes');
        } catch (e) { this.app.erreur(e); }
      });
    }
    this.rafraichir();
  }

  /** Libération du verrou (changement de document, page quittée, onglet fermé : requête keepalive). */
  async liberer() {
    clearInterval(this.battement);
    const id = this.verrouDetenu;
    this.verrouDetenu = null;
    if (id !== null && id !== undefined) await api.deverrouillerDocument(id, this.jeton).catch(() => {});
  }

  async charger(definition, complet) {
    const zone = this.$('#grille');
    this.panneaux = null;
    zone.replaceChildren();
    this.selection = null;
    this.editeur = new EditeurDevisBtp(zone, {
      definition,
      saisie: versSaisie(complet),
      surSelection: (id) => {
        this.selection = id;
        this.plan?.rendre();
        this.panneaux?.rendreDetail(this.$('#detail'), id);
        this.rendreControlesLigne();
        this.metre?.suivre(id); // le métré ouvert suit la ligne sélectionnée
      },
      surMessage: (t) => this.app.message(t),
      ouvrirMetre: (ligId, mtrId) => this.metre.ouvrir(ligId, mtrId),
      appelerCode: (ligId, code) => this.appel.appeler(ligId, code),
      rechercher: (ligId) => this.appel.rechercher(ligId),
    });
    this.panneaux = new PanneauxBtp(this.editeur, {
      bibliotheques: this.bibliotheques, structure: this.structure, rattacher: (r) => this.rattacher(r).catch((x) => this.app.erreur(x)),
      // Bibliothèque depuis le détail de la ligne (lignes sélectionnées, ou la ligne du détail).
      actualiserPrix: (ids) => this.appel?.actualiser(ids), versBibliotheque: (ids) => this.envoi?.ouvrir(ids),
      choisirTexte: () => this.appel?.choisir('', { type: 'TEXTE' }),
      annuaire: this.servicesAnnuaire, intervenants: (type, id) => this.servicesStructure.intervenants(type, id),
      // Ordres (famille E, module Exécution actif) : panneau Exécution de l'entête, répartition du détail.
      execution: this.app.moduleActif(MODULE_FACULTATIF.EXECUTION) ? { app: this.app, individus: () => individusSociete(this.servicesAnnuaire) } : null,
      // Pièces qui mouvementent le stock (module Stock actif) : lieux d'origine et de destination.
      stock: this.app.moduleActif(MODULE_FACULTATIF.STOCK) ? { lieux: () => api.stock.lieux() } : null,
      // Accusé de réception des commandes (lot 9, A24e) : enregistré à part, fichier rangé dans la GED du document.
      arc: {
        enregistrer: (id, arc) => api.arcDocument(id, arc),
        deposer: async (fichier, numero) => {
          const d = this.editeur.saisie.document;
          await this.servicesGed.deposer({ fichier, nom_fichier: fichier.name, meta: { titre: texte('document_btp.page.arc_titre', { numero: numero ?? d.ent_numero ?? '' }).trim(), categorie: 'arc',
            type_element: this.editeur.definition.type?.tyd_code ?? 'document', id_element: String(d.ent_groupe_id ?? d.ent_id) } });
          this.gedCle = null;
        },
      },
    });
    this.plan = new PlanDocument(this.$('#plan'), { editeur: this.editeur });
    this.recherche = new RechercheLignes(this.$('#recherche-lignes'), { editeur: this.editeur });
    // Éléments glissés depuis la fenêtre de la bibliothèque.
    this.editeur.surDepotExterne = (donnees, cibleId, position) => this.appel.deposer(donnees, cibleId, position);
    this.analyse = new AnalyseCoefficients(this.$('#vue-analyse'), { editeur: this.editeur, natures: this.natures, message: (t, n) => this.app.message(t, n), appel: this.appel });
    this.editeur.coefsDefaut = this.coefsDefaut;
    this.editeur.natures = this.natures;
    this.editeur.comptes = this.comptes;
    // Chantiers proposés pour la colonne Chantier des lignes d'achat.
    this.editeur.chantiers = this.structure?.chantiers ?? [];
    this.editeur.regleVentilation = this.regleVentilation;
    // Compte de produit ou de charge du tiers (avant les clés de la ventilation).
    this.editeur.chargerComptesTiers = this.regleVentilation ? (id) => api.comptabilite.comptesLignesTiers(id).catch(() => null) : null;
    this.editeur.surFiltre = () => this.afficherFiltre();
    // Mode débogage de la vue : rapport d'import (bandeau, traçabilité).
    this.editeur.surVue = () => {
      rendreBandeauImport(this);
      if (this.disposition.p.onglet === 'tracabilite') this.afficherTracabilite();
    };
    this.afficherFiltre();
    // Vues de colonnes : vue mémorisée (navigateur) ou vue par défaut du type et du modèle du document.
    this.vues = new GestionVuesDocument(this.$('[data-vues]'), {
      editeur: this.editeur, fournisseur: this.fournisseurVues(), admin: () => this.app.estAdmin(), message: (t) => this.app.message(t),
    });
    this.modeleAffiche = this.editeur.saisie.document.ent_modele ?? null;
    await this.vues.charger();
    await this.chargerRestes();
    await this.chargerAvancement();
    this.metre = new PanneauMetre(this.$('#metre'), this.editeur, {
      fermer: (ligId) => { this.editeur.grille.selectionner(ligId, { colonne: 3 }); this.editeur.grille.focus(); },
      message: (t) => this.app.message(t),
      dictionnaire: new DictionnaireBtp(this.editeur),
    });
    this.brancherNotifications();
    this.editeur.magasin.abonner(() => this.rafraichir());
    this.marque = this.editeur.magasin.pile.at(-1);
    this.ecarts = null;
    this.rafraichir();
    if (this.disposition.p.onglet === 'lignes') this.editeur.grille.focus();
  }

  /**
   * Panneau des notifications (en bas, masquable) : calcul du moteur, contrôles de saisie (avertissements), contrôles de
   * la validation, métrés ; icône dans la poignée des lignes, entrée du clic droit, compteur de la barre.
   */
  brancherNotifications() {
    const ed = this.editeur;
    const regles = ed.definition.regles ?? {};
    const lignes = () => ed.resultat.lignes ?? [];
    this.notifications = new NotificationsDocument(this.$('#notifications'), ed, {
      sources: [
        {
          cle: 'saisie', libelle: texte('document_btp.page.notifications.saisie'),
          messages: () => controlesSaisie(lignes(), {
            famille: ed.definition.type?.tyd_famille ?? 'V', modeOuvrage: ed.saisie.document.ent_mode_calcul_ouvrage ?? 'V',
            typePrix: (l) => ed.typePrixEffectif(l), qteNulle: !ed.transforme,
            achat: estFamilleAchat(ed.definition.type?.tyd_famille), chantier: ed.saisie.document.ent_chantier_id ?? null,
          }),
        },
        {
          cle: 'validation', libelle: texte('document_btp.page.notifications.validation'),
          messages: () => controlesValidation(lignes(), regles).map((m) => ({ ...m, gravite: 'erreur', message: texte('document_btp.page.notifications.bloquant', { message: m.message }) })),
        },
        { cle: 'metres', libelle: texte('document_btp.page.notifications.metres'), messages: () => messagesMetres(ed.resultat) },
      ],
      libelles: { ...LIBELLES_CONTROLE_SAISIE, NATURE_OBLIGATOIRE: texte('document_btp.page.notifications.nature_manquante') },
      // Métré : ouvert à la position de l'erreur ; sinon la ligne (tranches dépliées, filtre retiré au besoin).
      aller: (m) => {
        this.disposition.onglet('lignes');
        if (m.source === 'metres') {
          ed.allerA(m.lig_id, { focus: false });
          this.metre.ouvrir(m.lig_id, m.mtrId, m.ligne ? { ligne: m.ligne, colonne: m.colonne } : null);
        } else ed.allerA(m.lig_id);
      },
      surCompte: ({ erreurs, avertissements }) => {
        const b = this.$('.compteur-notifications');
        b.textContent = `${icone(erreurs ? 'erreur' : 'avertissement')} ${erreurs + avertissements}`;
        b.classList.toggle('avec-erreurs', erreurs > 0);
        b.classList.toggle('avec-avertissements', !erreurs && avertissements > 0);
      },
    });
    ed.notificationsLigne = (id) => this.notifications.messagesLigne(id);
    ed.surSignal = (id) => this.montrerNotifications(id);
    ed.surMenuContextuel = (elements, id) => {
      const n = this.notifications.messagesLigne(id).length;
      return [...elements, { separateur: true },
        { libelle: n ? texte('document_btp.page.notifications.ligne_nombre', { nombre: n }) : texte('document_btp.page.notifications.ligne'), raccourci: libelleRaccourci('notifications', 'document'), action: () => this.montrerNotifications(id), actif: n > 0 },
        { libelle: texte('document_btp.page.notifications.suivante'), raccourci: libelleRaccourci('notificationSuivante', 'document'), action: () => this.allerNotification(1) },
        { libelle: texte('document_btp.page.notifications.precedente'), raccourci: libelleRaccourci('notificationPrecedente', 'document'), action: () => this.allerNotification(-1) }];
    };
    ed.grille.rendre();
  }

  /** Contrôles du détail : notifications de la ligne courante (le panneau des notifications montre tout le document). */
  rendreControlesLigne() {
    if (!this.panneaux || !this.notifications) return;
    const messages = this.selection === null ? [] : this.notifications.messagesLigne(this.selection);
    this.panneaux.rendreMessages(this.$('#controles'), (id) => this.editeur.grille.selectionner(id), messages);
  }

  /** Panneau des notifications ouvert sur celles d'une ligne. */
  montrerNotifications(ligId) {
    if (!this.disposition.p.docks.notifications?.visible) this.disposition.afficher('notifications', true);
    this.notifications.montrerLigne(ligId);
  }

  /** Notification suivante (1) ou précédente (−1) : panneau affiché, ligne sélectionnée. */
  allerNotification(sens) {
    if (!this.notifications) return;
    if (!this.disposition.p.docks.notifications?.visible) this.disposition.afficher('notifications', true);
    if (!this.notifications.suivante(sens)) this.app.message(texte('document_btp.page.notifications.aucune'));
  }

  /** Modifications non enregistrées : la pile d'annulation a changé depuis l'ouverture ou le dernier enregistrement. */
  get modifiee() { return Boolean(this.editeur) && this.editeur.magasin.pile.at(-1) !== this.marque; }

  /** Bandeau au-dessus de la grille quand l'affichage est filtré sur une tranche. */
  afficherFiltre() {
    const barre = this.$('.barre-filtre');
    const ed = this.editeur;
    const description = ed.descriptionFiltres();
    barre.hidden = description === null;
    barre.replaceChildren();
    if (description !== null) {
      barre.innerHTML = `<span>${texteHtml('document_btp.page.filtre_html', { description })}</span><button type="button">${iconeHtml('retirer')} ${texteHtml('document_btp.page.tout_afficher')}</button>`;
      barre.querySelector('button').addEventListener('click', () => { ed.retirerFiltres(); ed.grille.focus(); });
    }
    this.plan?.rendre();
  }

  /** Vues de colonnes (API), partagées par les documents ouverts. */
  fournisseurVues() {
    return { vues: (type) => api.vuesDocument(type), enregistrer: (v) => api.enregistrerVueDocument(v), supprimer: (id) => api.supprimerVueDocument(id) };
  }

  rafraichir() {
    const ed = this.editeur;
    if (!ed) return;
    // Modèle du document changé : vue mémorisée ou par défaut de ce modèle.
    const modele = ed.saisie.document.ent_modele ?? null;
    if (this.vues && modele !== this.modeleAffiche) {
      this.modeleAffiche = modele;
      this.vues.changerModele().catch((x) => this.app.erreur(x));
    }
    const p = this.panneaux;
    p.rendreEntete(this.$('#entete'));
    this.plan?.rendre();
    if (this.disposition.p.onglet === 'analyse') this.analyse?.rendre();
    p.rendreDetail(this.$('#detail'), this.selection);
    p.rendreTotaux(this.$('#totaux'), { compact: true });
    p.rendreTotaux(this.$('#totaux-entete'));
    this.rendreAvancement(this.$('#totaux-entete'));
    const doc = ed.saisie.document;
    const d = ed.resultat.document;
    this.titre = `${ed.definition.type?.tyd_libelle ?? texte('document_btp.page.document')} ${doc.ent_numero ?? ''}`.trim();
    // Le net à payer est affiché dans les totaux sous la grille.
    this.rendreControlesLigne();
    p.rendreEcarts(this.$('#ecarts'), this.ecarts, (decision, commentaire) => this.arbitrer(decision, commentaire).catch((x) => this.app.erreur(x)));
    this.$('[data-action="annuler"]').disabled = ed.magasin.pile.length === 0;
    this.$('[data-action="retablir"]').disabled = ed.magasin.pileRefaire.length === 0;
    const statut = ed.definition.statuts?.find((s) => s.std_id === doc.ent_std_id);
    const modifiable = statut?.std_modifiable !== false && !doc.ent_verrouille && !this.bloque;
    this.$('[data-action="enregistrer"]').disabled = !modifiable;
    this.$('[data-action="enregistrer"]').textContent = texte(this.importEnCours ? 'document_btp.page.creer_devis' : 'document_btp.page.enregistrer');
    this.$('[data-action="valider"]').disabled = !modifiable || Boolean(this.importEnCours);
    // Cycle de vie (CONCEPTION-REGLES-DOCUMENTS.md, P17) : approbation interne si la règle l'active, envoi, validation du tiers.
    this.$('[data-action="valider"]').textContent = texte(ed.definition.regles?.APPROBATION ? 'document_btp.page.actions.approuver' : 'document_btp.page.actions.valider');
    const enCours = !STATUTS_HORS_VIGUEUR.includes(statut?.std_code);
    this.$('[data-action="envoyer"]').hidden = !doc.ent_approuve_le || Boolean(doc.ent_envoye_le) || !enCours;
    this.$('[data-action="valider-tiers"]').hidden = !doc.ent_envoye_le || Boolean(doc.ent_valide_tiers_le) || !enCours;
    this.$('[data-action="rejeter"]').hidden = this.$('[data-action="valider-tiers"]').hidden;
    const droits = ed.definition.droits ?? [];
    this.$('[data-action="devalider"]').hidden = !doc.ent_verrouille || !enCours || !(droits.includes('DEVALIDER') || droits.includes('FORCER'));
    // Changement de numéro : droit de déverrouillage (administrateur), et FORCER en numérotation continue (contrôlés par le serveur).
    this.$('[data-action="numero"]').hidden = !modifiable || !this.app.estAdmin() || Boolean(this.importEnCours)
      || (ed.definition.type?.tyd_numerotation_continue && !droits.includes('FORCER'));
    this.$('[data-action="transformer"]').disabled = !(ed.definition.transformations?.length) || Boolean(this.importEnCours);
    // Documents alimentés par d'autres (BL, factures, situations) : ajout de sources tant qu'ils sont en brouillon.
    // Pièce comptable validée (facture, avoir) non annulée : annulation par avoir.
    this.$('[data-action="annuler-avoir"]').hidden = !doc.ent_verrouille || statut?.std_code === STATUT_DOCUMENT.ANNULE
      || !ed.definition.type?.tyd_numerotation_continue || doc.ent_nature_avoir === 'ANNULATION';
    this.$('[data-action="consultation"]').hidden = !doc.ent_id || !ed.definition.type?.tyd_consultation;
    this.$('[data-action="sous-traiter"]').hidden = !doc.ent_id || !doc.ent_verrouille || !this.app.moduleActif(MODULE_FACULTATIF.SOUS_TRAITANCE)
      || !TYPES_SOUS_TRAITABLES.includes(ed.definition.type?.tyd_code);
    this.$('[data-action="sources"]').hidden = !modifiable || !TYPES_SOURCES.test(ed.definition.type?.tyd_code ?? '');
    rendreBandeauImport(this);
    this.#rendreAttente();
    document.body.classList.toggle('lecture-seule', !modifiable);
    if (this.disposition?.p.onglet === 'pieces') this.afficherPieces();
    if (this.disposition?.p.onglet === 'tracabilite' && this.tracabiliteCle !== this.cleTracabilite()) this.afficherTracabilite();
    // Onglet Suivi (module CRM actif, document enregistré) : notes du groupe d'indices.
    this.$('[data-onglet-vue="suivi"]').hidden = !this.app.moduleActif(MODULE_FACULTATIF.CRM) || !doc.ent_id;
    // Ordres (module Exécution) : coefficients par nature et marge dans l'ordre d'exécution seulement (E3, E17).
    const typeDoc = this.editeur.definition.type;
    this.$('[data-onglet-vue="analyse"]').hidden = typeDoc?.tyd_famille === FAMILLE_DOCUMENT.EXECUTION && typeDoc.tyd_code !== TYPE_DOCUMENT.E_OE;
    if (this.disposition?.p.onglet === 'suivi') this.afficherSuivi();
    // Onglet Règlements : pièces de vente et d'achat (pas les ordres d'exécution) ; rafraîchi à chaque changement de version.
    this.$('[data-onglet-vue="reglements"]').hidden = typeDoc?.tyd_famille === FAMILLE_DOCUMENT.EXECUTION;
    if (this.disposition?.p.onglet === 'reglements' && this.reglementsCle !== this.cleTracabilite()) this.afficherReglements();
    this.app.majPage();
  }

  /** Bandeau de la saisie enregistrée sur ce poste et pas encore envoyée (état, date, erreur). */
  #rendreAttente() {
    const zone = this.$('.document-attente');
    const a = this.attente;
    zone.hidden = !a;
    if (!a) return;
    const le = new Date(a.le).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    zone.classList.toggle('probleme', a.etat !== ETAT_ATTENTE.ATTENTE);
    zone.innerHTML = a.etat === ETAT_ATTENTE.CONFLIT
      ? `${iconeHtml('avertissement')} <b>${echapper(ETATS_ATTENTE.CONFLIT)}</b> : ${texteHtml('document_btp.page.attente.conflit', { le })}
        <a href="${urlAttente(a)}" title="${texteHtml('document_btp.page.attente.comparer_aide')}">${iconeHtml('document_btp_fusion')} ${texteHtml('document_btp.page.attente.comparer')}</a>`
      : a.etat === ETAT_ATTENTE.FUSION
        ? `${iconeHtml('document_btp_fusion')} <b>${echapper(ETATS_ATTENTE.FUSION)}</b> : ${texteHtml('document_btp.page.attente.fusion')}`
      : a.etat === ETAT_ATTENTE.ERREUR
        ? `${iconeHtml('avertissement')} <b>${echapper(ETATS_ATTENTE.ERREUR)}</b> : ${texteHtml('document_btp.page.attente.erreur', { erreur: a.erreur ?? '', le })}`
        : `${iconeHtml('document_btp_attente')} ${texteHtml(a.id ? 'document_btp.page.attente.attente' : 'document_btp.page.attente.attente_creation', { le })}`;
  }

  /** Document créé hors ligne : brouillon local à identifiant provisoire négatif, créé sur le serveur à l'envoi. */
  async #nouveauHorsLigne(type) {
    let definition;
    try {
      definition = await api.definition(type.tyd_code);
    } catch (e) {
      if (estHorsLigne(e)) throw new Error(texte('document_btp.page.hors_ligne_type', { type: type.tyd_libelle.toLowerCase() }));
      throw e;
    }
    const brouillon = definition.statuts?.find((s) => s.std_code === STATUT_DOCUMENT.BROUILLON) ?? definition.statuts?.[0];
    const params = { ent_tyd_id: type.tyd_id, ent_tiers_id: null, ent_objet: texte('document_btp.page.objet_nouveau', { type: type.tyd_libelle.toLowerCase() }) };
    const id = -Date.now();
    const document = {
      ent_id: id, ent_tyd_id: type.tyd_id, ent_numero: null, ent_std_id: brouillon?.std_id ?? 1, ent_version: 1, ent_indice: null,
      ent_tiers_id: null, ent_objet: params.ent_objet, ent_date: aujourdhui(), ent_precision_montant: 2,
      ent_num_format: { separateur: '.', niveaux: [{ style: '1' }] }, ent_modele: null, ent_bib_id: null, ent_intervenants: [], ent_proprietes: {},
    };
    this.attente = null;
    this.depart = null;
    await this.charger(definition, { document, lignes: [] });
    await ecrireAttente({ ...this.#entreeAttente(), creation: { params, initial: document } });
    this.attente = await lireAttente(this.app.utilisateur(), id);
    this.app.routeur.remplacerUrl(urlDocument(id));
    this.disposition.onglet('entete');
    this.rafraichir();
    this.app.publier(SUJET_ATTENTE, {});
    this.app.message(texte('document_btp.page.cree_hors_ligne', { type: type.tyd_libelle }), 'avertissement');
  }

  async nouveau(code) {
    const type = this.types.find((t) => t.tyd_code === code);
    if (!type) throw new Error(texte('document_btp.page.type_inconnu', { code }));
    if (this.app.apiPerdue) { await this.#nouveauHorsLigne(type); return; }
    // Tiers choisi ensuite dans l'annuaire du document (obligatoire à la validation).
    const cree = await api.creer({ ent_tyd_id: type.tyd_id, ent_tiers_id: null, ent_objet: texte('document_btp.page.objet_nouveau', { type: type.tyd_libelle.toLowerCase() }) });
    this.app.routeur.remplacerUrl(urlDocument(cree.document.ent_id));
    await this.chargerDocument(cree.document.ent_id);
    this.disposition.onglet('entete');
    this.app.publier(SUJET_FENETRE.ENREGISTRE, { type: code, ids: [cree.document.ent_id], cree: true });
    this.app.message(texte('document_btp.page.cree', { type: type.tyd_libelle, numero: cree.document.ent_numero ?? '' }));
  }

  /**
   * Enregistrement en un seul appel : le client envoie ses résultats, le serveur recalcule, compare,
   * renvoie les ID définitifs et les écarts. La pile d'annulation est conservée.
   */
  /** Document ouvert depuis une liste : boutons ◀ ▶ vers ses voisins dans les lignes affichées (suite-liste.js). */
  #voisinage() {
    this.voisinage = voisins(urlDocument(this.params.id));
    if (!this.voisinage) return;
    const { rang, total, precedent, suivant } = this.voisinage;
    for (const [action, cible] of [['precedent', precedent], ['suivant', suivant]]) {
      const b = this.$(`[data-action="${action}"]`);
      b.hidden = !cible;
      b.title = texte(`document_btp.page.voisins.${action}`, { rang, total });
    }
  }

  /** Document précédent ou suivant de la liste d'origine, à la place de celui-ci (modifications en cours : confirmation). */
  precedent() { if (this.voisinage?.precedent) this.app.naviguer(this.voisinage.precedent, { remplacer: true }); }

  suivant() { if (this.voisinage?.suivant) this.app.naviguer(this.voisinage.suivant, { remplacer: true }); }

  async enregistrer() {
    if (this.$('[data-action="enregistrer"]').disabled) return;
    if (this.importEnCours) { await creerDepuisImport(this); return; }
    const ed = this.editeur;
    const r = ed.resultat;
    const envoi = {
      document: r.document, lignes: r.lignes, metres: r.metres, variables: r.variables, ventilations: r.ventilations ?? [],
      ventilations_lignes: r.ventilations_lignes ?? [], version_moteur_client: VERSION_MOTEUR,
    };
    const compte = this.app.utilisateur();
    const id = ed.saisie.document.ent_id;
    // Serveur injoignable, ou document créé hors ligne : enregistré sur ce poste, puis envoyé s'il répond (la page
    // reprend la réponse par le sujet hors-ligne-envoye).
    if (this.app.apiPerdue || id < 0) {
      await this.#enregistrerSurPoste(envoi);
      if (!this.app.apiPerdue) {
        await envoyerDocument(this.app, compte, id).catch(async (e) => {
          if (estHorsLigne(e)) return;
          this.attente = await marquerAttente(compte, id, { etat: ETAT_ATTENTE.ERREUR, erreur: e.message });
          this.rafraichir();
          throw e;
        });
      }
      return;
    }
    const saisieEnvoyee = structuredClone(ed.entree(ed.saisie));
    let rep;
    try {
      rep = await api.enregistrer(id, envoi);
    } catch (e) {
      if (estHorsLigne(e)) { await this.#enregistrerSurPoste(envoi); return; }
      // Saisie hors ligne refusée (version du serveur changée) : gardée sur ce poste, à fusionner (/fusion/document/:id).
      if (this.attente && e.statut === 409) { this.attente = await marquerAttente(compte, id, { etat: ETAT_ATTENTE.CONFLIT, erreur: e.message }); this.rafraichir(); }
      throw e;
    }
    // Saisie hors ligne de ce document : remplacée par cet enregistrement.
    if (this.attente) {
      await retirerAttente(compte, id).catch(() => {});
      this.attente = null;
      this.app.publier(SUJET_ATTENTE, {});
    }
    this.#appliquerReponse(rep, false);
    this.dernierEnvoi = { entree: saisieEnvoyee, client: envoi, serveur: rep.document };
    this.marque = ed.magasin.pile.at(-1);
    this.rafraichir();
    // Rafraîchissement ciblé de la ligne du document dans les listes (cette fenêtre et les autres).
    this.app.publier(SUJET_FENETRE.ENREGISTRE, { type: rep.document.document.ent_tyd_id, ids: [rep.document.document.ent_id] });
    this.app.message(rep.ecarts.length ? texte('document_btp.page.enregistre_ecarts', { nombre: rep.ecarts.length }) : texte('document_btp.page.enregistre', { version: rep.document.document.ent_version }),
      rep.ecarts.length ? 'avertissement' : 'succes');
  }

  /** Réponse de l'enregistrement appliquée à l'éditeur ; `identiteSeule` : l'entête saisi depuis l'envoi est gardé. */
  #appliquerReponse(rep, identiteSeule) {
    const ed = this.editeur;
    let map = (x) => x;
    ed.magasin.appliquerServeur((d) => { map = appliquerReponse(d, rep, { identiteSeule }); });
    if (this.selection !== null) this.selection = map(this.selection);
    ed.grille.courant = map(ed.grille.courant);
    ed.grille.selection = ed.grille.selection.map(map);
    this.ecarts = rep.ecarts?.length ? rep.ecarts : null;
  }

  /** Entrée de la file hors ligne pour la saisie en cours (dernier résultat du moteur et contenu de l'éditeur). */
  #entreeAttente(envoi) {
    const ed = this.editeur;
    const doc = ed.saisie.document;
    const r = ed.resultat;
    return {
      compte: this.app.utilisateur(), id_local: doc.ent_id, id: doc.ent_id > 0 ? doc.ent_id : null,
      envoi: envoi ?? {
        document: r.document, lignes: r.lignes, metres: r.metres, variables: r.variables, ventilations: r.ventilations ?? [],
        ventilations_lignes: r.ventilations_lignes ?? [], version_moteur_client: VERSION_MOTEUR,
      },
      saisie: structuredClone(ed.saisie), depart: this.depart ?? null, type_code: ed.definition.type?.tyd_code ?? null,
      libelle: `${ed.definition.type?.tyd_libelle ?? texte('document_btp.page.document')} ${doc.ent_numero ?? texte('document_btp.page.cree_hors_ligne_numero')}`, etat: ETAT_ATTENTE.ATTENTE,
    };
  }

  /** Enregistrement sur ce poste (serveur injoignable) : la saisie part dès le retour de l'API. */
  async #enregistrerSurPoste(envoi) {
    this.attente = await ecrireAttente(this.#entreeAttente(envoi));
    this.marque = this.editeur.magasin.pile.at(-1);
    this.rafraichir();
    this.app.publier(SUJET_ATTENTE, {});
    if (this.app.apiPerdue) this.app.message(texte('document_btp.page.serveur_injoignable'), 'avertissement');
  }

  /** Saisie hors ligne envoyée (cette fenêtre ou une autre) : identifiants définitifs, numéro, verrou repris. */
  #surEnvoiHorsLigne({ compte, id_local: idLocal, id, rep }) {
    const ed = this.editeur;
    if (!ed || compte !== this.app.utilisateur() || ed.saisie.document.ent_id !== idLocal) return;
    // Saisie continuée depuis l'envoi : elle reste à enregistrer, seule l'identité de l'entête est reprise.
    const modifiee = this.modifiee;
    this.#appliquerReponse(rep, modifiee);
    if (!modifiee) this.marque = ed.magasin.pile.at(-1);
    this.attente = null;
    this.depart = null;
    if (idLocal !== id) this.app.routeur.remplacerUrl(urlDocument(id));
    this.rafraichir();
    this.prendreVerrou().catch(() => {});
    this.app.publier(SUJET_FENETRE.ENREGISTRE, { type: ed.definition.type?.tyd_code, ids: [id], cree: idLocal !== id });
    this.app.message(texte('document_btp.page.envoye_serveur', { type: ed.definition.type?.tyd_libelle ?? texte('document_btp.page.document'), numero: rep.document.document.ent_numero ?? '' }), 'succes');
  }

  async arbitrer(decision, commentaire) {
    const e = this.dernierEnvoi;
    const rep = await api.casTest({
      ent_id: this.editeur.saisie.document.ent_id, cas_decision: decision, cas_commentaire: commentaire || null,
      version_client: VERSION_MOTEUR, document_entree: e.entree, resultat_client: e.client, resultat_serveur: e.serveur, ecarts: this.ecarts,
    });
    this.ecarts = null;
    this.rafraichir();
    this.app.message(texte(decision === 'S' ? 'document_btp.page.cas_serveur' : 'document_btp.page.cas_anomalie', { numero: rep.cas_id }), 'succes');
  }

  /**
   * Rattachement à la structure (marché → chantier → affaire complétés). Document modifiable : modification de la
   * saisie (enregistrée avec le document) ; validé : classement direct, sans toucher au contenu.
   */
  async rattacher(r) {
    const ed = this.editeur;
    const complet = completerRattachement(r, this.structure ?? { chantiers: [], marches: [] });
    if (this.#modifiable() && !this.bloque && !ed.magasin.lectureSeule) {
      ed.magasin.modifier((b) => { Object.assign(b.document, complet); }, texte('document_btp.etapes.rattachement'));
      // Annuaire encore vide (tiers seul) : intervenants du marché ou du chantier repris d'office.
      if (this.panneaux.intervenantsDocument().length <= 1) {
        const n = await this.panneaux.reprendreIntervenants();
        if (n) this.app.message(texte('document_btp.page.intervenants_repris', { nombre: n }));
      }
      return;
    }
    const doc = ed.saisie.document;
    Object.assign(doc, await this.servicesStructure.rattacher(doc.ent_id, complet));
    this.app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [doc.ent_id] });
    this.app.message(texte('document_btp.page.rattachement_enregistre'), 'succes');
    this.rafraichir();
  }

  /**
   * Onglet Pièces : documents de la GED liés au document (type du document, groupe des indices : les pièces suivent
   * les nouveaux indices), marquage des pièces jointes à envoyer (module Mail). Recréé quand le document change.
   */
  /** Clé de l'onglet Traçabilité : document et version (rafraîchi après un enregistrement ou une validation). */
  cleTracabilite() {
    const d = this.editeur?.saisie.document;
    return d ? `${d.ent_id}-${d.ent_version}-${this.importEnCours ? 'import' : ''}-${this.editeur.vue?.debogage ? 'dbg' : ''}` : null;
  }

  afficherTracabilite() {
    const zone = this.$('#vue-tracabilite');
    const d = this.editeur?.saisie.document;
    if (!d) return;
    this.tracabiliteCle = this.cleTracabilite();
    if (this.importEnCours) { tracabiliteImport(this, zone); return; }
    if (!d.ent_id) { zone.innerHTML = `<p class="aide">${texteHtml('document_btp.page.tracabilite_indisponible')}</p>`; return; }
    afficherTracabilite(zone, {
      entId: d.ent_id, ged: this.servicesGed, debogage: Boolean(this.editeur.vue?.debogage),
      naviguer: (url, e) => this.app.naviguer(url, { nouvelleFenetre: Boolean(e?.ctrlKey || e?.shiftKey) }),
      // Réutilisation du fichier source conservé : nouvelle vérification dans une autre fenêtre.
      reimporter: (o) => this.app.naviguer(`${formatImport(o.dor_format).page}?ged=${o.dor_fichier_id}`, { nouvelleFenetre: true }),
    }).catch((x) => { zone.innerHTML = `<p class="erreur">${echapper(x.message)}</p>`; });
  }

  /** Onglet Règlements : échéancier modifiable, règlements et imputations, déductions d'acompte (documents/reglements-document.js). */
  afficherReglements() {
    const zone = this.$('#vue-reglements');
    if (!this.editeur?.saisie.document) return;
    this.reglementsCle = this.cleTracabilite();
    afficherReglements(zone, { app: this.app, page: this, modes: this.panneaux?.modesReglement?.() ?? [] })
      .catch((x) => { zone.innerHTML = `<p class="erreur">${echapper(x.message)}</p>`; });
  }

  /** Onglet Suivi (module CRM) : notes, tâches et courriels du document, tous indices confondus (groupe d'indices). */
  afficherSuivi() {
    const zone = this.$('#vue-suivi');
    const d = this.editeur?.saisie.document;
    if (!d?.ent_id) { zone.innerHTML = `<p class="aide">${texteHtml('document_btp.page.suivi_indisponible')}</p>`; return; }
    const id = String(d.ent_groupe_id ?? d.ent_id);
    if (this.suivi && this.suiviId === id) return;
    this.suivi?.fermer();
    this.suiviId = id;
    zone.replaceChildren();
    this.suivi = new PanneauSuivi(zone, { app: this.app, type: 'document', id, libelle: d.ent_numero ?? '' });
    this.suivi.ouvrir().catch((x) => { zone.innerHTML = `<p class="erreur">${echapper(x.message)}</p>`; });
  }

  afficherPieces() {
    const zone = this.$('#vue-pieces');
    const d = this.editeur?.saisie.document;
    if (!d) return;
    if (this.importEnCours) { zone.innerHTML = `<p class="aide">${texteHtml('document_btp.page.pieces_import')}</p>`; return; }
    const cle = `${d.ent_tyd_id}-${d.ent_groupe_id ?? d.ent_id}`;
    if (this.ged && this.gedCle === cle) return;
    this.ged?.detruire?.();
    zone.replaceChildren();
    if (!this.servicesGed) { zone.innerHTML = `<p class="aide">${texteHtml('document_btp.page.ged_absente')}</p>`; return; }
    const type = this.editeur.definition.type;
    this.gedCle = cle;
    // Arborescence : le document est la racine, ses documents enfants (transformations, copies) sont des dossiers.
    const contexte = { type_element: type?.tyd_code ?? 'document', id_element: String(d.ent_groupe_id ?? d.ent_id), libelle: `${type?.tyd_libelle ?? texte('document_btp.page.document')} ${d.ent_numero ?? ''}`.trim(), icone: icone('document_btp_piece_document') };
    this.ged = new ExplorateurGed(zone, {
      fournisseur: this.servicesGed, envoi: true, terrain: type?.tyd_famille === FAMILLE_DOCUMENT.EXECUTION, modifiable: true, admin: this.app.estAdmin(), utilisateur: this.app.utilisateur(), contexte,
      arborescence: this.servicesStructure ? new ArborescenceBtp(contexte, { structure: this.servicesStructure, entId: d.ent_id }) : null,
      ouvrirUrl: (url) => this.app.naviguer(url, { nouvelleFenetre: true }),
      message: (t, n) => this.app.message(t, n),
    });
  }

  async valider() {
    const ed = this.editeur;
    if (this.modifiee && !await confirmer(texte('document_btp.page.valider_enregistrer'))) return;
    // Commande client : marché obligatoire (sauf commande intermédiaire d'un devis facturé directement).
    const d = ed.saisie.document;
    if (ed.definition.type?.tyd_code === TYPE_DOCUMENT.V_COMMANDE && !d.ent_marche_id && !d.ent_intermediaire && !(await this.choisirMarche())) return;
    // Commande de sous-traitance : marché de sous-traitance obligatoire (ST2, ST4).
    if (ed.definition.type?.tyd_code === TYPE_DOCUMENT.T_COMMANDE && !d.ent_marche_id && !(await this.choisirMarcheSousTraitance())) return;
    // Frais annexes : à la validation, la ventilation est figée en clés de ligne ; les clés orphelines sont supprimées.
    const orphelines = messagesFrais(ed.resultat).filter((m) => m.code === 'FA_CLE_ORPHELINE' || m.code === 'FA_CLE_BLOQUEE');
    if (orphelines.length && !await confirmer(texte('document_btp.page.valider_cles', { nombre: orphelines.length, liste: orphelines.map((m) => `${icone('document_puce')} ${m.message}`).join('\n') }))) return;
    if (this.modifiee) await this.enregistrer();
    // Contrôles de gestion (lot 6 des règles) : avertissements non bloquants, l'utilisateur choisit.
    if (!(await confirmerAvertissements(ed.saisie.document.ent_id, 'VALIDER', texte('document_btp.page.actions.valider')))) return;
    const rep = await api.valider(ed.saisie.document.ent_id, ed.saisie.document.ent_version);
    await this.chargerDocument(rep.document.document.ent_id);
    this.app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [rep.document.document.ent_id] });
    this.app.message(texte('document_btp.page.valide', { numero: rep.document.document.ent_numero }), 'succes');
  }

  /** Étape du cycle de vie (envoi, validation du tiers, rejet) puis rechargement du document. */
  /**
   * Nouveau numéro au format du type ; numérotation continue : motif obligatoire. Un numéro déjà pris est remplacé par
   * le prochain libre (avertissement du serveur).
   */
  async changerNumero() {
    if (this.modifiee) { this.app.message(texte('document_btp.page.numero.enregistrer_avant'), 'avertissement'); return; }
    const doc = this.editeur.saisie.document;
    const type = this.editeur.definition.type ?? {};
    const exemple = `${type.tyd_prefixe_numero ?? ''}${String(doc.ent_date ?? '').slice(0, 4) || new Date().getFullYear()}-00001`;
    const numero = await saisir(texte('document_btp.page.numero.nouveau', { exemple }), doc.ent_numero ?? exemple, { obligatoire: true });
    if (!numero?.trim() || numero.trim() === doc.ent_numero) return;
    let motif = null;
    if (type.tyd_numerotation_continue) {
      motif = await saisir(texte('document_btp.page.numero.motif'), '', { obligatoire: true });
      if (!motif?.trim()) return;
    }
    try {
      const rep = await api.changerNumero(doc.ent_id, numero.trim(), motif?.trim() ?? null);
      await this.chargerDocument(doc.ent_id);
      this.app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [doc.ent_id] });
      this.app.message(rep.avertissement ?? texte('document_btp.page.numero.attribue', { numero: rep.numero }), rep.avertissement ? 'avertissement' : 'succes');
    } catch (e) { this.app.erreur(e); }
  }

  async etapeCycle(appel, message) {
    try {
      const rep = await appel(this.editeur.saisie.document.ent_id);
      await this.chargerDocument(rep.document.document.ent_id);
      this.app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [rep.document.document.ent_id] });
      this.app.message(message, 'succes');
    } catch (e) { this.app.erreur(e); }
  }

  /**
   * Document issu d'une transformation (BL, facture, avoir…) : restes à solder des lignes liées à leur parent
   * (colonnes Qté parent, Reste, Soldé de la grille).
   */
  async chargerRestes() {
    const ed = this.editeur;
    // Documents d'avancement : l'avancement remplace le reste à solder.
    if (ed.saisie.document.ent_avt_presentation || !ed.saisie.lignes.some((l) => l.lig_origine_id)) return;
    try {
      ed.definirRestes(await api.restes(ed.saisie.document.ent_id));
    } catch (e) {
      this.app.message(texte('document_btp.page.restes_indisponibles', { message: e.message }), 'avertissement');
    }
  }

  /**
   * Annulation par avoir (Q30, 13.12 bis) : la pièce et, dans un marché, toutes les pièces d'avancement suivantes sont
   * annulées par avoir après confirmation ; la dernière situation concernée est remise en cours (nouvel indice).
   */
  async annulerParAvoir() {
    const d = this.editeur.saisie.document;
    const pieces = await api.piecesAnnulation(d.ent_id);
    if (!pieces.length) { this.app.message(texte('document_btp.page.annulation.rien'), 'avertissement'); return; }
    const liste = pieces.map((x) => `${icone('document_puce')} ${x.rang ? `${texte('document_btp.page.rang', { rang: x.rang })} · ` : ''}${x.type} ${x.numero ?? ''} (${texte('document_btp.page.montant_ht', { montant: formatNombre(x.total_ht, 2) })})`).join('\n');
    if (!await confirmer(texte(pieces.length > 1 ? 'document_btp.page.annulation.confirmer_plusieurs' : 'document_btp.page.annulation.confirmer_une', { nombre: pieces.length, liste }))) return;
    const r = await api.annulerParAvoir(d.ent_id);
    this.app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [d.ent_id, ...r.avoirs] });
    await this.chargerDocument(d.ent_id);
    this.app.message(texte(r.situation ? 'document_btp.page.annulation.creees_situation' : 'document_btp.page.annulation.creees', { nombre: r.avoirs.length }), 'succes');
    if (r.situation && await confirmer(texte('document_btp.page.annulation.ouvrir_situation'))) await this.app.naviguer(urlDocument(r.situation), { nouvelleFenetre: true });
  }

  /** Document d'avancement d'un marché : numéro de situation et documents précédents (bloc de déduction, 13.7). */
  async chargerAvancement() {
    const d = this.editeur.saisie.document;
    this.avancement = null;
    if (!d.ent_avt_presentation || !d.ent_marche_id) return;
    try { this.avancement = await api.avancementDocument(d.ent_id); } catch { this.avancement = null; }
    this.rendreAvancement(this.$('#totaux-entete'));
  }

  /**
   * Bloc de déduction sous les totaux : cumul HT = documents précédents + ce document ; facture d'avancement : chaque
   * document précédent (numéro de situation, numéro, HT) est déduit du cumul, le reste est la période facturée.
   */
  rendreAvancement(zone) {
    const a = this.avancement;
    const d = this.editeur?.resultat?.document;
    if (!zone || !a || !d) return;
    zone.querySelector('.bloc-avancement')?.remove();
    const pm = this.editeur.saisie.document.ent_precision_montant ?? 2;
    const precedents = a.precedents ?? [];
    const periode = this.editeur.saisie.document.ent_avt_presentation === 'P';
    const deduit = precedents.reduce((s, x) => s.plus(D(x.total_ht ?? 0)), D(0));
    const cumul = periode ? deduit.plus(D(d.ent_total_ht ?? 0)) : D(d.ent_total_ht ?? 0);
    const f = (v) => formatNombre(v, pm);
    const bloc = document.createElement('section');
    bloc.className = 'bloc-avancement';
    const rang = (x) => (x.rang ? `${texteHtml('document_btp.page.rang', { rang: x.rang })} · ` : '');
    bloc.innerHTML = `<h4>${a.rang ? texteHtml('document_btp.page.avancement.titre_rang', { rang: a.rang }) : texteHtml('document_btp.page.avancement.titre')}</h4>
      <table><tbody>
        <tr><th>${texteHtml('document_btp.page.avancement.cumul')}</th><td class="nombre">${f(cumul)}</td></tr>
        ${periode ? `${precedents.map((x) => `<tr><td>${texteHtml('document_btp.page.avancement.a_deduire')} ${rang(x)}${echapper(x.type ?? '')} ${echapper(x.numero ?? '')}</td><td class="nombre">−${f(x.total_ht)}</td></tr>`).join('')}
        <tr><th>${texteHtml('document_btp.page.avancement.periode')}</th><td class="nombre">${f(d.ent_total_ht)}</td></tr>` : `<tr><td colspan="2"><small>${precedents.length ? texteHtml('document_btp.page.avancement.situation_deduit', { montant: f(deduit) }) : texteHtml('document_btp.page.avancement.situation')}</small></td></tr>`}
      </tbody></table>
      ${(a.annules ?? []).length ? `<label class="coche"><input type="checkbox" data-annules ${this.voirAnnules ? 'checked' : ''}> ${texteHtml('document_btp.page.avancement.annules', { nombre: a.annules.length })}</label>
        ${this.voirAnnules ? `<table class="annules"><tbody>${a.annules.map((x) => `<tr><td>${rang(x)}${echapper(x.type ?? '')} ${echapper(x.numero ?? '')}${x.nature === 'ANNULATION' ? ` ${texteHtml('document_btp.page.avancement.avoir_annulation')}` : ''}</td><td class="nombre">${f(x.total_ht)}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}`;
    bloc.querySelector('[data-annules]')?.addEventListener('change', (e) => { this.voirAnnules = e.target.checked; this.rendreAvancement(zone); });
    zone.append(bloc);
  }

  /**
   * Commande client à valider sans marché : chantier (existant ou nouveau, pré-rempli) puis création du marché, ou
   * rattachement comme avenant d'un marché en cours. Renvoie vrai si la commande est rattachée (validation à suivre).
   */
  async choisirMarcheSousTraitance() {
    if (!this.servicesStructure || !this.servicesFiche) { this.app.message(texte('document_btp.page.marche.indisponible'), 'avertissement'); return false; }
    this.structure = await this.servicesStructure.referentiels();
    const doc = this.editeur.saisie.document;
    const r = await proposerMarcheSousTraitance({
      refs: this.structure, doc, totalHt: this.editeur.resultat.document?.ent_total_ht ?? null,
      nomTiers: (doc.ent_intervenants ?? []).find((i) => i.per_id === doc.ent_tiers_id)?.tiers ?? '',
      creerMarche: async (valeurs) => creerFicheCodeLibre(this.servicesFiche, TYPE_FICHE.MARCHE, { valeurs: { ...valeurs, intervenants: [] }, proprietes: {} }),
      codePrevisionnel: (type, valeurs) => codePrevisionnel(this.servicesFiche, type, valeurs),
    });
    if (!r) return false;
    this.structure = await this.servicesStructure.referentiels();
    this.panneaux.structure = this.structure;
    await this.rattacher({ ...doc, ent_marche_id: r.ent_marche_id });
    this.app.message(r.cree ? texte('document_btp.page.marche.st_cree') : texte('document_btp.page.marche.st_avenant'), 'succes');
    return true;
  }

  async choisirMarche() {
    if (!this.servicesStructure || !this.servicesFiche) { this.app.message(texte('document_btp.page.marche.indisponible'), 'avertissement'); return false; }
    this.structure = await this.servicesStructure.referentiels();
    const doc = this.editeur.saisie.document;
    const r = await proposerMarche({
      refs: this.structure, doc, totalHt: this.editeur.resultat.document?.ent_total_ht ?? null,
      individus: await individusStructure(this.servicesAnnuaire).catch(() => []),
      creerChantier: async (valeurs) => creerFicheCodeLibre(this.servicesFiche, TYPE_FICHE.CHANTIER, { valeurs, proprietes: {} }),
      // Le marché reprend les intervenants du chantier.
      creerMarche: async (valeurs) => creerFicheCodeLibre(this.servicesFiche, TYPE_FICHE.MARCHE, {
        valeurs: { ...valeurs, intervenants: await this.servicesStructure.intervenants(TYPE_FICHE.CHANTIER, valeurs.cha_id).catch(() => []) }, proprietes: {},
      }),
      codePrevisionnel: (type, valeurs) => codePrevisionnel(this.servicesFiche, type, valeurs),
    });
    if (!r) return false;
    this.structure = await this.servicesStructure.referentiels();
    this.panneaux.structure = this.structure;
    await this.rattacher({ ...doc, ent_marche_id: r.ent_marche_id });
    this.app.message(r.cree ? texte('document_btp.page.marche.cree') : texte('document_btp.page.marche.avenant'), 'succes');
    return true;
  }

  /**
   * Lot de consultation (ST3) : documents du lot (fournisseur, total HT, statut) et « Autre fournisseur » = copie de la
   * demande sans tiers, ouverte dans une nouvelle fenêtre ; le comparatif des offres vient de la sous-traitance (lot 5).
   */
  async lotConsultation() {
    const d = this.editeur?.saisie.document;
    if (!d?.ent_id) return;
    const lot = await api.consultation(d.ent_id);
    const dlg = document.createElement('dialog');
    dlg.className = 'dialogue-structure';
    dlg.innerHTML = `<form method="dialog"><h3>${iconeHtml('document_btp_consultation')} ${texteHtml('document_btp.page.lot.titre', { code: lot.code ?? '' })}</h3>
      ${lot.documents.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('document_btp.page.lot.numero')}</th><th>${texteHtml('document_btp.page.lot.fournisseur')}</th><th class="nombre">${texteHtml('document_btp.page.lot.total')}</th><th>${texteHtml('document_btp.page.lot.statut')}</th></tr></thead><tbody>
        ${lot.documents.map((x) => `<tr><td><a href="${urlDocument(x.id)}">${echapper(x.numero ?? `#${x.id}`)}</a></td><td>${echapper(x.tiers ?? '—')}</td>
          <td class="nombre">${formatNombre(Number(x.total_ht), 2)}</td><td>${echapper(x.statut)}</td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('document_btp.page.lot.vide')}</p>`}
      <p class="ligne"><button type="button" class="principal" data-copier>${iconeHtml('ajouter')} ${texteHtml('document_btp.page.lot.autre')}</button>
        ${lot.documents.length > 1 ? `<button type="button" data-comparer title="${texteHtml('document_btp.page.lot.comparer_aide')}">${iconeHtml('document_btp_ventiler')} ${texteHtml('document_btp.page.lot.comparer')}</button>` : ''}
        ${lot.documents.length ? `<button type="button" data-envoyer title="${texteHtml('document_btp.page.lot.envoyer_aide', { icone: icone('document_btp_envoyer') })}">${iconeHtml('document_btp_envoyer')} ${texteHtml('document_btp.page.lot.envoyer')}</button>` : ''}
        <button value="fermer">${texteHtml('document_btp.page.fermer_bouton')}</button></p></form>`;
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelector('[data-comparer]')?.addEventListener('click', () => {
      dlg.close();
      this.app.naviguer(`/consultation/comparatif?id=${d.ent_id}`, { nouvelleFenetre: true });
    });
    dlg.querySelector('[data-envoyer]')?.addEventListener('click', async () => {
      dlg.close();
      await this.envoyerLot(d.ent_id, lot);
    });
    dlg.querySelector('[data-copier]').addEventListener('click', async () => {
      try {
        const r = await api.copierConsultation(d.ent_id);
        dlg.close();
        this.app.message(texte('document_btp.page.lot.copiee'), 'succes');
        this.app.naviguer(urlDocument(r.id), { nouvelleFenetre: true });
      } catch (e) { this.app.erreur(e); }
    });
    ouvrirModale(dlg, () => dlg.close());
  }

  /**
   * Envoi groupé du lot de consultation (lot 9, A24d) : un courriel par fournisseur (offres validées), puis compte rendu
   * (envoyées, ignorées avec leur motif) ; les offres déjà envoyées ne repartent que sur demande.
   */
  async envoyerLot(id, lot) {
    const choix = await ouvrirDialogue({
      titre: `${icone('document_btp_envoyer')} ${texte('document_btp.page.lot.envoi_titre', { code: lot.code ?? '' })}`,
      message: texte('document_btp.page.lot.envoi_message', { nombre: lot.documents.length }),
      boutons: [{ libelle: texte('document_btp.page.lot.annuler'), valeur: null }, { libelle: texte('document_btp.page.lot.renvoyer'), valeur: 'tout' }, { libelle: texte('document_btp.page.lot.envoyer_bouton'), principal: true, valeur: 'nouveaux' }],
    });
    if (!choix) return;
    let r;
    try { r = await api.envoyerConsultation(id, choix === 'tout'); } catch (e) { this.app.erreur(e); return; }
    const libelles = { ENVOYE: `${iconeHtml('document_btp_envoyer')} ${texteHtml('document_btp.page.lot.resultats.ENVOYE')}`, IGNORE: texteHtml('document_btp.page.lot.resultats.IGNORE'), ERREUR: `${iconeHtml('avertissement')} ${texteHtml('document_btp.page.lot.resultats.ERREUR')}` };
    await ouvrirDialogue({
      titre: `${icone('document_btp_envoyer')} ${texte('document_btp.page.lot.compte_rendu', { code: lot.code ?? '', nombre: r.filter((x) => x.resultat === 'ENVOYE').length })}`,
      html: `<table class="tableau-compact"><thead><tr><th>${texteHtml('document_btp.page.lot.offre')}</th><th>${texteHtml('document_btp.page.lot.fournisseur')}</th><th>${texteHtml('document_btp.page.lot.resultat')}</th><th>${texteHtml('document_btp.page.lot.detail')}</th></tr></thead><tbody>
        ${r.map((x) => `<tr class="${x.resultat === 'ERREUR' ? 'erreur' : ''}"><td>${echapper(x.numero ?? `#${x.id}`)}</td><td>${echapper(x.tiers ?? '—')}</td>
          <td>${libelles[x.resultat] ?? echapper(x.resultat)}</td><td>${echapper(x.message ?? '')}</td></tr>`).join('')}</tbody></table>
        <p class="aide">${texteHtml('document_btp.page.lot.suivi')}</p>`,
      boutons: [{ libelle: texte('document_btp.page.fermer_bouton'), principal: true, valeur: true }],
    });
  }

  /** Assistant « Sous-traiter » (Sous-traitance, lot 5) : lignes sélectionnées de la grille ou tout le reliquat. */
  async sousTraiter() {
    const d = this.editeur?.saisie.document;
    if (!d?.ent_id) return;
    const selection = (this.editeur.grille?.selection ?? []).filter((id) => Number(id) > 0);
    const ids = await sousTraiter({ entId: d.ent_id, selection, message: (m, n) => this.app.message(m, n) });
    if (!ids?.length) return;
    this.app.message(texte('document_btp.page.st_crees', { nombre: ids.length }), 'succes');
    this.app.naviguer(urlDocument(ids[0]), { nouvelleFenetre: true });
  }

  /**
   * Ajoute des documents sources au brouillon (CONCEPTION-ACHATS-MARCHES.md Q10, Q18) : document d'un marché, les
   * commandes (avenants) du marché pas encore reprises ; sinon les documents validés en attente du même tiers. Chaque
   * document devient une section avec son pied ; le document est rechargé.
   */
  async ajouterSources() {
    const ed = this.editeur;
    const d = ed.saisie.document;
    if (this.modifiee) await this.enregistrer();
    let sources;
    if (d.ent_marche_id && MARCHE_TYPES.includes(ed.definition.type?.tyd_code)) {
      const ids = await api.commandesMarche(d.ent_id);
      if (!ids.length) { this.app.message(texte('document_btp.page.sources.toutes_reprises'), 'avertissement'); return; }
      if (!await confirmer(texte('document_btp.page.sources.confirmer', { nombre: ids.length }))) return;
      sources = ids;
    } else {
      const attente = await api.documentsEnAttente(d.ent_tyd_id, d.ent_tiers_id ?? null);
      sources = await choisirSources({ documents: attente, titre: texte('document_btp.page.sources.titre', { cible: ed.definition.type?.tyd_libelle ?? texte('document_btp.page.sources.le_document') }) });
      if (!sources?.length) return;
    }
    await api.ajouterSources(d.ent_id, sources);
    await this.chargerDocument(d.ent_id);
    this.app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [d.ent_id] });
    this.app.message(`${sources.length} document(s) repris`, 'succes');
  }

  async transformer() {
    const ed = this.editeur;
    const d = ed.saisie.document;
    if (this.modifiee) { this.app.message(texte('document_btp.page.enregistrer_avant_transformation'), 'avertissement'); return; }
    const cree = await transformerDocument({
      entId: d.ent_id, typeCode: ed.definition.type.tyd_code, numero: d.ent_numero, objet: d.ent_objet, types: this.types,
      definition: ed.definition, message: (t, n) => this.app.message(t, n),
    });
    if (!cree) return;
    this.app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [cree.ent_id], cree: true });
    this.app.message(texte('document_btp.page.cree', { type: cree.libelle, numero: cree.ent_numero ?? '' }), 'succes');
    // Le nouveau document s'ouvre comme une nouvelle page (le document d'origine reste dans l'historique).
    await this.app.naviguer(urlDocument(cree.ent_id));
  }

  /** Aide-mémoire des raccourcis des lignes (touches effectives, personnalisées comprises) et de la page. */
  aideRaccourcis() {
    basculerAideMemoire({
      titre: texte('document_btp.page.raccourcis_titre'),
      groupes: ['grille', 'document', 'application'],
      notes: ['saisir', 'echap', 'entree', 'tab', 'fleches', 'selection', 'glisser', 'colonne', 'clic_droit']
        .map((c) => [texte(`document_btp.page.raccourcis_notes.${c}_touche`), texte(`document_btp.page.raccourcis_notes.${c}`)]),
    });
  }

  fermer() {
    fermerAideMemoire();
    this.desabonnerEnvoi?.();
    this.desabonnerAttente?.();
    this.suivi?.fermer();
    this.liberer();
    document.removeEventListener('keydown', this.clavier);
    document.removeEventListener('pointerdown', this.fermerMenuActions, true);
    document.removeEventListener('keydown', this.fermerMenuActions, true);
    document.body.classList.remove('avec-document', 'lecture-seule');
  }
}
