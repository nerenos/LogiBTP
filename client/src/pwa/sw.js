/* global self, caches, Response, Headers, URL */
// Service worker de LogiBTP (application installable, mode hors ligne) : modèle complété à la construction par le
// plugin de vite.config.js (règles de src/pwa/regles.js, fichiers de l'application, version). Il ne sert que le
// client construit ; en développement (Vite), il n'est pas enregistré.
//
// - Fichiers de l'application gardés à l'installation (cache d'abord) ; navigation : réseau d'abord, sinon index.html.
// - Personnalisation (/personnalisation/ : fr.json, theme.css, images, modifiables sur le serveur) : réseau d'abord,
//   dernière copie gardée (cache propre, conservé à la déconnexion), sinon celle de l'installation du client.
// - Lectures de l'API (GET, et POST de lecture des listes) : réseau d'abord, réponse gardée ; serveur injoignable :
//   dernière réponse gardée, marquée par l'en-tête X-LogiBTP-Hors-Ligne (date de mise en cache). Plans du terrain
//   (/api/terrain/plans/) : cache à part, budget BUDGET_PLANS, les plus anciens retirés au-delà.
// - Écritures : réseau seul ; serveur injoignable : 503 HORS_LIGNE (la saisie des documents est mise en attente par
//   l'application, pas par le service worker).
// - Données propres au compte : effacées à la déconnexion et quand un autre compte se connecte (message de la page).
// Chaque société a son sous-domaine, donc son propre service worker et ses propres caches.

/* REGLES */

const VERSION = '__VERSION__';
const FICHIERS = __FICHIERS__;
const CACHE_APPLICATION = `logibtp-application-${VERSION}`;
const CACHE_DONNEES = 'logibtp-donnees';
const CACHE_PERSONNALISATION = 'logibtp-personnalisation';
// Plans du terrain gardés (budget BUDGET_PLANS à part des pièces « Terrain ») : données du compte, comme CACHE_DONNEES.
const CACHE_PLANS = 'logibtp-plans';
const CLE_COMPTE = '/__logibtp/compte';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_APPLICATION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) {
      if (nom.startsWith('logibtp-application-') && nom !== CACHE_APPLICATION) await caches.delete(nom);
    }
    await self.clients.claim();
  })());
});

// Messages de la page : compte connecté (données d'un autre compte effacées), purge à la déconnexion.
self.addEventListener('message', (e) => {
  const m = e.data ?? {};
  if (m.type === 'compte') e.waitUntil(changerCompte(String(m.code ?? '')));
  else if (m.type === 'purger') e.waitUntil(Promise.all([caches.delete(CACHE_DONNEES), caches.delete(CACHE_PLANS)]));
});

async function changerCompte(code) {
  const c = await caches.open(CACHE_DONNEES);
  const actuel = await c.match(CLE_COMPTE).then((r) => (r ? r.text() : null));
  if (actuel === code) return;
  if (actuel !== null) {
    await caches.delete(CACHE_DONNEES);
    await caches.delete(CACHE_PLANS);
    await (await caches.open(CACHE_DONNEES)).put(CLE_COMPTE, new Response(code));
  } else await c.put(CLE_COMPTE, new Response(code));
}

self.addEventListener('fetch', (e) => {
  const r = e.request;
  const t = traitement({ methode: r.method, url: r.url, origine: self.location.origin, navigation: r.mode === 'navigate' });
  if (t === 'donnee') e.respondWith(donnee(r));
  else if (t === 'ecriture') e.respondWith(ecriture(r));
  else if (t === 'page') e.respondWith(page(r));
  else if (t === 'personnalisation') e.respondWith(personnalisation(r));
  else if (t === 'fichier') e.respondWith(fichier(r));
});

const json = (corps, statut) => new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/problem+json' } });

async function donnee(requete) {
  const corps = requete.method === 'GET' ? '' : await requete.clone().text();
  const cle = cleDonnee(requete.url, requete.method, corps);
  let reponse = null;
  try {
    reponse = await fetch(requete);
  } catch { /* serveur injoignable */ }
  if (reponse && !reponseEnPanne(reponse.status, reponse.headers.get('Content-Type'))) {
    if (reponseAGarder({ statut: reponse.status, typeContenu: reponse.headers.get('Content-Type'), taille: reponse.headers.get('Content-Length'), url: requete.url })) {
      if (estPlanTerrain(requete.url)) garderPlanEnFile(cle, reponse.clone());
      else garder(cle, reponse.clone()).catch(() => {});
    }
    return reponse;
  }
  const garde = await caches.open(estPlanTerrain(requete.url) ? CACHE_PLANS : CACHE_DONNEES).then((c) => c.match(cle));
  if (!garde) return json(erreurHorsLigne(false), 503);
  const entetes = new Headers(garde.headers);
  entetes.set(ENTETE_HORS_LIGNE, garde.headers.get(ENTETE_CACHE_LE) ?? '');
  return new Response(garde.body, { status: garde.status, statusText: garde.statusText, headers: entetes });
}

let ecritures = 0;
async function garder(cle, reponse) {
  const entetes = new Headers(reponse.headers);
  entetes.set(ENTETE_CACHE_LE, new Date().toISOString());
  const c = await caches.open(CACHE_DONNEES);
  // Retirée puis remise : la clé passe en fin de liste (les plus anciennes sont en tête).
  await c.delete(cle);
  await c.put(cle, new Response(await reponse.blob(), { status: reponse.status, statusText: reponse.statusText, headers: entetes }));
  if (++ecritures % 100 !== 0) return;
  const cles = await c.keys();
  for (const k of cles.slice(0, Math.max(0, cles.length - MAX_DONNEES))) if (!k.url.endsWith(CLE_COMPTE)) await c.delete(k);
}

// Plans gardés l'un après l'autre (préchargement) : le budget est calculé sur un cache à jour.
let filePlans = Promise.resolve();
const garderPlanEnFile = (cle, reponse) => { filePlans = filePlans.then(() => garderPlan(cle, reponse)).catch(() => {}); };

// Plan du terrain : gardé dans son cache tant que le budget le permet, les plans gardés depuis le plus longtemps retirés.
async function garderPlan(cle, reponse) {
  const corps = await reponse.blob();
  const c = await caches.open(CACHE_PLANS);
  const gardes = [];
  for (const k of await c.keys()) gardes.push({ cle: k.url, taille: Number((await c.match(k))?.headers.get(ENTETE_TAILLE)) || 0 });
  const retirer = plansARetirer(gardes, cle, corps.size);
  if (!retirer) return;
  for (const k of retirer) await c.delete(k);
  const entetes = new Headers(reponse.headers);
  entetes.set(ENTETE_CACHE_LE, new Date().toISOString());
  entetes.set(ENTETE_TAILLE, String(corps.size));
  await c.delete(cle);
  await c.put(cle, new Response(corps, { status: reponse.status, statusText: reponse.statusText, headers: entetes }));
}

async function ecriture(requete) {
  try {
    const r = await fetch(requete);
    if (!reponseEnPanne(r.status, r.headers.get('Content-Type'))) return r;
  } catch { /* serveur injoignable */ }
  return json(erreurHorsLigne(true), 503);
}

async function page(requete) {
  try {
    const r = await fetch(requete);
    if (!reponseEnPanne(r.status, r.headers.get('Content-Type'))) return r;
  } catch { /* serveur injoignable */ }
  const index = await caches.match('/index.html');
  return index ?? json(erreurHorsLigne(false), 503);
}

async function personnalisation(requete) {
  try {
    const r = await fetch(requete);
    if (r.ok) {
      caches.open(CACHE_PERSONNALISATION).then((c) => c.put(requete, r.clone())).catch(() => {});
      return r;
    }
    if (!reponseEnPanne(r.status, r.headers.get('Content-Type'))) return r;
  } catch { /* serveur injoignable */ }
  const garde = await caches.open(CACHE_PERSONNALISATION).then((c) => c.match(requete, { ignoreSearch: true }))
    ?? await caches.match(requete, { ignoreSearch: true });
  return garde ?? new Response('', { status: 503 });
}

async function fichier(requete) {
  const garde = await caches.match(requete);
  if (garde) return garde;
  const r = await fetch(requete);
  // Fichier à empreinte chargé après l'installation (nouvelle version en cours) : gardé pour le hors ligne.
  if (r.ok && new URL(requete.url).pathname.startsWith('/assets/')) caches.open(CACHE_APPLICATION).then((c) => c.put(requete, r.clone())).catch(() => {});
  return r;
}
