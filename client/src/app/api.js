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

/** PDF d'une édition produit par le serveur (Blob) ; en-têtes : nombre de pages, alertes. */
async function pdfEdition(demande, imprimer) {
  const r = await fetch('/api/editions/pdf', { method: 'POST', headers: ENTETES, body: JSON.stringify({ edition: demande, imprimer }) });
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    throw new ErreurApi(r.status, data?.code ?? 'HTTP', data?.title ?? r.statusText, data?.details);
  }
  let alertes = [];
  try { alertes = JSON.parse(decodeURIComponent(r.headers.get('X-Edition-Alertes') ?? '%5B%5D')); } catch { /* sans alertes */ }
  return { blob: await r.blob(), pages: Number(r.headers.get('X-Edition-Pages') ?? 0), alertes };
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
  // Éditions (module Édition) : aperçu (préparation pour le moteur du navigateur), PDF du serveur, modèles, chartes,
  // défauts par type ; mentions de la société (cœur).
  editions: {
    apercu: (demande) => appel('POST', '/editions/apercu', demande),
    pdf: pdfEdition,
    sources: () => appel('GET', '/editions/sources'),
    dictionnaire: (source) => appel('GET', `/editions/sources/${encodeURIComponent(source)}/dictionnaire`),
    modeles: (filtre = {}) => appel('GET', `/editions/modeles?${new URLSearchParams(Object.entries(filtre).filter(([, v]) => v !== undefined && v !== null))}`),
    modele: (code) => appel('GET', `/editions/modeles/${encodeURIComponent(code)}`),
    enregistrerModele: (code, m) => appel('PUT', `/editions/modeles/${encodeURIComponent(code)}`, m),
    supprimerModele: (code) => appel('DELETE', `/editions/modeles/${encodeURIComponent(code)}`),
    copierModele: (code, nouveau, libelle) => appel('POST', `/editions/modeles/${encodeURIComponent(code)}/copie`, { code: nouveau, libelle }),
    impacts: (code) => appel('GET', `/editions/modeles/${encodeURIComponent(code)}/impacts`),
    versions: (code) => appel('GET', `/editions/modeles/${encodeURIComponent(code)}/versions`),
    verifier: (contenu) => appel('POST', '/editions/verifier', contenu),
    chartes: () => appel('GET', '/editions/chartes'),
    enregistrerCharte: (code, c) => appel('PUT', `/editions/chartes/${encodeURIComponent(code)}`, c),
    defauts: () => appel('GET', '/editions/defauts'),
    enregistrerDefaut: (d) => appel('PUT', '/editions/defauts', d),
    productions: (source, id) => appel('GET', `/editions/productions?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`),
    produire: (demande, motif = 'DEMANDE') => appel('POST', '/editions/productions', { edition: demande, motif }),
    rangee: (source, id) => appel('GET', `/editions/rangee?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`),
    mentions: () => appel('GET', '/editions-btp/mentions'),
    enregistrerMentions: (m) => appel('PUT', '/editions-btp/mentions', m),
  },
  typesDocument: () => appel('GET', '/types-document'),
  textesType: (code) => appel('GET', `/types-document/${encodeURIComponent(code)}/textes`),
  enregistrerTextesType: (code, t) => appel('PUT', `/types-document/${encodeURIComponent(code)}/textes`, t),
  definition: (code) => appel('GET', `/types-document/${encodeURIComponent(code)}/definition`),
  documents: () => appel('GET', '/documents'),
  document: (id) => appel('GET', `/documents/${id}`),
  creer: (creation) => appel('POST', '/documents', creation),
  enregistrer: (id, doc) => appel('PUT', `/documents/${id}`, doc),
  valider: (id, version) => appel('POST', `/documents/${id}/valider`, { ent_version: version }),
  // Cycle de vie : envoi d'un document approuvé, validation du tiers, rejet (motif).
  envoyer: (id) => appel('POST', `/documents/${id}/envoyer`),
  validerTiers: (id) => appel('POST', `/documents/${id}/valider-tiers`),
  rejeter: (id, motif) => appel('POST', `/documents/${id}/rejeter`, { motif }),
  devalider: (id, motif) => appel('POST', `/documents/${id}/devalider`, { motif }),
  changerNumero: (id, numero, motif) => appel('PUT', `/documents/${id}/numero`, { numero, motif }),
  copier: (id) => appel('POST', `/documents/${id}/copie`),
  supprimerDocument: (id) => appel('DELETE', `/documents/${id}`),
  creerIndice: (id) => appel('POST', `/documents/${id}/indices`),
  transformer: (id, demande) => appel('POST', `/documents/${id}/transformer`, demande),
  suivi: (id) => appel('GET', `/documents/${id}/suivi`),
  // Restes à solder des lignes d'un document issu d'une transformation ; seuils de solde automatique (paramètres).
  restes: (id) => appel('GET', `/documents/${id}/restes`),
  avertissements: (id, action) => appel('GET', `/documents/${id}/avertissements?action=${action}`),
  // Plusieurs documents sources : création, ajout à un brouillon, documents en attente ; documents d'un marché.
  transformerPlusieurs: (demande) => appel('POST', '/documents/plusieurs', demande),
  ajouterSources: (id, sources) => appel('POST', `/documents/${id}/sources`, { sources }),
  documentsEnAttente: (cible, tiers) => appel('GET', `/documents/en-attente?cible=${cible}${tiers ? `&tiers=${tiers}` : ''}`),
  documentMarche: (marche, type) => appel('POST', `/structure/marches/${marche}/documents`, { type }),
  gestionMarche: (marche) => appel('GET', `/structure/marches/${marche}/gestion`),
  // Coordonnées figées d'un document : instantané d'une personne et de son contact dans l'annuaire.
  adressesLivraison: ({ chantier = null, fournisseur = null } = {}) => appel('GET', `/structure/adresses-livraison?${new URLSearchParams({ ...(chantier ? { chantier } : {}), ...(fournisseur ? { fournisseur } : {}) })}`),
  contactDocument: (perId, indId) => appel('GET', `/structure/contact?per_id=${perId}${indId ? `&ind_id=${indId}` : ''}`),
  postesMarche: (marche) => appel('GET', `/structure/marches/${marche}/postes`),
  // Acomptes : mode de la société, acomptes d'un marché, demande, émission de la facture ou du reçu.
  modeAcomptes: () => appel('GET', '/structure/acomptes/mode'),
  // Module Règlements (facultatif) : tiers, échéances avec leur reste, état des pièces, règlements, cautions.
  tiersReglements: () => appel('GET', '/reglements/tiers'),
  echeancesReglement: ({ tiers, sens, piece, ouvertes } = {}) => appel('GET', `/reglements/echeances?${new URLSearchParams(Object.entries({ tiers, sens, piece, ouvertes }).filter(([, v]) => v !== undefined && v !== null)).toString()}`),
  etatPieces: (pieces) => appel('POST', '/reglements/etat', { pieces }),
  reglements: ({ tiers, sens } = {}) => appel('GET', `/reglements?${new URLSearchParams(Object.entries({ tiers, sens }).filter(([, v]) => v !== undefined && v !== null)).toString()}`),
  enregistrerReglement: (r) => appel('POST', '/reglements', r),
  supprimerReglement: (id) => appel('DELETE', `/reglements/${id}`),
  cautions: ({ tiers } = {}) => appel('GET', `/reglements/cautions${tiers ? `?tiers=${tiers}` : ''}`),
  enregistrerCaution: (c) => appel('POST', '/reglements/cautions', c),
  supprimerCaution: (id) => appel('DELETE', `/reglements/cautions/${id}`),
  enregistrerModeAcomptes: (mode) => appel('PUT', '/structure/acomptes/mode', { mode }),
  acomptesMarche: (marche) => appel('GET', `/structure/marches/${marche}/acomptes`),
  demanderAcompte: (marche, demande) => appel('POST', `/structure/marches/${marche}/acomptes`, demande),
  emettreAcompte: (id) => appel('POST', `/structure/acomptes/${id}/emettre`),
  enregistrerPostesMarche: (marche, postes) => appel('PUT', `/structure/marches/${marche}/postes`, postes),
  commandesMarche: (id) => appel('GET', `/structure/documents/${id}/commandes-marche`),
  avancementDocument: (id) => appel('GET', `/structure/documents/${id}/avancement`),
  // Annulation par avoir (pièce et, dans un marché, pièces d'avancement suivantes) : liste puis annulation.
  piecesAnnulation: (id) => appel('GET', `/structure/documents/${id}/annulation`),
  annulerParAvoir: (id) => appel('POST', `/structure/documents/${id}/annulation`),
  seuilsSolde: () => appel('GET', '/parametres-documents/seuils-solde'),
  // Conditions de paiement (écriture : administrateur), conditions par défaut (ventes, achats), échéancier d'une pièce.
  conditionsPaiement: () => appel('GET', '/conditions-paiement'),
  // Règles des documents à trois niveaux : catalogue et valeurs (écriture : administrateur).
  reglesDocuments: () => appel('GET', '/regles-documents'),
  enregistrerReglesDocuments: (regles) => appel('PUT', '/regles-documents', regles),
  enregistrerConditionsPaiement: (liste) => appel('PUT', '/conditions-paiement', liste),
  conditionsDefaut: () => appel('GET', '/parametres-documents/conditions-paiement'),
  enregistrerConditionsDefaut: (v) => appel('PUT', '/parametres-documents/conditions-paiement', v),
  modifierEcheances: (id, liste) => appel('PUT', `/documents/${id}/echeances`, liste),
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
