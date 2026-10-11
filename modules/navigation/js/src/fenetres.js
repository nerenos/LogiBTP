// Fenêtres multiples et session. Chaque fenêtre de l'application (même origine, donc même société : un sous-domaine
// par base) s'annonce sur un BroadcastChannel ; toutes connaissent ainsi la liste des fenêtres ouvertes, peuvent en
// remettre une au premier plan ou la signaler, et fermer la session complète. La session (URL, titre, position de
// chaque fenêtre) est gardée dans le localStorage pour être restaurée plus tard par une boucle de window.open.
//
// Messages du canal :
//   { type: 'annonce', fenetre }         une fenêtre décrit son état (à l'ouverture, à chaque changement, au battement)
//   { type: 'demande' }                  toutes les fenêtres répondent par une annonce
//   { type: 'depart', id }               fermeture d'une fenêtre
//   { type: 'qui', id } / { type: 'present', id }   détection d'un identifiant déjà utilisé (onglet dupliqué)
//   { type: 'signaler', id }             la fenêtre visée attire l'attention (titre clignotant, cadre)
//   { type: 'etat-fermeture', demande }  chaque fenêtre répond { type: 'reponse-fermeture', demande, id, titre, modifiee }
//   { type: 'fermer-session', par }      chaque fenêtre se ferme (sans nouvelle confirmation)
//   { type: 'donnees', sujet, contenu }  information applicative (enregistrement d'une fiche…)

export const CANAL = 'logibtp-fenetres';
export const CLE_SESSION = 'logibtp.session.courante';
export const CLE_PRECEDENTE = 'logibtp.session.precedente';
const CLE_ID = 'logibtp.fenetre.id';
const BATTEMENT_MS = 5000;
const EXPIRATION_MS = 20000;

export const nouvelId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function lireJson(stockage, cle, defaut) {
  try { return JSON.parse(stockage.getItem(cle)) ?? defaut; } catch { return defaut; }
}
function ecrireJson(stockage, cle, valeur) {
  try { stockage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage indisponible : session non conservée */ }
}

/** Options de window.open pour une fenêtre séparée, à la position et à la taille mémorisées. */
export function optionsFenetre(position) {
  if (!position) return 'popup=yes,width=1280,height=860';
  const { x, y, largeur, hauteur } = position;
  return `popup=yes,left=${Math.round(x)},top=${Math.round(y)},width=${Math.round(largeur)},height=${Math.round(hauteur)}`;
}

/**
 * Session précédente à proposer : celle enregistrée par « Fermer la session », sinon les fenêtres de la session
 * courante qui ne battent plus (navigateur fermé ou arrêté sans fermer la session).
 */
export function sessionAProposer({ precedente, courante, maintenant, idCourant, expiration = EXPIRATION_MS }) {
  if (precedente?.fenetres?.length) return precedente;
  const orphelines = Object.values(courante ?? {}).filter((f) => f.id !== idCourant && maintenant - (f.vu ?? 0) > expiration);
  const vivantes = Object.values(courante ?? {}).filter((f) => f.id !== idCourant && maintenant - (f.vu ?? 0) <= expiration);
  if (!orphelines.length || vivantes.length) return null;
  return { fermeeLe: Math.max(...orphelines.map((f) => f.vu ?? 0)), interrompue: true, fenetres: orphelines };
}

export class GestionFenetres {
  constructor({
    etat = () => ({}), surListe = () => {}, surSignal = () => {}, surFermetureSession = async () => {}, surDonnees = () => {},
    canal = null, stockage = globalThis.localStorage, stockageFenetre = globalThis.sessionStorage, fenetre = globalThis.window,
    horloge = () => Date.now(), delaiReponse = 350,
  } = {}) {
    this.etat = etat;
    this.surListe = surListe;
    this.surSignal = surSignal;
    this.surFermetureSession = surFermetureSession;
    this.surDonnees = surDonnees;
    this.canal = canal ?? (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CANAL) : null);
    this.stockage = stockage;
    this.stockageFenetre = stockageFenetre;
    this.fenetre = fenetre;
    this.horloge = horloge;
    this.delaiReponse = delaiReponse;
    this.autres = new Map();
    this.ouverteLe = horloge();
    this.fermetureSession = false;
    this.reponses = new Map();
    this.id = null;
  }

  async demarrer() {
    this.id = this.stockageFenetre?.getItem(CLE_ID) ?? null;
    if (!this.id) this.id = nouvelId();
    if (this.canal) this.canal.onmessage = (e) => this.#recevoir(e.data);
    // Onglet dupliqué : même sessionStorage, donc même identifiant ; on en prend un nouveau.
    if (await this.#identifiantPris(this.id)) this.id = nouvelId();
    this.stockageFenetre?.setItem(CLE_ID, this.id);
    if (this.fenetre) this.fenetre.name = this.id;
    this.annoncer();
    this.#poster({ type: 'demande' });
    this.minuterie = setInterval(() => { this.annoncer(); this.#purger(); }, BATTEMENT_MS);
    this.fenetre?.addEventListener?.('pagehide', () => this.#depart());
  }

  arreter() {
    clearInterval(this.minuterie);
    this.#depart();
    this.canal?.close();
  }

  #identifiantPris(id) {
    if (!this.canal) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.attenteQui = { id, resolve };
      this.#poster({ type: 'qui', id });
      setTimeout(() => { if (this.attenteQui?.id === id) { this.attenteQui = null; resolve(false); } }, Math.min(this.delaiReponse, 200));
    });
  }

  #poster(message) {
    try { this.canal?.postMessage(message); } catch { /* canal fermé */ }
  }

  /** Description de cette fenêtre (diffusée et gardée dans la session). */
  descriptif() {
    const f = this.fenetre;
    const e = this.etat() ?? {};
    return {
      id: this.id, url: e.url ?? (f ? `${f.location.pathname}${f.location.search}` : '/'), titre: e.titre ?? '', icone: e.icone ?? '',
      modifiee: Boolean(e.modifiee), principale: f ? !f.opener : true, ouverteLe: this.ouverteLe, vu: this.horloge(),
      position: f ? { x: f.screenX, y: f.screenY, largeur: f.outerWidth, hauteur: f.outerHeight } : null,
    };
  }

  /** Diffuse l'état de cette fenêtre (à appeler après chaque changement de page, de titre ou de modification). */
  annoncer() {
    if (!this.id || this.fermetureSession) return;
    const d = this.descriptif();
    this.#poster({ type: 'annonce', fenetre: d });
    const session = lireJson(this.stockage, CLE_SESSION, {});
    session[this.id] = d;
    ecrireJson(this.stockage, CLE_SESSION, session);
    this.surListe(this.liste());
  }

  #depart() {
    if (!this.id || this.parti) return;
    this.parti = true;
    this.#poster({ type: 'depart', id: this.id });
    // Fermeture de session : la fenêtre reste dans la session enregistrée.
    if (this.fermetureSession) return;
    const session = lireJson(this.stockage, CLE_SESSION, {});
    delete session[this.id];
    ecrireJson(this.stockage, CLE_SESSION, session);
  }

  #purger() {
    const limite = this.horloge() - EXPIRATION_MS * 1.5;
    let change = false;
    for (const [id, f] of this.autres) if (f.vu < limite) { this.autres.delete(id); change = true; }
    if (change) this.surListe(this.liste());
  }

  /** Fenêtres ouvertes (celle-ci en premier, puis par ordre d'ouverture). */
  liste() {
    return [{ ...this.descriptif(), courante: true }, ...[...this.autres.values()].sort((a, b) => a.ouverteLe - b.ouverteLe)];
  }

  #recevoir(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'annonce':
        if (m.fenetre?.id && m.fenetre.id !== this.id) {
          this.autres.set(m.fenetre.id, { ...m.fenetre, vu: this.horloge() });
          this.surListe(this.liste());
        }
        break;
      case 'demande':
        this.annoncer();
        break;
      case 'depart':
        if (this.autres.delete(m.id)) this.surListe(this.liste());
        break;
      case 'qui':
        if (m.id === this.id) this.#poster({ type: 'present', id: m.id });
        break;
      case 'present':
        if (this.attenteQui?.id === m.id) { const { resolve } = this.attenteQui; this.attenteQui = null; resolve(true); }
        break;
      case 'signaler':
        if (m.id === this.id) this.surSignal();
        break;
      case 'etat-fermeture': {
        const e = this.etat() ?? {};
        this.#poster({ type: 'reponse-fermeture', demande: m.demande, id: this.id, titre: e.titre ?? '', modifiee: Boolean(e.modifiee) });
        break;
      }
      case 'reponse-fermeture':
        this.reponses.get(m.demande)?.push(m);
        break;
      case 'fermer-session':
        this.#fermerParSession().catch(() => {});
        break;
      case 'donnees':
        this.surDonnees(m.sujet, m.contenu);
        break;
      default:
    }
  }

  /** Information applicative pour les autres fenêtres (ex. fiche enregistrée : les listes rafraîchissent la ligne). */
  diffuser(sujet, contenu) { this.#poster({ type: 'donnees', sujet, contenu }); }

  /** Ouvre une URL dans une nouvelle fenêtre séparée (déplaçable sur un autre moniteur). */
  ouvrir(url, { position = null, id = nouvelId() } = {}) {
    return this.fenetre?.open(url, id, optionsFenetre(position)) ?? null;
  }

  /**
   * Remet une fenêtre au premier plan : window.open('', nom) retrouve la fenêtre nommée sans la recharger. Si le
   * navigateur ne la retrouve pas (fenêtre ouverte hors de l'application), l'onglet vide créé est refermé et la
   * fenêtre est signalée. Renvoie true si la fenêtre a été trouvée.
   */
  focaliser(id) {
    if (id === this.id) { this.fenetre?.focus(); return true; }
    let w = null;
    try { w = this.fenetre?.open('', id); } catch { w = null; }
    let vide = !w;
    try { vide = vide || w.location.href === 'about:blank'; } catch { vide = false; }
    if (vide) {
      try { w?.close(); } catch { /* ignoré */ }
      this.signaler(id);
      return false;
    }
    w.focus();
    return true;
  }

  signaler(id) {
    if (id === this.id) this.surSignal();
    else this.#poster({ type: 'signaler', id });
  }

  /** Fenêtres de la session (celle-ci comprise) qui ont des modifications en cours. */
  async etatFermeture() {
    const demande = nouvelId();
    this.reponses.set(demande, []);
    this.#poster({ type: 'etat-fermeture', demande });
    await new Promise((r) => setTimeout(r, this.autres.size ? this.delaiReponse : 0));
    const reponses = this.reponses.get(demande);
    this.reponses.delete(demande);
    const e = this.etat() ?? {};
    return [{ id: this.id, titre: e.titre ?? '', modifiee: Boolean(e.modifiee), courante: true }, ...reponses];
  }

  /**
   * Ferme la session : enregistre toutes les fenêtres (pour « Restaurer ma session précédente »), demande aux autres
   * de se fermer, puis vide la session courante. La fenêtre appelante reste ouverte (l'application affiche l'accueil).
   */
  fermerSession() {
    const fenetres = this.liste().map(({ courante, ...f }) => f);
    ecrireJson(this.stockage, CLE_PRECEDENTE, { fermeeLe: this.horloge(), fenetres });
    this.#poster({ type: 'fermer-session', par: this.id });
    this.autres.clear();
    ecrireJson(this.stockage, CLE_SESSION, { [this.id]: this.descriptif() });
    this.surListe(this.liste());
    return fenetres;
  }

  async #fermerParSession() {
    this.fermetureSession = true;
    clearInterval(this.minuterie);
    await this.surFermetureSession();
    this.#depart();
    this.fenetre?.close();
    // Fenêtre que le script ne peut pas fermer (ouverte par l'utilisateur) : page de session fermée.
    setTimeout(() => { if (!this.fenetre?.closed) this.fenetre?.location.replace('/?session=fermee'); }, 300);
  }

  /** Session précédente proposée à l'accueil (null si aucune). */
  sessionPrecedente() {
    return sessionAProposer({
      precedente: lireJson(this.stockage, CLE_PRECEDENTE, null), courante: lireJson(this.stockage, CLE_SESSION, {}),
      maintenant: this.horloge(), idCourant: this.id,
    });
  }

  oublierSessionPrecedente() {
    try { this.stockage.removeItem(CLE_PRECEDENTE); } catch { /* ignoré */ }
    const session = lireJson(this.stockage, CLE_SESSION, {});
    const limite = this.horloge() - EXPIRATION_MS;
    for (const [id, f] of Object.entries(session)) if (id !== this.id && (f.vu ?? 0) < limite) delete session[id];
    ecrireJson(this.stockage, CLE_SESSION, session);
  }

  /**
   * Restaure une session : une fenêtre par window.open (positions mémorisées). Le navigateur peut bloquer les
   * fenêtres au-delà de la première par clic : elles sont renvoyées pour être ouvertes une à une.
   * La fenêtre principale de la session reprend son URL dans la fenêtre courante (urlCourante).
   */
  restaurer(session) {
    const fenetres = [...(session?.fenetres ?? [])].sort((a, b) => a.ouverteLe - b.ouverteLe);
    const principale = fenetres.find((f) => f.principale) ?? null;
    const ouvertes = [];
    const bloquees = [];
    for (const f of fenetres) {
      if (f === principale) continue;
      const w = this.ouvrir(f.url, { position: f.position });
      (w ? ouvertes : bloquees).push(f);
    }
    if (!bloquees.length) this.oublierSessionPrecedente();
    return { ouvertes, bloquees, urlCourante: principale?.url ?? null };
  }
}
