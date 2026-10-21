// Accès à l'API C#. L'utilisateur est celui de la session (cookie HttpOnly posé par /api/auth/connexion, envoyé par le
// navigateur à chaque appel) ; sans session, l'API répond 401 SESSION_REQUISE et l'application ouvre /connexion.

export const ENTETES = { 'Content-Type': 'application/json' };

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
  // Module Authentification : session, connexion (et connexion de test sans mot de passe en développement), mot de passe.
  auth: {
    session: () => appel('GET', '/auth/session'),
    politique: () => appel('GET', '/auth/politique'),
    connexion: (identifiant, motDePasse, resterConnecte) => appel('POST', '/auth/connexion', { identifiant, mot_de_passe: motDePasse, rester_connecte: resterConnecte }),
    comptesTest: () => appel('GET', '/auth/test/comptes'),
    connexionTest: (identifiant) => appel('POST', '/auth/test/connexion', { identifiant }),
    deconnexion: () => appel('POST', '/auth/deconnexion'),
    changerMotDePasse: (actuel, nouveau) => appel('POST', '/auth/mot-de-passe', { actuel, nouveau }),
    // Gestion des comptes (administrateur).
    profils: () => appel('GET', '/auth/profils'),
    comptes: ({ recherche = '', etat = '' } = {}) => appel('GET', `/auth/comptes?${new URLSearchParams({ recherche, etat })}`),
    compte: (id) => appel('GET', `/auth/comptes/${id}`),
    creerCompte: (c) => appel('POST', '/auth/comptes', c),
    modifierCompte: (id, c) => appel('PUT', `/auth/comptes/${id}`, c),
    reinitialiserCompte: (id) => appel('POST', `/auth/comptes/${id}/reinitialiser`),
    deverrouillerCompte: (id) => appel('POST', `/auth/comptes/${id}/deverrouiller`),
    personne: (type, id) => appel('GET', `/auth/personne?${new URLSearchParams({ type, id })}`),
    personnes: (recherche) => appel('GET', `/auth/personnes?${new URLSearchParams({ recherche })}`),
  },
  // Module Calendrier : calendriers, journées, jours fermés (société ou portée « service:<id> »), calendriers des services.
  calendriers: {
    liste: () => appel('GET', '/calendriers'),
    creer: (c) => appel('POST', '/calendriers', c),
    modifier: (id, c) => appel('PUT', `/calendriers/${id}`, c),
    supprimer: (id) => appel('DELETE', `/calendriers/${id}`),
    journees: (id, du, au, portee = '') => appel('GET', `/calendriers/${id ?? 0}/journees?${new URLSearchParams({ du, au, ...(portee ? { portee } : {}) })}`),
    joursFermes: (portee = null) => appel('GET', `/calendriers/jours-fermes${portee ? `?portee=${encodeURIComponent(portee)}` : ''}`),
    enregistrerJoursFermes: (s) => appel('PUT', '/calendriers/jours-fermes', s),
    services: () => appel('GET', '/ressources/calendriers-services'),
    enregistrerServices: (l) => appel('PUT', '/ressources/calendriers-services', l),
    journeesRessource: (type, id, du, au) => appel('GET', `/ressources/${type}/${id}/journees?${new URLSearchParams({ du, au })}`),
  },
  // Référentiel des ressources (db/195) : habilitations, missions d'intérim, motifs, natures MO, équipes.
  ressources: {
    typesHabilitation: () => appel('GET', '/ressources/types-habilitation'),
    enregistrerTypesHabilitation: (l) => appel('PUT', '/ressources/types-habilitation', l),
    habilitations: (element, id) => appel('GET', `/ressources/habilitations/${element}/${id}`),
    enregistrerHabilitations: (element, id, l) => appel('PUT', `/ressources/habilitations/${element}/${id}`, l),
    aSurveiller: ({ element = '', jours = 60 } = {}) => appel('GET', `/ressources/habilitations?${new URLSearchParams({ ...(element ? { element } : {}), jours })}`),
    exigeesMateriel: (id) => appel('GET', `/ressources/materiels/${id}/exigees`),
    enregistrerExigeesMateriel: (id, codes) => appel('PUT', `/ressources/materiels/${id}/exigees`, codes),
    missions: (salarie) => appel('GET', `/ressources/missions/${salarie}`),
    enregistrerMissions: (salarie, l) => appel('PUT', `/ressources/missions/${salarie}`, l),
    motifs: (domaine = '') => appel('GET', `/ressources/motifs${domaine ? `?domaine=${encodeURIComponent(domaine)}` : ''}`),
    enregistrerMotifs: (l) => appel('PUT', '/ressources/motifs', l),
    naturesMo: () => appel('GET', '/ressources/natures-mo'),
    enregistrerNaturesMo: (l) => appel('PUT', '/ressources/natures-mo', l),
    equipes: (date = '') => appel('GET', `/ressources/equipes${date ? `?date=${date}` : ''}`),
  },
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
    exporter: (code) => appel('GET', `/editions/modeles/${encodeURIComponent(code)}/export`),
    importer: (paquet, conflits) => appel('POST', '/editions/import', { paquet, conflits }),
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
  // Modules activés par société (db/193) et référentiel des services (membres : individus de notre société).
  modules: () => appel('GET', '/modules'),
  activerModule: (code, actif) => appel('PUT', `/modules/${encodeURIComponent(code)}`, { actif }),
  services: () => appel('GET', '/services'),
  enregistrerServices: (liste) => appel('PUT', '/services', liste),
  membresService: (id) => appel('GET', `/services/${id}/membres`),
  enregistrerMembresService: (id, membres) => appel('PUT', `/services/${id}/membres`, membres),
  servicesIndividu: (id) => appel('GET', `/services/individu/${id}`),
  // Module CRM (facultatif) : contexte de l'utilisateur, types de notes, notes (listes par vue, détail, écriture,
  // prise en charge, rendu au service, lecture).
  crm: {
    contexte: () => appel('GET', '/crm/contexte'),
    elements: (liste) => appel('POST', '/crm/elements', liste),
    typesNotes: () => appel('GET', '/crm/types-notes'),
    enregistrerTypesNotes: (liste) => appel('PUT', '/crm/types-notes', liste),
    notes: (filtre = {}) => appel('GET', `/crm/notes?${new URLSearchParams(Object.entries(filtre).filter(([, v]) => v !== undefined && v !== null && v !== ''))}`),
    note: (id, { reveler = false } = {}) => appel('GET', `/crm/notes/${id}${reveler ? '?reveler=true' : ''}`),
    creer: (n) => appel('POST', '/crm/notes', n),
    enregistrer: (id, n) => appel('PUT', `/crm/notes/${id}`, n),
    supprimer: (id) => appel('DELETE', `/crm/notes/${id}`),
    prendre: (id) => appel('POST', `/crm/notes/${id}/prendre`),
    rendre: (id) => appel('POST', `/crm/notes/${id}/rendre`),
    lue: (id) => appel('POST', `/crm/notes/${id}/lue`),
    parametres: () => appel('GET', '/crm/parametres'),
    enregistrerParametres: (p) => appel('PUT', '/crm/parametres', p),
    rappels: ({ tous = false } = {}) => appel('GET', `/crm/rappels${tous ? '?tous=true' : ''}`),
    ajouterRappel: (note, r) => appel('POST', `/crm/notes/${note}/rappels`, r),
    modifierRappel: (id, r) => appel('PUT', `/crm/rappels/${id}`, r),
    supprimerRappel: (id) => appel('DELETE', `/crm/rappels/${id}`),
    traiterRappel: (id) => appel('POST', `/crm/rappels/${id}/traiter`),
    rechercher: (type, texte) => appel('GET', `/crm/rechercher?${new URLSearchParams({ type, texte })}`),
    demandes: (filtre = {}) => appel('GET', `/crm/demandes?${new URLSearchParams(Object.entries(filtre).filter(([, v]) => v !== undefined && v !== null && v !== ''))}`),
    demande: (id) => appel('GET', `/crm/demandes/${id}`),
    creerDemande: (d) => appel('POST', '/crm/demandes', d),
    enregistrerDemande: (id, d) => appel('PUT', `/crm/demandes/${id}`, d),
    supprimerDemande: (id) => appel('DELETE', `/crm/demandes/${id}`),
    prendreDemande: (id) => appel('POST', `/crm/demandes/${id}/prendre`),
    rendreDemande: (id) => appel('POST', `/crm/demandes/${id}/rendre`),
    creerProjet: (id) => appel('POST', `/crm/demandes/${id}/projet`),
    statutsVisa: () => appel('GET', '/crm/statuts-visa'),
    enregistrerStatutsVisa: (l) => appel('PUT', '/crm/statuts-visa', l),
    plans: (filtre = {}) => appel('GET', `/crm/plans?${new URLSearchParams(Object.entries(filtre).filter(([, v]) => v !== undefined && v !== null && v !== ''))}`),
    plan: (id) => appel('GET', `/crm/plans/${id}`),
    creerPlan: (p) => appel('POST', '/crm/plans', p),
    enregistrerPlan: (id, p) => appel('PUT', `/crm/plans/${id}`, p),
    supprimerPlan: (id) => appel('DELETE', `/crm/plans/${id}`),
    ajouterIndice: (plan, i) => appel('POST', `/crm/plans/${plan}/indices`, i),
    modifierIndice: (id, i) => appel('PUT', `/crm/indices/${id}`, i),
    supprimerIndice: (id) => appel('DELETE', `/crm/indices/${id}`),
    ajouterVisa: (indice, v) => appel('POST', `/crm/indices/${indice}/visas`, v),
    saisirVisa: (id, v) => appel('PUT', `/crm/visas/${id}`, v),
    supprimerVisa: (id) => appel('DELETE', `/crm/visas/${id}`),
    diffusions: (filtre = {}) => appel('GET', `/crm/diffusions?${new URLSearchParams(Object.entries(filtre).filter(([, v]) => v !== undefined && v !== null && v !== ''))}`),
    diffusion: (id) => appel('GET', `/crm/diffusions/${id}`),
    creerDiffusion: (d) => appel('POST', '/crm/diffusions', d),
    fil: (filtre = {}) => appel('GET', `/crm/fil?${new URLSearchParams(Object.entries(filtre).filter(([, v]) => v !== undefined && v !== null && v !== ''))}`),
  },
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
