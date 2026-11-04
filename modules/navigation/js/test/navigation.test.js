import { describe, it, expect } from 'vitest';
import { correspondre, construire, analyser, Routeur, PageBase, afficherApercu, CLE_APERCU } from '../src/routeur.js';
import { GestionFenetres, sessionAProposer, optionsFenetre, CLE_PRECEDENTE, CLE_SESSION } from '../src/fenetres.js';
import { Preferences, deplacer, inserer } from '../src/preferences.js';

describe('routes', () => {
  it('paramètres obligatoires et facultatifs', () => {
    expect(correspondre('/fiche/:type/:id', '/fiche/salarie/12')).toEqual({ type: 'salarie', id: '12' });
    expect(correspondre('/fiche/:type/:id', '/fiche/salarie')).toBeNull();
    expect(correspondre('/liste/:theme?', '/liste')).toEqual({});
    expect(correspondre('/liste/:theme?', '/liste/devis')).toEqual({ theme: 'devis' });
    expect(correspondre('/liste/:theme?', '/liste/devis/x')).toBeNull();
    expect(correspondre('/', '/')).toEqual({});
    expect(correspondre('/ged/:id?', '/ged/caf%C3%A9')).toEqual({ id: 'café' });
  });

  it('construction et analyse', () => {
    expect(construire('/fiche/:type/:id', { type: 'materiel', id: 3 })).toBe('/fiche/materiel/3');
    expect(construire('/liste/:theme?', {}, { vue: 2, vide: '', non: false })).toBe('/liste?vue=2');
    expect(() => construire('/fiche/:type/:id', { type: 'x' })).toThrow();
    expect(analyser('/liste/devis?vue=4')).toEqual({ pathname: '/liste/devis', requete: { vue: '4' }, url: '/liste/devis?vue=4' });
  });
});

// Historique simulé : pile d'entrées, popstate déclenché à la main.
function historiqueSimule(urlInitiale) {
  const entrees = [{ state: null, url: urlInitiale }];
  let i = 0;
  const emplacement = { get pathname() { return analyser(entrees[i].url).pathname; }, get search() { const q = entrees[i].url.split('?')[1]; return q ? `?${q}` : ''; } };
  const h = {
    get state() { return entrees[i].state; },
    pushState(state, _, url) { entrees.splice(i + 1); entrees.push({ state, url }); i++; },
    replaceState(state, _, url) { entrees[i] = { state, url }; },
    back() { i--; },
    go(d) { i += d; },
    entrees, get i() { return i; },
  };
  return { h, emplacement };
}

function conteneurSimule() {
  const enfants = [];
  const doc = { createElement: () => ({ hidden: false, className: '', remove() { enfants.splice(enfants.indexOf(this), 1); } }) };
  return { ownerDocument: doc, append: (e) => enfants.push(e), get children() { return enfants; } };
}

describe('routeur', () => {
  const journal = [];
  class PageListe extends PageBase {
    static conserver = true;
    async ouvrir() { journal.push(`ouvrir liste ${this.params.theme}`); }
    async reprendre() { journal.push('reprendre liste'); }
  }
  class PageFiche extends PageBase {
    async ouvrir() { journal.push(`ouvrir fiche ${this.params.id}`); }
    get modifiee() { return this.modif ?? false; }
    async quitter() { return !this.modifiee; }
    fermer() { journal.push(`fermer fiche ${this.params.id}`); }
  }
  const routes = [
    { nom: 'liste', chemin: '/liste/:theme?', page: PageListe },
    { nom: 'fiche', chemin: '/fiche/:type/:id', page: PageFiche },
    { nom: '404', chemin: '/404', page: PageBase },
  ];

  it('liste → fiche → retour : la liste conservée est reprise', async () => {
    journal.length = 0;
    const { h, emplacement } = historiqueSimule('/liste/salaries');
    const r = new Routeur({ routes, conteneur: conteneurSimule(), historique: h, emplacement });
    await r.demarrer();
    await r.aller('/fiche/salarie/12');
    expect(h.entrees.map((e) => e.url)).toEqual(['/liste/salaries', '/fiche/salarie/12']);
    // Précédent du navigateur
    h.back();
    await r.surPopstate({ state: h.state });
    expect(journal).toEqual(['ouvrir liste salaries', 'ouvrir fiche 12', 'fermer fiche 12', 'reprendre liste']);
  });

  it('garde : une fiche modifiée refuse la navigation', async () => {
    journal.length = 0;
    const { h, emplacement } = historiqueSimule('/fiche/salarie/1');
    const r = new Routeur({ routes, conteneur: conteneurSimule(), historique: h, emplacement });
    await r.demarrer();
    r.page.modif = true;
    expect(await r.aller('/liste')).toBe(false);
    expect(h.entrees).toHaveLength(1);
    r.page.modif = false;
    expect(await r.aller('/liste')).toBe(true);
    expect(r.page).toBeInstanceOf(PageListe);
  });

  it('onglet retrouvé au retour et après un rechargement de la fenêtre', async () => {
    class PageOnglets extends PageBase {
      async ouvrir() { this.onglet = this.affichage?.onglet ?? 'general'; }
      etatAffichage() { return { onglet: this.onglet }; }
    }
    const routesOnglets = [{ nom: 'fiche', chemin: '/fiche/:type/:id', page: PageOnglets }, { nom: '404', chemin: '/404', page: PageBase }];
    const { h, emplacement } = historiqueSimule('/fiche/salarie/1');
    const s = stockage();
    const r = new Routeur({ routes: routesOnglets, conteneur: conteneurSimule(), historique: h, emplacement, stockage: s });
    await r.demarrer();
    r.page.onglet = 'pieces';
    await r.aller('/fiche/salarie/2');
    expect(r.page.onglet).toBe('general');
    h.back();
    await r.surPopstate({ state: h.state });
    expect(r.page.onglet).toBe('pieces');
    // Rechargement : pagehide mémorise (le navigateur y ignore replaceState, simulé ici), un nouveau routeur reprend l'onglet.
    r.page.onglet = 'adresses';
    r.page.conteneur.outerHTML = '<div class="page"></div>';
    const remplacer = h.replaceState;
    h.replaceState = () => {};
    r.memoriser();
    h.replaceState = remplacer;
    expect(JSON.parse(s.getItem(CLE_APERCU)).url).toBe('/fiche/salarie/1');
    const r2 = new Routeur({ routes: routesOnglets, conteneur: conteneurSimule(), historique: h, emplacement, stockage: s });
    await r2.demarrer();
    expect(r2.page.onglet).toBe('adresses');
    // Aperçu d'une autre page : ignoré et consommé.
    expect(afficherApercu(conteneurSimule(), '/fiche/salarie/9', { stockage: s })).toBeNull();
    expect(s.getItem(CLE_APERCU)).toBeNull();
  });

  it('route inconnue : page 404, URL de la liste mise à jour sans navigation', async () => {
    const { h, emplacement } = historiqueSimule('/nulle-part');
    const r = new Routeur({ routes, conteneur: conteneurSimule(), historique: h, emplacement });
    await r.demarrer();
    expect(r.page.route.nom).toBe('404');
    await r.aller('/liste/devis');
    r.remplacerUrl('/liste/devis?vue=4');
    expect(h.entrees.at(-1).url).toBe('/liste/devis?vue=4');
    expect(r.conservees.has('/liste/devis?vue=4')).toBe(true);
    expect(r.url('fiche', { type: 'materiel', id: 5 })).toBe('/fiche/materiel/5');
  });
});

// Bus BroadcastChannel simulé : chaque message est remis aux autres canaux (asynchrone, comme le navigateur).
function bus() {
  const canaux = [];
  return () => {
    const c = {
      onmessage: null,
      postMessage(m) { for (const x of canaux) if (x !== c && !x.ferme) queueMicrotask(() => x.onmessage?.({ data: structuredClone(m) })); },
      close() { c.ferme = true; },
    };
    canaux.push(c);
    return c;
  };
}

function stockage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function fenetreSimulee(url, { opener = null } = {}) {
  const ouvertes = [];
  return {
    name: '', opener, closed: false, screenX: 10, screenY: 20, outerWidth: 1200, outerHeight: 800,
    location: { pathname: url.split('?')[0], search: '', href: url, replace() {} },
    open(u, nom, options) { const w = { url: u, nom, options, focus() { this.focalisee = true; }, close() { this.ferme = true; }, location: { href: u || 'about:blank' } }; ouvertes.push(w); return this.bloquer ? null : w; },
    focus() {}, close() { this.closed = true; }, addEventListener() {},
    ouvertes,
  };
}

const attendre = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('fenêtres', () => {
  it('annonce, liste, signalement et onglet dupliqué', async () => {
    const canal = bus();
    const partage = stockage();
    const signaux = [];
    const a = new GestionFenetres({ canal: canal(), stockage: partage, stockageFenetre: stockage(), fenetre: fenetreSimulee('/'), etat: () => ({ titre: 'Accueil' }), delaiReponse: 20 });
    const sessionB = stockage();
    const b = new GestionFenetres({ canal: canal(), stockage: partage, stockageFenetre: sessionB, fenetre: fenetreSimulee('/liste', { opener: {} }), etat: () => ({ titre: 'Liste', modifiee: true }), surSignal: () => signaux.push('b'), delaiReponse: 20 });
    await a.demarrer();
    await b.demarrer();
    await attendre();
    expect(a.liste().map((f) => f.titre)).toEqual(['Accueil', 'Liste']);
    expect(a.liste()[1]).toMatchObject({ modifiee: true, principale: false });
    a.signaler(b.id);
    await attendre();
    expect(signaux).toEqual(['b']);
    // Onglet dupliqué : même sessionStorage que b → nouvel identifiant.
    const c = new GestionFenetres({ canal: canal(), stockage: partage, stockageFenetre: sessionB, fenetre: fenetreSimulee('/liste'), delaiReponse: 20 });
    await c.demarrer();
    expect(c.id).not.toBe(b.id);
    [a, b, c].forEach((x) => clearInterval(x.minuterie));
  });

  it('fermeture de session : état des modifications, enregistrement, restauration', async () => {
    const canal = bus();
    const partage = stockage();
    const fa = fenetreSimulee('/');
    const a = new GestionFenetres({ canal: canal(), stockage: partage, stockageFenetre: stockage(), fenetre: fa, etat: () => ({ titre: 'Accueil', url: '/' }), delaiReponse: 20 });
    let fermee = false;
    const fb = fenetreSimulee('/fiche/salarie/3', { opener: {} });
    const b = new GestionFenetres({
      canal: canal(), stockage: partage, stockageFenetre: stockage(), fenetre: fb, etat: () => ({ titre: 'Fiche Dupont', url: '/fiche/salarie/3', modifiee: true }),
      surFermetureSession: async () => { fermee = true; }, delaiReponse: 20,
    });
    await a.demarrer();
    await b.demarrer();
    await attendre();
    const etat = await a.etatFermeture();
    expect(etat.filter((x) => x.modifiee).map((x) => x.titre)).toEqual(['Fiche Dupont']);
    a.fermerSession();
    await attendre();
    expect(fermee).toBe(true);
    expect(fb.closed).toBe(true);
    const precedente = JSON.parse(partage.getItem(CLE_PRECEDENTE));
    expect(precedente.fenetres.map((f) => f.url)).toEqual(['/', '/fiche/salarie/3']);
    expect(Object.keys(JSON.parse(partage.getItem(CLE_SESSION)))).toEqual([a.id]);

    // Restauration : la fiche rouvre dans une fenêtre séparée à sa position, l'accueil reste dans la fenêtre courante.
    const session = a.sessionPrecedente();
    const r = a.restaurer(session);
    expect(r.urlCourante).toBe('/');
    expect(fa.ouvertes.at(-1)).toMatchObject({ url: '/fiche/salarie/3', options: 'popup=yes,left=10,top=20,width=1200,height=800' });
    expect(a.sessionPrecedente()).toBeNull();

    // Fenêtre bloquée par le navigateur : renvoyée, la session reste proposée.
    partage.setItem(CLE_PRECEDENTE, JSON.stringify(precedente));
    fa.bloquer = true;
    expect(a.restaurer(a.sessionPrecedente()).bloquees.map((f) => f.url)).toEqual(['/fiche/salarie/3']);
    expect(a.sessionPrecedente()).not.toBeNull();
    clearInterval(a.minuterie);
  });

  it('focaliser une fenêtre nommée, sinon la signaler', () => {
    const f = fenetreSimulee('/');
    const g = new GestionFenetres({ canal: null, stockage: stockage(), stockageFenetre: stockage(), fenetre: f });
    g.id = 'moi';
    f.open = (u, nom) => ({ nom, location: { href: 'http://x/liste' }, focus() { this.focalisee = true; } });
    expect(g.focaliser('autre')).toBe(true);
    let fermee = false;
    f.open = () => ({ location: { href: 'about:blank' }, close() { fermee = true; }, focus() {} });
    expect(g.focaliser('inconnue')).toBe(false);
    expect(fermee).toBe(true);
  });

  it('session interrompue (navigateur fermé sans fermer la session)', () => {
    const courante = { a: { id: 'a', url: '/liste', vu: 1000 }, b: { id: 'b', url: '/fiche/materiel/2', vu: 2000 }, moi: { id: 'moi', vu: 99000 } };
    expect(sessionAProposer({ precedente: null, courante, maintenant: 100000, idCourant: 'moi' })).toMatchObject({ interrompue: true, fermeeLe: 2000 });
    // Une autre fenêtre encore vivante : la session continue, rien à proposer.
    expect(sessionAProposer({ precedente: null, courante: { ...courante, c: { id: 'c', vu: 95000 } }, maintenant: 100000, idCourant: 'moi' })).toBeNull();
    // Seulement des pages d'accueil : rien à proposer.
    expect(sessionAProposer({ precedente: null, courante: { a: { id: 'a', url: '/', vu: 1000 } }, maintenant: 100000, idCourant: 'moi' })).toBeNull();
    expect(sessionAProposer({ precedente: { fenetres: [{ url: '/?session=fermee' }] }, courante: {}, maintenant: 1, idCourant: 'moi' })).toBeNull();
    expect(optionsFenetre(null)).toBe('popup=yes,width=1280,height=860');
  });
});

describe('préférences', () => {
  it('valeurs par défaut, écriture, réordonnancement', () => {
    const s = stockage();
    const p = new Preferences('x', { raccourcis: ['a', 'b'], nouvelleFenetre: false }, s);
    p.set('raccourcis', deplacer(p.get('raccourcis'), 0, 1));
    expect(new Preferences('x', { raccourcis: [], nouvelleFenetre: false }, s).get('raccourcis')).toEqual(['b', 'a']);
    p.reinitialiser('raccourcis');
    expect(p.get('raccourcis')).toEqual(['a', 'b']);
  });

  it('insertion à une place ou à la fin', () => {
    expect(inserer(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b']);
    expect(inserer(['a', 'b'], 'x', 0)).toEqual(['x', 'a', 'b']);
    expect(inserer(['a', 'b'], 'x')).toEqual(['a', 'b', 'x']);
    expect(inserer(['a', 'b'], 'x', 9)).toEqual(['a', 'b', 'x']);
  });
});
