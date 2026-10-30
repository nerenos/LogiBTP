import { NIVEAU_CONFIDENTIALITE, PROFIL, ErreurApi, appelApi } from '@logibtp/socle';
import { sha256, horodatage, empreinteEntree, verifierChaine, EMPREINTE_ORIGINE } from './coffre.js';
import { editionsAPurger, GENRES } from './versions.js';
import { normaliserRecherche, texteRecherche } from './recherche.js';
import { accesAutorise, peutChangerAcces, CONFIDENTIALITES } from './acces.js';
import { classer, REGLES_CLASSIFICATION_DEFAUT } from './classification.js';
import { echeancesRetention, REGLES_RETENTION_DEFAUT } from './retention.js';
import { extraireTexte, ETATS_INDEX } from './texte.js';

// Fournisseurs de la GED. Même interface pour l'API (routes MapModuleGed) et pour la mémoire (démo hors ligne, tests) :
//
//   parametres()                         → { editions_conservees, taille_apercu_max, adresse_copie_cachee, categories,
//                                            regles_classification }
//   lister({ type_element, id_element, recherche, supprimes, coffre, archives, sans_element })
//                                        → documents (version courante, nb_pieces) ; archives : documents archivés
//   document(id)                         → document + versions (éditions et étapes) + pieces (pièces jointes d'un mail)
//                                          + derivations, classification, extrait_texte, retention (échéances)
//   deposer({ fichier, meta })           → document créé (meta : titre, categorie, date_document, auteur, type_element,
//                                          id_element, repertoire_id (l'élément lié devient celui du répertoire),
//                                          confidentialite, acces_profils, acces_utilisateurs, mots_cles, resume, notes,
//                                          nature, mail, parent_id, coffre) ; texte extrait, catégorie proposée par la
//                                          classification automatique quand elle n'est pas saisie
//   modifier(id, meta)                   → document (informations seulement ; le contenu passe par une version ;
//                                          a_envoyer : pièce jointe à envoyer avec l'élément lié, module Mail ;
//                                          terrain : pièce diffusée sur le terrain (application de terrain) ;
//                                          repertoire_id : classement, lie le document à l'élément du répertoire)
//   nouvelleVersion(id, { fichier, genre, etape, etat, commentaire })  → document (édition : N dernières conservées)
//   etape(id, { etape, etat, commentaire })   → document (étape sans nouveau fichier)
//   contenu(versionId) → Blob            urlContenu(versionId, { telecharger }) → URL
//   mettreAuCoffre(id, motif)            → document verrouillé, entrée chaînée au journal
//   verifier(id)                         → { integre, empreinte_attendue, empreinte_calculee, coffre: { ok, … } }
//   supprimer(id) / restaurer(id)        → document masqué / réaffiché ;   purger(id) → suppression définitive (ADMIN)
//   verifierCoffre()                     → { ok, entrees, rupture }
//   statistiques({ type_element, id_element }) → { nb_documents, nb_supprimes, nb_coffre, nb_versions, taille,
//                                          nb_consultations, derniere_activite } (élément lié, ou toute la GED)
//   repertoires({ type_element, id_element }) → [{ id, nom, parent_id, type_element, id_element, nb_documents }]
//   creerRepertoire({ nom, parent_id, type_element, id_element }) / modifierRepertoire(id, { nom, parent_id })
//   supprimerRepertoire(id)              → répertoire vide seulement (REPERTOIRE_NON_VIDE)
//   ajouterDerivation(id, { cible_id, type, langue, commentaire }) → document source ; supprimerDerivation(id)
//   archiver(id, motif) → { archives } ; desarchiver(id) → document ; echeances() → [{ document, echeances }]
//   appliquerRetention() → { documents, archives, ids } (ADMIN) ; regles() → { retention, classification }
//   remplacerReglesRetention(regles) / remplacerReglesClassification(regles) (ADMIN) ;
//   indexer(id) → document ; indexerEnAttente() → { indexes, restants } (ADMIN)
// Intégrité (comme les déclencheurs de la base) : élément lié complet et existant (option elementExiste du fournisseur
// mémoire ; en base : f_ged_element_existe remplacée par l'application), pièces jointes et dérivations sans boucle,
// répertoire du même élément que ses documents. Accès : acces.js (comme AccesGed.cs).

export class ErreurGed extends ErreurApi {}

const requete = (filtre) => new URLSearchParams(Object.entries(filtre).filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)]));

export class FournisseurGedApi {
  constructor({ base = '/api/ged', entetes = {} } = {}) {
    this.base = base;
    this.entetes = entetes;
  }

  /** JSON ou formulaire multipart (FormData : Content-Type posé par le navigateur, appelApi du socle). */
  appel(methode, url, corps) {
    return appelApi(`${this.base}${url}`, { methode, corps, entetes: this.entetes, Erreur: ErreurGed });
  }

  #formulaire(fichier, nomFichier, donnees) {
    const f = new FormData();
    if (fichier) f.append('fichier', fichier, nomFichier ?? fichier.name ?? 'document');
    f.append('donnees', JSON.stringify(donnees));
    return f;
  }

  parametres() { return this.appel('GET', '/parametres'); }
  lister(filtre = {}) {
    const q = requete(filtre);
    return this.appel('GET', `/documents${q.size ? `?${q}` : ''}`);
  }
  document(id) { return this.appel('GET', `/documents/${id}`); }
  deposer({ fichier, nom_fichier, meta }) { return this.appel('POST', '/documents', this.#formulaire(fichier, nom_fichier, meta)); }
  modifier(id, meta) { return this.appel('PUT', `/documents/${id}`, meta); }
  nouvelleVersion(id, { fichier, nom_fichier, ...v }) { return this.appel('POST', `/documents/${id}/versions`, this.#formulaire(fichier, nom_fichier, v)); }
  etape(id, e) { return this.appel('POST', `/documents/${id}/etapes`, e); }
  async contenu(versionId) {
    const r = await fetch(this.urlContenu(versionId), { headers: this.entetes });
    if (!r.ok) throw new ErreurGed(r.status, 'CONTENU', 'Contenu indisponible');
    return r.blob();
  }
  urlContenu(versionId, { telecharger = false } = {}) { return `${this.base}/versions/${versionId}/contenu${telecharger ? '?telecharger=true' : ''}`; }
  mettreAuCoffre(id, motif) { return this.appel('POST', `/documents/${id}/coffre`, { motif }); }
  verifier(id) { return this.appel('GET', `/documents/${id}/verification`); }
  supprimer(id) { return this.appel('DELETE', `/documents/${id}`); }
  restaurer(id) { return this.appel('POST', `/documents/${id}/restaurer`); }
  purger(id) { return this.appel('DELETE', `/documents/${id}/definitif`); }
  verifierCoffre() { return this.appel('GET', '/coffre/verification'); }
  statistiques({ type_element = null, id_element = null } = {}) {
    const q = requete({ type_element, id_element });
    return this.appel('GET', `/statistiques${q.size ? `?${q}` : ''}`);
  }
  repertoires({ type_element = null, id_element = null } = {}) {
    const q = requete({ type_element, id_element });
    return this.appel('GET', `/repertoires${q.size ? `?${q}` : ''}`);
  }
  creerRepertoire(r) { return this.appel('POST', '/repertoires', r); }
  modifierRepertoire(id, r) { return this.appel('PUT', `/repertoires/${id}`, r); }
  supprimerRepertoire(id) { return this.appel('DELETE', `/repertoires/${id}`); }
  ajouterDerivation(id, d) { return this.appel('POST', `/documents/${id}/derivations`, d); }
  supprimerDerivation(id) { return this.appel('DELETE', `/derivations/${id}`); }
  archiver(id, motif = null) { return this.appel('POST', `/documents/${id}/archiver`, { motif }); }
  desarchiver(id) { return this.appel('POST', `/documents/${id}/desarchiver`); }
  echeances() { return this.appel('GET', '/retention/echeances'); }
  appliquerRetention() { return this.appel('POST', '/retention/appliquer'); }
  regles() { return this.appel('GET', '/regles'); }
  remplacerReglesRetention(regles) { return this.appel('PUT', '/regles/retention', regles); }
  remplacerReglesClassification(regles) { return this.appel('PUT', '/regles/classification', regles); }
  indexer(id) { return this.appel('POST', `/documents/${id}/indexer`); }
  indexerEnAttente() { return this.appel('POST', '/indexation'); }
}

export const PARAMETRES_DEFAUT = {
  editions_conservees: 5,
  taille_apercu_max: 15 * 1024 * 1024,
  adresse_copie_cachee: '',
  categories: [
    { code: 'devis_signe', libelle: 'Devis signé', coffre: true }, { code: 'facture_recue', libelle: 'Facture reçue', coffre: true },
    { code: 'facture_emise', libelle: 'Facture émise', coffre: true }, { code: 'contrat', libelle: 'Contrat', coffre: true },
    { code: 'courrier', libelle: 'Courrier' }, { code: 'mail', libelle: 'Mail' }, { code: 'photo', libelle: 'Photo' },
    { code: 'plan', libelle: 'Plan' }, { code: 'certificat', libelle: 'Certificat / habilitation' }, { code: 'autre', libelle: 'Autre' },
  ],
};

const TYPES_DERIVATION = ['VERSION', 'TRADUCTION', 'ADAPTATION', 'EXTRAIT', 'ANNOTATION'];
const MODIFIABLES_COFFRE = ['resume', 'notes', 'a_envoyer', 'terrain', 'confidentialite', 'acces_profils', 'acces_utilisateurs', 'mots_cles', 'langue', 'repertoire_id'];
const MODIFIABLES = [...MODIFIABLES_COFFRE, 'titre', 'categorie', 'date_document', 'auteur', 'type_element', 'id_element'];
const CLES_ACCES = ['confidentialite', 'acces_profils', 'acces_utilisateurs'];
const EXTRAIT_MAX = 2000;

const liste = (v) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x ?? '').trim()).filter(Boolean))];
const texte = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const memeElement = (a, b) => (a.type_element ?? null) === (b.type_element ?? null) && String(a.id_element ?? '') === String(b.id_element ?? '');

function confidentialite(v) {
  const n = texte(v)?.toUpperCase() ?? NIVEAU_CONFIDENTIALITE.INTERNE;
  if (!CONFIDENTIALITES.some(([c]) => c === n)) throw new ErreurGed(422, 'CONFIDENTIALITE', `Confidentialité inconnue : ${v}`);
  return n;
}

/**
 * Fournisseur en mémoire : mêmes règles que le serveur (éditions conservées, coffre-fort chaîné et immuable,
 * suppression par masquage, purge réservée au profil ADMIN et interdite pour le coffre-fort, accès, répertoires,
 * dérivations, rétention et archive séparée). Recherche : tous les mots dans les métadonnées, noms de fichiers,
 * mots-clés et texte extrait (le serveur ajoute la recherche plein texte avec racines françaises).
 */
export class FournisseurGedMemoire {
  /** elementExiste(type, id) → true (existe), false (inexistant) ou null (type inconnu) : élément lié vérifié au dépôt. */
  constructor({ utilisateur = 'demo', profil = PROFIL.ADMIN, parametres = {}, horloge = () => Date.now(), elementExiste = () => true,
    reglesRetention = REGLES_RETENTION_DEFAUT, reglesClassification = REGLES_CLASSIFICATION_DEFAUT } = {}) {
    this.elementExiste = elementExiste;
    this.utilisateur = utilisateur;
    this.profil = profil;
    this.params = { ...PARAMETRES_DEFAUT, ...parametres };
    this.horloge = horloge;
    this.contenus = new Map();   // empreinte → Blob
    this.documents = [];
    this.versions = [];
    this.journal = [];
    this.dossiers = [];
    this.liens = [];             // dérivations
    this.archives = [];          // documents déplacés dans l'archive (avec versions et dérivations)
    this.reglesRetention = structuredClone(reglesRetention);
    this.reglesClassification = structuredClone(reglesClassification);
    this.urls = new Map();
  }

  get admin() { return this.profil === PROFIL.ADMIN; }
  get #moi() { return { code: this.utilisateur, profil: this.profil }; }
  #maintenant() { return new Date(this.horloge()).toISOString(); }
  #aujourdhui() { return this.#maintenant().slice(0, 10); }
  #suivant(l) { return Math.max(0, ...l.map((x) => x.id)) + 1; }

  async parametres() { return { ...structuredClone(this.params), regles_classification: structuredClone(this.reglesClassification) }; }

  #visible(d) { return accesAutorise(d, this.#moi); }

  #doc(id) {
    const d = this.documents.find((x) => x.id === Number(id));
    if (!d || !this.#visible(d)) throw new ErreurGed(404, 'INTROUVABLE', `Document ${id} introuvable`);
    return d;
  }

  #versions(id) { return this.versions.filter((v) => v.document === Number(id)).sort((a, b) => a.numero - b.numero); }

  #vue(d, versions = this.#versions(d.id), nbPieces = null) {
    const v = versions.at(-1);
    const { texte_contenu: _, ...infos } = d;
    return {
      ...structuredClone(infos),
      version: v ? { id: v.id, numero: v.numero, nom_fichier: v.nom_fichier, type_mime: v.type_mime, taille: v.taille, genre: v.genre } : null,
      nb_pieces: nbPieces ?? this.documents.filter((x) => x.parent_id === d.id && !x.supprime).length,
      nb_versions: versions.length,
    };
  }

  #corpus(d) {
    return `${texteRecherche(d)} ${normaliserRecherche([...this.#versions(d.id).map((v) => v.nom_fichier), ...(d.mots_cles ?? []), d.texte_contenu ?? ''].join(' '))}`;
  }

  async lister({ type_element, id_element, recherche, supprimes = false, coffre = false, archives = false, sans_element = false } = {}) {
    const mots = normaliserRecherche(recherche).split(/\s+/).filter(Boolean);
    const element = (d) => (type_element ? d.type_element === type_element && String(d.id_element) === String(id_element) : !sans_element || !d.type_element);
    const trouve = (d, corpus) => !mots.length || mots.every((m) => corpus.includes(m));
    const tri = (a, b) => String(b.date_document ?? '').localeCompare(String(a.date_document ?? '')) || b.id - a.id;
    if (archives) {
      const surPlace = this.documents.filter((d) => d.archive && this.#visible(d) && element(d) && trouve(d, this.#corpus(d))).map((d) => this.#vue(d));
      const deplaces = this.archives.filter((a) => accesAutorise(a.document, this.#moi) && element(a.document)
        && trouve(a.document, `${texteRecherche(a.document)} ${normaliserRecherche([...a.versions.map((v) => v.nom_fichier), ...(a.document.mots_cles ?? []), a.document.texte_contenu ?? ''].join(' '))}`))
        .map((a) => this.#vueArchive(a));
      return [...surPlace, ...deplaces].sort(tri);
    }
    return this.documents
      .filter((d) => this.#visible(d) && !d.archive && (supprimes ? true : !d.supprime) && element(d) && (!coffre || d.coffre) && trouve(d, this.#corpus(d)))
      .sort(tri)
      .map((d) => this.#vue(d));
  }

  #vueArchive(a) {
    return { ...this.#vue(a.document, [...a.versions].sort((x, y) => x.numero - y.numero), this.archives.filter((x) => x.document.parent_id === a.document.id).length), archive: true, archive_le: a.archive_le };
  }

  async document(id) {
    const d = this.documents.find((x) => x.id === Number(id));
    if (!d || !this.#visible(d)) return this.#documentArchive(id);
    return {
      ...this.#vue(d),
      versions: structuredClone(this.#versions(d.id)),
      pieces: this.documents.filter((x) => x.parent_id === d.id && !x.supprime && this.#visible(x)).map((x) => this.#vue(x)),
      parent: d.parent_id && this.#visible(this.documents.find((x) => x.id === d.parent_id)) ? this.#vue(this.documents.find((x) => x.id === d.parent_id)) : null,
      journal_coffre: structuredClone(this.journal.filter((e) => e.document === d.id)),
      derivations: this.#derivations(d.id),
      extrait_texte: d.texte_contenu ? (d.texte_contenu.length > EXTRAIT_MAX ? `${d.texte_contenu.slice(0, EXTRAIT_MAX)}…` : d.texte_contenu) : null,
      retention: this.#echeances(d),
    };
  }

  #documentArchive(id) {
    const a = this.archives.find((x) => x.document.id === Number(id));
    if (!a || !accesAutorise(a.document, this.#moi)) throw new ErreurGed(404, 'INTROUVABLE', `Document ${id} introuvable`);
    const parent = this.archives.find((x) => x.document.id === a.document.parent_id);
    return {
      ...this.#vueArchive(a), versions: structuredClone([...a.versions].sort((x, y) => x.numero - y.numero)),
      pieces: this.archives.filter((x) => x.document.parent_id === a.document.id).map((x) => this.#vueArchive(x)),
      parent: parent ? this.#vueArchive(parent) : null, journal_coffre: [], derivations: [], classification: a.document.classification ?? null,
      extrait_texte: a.document.texte_contenu ? a.document.texte_contenu.slice(0, EXTRAIT_MAX) : null, retention: null,
    };
  }

  #echeances(d) {
    const e = echeancesRetention(d, this.reglesRetention, this.#aujourdhui());
    return { ...e, libelle: this.reglesRetention.find((r) => r.id === e.regle)?.libelle ?? null };
  }

  async #stocker(fichier) {
    const blob = fichier instanceof Blob ? fichier : new Blob([fichier]);
    const empreinte = await sha256(blob);
    if (!this.contenus.has(empreinte)) this.contenus.set(empreinte, blob);
    return { empreinte, taille: blob.size, type: blob.type };
  }

  async #ajouterVersion(d, { fichier, nom_fichier, genre, etape = null, etat = null, commentaire = null, empreinte = null }) {
    const existantes = this.#versions(d.id);
    let c;
    if (fichier) c = await this.#stocker(fichier);
    else {
      const derniere = existantes.at(-1);
      if (!derniere) throw new ErreurGed(422, 'FICHIER', 'Fichier attendu');
      c = { empreinte: empreinte ?? derniere.empreinte, taille: derniere.taille, type: derniere.type_mime };
      nom_fichier ??= derniere.nom_fichier;
    }
    const v = {
      id: Math.max(0, ...this.versions.map((x) => x.id), ...this.archives.flatMap((a) => a.versions.map((x) => x.id))) + 1, document: d.id,
      numero: (existantes.at(-1)?.numero ?? 0) + 1, genre, etape, etat,
      empreinte: c.empreinte, nom_fichier: nom_fichier ?? fichier?.name ?? 'document', type_mime: fichier?.type || c.type || 'application/octet-stream',
      taille: c.taille, auteur: this.utilisateur, date: this.#maintenant(), commentaire,
    };
    this.versions.push(v);
    if (etat) d.etat = etat;
    d.modifie_le = v.date;
    // Éditions au-delà des N dernières : purgées (jamais les étapes ni les versions d'un document du coffre-fort).
    const purge = new Set(editionsAPurger(this.#versions(d.id), this.params.editions_conservees, { coffre: d.coffre }));
    this.versions = this.versions.filter((x) => x.document !== d.id || !purge.has(x.numero));
    this.#nettoyerContenus();
    return v;
  }

  #nettoyerContenus() {
    const utilises = new Set([...this.versions, ...this.archives.flatMap((a) => a.versions)].map((v) => v.empreinte));
    for (const e of this.contenus.keys()) if (!utilises.has(e)) this.contenus.delete(e);
  }

  /** Élément lié complet et existant (comme ServiceGed.ControlerElement et le déclencheur tr_ged_element_existe). */
  async #controlerElement(type, id) {
    const t = type || null;
    const i = id === null || id === undefined || id === '' ? null : String(id);
    if (t === null && i === null) return;
    if (t === null || i === null) throw new ErreurGed(422, 'ELEMENT', 'Élément lié incomplet : type et identifiant vont ensemble');
    const existe = await this.elementExiste(t, i);
    if (existe === null || existe === undefined) throw new ErreurGed(422, 'ELEMENT_TYPE', `Type d'élément inconnu : ${t}`);
    if (!existe) throw new ErreurGed(422, 'ELEMENT_INEXISTANT', `Élément lié inexistant : ${t} ${i}`);
  }

  /** Pièce jointe sans boucle : le parent n'est ni le document ni l'une de ses pièces jointes (tr_ged_parent_sans_boucle). */
  controlerParent(documentId, parentId) {
    this.#doc(parentId);
    const vus = new Set();
    for (let x = Number(parentId); x !== null && !vus.has(x); x = this.documents.find((d) => d.id === x)?.parent_id ?? null) {
      if (documentId !== null && documentId !== undefined && x === Number(documentId)) {
        throw new ErreurGed(422, 'BOUCLE', 'Un document ne peut pas être une pièce jointe de lui-même ou de ses pièces jointes');
      }
      vus.add(x);
    }
  }

  #dossier(id) {
    const r = this.dossiers.find((x) => x.id === Number(id));
    if (!r) throw new ErreurGed(404, 'INTROUVABLE', `Répertoire ${id} introuvable`);
    return r;
  }

  async deposer({ fichier, nom_fichier, meta = {} }) {
    if (!meta.titre?.trim()) throw new ErreurGed(422, 'TITRE', 'Titre obligatoire');
    const m = { ...meta };
    // Répertoire de dépôt : le document est lié à l'élément du répertoire (même si ce n'est pas celui affiché).
    if (texte(m.repertoire_id)) Object.assign(m, { type_element: this.#dossier(m.repertoire_id).type_element, id_element: this.#dossier(m.repertoire_id).id_element });
    await this.#controlerElement(m.type_element, m.id_element);
    if (m.parent_id !== null && m.parent_id !== undefined) this.controlerParent(null, m.parent_id);
    const saisie = texte(m.confidentialite) ? confidentialite(m.confidentialite) : null;
    const blob = fichier instanceof Blob ? fichier : new Blob([fichier]);
    const nom = nom_fichier ?? fichier?.name ?? 'document';
    const { texte: contenu, etat } = await extraireTexte(blob, nom, blob.type);
    const classe = classer({ nom_fichier: nom, type_mime: blob.type, titre: m.titre, texte: contenu ?? m.mail?.message ?? null, expediteur: m.mail?.de ?? null,
      type_element: texte(m.type_element) }, this.reglesClassification);
    const d = {
      id: Math.max(0, ...this.documents.map((x) => x.id), ...this.archives.map((a) => a.document.id)) + 1, titre: m.titre.trim(),
      categorie: texte(m.categorie) ?? classe.categorie, nature: m.nature ?? 'fichier',
      type_element: texte(m.type_element), id_element: texte(m.id_element), auteur: m.auteur ?? this.utilisateur,
      date_document: m.date_document ?? this.#aujourdhui(), parent_id: m.parent_id ?? null,
      mail: m.mail ?? null, resume: m.resume ?? null, notes: m.notes ?? null, etat: null, coffre: false, coffre_le: null, a_envoyer: false, terrain: false,
      supprime: false, supprime_le: null, supprime_par: null, cree_le: this.#maintenant(), cree_par: this.utilisateur, modifie_le: null,
      nb_consultations: 0, consulte_le: null, repertoire_id: texte(m.repertoire_id) ? Number(m.repertoire_id) : null,
      confidentialite: saisie ?? classe.confidentialite ?? NIVEAU_CONFIDENTIALITE.INTERNE, acces_profils: liste(m.acces_profils ?? []), acces_utilisateurs: liste(m.acces_utilisateurs ?? []),
      mots_cles: liste([...(m.mots_cles ?? []), ...classe.mots_cles]), langue: 'fr', index_etat: etat, texte_contenu: contenu,
      classification: classe.regles.length ? { regles: classe.regles, categorie: classe.categorie, confidentialite: classe.confidentialite, le: this.#maintenant() } : null,
      archive: false, archive_le: null,
    };
    this.documents.push(d);
    await this.#ajouterVersion(d, { fichier: blob, nom_fichier: nom, genre: GENRES.EDITION, commentaire: 'Dépôt' });
    if (m.coffre) await this.mettreAuCoffre(d.id, `Dépôt ${d.categorie ?? ''}`.trim());
    return this.document(d.id);
  }

  async modifier(id, meta) {
    const d = this.#doc(id);
    const avant = structuredClone(d);
    const autorises = d.coffre ? MODIFIABLES_COFFRE : MODIFIABLES;
    try {
      for (const [k, v] of Object.entries(meta)) {
        if (!autorises.includes(k)) {
          if (d.coffre && MODIFIABLES.includes(k) && texte(v) !== texte(d[k])) {
            throw new ErreurGed(422, 'COFFRE', 'Document du coffre-fort : seules les informations de classement sont modifiables');
          }
          continue;
        }
        if (CLES_ACCES.includes(k) && !peutChangerAcces(d, this.#moi)) throw new ErreurGed(403, 'ACCES_REFUSE', 'Droit CONFIDENTIALITE refusé');
        if (k === 'a_envoyer' || k === 'terrain') d[k] = v === true || v === 'true';
        else if (k === 'confidentialite') d.confidentialite = confidentialite(v);
        else if (['acces_profils', 'acces_utilisateurs', 'mots_cles'].includes(k)) d[k] = liste(v);
        else if (k === 'repertoire_id') this.#classer(d, texte(v) === null ? null : Number(v));
        else if (k === 'titre') { if (!texte(v)) throw new ErreurGed(422, 'TITRE', 'Titre obligatoire'); d.titre = texte(v); }
        else d[k] = texte(v);
      }
      if (!memeElement(d, avant)) {
        await this.#controlerElement(d.type_element, d.id_element);
        if (d.repertoire_id && !memeElement(this.#dossier(d.repertoire_id), d)) d.repertoire_id = null;
        // Pièces jointes d'un mail (hors coffre) : suivent leur mail.
        for (const p of this.documents.filter((x) => x.parent_id === d.id && !x.coffre && memeElement(x, avant))) {
          Object.assign(p, { type_element: d.type_element, id_element: d.id_element, repertoire_id: d.repertoire_id });
        }
      }
    } catch (e) {
      Object.assign(d, avant);
      throw e;
    }
    d.modifie_le = this.#maintenant();
    return this.document(id);
  }

  #classer(d, repertoireId) {
    if (repertoireId === null) { d.repertoire_id = null; return; }
    const r = this.#dossier(repertoireId);
    if (!memeElement(r, d)) {
      if (d.coffre) throw new ErreurGed(422, 'COFFRE', 'Document du coffre-fort : il reste lié à son élément');
      Object.assign(d, { type_element: r.type_element, id_element: r.id_element });
    }
    d.repertoire_id = r.id;
  }

  async nouvelleVersion(id, { fichier, nom_fichier, genre = GENRES.EDITION, etape = null, etat = null, commentaire = null }) {
    const d = this.#doc(id);
    if (d.coffre) throw new ErreurGed(422, 'COFFRE', 'Document du coffre-fort : verrouillé, aucune nouvelle version');
    if (d.supprime) throw new ErreurGed(422, 'SUPPRIME', 'Document supprimé : restaurez-le d\'abord');
    const blob = fichier instanceof Blob ? fichier : new Blob([fichier]);
    Object.assign(d, await this.#indexation(blob, nom_fichier ?? fichier?.name ?? 'document'));
    await this.#ajouterVersion(d, { fichier: blob, nom_fichier: nom_fichier ?? fichier?.name, genre, etape, etat, commentaire });
    return this.document(id);
  }

  async #indexation(blob, nom) {
    const { texte: t, etat } = await extraireTexte(blob, nom, blob.type);
    return { texte_contenu: t, index_etat: etat };
  }

  async etape(id, { etape, etat = null, commentaire = null }) {
    const d = this.#doc(id);
    if (d.coffre) throw new ErreurGed(422, 'COFFRE', 'Document du coffre-fort : verrouillé');
    await this.#ajouterVersion(d, { genre: GENRES.ETAPE, etape, etat: etat ?? etape, commentaire });
    return this.document(id);
  }

  #version(versionId) {
    const v = this.versions.find((x) => x.id === Number(versionId)) ?? this.archives.flatMap((a) => a.versions).find((x) => x.id === Number(versionId));
    if (!v) throw new ErreurGed(404, 'INTROUVABLE', 'Version introuvable');
    return v;
  }

  async contenu(versionId) {
    const v = this.#version(versionId);
    const b = this.contenus.get(v.empreinte);
    // Consultation : compteur du document (statistiques d'utilisation) ; document archivé : lecture seule.
    const d = this.documents.find((x) => x.id === v.document);
    if (d) {
      d.nb_consultations = (d.nb_consultations ?? 0) + 1;
      d.consulte_le = this.#maintenant();
    }
    return new Blob([b], { type: v.type_mime });
  }

  /** Statistiques d'utilisation d'un élément lié, ou de toute la GED (comme statistique_ged). */
  async statistiques({ type_element = null, id_element = null } = {}) {
    const docs = this.documents.filter((d) => !type_element || (d.type_element === type_element && String(d.id_element ?? '') === String(id_element ?? '')));
    const versions = this.versions.filter((v) => docs.some((d) => d.id === v.document));
    const dates = [...docs.flatMap((d) => [d.cree_le, d.modifie_le, d.consulte_le]), ...versions.map((v) => v.date)].filter(Boolean).sort();
    return {
      nb_documents: docs.filter((d) => !d.supprime).length, nb_supprimes: docs.filter((d) => d.supprime).length, nb_coffre: docs.filter((d) => d.coffre).length,
      nb_versions: versions.length, taille: versions.reduce((s, v) => s + (v.taille ?? 0), 0),
      nb_consultations: docs.reduce((s, d) => s + (d.nb_consultations ?? 0), 0), derniere_activite: dates.at(-1) ?? null,
    };
  }

  urlContenu(versionId) {
    // Démo : URL locale du contenu (le téléchargement porte le nom du fichier).
    const v = this.#version(versionId);
    if (!this.urls.has(versionId)) this.urls.set(versionId, URL.createObjectURL(new Blob([this.contenus.get(v.empreinte)], { type: v.type_mime })));
    return this.urls.get(versionId);
  }

  async mettreAuCoffre(id, motif = null) {
    const d = this.#doc(id);
    if (d.coffre) return this.document(id);
    const v = this.#versions(d.id).at(-1);
    const entree = {
      id: this.journal.length + 1, document: d.id, version: v.id, empreinte_document: v.empreinte,
      horodatage: horodatage(this.horloge()), utilisateur: this.utilisateur, motif,
      empreinte_precedente: this.journal.at(-1)?.empreinte_entree ?? EMPREINTE_ORIGINE,
    };
    entree.empreinte_entree = await empreinteEntree(entree);
    this.journal.push(entree);
    d.coffre = true;
    d.coffre_le = entree.horodatage;
    return this.document(id);
  }

  async verifier(id) {
    const d = this.#doc(id);
    const v = this.#versions(d.id).at(-1);
    const calculee = await sha256(this.contenus.get(v.empreinte));
    const entree = this.journal.find((e) => e.document === d.id);
    return {
      integre: calculee === v.empreinte && (!entree || entree.empreinte_document === calculee),
      empreinte_attendue: entree?.empreinte_document ?? v.empreinte, empreinte_calculee: calculee,
      horodatage: entree?.horodatage ?? null, coffre: d.coffre ? await this.verifierCoffre() : null,
    };
  }

  async supprimer(id) {
    const d = this.#doc(id);
    if (d.coffre && !this.admin) throw new ErreurGed(403, 'ACCES_REFUSE', 'Document du coffre-fort : suppression réservée à un administrateur');
    Object.assign(d, { supprime: true, supprime_le: this.#maintenant(), supprime_par: this.utilisateur });
    for (const p of this.documents.filter((x) => x.parent_id === d.id && !x.coffre)) Object.assign(p, { supprime: true, supprime_le: d.supprime_le, supprime_par: this.utilisateur });
    return this.document(id);
  }

  async restaurer(id) {
    const d = this.#doc(id);
    Object.assign(d, { supprime: false, supprime_le: null, supprime_par: null });
    return this.document(id);
  }

  async purger(id) {
    if (!this.admin) throw new ErreurGed(403, 'ACCES_REFUSE', 'Suppression définitive réservée à un administrateur');
    const d = this.#doc(id);
    if (d.coffre) throw new ErreurGed(422, 'COFFRE', 'Un document du coffre-fort ne peut pas être supprimé définitivement');
    if (!d.supprime) throw new ErreurGed(422, 'NON_SUPPRIME', 'Seul un document marqué comme supprimé peut être purgé');
    for (const p of this.documents.filter((x) => x.parent_id === d.id)) p.parent_id = null;
    this.liens = this.liens.filter((l) => l.source_id !== d.id && l.cible_id !== d.id);
    this.documents = this.documents.filter((x) => x.id !== d.id);
    this.versions = this.versions.filter((x) => x.document !== d.id);
    this.#nettoyerContenus();
  }

  async verifierCoffre() { return verifierChaine(this.journal); }

  // ---------------------------------------------------------------- répertoires

  async repertoires({ type_element = null, id_element = null } = {}) {
    const cible = { type_element: texte(type_element), id_element: texte(id_element) };
    return this.dossiers.filter((r) => memeElement(r, cible)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
      .map((r) => ({ ...r, nb_documents: this.documents.filter((d) => d.repertoire_id === r.id && !d.supprime && !d.archive && this.#visible(d)).length }));
  }

  #nomRepertoire(nom) {
    const n = texte(nom);
    if (!n) throw new ErreurGed(422, 'NOM', 'Nom de répertoire obligatoire');
    if (n.length > 150 || /[/\\]/.test(n)) throw new ErreurGed(422, 'NOM', 'Nom de répertoire invalide (150 caractères, sans / ni \\)');
    return n;
  }

  #unique(nom, parentId, element, sauf = null) {
    if (this.dossiers.some((r) => r.id !== sauf && (r.parent_id ?? null) === (parentId ?? null) && memeElement(r, element) && r.nom.toLowerCase() === nom.toLowerCase())) {
      throw new ErreurGed(422, 'DOUBLON', `Un répertoire « ${nom} » existe déjà à cet endroit`);
    }
  }

  async creerRepertoire({ nom, parent_id = null, type_element = null, id_element = null }) {
    const n = this.#nomRepertoire(nom);
    let element = { type_element: texte(type_element), id_element: texte(id_element) };
    if (parent_id !== null && parent_id !== undefined && parent_id !== '') {
      const p = this.#dossier(parent_id);
      element = { type_element: p.type_element, id_element: p.id_element };
    } else await this.#controlerElement(element.type_element, element.id_element);
    const parent = parent_id === null || parent_id === undefined || parent_id === '' ? null : Number(parent_id);
    this.#unique(n, parent, element);
    const r = { id: this.#suivant(this.dossiers), nom: n, parent_id: parent, ...element, cree_le: this.#maintenant(), cree_par: this.utilisateur };
    this.dossiers.push(r);
    return { ...r, nb_documents: 0 };
  }

  async modifierRepertoire(id, demande) {
    const r = this.#dossier(id);
    const nom = 'nom' in demande ? this.#nomRepertoire(demande.nom) : r.nom;
    let parent = r.parent_id;
    if ('parent_id' in demande) {
      parent = texte(demande.parent_id) === null ? null : Number(demande.parent_id);
      if (parent !== null) {
        if (!memeElement(this.#dossier(parent), r)) throw new ErreurGed(422, 'REPERTOIRE_ELEMENT', 'Un répertoire se déplace sous le même élément');
        for (let x = parent; x !== null; x = this.#dossier(x).parent_id) {
          if (x === r.id) throw new ErreurGed(422, 'REPERTOIRE_BOUCLE', `Le répertoire ${r.id} ne peut pas être déplacé dans l'un de ses sous-répertoires`);
        }
      }
    }
    this.#unique(nom, parent, r, r.id);
    Object.assign(r, { nom, parent_id: parent });
    return (await this.repertoires(r)).find((x) => x.id === r.id);
  }

  async supprimerRepertoire(id) {
    const r = this.#dossier(id);
    if (this.dossiers.some((x) => x.parent_id === r.id) || this.documents.some((d) => d.repertoire_id === r.id)) {
      throw new ErreurGed(422, 'REPERTOIRE_NON_VIDE', 'Le répertoire n\'est pas vide');
    }
    this.dossiers = this.dossiers.filter((x) => x.id !== r.id);
  }

  // ---------------------------------------------------------------- dérivations

  #derivations(id) {
    return this.liens.filter((l) => l.source_id === id || l.cible_id === id)
      .map((l) => ({ l, autre: this.documents.find((d) => d.id === (l.source_id === id ? l.cible_id : l.source_id)) }))
      .filter(({ autre }) => autre && this.#visible(autre))
      .map(({ l, autre }) => ({ id: l.id, type: l.type, langue: l.langue, commentaire: l.commentaire, sens: l.source_id === id ? 'cible' : 'source',
        document: this.#vue(autre), cree_le: l.cree_le, cree_par: l.cree_par }));
  }

  async ajouterDerivation(id, { cible_id, type, langue = null, commentaire = null }) {
    const t = String(type ?? '').trim().toUpperCase();
    if (!TYPES_DERIVATION.includes(t)) throw new ErreurGed(422, 'TYPE', `Type de dérivation inconnu : ${type}`);
    const source = this.#doc(id);
    const cible = this.#doc(cible_id);
    if (source.id === cible.id) throw new ErreurGed(422, 'DERIVATION_BOUCLE', 'Un document ne dérive pas de lui-même');
    // Sans boucle (comme tr_ged_derivation_sans_boucle) : la cible ne doit pas déjà être une source de la source.
    const sources = new Set([source.id]);
    for (let ajout = true; ajout;) {
      ajout = false;
      for (const l of this.liens) if (sources.has(l.cible_id) && !sources.has(l.source_id)) { sources.add(l.source_id); ajout = true; }
    }
    if (sources.has(cible.id)) throw new ErreurGed(422, 'DERIVATION_BOUCLE', `Le document ${source.id} dérive déjà du document ${cible.id}`);
    if (this.liens.some((l) => l.source_id === source.id && l.cible_id === cible.id && l.type === t)) throw new ErreurGed(422, 'DOUBLON', 'Cet élément existe déjà');
    this.liens.push({ id: this.#suivant(this.liens), source_id: source.id, cible_id: cible.id, type: t, langue: texte(langue), commentaire: texte(commentaire),
      cree_le: this.#maintenant(), cree_par: this.utilisateur });
    return this.document(id);
  }

  async supprimerDerivation(id) {
    const l = this.liens.find((x) => x.id === Number(id));
    if (!l) throw new ErreurGed(404, 'INTROUVABLE', `Dérivation ${id} introuvable`);
    this.#doc(l.cible_id);
    this.liens = this.liens.filter((x) => x.id !== l.id);
  }

  // ---------------------------------------------------------------- indexation

  async indexer(id) {
    const d = this.#doc(id);
    const v = this.#versions(d.id).at(-1);
    Object.assign(d, v ? await this.#indexation(this.contenus.get(v.empreinte), v.nom_fichier) : { texte_contenu: null, index_etat: ETATS_INDEX.ECHEC });
    return this.document(id);
  }

  async indexerEnAttente() {
    if (!this.admin) throw new ErreurGed(403, 'ACCES_REFUSE', 'Droit INDEXER refusé');
    const lot = this.documents.filter((d) => d.index_etat === ETATS_INDEX.A_FAIRE).slice(0, 200);
    for (const d of lot) await this.indexer(d.id);
    return { indexes: lot.length, restants: this.documents.filter((d) => d.index_etat === ETATS_INDEX.A_FAIRE).length };
  }

  // ---------------------------------------------------------------- rétention et archive

  async regles() { return { retention: structuredClone(this.reglesRetention), classification: structuredClone(this.reglesClassification) }; }

  async remplacerReglesRetention(regles) {
    if (!this.admin) throw new ErreurGed(403, 'ACCES_REFUSE', 'Droit PARAMETRER refusé');
    for (const r of regles) {
      if (!texte(r.libelle)) throw new ErreurGed(422, 'LIBELLE', 'Libellé de règle obligatoire');
      if (r.duree_active_mois < 0 || r.duree_conservation_mois < 0) throw new ErreurGed(422, 'DUREE', `Durées positives attendues (${r.libelle})`);
      if (r.duree_active_mois !== null && r.duree_active_mois !== undefined && r.duree_conservation_mois !== null && r.duree_conservation_mois !== undefined
        && r.duree_conservation_mois < r.duree_active_mois) throw new ErreurGed(422, 'DUREE', `La conservation ne peut pas être plus courte que la durée active (${r.libelle})`);
      if (!['REVOIR', 'DETRUIRE'].includes(r.action_fin)) throw new ErreurGed(422, 'ACTION', 'Action de fin REVOIR ou DETRUIRE attendue');
    }
    let id = Math.max(0, ...regles.map((r) => r.id ?? 0));
    this.reglesRetention = regles.map((r) => ({ priorite: 100, actif: true, ...structuredClone(r), id: r.id > 0 ? r.id : ++id }));
    return this.regles();
  }

  async remplacerReglesClassification(regles) {
    if (!this.admin) throw new ErreurGed(403, 'ACCES_REFUSE', 'Droit PARAMETRER refusé');
    for (const r of regles) {
      if (!texte(r.libelle)) throw new ErreurGed(422, 'LIBELLE', 'Libellé de règle obligatoire');
      if (!liste(r.extensions ?? []).length && !liste(r.types_mime ?? []).length && !liste(r.mots ?? []).length && !texte(r.expediteur) && !texte(r.type_element)) {
        throw new ErreurGed(422, 'CRITERE', `Au moins un critère attendu (${r.libelle})`);
      }
      if (!texte(r.categorie) && !texte(r.confidentialite) && !liste(r.mots_cles ?? []).length) throw new ErreurGed(422, 'RESULTAT', `Catégorie, confidentialité ou mots-clés attendus (${r.libelle})`);
      if (texte(r.confidentialite)) confidentialite(r.confidentialite);
    }
    let id = Math.max(0, ...regles.map((r) => r.id ?? 0));
    this.reglesClassification = regles.map((r) => ({ priorite: 100, actif: true, ...structuredClone(r), id: r.id > 0 ? r.id : ++id,
      extensions: liste(r.extensions ?? []).map((e) => e.replace(/^\./, '').toLowerCase()), types_mime: liste(r.types_mime ?? []), mots: liste(r.mots ?? []),
      mots_cles: liste(r.mots_cles ?? []), expediteur: texte(r.expediteur), type_element: texte(r.type_element), categorie: texte(r.categorie), confidentialite: texte(r.confidentialite) }));
    return this.regles();
  }

  async echeances() {
    return this.documents.filter((d) => this.#visible(d) && !d.supprime && !d.archive && !d.parent_id)
      .map((d) => ({ document: this.#vue(d), echeances: this.#echeances(d) }))
      .filter((x) => x.echeances.statut !== 'ACTIF');
  }

  async appliquerRetention() {
    if (!this.admin) throw new ErreurGed(403, 'ACCES_REFUSE', 'Droit ARCHIVER refusé');
    const dues = await this.echeances();
    let archives = 0;
    for (const e of dues) archives += this.#archiverFamille(e.document.id, `Rétention : ${e.echeances.libelle}`);
    return { documents: dues.length, archives, ids: dues.map((e) => e.document.id) };
  }

  /** Comme f_ged_archiver : famille sans coffre déplacée dans l'archive, sinon documents du coffre archivés sur place. */
  #archiverFamille(id, motif) {
    const famille = [Number(id)];
    for (let i = 0; i < famille.length; i++) famille.push(...this.documents.filter((d) => d.parent_id === famille[i]).map((d) => d.id));
    const docs = famille.map((x) => this.documents.find((d) => d.id === x));
    if (docs.some((d) => d.coffre)) {
      for (const d of docs.filter((x) => x.coffre && !x.archive)) Object.assign(d, { archive: true, archive_le: this.#maintenant() });
      return docs.filter((d) => d.archive).length;
    }
    for (const d of docs) {
      this.archives.push({ document: structuredClone(d), versions: this.#versions(d.id), derivations: this.liens.filter((l) => l.source_id === d.id || l.cible_id === d.id),
        archive_le: this.#maintenant(), archive_par: this.utilisateur, motif });
    }
    const ids = new Set(famille);
    this.liens = this.liens.filter((l) => !ids.has(l.source_id) && !ids.has(l.cible_id));
    this.versions = this.versions.filter((v) => !ids.has(v.document));
    this.documents = this.documents.filter((d) => !ids.has(d.id));
    return famille.length;
  }

  async archiver(id, motif = null) {
    const d = this.#doc(id);
    if (d.supprime) throw new ErreurGed(422, 'SUPPRIME', 'Document supprimé : restaurez-le d\'abord');
    if (d.parent_id) throw new ErreurGed(422, 'ARCHIVE_PIECE', 'Une pièce jointe s\'archive avec son mail');
    return { archives: this.#archiverFamille(d.id, texte(motif)) };
  }

  async desarchiver(id) {
    const d = await this.document(id);
    if (!d.archive) throw new ErreurGed(422, 'NON_ARCHIVE', 'Ce document n\'est pas archivé');
    const surPlace = this.documents.find((x) => x.id === Number(id));
    if (surPlace) {
      const famille = [surPlace.id];
      for (let i = 0; i < famille.length; i++) famille.push(...this.documents.filter((x) => x.parent_id === famille[i]).map((x) => x.id));
      for (const x of this.documents.filter((y) => famille.includes(y.id))) Object.assign(x, { archive: false, archive_le: null });
      return this.document(id);
    }
    const famille = [Number(id)];
    for (let i = 0; i < famille.length; i++) famille.push(...this.archives.filter((a) => a.document.parent_id === famille[i]).map((a) => a.document.id));
    const entrees = famille.map((x) => this.archives.find((a) => a.document.id === x));
    for (const a of entrees) {
      await this.#controlerElement(a.document.type_element, a.document.id_element);
      if (a.document.repertoire_id && !this.dossiers.some((r) => r.id === a.document.repertoire_id)) a.document.repertoire_id = null;
      this.documents.push(a.document);
      this.versions.push(...a.versions);
    }
    for (const l of entrees.flatMap((a) => a.derivations)) {
      if (this.documents.some((x) => x.id === l.source_id) && this.documents.some((x) => x.id === l.cible_id) && !this.liens.some((x) => x.id === l.id)) this.liens.push(l);
    }
    this.archives = this.archives.filter((a) => !famille.includes(a.document.id));
    return this.document(id);
  }

  /** Lignes de la source de liste « ged » (comme la vue v_liste_ged), pour la recherche dans les listes. */
  lignesListe() {
    return this.documents.filter((d) => !d.supprime && !d.archive && [NIVEAU_CONFIDENTIALITE.PUBLIC, NIVEAU_CONFIDENTIALITE.INTERNE].includes(d.confidentialite ?? NIVEAU_CONFIDENTIALITE.INTERNE)
      && !(d.acces_profils ?? []).length && !(d.acces_utilisateurs ?? []).length).map((d) => {
      const v = this.#versions(d.id).at(-1);
      return {
        id: d.id, type_element: 'document_ged', titre: d.titre, categorie: d.categorie, nature: d.nature, type_lie: d.type_element, id_lie: d.id_element,
        auteur: d.auteur, date_document: d.date_document, etat: d.etat, coffre: d.coffre, nom_fichier: v?.nom_fichier ?? null, type_mime: v?.type_mime ?? null,
        taille: v?.taille ?? null, version: v?.numero ?? null, objet_mail: d.mail?.objet ?? null, resume: d.resume, notes: d.notes, cree_le: d.cree_le, cree_par: d.cree_par,
      };
    });
  }
}
