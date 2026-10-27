import { ENTETE_HORS_LIGNE } from './regles.js';

// Application installable (PWA) côté page : enregistrement du service worker (client construit seulement : en
// développement, Vite sert les modules et le service worker n'est pas enregistré), messages au service worker
// (compte connecté, purge des données à la déconnexion), nouvelle version signalée.

/** Service worker enregistré pour cette page (client construit, navigateur compatible). */
export const pwaActive = () => Boolean(import.meta.env.PROD && globalThis.navigator?.serviceWorker);

/** Page servie par le service worker (le mode hors ligne est alors possible). */
export const pwaControle = () => Boolean(globalThis.navigator?.serviceWorker?.controller);

/**
 * Enregistrement de /sw.js ; `surNouvelleVersion` est appelée quand une nouvelle version du client remplace
 * l'ancienne pendant que la page est ouverte (rechargement conseillé une fois la saisie enregistrée).
 */
export async function enregistrerServiceWorker({ surNouvelleVersion = () => {} } = {}) {
  if (!pwaActive()) return null;
  const avait = pwaControle();
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (avait) surNouvelleVersion(); });
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    console.warn('Service worker non enregistré', e);
    return null;
  }
}

async function envoyer(message) {
  if (!pwaActive()) return;
  const r = await navigator.serviceWorker.ready.catch(() => null);
  r?.active?.postMessage(message);
}

/** Compte connecté : les données gardées pour un autre compte sont effacées. */
export const signalerCompte = (code) => envoyer({ type: 'compte', code });

/** Déconnexion : données gardées effacées. */
export const purgerDonnees = () => envoyer({ type: 'purger' });

/** Réponse servie depuis le cache du service worker (serveur injoignable) : date de mise en cache ou null. */
export const depuisCache = (reponse) => reponse?.headers?.get(ENTETE_HORS_LIGNE) ?? null;
