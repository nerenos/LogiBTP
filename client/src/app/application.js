import { Routeur, GestionFenetres, Preferences } from '@logibtp/navigation';
import { Bandeau, PanneauFenetres, confirmerFermetureSession } from '@logibtp/navigation/ui';
import { GestionThemes } from '@logibtp/liste/ui';
import { ParametrageFiche } from '@logibtp/fiche/ui';
import { echapper, appliquerTheme } from '@logibtp/socle/ui';
import { api, ErreurApi, ENTETES } from './api.js';
import { DOCUMENT_DEMO } from './demo.js';
import { creerFournisseurListe, donneesDemo, estTypeDocument, LIBELLES_ELEMENTS } from './listes.js';
import { creerFournisseurFiche } from './fiches/fiches.js';
import { ficheDeLigne } from './fiches/definitions.js';
import { creerFournisseurGed } from './ged/ged.js';
import { creerFournisseurBibliotheque } from './bibliotheque/bibliotheque.js';
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
export const LISTE_PAR_TYPE = { salarie: '/liste/salaries', materiel: '/liste/materiels', element: '/liste/bibliotheque' };

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
    this.bandeau = new Bandeau(document.querySelector('#bandeau'), {
      menus: menus(this), naviguer: (url, o) => this.naviguer(url, o), logo: LOGO, titreApplication: 'LogiBTP',
    });
    this.enLigne = await api.disponible();
    document.body.classList.toggle('hors-ligne', !this.enLigne);
    this.societe = await societeCourante(this.enLigne);
    this.rendreInfos();

    this.fenetres = new GestionFenetres({
      etat: () => this.etatFenetre(),
      surListe: () => {},
      surSignal: () => this.signaler(),
      surFermetureSession: () => this.libererPage(),
      surDonnees: (sujet, contenu) => this.#notifier(sujet, contenu, false),
    });
    await this.fenetres.demarrer();

    this.routeur = new Routeur({ routes: ROUTES, conteneur: document.querySelector('#pages'), app: this, surPage: () => this.majPage() });
    window.addEventListener('beforeunload', (e) => {
      if (this.routeur.page?.modifiee && !this.fenetres.fermetureSession && !this.fermetureForcee) { e.preventDefault(); e.returnValue = ''; }
    });
    // Onglet ou fenêtre réellement quitté (après l'avertissement éventuel) : la page libère son verrou (requête keepalive).
    window.addEventListener('pagehide', () => { this.libererPage(); });
    // Liens internes : navigation dans la fenêtre (Ctrl, Maj ou clic milieu : nouvelle fenêtre).
    document.addEventListener('click', (e) => this.#lien(e));
    document.addEventListener('auxclick', (e) => { if (e.button === 1) this.#lien(e, true); });
    document.addEventListener('keydown', (e) => this.#clavier(e));
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
      const liste = creerFournisseurListe({ enLigne: this.enLigne, demo: DOCUMENT_DEMO, ged, elements });
      const fiche = creerFournisseurFiche({ enLigne: this.enLigne, lignes, bibliotheque: this.enLigne ? null : bibliotheque });
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
      return { liste, fiche, ged, bibliotheque };
    })();
    return this.servicesPrets;
  }

  profil() { return this.enLigne ? ENTETES['X-Profil'] : this.preferences.get('profilDemo'); }
  utilisateur() { return ENTETES['X-Utilisateur'] ?? 'demo'; }
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
    this.rendreInfos();
    this.message(`Profil de démonstration : ${profil}`);
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
      if (this.enLigne) return `/document/${id}`;
      return Number(id) === DOCUMENT_DEMO.document.ent_id ? '/document/demo' : null;
    }
    if (type === 'document_ged') return `/ged/${id}`;
    const f = ficheDeLigne({ id, type });
    return f ? `/fiche/${f.type}/${f.id}` : null;
  }

  /** Ouverture depuis une liste : préférence « nouvelle fenêtre », inversée par Ctrl / Maj. */
  ouvrirElement(element, { nouvelleFenetre = false } = {}) {
    const url = this.urlElement(element);
    if (!url) {
      const quoi = estTypeDocument(element.type) ? "Démo hors ligne : seul le devis de démonstration s'ouvre" : `Fiche ${LIBELLES_ELEMENTS[element.type] ?? element.type} n° ${element.id} : écran pas encore disponible`;
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
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); this.listeFenetres(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's' && page?.enregistrer) {
      e.preventDefault();
      Promise.resolve(page.enregistrer()).catch((x) => this.erreur(x));
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
      <a href="/parametres" title="Profil de l'utilisateur (Paramètres)">👤 ${echapper(this.utilisateur())} · ${echapper(this.profil())}</a>`);
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

export { api, DOCUMENT_DEMO };
