// Saisies hors ligne autres que les documents (application de terrain, lot 4 : ANALYSE-TERRAIN.md T9) : file
// d'opérations typées dans l'IndexedDB du navigateur, par compte, envoyées dans l'ordre de saisie par la même boucle
// et sous le même verrou que les documents (synchro.js). Chaque type déclare son envoi (`declarerOperation`). Pas de
// fusion : un refus du serveur garde l'opération sur le poste, marquée ERREUR avec la raison, à réessayer ou abandonner.
// Entrée : { cle (compte:type:id), compte, type, id, corps (données de l'envoi, Blob et File compris), libelle, url
// (page où la saisie se reprend), etat (ATTENTE | ERREUR), erreur, le }. Une opération de même clé remplace la
// précédente (dernière saisie d'une journée, d'un avancement du jour).
import { magasinIdb } from '@logibtp/socle/ui';
import { ETAT_ATTENTE, estHorsLigne } from './attente.js';

const BASE = 'logibtp-operations';
const MAGASIN = 'operations';

const magasin = magasinIdb(BASE, MAGASIN, (db) => db.createObjectStore(MAGASIN, { keyPath: 'cle' }).createIndex('compte', 'compte'));

/** Types déclarés : type → { envoyer(corps) → réponse }. */
const TYPES = new Map();

/** Déclare un type d'opération et son envoi au serveur. */
export function declarerOperation(type, { envoyer }) {
  TYPES.set(type, { envoyer });
}

export const cleOperation = (compte, type, id) => `${compte}:${type}:${id}`;

/** Écrit (ou remplace) une opération en attente. */
export async function ecrireOperation({ compte, type, id, corps, libelle, url = null }) {
  const e = { cle: cleOperation(compte, type, id), compte, type, id: String(id), corps, libelle, url, etat: ETAT_ATTENTE.ATTENTE, erreur: null, le: new Date().toISOString() };
  await magasin('readwrite', (m) => m.put(e));
  return e;
}

export const lireOperation = (compte, type, id) => magasin('readonly', (m) => m.get(cleOperation(compte, type, id)));
export const retirerOperation = (cle) => magasin('readwrite', (m) => m.delete(cle));

/** Opérations d'un compte, les plus anciennes d'abord. */
export async function listeOperations(compte) {
  const l = await magasin('readonly', (m) => m.index('compte').getAll(compte)) ?? [];
  return l.sort((a, b) => a.le.localeCompare(b.le));
}

/** Change l'état d'une opération (ERREUR, retour en ATTENTE pour réessayer). */
export async function marquerOperation(cle, champs) {
  const e = await magasin('readonly', (m) => m.get(cle));
  if (!e) return null;
  const n = { ...e, ...champs };
  await magasin('readwrite', (m) => m.put(n));
  return n;
}

/**
 * Envoie les opérations en attente d'un compte, dans l'ordre (appelé sous le verrou par synchro.js) : envoyée →
 * retirée ; serveur injoignable → arrêt (reprise au retour) ; refus → ERREUR. Renvoie { envoyees, refusees: [entrées] }.
 */
export async function envoyerOperations(compte) {
  let envoyees = 0;
  const refusees = [];
  for (const e of await listeOperations(compte)) {
    if (e.etat !== ETAT_ATTENTE.ATTENTE) continue;
    const t = TYPES.get(e.type);
    if (!t) continue;
    try {
      await t.envoyer(e.corps);
      await retirerOperation(e.cle);
      envoyees++;
    } catch (x) {
      if (estHorsLigne(x) || x?.statut === 401) break;
      refusees.push(await marquerOperation(e.cle, { etat: ETAT_ATTENTE.ERREUR, erreur: x.message }));
    }
  }
  return { envoyees, refusees };
}
