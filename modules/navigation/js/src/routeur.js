// Routeur de l'application : routes déclarées par le cœur (chemins à paramètres), navigation classique par
// l'historique du navigateur (précédent / suivant), garde avant de quitter une page qui a des modifications en
// cours, pages conservées en mémoire (une liste retrouve ses lignes et sa position au retour d'une fiche).

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

/**
 * Page de l'application (classe mère). Le routeur la crée pour une route, l'ouvre dans son conteneur, lui demande
 * avant de la quitter (modifications en cours), la masque si elle est conservée, puis la ferme.
 *   titre        : titre de la fenêtre et de la liste des fenêtres
 *   modifiee     : modifications non enregistrées (avertissement avant fermeture, indicateur ● dans les fenêtres)
 *   static conserver : la page reste en mémoire quand on la quitte (retour à l'identique)
 */
export class PageBase {
  static conserver = false;

  constructor({ conteneur, params = {}, requete = {}, app = null, route = null }) {
    this.conteneur = conteneur;
    this.params = params;
    this.requete = requete;
    this.app = app;
    this.route = route;
    this.titre = route?.titre ?? '';
  }

  async ouvrir() {}

  get modifiee() { return false; }

  /** Avant de quitter : false pour rester (confirmation refusée). */
  async quitter() {
    return !this.modifiee || confirm(`« ${this.titre} » : des modifications ne sont pas enregistrées. Quitter quand même ?`);
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
 * window.location (remplaçables pour les tests).
 */
export class Routeur {
  constructor({ routes, conteneur, app = null, historique = globalThis.history, emplacement = globalThis.location, surPage = null, maxConservees = 3 }) {
    this.routes = routes;
    this.conteneur = conteneur;
    this.app = app;
    this.historique = historique;
    this.emplacement = emplacement;
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
    globalThis.addEventListener?.('popstate', (e) => this.surPopstate(e));
    return this.#afficher(this.#urlEmplacement());
  }

  #urlEmplacement() { return `${this.emplacement.pathname}${this.emplacement.search}`; }

  /** Navigation dans la fenêtre : garde de la page courante, puis nouvelle entrée d'historique (ou remplacement). */
  aller(url, { remplacer = false, forcer = false } = {}) {
    this.enCours = this.enCours.then(async () => {
      if (url === this.cle && !remplacer && !forcer) return true;
      // forcer : sans demander à la page (fermeture de session, modifications déjà abandonnées).
      if (!forcer && !(await this.#quitterPage())) return false;
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
      this.page = new Page({ conteneur: element, params: cible.params, requete: cible.requete, app: this.app, route: cible.route });
      if (Page.conserver) {
        this.conservees.set(cible.url, { page: this.page, element });
        this.#evincer();
      }
      try {
        await this.page.ouvrir();
      } catch (e) {
        this.surPage?.(this.page);
        throw e;
      }
    }
    for (const el of [...this.conteneur.children]) {
      if (![...this.conservees.values()].some((c) => c.element === el) && el !== this.page.conteneur) el.remove();
    }
    this.surPage?.(this.page);
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
