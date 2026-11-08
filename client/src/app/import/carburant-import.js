// Import d'un fichier de cartes carburant (plan materiel-suites, lot 10) : lecture par le module Import, écriture des
// pleins par le serveur (rapprochement par carte puis immatriculation, doublons ignorés), rapport des lignes non reprises.
import { texte } from '@logibtp/socle/dictionnaire';
import { lireFichierCarburant } from '@logibtp/import';

export const FORMAT_CARBURANT = Object.freeze({ libelle: 'Cartes carburant', extensions: '.csv,.txt' });

/** Écriture par l'API (chargée à la demande : le module reste utilisable hors navigateur, pour les tests). */
const ecrireParApi = async (pleins) => (await import('../api.js')).api.ecrirePleinsCarburant(pleins);

/**
 * Lit le fichier puis envoie les pleins lus : renvoie le rapport { lus, ecrits, doublons, non_rapproches, erreurs }
 * (rangs de lignes) ; une ligne mal formée est dans `erreurs` avec son message, sans bloquer les autres.
 */
export async function importerCarburant(contenu, correspondances, ecrire = ecrireParApi) {
  const lecture = lireFichierCarburant(contenu, correspondances);
  const reponse = lecture.pleins.length ? await ecrire(lecture.pleins) : { ecrits: 0, doublons: [], non_rapproches: [], erreurs: [] };
  const erreurs = [
    ...lecture.erreurs,
    ...(reponse.erreurs ?? []).map((e) => ({ rang: e.rang, message: texte('import_btp.carburant.erreur_serveur', { code: e.code }) })),
  ];
  return { lus: lecture.pleins.length, ecrits: reponse.ecrits, doublons: reponse.doublons ?? [], non_rapproches: reponse.non_rapproches ?? [], erreurs };
}

/** Phrase de synthèse du rapport. */
export function resumeCarburant(r) {
  return texte('import_btp.carburant.resume', { ecrits: r.ecrits, doublons: r.doublons.length, non_rapproches: r.non_rapproches.length, erreurs: r.erreurs.length });
}
