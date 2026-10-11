// Empreintes et journal chaîné du coffre-fort. Même calcul que ChaineCoffre côté C# (jeu partagé
// modules/ged/tests/cas/01_coffre.json) : toute altération d'un document ou d'une entrée casse la chaîne.

export const EMPREINTE_ORIGINE = '0'.repeat(64);

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 hexadécimal d'un texte (UTF-8), d'un ArrayBuffer, d'une vue typée ou d'un Blob. */
export async function sha256(donnees) {
  let octets = donnees;
  if (typeof donnees === 'string') octets = new TextEncoder().encode(donnees);
  else if (typeof Blob !== 'undefined' && donnees instanceof Blob) octets = await donnees.arrayBuffer();
  return hex(await globalThis.crypto.subtle.digest('SHA-256', octets));
}

/** Horodatage normalisé : ISO 8601 UTC à la milliseconde (2026-10-11T09:56:33.516Z). */
export const horodatage = (date) => new Date(date).toISOString();

/**
 * Texte d'une entrée du journal : empreinte précédente | empreinte du document | horodatage | document | version |
 * utilisateur | motif. Son SHA-256 est l'empreinte de l'entrée, reprise comme « précédente » par l'entrée suivante.
 */
export function texteEntree(e) {
  return [e.empreinte_precedente, e.empreinte_document, horodatage(e.horodatage), e.document, e.version, e.utilisateur, e.motif ?? ''].join('|');
}

export const empreinteEntree = (e) => sha256(texteEntree(e));

/**
 * Vérification du journal (dans l'ordre) : chaînage et empreinte de chaque entrée. Renvoie { ok, entrees, rupture }
 * où rupture = { index, raison } à la première anomalie.
 */
export async function verifierChaine(entrees) {
  let precedente = EMPREINTE_ORIGINE;
  for (let i = 0; i < entrees.length; i++) {
    const e = entrees[i];
    if (e.empreinte_precedente !== precedente) return { ok: false, entrees: entrees.length, rupture: { index: i, raison: 'Chaînage rompu' } };
    if ((await empreinteEntree(e)) !== e.empreinte_entree) return { ok: false, entrees: entrees.length, rupture: { index: i, raison: 'Entrée modifiée' } };
    precedente = e.empreinte_entree;
  }
  return { ok: true, entrees: entrees.length, rupture: null };
}
