import { PROFIL } from '@logibtp/socle';
import { ERREUR_AUTHENTIFICATION } from '@logibtp/authentification';
import { Routeur, PageBase, GestionFenetres, Preferences, afficherApercu } from '@logibtp/navigation';
import { accesSousArbre, autorise } from '@logibtp/droits';
import { Bandeau, PanneauFenetres, confirmerFermetureSession, DISPOSITION_DEFAUT } from '@logibtp/navigation/ui';
import { GestionThemes } from '@logibtp/liste/ui';
import { ParametrageFiche } from '@logibtp/fiche/ui';
import { echapper, appliquerTheme, actionDe, definirAideRaccourcis, confirmer, formatHeure, activerCombos } from '@logibtp/socle/ui';
import './raccourcis.js';
import { api, ErreurApi } from './api.js';
import { creerFournisseurListe, estTypeDocument, LIBELLES_ELEMENTS } from './listes.js';
import { creerFournisseurFiche } from './fiches/fiches.js';
import { ficheDeLigne } from './fiches/definitions.js';
import { creerFournisseurGed } from './ged/ged.js';
import { creerFournisseurBibliotheque } from './bibliotheque/bibliotheque.js';
import { creerFournisseurAnnuaire, creerFournisseurEntreprises } from './annuaire/annuaire.js';
import { creerFournisseurStructure } from './structure/structure.js';
import { societeCourante } from './societe.js';
import { enregistrerServiceWorker, pwaControle, signalerCompte, purgerDonnees, depuisCache } from '../pwa/enregistrement.js';
import { listeAttente, ETATS_ATTENTE, urlAttente, ETAT_ATTENTE } from './hors-ligne/attente.js';
import { envoyerAttentes, SUJET_ATTENTE } from './hors-ligne/synchro.js';
import { listeOperations } from './hors-ligne/operations.js';
import './terrain/operations-terrain.js';
import { menus } from './navigation/menus.js';
import { ROUTES } from './pages/index.js';
import { CLE_PREFERENCES_NAVIGATION, urlDocument, urlFiche, TYPE_DOCUMENT, SUJET_FENETRE } from './codes.js';
import { texte, texteHtml, pluriel, iconeHtml } from '@logibtp/socle/dictionnaire';
import { logoApplication } from '../personnalisation.js';

// Application web LogiBTP (cœur) : services partagés par les pages, routeur (navigation classique dans la
// fenêtre), fenêtres séparées et session (module Navigation), bandeau à menus.

/** Pour une fiche, la liste où revenir quand elle a été ouverte directement (fenêtre séparée, session restaurée). */
export const LISTE_PAR_TYPE = {
  salarie: '/liste/salaries', materiel: '/liste/materiels', element: '/liste/bibliotheque', personne: '/liste/tiers', individu: '/liste/contacts',
  projet: '/liste/projets', affaire: '/liste/affaires', chantier: '/liste/chantiers', marche: '/liste/marches',
};

export class Application {
  constructor() {
    this.societe = null;
    this.preferences = new Preferences(CLE_PREFERENCES_NAVIGATION, { nouvelleFenetre: false, theme: 'auto', menu: { ...DISPOSITION_DEFAUT } });
    appliquerTheme(this.preferences.get('theme'));
    // Thème et disposition du menu changés dans une autre fenêtre de la session (même localStorage) : appliqués ici aussi.
    window.addEventListener('storage', (e) => {
      if (e.key !== CLE_PREFERENCES_NAVIGATION) return;
      this.preferences = new Preferences(CLE_PREFERENCES_NAVIGATION, this.preferences.defauts);
      appliquerTheme(this.preferences.get('theme'));
      this.bandeau?.disposer(this.preferences.get('menu'));
    });
    // Page modifiée quittée : question dans une fenêtre <dialog> (socle) plutôt que confirm() du navigateur.
    PageBase.confirmer = (message) => confirmer(message, { titre: 'Modifications non enregistrées', ok: 'Quitter' });
    this.abonnes = new Map(); // sujet → Set(fonction)
    this.servicesPrets = null;
  }

  async demarrer() {
    // Listes de choix : les <select> encore construits par les écrans s'affichent en combos du socle.
    activerCombos(document.body);
    // Rechargement (F5, Vite) : la page quittée reste affichée pendant le démarrage au lieu d'un écran vide.
    afficherApercu(document.querySelector('#pages'), `${location.pathname}${location.search}`);
    this.bandeau = new Bandeau(document.querySelector('#bandeau'), {
      menus: menus(this), naviguer: (url, o) => this.naviguer(url, o), logo: logoApplication(), titreApplication: texte('application.nom'), retour: () => this.retour(),
      disposition: this.preferences.get('menu'), surDisposition: (d) => this.preferences.set('menu', d),
    });
    // Application installable : le service worker garde le client et les données consultées (mode hors ligne).
    enregistrerServiceWorker({
      surNouvelleVersion: () => this.message('Nouvelle version de LogiBTP installée : rechargez la page (F5) une fois vos saisies enregistrées', 'avertissement'),
    });
    this.societe = await societeCourante();
    // Session (module Authentification) : sans session, seule la page de connexion s'ouvre ; mot de passe provisoire :
    // page Mon compte jusqu'au changement. API injoignable au démarrage : avec le service worker et une session gardée,
    // l'application démarre hors ligne sur les données gardées ; sinon un écran d'attente la recontrôle.
    if (await api.disponible()) this.session = await api.auth.session().catch(() => null);
    else {
      this.session = pwaControle() ? await api.auth.session().catch(() => null) : null;
      if (!this.session?.connecte) { this.#attendreApi(); return; }
      this.#passerHorsLigne();
    }
    this.#surveillerSession();
    if (this.session?.connecte) signalerCompte(this.utilisateur());
    const ici = `${location.pathname}${location.search}`;
    const publique = location.pathname === '/borne';
    if (!this.session?.connecte && location.pathname !== '/connexion' && !publique) history.replaceState(null, '', `/connexion?retour=${encodeURIComponent(ici)}`);
    else if (this.session?.mdp_a_changer && location.pathname !== '/compte') history.replaceState(null, '', '/compte?changer=1');
    if (this.session?.connecte) await this.chargerModules();
    this.rendreInfos();
    if (this.session?.connecte && !this.session.mdp_a_changer) this.#surveillerNotifications();

    this.fenetres = new GestionFenetres({
      etat: () => this.etatFenetre(),
      surListe: () => {},
      surSignal: () => this.signaler(),
      surFermetureSession: () => this.libererPage(),
      surDonnees: (sujet, contenu) => this.#notifier(sujet, contenu, false),
    });
    // Connexion ou déconnexion dans une autre fenêtre du navigateur (même cookie) : cette fenêtre suit.
    this.abonner(SUJET_FENETRE.SESSION, (e) => this.#sessionChangee(e));
    document.addEventListener('click', async (e) => {
      if (e.target.closest?.('[data-fin-usurpation]') && await confirmer(texte('authentification_btp.usurpation.terminer_confirmer'))) this.terminerUsurpation().catch((x) => this.erreur(x));
    });
    await this.fenetres.demarrer();

    this.routeur = new Routeur({ routes: ROUTES, conteneur: document.querySelector('#pages'), app: this, surPage: () => this.majPage() });
    window.addEventListener('beforeunload', (e) => {
      if (this.routeur.page?.modifiee && !this.fenetres.fermetureSession && !this.fermetureForcee) { e.preventDefault(); e.returnValue = ''; }
    });
    // Onglet ou fenêtre réellement quitté (après l'avertissement éventuel) : la page libère son verrou (requête keepalive).
    // Avant : onglet, défilement et aperçu de la page mémorisés pour un rechargement.
    window.addEventListener('pagehide', () => { this.routeur.memoriser(); this.libererPage(); });
    // Liens internes : navigation dans la fenêtre (Ctrl, Maj ou clic milieu : nouvelle fenêtre).
    document.addEventListener('click', (e) => this.#lien(e));
    document.addEventListener('auxclick', (e) => { if (e.button === 1) this.#lien(e, true); });
    document.addEventListener('keydown', (e) => this.#clavier(e));
    // Menus contextuels : lien vers la personnalisation des raccourcis (nouvelle fenêtre, la page courante reste).
    definirAideRaccourcis(() => this.naviguer('/parametres/raccourcis', { nouvelleFenetre: true }));
    // Changements de titre ou de modifications de la page : diffusés aux autres fenêtres.
    this.minuterie = setInterval(() => this.majPage(), 1000);
    // Documents enregistrés hors ligne : compteur du bandeau, envoi dès que l'API répond.
    this.abonner(SUJET_ATTENTE, () => this.majAttentes());
    await this.routeur.demarrer();
    this.majAttentes();
    this.envoyerAttentes();
  }

  // ---------------------------------------------------------------- services partagés par les pages

  /** Fournisseurs des modules (API), créés à la première page qui en a besoin. */
  services() {
    this.servicesPrets ??= Promise.resolve({
      liste: creerFournisseurListe(), fiche: creerFournisseurFiche(), ged: creerFournisseurGed(), bibliotheque: creerFournisseurBibliotheque(),
      annuaire: creerFournisseurAnnuaire(), entreprises: creerFournisseurEntreprises(), structure: creerFournisseurStructure(),
    });
    return this.servicesPrets;
  }

  /**
   * Modules activés pour la société (db/193 : module_societe) : menus et écrans des modules désactivés masqués.
   * Rappelée après un changement d'activation.
   */
  async chargerModules() {
    this.modules = new Map();
    try { for (const m of await api.modules()) this.modules.set(m.code, m.actif); } catch { /* table absente : tout est actif */ }
    try { this.typesActifs = new Set((await api.typesDocument()).map((t) => t.tyd_code)); } catch { this.typesActifs = null; }
    // Droits du profil (module Droits) : menus et commandes masqués ; le serveur reste seul juge.
    try { this.droits = await api.droits.moi(); } catch { this.droits = null; }
    if (this.bandeau) { this.bandeau.menus = menus(this); this.bandeau.rendre(); }
  }

  /** Module actif pour la société (inconnu : actif). */
  moduleActif(code) { return this.modules?.get(code) ?? true; }

  /** Type de document actif (types non chargés : actif). */
  typeActif(code) { return !this.typesActifs || this.typesActifs.has(code); }

  /** Accès à un nœud du module Droits (au moins une action sur lui ou ses descendants) ; droits inconnus : oui. */
  acces(noeud, ecriture = false) { return !this.droits || accesSousArbre(this.droits, noeud, ecriture); }

  /** Action permise sur un nœud du module Droits (au moins la portée demandée) ; droits inconnus : oui. */
  peut(noeud, action, portee = 'SOI') { return !this.droits || autorise(this.droits, noeud, action, portee); }

  // Usurpation (module Authentification) : l'application est celle du compte usurpé (profil, droits, menus).
  profil() { return this.session?.usurpation?.profil ?? this.session?.profil ?? ''; }
  utilisateur() { return this.session?.usurpation?.code ?? this.session?.code ?? ''; }

  /** Usurpation d'un compte par un administrateur (motif obligatoire) : l'application est rechargée sous ce compte. */
  async usurper(identifiant, motif) {
    this.session = await api.auth.usurper(identifiant, motif);
    this.publier(SUJET_FENETRE.SESSION, { connecte: true });
    location.assign('/');
  }

  /** Fin de l'usurpation : retour au compte de l'administrateur. */
  async terminerUsurpation() {
    this.session = await api.auth.finUsurpation();
    this.publier(SUJET_FENETRE.SESSION, { connecte: true });
    location.assign('/parametres/comptes');
  }
  estAdmin() { return this.profil() === PROFIL.ADMIN; }
  peutGererThemes() { return this.estAdmin(); }

  /** Thème d'affichage : 'auto' (système), 'clair' ou 'sombre' ; gardé dans le navigateur pour toutes les fenêtres. */
  changerTheme(theme) {
    this.preferences.set('theme', theme);
    appliquerTheme(theme);
  }

  /** Disposition du menu (`DISPOSITION_DEFAUT` du module Navigation : mode haut / droite, largeur, masquage) ; gardée dans le navigateur. */
  changerMenu(changement) {
    this.bandeau.disposer(changement);
    this.preferences.set('menu', { ...this.bandeau.disposition });
  }

  // ---------------------------------------------------------------- session (module Authentification)

  /**
   * Réponses 401 SESSION_REQUISE et 403 MDP_A_CHANGER de l'API (tous les fournisseurs passent par fetch) : page de
   * connexion, ou page Mon compte pour changer le mot de passe provisoire.
   */
  #surveillerSession() {
    if (window.fetch.surveille) return;
    const origine = window.fetch.bind(window);
    const surveille = async (entree, init) => {
      const url = typeof entree === 'string' ? entree : entree?.url ?? '';
      const versApi = url.includes('/api/') && !url.includes('/api/sante');
      let r;
      try {
        r = await origine(entree, init);
      } catch (e) {
        if (versApi && e?.name !== 'AbortError') this.#verifierApi();
        throw e;
      }
      // Erreur du serveur, réponse servie par le service worker depuis ses données gardées, API déjà perdue : contrôle.
      if (versApi && (r.status >= 500 || this.apiPerdue || depuisCache(r) !== null)) this.#verifierApi();
      if (r.status === 401 || r.status === 403) {
        if (versApi && !url.includes('/api/auth/')) {
          const code = await r.clone().json().then((d) => d?.code).catch(() => null);
          if (code === ERREUR_AUTHENTIFICATION.SESSION_REQUISE) this.#sessionPerdue();
          else if (code === ERREUR_AUTHENTIFICATION.MDP_A_CHANGER && location.pathname !== '/compte') this.naviguer('/compte?changer=1');
        }
      }
      return r;
    };
    surveille.surveille = true;
    window.fetch = surveille;
    // Réseau du poste coupé ou rétabli : l'état de l'API est contrôlé aussitôt.
    window.addEventListener('offline', () => this.#verifierApi());
    window.addEventListener('online', () => this.#verifierApi());
  }

  /**
   * Compteur de notifications du bandeau (module Notifications) : relu chaque minute et quand la fenêtre redevient
   * visible ; une page qui marque des notifications le met à jour (`majNotifications`, diffusé aux autres fenêtres).
   */
  #surveillerNotifications() {
    const lire = () => api.notifications.compteur().then((c) => this.majNotifications(c, false)).catch(() => {});
    lire();
    clearInterval(this.minuterieNotifications);
    this.minuterieNotifications = setInterval(lire, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) lire(); });
    this.abonner(SUJET_FENETRE.COMPTEUR_NOTIFICATIONS, (c) => { this.notifications = c; this.rendreInfos(); });
  }

  /** Nouveau compteur de notifications : bandeau de cette fenêtre et des autres. */
  majNotifications(c, diffuser = true) {
    const change = JSON.stringify(c) !== JSON.stringify(this.notifications);
    this.notifications = c;
    if (change) this.rendreInfos();
    if (diffuser) this.publier(SUJET_FENETRE.COMPTEUR_NOTIFICATIONS, c);
  }

  /** Session expirée ou fermée : connexion dans cette fenêtre, ou dans une autre si la page a des modifications en cours. */
  #sessionPerdue() {
    if (this.sessionPerdueSignalee || location.pathname === '/connexion') return;
    this.sessionPerdueSignalee = true;
    this.session = null;
    const retour = `${location.pathname}${location.search}`;
    if (this.routeur?.page?.modifiee) {
      this.message('Session expirée : reconnectez-vous dans la fenêtre ouverte, puis enregistrez de nouveau', 'avertissement');
      this.naviguer(`/connexion?fenetre=1`, { nouvelleFenetre: true });
      setTimeout(() => { this.sessionPerdueSignalee = false; }, 5000);
      return;
    }
    this.fermetureForcee = true;
    location.assign(`/connexion?retour=${encodeURIComponent(retour)}`);
  }

  async #sessionChangee({ connecte }) {
    this.session = await api.auth.session().catch(() => null);
    this.sessionPerdueSignalee = false;
    if (this.session?.connecte) { signalerCompte(this.utilisateur()); this.envoyerAttentes(); }
    if (connecte && location.pathname === '/connexion' && !this.routeur?.page?.fenetreSeule) location.assign(new URLSearchParams(location.search).get('retour') || '/');
    else if (!connecte && !this.routeur?.page?.modifiee && location.pathname !== '/connexion') { this.fermetureForcee = true; location.assign('/connexion'); }
    else { await this.chargerModules(); this.rendreInfos(); }
  }

  /** Déconnexion : contrôle des modifications de toutes les fenêtres, puis fermeture de la session du serveur. */
  async deconnecter() {
    const modifiees = (await this.fenetres.etatFermeture()).filter((x) => x.modifiee);
    if (modifiees.length && !(await confirmerFermetureSession(modifiees))) return;
    await this.libererPage();
    try { await api.auth.deconnexion(); } catch (e) { this.erreur(e); return; }
    // Données consultées gardées par le service worker : effacées avec la session.
    await purgerDonnees();
    this.publier(SUJET_FENETRE.SESSION, { connecte: false });
    this.fermetureForcee = true;
    location.assign('/connexion');
  }

  // ---------------------------------------------------------------- navigation

  /** Navigation dans la fenêtre, ou dans une nouvelle fenêtre séparée (autre moniteur). */
  naviguer(url, { nouvelleFenetre = false, remplacer = false } = {}) {
    if (nouvelleFenetre) {
      // Ouverture différée hors de l'événement : avec Ctrl ou le clic milieu, le navigateur ouvrirait sinon un onglet en
      // arrière-plan. La nouvelle fenêtre passe au premier plan.
      setTimeout(() => {
        const w = this.fenetres.ouvrir(url);
        if (w) w.focus();
        else this.message('Fenêtre bloquée par le navigateur : autorisez les fenêtres pop-up pour ce site', 'avertissement');
      }, 0);
      return Promise.resolve(false);
    }
    return this.routeur.aller(url, { remplacer });
  }

  /** Définition du document qui porte la composition d'un ouvrage (types de lignes, unités, TVA). */
  definitionDocument() {
    this.definitionDoc ??= api.definition(TYPE_DOCUMENT.V_DEVIS);
    return this.definitionDoc;
  }

  /** URL de l'écran d'un élément de liste (document, fiche, document GED), null si aucun écran. */
  urlElement({ id, type }) {
    if (estTypeDocument(type)) return urlDocument(id);
    if (type === 'document_ged') return `/ged/${id}`;
    if (type === 'pointage') return `/pointage/saisie?pointage=${id}`;
    if (type === 'mouvement_stock') return `/stock/mouvement/${id}`;
    const f = ficheDeLigne({ id, type });
    return f ? urlFiche(f.type, f.id) : null;
  }

  /** Retour à la page précédente de la fenêtre (bouton ◀ du bandeau, raccourci), sinon l'accueil. */
  retour() { this.routeur?.retour('/'); }

  /** Ouverture depuis une liste : préférence « nouvelle fenêtre », inversée par Ctrl / Maj. */
  ouvrirElement(element, { nouvelleFenetre = false } = {}) {
    const url = this.urlElement(element);
    if (!url) {
      this.message(`Fiche ${LIBELLES_ELEMENTS[element.type] ?? element.type} n° ${element.id} : écran pas encore disponible`, 'avertissement');
      return;
    }
    const prefere = this.preferences.get('nouvelleFenetre');
    this.naviguer(url, { nouvelleFenetre: prefere ? !nouvelleFenetre : nouvelleFenetre });
  }

  #lien(e, milieu = false) {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.target || a.hasAttribute('download') || a.closest('.bandeau')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/') || a.getAttribute('href').startsWith('#') || url.protocol === 'blob:') return;
    e.preventDefault();
    this.naviguer(`${url.pathname}${url.search}${url.hash}`, { nouvelleFenetre: milieu || e.ctrlKey || e.shiftKey || e.metaKey });
  }

  #clavier(e) {
    const page = this.routeur?.page;
    // Raccourcis de l'application (personnalisables : /parametres/raccourcis).
    const fonctions = {
      enregistrer: page?.enregistrer && (() => page.enregistrer()),
      fenetres: () => this.listeFenetres(),
      accueil: () => this.naviguer('/'),
      retour: () => this.retour(),
      precedente: page?.precedent && (() => page.precedent()),
      suivante: page?.suivant && (() => page.suivant()),
      parametres: () => this.naviguer('/parametres'),
      raccourcis: () => this.naviguer('/parametres/raccourcis'),
    };
    const f = !e.defaultPrevented && fonctions[actionDe(e, 'application')];
    if (f) {
      e.preventDefault();
      Promise.resolve(f()).catch((x) => this.erreur(x));
      return;
    }
    const dialogue = document.querySelector('dialog[open], .fiche-dialogue-fond, .concepteur-fond, .liste-menu, .nav-dialogue-fond, .ged-dialogue-fond, .themes-fond, .tiroir:not([hidden])');
    if (e.key === 'Escape' && page?.echap && !dialogue && !e.defaultPrevented) page.echap();
  }

  // ---------------------------------------------------------------- page courante, fenêtres

  etatFenetre() {
    const p = this.routeur?.page;
    return { url: this.routeur?.cle ?? `${location.pathname}${location.search}`, titre: p?.titre ?? '', icone: p?.icone ?? '', modifiee: Boolean(p?.modifiee) };
  }

  /** Titre du document et annonce aux autres fenêtres quand la page, son titre ou ses modifications changent. */
  majPage() {
    const e = this.etatFenetre();
    const signature = `${e.url}|${e.titre}|${e.modifiee}`;
    document.title = `${e.modifiee ? '● ' : ''}${e.titre ? `${e.titre} – ` : ''}LogiBTP${this.societe && !this.societe.principale ? ` (${this.societe.libelle})` : ''}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.fenetres?.annoncer();
  }

  rendreInfos() {
    const s = this.societe;
    this.bandeau.infos(`${s ? `<span class="bandeau-societe" title="${echapper(s.principale ? 'Base principale' : `Base de la société ${s.libelle} (sous-domaine ${s.code})`)}">🏢 ${echapper(s.libelle)}</span>` : ''}
      ${this.#etatApi()}${this.#attentes()}
      ${this.session?.connecte ? `${this.#usurpation()}${this.#cloche()}<a href="/compte" title="${echapper(`${this.session.libelle ?? this.session.code} : mon compte, mot de passe, déconnexion`)}">👤 ${echapper(this.utilisateur())} · ${echapper(this.profil())}</a>`
        : '<a href="/connexion">👤 Se connecter</a>'}`);
  }

  /** État de l'API dans le bandeau : vert si connectée, rouge si elle ne répond plus. */
  #etatApi() {
    if (!this.apiPerdue) return '<span class="etat-api connectee" title="API connectée">● API</span>';
    const titre = pwaControle()
      ? "Serveur injoignable : les données déjà consultées sur ce poste s'affichent depuis le navigateur ; rien ne peut être enregistré. Nouvel essai toutes les 15 secondes."
      : "L'API ne répond plus : rien ne peut être enregistré. Nouvel essai toutes les 15 secondes.";
    return `<span class="etat-api deconnectee" title="${titre}">● Hors ligne</span>`;
  }

  /** Envoi des documents enregistrés hors ligne (API joignable, session ouverte). */
  envoyerAttentes() {
    if (this.apiPerdue || !this.session?.connecte) return;
    envoyerAttentes(this).catch((e) => console.warn('Envoi des documents hors ligne', e));
  }

  /** Documents enregistrés hors ligne du compte : relus pour le bandeau. */
  async majAttentes() {
    const compte = this.utilisateur();
    // Documents et opérations (saisies du terrain) : l'opération porte la page où sa saisie se reprend.
    this.attentes = compte ? [...await listeAttente(compte).catch(() => []), ...await listeOperations(compte).catch(() => [])] : [];
    this.rendreInfos();
  }

  /** Pastille du bandeau : documents enregistrés sur ce poste et pas encore envoyés (lien vers le plus ancien). */
  #attentes() {
    const l = this.attentes ?? [];
    if (!l.length) return '';
    const probleme = l.find((e) => e.etat !== ETAT_ATTENTE.ATTENTE);
    const titre = l.map((e) => `${e.libelle} : ${ETATS_ATTENTE[e.etat] ?? e.etat}${e.erreur ? ` (${e.erreur})` : ''}`).join('\n');
    const cible = probleme ?? l[0];
    return `<a href="${cible.url ?? urlAttente(cible)}" class="etat-attente${probleme ? ' probleme' : ''}" title="${echapper(`Enregistrés sur ce poste, pas encore envoyés au serveur :\n${titre}`)}">⏳ ${l.length}</a>`;
  }

  /** Passage hors ligne (API perdue) : bandeau rouge, classe `hors-ligne` du corps, contrôle toutes les 15 secondes. */
  #passerHorsLigne() {
    this.apiPerdue = true;
    document.body.classList.add('hors-ligne');
    clearInterval(this.minuterieApi);
    this.minuterieApi = setInterval(() => this.#verifierApi(), 15000);
  }

  /**
   * Requête vers l'API en échec réseau (ou erreur du relais) : l'API est contrôlée par `/api/sante` ; injoignable,
   * le bandeau passe en rouge et le contrôle est refait toutes les 15 secondes jusqu'au retour.
   */
  async #verifierApi() {
    if (this.verificationApi) return;
    this.verificationApi = true;
    try {
      const disponible = await api.disponible();
      if (disponible === !this.apiPerdue) return;
      if (!disponible) {
        this.#passerHorsLigne();
        this.message(pwaControle() ? 'Serveur injoignable : consultation des données gardées sur ce poste, enregistrements impossibles'
          : "L'API ne répond plus : les modifications ne peuvent pas être enregistrées", 'erreur');
      } else {
        this.apiPerdue = false;
        document.body.classList.remove('hors-ligne');
        clearInterval(this.minuterieApi);
        this.message('API de nouveau connectée', 'succes');
        this.envoyerAttentes();
      }
      this.rendreInfos();
    } finally {
      this.verificationApi = false;
    }
  }

  /** API injoignable au démarrage : écran d'attente, nouvel essai toutes les 15 secondes, puis rechargement. */
  #attendreApi() {
    this.apiPerdue = true;
    this.rendreInfos();
    document.querySelector('#pages').innerHTML = `<div class="page-simple"><h1>● Serveur injoignable</h1>
      <p class="aide">L'API LogiBTP ne répond pas. Nouvel essai toutes les 15 secondes : la page se rechargera à son retour.</p>
      <p class="aide">Pour travailler sans serveur, l'application doit avoir été ouverte en ligne sur ce poste, avec une session.</p>
      <p><button type="button" data-reessayer>⟳ Réessayer maintenant</button></p></div>`;
    const essayer = async () => { if (await api.disponible()) location.reload(); };
    document.querySelector('[data-reessayer]').addEventListener('click', essayer);
    setInterval(essayer, 15000);
  }

  /** Pastille d'usurpation du bandeau : compte usurpé, administrateur, fin ; clic = terminer. */
  #usurpation() {
    const us = this.session?.usurpation;
    if (!us) return '';
    const fin = formatHeure(us.fin);
    return `<button type="button" class="bandeau-usurpation" data-fin-usurpation title="${texteHtml('authentification_btp.usurpation.pastille_aide', { code: this.session.code, compte: us.libelle ?? us.code, fin, motif: us.motif })}">${iconeHtml('authentification_btp_usurpation')} ${texteHtml('authentification_btp.usurpation.pastille', { code: us.code, fin })} ${iconeHtml('retirer')}</button>`;
  }

  /** Cloche du bandeau : notifications non lues (rouge s'il y en a d'urgentes). */
  #cloche() {
    const c = this.notifications;
    if (!c) return `<a href="/notifications" title="${texteHtml('notifications_btp.boite.titre')}">${iconeHtml('notifications_btp_cloche')}</a>`;
    const titre = [pluriel('notifications_btp.cloche.non_lues', c.non_lues), pluriel('notifications_btp.cloche.a_traiter', c.a_traiter), ...(c.urgentes ? [pluriel('notifications_btp.cloche.urgentes', c.urgentes)] : [])].join(', ');
    return `<a href="/notifications" class="cloche${c.urgentes ? ' urgente' : ''}" title="${echapper(titre)}">${iconeHtml('notifications_btp_cloche')}${c.non_lues ? `<span class="compteur">${c.non_lues}</span>` : ''}</a>`;
  }

  message(texte, niveau = 'info') { this.bandeau?.message(texte, niveau); }

  erreur(e) {
    console.error(e);
    if (e instanceof ErreurApi) {
      const details = Array.isArray(e.details) ? ` : ${e.details.map((d) => d.message).join(' · ')}` : '';
      this.message(`${e.message}${details}`, 'erreur');
    } else this.message(e?.message ?? String(e), 'erreur');
  }

  /** Signalement demandé par une autre fenêtre : cadre clignotant et titre alterné. */
  signaler() {
    window.focus();
    document.querySelector('.nav-signal')?.remove();
    const s = document.createElement('div');
    s.className = 'nav-signal';
    s.innerHTML = `<span>🔔 ${echapper(this.routeur?.page?.titre || 'Cette fenêtre')}</span>`;
    document.body.append(s);
    setTimeout(() => s.remove(), 2600);
    const titre = document.title;
    let n = 0;
    clearInterval(this.clignotement);
    this.clignotement = setInterval(() => {
      document.title = n % 2 ? titre : `🔔 ${titre}`;
      if (++n > 9) { clearInterval(this.clignotement); document.title = titre; }
    }, 500);
  }

  listeFenetres() {
    if (this.panneauFenetres) return;
    this.panneauFenetres = new PanneauFenetres({
      fenetres: this.fenetres, fermerSession: () => this.fermerSession(), fermerFenetre: () => this.fermerFenetre(), message: (t, n) => this.message(t, n),
    });
    const precedent = this.fenetres.surListe;
    this.fenetres.surListe = (liste) => { precedent(liste); this.panneauFenetres?.rendre(liste); };
    this.panneauFenetres.surFerme = () => { this.panneauFenetres = null; this.fenetres.surListe = precedent; };
  }

  /**
   * Fermeture d'une page (fiche, document) : dans une fenêtre séparée ouverte par l'application, la fenêtre se ferme ;
   * sinon retour à la page précédente (ou `defaut`).
   */
  async fermerPage(defaut = '/') {
    if (window.opener) { await this.fermerFenetre(); return; }
    this.routeur.retour(defaut);
  }

  /** Fermeture de cette fenêtre (avertissement si des modifications sont en cours). */
  async fermerFenetre() {
    const page = this.routeur.page;
    if (page && !(await page.quitter())) return;
    await this.libererPage();
    this.fermetureForcee = true;
    window.close();
    setTimeout(() => {
      if (window.closed) return;
      this.fermetureForcee = false;
      this.message("Le navigateur ne laisse fermer par l'application que les fenêtres qu'elle a ouvertes : fermez celle-ci avec Ctrl+W", 'avertissement');
    }, 250);
  }

  /** Libère la page avant fermeture sans confirmation (verrou de fiche…). */
  async libererPage() {
    try { await this.routeur?.page?.liberer?.(); } catch { /* fermeture quand même */ }
  }

  /** Fermeture de la session complète : contrôle des modifications dans toutes les fenêtres, puis enregistrement. */
  async fermerSession() {
    const etats = await this.fenetres.etatFermeture();
    if (!(await confirmerFermetureSession(etats.filter((x) => x.modifiee)))) return;
    await this.libererPage();
    const fenetres = this.fenetres.fermerSession();
    await this.routeur.aller('/', { remplacer: true, forcer: true });
    this.message(`Session fermée (${fenetres.length} fenêtre${fenetres.length > 1 ? 's' : ''}) : « Restaurer ma session précédente » la rouvrira`, 'succes');
  }

  restaurerSession() {
    if (this.routeur.page?.restaurerSession) this.routeur.page.restaurerSession();
    else this.routeur.aller('/?restaurer=1');
  }

  // ---------------------------------------------------------------- échanges entre pages et fenêtres

  /** Abonnement d'une page à un sujet (ex. 'enregistre') ; renvoie la fonction de désabonnement. */
  abonner(sujet, f) {
    if (!this.abonnes.has(sujet)) this.abonnes.set(sujet, new Set());
    this.abonnes.get(sujet).add(f);
    return () => this.abonnes.get(sujet)?.delete(f);
  }

  /** Information publiée aux pages de cette fenêtre et des autres fenêtres de la session. */
  publier(sujet, contenu) { this.#notifier(sujet, contenu, true); }

  #notifier(sujet, contenu, diffuser) {
    for (const f of this.abonnes.get(sujet) ?? []) {
      try { f(contenu); } catch (e) { console.error(e); }
    }
    if (diffuser) this.fenetres.diffuser(sujet, contenu);
  }

  // ---------------------------------------------------------------- paramétrage (menu Paramètres)

  async gererThemes() {
    const s = await this.services();
    new GestionThemes({ fournisseur: s.liste, message: (t, n) => this.message(t, n), fermer: () => this.publier(SUJET_FENETRE.THEMES, {}) });
  }

  async parametrerFiche(type) {
    const s = await this.services();
    const definition = await s.fiche.definition(type);
    new ParametrageFiche({ fournisseur: s.fiche, type, definition, message: (t, n) => this.message(t, n), fermer: () => {} });
  }
}

export { api };
