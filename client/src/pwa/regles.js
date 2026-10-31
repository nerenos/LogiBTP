// Règles du service worker (application installable, données consultées gardées pour le mode hors ligne) : fonctions
// pures, testées (client/test/pwa.test.js) et recopiées dans sw.js à la construction (plugin de vite.config.js, sans
// les mots-clés export). Pas d'import ni de dépendance : le service worker est un script classique.

/** En-tête posé par le service worker sur une réponse servie depuis le cache (date de mise en cache, ISO). */
export const ENTETE_HORS_LIGNE = 'X-LogiBTP-Hors-Ligne';

/** En-tête de la date de mise en cache, gardé avec la réponse. */
export const ENTETE_CACHE_LE = 'X-LogiBTP-Cache-Le';

/** Lectures faites en POST (corps = critères) : mises en cache comme les GET, clé = adresse + empreinte du corps. */
export const LECTURES_POST = ['/api/listes/lot', '/api/listes/segments', '/api/listes/controle', '/api/listes/lignes', '/api/structure/documents'];

/** Réponses de données gardées au plus (les plus anciennes sont retirées au-delà). */
export const MAX_DONNEES = 3000;

/** Taille maximale d'une réponse de données gardée (octets). */
export const TAILLE_MAX_DONNEE = 5 * 1024 * 1024;

/**
 * Traitement d'une requête de la page par le service worker :
 * - 'reseau' : réseau seul (contrôle de l'API, flux d'événements, autre origine, fichiers de la GED) ;
 * - 'donnee' : lecture de l'API, réseau d'abord puis réponse gardée ;
 * - 'ecriture' : écriture de l'API, réseau seul, hors ligne : 503 HORS_LIGNE ;
 * - 'page' : navigation vers une route du client, réseau d'abord puis index.html gardé ;
 * - 'personnalisation' : textes, thème et images (/personnalisation/, module Personnalisation), modifiables sur le serveur
 *   sans nouvelle version du client : réseau d'abord, copie gardée pour le hors ligne ;
 * - 'fichier' : fichier de l'application (scripts, styles, polices), cache d'abord.
 */
export function traitement({ methode, url, origine, navigation = false }) {
  const u = new URL(url);
  if (u.origin !== origine) return 'reseau';
  const chemin = u.pathname;
  if (chemin === '/api' || chemin.startsWith('/api/')) {
    if (chemin === '/api/sante' || chemin.startsWith('/api/diffusion')) return 'reseau';
    // Contenus de fichiers (GED, éditions PDF) : volumineux, jamais gardés.
    if (/^\/api\/ged\/.*\/(contenu|fichier|apercu)/.test(chemin) || chemin.startsWith('/api/editions/pdf')) return 'reseau';
    if (methode === 'GET') return 'donnee';
    if (methode === 'POST' && LECTURES_POST.includes(chemin)) return 'donnee';
    return 'ecriture';
  }
  if (methode !== 'GET') return 'reseau';
  if (navigation) return 'page';
  if (chemin.startsWith('/personnalisation/')) return 'personnalisation';
  return 'fichier';
}

/** Empreinte FNV-1a 32 bits d'un texte (clé de cache d'une lecture en POST). */
export function empreinte(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Clé de cache d'une lecture : l'adresse, et pour un POST l'empreinte du corps en paramètre. */
export function cleDonnee(url, methode, corps = '') {
  if (methode === 'GET') return url;
  const u = new URL(url);
  u.searchParams.set('__corps', empreinte(corps));
  return u.href;
}

/** Taille maximale d'une pièce de l'application de terrain gardée pour le hors ligne (octets, ANALYSE-TERRAIN.md T6). */
export const TAILLE_MAX_PIECE = 25 * 1024 * 1024;

/**
 * Réponse de l'API à garder : succès en JSON, de taille raisonnable (taille inconnue : gardée) ; pièces de
 * l'application de terrain (`/api/terrain/pieces/`) : tout type, jusqu'à TAILLE_MAX_PIECE.
 */
export function reponseAGarder({ statut, typeContenu, taille, url = '' }) {
  if (statut !== 200) return false;
  if (/\/api\/terrain\/pieces\//.test(url)) return !(Number(taille) > TAILLE_MAX_PIECE);
  if (!/json/i.test(typeContenu ?? '')) return false;
  return !(Number(taille) > TAILLE_MAX_DONNEE);
}

/**
 * Réponse du réseau qui vaut une panne (relais sans API derrière : 502 à 504, ou 500 sans corps JSON comme le proxy
 * de Vite ; une erreur de l'API répond toujours en JSON) : le cache est alors utilisé.
 */
export const reponseEnPanne = (statut, typeContenu = null) => statut === 502 || statut === 503 || statut === 504
  || (statut === 500 && !/json/i.test(typeContenu ?? ''));

/** Corps de la réponse 503 du service worker (même forme que les erreurs de l'API : code, title). */
export function erreurHorsLigne(ecriture) {
  return {
    status: 503, code: 'HORS_LIGNE',
    title: ecriture ? 'Hors ligne : enregistrement impossible tant que le serveur ne répond pas'
      : 'Hors ligne : donnée non consultée auparavant sur ce poste',
  };
}
