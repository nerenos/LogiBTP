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
  supprimerDocument: (id) => appel('DELETE', `/documents/${id}`),
  creerIndice: (id) => appel('POST', `/documents/${id}/indices`),
  transformer: (id, demande) => appel('POST', `/documents/${id}/transformer`, demande),
  suivi: (id) => appel('GET', `/documents/${id}/suivi`),
  // Restes à solder des lignes d'un document issu d'une transformation ; seuils de solde automatique (paramètres).
  restes: (id) => appel('GET', `/documents/${id}/restes`),
  // Plusieurs documents sources : création, ajout à un brouillon, documents en attente ; documents d'un marché.
  transformerPlusieurs: (demande) => appel('POST', '/documents/plusieurs', demande),
  ajouterSources: (id, sources) => appel('POST', `/documents/${id}/sources`, { sources }),
  documentsEnAttente: (cible, tiers) => appel('GET', `/documents/en-attente?cible=${cible}${tiers ? `&tiers=${tiers}` : ''}`),
  documentMarche: (marche, type) => appel('POST', `/structure/marches/${marche}/documents`, { type }),
  commandesMarche: (id) => appel('GET', `/structure/documents/${id}/commandes-marche`),
  avancementDocument: (id) => appel('GET', `/structure/documents/${id}/avancement`),
  seuilsSolde: () => appel('GET', '/parametres-documents/seuils-solde'),
  enregistrerSeuilsSolde: (seuils) => appel('PUT', '/parametres-documents/seuils-solde', seuils),
  historique: (id) => appel('GET', `/documents/${id}/historique`),
  tracabilite: (id) => appel('GET', `/documents/${id}/tracabilite`),
  enregistrerOrigine: (id, origine) => appel('PUT', `/documents/${id}/origine`, origine),
  casTest: (arbitrage) => appel('POST', '/cas-test', arbitrage),
  // Verrou de modification d'un document (sans expiration ; déverrouillage manuel par un administrateur).
  verrouDocument: (id, jeton) => appel('GET', `/documents/${id}/verrou?jeton=${jeton}`),
  verrouillerDocument: (id, jeton) => appel('POST', `/documents/${id}/verrou`, { jeton }),
  deverrouillerDocument: (id, jeton) => appel('DELETE', `/documents/${id}/verrou?jeton=${jeton}`, undefined, { keepalive: true }),
  forcerDeverrouillageDocument: (id) => appel('DELETE', `/documents/${id}/verrou/force`),
  // Structure des affaires : référentiels des listes de choix, rattachement d'un document (même validé).
  structureReferentiels: () => appel('GET', '/structure/referentiels'),
  rattacherDocument: (id, r) => appel('PUT', `/structure/documents/${id}/rattachement`, r),
  structureIntervenants: (type, id) => appel('GET', `/structure/intervenants/${type}/${id}`),
  structureDocuments: (perimetre) => appel('POST', '/structure/documents', perimetre),
  structureDescendants: (id) => appel('GET', `/structure/documents/${id}/descendants`),
  // Affichage de la saisie : étiquettes de lignes, couleurs des modes de vente, vues de colonnes.
  etiquettesLigne: () => appel('GET', '/etiquettes-ligne'),
  enregistrerEtiquettesLigne: (liste) => appel('PUT', '/etiquettes-ligne', liste),
  couleursTypePrix: () => appel('GET', '/couleurs-type-prix'),
  enregistrerCouleursTypePrix: (liste) => appel('PUT', '/couleurs-type-prix', liste),
  vuesDocument: (type) => appel('GET', `/vues-document${type?.tyd_code ? `?type=${encodeURIComponent(type.tyd_code)}` : ''}`),
  enregistrerVueDocument: (vue) => appel('PUT', '/vues-document', vue),
  supprimerVueDocument: (id) => appel('DELETE', `/vues-document/${id}`),
  // Plan de comptes minimal (db/166) : libellés des comptes comptables des lignes.
  comptesComptables: () => appel('GET', '/comptes-comptables'),
};
