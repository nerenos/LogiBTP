// Accès à l'API C#. En attendant l'authentification, l'utilisateur et le profil passent par des en-têtes.

export const ENTETES = { 'Content-Type': 'application/json', 'X-Utilisateur': 'demo', 'X-Profil': 'ADMIN' };

export class ErreurApi extends Error {
  constructor(statut, code, message, details) {
    super(message);
    this.statut = statut;
    this.code = code;
    this.details = details;
  }
}

async function appel(methode, url, corps, { keepalive = false } = {}) {
  const r = await fetch(`/api${url}`, { method: methode, headers: ENTETES, body: corps === undefined ? undefined : JSON.stringify(corps), keepalive });
  const texte = await r.text();
  const data = texte ? JSON.parse(texte) : null;
  if (!r.ok) throw new ErreurApi(r.status, data?.code ?? 'HTTP', data?.title ?? r.statusText, data?.details);
  return data;
}

export const api = {
  async disponible() {
    try {
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 1500);
      const r = await fetch('/api/sante', { signal: ctl.signal });
      return r.ok;
    } catch {
      return false;
    }
  },
  typesDocument: () => appel('GET', '/types-document'),
  definition: (code) => appel('GET', `/types-document/${encodeURIComponent(code)}/definition`),
  documents: () => appel('GET', '/documents'),
  document: (id) => appel('GET', `/documents/${id}`),
  creer: (creation) => appel('POST', '/documents', creation),
  enregistrer: (id, doc) => appel('PUT', `/documents/${id}`, doc),
  valider: (id, version) => appel('POST', `/documents/${id}/valider`, { ent_version: version }),
  copier: (id) => appel('POST', `/documents/${id}/copie`),
  creerIndice: (id) => appel('POST', `/documents/${id}/indices`),
  transformer: (id, demande) => appel('POST', `/documents/${id}/transformer`, demande),
  suivi: (id) => appel('GET', `/documents/${id}/suivi`),
  historique: (id) => appel('GET', `/documents/${id}/historique`),
  casTest: (arbitrage) => appel('POST', '/cas-test', arbitrage),
  // Verrou de modification d'un document (sans expiration ; déverrouillage manuel par un administrateur).
  verrouDocument: (id, jeton) => appel('GET', `/documents/${id}/verrou?jeton=${jeton}`),
  verrouillerDocument: (id, jeton) => appel('POST', `/documents/${id}/verrou`, { jeton }),
  deverrouillerDocument: (id, jeton) => appel('DELETE', `/documents/${id}/verrou?jeton=${jeton}`, undefined, { keepalive: true }),
  forcerDeverrouillageDocument: (id) => appel('DELETE', `/documents/${id}/verrou/force`),
};
