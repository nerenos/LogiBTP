// Module Facturation électronique, lot 11 du cœur : routes /api/facture-electronique du module (creerApiFe) sur le
// transport de l'application (session, société, erreurs ErreurApi) ; fichiers des flux lus en Blob.
import { appelApi, ErreurApi } from '@logibtp/socle';
import { creerApiFe } from '@logibtp/facture-electronique/ui';

/** Nom du fichier d'une réponse (Content-Disposition), sinon null. */
export function nomFichier(entete) {
  if (!entete) return null;
  const etoile = /filename\*=UTF-8''([^;]+)/i.exec(entete);
  if (etoile) return decodeURIComponent(etoile[1]);
  const simple = /filename="?([^";]+)"?/i.exec(entete);
  return simple ? simple[1] : null;
}

async function fichier(chemin) {
  const r = await fetch(`/api${chemin}`);
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    throw new ErreurApi(r.status, data?.code ?? 'HTTP', data?.title ?? r.statusText, data?.details ?? null);
  }
  return { contenu: await r.blob(), nom: nomFichier(r.headers.get('Content-Disposition')), type: r.headers.get('Content-Type') };
}

export const apiFe = creerApiFe({ json: (methode, chemin, corps) => appelApi(`/api${chemin}`, { methode, corps }), fichier });
