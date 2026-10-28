import { SUJET_FENETRE } from '../codes.js';
import { api, ErreurApi } from '../api.js';
import { listeAttente, lireAttente, ecrireAttente, retirerAttente, marquerAttente, envoiCree, estHorsLigne, ETAT_ATTENTE } from './attente.js';

// Envoi des documents enregistrés hors ligne (mode hors ligne, lot 3) : au retour de l'API, au démarrage et après une
// reconnexion. Une seule fenêtre envoie à la fois (verrou du navigateur). Pour chaque entrée en attente du compte :
// création du document s'il a été créé hors ligne (entrée aussitôt rattachée au document créé : jamais deux
// créations), puis enregistrement. Envoyé : entrée retirée, sujet `hors-ligne-envoye` publié (la page du document,
// dans cette fenêtre ou une autre, reprend les identifiants définitifs). Version du serveur changée (409) : CONFLIT,
// la saisie reste sur le poste, à fusionner (pages/fusion-document.js). Autre refus : ERREUR, à corriger en ouvrant le
// document. FUSION : envoyée par la page document quand l'utilisateur enregistre la saisie fusionnée.

/** Sujet publié quand les entrées en attente changent (compteur du bandeau). */
export const SUJET_ATTENTE = 'attente-hors-ligne';

/**
 * Envoie une entrée (sous le verrou) ; renvoie { id, rep }, null si elle n'est plus dans la file, ou lève l'erreur de
 * l'API (serveur injoignable compris). L'entrée est retirée de la file après l'enregistrement.
 */
async function envoyerEntree(app, entree) {
  // Relue sous le verrou : déjà envoyée par une autre fenêtre, rien à faire.
  let e = await lireAttente(entree.compte, entree.id_local);
  if (!e) return null;
  if (e.creation) {
    const cree = await api.creer(e.creation.params);
    // Rattachée au document créé avant l'enregistrement : une coupure entre les deux ne le recrée pas.
    e = await ecrireAttente({ ...e, id: cree.document.ent_id, creation: null, envoi: envoiCree(e.envoi, e.creation.initial, cree.document) });
  }
  const rep = await api.enregistrer(e.id, e.envoi);
  await retirerAttente(e.compte, e.id_local);
  app.publier(SUJET_FENETRE.HORS_LIGNE_ENVOYE, { compte: e.compte, id_local: e.id_local, id: e.id, rep, envoi: e.envoi });
  app.publier(SUJET_ATTENTE, {});
  return { id: e.id, rep };
}

const VERROU = 'logibtp-envoi-hors-ligne';
const sousVerrou = (options, f) => (globalThis.navigator?.locks ? navigator.locks.request(VERROU, options, f) : f(true));

/** Envoi d'un document de la file (enregistrement depuis sa page) : attend le verrou ; { id, rep } ou null. */
export const envoyerDocument = (app, compte, idLocal) => sousVerrou({}, () => envoyerEntree(app, { compte, id_local: idLocal }));

/** Envoi de toutes les entrées en attente du compte connecté ; renvoie le nombre envoyé. */
export async function envoyerAttentes(app) {
  const compte = app.utilisateur();
  if (!compte || app.apiPerdue) return 0;
  const envoyer = async () => {
    let n = 0;
    for (const e of await listeAttente(compte)) {
      if (e.etat !== ETAT_ATTENTE.ATTENTE) continue;
      try {
        if (await envoyerEntree(app, e)) n++;
      } catch (x) {
        if (estHorsLigne(x) || x?.statut === 401) break;
        const conflit = x instanceof ErreurApi && x.statut === 409;
        await marquerAttente(compte, e.id_local, { etat: conflit ? ETAT_ATTENTE.CONFLIT : ETAT_ATTENTE.ERREUR, erreur: x.message });
        app.publier(SUJET_ATTENTE, {});
        app.message(`${e.libelle} : ${conflit ? 'modifié entre-temps sur le serveur, vos modifications restent sur ce poste' : `envoi refusé (${x.message})`}`, 'erreur');
      }
    }
    if (n) app.message(`${n} document${n > 1 ? 's' : ''} saisi${n > 1 ? 's' : ''} hors ligne envoyé${n > 1 ? 's' : ''} au serveur`, 'succes');
    return n;
  };
  // Une seule fenêtre envoie : les autres passent leur tour.
  return sousVerrou({ ifAvailable: true }, (verrou) => (verrou ? envoyer() : 0));
}
