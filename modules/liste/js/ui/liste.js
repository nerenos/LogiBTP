import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { ERREUR_LISTE } from '../src/codes.js';
import { echapper, lireNombre, creerCombo, ouvrirMenuContextuel, confirmer, lireStockage, ecrireStockage, declarerRaccourcis, actionDe, libelleRaccourci, densiteCompacte } from '@logibtp/socle/ui';
import { ModeleVue, normaliserDefinition, vraiDonnee, texteIndicateur, TOTAUX_COLONNE } from '../src/modele.js';
import { filtreActif, correspond, comparerValeurs, estNumerique } from '../src/filtres.js';
import { calculerLargeurs } from '../src/largeurs.js';
import { comptesSegment, agreger } from '../src/requete.js';
import { FormatsCellule, appliquerStyle, alignement } from './formats.js';
import { PanneauVues } from './panneau-vues.js';
import { ouvrirMenuFiltre, fermerMenuFiltre } from './menu-filtre.js';

// Fonctions de la liste qui acceptent un raccourci clavier (groupe liste, personnalisable : page des raccourcis de
// l'application). Lignes : la liste a le focus ; page (rechercher, créer, actualiser, mode saisie) : partout sauf dans
// un champ de saisie d'un autre écran.
declarerRaccourcis('liste', {
  libelle: texte('liste.raccourcis.groupe'),
  actions: {
    lignePrecedente: { libelle: texte('liste.raccourcis.ligne_precedente'), defaut: 'ArrowUp' },
    ligneSuivante: { libelle: texte('liste.raccourcis.ligne_suivante'), defaut: 'ArrowDown' },
    premiereLigne: { libelle: texte('liste.raccourcis.premiere_ligne'), defaut: 'Home' },
    derniereLigne: { libelle: texte('liste.raccourcis.derniere_ligne'), defaut: 'End' },
    etendreHaut: { libelle: texte('liste.raccourcis.etendre_haut'), defaut: 'Shift+ArrowUp' },
    etendreBas: { libelle: texte('liste.raccourcis.etendre_bas'), defaut: 'Shift+ArrowDown' },
    toutSelectionner: { libelle: texte('liste.raccourcis.tout_selectionner'), defaut: 'Ctrl+A' },
    ouvrir: { libelle: texte('liste.raccourcis.ouvrir'), defaut: 'Enter' },
    nouvelleFenetre: { libelle: texte('liste.raccourcis.nouvelle_fenetre'), defaut: ['Ctrl+Enter', 'Shift+Enter'] },
    consulter: { libelle: texte('liste.raccourcis.consulter'), defaut: [] },
    copier: { libelle: texte('liste.raccourcis.copier'), defaut: [] },
    supprimer: { libelle: texte('liste.raccourcis.supprimer'), defaut: 'Delete' },
    rechercher: { libelle: texte('liste.raccourcis.rechercher'), defaut: 'Ctrl+F' },
    creer: { libelle: texte('liste.raccourcis.creer'), defaut: 'Insert' },
    actualiser: { libelle: texte('liste.raccourcis.actualiser'), defaut: [] },
    saisie: { libelle: texte('liste.raccourcis.saisie'), defaut: [] },
  },
});
/** Fonctions de la page (hors focus de la liste). */
const ACTIONS_PAGE = new Set(['rechercher', 'creer', 'actualiser', 'saisie']);
/** Touches d'une action suivies des gestes de souris : « Entrée · double-clic ». */
const touchesMenu = (action, souris) => [libelleRaccourci(action, 'liste'), souris].filter(Boolean).join(' · ');
import { ConcepteurVue, libelleFiltreVue } from './concepteur.js';
import { GestionThemes } from './themes.js';

const LARGEUR_COIN = 30;
/** Taille du texte (px) pour laquelle les largeurs fixes des vues sont données (densité compacte). */
const TAILLE_REFERENCE = 13;
const DELAI_RECHERCHE = 350;
const DUREE_MARQUE = 4000;
/** Délai (ms) avant d'afficher l'écran de chargement d'une liste lente (premier lot d'un chargement). */
const DELAI_ATTENTE = 400;

/**
 * Liste de données (classe mère) : chargement par lots au défilement, recherche « contient » et segments
 * appliqués par la base, tri (lignes chargées ou toute la base), filtres de colonnes façon tableur sur les
 * lignes chargées, rafraîchissement ciblé et contrôle périodique des lignes ajoutées, modifiées ou supprimées.
 *
 * Options : fournisseur (FournisseurApi / FournisseurMemoire), contexte (vues proposées), ouvrir({ id, type, ligne, nouvelleFenetre }), surVue({ theme, vue }),
 * panneau({ vue, conteneur, liste }) : composant propre à la vue logé dans le panneau ancrable (arbres de filtres…),
 * message(texte, niveau), peutRequete (requête manuelle dans le concepteur), intervalleControle (ms, 0 = jamais),
 * formats (FormatsCellule ou dérivée), cleVue (clé localStorage des préférences d'affichage),
 * peutGererThemes (création et modification des thèmes, profil ADMIN), creation(vue) → { libelle, action } ou null
 * (bouton de création d'un élément, fourni par l'application selon la vue), actionsElements(vue) → { consulter(ligne, e),
 * copier(ligne), supprimer(lignes), autres: [{ code, libelle, icone, titre, max (1 par défaut), actif(lignes), action(lignes, e) }] } ou null (boutons sur la sélection : thème d'un seul type de fiche ou de documents),
 * actionsVue(vue) → [{ libelle, icone, titre, action(e) }] (boutons sur la vue entière : imprimer…), filtresVue(vue) → { colonne: [valeurs] | null }
 * (filtres externes propres à la vue, posés avant son premier chargement ; null retire le filtre de la colonne).
 *
 * Thèmes : les vues sont regroupées par thème (Devis, Factures, Salariés, Ressources…). Un thème déclare les
 * types d'élément qu'il couvre ; ses vues ne montrent que des lignes de ces types (aucun type = tous).
 */
export class ListeDonnees {
  constructor(racine, { fournisseur, contexte = null, ouvrir, message, peutRequete = false, peutGererThemes = false, intervalleControle = 30000, formats, cleVue, creation, surVue, panneau, glisser, filtresVue, actionsElements, actionsVue, groupeTheme, choix = false, themeFixe = null } = {}) {
    this.racine = racine;
    // Mode choix (I1, `choisirDansListe`) : ni concepteur, ni saisie, ni actions sur les éléments ; vues d'un seul thème.
    this.modeChoix = choix;
    this.themeFixe = themeFixe;
    // Regroupement des thèmes dans leur combo (l'application : menus du bandeau) : groupeTheme(theme) → { groupe, ordre } | null.
    this.groupeTheme = groupeTheme ?? null;
    // Lignes glissables vers une autre fenêtre : glisser({ ligne, definition }) → { type, valeur, texte, rang } | null ;
    // plusieurs lignes sélectionnées : tableau des valeurs, type de la ligne de plus haut rang.
    this.glisser = glisser ?? null;
    this.fournisseur = fournisseur;
    this.contexte = contexte;
    this.ouvrirExterne = ouvrir;
    // Thème ou vue changés (l'application reporte le choix dans l'URL de la page).
    this.surVue = surVue;
    // Panneau propre à une vue (arbres de familles…) et filtres qu'il pose sur des colonnes de la source.
    this.fabriquePanneau = panneau;
    this.panneauSpecifique = null;
    this.filtresExternes = new Map();
    this.filtreIndicateur = null; // code de l'indicateur cliqué : ses filtres s'ajoutent à la demande (L4)
    this.totauxBase = null;       // totaux de la base sur toute la sélection (L3)
    this.valeursIndicateurs = null;
    this.filtresVue = filtresVue ?? null;
    this.message = message ?? (() => {});
    this.peutRequete = peutRequete;
    this.peutGererThemes = peutGererThemes;
    this.creation = creation;
    this.fabriqueActions = actionsElements ?? null;
    this.fabriqueActionsVue = actionsVue ?? null;
    this.actionsElements = null;
    this.themes = [];
    this.debutExercice = null;
    this.theme = themeFixe;        // code du thème affiché, null = toutes les vues
    this.formats = formats ?? new FormatsCellule();
    this.cleVue = cleVue ?? `logibtp.liste.${contexte ?? 'toutes'}`;
    this.vues = [];
    this.vue = null;               // vue courante : { vli_id, vli_nom, …, definition }
    this.nonEnregistree = false;   // définition appliquée depuis le concepteur, pas encore enregistrée
    this.modele = new ModeleVue({});
    this.recherche = '';
    this.segments = new Map();     // colonne → Set de valeurs (texte brut, null = vide)
    this.triBase = null;           // [{ colonne, sens }] envoyé au serveur, null = tri de la vue
    this.triLocal = null;          // { code, sens } sur les lignes chargées
    this.modeTriBase = false;      // bouton « Trier toute la base »
    this.filtres = new Map();      // code → filtre de colonne (lignes chargées)
    this.lignes = [];              // lignes chargées, dans l'ordre du serveur
    this.suite = null;             // curseur du lot suivant, null = tout est chargé
    this.enCours = false;
    this.generation = 0;
    this.marques = new Map();      // id → 'nouvelle' | 'modifiee'
    this.selection = null;         // ligne courante (Entrée, ↑↓, saisie)
    this.selections = new Set();   // lignes sélectionnées (Ctrl+clic, Maj+clic, Maj+↑↓) : glisser plusieurs lignes
    this.ancre = null;
    this.#construire();
    if (intervalleControle > 0) {
      this.minuterie = setInterval(() => { if (this.visible()) this.verifier().catch(() => {}); }, intervalleControle);
      this.surFocus = () => { if (this.visible()) this.verifier().catch(() => {}); };
      window.addEventListener('focus', this.surFocus);
    }
  }

  detruire() {
    document.removeEventListener('keydown', this.clavierPage);
    this.panneauSpecifique?.detruire?.();
    clearInterval(this.minuterie);
    window.removeEventListener('focus', this.surFocus);
    this.observateur?.disconnect();
    this.redim?.disconnect();
    this.observateurDensite?.disconnect();
    clearTimeout(this.minuterieAttente);
  }

  visible() { return this.racine.offsetParent !== null && document.visibilityState === 'visible'; }

  get definition() { return this.modele.definition; }

  // ---------------------------------------------------------------- construction

  #construire() {
    const r = this.racine;
    r.classList.add('liste');
    r.classList.toggle('liste-mode-choix', this.modeChoix);
    r.innerHTML = `
      <div class="liste-principale">
      <div class="liste-barre">
        <button type="button" data-action="concevoir" title="${texteHtml('liste.liste.concevoir')}">${iconeHtml('liste_saisie')}</button>
        <span class="liste-groupe liste-groupe-recherche">
          <input type="search" class="liste-recherche" placeholder="${texteHtml('liste.liste.rechercher')}" title="${texteHtml('liste.liste.rechercher_aide')}">
          <span class="liste-filtres-vue" hidden></span>
          <span class="liste-compteur"></span>
        </span>
        <span class="liste-groupe liste-groupe-creer"><button type="button" data-action="creer" class="principal" hidden></button></span>
        <span class="liste-groupe liste-elements">
          <button type="button" data-element="consulter" class="bouton-icone" title="${texteHtml('liste.liste.consulter_aide')}" aria-label="${texteHtml('liste.liste.consulter')}" hidden>${iconeHtml('liste_consulter')}</button>
          <button type="button" data-element="copier" class="bouton-icone" title="${texteHtml('liste.liste.copier_aide')}" aria-label="${texteHtml('liste.liste.copier')}" hidden>${iconeHtml('liste_copier')}</button>
          <button type="button" data-element="supprimer" class="bouton-icone" title="${texteHtml('liste.liste.supprimer_aide')}" aria-label="${texteHtml('liste.liste.supprimer')}" hidden>${iconeHtml('supprimer')}</button>
          <span class="liste-elements-autres"></span>
        </span>
        <span class="liste-groupe liste-groupe-affichage">
          <button type="button" data-action="effacer" class="bouton-icone" title="${texteHtml('liste.liste.effacer_aide')}" aria-label="${texteHtml('liste.liste.effacer')}" disabled>${iconeHtml('liste_effacer')}</button>
          <button type="button" data-action="lignes" aria-pressed="false"></button>
          <button type="button" data-action="tout" aria-pressed="false">${iconeHtml('liste_tout')}</button>
          <button type="button" data-action="indicateurs" class="bouton-icone" aria-pressed="true" hidden>${iconeHtml('liste_indicateurs')}</button>
          <button type="button" data-action="rafraichir" title="${texteHtml('liste.liste.rafraichir')}">${iconeHtml('liste_rafraichir')}</button>
        </span>
        <span class="liste-groupe liste-groupe-hote">
        <span class="liste-actions-hote"></span>
        <button type="button" data-action="saisie" aria-pressed="false" hidden
          title="${texteHtml('liste.liste.saisie_aide')}">${iconeHtml('liste_saisie')} ${texteHtml('liste.liste.saisie')}</button>
        </span>
      </div>
      <p class="liste-erreurs" hidden></p>
      <div class="liste-indicateurs" hidden></div>
      <div class="liste-corps">
        <div class="liste-zone" tabindex="0">
          <table class="liste-table"><colgroup></colgroup><thead></thead><tbody></tbody></table>
          <div class="liste-suite"></div>
        </div>
        <div class="liste-separateur" title="${texteHtml('liste.liste.separateur')}"></div>
        <aside class="liste-panneau">
          <header>
            <span class="liste-panneau-titre">${texteHtml('liste.liste.segments')}</span>
            <button type="button" data-dock="gauche" title="${texteHtml('liste.liste.dock.gauche')}">${iconeHtml('liste_ancrer_gauche')}</button>
            <button type="button" data-dock="bas" title="${texteHtml('liste.liste.dock.bas')}">${iconeHtml('liste_ancrer_bas')}</button>
            <button type="button" data-dock="droite" title="${texteHtml('liste.liste.dock.droite')}">${iconeHtml('liste_ancrer_droite')}</button>
            <button type="button" data-action="reduire">${iconeHtml('liste_reduire')}</button>
          </header>
          <div class="liste-panneau-contenu">
            <div class="liste-panneau-specifique" hidden></div>
            <div class="liste-segments"></div>
          </div>
        </aside>
        <div class="liste-chargement" role="status" aria-live="polite" hidden>
          <span class="liste-chargement-roue" aria-hidden="true"></span><span>${texteHtml('liste.liste.chargement')}</span>
        </div>
      </div>
      </div>
      <div class="liste-separateur-vues" title="${texteHtml('liste.vues.separateur')}"></div>
      <aside class="liste-vues-panneau" aria-label="Vues"></aside>`;
    this.zone = r.querySelector('.liste-zone');
    this.corpsListe = r.querySelector('.liste-corps');
    this.prefs = this.#lirePreferences();
    this.modeTout = !!this.prefs.tout;
    r.querySelectorAll('[data-dock]').forEach((b) => b.addEventListener('click', () => {
      this.prefs.dock = b.dataset.dock;
      this.prefs.reduit = false;
      this.#ecrirePreferences();
      this.#appliquerDock();
    }));
    r.querySelector('.liste-panneau [data-action="reduire"]').addEventListener('click', () => this.#reduire(!this.prefs.reduit));
    this.#separateur(r.querySelector('.liste-separateur'));
    this.#appliquerDock();
    this.panneauVues = new PanneauVues({
      conteneur: r.querySelector('.liste-vues-panneau'), separateur: r.querySelector('.liste-separateur-vues'), liste: this,
      prefs: () => this.prefs, ecrire: () => this.#ecrirePreferences(),
    });
    this.table = r.querySelector('.liste-table');
    this.corps = this.table.tBodies[0];
    this.basSuite = r.querySelector('.liste-suite');
    r.querySelector('[data-action="concevoir"]').addEventListener('click', () => this.concevoir(false));
    r.querySelectorAll('[data-element]').forEach((b) => b.addEventListener('click', (e) => this.#actionElement(b.dataset.element, e).catch((x) => this.#erreur(x))));
    r.querySelector('[data-action="rafraichir"]').addEventListener('click', () => this.recharger());
    r.querySelector('[data-action="saisie"]').addEventListener('click', () => this.basculerSaisie());
    // Création : action directe, ou liste de choix (`choix` : [{ libelle, action }], plusieurs types).
    r.querySelector('[data-action="creer"]').addEventListener('click', (e) => {
      const c = this.actionCreation;
      if (c?.choix) ouvrirMenuContextuel({ target: e.currentTarget, preventDefault() {} }, c.choix.map((x) => ({ libelle: x.libelle, titre: x.titre, action: x.action })), { aide: false });
      else c?.action();
    });
    r.querySelector('[data-action="tout"]').addEventListener('click', () => this.basculerTout());
    r.querySelector('[data-action="indicateurs"]').addEventListener('click', () => this.basculerIndicateurs());
    // Densité compacte : ni bandeau d'indicateurs ni bouton ; suivie en direct (changement depuis le menu).
    this.compacte = densiteCompacte();
    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      this.observateurDensite = new MutationObserver(() => this.#surDensite());
      this.observateurDensite.observe(document.documentElement, { attributes: true, attributeFilter: ['data-densite'] });
    }
    r.querySelector('.liste-indicateurs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-indicateur]');
      if (b) this.choisirIndicateur(b.dataset.indicateur);
    });
    r.querySelector('[data-action="lignes"]').addEventListener('click', () => this.basculerLignes());
    r.querySelector('[data-action="effacer"]').addEventListener('click', () => {
      this.filtres.clear();
      this.triLocal = null;
      this.#rendreEntete();
      this.rendreCorps();
      this.#rendreSegments();
    });
    const recherche = r.querySelector('.liste-recherche');
    recherche.addEventListener('input', () => {
      clearTimeout(this.minuterieRecherche);
      this.minuterieRecherche = setTimeout(() => {
        this.recherche = recherche.value.trim();
        this.recharger();
        this.rafraichirSegments();
      }, DELAI_RECHERCHE);
    });
    this.corps.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const ctrl = e.ctrlKey || e.metaKey;
      // Ctrl ou Maj : sélection multiple (le second clic d'un double-clic ne rebascule pas la ligne).
      if (ctrl || e.shiftKey) {
        if (e.detail < 2) this.#selectionner(tr.dataset.id, { basculer: ctrl && !e.shiftKey, etendre: e.shiftKey });
        return;
      }
      this.#selectionner(tr.dataset.id);
      const td = e.target.closest('td.modifiable');
      if (td && !td.querySelector('.liste-editeur')) this.#commencerSaisie(tr.dataset.id, td.dataset.code);
    });
    this.corps.addEventListener('dragstart', (e) => {
      const tr = e.target.closest?.('tr[data-id]');
      const ligne = tr && this.lignes.find((l) => String(l._id) === tr.dataset.id);
      const g = ligne && this.glisser?.({ ligne, definition: this.definition });
      if (!g) { e.preventDefault(); return; }
      // Ligne glissée faisant partie de la sélection multiple : toutes les lignes sélectionnées, dans l'ordre affiché.
      let paquet = [g];
      if (this.selections.size > 1 && this.selections.has(tr.dataset.id)) {
        paquet = [...this.corps.rows].filter((x) => this.selections.has(x.dataset.id))
          .map((x) => this.lignes.find((l) => String(l._id) === x.dataset.id))
          .map((l) => l && this.glisser({ ligne: l, definition: this.definition })).filter(Boolean);
      } else this.#selectionner(tr.dataset.id);
      // Type annoncé : celui de la ligne de plus haut rang (le plus contraignant pour la cible du dépôt).
      const type = paquet.reduce((a, x) => ((x.rang ?? 0) > (a.rang ?? 0) ? x : a), paquet[0]).type;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(type, JSON.stringify(paquet.length > 1 ? paquet.map((x) => x.valeur) : g.valeur));
      e.dataTransfer.setData('text/plain', paquet.map((x) => x.texte ?? '').join('\n'));
    });
    this.corps.addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-id]');
      // En mode saisie, le double-clic sur une cellule modifiable ne doit pas ouvrir la fiche.
      if (tr && !e.target.closest('td.modifiable')) this.ouvrir(tr.dataset.id, e);
    });
    this.zone.addEventListener('keydown', (e) => this.#clavier(e));
    this.clavierPage = (e) => this.#clavierPage(e);
    document.addEventListener('keydown', this.clavierPage);
    // Clic droit : menu court des actions sur la sélection, avec leurs raccourcis (aide-mémoire) ; tout reste accessible sans.
    this.corps.addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr || (this.modeSaisie && e.target.closest('td.modifiable'))) return;
      if (!this.lignesSelectionnees().some((l) => String(l._id) === tr.dataset.id)) this.#selectionner(tr.dataset.id);
      this.#menuLigne(e, tr.dataset.id);
    });
    this.observateur = new IntersectionObserver((entrees) => {
      if (entrees.some((x) => x.isIntersecting)) this.chargerSuite().catch((x) => this.#erreur(x));
    }, { root: this.zone, rootMargin: '300px' });
    this.observateur.observe(this.basSuite);
    this.redim = new ResizeObserver(() => this.#largeurs());
    this.redim.observe(this.zone);
  }

  #erreur(e) {
    console.error(e);
    this.message(e.message ?? String(e), 'erreur');
  }

  // ---------------------------------------------------------------- vues

  /** Charge les thèmes et les vues, puis ouvre la vue demandée, la dernière utilisée du thème ou la première. */
  async demarrer(vueId = null) {
    // Début de l'exercice comptable de la société (périodes « exercice » du filtre de colonne) ; absent : année civile.
    this.debutExercice = (await this.fournisseur.contexteSociete?.().catch(() => null))?.debut_exercice ?? null;
    await this.chargerThemes();
    if (this.theme === null && this.prefs.theme && this.themes.some((t) => t.thl_code === this.prefs.theme)) this.theme = this.prefs.theme;
    this.#afficherTheme();
    await this.chargerVues();
    await this.#ouvrirDansTheme(vueId);
  }

  async chargerThemes() {
    this.themes = await this.fournisseur.themes?.() ?? [];
    if (this.theme && !this.themes.some((t) => t.thl_code === this.theme)) this.theme = null;
    // Thèmes et vues dans le panneau des vues (L1), regroupés comme les menus de l'application quand elle le demande.
    await this.panneauVues.rafraichir();
  }

  /** Thème courant marqué dans le panneau des vues. */
  #afficherTheme() { this.panneauVues?.rendre(); }

  /** Ouvre une vue d'un thème (panneau des vues) : le thème devient le thème courant. */
  async ouvrirVueDuTheme(theme, id) {
    if (theme !== this.theme) {
      this.theme = theme;
      this.prefs.theme = theme;
      this.#ecrirePreferences();
      await this.chargerVues();
    }
    await this.ouvrirVue(id);
  }

  /** Change de thème : vues du thème, puis sa vue par défaut (★ de l'utilisateur, de l'administrateur, première). */
  async choisirTheme(code) {
    this.theme = code;
    this.prefs.theme = code;
    this.#ecrirePreferences();
    this.#afficherTheme();
    await this.chargerVues();
    await this.#ouvrirDansTheme(null);
  }

  async #ouvrirDansTheme(vueId) {
    let id = vueId ?? this.panneauVues.vueParDefaut(this.theme, this.vues);
    if (!this.vues.some((v) => v.vli_id === id)) id = this.panneauVues.vueParDefaut(this.theme, this.vues);
    if (id !== null) { await this.ouvrirVue(id); return; }
    // Thème sans vue : liste vide, le concepteur (＋) en crée une.
    this.vue = null;
    this.appliquerVue({ vli_id: null, vli_nom: '', definition: { theme: this.theme } }, { nonEnregistree: false, vide: true });
    this.message(texte('liste.liste.theme_sans_vue', { icone: icone('ajouter') }));
    this.surVue?.({ theme: this.theme, vue: null });
  }

  gererThemes() {
    new GestionThemes({
      fournisseur: this.fournisseur,
      message: this.message,
      fermer: async () => {
        await this.chargerThemes();
        await this.chargerVues();
        if (!this.vues.some((v) => v.vli_id === this.vue?.vli_id)) await this.#ouvrirDansTheme(null);
      },
    });
  }

  async chargerVues() {
    this.vues = await this.fournisseur.vues(this.contexte, this.theme);
    await this.panneauVues.rafraichir();
  }

  async ouvrirVue(id) {
    const vue = await this.fournisseur.vue(id);
    try { localStorage.setItem(this.cleVue, String(id)); } catch { /* préférence non conservée */ }
    this.#ecrirePreferences();
    this.appliquerVue(vue, { nonEnregistree: false });
    this.panneauVues.rendre();
    this.surVue?.({ theme: this.theme, vue: id });
  }

  /** Applique une vue (enregistrée ou issue du concepteur) : en-têtes, segments, rechargement. */
  appliquerVue(vue, { nonEnregistree = false, vide = false } = {}) {
    this.vue = vide ? null : { ...vue, definition: normaliserDefinition(vue.definition) };
    this.nonEnregistree = nonEnregistree;
    this.modele = new ModeleVue(vue.definition);
    const codes = new Set(this.modele.colonnes.map((c) => c.code));
    for (const k of [...this.filtres.keys()]) if (!codes.has(k)) this.filtres.delete(k);
    const segs = new Set(this.definition.segments.map((s) => s.colonne));
    for (const k of [...this.segments.keys()]) if (!segs.has(k)) this.segments.delete(k);
    this.#creerPanneauSpecifique();
    // Filtres externes propres à la vue (application) : posés après le panneau (qui vide les filtres), avant le chargement.
    for (const [col, valeurs] of Object.entries(this.filtresVue?.(vide ? null : vue) ?? {})) {
      if (valeurs?.length) this.filtresExternes.set(col, [...valeurs]); else this.filtresExternes.delete(col);
    }
    this.triBase = null;
    this.triLocal = null;
    this.filtreIndicateur = null;
    this.#appliquerIndicateurs();
    const erreurs = [...this.modele.erreurs].map(([code, m]) => texte('liste.liste.erreur_colonne', { colonne: this.modele.parCode.get(code)?.titre ?? code, message: m }));
    const zoneErreurs = this.racine.querySelector('.liste-erreurs');
    zoneErreurs.hidden = !erreurs.length;
    zoneErreurs.textContent = erreurs.join(' · ');
    this.#appliquerLignes();
    this.#colonnesModifiables().catch(() => {});
    this.actionCreation = this.vue ? this.creation?.(this.vue) ?? null : null;
    const creer = this.racine.querySelector('[data-action="creer"]');
    creer.hidden = !this.actionCreation;
    creer.textContent = this.actionCreation?.libelle ?? '';
    creer.title = this.actionCreation ? this.actionCreation.titre ?? texte('liste.liste.creer', { libelle: this.actionCreation.libelle.replace(icone('ajouter'), '').replace(icone('liste_creer_choix'), '').trim() }) : '';
    this.actionsElements = this.vue ? this.fabriqueActions?.(this.vue) ?? null : null;
    // Actions supplémentaires de l'application (transformer…) : un bouton chacune.
    const autres = this.racine.querySelector('.liste-elements-autres');
    autres.innerHTML = (this.actionsElements?.autres ?? []).map((x, i) => `<button type="button" data-autre="${i}"${x.icone ? ' class="bouton-icone"' : ''} title="${echapper(x.icone ? [x.libelle, x.titre].filter(Boolean).join(' — ') : x.titre ?? '')}" aria-label="${echapper(x.libelle)}">${echapper(x.icone ?? x.libelle)}</button>`).join('');
    autres.querySelectorAll('[data-autre]').forEach((b) => b.addEventListener('click', (e) => {
      const x = this.actionsElements?.autres?.[Number(b.dataset.autre)];
      if (x) Promise.resolve(x.action(this.lignesSelectionnees(), e)).catch((err) => this.#erreur(err));
    }));
    this.#majActionsElements();
    // Actions de l'application sur la vue entière (imprimer…), indépendantes de la sélection.
    const hote = this.racine.querySelector('.liste-actions-hote');
    const actionsVue = this.vue ? this.fabriqueActionsVue?.(this.vue) ?? [] : [];
    hote.innerHTML = actionsVue.map((x, i) => `<button type="button" data-vue-action="${i}"${x.icone ? ' class="bouton-icone"' : ''} title="${echapper([x.libelle, x.titre].filter(Boolean).join(' — '))}" aria-label="${echapper(x.libelle)}">${echapper(x.icone ?? x.libelle)}</button>`).join('');
    hote.querySelectorAll('[data-vue-action]').forEach((b) => b.addEventListener('click', (e) => {
      Promise.resolve(actionsVue[Number(b.dataset.vueAction)].action(e)).catch((err) => this.#erreur(err));
    }));
    // Rappel des filtres fixes de la vue (appliqués par la base).
    const fv = this.racine.querySelector('.liste-filtres-vue');
    const libelles = this.definition.filtres.map((f) => libelleFiltreVue(f, this.modele.parCode.get(f.colonne)?.titre?.replace(/\s*\n\s*/g, ' ') ?? f.colonne));
    fv.hidden = !libelles.length;
    fv.textContent = `${icone('liste_filtre_vue')} ${libelles.length === 1 ? libelles[0] : texte('liste.liste.filtres_vue', { nombre: libelles.length })}`;
    fv.title = texte('liste.liste.filtres_vue_aide', { liste: libelles.join('\n') });
    this.#rendreEntete();
    this.recharger();
    this.rafraichirSegments();
  }

  concevoir(nouvelle) {
    fermerMenuFiltre();
    const base = nouvelle || !this.vue
      ? { vli_id: null, vli_nom: texte('liste.liste.nouvelle_vue'), vli_contexte: this.contexte, vli_partage: 'P', vli_groupe: null,
        definition: { ...(nouvelle && this.vue ? structuredClone(this.vue.definition) : normaliserDefinition({})), theme: this.theme } }
      : structuredClone(this.vue);
    this.concepteur = new ConcepteurVue({
      fournisseur: this.fournisseur,
      vue: base,
      peutRequete: this.peutRequete,
      themes: this.themes,
      largeursAjustees: { ...this.#largeursAjustees() },
      ordreAjuste: this.prefs.ordres?.[this.#cleLargeurs()] ?? null,
      oublierLargeurs: () => {
        delete this.prefs.colonnes?.[this.#cleLargeurs()];
        delete this.prefs.ordres?.[this.#cleLargeurs()];
        this.#ecrirePreferences();
      },
      appliquer: (v) => this.appliquerVue(v, { nonEnregistree: true }),
      enregistrer: async (v) => {
        const enregistree = await this.fournisseur.enregistrerVue(v);
        // Vue rangée dans un autre thème : on suit la vue.
        const theme = enregistree.definition?.theme ?? null;
        if (this.theme !== null && theme !== this.theme) {
          this.theme = theme;
          this.prefs.theme = theme;
          this.#afficherTheme();
        }
        await this.chargerVues();
        try { localStorage.setItem(this.cleVue, String(enregistree.vli_id)); } catch { /* préférence non conservée */ }
        this.appliquerVue(enregistree, { nonEnregistree: false });
        this.panneauVues.rendre();
        this.message(texte('liste.liste.vue_enregistree', { nom: enregistree.vli_nom }), 'succes');
        return enregistree;
      },
      supprimer: async (v) => {
        await this.fournisseur.supprimerVue(v.vli_id);
        this.vue = null;
        await this.chargerVues();
        await this.#ouvrirDansTheme(null);
        this.message(texte('liste.liste.vue_supprimee', { nom: v.vli_nom }), 'succes');
      },
      message: this.message,
    });
  }

  /** Panneau propre à la vue (option panneau) : recréé à chaque vue appliquée ; ses filtres repartent de zéro. */
  #creerPanneauSpecifique() {
    this.panneauSpecifique?.detruire?.();
    this.panneauSpecifique = null;
    this.filtresExternes.clear();
    const zone = this.racine.querySelector('.liste-panneau-specifique');
    zone.replaceChildren();
    this.panneauSpecifique = this.vue && this.fabriquePanneau ? this.fabriquePanneau({ vue: this.vue, conteneur: zone, liste: this }) : null;
    zone.hidden = !this.panneauSpecifique;
    this.racine.querySelector('.liste-panneau-titre').textContent = texte(this.panneauSpecifique ? 'liste.liste.filtres' : 'liste.liste.segments');
  }

  /**
   * Filtre posé par le panneau propre à la vue : valeurs retenues d'une colonne de la source (null = vide), appliqué par
   * la base comme un segment ; valeurs null ou vides : filtre retiré.
   */
  definirFiltreExterne(colonne, valeurs, { recharger = true } = {}) {
    if (valeurs?.length) this.filtresExternes.set(colonne, [...valeurs]);
    else this.filtresExternes.delete(colonne);
    if (recharger) { this.recharger(); this.rafraichirSegments().catch(() => {}); }
  }

  // ---------------------------------------------------------------- demandes au fournisseur

  demande() {
    const segments = {};
    for (const [col, valeurs] of this.filtresExternes) segments[col] = [...valeurs];
    for (const [col, valeurs] of this.segments) if (valeurs.size) segments[col] = [...valeurs];
    return {
      vue_id: this.vue?.vli_id ?? null,
      definition: this.nonEnregistree || !this.vue?.vli_id ? this.definition : null,
      recherche: this.recherche,
      segments,
      filtres: this.#indicateurs().find((i) => i.code === this.filtreIndicateur)?.filtres ?? [],
      tri: this.triBase ?? this.definition.tri,
    };
  }

  /** Recharge la liste depuis le début (recherche, segments ou tri de la base modifiés). */
  recharger() {
    this.generation++;
    this.lignes = [];
    this.suite = null;
    this.fin = false;
    this.enCours = false;
    this.marques.clear();
    this.totauxBase = null;
    this.#attente(false);
    this.rendreCorps();
    if (!this.vue) return;
    this.chargerAgregats();
    this.chargerSuite().catch((e) => this.#erreur(e));
  }

  /**
   * Charge le lot suivant, puis enchaîne les lots tant que « Charger toutes les lignes » est actif ou que la
   * zone visible n'est pas encore remplie. Un rechargement (filtre, tri) interrompt la boucle en cours.
   */
  async chargerSuite() {
    if (!this.vue || this.enCours || this.fin) return;
    const gen = this.generation;
    do {
      await this.#chargerLot(gen);
    } while (gen === this.generation && !this.fin && !this.enCours && (this.modeTout || this.#zoneARemplir()));
  }

  #zoneARemplir() {
    return this.zone.clientHeight > 0 && this.zone.scrollHeight <= this.zone.clientHeight + 300;
  }

  async #chargerLot(gen) {
    this.enCours = true;
    this.#rendreSuite();
    // Premier lot (ouverture, filtre, tri) : écran de chargement s'il tarde ; les lots suivants gardent l'indication du bas.
    if (!this.lignes.length) {
      clearTimeout(this.minuterieAttente);
      this.minuterieAttente = setTimeout(() => { if (gen === this.generation && this.enCours) this.#attente(true); }, DELAI_ATTENTE);
    }
    try {
      const r = await this.fournisseur.lot({ ...this.demande(), apres: this.suite, taille: this.definition.taille_lot });
      if (gen !== this.generation) return;
      this.lignes.push(...r.lignes);
      this.suite = r.suite;
      this.fin = !r.suite;
      this.#ajouterAuCorps(r.lignes);
      if (this.#filtresColonnesActifs()) this.#rendreSegments();
    } finally {
      if (gen === this.generation) {
        this.enCours = false;
        this.#attente(false);
        this.#rendreSuite();
      }
    }
  }

  /** Écran de chargement sur le corps de la liste (minuterie arrêtée au masquage). */
  #attente(visible) {
    if (!visible) clearTimeout(this.minuterieAttente);
    const e = this.racine.querySelector('.liste-chargement');
    if (e) e.hidden = !visible;
  }

  /**
   * Affichage des lignes : sur une seule ligne ou multiligne. Par défaut celui de la vue ; le bouton le force
   * pour cet utilisateur (préférence du navigateur, par vue).
   */
  get affichageLignes() {
    return this.prefs.lignes?.[String(this.vue?.vli_id ?? 'nouvelle')] ?? this.definition.lignes;
  }

  basculerLignes() {
    const suivant = this.affichageLignes === 'simple' ? 'multi' : 'simple';
    const cle = String(this.vue?.vli_id ?? 'nouvelle');
    this.prefs.lignes = { ...this.prefs.lignes, [cle]: suivant };
    if (suivant === this.definition.lignes) delete this.prefs.lignes[cle];
    this.#ecrirePreferences();
    this.#appliquerLignes();
    this.rendreCorps();
  }

  #appliquerLignes() {
    const simple = this.affichageLignes === 'simple';
    this.racine.classList.toggle('liste-simple', simple);
    const b = this.racine.querySelector('[data-action="lignes"]');
    b.textContent = icone(simple ? 'liste_lignes_entieres' : 'liste_lignes_simples');
    b.classList.toggle('actif', !!this.prefs.lignes?.[String(this.vue?.vli_id ?? 'nouvelle')]);
    b.setAttribute('aria-pressed', String(simple));
    b.title = texte(simple ? 'liste.liste.lignes_multi' : 'liste.liste.lignes_simple');
  }

  /** Interrupteur « Charger toutes les lignes » : conservé lors des rechargements (filtres, segments, tri). */
  basculerTout(actif = !this.modeTout) {
    this.modeTout = actif;
    this.#ecrirePreferences();
    this.#appliquerDock();
    if (actif) this.chargerSuite().catch((e) => this.#erreur(e));
  }

  /**
   * Contrôle des lignes chargées : lignes ajoutées, modifiées (empreinte) ou sorties du filtre depuis le
   * chargement, jusqu'au curseur du dernier lot. Les lignes concernées sont relues, l'ordre est celui de la base.
   */
  async verifier() {
    if (!this.vue || this.enCours) return null;
    const gen = this.generation;
    const etat = await this.fournisseur.controle(this.demande(), this.fin ? null : this.suite);
    if (gen !== this.generation) return null;
    const connues = new Map(this.lignes.map((l) => [String(l._id), l]));
    const presents = new Set(etat.map((x) => String(x.id)));
    const aLire = etat.filter((x) => connues.get(String(x.id))?._h !== x.h).map((x) => String(x.id));
    const supprimees = this.lignes.filter((l) => !presents.has(String(l._id))).length;
    if (!aLire.length && !supprimees) return { ajoutees: 0, modifiees: 0, supprimees: 0 };
    const relues = new Map();
    for (let i = 0; i < aLire.length; i += 500) {
      for (const l of await this.fournisseur.lignes(this.demande(), aLire.slice(i, i + 500))) relues.set(String(l._id), l);
    }
    if (gen !== this.generation) return null;
    let ajoutees = 0, modifiees = 0;
    for (const id of relues.keys()) {
      this.marques.set(id, connues.has(id) ? 'modifiee' : 'nouvelle');
      if (connues.has(id)) modifiees++; else ajoutees++;
    }
    this.lignes = etat.map((x) => relues.get(String(x.id)) ?? connues.get(String(x.id))).filter(Boolean);
    this.rendreCorps();
    this.chargerAgregats();
    this.#effacerMarques();
    return { ajoutees, modifiees, supprimees };
  }

  /** Rafraîchissement ciblé après une modification connue (enregistrement d'une fiche…). */
  async rafraichirLignes(ids) {
    if (!this.vue || !ids.length) return;
    const voulus = ids.map(String);
    const relues = new Map((await this.fournisseur.lignes(this.demande(), voulus)).map((l) => [String(l._id), l]));
    let inconnue = false;
    for (const id of voulus) {
      const i = this.lignes.findIndex((l) => String(l._id) === id);
      if (i < 0) { inconnue ||= relues.has(id); continue; }
      if (relues.has(id)) { this.lignes[i] = relues.get(id); this.marques.set(id, 'modifiee'); }
      else this.lignes.splice(i, 1);
    }
    this.rendreCorps();
    this.chargerAgregats();
    this.#effacerMarques();
    // Ligne nouvelle ou déplacée par le tri : sa place est donnée par le contrôle complet.
    if (inconnue) await this.verifier();
  }

  #effacerMarques() {
    clearTimeout(this.minuterieMarques);
    this.minuterieMarques = setTimeout(() => {
      this.marques.clear();
      this.corps.querySelectorAll('tr.nouvelle, tr.modifiee').forEach((tr) => tr.classList.remove('nouvelle', 'modifiee'));
    }, DUREE_MARQUE);
  }

  // ---------------------------------------------------------------- disposition (panneau des segments)

  #lirePreferences() {
    const defaut = { dock: 'droite', largeur: 260, hauteur: 160, reduit: false, tout: false };
    const p = { ...defaut, ...lireStockage(`${this.cleVue}.affichage`, {}) };
    if (!['gauche', 'droite', 'bas'].includes(p.dock)) p.dock = 'droite';
    return p;
  }

  #ecrirePreferences() {
    ecrireStockage(`${this.cleVue}.affichage`, { ...this.prefs, tout: !!this.modeTout });
  }

  #appliquerDock() {
    const c = this.corpsListe;
    for (const pos of ['gauche', 'droite', 'bas']) c.classList.toggle(`dock-${pos}`, this.prefs.dock === pos);
    c.classList.toggle('dock-reduit', !!this.prefs.reduit);
    c.style.setProperty('--panneau-largeur', `${this.prefs.largeur}px`);
    c.style.setProperty('--panneau-hauteur', `${this.prefs.hauteur}px`);
    this.racine.querySelectorAll('[data-dock]').forEach((b) => b.classList.toggle('actif', b.dataset.dock === this.prefs.dock));
    const b = this.racine.querySelector('.liste-panneau [data-action="reduire"]');
    b.textContent = icone(this.prefs.reduit ? 'liste_agrandir' : 'liste_reduire');
    b.title = texte(this.prefs.reduit ? 'liste.liste.panneau_agrandir' : 'liste.liste.panneau_reduire');
    const t = this.racine.querySelector('[data-action="tout"]');
    t.classList.toggle('actif', !!this.modeTout);
    t.setAttribute('aria-pressed', String(!!this.modeTout));
    t.title = texte(this.modeTout ? 'liste.liste.tout_actif' : 'liste.liste.tout');
  }

  #reduire(reduit) {
    this.prefs.reduit = reduit;
    this.#ecrirePreferences();
    this.#appliquerDock();
  }

  /** Redimensionnement du panneau par glisser : largeur à gauche ou à droite, hauteur en bas. */
  #separateur(sep) {
    sep.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sep.setPointerCapture(e.pointerId);
      if (this.prefs.reduit) this.#reduire(false);
      const rect = this.corpsListe.getBoundingClientRect();
      const bouger = (ev) => {
        const p = this.prefs;
        if (p.dock === 'bas') p.hauteur = Math.round(Math.min(Math.max(rect.bottom - ev.clientY, 60), rect.height * 0.7));
        else if (p.dock === 'droite') p.largeur = Math.round(Math.min(Math.max(rect.right - ev.clientX, 160), rect.width * 0.6));
        else p.largeur = Math.round(Math.min(Math.max(ev.clientX - rect.left, 160), rect.width * 0.6));
        this.#appliquerDock();
      };
      const finir = () => {
        sep.removeEventListener('pointermove', bouger);
        sep.removeEventListener('pointerup', finir);
        sep.removeEventListener('pointercancel', finir);
        this.#ecrirePreferences();
      };
      sep.addEventListener('pointermove', bouger);
      sep.addEventListener('pointerup', finir);
      sep.addEventListener('pointercancel', finir);
    });
    sep.addEventListener('dblclick', () => this.#reduire(!this.prefs.reduit));
  }

  // ---------------------------------------------------------------- segments

  async rafraichirSegments() {
    const zone = this.racine.querySelector('.liste-segments');
    const segs = this.definition.segments;
    this.corpsListe.classList.toggle('sans-segments', !segs.length && !this.panneauSpecifique);
    this.panneauSpecifique?.rafraichir?.();
    if (!segs.length || !this.vue) { zone.replaceChildren(); return; }
    const gen = this.generation;
    const comptes = await Promise.all(segs.map((s) => this.fournisseur.segments(this.demande(), s.colonne).catch(() => [])));
    if (gen !== this.generation) return;
    this.comptesBase = comptes;
    this.#rendreSegments();
  }

  /**
   * Comptes affichés d'un segment. Sans filtre de colonne : ceux de la base (recherche, filtres de la vue, autres
   * segments). Avec un filtre de colonne (appliqué aux lignes chargées) : comptés sur les lignes chargées qui le
   * respectent ; dans un segment déjà filtré, les valeurs non retenues (lignes non chargées) gardent le compte de la
   * base, marqué « hors filtres de colonnes ».
   */
  #comptesSegment(s, base) {
    if (!this.#filtresColonnesActifs()) return { comptes: base, partiel: false };
    const lignes = this.lignesAffichees();
    if (lignes.length && !(s.colonne in lignes[0]) && !(s.colonne in (this.lignes[0] ?? {}))) return { comptes: base, partiel: false };
    const locaux = comptesSegment(lignes, s.colonne);
    const actives = this.segments.get(s.colonne);
    const comptes = locaux.map((c) => ({ ...c }));
    if (actives?.size) {
      for (const c of base) if (!actives.has(c.valeur) && !comptes.some((x) => x.valeur === c.valeur)) comptes.push({ ...c, horsFiltre: true });
    }
    return { comptes, partiel: !this.fin };
  }

  #filtresColonnesActifs() { return [...this.filtres.values()].some(filtreActif); }

  /** Rendu des segments à partir des derniers comptes de la base (rappelé quand les filtres de colonnes changent). */
  #rendreSegments() {
    const zone = this.racine.querySelector('.liste-segments');
    const segs = this.definition.segments;
    if (!segs.length || !this.vue || !this.comptesBase) return;
    const calcules = segs.map((s, i) => this.#comptesSegment(s, this.comptesBase[i] ?? []));
    const comptes = calcules.map((c) => c.comptes);
    const reduits = this.#segmentsReduits();
    zone.innerHTML = segs.map((s, i) => {
      const col = this.modele.parCode.get(s.colonne);
      const actives = this.segments.get(s.colonne) ?? new Set();
      const titre = s.titre || col?.titre || s.colonne;
      const reduit = reduits.has(s.colonne);
      // Titre : replie / déplie le segment ; réduit, il indique le nombre de valeurs filtrées.
      return `<div class="segment${reduit ? ' reduit' : ''}" data-segment="${echapper(s.colonne)}">
        <button type="button" class="segment-titre" data-replier aria-expanded="${!reduit}"
          title="${texteHtml(reduit ? 'liste.liste.segment_deplier' : 'liste.liste.segment_reduire')}"><span class="segment-chevron">${iconeHtml(reduit ? 'liste_segment_replie' : 'liste_segment_deplie')}</span>${echapper(titre.replace(/\n/g, ' '))}${actives.size ? ` <small class="segment-filtre">(${actives.size})</small>` : ''}</button>
        <span class="segment-valeurs"${reduit ? ' hidden' : ''}><button type="button" data-tout class="${actives.size ? '' : 'actif'}">${texteHtml('liste.liste.segment_tous')}</button>
        ${comptes[i].map((c) => {
          const libelle = c.valeur === null ? texte('liste.liste.vide') : col ? this.modele.texte(c.valeur, col) || c.valeur : c.valeur;
          const bulle = c.horsFiltre ? texte('liste.liste.segment_hors_filtre', { libelle })
            : calcules[i].partiel ? texte('liste.liste.segment_partiel', { libelle }) : libelle;
          return `<button type="button" data-valeur="${c.valeur === null ? '' : echapper(c.valeur)}" data-vide="${c.valeur === null}"
            class="${actives.has(c.valeur) ? 'actif' : ''}${c.horsFiltre ? ' hors-filtre' : ''}" title="${echapper(bulle)}">${this.#imageSegment(col, c.valeur)}${echapper(libelle)} <small>${c.nombre}${calcules[i].partiel && !c.horsFiltre ? '+' : ''}</small></button>`;
        }).join('')}
        ${[...actives].filter((v) => !comptes[i].some((c) => c.valeur === v)).map((v) =>
          `<button type="button" class="actif" data-valeur="${echapper(v ?? '')}" data-vide="${v === null}">${echapper(v ?? texte('liste.liste.vide'))} <small>0</small></button>`).join('')}
      </span></div>`;
    }).join('');
    zone.querySelectorAll('[data-segment]').forEach((div) => {
      const col = div.dataset.segment;
      div.querySelector('[data-replier]').addEventListener('click', () => this.#replierSegment(div, col));
      div.querySelector('[data-tout]').addEventListener('click', () => { this.segments.delete(col); this.#segmentsModifies(); });
      div.querySelectorAll('[data-valeur]').forEach((b) => b.addEventListener('click', (e) => {
        const v = b.dataset.vide === 'true' ? null : b.dataset.valeur;
        const actives = new Set(this.segments.get(col) ?? []);
        // Clic : sélection unique ; Ctrl/Maj + clic : sélection multiple.
        if (e.ctrlKey || e.metaKey || e.shiftKey) { if (actives.has(v)) actives.delete(v); else actives.add(v); }
        else if (actives.size === 1 && actives.has(v)) actives.clear();
        else { actives.clear(); actives.add(v); }
        this.segments.set(col, actives);
        this.#segmentsModifies();
      }));
    });
  }

  /** Segments réduits de la vue courante (préférence du navigateur ; par défaut, tous dépliés). */
  #segmentsReduits() {
    return new Set(this.prefs.segmentsReduits?.[String(this.vue?.vli_id ?? 'nouvelle')] ?? []);
  }

  /** Replie ou déplie un segment et mémorise le choix pour la vue (sans recharger la liste). */
  #replierSegment(div, col) {
    const cle = String(this.vue?.vli_id ?? 'nouvelle');
    const reduits = this.#segmentsReduits();
    const reduit = !reduits.has(col);
    if (reduit) reduits.add(col);
    else reduits.delete(col);
    this.prefs.segmentsReduits = { ...this.prefs.segmentsReduits, [cle]: [...reduits] };
    if (!reduits.size) delete this.prefs.segmentsReduits[cle];
    this.#ecrirePreferences();
    div.classList.toggle('reduit', reduit);
    div.querySelector('.segment-valeurs').hidden = reduit;
    const b = div.querySelector('[data-replier]');
    b.setAttribute('aria-expanded', String(!reduit));
    b.title = texte(reduit ? 'liste.liste.segment_deplier' : 'liste.liste.segment_reduire');
    b.querySelector('.segment-chevron').textContent = icone(reduit ? 'liste_segment_replie' : 'liste_segment_deplie');
  }

  /** Image associée à une valeur de segment : image ou picto de l'option de la colonne, case pour un oui / non. */
  #imageSegment(col, valeur) {
    if (!col || valeur === null) return '';
    const o = (col.options ?? []).find((x) => String(x.valeur) === String(valeur));
    if (o?.image) return `<img class="segment-image" src="${echapper(o.image)}" alt="">`;
    if (o?.picto) return `<span class="segment-picto">${echapper(o.picto)}</span>`;
    if (col.format === 'pastille') return `<span class="segment-teinte teinte-${echapper(o?.teinte || 'neutre')}"></span>`;
    if (col.format === 'coche') return `<span class="segment-picto">${iconeHtml(String(valeur) === 'true' ? 'liste_coche' : 'liste_decoche')}</span>`;
    return '';
  }

  #segmentsModifies() {
    this.recharger();
    this.rafraichirSegments();
  }

  // ---------------------------------------------------------------- en-têtes, tri, filtres

  #rendreEntete() {
    const visibles = this.#visibles();
    const thead = this.table.tHead;
    const tr = document.createElement('tr');
    const coin = document.createElement('th');
    coin.className = 'liste-coin';
    coin.innerHTML = `<button type="button" class="${this.modeTriBase ? 'actif' : ''}" title="${texteHtml(this.modeTriBase ? 'liste.liste.tri_base_actif' : 'liste.liste.tri_base')}">${iconeHtml('liste_tri_base')}</button>`;
    coin.querySelector('button').addEventListener('click', () => {
      this.modeTriBase = !this.modeTriBase;
      this.#rendreEntete();
      this.message(texte(this.modeTriBase ? 'liste.liste.tri_sur_base' : 'liste.liste.tri_sur_chargees'));
    });
    tr.append(coin);
    for (const c of visibles) {
      const th = document.createElement('th');
      th.dataset.code = c.code;
      th.className = `aligne-${alignement(c)}`;
      if (c.bulle) th.title = c.bulle;
      const triB = (this.triBase ?? []).find((t) => t.colonne === c.code);
      const triL = this.triLocal?.code === c.code ? this.triLocal : null;
      const sens = triL?.sens ?? triB?.sens ?? null;
      const actif = filtreActif(this.filtres.get(c.code));
      th.innerHTML = `<div class="liste-th">
        <span class="liste-th-titre">${echapper(c.titre ?? c.code)}</span>
        <span class="liste-poignee" title="${texteHtml('liste.liste.poignee')}"></span>
        <span class="liste-th-boutons">
          <button type="button" data-tri class="${sens ? 'actif' : ''} ${triB ? 'base' : ''}" title="${texteHtml(triB ? 'liste.liste.trie_base' : triL ? 'liste.liste.trie_chargees' : 'liste.liste.trier')}">${iconeHtml(sens === 'asc' ? 'liste_tri_asc' : sens === 'desc' ? 'liste_tri_desc' : 'liste_trier')}</button>
          <button type="button" data-filtre class="${actif ? 'actif' : ''}" title="${texteHtml('liste.liste.filtrer')}">${iconeHtml(actif ? 'liste_filtre_actif' : 'liste_filtre')}</button>
        </span></div>`;
      th.querySelector('[data-tri]').addEventListener('click', () => this.#clicTri(c, sens));
      th.querySelector('[data-filtre]').addEventListener('click', (e) => this.#menu(c, e.currentTarget));
      this.#poignee(th.querySelector('.liste-poignee'), c.code);
      this.#deplacement(th, c.code);
      tr.append(th);
    }
    thead.replaceChildren(tr);
    const filtres = [...this.filtres.values()].some(filtreActif);
    this.racine.querySelector('[data-action="effacer"]').disabled = !filtres && !this.triLocal;
    this.#largeurs();
  }

  #clicTri(colonne, sens) {
    const suivant = sens === null ? 'asc' : sens === 'asc' ? 'desc' : null;
    if (this.modeTriBase) this.trier(colonne.code, suivant, true);
    else this.trier(colonne.code, suivant, false);
  }

  /** Tri d'une colonne : sur les lignes chargées, ou sur toute la base (rechargement). */
  trier(code, sens, base) {
    const c = this.modele.parCode.get(code);
    if (base && c?.calcul) {
      this.message(texte('liste.menu.tri_calcule'), 'avertissement');
      base = false;
    }
    if (base) {
      this.triLocal = null;
      this.triBase = sens ? [{ colonne: code, sens }] : null;
      this.#rendreEntete();
      this.recharger();
      return;
    }
    this.triLocal = sens ? { code, sens } : null;
    this.#rendreEntete();
    this.rendreCorps();
  }

  #menu(colonne, ancre) {
    ouvrirMenuFiltre({
      ancre, colonne, modele: this.modele, lignes: this.lignes, filtre: this.filtres.get(colonne.code),
      appliquer: (f) => {
        if (f) this.filtres.set(colonne.code, f); else this.filtres.delete(colonne.code);
        this.#rendreEntete();
        this.rendreCorps();
        this.#rendreSegments();
      },
      trier: (sens, base) => this.trier(colonne.code, sens, base),
    });
  }

  // ---------------------------------------------------------------- corps

  #cellule(ligne, c) {
    return { valeur: this.modele.valeur(ligne, c.code), texte: this.modele.texteCellule(ligne, c), style: this.modele.style(ligne, c.code) };
  }

  /** Lignes affichées : lignes chargées filtrées par les filtres de colonnes, triées localement si demandé. */
  lignesAffichees(lignes = this.lignes) {
    const actifs = [...this.filtres].filter(([, f]) => filtreActif(f)).map(([code, f]) => [this.modele.parCode.get(code), f]).filter(([c]) => c);
    let res = actifs.length ? lignes.filter((l) => actifs.every(([c, f]) => correspond(f, this.#cellule(l, c), c, undefined, this.debutExercice))) : lignes;
    if (this.triLocal && lignes === this.lignes) {
      const c = this.modele.parCode.get(this.triLocal.code);
      if (c) {
        const s = this.triLocal.sens === 'desc' ? -1 : 1;
        const num = estNumerique(c);
        res = [...res].sort((a, b) => {
          const va = this.modele.valeur(a, c.code), vb = this.modele.valeur(b, c.code);
          const vide = (v) => v === null || v === undefined || v === '';
          if (vide(va) || vide(vb)) return comparerValeurs(va, vb, num); // vides en dernier
          return s * comparerValeurs(va, vb, num);
        });
      }
    }
    return res;
  }

  #ligneDom(ligne, visibles) {
    const tr = document.createElement('tr');
    const id = String(ligne._id);
    tr.dataset.id = id;
    const marque = this.marques.get(id);
    if (marque) tr.classList.add(marque);
    if (this.glisser?.({ ligne, definition: this.definition })) {
      tr.draggable = true;
      tr.classList.add('glissable');
      tr.title = texte('liste.liste.glisser');
    }
    if (this.selection === id || this.selections.has(id)) tr.classList.add('selectionnee');
    const coin = document.createElement('td');
    coin.className = 'liste-coin';
    tr.append(coin);
    for (const c of visibles) {
      const td = document.createElement('td');
      td.className = `aligne-${alignement(c)}`;
      td.dataset.code = c.code;
      if (this.modeSaisie && this.modifiables?.has(c.code)) td.classList.add('modifiable');
      const valeur = this.modele.valeur(ligne, c.code);
      const contenu = this.formats.contenu(valeur, c, this.modele);
      if (contenu instanceof Node) td.append(contenu); else td.textContent = contenu ?? '';
      appliquerStyle(td, this.modele.style(ligne, c.code));
      if (this.affichageLignes === 'simple' && typeof contenu === 'string' && contenu.length > 20) td.title = contenu;
      tr.append(td);
    }
    return tr;
  }

  rendreCorps() {
    const visibles = this.#visibles();
    const f = document.createDocumentFragment();
    const affichees = this.lignesAffichees();
    for (const l of affichees) f.append(this.#ligneDom(l, visibles));
    this.corps.replaceChildren(f);
    this.#compteur(affichees.length);
    this.#rendreSuite();
    this.#rendreTotaux();
  }

  /** Nouveau lot : ajouté en fin de tableau, sauf tri local actif (le tableau est alors retrié). */
  #ajouterAuCorps(nouvelles) {
    if (this.triLocal) { this.rendreCorps(); return; }
    const visibles = this.#visibles();
    const f = document.createDocumentFragment();
    for (const l of this.lignesAffichees(nouvelles)) f.append(this.#ligneDom(l, visibles));
    this.corps.append(f);
    this.#compteur(this.corps.rows.length);
    if (this.#filtresColonnesActifs()) this.#rendreTotaux();
  }

  // ---------------------------------------------------------------- totaux et indicateurs (L3, L4)

  /** Colonnes visibles à total (lues dans la source). */
  #colonnesTotal() { return this.modele ? this.#visibles().filter((c) => c.total && !c.calcul) : []; }

  #agregatsTotal(colonnes = this.#colonnesTotal()) { return colonnes.map((c) => ({ code: c.code, calcul: c.total, colonne: c.code })); }

  #indicateurs() { return this.modele ? this.definition.indicateurs ?? [] : []; }

  /**
   * Bandeau d'indicateurs affiché : densité confortable, la vue en déclare et l'utilisateur ne l'a pas masqué
   * (préférence par vue).
   */
  get indicateursAffiches() {
    return !this.compacte && this.#indicateurs().length > 0 && this.prefs.indicateurs?.[String(this.vue?.vli_id ?? 'nouvelle')] !== false;
  }

  /** Densité changée : bandeau et bouton suivent ; un filtre d'indicateur ne reste pas posé sans bandeau. */
  #surDensite() {
    const compacte = densiteCompacte();
    if (compacte === this.compacte) return;
    this.compacte = compacte;
    if (compacte && this.filtreIndicateur) { this.filtreIndicateur = null; this.#appliquerIndicateurs(); this.recharger(); this.rafraichirSegments().catch(() => {}); return; }
    this.#appliquerIndicateurs();
    if (this.indicateursAffiches) this.chargerAgregats();
  }

  basculerIndicateurs() {
    const cle = String(this.vue?.vli_id ?? 'nouvelle');
    const masquer = this.indicateursAffiches;
    this.prefs.indicateurs = { ...this.prefs.indicateurs, [cle]: false };
    if (!masquer) delete this.prefs.indicateurs[cle];
    this.#ecrirePreferences();
    // Bandeau masqué : son filtre ne doit pas rester posé sans être visible.
    if (masquer && this.filtreIndicateur) { this.filtreIndicateur = null; this.#appliquerIndicateurs(); this.recharger(); this.rafraichirSegments().catch(() => {}); return; }
    this.#appliquerIndicateurs();
    if (!masquer) this.chargerAgregats();
  }

  /** Clic sur une carte : pose ses filtres (la liste n'affiche que ses lignes), un second clic les retire. */
  choisirIndicateur(code) {
    const ind = this.#indicateurs().find((i) => i.code === code);
    if (!ind?.filtres?.length) return;
    this.filtreIndicateur = this.filtreIndicateur === code ? null : code;
    this.#rendreIndicateurs();
    this.recharger();
    this.rafraichirSegments().catch(() => {});
  }

  #appliquerIndicateurs() {
    const b = this.racine.querySelector('[data-action="indicateurs"]');
    const affiches = this.indicateursAffiches;
    b.hidden = this.compacte || !this.#indicateurs().length;
    b.setAttribute('aria-pressed', String(affiches));
    b.classList.toggle('actif', affiches);
    b.title = texte(`liste.liste.indicateurs_${affiches ? 'masquer' : 'afficher'}`);
    if (!affiches) this.valeursIndicateurs = null;
    this.#rendreIndicateurs();
  }

  /**
   * Agrégats calculés par la base sur toute la sélection : totaux (indicateur cliqué compris) et indicateurs (sans
   * l'indicateur cliqué : les cartes ne bougent pas quand on clique). Une erreur n'empêche pas la liste.
   */
  async chargerAgregats() {
    if (!this.vue) return;
    const gen = this.generation;
    const totaux = this.#agregatsTotal();
    const inds = this.indicateursAffiches ? this.#indicateurs() : [];
    if (!totaux.length && !inds.length) { this.#rendreTotaux(); return; }
    try {
      const [t, i] = await Promise.all([
        totaux.length ? this.fournisseur.agregats({ ...this.demande(), agregats: totaux }) : null,
        inds.length ? this.fournisseur.agregats({
          ...this.demande(), filtres: [],
          agregats: inds.map((x) => ({ code: x.code, calcul: x.calcul, colonne: x.colonne, filtres: x.filtres ?? [], denominateur: x.denominateur ?? [] })),
        }) : null,
      ]);
      if (gen !== this.generation) return;
      this.totauxBase = t;
      this.valeursIndicateurs = i;
    } catch (e) {
      if (gen !== this.generation) return;
      this.message(texte('liste.liste.totaux_erreur', { message: e.message ?? e }), 'avertissement');
    }
    this.#rendreTotaux();
    this.#rendreIndicateurs();
  }

  /**
   * Ligne de total collante en bas du tableau : totaux de la base sur toute la sélection ; dès qu'un filtre de
   * colonne (lignes chargées) est posé, totaux des lignes affichées, signalés (Q4).
   */
  #rendreTotaux() {
    const colonnes = this.#colonnesTotal();
    if (!colonnes.length || !this.vue) { this.table.tFoot?.remove(); return; }
    const pied = this.table.tFoot ?? this.table.createTFoot();
    const local = this.#filtresColonnesActifs();
    const valeurs = local ? agreger(this.lignesAffichees(), this.#agregatsTotal(colonnes)) : this.totauxBase;
    const n = valeurs?._lignes;
    const portee = texte(`liste.liste.totaux_portee_${local ? 'affichees' : 'selection'}`);
    const tr = document.createElement('tr');
    tr.className = local ? 'liste-totaux local' : 'liste-totaux';
    const coin = document.createElement('td');
    coin.className = 'liste-coin';
    coin.textContent = icone('liste_totaux');
    coin.title = n === undefined ? texte('liste.liste.totaux', { portee }) : pluriel('liste.liste.totaux_lignes', n, { portee });
    tr.append(coin);
    let etiquette = false;
    for (const c of this.#visibles()) {
      const td = document.createElement('td');
      td.dataset.code = c.code;
      td.className = `aligne-${alignement(c)}`;
      if (c.total && !c.calcul) {
        const v = valeurs?.[c.code];
        td.textContent = valeurs ? (v === null || v === undefined ? '—' : c.total === 'compte' ? String(v) : this.modele.texte(v, { ...c, format: 'nombre' })) : '…';
        td.title = `${TOTAUX_COLONNE[c.total] ?? c.total} ${portee}`;
      } else if (!etiquette) {
        // Première colonne sans total : rappel du nombre de lignes et de la portée.
        td.className = 'aligne-gauche liste-totaux-etiquette';
        td.textContent = n === undefined ? '' : pluriel(`liste.liste.totaux_${local ? 'affichees' : 'lignes_nombre'}`, n);
        td.title = coin.title;
      }
      etiquette = true;
      tr.append(td);
    }
    pied.replaceChildren(tr);
  }

  #rendreIndicateurs() {
    const zone = this.racine.querySelector('.liste-indicateurs');
    const inds = this.indicateursAffiches ? this.#indicateurs() : [];
    zone.hidden = !inds.length;
    if (!inds.length) { zone.replaceChildren(); return; }
    const v = this.valeursIndicateurs;
    zone.innerHTML = inds.map((i) => {
      const cliquable = i.filtres?.length > 0;
      const actif = this.filtreIndicateur === i.code;
      const valeur = v ? texteIndicateur(v[i.code], i.format) : '…';
      const titre = [i.bulle, cliquable ? texte(`liste.liste.indicateur_${actif ? 'retirer' : 'filtrer'}`) : ''].filter(Boolean).join('\n');
      const balise = cliquable ? 'button type="button"' : 'div';
      return `<${balise} class="liste-indicateur teinte-${echapper(i.teinte ?? 'neutre')}${actif ? ' actif' : ''}" data-indicateur="${echapper(i.code)}"
        ${cliquable ? `aria-pressed="${actif}"` : ''} title="${echapper(titre)}">
        <span class="liste-indicateur-titre">${echapper(i.titre ?? i.code)}</span><strong>${echapper(valeur)}</strong></${cliquable ? 'button' : 'div'}>`;
    }).join('');
  }

  #compteur(affichees) {
    const charge = `${this.lignes.length}${this.fin ? '' : '+'}`;
    this.racine.querySelector('.liste-compteur').textContent = affichees === this.lignes.length
      ? pluriel('liste.liste.lignes', this.lignes.length, { charge })
      : texte('liste.liste.lignes_chargees', { affichees, charge });
  }

  #rendreSuite() {
    const b = this.basSuite;
    if (!this.vue) { b.textContent = texte('liste.liste.aucune_vue'); return; }
    if (this.enCours) b.innerHTML = `<span class="liste-attente">${texteHtml('liste.liste.chargement')}</span>`;
    else if (!this.fin) {
      b.innerHTML = `<button type="button">${texteHtml('liste.liste.suite')}</button>`;
      b.querySelector('button').addEventListener('click', () => this.chargerSuite().catch((e) => this.#erreur(e)));
    } else b.textContent = this.lignes.length ? pluriel('liste.liste.fin', this.lignes.length) : texte('liste.liste.aucune_ligne');
  }

  /** Colonnes visibles, dans l'ordre choisi à la souris par l'utilisateur (sinon celui de la vue). */
  #visibles() {
    const visibles = this.modele.visibles;
    const ordre = this.prefs?.ordres?.[this.#cleLargeurs()];
    if (!ordre?.length) return visibles;
    const rang = new Map(ordre.map((code, i) => [code, i]));
    return [...visibles].sort((a, b) => (rang.get(a.code) ?? Infinity) - (rang.get(b.code) ?? Infinity));
  }

  /**
   * Déplacement d'une colonne : glisser l'en-tête (hors boutons et poignée) sur un autre en-tête, à gauche ou à
   * droite de sa moitié. L'ordre est une préférence du navigateur (le concepteur peut le reprendre dans la vue).
   */
  #deplacement(th, code) {
    th.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, .liste-poignee')) return;
      const x0 = e.clientX, y0 = e.clientY;
      let actif = false, cible = null;
      const marquer = (el, cote) => {
        this.table.tHead.querySelectorAll('th.depot-gauche, th.depot-droite').forEach((x) => x.classList.remove('depot-gauche', 'depot-droite'));
        if (el) el.classList.add(`depot-${cote}`);
      };
      const bouger = (ev) => {
        if (!actif && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        if (!actif) { actif = true; th.setPointerCapture(e.pointerId); th.classList.add('deplacee'); document.body.classList.add('deplacement-colonne'); }
        const sous = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('th[data-code]');
        if (!sous || !this.table.contains(sous)) { cible = null; marquer(null); return; }
        const r = sous.getBoundingClientRect();
        cible = { code: sous.dataset.code, apres: ev.clientX > r.left + r.width / 2 };
        marquer(sous, cible.apres ? 'droite' : 'gauche');
      };
      const finir = () => {
        th.removeEventListener('pointermove', bouger);
        th.removeEventListener('pointerup', finir);
        th.removeEventListener('pointercancel', finir);
        if (!actif) return;
        th.classList.remove('deplacee');
        document.body.classList.remove('deplacement-colonne');
        marquer(null);
        if (!cible || cible.code === code) return;
        const codes = this.#visibles().map((c) => c.code).filter((x) => x !== code);
        codes.splice(codes.indexOf(cible.code) + (cible.apres ? 1 : 0), 0, code);
        this.prefs.ordres = { ...this.prefs.ordres, [this.#cleLargeurs()]: codes };
        this.#ecrirePreferences();
        this.#rendreEntete();
        this.rendreCorps();
      };
      th.addEventListener('pointermove', bouger);
      th.addEventListener('pointerup', finir);
      th.addEventListener('pointercancel', finir);
    });
  }

  /** Largeurs ajustées à la souris pour la vue courante : préférence du navigateur, jamais en base. */
  #cleLargeurs() { return String(this.vue?.vli_id ?? 'nouvelle'); }

  #largeursAjustees() { return this.prefs.colonnes?.[this.#cleLargeurs()] ?? {}; }

  /** Redimensionnement d'une colonne par glisser sur le bord droit de l'en-tête ; double-clic : largeur de la vue. */
  #poignee(poignee, code) {
    poignee.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      poignee.setPointerCapture(e.pointerId);
      const i = this.#visibles().findIndex((c) => c.code === code);
      const col = this.table.querySelector('colgroup').children[i + 1];
      const depart = col.getBoundingClientRect().width;
      const x0 = e.clientX;
      let largeur = depart;
      document.body.classList.add('redimensionnement-colonne');
      const bouger = (ev) => {
        largeur = Math.round(Math.max(36, depart + ev.clientX - x0));
        const ancienne = parseFloat(col.style.width) || depart;
        col.style.width = `${largeur}px`;
        this.table.style.width = `${parseFloat(this.table.style.width) + largeur - ancienne}px`;
      };
      const finir = () => {
        poignee.removeEventListener('pointermove', bouger);
        poignee.removeEventListener('pointerup', finir);
        poignee.removeEventListener('pointercancel', finir);
        document.body.classList.remove('redimensionnement-colonne');
        if (largeur === depart) return;
        this.prefs.colonnes = { ...this.prefs.colonnes, [this.#cleLargeurs()]: { ...this.#largeursAjustees(), [code]: largeur } };
        this.#ecrirePreferences();
        this.#largeurs();
      };
      poignee.addEventListener('pointermove', bouger);
      poignee.addEventListener('pointerup', finir);
      poignee.addEventListener('pointercancel', finir);
    });
    poignee.addEventListener('click', (e) => e.stopPropagation());
    poignee.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const ajustees = { ...this.#largeursAjustees() };
      delete ajustees[code];
      this.prefs.colonnes = { ...this.prefs.colonnes, [this.#cleLargeurs()]: ajustees };
      this.#ecrirePreferences();
      this.#largeurs();
    });
  }

  #largeurs() {
    const ajustees = this.#largeursAjustees();
    // Une colonne ajustée à la souris devient fixe (pour cet utilisateur) ; les autres se partagent le reste.
    // Largeurs fixes de la vue pensées pour un texte de 13 px : mises à l'échelle de la densité (I6, 14 px en confortable).
    const echelle = (parseFloat(getComputedStyle(this.table).fontSize) || TAILLE_REFERENCE) / TAILLE_REFERENCE;
    const aLEchelle = (l) => (l?.mode === 'fixe' && echelle !== 1
      ? { ...l, valeur: Number(l.valeur) * echelle, ...(l.min ? { min: Number(l.min) * echelle } : {}), ...(l.max ? { max: Number(l.max) * echelle } : {}) } : l);
    const visibles = this.#visibles().map((c) => (ajustees[c.code]
      ? { ...c, largeur: { mode: 'fixe', valeur: ajustees[c.code], min: 36, max: null } } : { ...c, largeur: aLEchelle(c.largeur) }));
    const dispo = Math.max(this.zone.clientWidth - LARGEUR_COIN - 2, 200);
    const largeurs = calculerLargeurs(visibles, dispo);
    const cg = this.table.querySelector('colgroup');
    cg.innerHTML = `<col style="width:${LARGEUR_COIN}px">${largeurs.map((l) => `<col style="width:${l}px">`).join('')}`;
    this.table.style.width = `${LARGEUR_COIN + largeurs.reduce((s, l) => s + l, 0)}px`;
  }

  // ---------------------------------------------------------------- sélection, ouverture

  /** Ligne courante ; Ctrl : ajoute ou retire de la sélection ; Maj : plage depuis l'ancre. */
  #selectionner(id, { basculer = false, etendre = false } = {}) {
    this.selection = id;
    if (etendre && this.ancre !== null) {
      // Plage depuis l'ancre, dans l'ordre affiché (filtres et tri compris).
      const ids = [...this.corps.rows].map((tr) => tr.dataset.id);
      const a = ids.indexOf(this.ancre), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) this.selections = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (basculer) {
      if (this.selections.size === 0 && this.ancre !== null) this.selections.add(this.ancre);
      if (this.selections.has(id)) this.selections.delete(id); else this.selections.add(id);
      this.ancre = id;
    } else {
      this.selections = new Set([id]);
      this.ancre = id;
    }
    for (const tr of this.corps.rows) {
      tr.classList.toggle('selectionnee', this.selections.has(tr.dataset.id));
      tr.classList.toggle('courante', tr.dataset.id === id);
    }
    this.corps.querySelector(`tr[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    this.#majActionsElements();
  }

  /** Boutons Consulter, Copier (une ligne) et Supprimer (une ou plusieurs) selon la vue et la sélection. */
  #majActionsElements() {
    const a = this.actionsElements;
    const n = this.lignesSelectionnees().length;
    for (const [code, min, max] of [['consulter', 1, 1], ['copier', 1, 1], ['supprimer', 1, Infinity]]) {
      const b = this.racine.querySelector(`[data-element="${code}"]`);
      if (!b) continue;
      b.hidden = !a?.[code];
      b.disabled = n < min || n > max;
    }
    const lignes = this.lignesSelectionnees();
    this.racine.querySelectorAll('[data-autre]').forEach((b) => {
      const x = a?.autres?.[Number(b.dataset.autre)];
      b.disabled = !x || n < 1 || n > (x.max ?? 1) || (x.actif ? !x.actif(lignes) : false);
    });
  }

  async #actionElement(code, evenement) {
    const lignes = this.lignesSelectionnees();
    const a = this.actionsElements;
    if (!a?.[code] || !lignes.length) return;
    if (code === 'consulter') { a.consulter(lignes[0], evenement); return; }
    if (code === 'copier') { await a.copier(lignes[0], evenement); return; }
    const confirmation = lignes.length > 1 ? texte('liste.liste.supprimer_plusieurs', { nombre: lignes.length })
      : texte('liste.liste.supprimer_un', { nom: lignes[0].numero ?? lignes[0].code ?? lignes[0].libelle ?? lignes[0].nom ?? lignes[0]._id });
    if (!await confirmer(confirmation)) return;
    const refus = [];
    let supprimes = 0;
    for (const l of lignes) {
      try { await a.supprimer(l); supprimes++; } catch (e) { refus.push(texte('liste.liste.refus_ligne', { nom: l.numero ?? l.code ?? l._id, message: e.message })); }
    }
    if (supprimes) this.message(texte('liste.liste.supprimes', { nombre: supprimes }), 'succes');
    if (refus.length) this.message(texte('liste.liste.suppression_refusee', { refus: refus.join(' · ') }), 'erreur');
    this.selections = new Set();
    this.selection = null;
    await this.verifier();
    this.#majActionsElements();
  }

  /** Menu contextuel d'une ligne : ouvrir, actions de la vue sur la sélection (mêmes règles que les boutons). */
  #menuLigne(e, id) {
    const a = this.actionsElements;
    const lignes = this.lignesSelectionnees();
    const n = lignes.length;
    const executer = (f) => () => Promise.resolve(f()).catch((x) => this.#erreur(x));
    ouvrirMenuContextuel(e, [
      { libelle: texte('liste.liste.menu.ouvrir'), raccourci: touchesMenu('ouvrir', texte('liste.liste.menu.ouvrir_souris')), action: () => this.ouvrir(id), actif: n === 1 },
      { libelle: texte('liste.liste.menu.nouvelle_fenetre'), raccourci: touchesMenu('nouvelleFenetre', texte('liste.liste.menu.nouvelle_fenetre_souris')), action: () => this.ouvrir(id, { ctrlKey: true }), actif: n === 1 },
      { separateur: true },
      ...(a?.consulter ? [{ libelle: texte('liste.liste.consulter'), raccourci: touchesMenu('consulter'), action: executer(() => this.#actionElement('consulter')), actif: n === 1 }] : []),
      ...(a?.copier ? [{ libelle: texte('liste.liste.copier'), raccourci: touchesMenu('copier'), action: executer(() => this.#actionElement('copier')), actif: n === 1 }] : []),
      ...(a?.supprimer ? [{ libelle: n > 1 ? texte('liste.liste.menu.supprimer_n', { nombre: n }) : texte('liste.liste.supprimer'), raccourci: touchesMenu('supprimer'), action: executer(() => this.#actionElement('supprimer')), actif: n >= 1 }] : []),
      ...(a?.autres ?? []).map((x) => ({
        libelle: x.libelle, titre: x.titre, action: executer(() => x.action(lignes, e)),
        actif: n >= 1 && n <= (x.max ?? 1) && (x.actif ? x.actif(lignes) : true),
      })),
      { separateur: true },
      { libelle: texte('liste.liste.menu.selection'), raccourci: [texte('liste.liste.menu.selection_souris'), libelleRaccourci('etendreBas', 'liste'), libelleRaccourci('toutSelectionner', 'liste')].filter(Boolean).join(' · '), actif: false },
    ]);
  }

  /** Raccourcis des lignes (groupe liste), la liste ayant le focus. */
  #clavier(e) {
    if (e.target !== this.zone) return;
    const action = actionDe(e, 'liste');
    if (!action || ACTIONS_PAGE.has(action)) return;
    const lignes = [...this.corps.rows];
    const i = lignes.findIndex((tr) => tr.dataset.id === this.selection);
    const aller = (j, etendre = false) => { if (lignes[j]) this.#selectionner(lignes[j].dataset.id, { etendre }); };
    const fonctions = {
      lignePrecedente: () => aller(Math.max(i - 1, 0)),
      ligneSuivante: () => aller(Math.min(i + 1, lignes.length - 1)),
      premiereLigne: () => aller(0),
      derniereLigne: () => aller(lignes.length - 1),
      etendreHaut: () => aller(Math.max(i - 1, 0), true),
      etendreBas: () => aller(Math.min(i + 1, lignes.length - 1), true),
      toutSelectionner: () => this.#toutSelectionner(),
      ouvrir: this.selection ? () => this.ouvrir(this.selection) : null,
      nouvelleFenetre: this.selection ? () => this.ouvrir(this.selection, { ctrlKey: true }) : null,
      consulter: () => this.#actionElement('consulter', e),
      copier: () => this.#actionElement('copier', e),
      supprimer: () => this.#actionElement('supprimer', e),
    };
    const f = fonctions[action];
    if (!f) return;
    e.preventDefault();
    Promise.resolve(f()).catch((x) => this.#erreur(x));
  }

  /** Raccourcis de la page (rechercher, créer, actualiser, mode saisie) tant que la liste est affichée. */
  #clavierPage(e) {
    if (e.defaultPrevented || !this.racine.isConnected || this.racine.offsetParent === null) return;
    const dialogue = document.querySelector('dialog[open]');
    if (dialogue && !dialogue.contains(this.racine)) return;
    const action = actionDe(e, 'liste');
    if (!ACTIONS_PAGE.has(action)) return;
    // Hors de la liste, un champ de saisie garde ses touches (sauf la recherche, qui va au champ de la liste).
    const champ = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (champ && action !== 'rechercher' && !this.racine.contains(champ)) return;
    const recherche = this.racine.querySelector('.liste-recherche');
    const fonctions = {
      rechercher: () => { recherche.focus(); recherche.select(); },
      creer: this.actionCreation ? () => this.racine.querySelector('[data-action="creer"]').click() : null,
      actualiser: () => this.recharger(),
      saisie: this.racine.querySelector('[data-action="saisie"]')?.hidden === false ? () => this.basculerSaisie() : null,
    };
    const f = fonctions[action];
    if (!f) return;
    e.preventDefault();
    Promise.resolve(f()).catch((x) => this.#erreur(x));
  }

  /** Toutes les lignes affichées sélectionnées (la ligne courante reste). */
  #toutSelectionner() {
    const ids = [...this.corps.rows].map((tr) => tr.dataset.id);
    if (!ids.length) return;
    const courante = this.selection ?? ids[0];
    this.#selectionner(ids[0]);
    this.#selectionner(ids[ids.length - 1], { etendre: true });
    this.selection = courante;
    for (const tr of this.corps.rows) tr.classList.toggle('courante', tr.dataset.id === courante);
  }

  /** Lignes sélectionnées (données), dans l'ordre affiché ; sans sélection multiple, la ligne courante. */
  lignesSelectionnees() {
    const ids = this.selections.size ? this.selections
      : new Set(this.selection !== null && this.selection !== undefined ? [String(this.selection)] : []);
    return [...this.corps.rows].filter((tr) => ids.has(tr.dataset.id))
      .map((tr) => this.lignes.find((l) => String(l._id) === tr.dataset.id)).filter(Boolean);
  }

  // ---------------------------------------------------------------- saisie dans la liste

  /**
   * Colonnes saisissables de la vue : cochées « modifiable » dans la vue, modifiables dans la source (déclarée
   * modifiable par l'application, colonne modifiable dans la base), jamais calculées. Le serveur refait ces contrôles.
   */
  async #colonnesModifiables() {
    const vue = this.vue;
    this.modifiables = new Set();
    const bouton = this.racine.querySelector('[data-action="saisie"]');
    bouton.hidden = true;
    if (!vue || this.definition.source.mode !== 'vue' || !this.definition.colonnes.some((c) => c.modifiable && !c.calcul)) {
      if (this.modeSaisie) this.basculerSaisie(false);
      return;
    }
    this.sourcesConnues ??= await this.fournisseur.sources();
    if (vue !== this.vue) return;
    const s = this.sourcesConnues.find((x) => x.code === this.definition.source.vue);
    if (!s?.modifiable) return;
    const colonnes = new Map(s.colonnes.map((c) => [c.code, c]));
    this.modifiables = new Set(this.definition.colonnes.filter((c) => c.modifiable && !c.calcul && colonnes.get(c.code)?.modifiable).map((c) => c.code));
    bouton.hidden = this.modifiables.size === 0;
    if (this.modeSaisie) this.rendreCorps();
  }

  /** Mode saisie : un clic sur une cellule modifiable l'édite ; hors mode saisie, la liste reste en lecture. */
  basculerSaisie(actif = !this.modeSaisie) {
    this.modeSaisie = actif;
    const b = this.racine.querySelector('[data-action="saisie"]');
    b.classList.toggle('actif', actif);
    b.setAttribute('aria-pressed', String(actif));
    this.racine.classList.toggle('liste-saisie', actif);
    this.rendreCorps();
    if (actif) this.message(texte('liste.liste.saisie_message'));
  }

  #td(id, code) {
    return this.corps.querySelector(`tr[data-id="${CSS.escape(String(id))}"] td[data-code="${CSS.escape(code)}"]`);
  }

  #commencerSaisie(id, code) {
    const td = this.#td(id, code);
    const ligne = this.lignes.find((l) => String(l._id) === String(id));
    const c = this.modele.parCode.get(code);
    if (!td || !ligne || !c) return;
    const valeur = ligne[code];
    if (c.format === 'coche') { this.#enregistrer(id, code, !vraiDonnee(valeur)); return; }
    let ed;
    if (c.format === 'combo' || c.format === 'picto' || c.format === 'pastille') {
      // Combo saisissable : la saisie filtre les options ou désigne directement l'option (libellé ou code).
      ed = creerCombo({
        options: c.options.map((o) => ({ valeur: String(o.valeur), libelle: `${o.picto ?? ''} ${o.libelle ?? o.valeur}`.trim() })),
        valeur: valeur === null || valeur === undefined ? '' : String(valeur),
      });
    } else if (c.format === 'date') {
      ed = document.createElement('input');
      ed.type = 'date';
      ed.value = String(valeur ?? '').slice(0, 10);
    } else if (c.format === 'texte' && (String(valeur ?? '').includes('\n') || this.affichageLignes === 'multi')) {
      ed = document.createElement('textarea');
      ed.value = valeur ?? '';
      ed.rows = Math.max(1, String(valeur ?? '').split('\n').length);
    } else {
      ed = document.createElement('input');
      ed.value = c.format === 'nombre' && valeur !== null && valeur !== undefined ? String(valeur).replace('.', ',') : valeur ?? '';
      if (c.format === 'nombre') ed.inputMode = 'decimal';
    }
    ed.classList.add('liste-editeur');
    td.replaceChildren(ed);
    td.classList.add('en-saisie');
    ed.focus();
    if (ed.select) ed.select();
    let fini = false;
    const terminer = async (mouvement) => {
      if (fini) return;
      fini = true;
      const saisie = ed.resoudre ? ed.resoudre() : ed.value;
      if (saisie === undefined) { this.message(texte('liste.liste.valeur_inconnue', { valeur: ed.value }), 'erreur'); fini = false; ed.focus(); return; }
      const ok = await this.#enregistrer(id, code, saisie, { texte: true });
      if (!ok) { fini = false; ed.focus(); return; }
      if (mouvement) this.#saisieSuivante(id, code, mouvement);
    };
    ed.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fini = true; this.#rendreLigne(id); this.zone.focus(); }
      else if (e.key === 'Enter' && !(ed.tagName === 'TEXTAREA' && (e.shiftKey || e.altKey))) { e.preventDefault(); terminer(e.shiftKey ? 'haut' : 'bas'); }
      else if (e.key === 'Tab') { e.preventDefault(); terminer(e.shiftKey ? 'gauche' : 'droite'); }
    });
    // Combo : un choix à la souris termine la saisie.
    if (ed.resoudre) ed.addEventListener('change', () => terminer(null));
    ed.addEventListener('blur', () => { if (!fini) terminer(null); });
  }

  /** Cellule suivante : même colonne sur la ligne suivante / précédente, ou colonne modifiable suivante / précédente. */
  #saisieSuivante(id, code, mouvement) {
    const lignes = [...this.corps.rows].map((tr) => tr.dataset.id);
    const colonnes = this.#visibles().map((c) => c.code).filter((x) => this.modifiables.has(x) && this.modele.parCode.get(x).format !== 'coche');
    let i = lignes.indexOf(String(id)), j = colonnes.indexOf(code);
    if (mouvement === 'bas') i++;
    else if (mouvement === 'haut') i--;
    else if (mouvement === 'droite') { j++; if (j >= colonnes.length) { j = 0; i++; } }
    else { j--; if (j < 0) { j = colonnes.length - 1; i--; } }
    if (i < 0 || i >= lignes.length || j < 0) return;
    this.#selectionner(lignes[i]);
    this.#commencerSaisie(lignes[i], colonnes[j]);
  }

  /**
   * Enregistre une valeur saisie : conversion selon le format, envoi au fournisseur avec l'empreinte de la ligne
   * (verrouillage optimiste), ligne relue en retour. Renvoie false si la saisie est invalide (l'éditeur reste ouvert).
   */
  async #enregistrer(id, code, saisie, { texte: saisieTexte = false } = {}) {
    const ligne = this.lignes.find((l) => String(l._id) === String(id));
    const c = this.modele.parCode.get(code);
    let valeur = saisie;
    if (saisieTexte) {
      if (c.format === 'nombre') {
        valeur = lireNombre(saisie);
        if (valeur === undefined) { this.message(texte('liste.liste.nombre_invalide', { valeur: saisie }), 'erreur'); return false; }
      } else valeur = saisie === '' ? null : saisie;
    }
    const avant = ligne[code];
    const identique = (avant ?? null) === (valeur ?? null) || (c.format === 'nombre' && valeur !== null && avant !== null && Number(avant) === Number(valeur));
    if (identique) { this.#rendreLigne(id); return true; }
    const td = this.#td(id, code);
    td?.classList.add('enregistrement');
    try {
      const relue = await this.fournisseur.modifier(this.demande(), id, ligne._h, { [code]: valeur });
      this.#remplacerLigne(id, relue);
      if (this.modele.parCode.get(code)?.total) this.chargerAgregats();
      return true;
    } catch (e) {
      if (e.code === ERREUR_LISTE.LIGNE_MODIFIEE && e.details) {
        this.#remplacerLigne(id, e.details);
        this.message(e.message, 'avertissement');
        return true;
      }
      this.message(e.message ?? String(e), 'erreur');
      this.#rendreLigne(id);
      return true;
    }
  }

  #remplacerLigne(id, nouvelle) {
    const i = this.lignes.findIndex((l) => String(l._id) === String(id));
    if (i < 0) return;
    this.modele.oublier(this.lignes[i]);
    this.lignes[i] = nouvelle;
    this.marques.set(String(id), 'modifiee');
    this.#rendreLigne(id);
    this.#effacerMarques();
  }

  #rendreLigne(id) {
    const tr = this.corps.querySelector(`tr[data-id="${CSS.escape(String(id))}"]`);
    const ligne = this.lignes.find((l) => String(l._id) === String(id));
    if (tr && ligne) tr.replaceWith(this.#ligneDom(ligne, this.#visibles()));
  }

  /** Ouvre la fiche de la ligne : l'ID et le type d'élément sont fournis par la source (Ctrl ou Maj : nouvelle fenêtre). */
  ouvrir(id, evenement = null) {
    const ligne = this.lignes.find((l) => String(l._id) === String(id));
    const nouvelleFenetre = Boolean(evenement?.ctrlKey || evenement?.shiftKey || evenement?.metaKey);
    if (ligne) this.ouvrirExterne?.({ id: ligne._id, type: ligne._type, ligne, nouvelleFenetre });
  }
}
