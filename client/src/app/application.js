import { Routeur, GestionFenetres, Preferences, afficherApercu } from '@logibtp/navigation';
import { accesSousArbre, autorise } from '@logibtp/droits';
import { Bandeau, PanneauFenetres, confirmerFermetureSession } from '@logibtp/navigation/ui';
import { GestionThemes } from '@logibtp/liste/ui';
import { ParametrageFiche } from '@logibtp/fiche/ui';
import { echapper, appliquerTheme, actionDe, definirAideRaccourcis } from '@logibtp/socle/ui';
import './raccourcis.js';
import { api, ErreurApi } from './api.js';
import { creerFournisseurListe, donneesDemo, estTypeDocument, LIBELLES_ELEMENTS } from './listes.js';
import { creerFournisseurFiche } from './fiches/fiches.js';
import { ficheDeLigne } from './fiches/definitions.js';
import { creerFournisseurGed } from './ged/ged.js';
import { creerFournisseurBibliotheque } from './bibliotheque/bibliotheque.js';
import { creerFournisseurAnnuaire, creerFournisseurEntreprises, relierTarifs } from './annuaire/annuaire.js';
import { creerFournisseurStructure } from './structure/structure.js';
import { DEFINITION_DEMO } from './demo.js';
import { societeCourante } from './societe.js';
import { menus } from './navigation/menus.js';
import { ROUTES } from './pages/index.js';

// Application web LogiBTP (cœur) : services partagés par les pages, routeur (navigation classique dans la
// fenêtre), fenêtres séparées et session (module Navigation), bandeau à menus.

const LOGO = `<svg viewBox="0 0 104 24" role="img" aria-label="LogiBTP"><g fill="currentColor">
  <rect x="1" y="13" width="9" height="9" rx="1"/><rect x="11" y="13" width="9" height="9" rx="1" opacity=".75"/><rect x="6" y="3" width="9" height="9" rx="1" opacity=".55"/></g>
  <text x="25" y="18" font-family="system-ui, Segoe UI, sans-serif" font-size="15" font-weight="700" fill="currentColor">Logi<tspan fill="#e8a33d">BTP</tspan></text></svg>`;

/** Pour une fiche, la liste où revenir quand elle a été ouverte directement (fenêtre séparée, session restaurée). */
export const LISTE_PAR_TYPE = {
  salarie: '/liste/salaries', materiel: '/liste/materiels', element: '/liste/bibliotheque', personne: '/liste/tiers', individu: '/liste/contacts',
  projet: '/liste/projets', affaire: '/liste/affaires', chantier: '/liste/chantiers', marche: '/liste/marches',
};

export class Application {
  constructor() {
    this.enLigne = false;
    this.societe = null;
    this.preferences = new Preferences('logibtp.navigation', { nouvelleFenetre: false, profilDemo: 'ADMIN', theme: 'auto' });
    appliquerTheme(this.preferences.get('theme'));
    // Thème changé dans une autre fenêtre de la session (même localStorage) : appliqué ici aussi.
    window.addEventListener('storage', (e) => {
      if (e.key !== 'logibtp.navigation') return;
      this.preferences = new Preferences('logibtp.navigation', this.preferences.defauts);
      appliquerTheme(this.preferences.get('theme'));
    });
    this.abonnes = new Map(); // sujet → Set(fonction)
    this.servicesPrets = null;
  }

  async demarrer() {
    // Rechargement (F5, Vite) : la page quittée reste affichée pendant le démarrage au lieu d'un écran vide.
    afficherApercu(document.querySelector('#pages'), `${location.pathname}${location.search}`);
    this.bandeau = new Bandeau(document.querySelector('#bandeau'), {
      menus: menus(this), naviguer: (url, o) => this.naviguer(url, o), logo: LOGO, titreApplication: 'LogiBTP',
    });
    this.enLigne = await api.disponible();
    document.body.classList.toggle('hors-ligne', !this.enLigne);
    this.societe = await societeCourante(this.enLigne);
    // Session (module Authentification) : sans session, seule la page de connexion s'ouvre ; mot de passe provisoire :
    // page Mon compte jusqu'au changement. Hors ligne (démo) : pas de connexion, profil choisi dans les paramètres.
    this.session = this.enLigne ? await api.auth.session().catch(() => null) : null;
    this.#surveillerSession();
    const ici = `${location.pathname}${location.search}`;
    const publique = location.pathname === '/borne';
    if (this.enLigne && !this.session?.connecte && location.pathname !== '/connexion' && !publique) history.replaceState(null, '', `/connexion?retour=${encodeURIComponent(ici)}`);
    else if (this.session?.mdp_a_changer && location.pathname !== '/compte') history.replaceState(null, '', '/compte?changer=1');
    if (!this.enLigne || this.session?.connecte) await this.chargerModules();
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
    this.abonner('session', (e) => this.#sessionChangee(e));
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('[data-fin-usurpation]') && confirm('Terminer l\'usurpation et revenir à votre compte ?')) this.terminerUsurpation().catch((x) => this.erreur(x));
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
    await this.routeur.demarrer();
  }

  // ---------------------------------------------------------------- services partagés par les pages

  /** Fournisseurs des modules (API ou démo hors ligne), créés à la première page qui en a besoin. */
  services() {
    this.servicesPrets ??= (async () => {
      const lignes = donneesDemo();
      const ged = await creerFournisseurGed({ enLigne: this.enLigne, lignes });
      const bibliotheque = creerFournisseurBibliotheque({ enLigne: this.enLigne, utilisateur: this.utilisateur(), profil: this.preferences.get('profilDemo') });
      const elements = this.enLigne ? [] : bibliotheque.elements;
      const annuaire = creerFournisseurAnnuaire({ enLigne: this.enLigne, utilisateur: this.utilisateur(), profil: this.preferences.get('profilDemo'), salaries: lignes.salaries });
      const entreprises = creerFournisseurEntreprises({ enLigne: this.enLigne });
      if (!this.enLigne) relierTarifs(bibliotheque);
      // Structure des affaires (projets, affaires, chantiers, marchés) : hors ligne, mêmes lignes pour les listes et les fiches.
      let liste = null;
      const structure = creerFournisseurStructure({ enLigne: this.enLigne, annuaire, documents: () => liste?.sourcesDonnees?.documents?.lignes ?? [] });
      liste = creerFournisseurListe({ enLigne: this.enLigne, ged, elements, annuaire: this.enLigne ? null : annuaire, structure: this.enLigne ? null : structure });
      const fiche = creerFournisseurFiche({
        enLigne: this.enLigne, lignes, bibliotheque: this.enLigne ? null : bibliotheque, annuaire: this.enLigne ? null : annuaire, structure: this.enLigne ? null : structure,
      });
      if (!this.enLigne) {
        fiche.profil = this.preferences.get('profilDemo');
        ged.profil = this.preferences.get('profilDemo');
        // Démo : comme SpecialisationListeBtp côté serveur, une fiche en cours de modification bloque la saisie dans la liste.
        liste.verifierModification = (source, id) => {
          const type = { salaries: 'salarie', materiels: 'materiel' }[source];
          const v = type && fiche.verrouActif(type, id);
          if (v) throw Object.assign(new Error(`Fiche en cours de modification par ${v.utilisateur} : saisie impossible pour l'instant`), { code: 'FICHE_EN_MODIFICATION', statut: 409 });
        };
      }
      return { liste, fiche, ged, bibliotheque, annuaire, entreprises, structure };
    })();
    return this.servicesPrets;
  }

  /**
   * Modules activés pour la société (db/193 : module_societe) : menus et écrans des modules désactivés masqués ;
   * hors ligne, tous les modules sont actifs. Rappelée après un changement d'activation.
   */
  async chargerModules() {
    this.modules = new Map();
    if (this.enLigne) {
      try { for (const m of await api.modules()) this.modules.set(m.code, m.actif); } catch { /* table absente : tout est actif */ }
      try { this.typesActifs = new Set((await api.typesDocument()).map((t) => t.tyd_code)); } catch { this.typesActifs = null; }
      // Droits du profil (module Droits) : menus et commandes masqués ; le serveur reste seul juge.
      try { this.droits = await api.droits.moi(); } catch { this.droits = null; }
    }
    if (this.bandeau) { this.bandeau.menus = menus(this); this.bandeau.rendre(); }
  }

  /** Module actif pour la société (inconnu : actif). */
  moduleActif(code) { return this.modules?.get(code) ?? true; }

  /** Type de document actif (types non chargés, hors ligne : actif). */
  typeActif(code) { return !this.typesActifs || this.typesActifs.has(code); }

  /** Accès à un nœud du module Droits (au moins une action sur lui ou ses descendants) ; hors ligne ou droits inconnus : oui. */
  acces(noeud, ecriture = false) { return !this.droits || accesSousArbre(this.droits, noeud, ecriture); }

  /** Action permise sur un nœud du module Droits (au moins la portée demandée) ; hors ligne ou droits inconnus : oui. */
  peut(noeud, action, portee = 'SOI') { return !this.droits || autorise(this.droits, noeud, action, portee); }

  // Usurpation (module Authentification) : l'application est celle du compte usurpé (profil, droits, menus).
  profil() { return this.enLigne ? (this.session?.usurpation?.profil ?? this.session?.profil ?? '') : this.preferences.get('profilDemo'); }
  utilisateur() { return this.enLigne ? (this.session?.usurpation?.code ?? this.session?.code ?? '') : 'demo'; }

  /** Usurpation d'un compte par un administrateur (motif obligatoire) : l'application est rechargée sous ce compte. */
  async usurper(identifiant, motif) {
    this.session = await api.auth.usurper(identifiant, motif);
    this.publier('session', { connecte: true });
    location.assign('/');
  }

  /** Fin de l'usurpation : retour au compte de l'administrateur. */
  async terminerUsurpation() {
    this.session = await api.auth.finUsurpation();
    this.publier('session', { connecte: true });
    location.assign('/parametres/comptes');
  }
  estAdmin() { return this.profil() === 'ADMIN'; }
  peutGererThemes() { return !this.enLigne || this.estAdmin(); }

  /** Thème d'affichage : 'auto' (système), 'clair' ou 'sombre' ; gardé dans le navigateur pour toutes les fenêtres. */
  changerTheme(theme) {
    this.preferences.set('theme', theme);
    appliquerTheme(theme);
  }

  async changerProfilDemo(profil) {
    this.preferences.set('profilDemo', profil);
    const s = await this.services();
    s.fiche.profil = profil;
    s.ged.profil = profil;
    if ('profil' in s.bibliotheque) s.bibliotheque.profil = profil;
    if ('profil' in s.annuaire) s.annuaire.profil = profil;
    this.rendreInfos();
    this.message(`Profil de démonstration : ${profil}`);
  }

  // ---------------------------------------------------------------- session (module Authentification)

  /**
   * Réponses 401 SESSION_REQUISE et 403 MDP_A_CHANGER de l'API (tous les fournisseurs passent par fetch) : page de
   * connexion, ou page Mon compte pour changer le mot de passe provisoire.
   */
  #surveillerSession() {
    if (!this.enLigne || window.fetch.surveille) return;
    const origine = window.fetch.bind(window);
    const surveille = async (entree, init) => {
      const r = await origine(entree, init);
      if (r.status === 401 || r.status === 403) {
        const url = typeof entree === 'string' ? entree : entree?.url ?? '';
        if (url.includes('/api/') && !url.includes('/api/auth/')) {
          const code = await r.clone().json().then((d) => d?.code).catch(() => null);
          if (code === 'SESSION_REQUISE') this.#sessionPerdue();
          else if (code === 'MDP_A_CHANGER' && location.pathname !== '/compte') this.naviguer('/compte?changer=1');
        }
      }
      return r;
    };
    surveille.surveille = true;
    window.fetch = surveille;
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
    this.abonner('compteur-notifications', (c) => { this.notifications = c; this.rendreInfos(); });
  }

  /** Nouveau compteur de notifications : bandeau de cette fenêtre et des autres. */
  majNotifications(c, diffuser = true) {
    const change = JSON.stringify(c) !== JSON.stringify(this.notifications);
    this.notifications = c;
    if (change) this.rendreInfos();
    if (diffuser) this.publier('compteur-notifications', c);
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
    this.publier('session', { connecte: false });
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
    this.definitionDoc ??= this.enLigne ? api.definition('V_DEVIS') : Promise.resolve(DEFINITION_DEMO);
    return this.definitionDoc;
  }

  /** URL de l'écran d'un élément de liste (document, fiche, document GED), null si aucun écran. */
  urlElement({ id, type }) {
    if (estTypeDocument(type)) {
      return this.enLigne ? `/document/${id}` : null;
    }
    if (type === 'document_ged') return `/ged/${id}`;
    if (type === 'pointage') return `/pointage/saisie?pointage=${id}`;
    if (type === 'mouvement_stock') return this.enLigne ? `/stock/mouvement/${id}` : null;
    const f = ficheDeLigne({ id, type });
    return f ? `/fiche/${f.type}/${f.id}` : null;
  }

  /** Ouverture depuis une liste : préférence « nouvelle fenêtre », inversée par Ctrl / Maj. */
  ouvrirElement(element, { nouvelleFenetre = false } = {}) {
    const url = this.urlElement(element);
    if (!url) {
      const quoi = estTypeDocument(element.type) ? "Hors ligne : les documents s'ouvrent depuis la base, l'API est indisponible" : `Fiche ${LIBELLES_ELEMENTS[element.type] ?? element.type} n° ${element.id} : écran pas encore disponible`;
      this.message(quoi, 'avertissement');
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
      parametres: () => this.naviguer('/parametres'),
      raccourcis: () => this.naviguer('/parametres/raccourcis'),
    };
    const f = !e.defaultPrevented && fonctions[actionDe(e, 'application')];
    if (f) {
      e.preventDefault();
      Promise.resolve(f()).catch((x) => this.erreur(x));
      return;
    }
    const dialogue = document.querySelector('.fiche-dialogue-fond, .concepteur-fond, .liste-menu, .nav-dialogue-fond, .ged-dialogue-fond, .themes-fond, .tiroir:not([hidden])');
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
      <span title="${this.enLigne ? 'API connectée' : 'Démo hors ligne : données de démonstration, calcul local'}">${this.enLigne ? '● API' : '○ Démo'}</span>
      ${!this.enLigne ? `<a href="/parametres" title="Profil de démonstration (Paramètres)">👤 ${echapper(this.utilisateur())} · ${echapper(this.profil())}</a>`
        : this.session?.connecte ? `${this.#usurpation()}${this.#cloche()}<a href="/compte" title="${echapper(`${this.session.libelle ?? this.session.code} : mon compte, mot de passe, déconnexion`)}">👤 ${echapper(this.utilisateur())} · ${echapper(this.profil())}</a>`
        : '<a href="/connexion">👤 Se connecter</a>'}`);
  }

  /** Pastille d'usurpation du bandeau : compte usurpé, administrateur, fin ; clic = terminer. */
  #usurpation() {
    const us = this.session?.usurpation;
    if (!us) return '';
    const fin = new Date(us.fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `<button type="button" class="bandeau-usurpation" data-fin-usurpation title="${echapper(`${this.session.code} agit pour ${us.libelle ?? us.code} jusqu'à ${fin} : ${us.motif}. Cliquer pour terminer.`)}">🎭 ${echapper(us.code)} · fin ${fin} ✕</button>`;
  }

  /** Cloche du bandeau : notifications non lues (rouge s'il y en a d'urgentes). */
  #cloche() {
    const c = this.notifications;
    if (!c) return '<a href="/notifications" title="Notifications">🔔</a>';
    const titre = `${c.non_lues} non lue(s), ${c.a_traiter} à traiter${c.urgentes ? `, ${c.urgentes} urgente(s)` : ''}`;
    return `<a href="/notifications" class="cloche${c.urgentes ? ' urgente' : ''}" title="${titre}">🔔${c.non_lues ? `<span class="compteur">${c.non_lues}</span>` : ''}</a>`;
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
    new GestionThemes({ fournisseur: s.liste, message: (t, n) => this.message(t, n), fermer: () => this.publier('themes', {}) });
  }

  async parametrerFiche(type) {
    const s = await this.services();
    const definition = await s.fiche.definition(type);
    new ParametrageFiche({ fournisseur: s.fiche, type, definition, message: (t, n) => this.message(t, n), fermer: () => {} });
  }
}

export { api };
