// Documents enregistrés hors ligne (mode hors ligne, lot 3) : file d'attente dans l'IndexedDB du navigateur (même
// origine, donc propre à la base de la société, partagée entre les fenêtres), une entrée par compte et par document.
// Entrée : { cle, compte, id_local (ent_id du document, négatif s'il a été créé hors ligne), id (serveur, null tant
// qu'il n'est pas créé), creation ({ params, initial } : création à faire), envoi (résultat du moteur, corps du PUT),
// saisie (contenu de l'éditeur, pour rouvrir le document), depart (document du serveur au début de la saisie hors
// ligne, base de la fusion), type_code, libelle, etat (ATTENTE | CONFLIT | FUSION | ERREUR), erreur, le }. FUSION : saisie fusionnée
// (lot 4) rouverte dans la page document, envoyée seulement quand l'utilisateur l'enregistre.
// Rien n'est effacé à la déconnexion : la saisie reste sur le poste jusqu'à son envoi.

const BASE = 'logibtp-hors-ligne';
const MAGASIN = 'documents';

export const ETATS_ATTENTE = { ATTENTE: 'En attente d’envoi', CONFLIT: 'Conflit à résoudre', FUSION: 'Fusion à vérifier puis enregistrer', ERREUR: 'Envoi refusé' };

/** Page d'arbitrage d'une entrée en conflit, sinon le document. */
export const urlAttente = (e) => (e.etat === 'CONFLIT' ? `/fusion/document/${e.id_local}` : `/document/${e.id_local}`);

/** Clé d'une entrée : compte et identifiant local du document. */
export const cleAttente = (compte, idLocal) => `${compte}:${idLocal}`;

/** Champs de l'entête tenus par le serveur (création, numérotation, versions). */
export const CHAMPS_SERVEUR = ['ent_id', 'ent_tyd_id', 'ent_numero', 'ent_version', 'ent_groupe_id', 'ent_std_id', 'ent_indice', 'ent_is_reference',
  'ent_verrouille', 'ent_cree_le', 'ent_cree_par', 'ent_modifie_le', 'ent_modifie_par', 'ent_version_calcul', 'ent_date_validite'];

/**
 * Entête d'un document créé hors ligne, au moment de son envoi : l'entête créé par le serveur (défauts du type), puis
 * chaque champ saisi hors ligne (différent du brouillon initial), hors champs tenus par le serveur.
 */
export function enteteACreer(local, initial, serveur) {
  const doc = { ...serveur };
  for (const [k, v] of Object.entries(local)) {
    if (CHAMPS_SERVEUR.includes(k)) continue;
    if (!(k in serveur) || JSON.stringify(v) !== JSON.stringify(initial?.[k])) doc[k] = v;
  }
  return doc;
}

/** Corps d'enregistrement rattaché au document créé : entête fusionné, lignes et ventilations du nouvel identifiant. */
export function envoiCree(envoi, initial, serveur) {
  const id = serveur.ent_id;
  return {
    ...envoi,
    document: enteteACreer(envoi.document, initial, serveur),
    lignes: envoi.lignes.map((l) => ({ ...l, lig_ent_id: id })),
    ventilations: (envoi.ventilations ?? []).map((v) => ({ ...v, vfr_ent_id: id })),
  };
}

/** Erreur due au serveur injoignable (réseau, service worker, relais sans API) plutôt qu'à un refus de l'API. */
export function estHorsLigne(e) {
  if (e instanceof TypeError) return true;
  if (e?.code === 'HORS_LIGNE') return true;
  return e?.code === 'HTTP' && [500, 502, 503, 504].includes(e?.statut);
}

function ouvrir() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(MAGASIN, { keyPath: 'cle' }).createIndex('compte', 'compte');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

async function operation(mode, f) {
  const db = await ouvrir();
  try {
    return await new Promise((ok, ko) => {
      const tx = db.transaction(MAGASIN, mode);
      const r = f(tx.objectStore(MAGASIN));
      tx.oncomplete = () => ok(r?.result);
      tx.onerror = () => ko(tx.error);
    });
  } finally { db.close(); }
}

/** Écrit (ou remplace) l'entrée d'un document ; la version de départ et la création à faire déjà notées sont gardées. */
export async function ecrireAttente(entree) {
  const cle = cleAttente(entree.compte, entree.id_local);
  const avant = await lireAttente(entree.compte, entree.id_local);
  const e = { ...entree, cle, depart: avant?.depart ?? entree.depart ?? null, creation: 'creation' in entree ? entree.creation : avant?.creation ?? null,
    etat: entree.etat ?? 'ATTENTE', erreur: entree.erreur ?? null, le: new Date().toISOString() };
  await operation('readwrite', (m) => m.put(e));
  return e;
}

export const lireAttente = (compte, idLocal) => operation('readonly', (m) => m.get(cleAttente(compte, idLocal)));

export const retirerAttente = (compte, idLocal) => operation('readwrite', (m) => m.delete(cleAttente(compte, idLocal)));

/** Entrées d'un compte, les plus anciennes d'abord. */
export async function listeAttente(compte) {
  const l = await operation('readonly', (m) => m.index('compte').getAll(compte)) ?? [];
  return l.sort((a, b) => a.le.localeCompare(b.le));
}

/** Change l'état d'une entrée (CONFLIT, ERREUR, retour en ATTENTE) sans toucher à sa saisie. */
export async function marquerAttente(compte, idLocal, champs) {
  const e = await lireAttente(compte, idLocal);
  if (!e) return null;
  const n = { ...e, ...champs };
  await operation('readwrite', (m) => m.put(n));
  return n;
}
