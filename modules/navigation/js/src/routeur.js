// Routeur de l'application : routes déclarées par le cœur (chemins à paramètres), navigation classique par
// l'historique du navigateur (précédent / suivant), garde avant de quitter une page qui a des modifications en
// cours, pages conservées en mémoire (une liste retrouve ses lignes et sa position au retour d'une fiche).
import { texte } from '@logibtp/socle/dictionnaire';

/** Paramètres d'un chemin déclaré ('/fiche/:type/:id', ':x?' facultatif) pour un pathname, ou null. */
export function correspondre(chemin, pathname) {
  const modele = chemin.split('/').filter(Boolean);
  const parties = pathname.split('/').filter(Boolean);
  if (parties.length > modele.length) return null;
  const params = {};
  for (let i = 0; i < modele.length; i++) {
    const m = modele[i];
    const v = parties[i];
    if (m.startsWith(':')) {
      const facultatif = m.endsWith('?');
      const nom = m.slice(1).replace(/\?$/, '');
      if (v === undefined) {
        if (!facultatif) return null;
        continue;
      }
      try { params[nom] = decodeURIComponent(v); } catch { return null; }
    } else if (m !== v) return null;
  }
  return params;
}

/** URL d'un chemin déclaré : paramètres remplacés (les facultatifs absents sont omis), requête ajoutée. */
export function construire(chemin, params = {}, requete = {}) {
  const parties = chemin.split('/').filter(Boolean).map((m) => {
    if (!m.startsWith(':')) return m;
    const nom = m.slice(1).replace(/\?$/, '');
    const v = params[nom];
    if (v === undefined || v === null || v === '') {
      if (m.endsWith('?')) return null;
      throw new Error(`Paramètre ${nom} manquant pour ${chemin}`);
    }
    return encodeURIComponent(String(v));
  }).filter((p) => p !== null);
  const q = new URLSearchParams(Object.entries(requete).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => [k, String(v)]));
  return `/${parties.join('/')}${q.size ? `?${q}` : ''}`;
}

/** Découpe une URL relative (pathname, requête). */
export function analyser(url) {
  const u = new URL(url, 'http://x');
  return { pathname: u.pathname, requete: Object.fromEntries(u.searchParams), url: `${u.pathname}${u.search}` };
}

/** Positions de défilement d'un élément et de ses descendants : [{ chemin (indices d'enfants), classe, haut, gauche }]. */
export function defilements(racine, max = 50) {
  if (!racine?.querySelectorAll) return [];
  const res = [];
  for (const el of [racine, ...racine.querySelectorAll('*')]) {
    if (!el.scrollTop && !el.scrollLeft) continue;
    const chemin = [];
    for (let e = el; e !== racine; e = e.parentElement) chemin.unshift([...e.parentElement.children].indexOf(e));
    res.push({ chemin, classe: el.className, haut: el.scrollTop, gauche: el.scrollLeft });
    if (res.length >= max) break;
  }
  return res;
}

/** Réapplique des positions de défilement (élément retrouvé par son chemin et sa classe, ignoré sinon). */
export function appliquerDefilements(racine, liste = []) {
  for (const d of liste) {
    let el = racine;
    for (const i of d.chemin) el = el?.children[i];
    if (!el || el.className !== d.classe) continue;
    el.scrollTop = d.haut;
    el.scrollLeft = d.gauche;
  }
}

/** Clé (sessionStorage, propre à l'onglet du navigateur) de l'aperçu de la page gardé pendant un rechargement (recopiée dans client/public/demarrage-apercu.js). */
export const CLE_APERCU = 'logibtp.apercu';
/** Clé (sessionStorage) de l'état d'affichage gardé pendant un rechargement (history.replaceState est ignoré dans pagehide). */
export const CLE_AFFICHAGE = 'logibtp.etat-affichage';
const TAILLE_MAX_APERCU = 1_500_000;

/**
 * Rechargement de la fenêtre : affiche tout de suite la copie de la page quittée (inerte, par-dessus), au lieu d'un
 * écran vide pendant le démarrage. Le routeur la retire quand la vraie page est ouverte (délai de secours sinon).
 */
export function afficherApercu(conteneur, url, { stockage = globalThis.sessionStorage, delaiMax = 10000 } = {}) {
  let a = null;
  try { a = JSON.parse(stockage?.getItem(CLE_APERCU) ?? 'null'); stockage?.removeItem(CLE_APERCU); } catch { return null; }
  if (!a || a.url !== url || !conteneur?.ownerDocument) return null;
  // Déjà posé par un script de la page HTML (avant le chargement des modules) : seulement le défilement.
  let el = conteneur.querySelector?.(':scope > .page-apercu');
  if (!el) {
    el = conteneur.ownerDocument.createElement('div');
    el.className = 'page-apercu';
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = a.html;
    conteneur.append(el);
  }
  appliquerDefilements(el.firstElementChild, a.defilement);
  setTimeout(() => el.remove(), delaiMax);
  return el;
}

/**
 * Page de l'application (classe mère). Le routeur la crée pour une route, l'ouvre dans son conteneur, lui demande
 * avant de la quitter (modifications en cours), la masque si elle est conservée, puis la ferme.
 *   titre        : titre de la fenêtre et de la liste des fenêtres
 *   modifiee     : modifications non enregistrées (avertissement avant fermeture, indicateur ● dans les fenêtres)
 *   static conserver : la page reste en mémoire quand on la quitte (retour à l'identique)
 */
export class PageBase {
  static conserver = false;

  constructor({ conteneur, params = {}, requete = {}, app = null, route = null, affichage = null }) {
    this.conteneur = conteneur;
    this.params = params;
    this.requete = requete;
    this.app = app;
    this.route = route;
    this.titre = route?.titre ?? '';
    // État d'affichage mémorisé pour cette entrée d'historique (rechargement, retour) : repris par ouvrir().
    this.affichage = affichage;
  }

  async ouvrir() {}

  /** État d'affichage à retrouver après un rechargement ou un retour (onglet actif…) : objet JSON ou null. */
  etatAffichage() { return null; }

  get modifiee() { return false; }

  /**
   * Question posée avant de quitter une page modifiée : promesse de true pour quitter. Par défaut confirm() du
   * navigateur ; l'application la remplace par sa fenêtre <dialog> (`PageBase.confirmer = …`).
   */
  static confirmer = (message) => Promise.resolve(globalThis.confirm?.(message) ?? true);

  /** Avant de quitter : false pour rester (confirmation refusée). */
  async quitter() {
    return !this.modifiee || PageBase.confirmer(texte('navigation.page.quitter_modifiee', { titre: this.titre }));
  }

  /** Page conservée : affichée de nouveau (rafraîchissement éventuel). */
  async reprendre() {}

  masquer() {}

  /** Libération (verrous, minuteries, écouteurs). */
  fermer() {}

  /** URL actuelle de la page (une liste y reporte son thème et sa vue). */
  urlCourante() { return null; }
}

/**
 * Routeur. routes : [{ nom, chemin, page: ClassePage, titre }]. historique / emplacement : window.history et
 * window.location, stockage : window.sessionStorage (remplaçables pour les tests).
 */
export class Routeur {
  constructor({ routes, conteneur, app = null, historique = globalThis.history, emplacement = globalThis.location, stockage = globalThis.sessionStorage, surPage = null, maxConservees = 3 }) {
    this.routes = routes;
    this.conteneur = conteneur;
    this.app = app;
    this.historique = historique;
    this.emplacement = emplacement;
    this.stockage = stockage;
    this.surPage = surPage;
    this.maxConservees = maxConservees;
    this.page = null;
    this.cle = null;
    this.conservees = new Map(); // clé (URL) → { page, element }
    this.index = 0;
    this.ignorerPopstate = false;
    this.enCours = Promise.resolve();
  }

  trouver(url) {
    const { pathname, requete, url: propre } = analyser(url);
    for (const route of this.routes) {
      const params = correspondre(route.chemin, pathname);
      if (params) return { route, params, requete, url: propre };
    }
    return null;
  }

  url(nom, params, requete) {
    const route = this.routes.find((r) => r.nom === nom);
    if (!route) throw new Error(`Route ${nom} inconnue`);
    return construire(route.chemin, params, requete);
  }

  demarrer() {
    this.index = this.historique.state?.index ?? 0;
    if (this.historique.state?.index === undefined) this.historique.replaceState({ index: 0 }, '', this.#urlEmplacement());
    this.#reprendreAffichage();
    globalThis.addEventListener?.('popstate', (e) => this.surPopstate(e));
    return this.#afficher(this.#urlEmplacement());
  }

  /** Rechargement : état d'affichage mémorisé par pagehide replacé dans l'entrée d'historique courante. */
  #reprendreAffichage() {
    let m = null;
    try { m = JSON.parse(this.stockage?.getItem(CLE_AFFICHAGE) ?? 'null'); this.stockage?.removeItem(CLE_AFFICHAGE); } catch { return; }
    if (m?.index !== this.index || m.affichage?.url !== this.#urlEmplacement()) return;
    this.historique.replaceState({ ...this.historique.state, affichage: m.affichage }, '', this.#urlEmplacement());
  }

  #urlEmplacement() { return `${this.emplacement.pathname}${this.emplacement.search}`; }

  /** Navigation dans la fenêtre : garde de la page courante, puis nouvelle entrée d'historique (ou remplacement). */
  aller(url, { remplacer = false, forcer = false } = {}) {
    this.enCours = this.enCours.then(async () => {
      if (url === this.cle && !remplacer && !forcer) return true;
      // forcer : sans demander à la page (fermeture de session, modifications déjà abandonnées).
      if (!forcer && !(await this.#quitterPage())) return false;
      // Onglet et défilement de la page quittée : retrouvés au retour (précédent du navigateur).
      if (!remplacer) this.memoriserAffichage();
      if (remplacer) this.historique.replaceState({ index: this.index }, '', url);
      else this.historique.pushState({ index: ++this.index }, '', url);
      await this.#afficher(url, { dejaQuittee: true });
      return true;
    });
    return this.enCours;
  }

  /** Retour à la page précédente de cette fenêtre, sinon à l'URL par défaut (fiche ouverte directement). */
  retour(defaut = '/') {
    if (this.index > 0) this.historique.back();
    else this.aller(defaut, { remplacer: true });
  }

  /** Met à jour l'URL de la page courante sans navigation (thème ou vue changés dans une liste). */
  remplacerUrl(url) {
    if (url === this.cle) return;
    const c = this.conservees.get(this.cle);
    if (c) { this.conservees.delete(this.cle); this.conservees.set(url, c); }
    this.cle = url;
    this.historique.replaceState({ index: this.index }, '', url);
    this.surPage?.(this.page);
  }

  /** État d'affichage de la page courante (onglet, défilement) gardé dans son entrée d'historique. */
  memoriserAffichage() {
    if (!this.page || !this.cle) return null;
    let page = null;
    try { page = this.page.etatAffichage(); } catch { /* état facultatif */ }
    const affichage = { url: this.cle, page, defilement: defilements(this.page.conteneur) };
    this.historique.replaceState({ ...this.historique.state, index: this.index, affichage }, '', this.cle);
    return affichage;
  }

  /**
   * Fenêtre quittée ou rechargée (pagehide) : état d'affichage dans l'historique (conservé par le rechargement) et
   * copie de la page pour l'aperçu affiché pendant le redémarrage (afficherApercu).
   */
  memoriser() {
    const stockage = this.stockage;
    const affichage = this.memoriserAffichage();
    const html = this.page?.conteneur?.outerHTML;
    try {
      if (affichage) stockage?.setItem(CLE_AFFICHAGE, JSON.stringify({ index: this.index, affichage }));
      if (affichage && html && html.length <= TAILLE_MAX_APERCU) stockage?.setItem(CLE_APERCU, JSON.stringify({ url: this.cle, html, defilement: affichage.defilement }));
      else stockage?.removeItem(CLE_APERCU);
    } catch { /* stockage plein ou indisponible : pas d'aperçu */ }
  }

  /** Précédent / suivant du navigateur (écouteur popstate). */
  async surPopstate(e) {
    if (this.ignorerPopstate) { this.ignorerPopstate = false; return; }
    const nouvelIndex = e.state?.index ?? 0;
    const url = this.#urlEmplacement();
    this.enCours = this.enCours.then(async () => {
      if (!(await this.#quitterPage())) {
        // Rester : revenir à l'entrée quittée sans recharger la page.
        const delta = this.index - nouvelIndex;
        if (delta) { this.ignorerPopstate = true; this.historique.go(delta); }
        return;
      }
      this.index = nouvelIndex;
      await this.#afficher(url, { dejaQuittee: true });
    });
    return this.enCours;
  }

  async #quitterPage() {
    if (!this.page) return true;
    return this.page.quitter();
  }

  async #afficher(url, { dejaQuittee = false } = {}) {
    const cible = this.trouver(url) ?? this.trouver('/404');
    const ancienne = this.page;
    const ancienneCle = this.cle;
    if (ancienne) {
      if (!dejaQuittee && !(await ancienne.quitter())) return;
      if (ancienne.constructor.conserver && this.conservees.has(ancienneCle)) {
        ancienne.masquer();
        this.conservees.get(ancienneCle).element.hidden = true;
      } else ancienne.fermer();
    }
    this.cle = cible.url;
    const conservee = this.conservees.get(cible.url);
    if (conservee) {
      this.page = conservee.page;
      conservee.element.hidden = false;
      // Plus récente en dernier (éviction de la plus ancienne).
      this.conservees.delete(cible.url);
      this.conservees.set(cible.url, conservee);
      await this.page.reprendre();
    } else {
      const element = this.conteneur.ownerDocument.createElement('div');
      element.className = `page page-${cible.route.nom}`;
      this.conteneur.append(element);
      const Page = cible.route.page;
      // Entrée d'historique déjà affichée (rechargement, précédent / suivant) : onglet et défilement retrouvés.
      const memo = this.historique.state?.affichage;
      const affichage = memo?.url === cible.url ? memo : null;
      this.page = new Page({ conteneur: element, params: cible.params, requete: cible.requete, app: this.app, route: cible.route, affichage: affichage?.page ?? null });
      if (Page.conserver) {
        this.conservees.set(cible.url, { page: this.page, element });
        this.#evincer();
      }
      try {
        await this.page.ouvrir();
      } catch (e) {
        this.#nettoyer();
        this.surPage?.(this.page);
        throw e;
      }
      if (affichage?.defilement?.length) {
        appliquerDefilements(element, affichage.defilement);
        // Contenu mis en page après coup (grilles, hauteurs calculées) : seconde application.
        globalThis.requestAnimationFrame?.(() => appliquerDefilements(element, affichage.defilement));
      }
    }
    this.#nettoyer();
    this.surPage?.(this.page);
  }

  /** Retire les éléments qui ne sont ni la page courante ni une page conservée (ancienne page, aperçu de rechargement). */
  #nettoyer() {
    for (const el of [...this.conteneur.children]) {
      if (![...this.conservees.values()].some((c) => c.element === el) && el !== this.page?.conteneur) el.remove();
    }
  }

  #evincer() {
    while (this.conservees.size > this.maxConservees) {
      const [cle, { page, element }] = this.conservees.entries().next().value;
      if (page === this.page) break;
      this.conservees.delete(cle);
      page.fermer();
      element.remove();
    }
  }
}
