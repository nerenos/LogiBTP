// Appel de l'API du serveur (JSON ou formulaire multipart), commun aux fournisseurs des modules et au client.
// Réponse d'erreur du serveur (UseErreursMetier) : { status, code, title, details } → ErreurApi (ou la classe dérivée
// du module, pour qu'il garde son nom d'erreur).

export class ErreurApi extends Error {
  constructor(statut, code, message, details = null) {
    super(message);
    this.statut = statut;
    this.code = code;
    this.details = details;
  }
}

/**
 * Appel JSON (corps sérialisé, Content-Type posé) ou multipart (`FormData` : le navigateur pose le Content-Type avec sa
 * frontière, jamais celui des en-têtes fournis) ; renvoie la réponse lue (null si vide), lève `Erreur` sinon.
 */
export async function appelApi(url, { methode = 'GET', corps, entetes = {}, keepalive = false, Erreur = ErreurApi } = {}) {
  const formulaire = typeof FormData !== 'undefined' && corps instanceof FormData;
  const autres = Object.fromEntries(Object.entries(entetes).filter(([k]) => k.toLowerCase() !== 'content-type'));
  const r = await fetch(url, {
    method: methode,
    headers: formulaire ? autres : { 'Content-Type': 'application/json', ...autres },
    body: corps === undefined ? undefined : formulaire ? corps : JSON.stringify(corps),
    keepalive,
  });
  const texte = await r.text();
  const data = texte ? JSON.parse(texte) : null;
  if (!r.ok) throw new Erreur(r.status, data?.code ?? 'HTTP', data?.title ?? r.statusText, data?.details ?? null);
  return data;
}
