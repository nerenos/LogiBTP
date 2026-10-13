import { sha256, horodatage, empreinteEntree, verifierChaine, EMPREINTE_ORIGINE } from './coffre.js';
import { editionsAPurger, GENRES } from './versions.js';

// Fournisseurs de la GED. Même interface pour l'API (routes MapModuleGed) et pour la mémoire (démo hors ligne, tests) :
//
//   parametres()                         → { editions_conservees, taille_apercu_max, adresse_copie_cachee, categories }
//   lister({ type_element, id_element, recherche, supprimes, coffre })  → documents (version courante, nb_pieces)
//   document(id)                         → document + versions (éditions et étapes) + pieces (pièces jointes d'un mail)
//   deposer({ fichier, meta })           → document créé (meta : titre, categorie, date_document, auteur, type_element,
//                                          id_element, resume, notes, nature, mail, parent_id, coffre)
//   modifier(id, meta)                   → document (informations seulement ; le contenu passe par une version ;
//                                          a_envoyer : pièce jointe à envoyer avec l'élément lié, module Mail)
//   nouvelleVersion(id, { fichier, genre, etape, etat, commentaire })  → document (édition : N dernières conservées)
//   etape(id, { etape, etat, commentaire })   → document (étape sans nouveau fichier)
//   contenu(versionId) → Blob            urlContenu(versionId, { telecharger }) → URL
//   mettreAuCoffre(id, motif)            → document verrouillé, entrée chaînée au journal
//   verifier(id)                         → { integre, empreinte_attendue, empreinte_calculee, coffre: { ok, … } }
//   supprimer(id) / restaurer(id)        → document masqué / réaffiché ;   purger(id) → suppression définitive (ADMIN)
//   verifierCoffre()                     → { ok, entrees, rupture }

export class ErreurGed extends Error {
  constructor(statut, code, message) {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

export class FournisseurGedApi {
  constructor({ base = '/api/ged', entetes = {} } = {}) {
    this.base = base;
    this.entetes = entetes;
  }

  async appel(methode, url, corps) {
    const formulaire = corps instanceof FormData;
    const r = await fetch(`${this.base}${url}`, {
      method: methode,
      // Formulaire : le navigateur pose le Content-Type multipart (avec sa frontière) ; jamais celui des en-têtes communs.
      headers: formulaire ? Object.fromEntries(Object.entries(this.entetes).filter(([k]) => k.toLowerCase() !== 'content-type'))
        : { 'Content-Type': 'application/json', ...this.entetes },
      body: corps === undefined ? undefined : formulaire ? corps : JSON.stringify(corps),
    });
    const texte = await r.text();
    const data = texte ? JSON.parse(texte) : null;
    if (!r.ok) throw new ErreurGed(r.status, data?.code ?? 'HTTP', data?.title ?? r.statusText);
    return data;
  }

  #formulaire(fichier, nomFichier, donnees) {
    const f = new FormData();
    if (fichier) f.append('fichier', fichier, nomFichier ?? fichier.name ?? 'document');
    f.append('donnees', JSON.stringify(donnees));
    return f;
  }

  parametres() { return this.appel('GET', '/parametres'); }
  lister(filtre = {}) {
    const q = new URLSearchParams(Object.entries(filtre).filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)]));
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

/**
 * Fournisseur en mémoire : mêmes règles que le serveur (éditions conservées, coffre-fort chaîné et immuable,
 * suppression par masquage, purge réservée au profil ADMIN et interdite pour le coffre-fort).
 */
export class FournisseurGedMemoire {
  constructor({ utilisateur = 'demo', profil = 'ADMIN', parametres = {}, horloge = () => Date.now() } = {}) {
    this.utilisateur = utilisateur;
    this.profil = profil;
    this.params = { ...PARAMETRES_DEFAUT, ...parametres };
    this.horloge = horloge;
    this.contenus = new Map();   // empreinte → Blob
    this.documents = [];
    this.versions = [];
    this.journal = [];
    this.urls = new Map();
  }

  get admin() { return this.profil === 'ADMIN'; }

  async parametres() { return structuredClone(this.params); }

  #doc(id) {
    const d = this.documents.find((x) => x.id === Number(id));
    if (!d) throw new ErreurGed(404, 'INTROUVABLE', `Document ${id} introuvable`);
    return d;
  }

  #versions(id) { return this.versions.filter((v) => v.document === Number(id)).sort((a, b) => a.numero - b.numero); }

  #vue(d) {
    const versions = this.#versions(d.id);
    const v = versions.at(-1);
    return {
      ...structuredClone(d),
      version: v ? { id: v.id, numero: v.numero, nom_fichier: v.nom_fichier, type_mime: v.type_mime, taille: v.taille, genre: v.genre } : null,
      nb_pieces: this.documents.filter((x) => x.parent_id === d.id && !x.supprime).length,
    };
  }

  async lister({ type_element, id_element, recherche, supprimes = false, coffre = false } = {}) {
    const mots = String(recherche ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/\s+/).filter(Boolean);
    return this.documents
      .filter((d) => (supprimes ? true : !d.supprime))
      .filter((d) => !type_element || (d.type_element === type_element && String(d.id_element) === String(id_element)))
      .filter((d) => !coffre || d.coffre)
      .filter((d) => {
        if (!mots.length) return true;
        const t = [d.titre, d.categorie, d.auteur, d.resume, d.notes, d.mail?.objet, d.mail?.de, d.mail?.a, ...this.#versions(d.id).map((v) => v.nom_fichier)]
          .join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
        return mots.every((m) => t.includes(m));
      })
      .sort((a, b) => String(b.date_document ?? '').localeCompare(String(a.date_document ?? '')) || b.id - a.id)
      .map((d) => this.#vue(d));
  }

  async document(id) {
    const d = this.#doc(id);
    return {
      ...this.#vue(d),
      versions: structuredClone(this.#versions(d.id)),
      pieces: this.documents.filter((x) => x.parent_id === d.id && !x.supprime).map((x) => this.#vue(x)),
      parent: d.parent_id ? this.#vue(this.#doc(d.parent_id)) : null,
      journal_coffre: structuredClone(this.journal.filter((e) => e.document === d.id)),
    };
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
      id: Math.max(0, ...this.versions.map((x) => x.id)) + 1, document: d.id, numero: (existantes.at(-1)?.numero ?? 0) + 1, genre, etape, etat,
      empreinte: c.empreinte, nom_fichier: nom_fichier ?? fichier?.name ?? 'document', type_mime: fichier?.type || c.type || 'application/octet-stream',
      taille: c.taille, auteur: this.utilisateur, date: new Date(this.horloge()).toISOString(), commentaire,
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
    const utilises = new Set(this.versions.map((v) => v.empreinte));
    for (const e of this.contenus.keys()) if (!utilises.has(e)) this.contenus.delete(e);
  }

  async deposer({ fichier, nom_fichier, meta = {} }) {
    if (!meta.titre?.trim()) throw new ErreurGed(422, 'TITRE', 'Titre obligatoire');
    const d = {
      id: Math.max(0, ...this.documents.map((x) => x.id)) + 1, titre: meta.titre.trim(), categorie: meta.categorie ?? null, nature: meta.nature ?? 'fichier',
      type_element: meta.type_element ?? null, id_element: meta.id_element ?? null, auteur: meta.auteur ?? this.utilisateur,
      date_document: meta.date_document ?? new Date(this.horloge()).toISOString().slice(0, 10), parent_id: meta.parent_id ?? null,
      mail: meta.mail ?? null, resume: meta.resume ?? null, notes: meta.notes ?? null, etat: null, coffre: false, coffre_le: null, a_envoyer: false,
      supprime: false, supprime_le: null, supprime_par: null, cree_le: new Date(this.horloge()).toISOString(), cree_par: this.utilisateur, modifie_le: null,
    };
    this.documents.push(d);
    await this.#ajouterVersion(d, { fichier, nom_fichier, genre: GENRES.EDITION, commentaire: 'Dépôt' });
    if (meta.coffre) await this.mettreAuCoffre(d.id, `Dépôt ${meta.categorie ?? ''}`.trim());
    return this.document(d.id);
  }

  async modifier(id, meta) {
    const d = this.#doc(id);
    const autorises = d.coffre ? ['resume', 'notes', 'a_envoyer'] : ['titre', 'categorie', 'date_document', 'auteur', 'type_element', 'id_element', 'resume', 'notes', 'a_envoyer'];
    for (const [k, v] of Object.entries(meta)) {
      if (!autorises.includes(k)) {
        if (d.coffre && v !== d[k]) throw new ErreurGed(422, 'COFFRE', 'Document du coffre-fort : seuls le résumé et les notes sont modifiables');
        continue;
      }
      d[k] = k === 'a_envoyer' ? v === true || v === 'true' : v === '' ? null : v;
    }
    if (!d.titre) throw new ErreurGed(422, 'TITRE', 'Titre obligatoire');
    d.modifie_le = new Date(this.horloge()).toISOString();
    return this.document(id);
  }

  async nouvelleVersion(id, { fichier, nom_fichier, genre = GENRES.EDITION, etape = null, etat = null, commentaire = null }) {
    const d = this.#doc(id);
    if (d.coffre) throw new ErreurGed(422, 'COFFRE', 'Document du coffre-fort : verrouillé, aucune nouvelle version');
    if (d.supprime) throw new ErreurGed(422, 'SUPPRIME', 'Document supprimé : restaurez-le d\'abord');
    await this.#ajouterVersion(d, { fichier, nom_fichier, genre, etape, etat, commentaire });
    return this.document(id);
  }

  async etape(id, { etape, etat = null, commentaire = null }) {
    const d = this.#doc(id);
    if (d.coffre) throw new ErreurGed(422, 'COFFRE', 'Document du coffre-fort : verrouillé');
    await this.#ajouterVersion(d, { genre: GENRES.ETAPE, etape, etat: etat ?? etape, commentaire });
    return this.document(id);
  }

  async contenu(versionId) {
    const v = this.versions.find((x) => x.id === Number(versionId));
    if (!v) throw new ErreurGed(404, 'INTROUVABLE', 'Version introuvable');
    const b = this.contenus.get(v.empreinte);
    return new Blob([b], { type: v.type_mime });
  }

  urlContenu(versionId) {
    // Démo : URL locale du contenu (le téléchargement porte le nom du fichier).
    const v = this.versions.find((x) => x.id === Number(versionId));
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
    Object.assign(d, { supprime: true, supprime_le: new Date(this.horloge()).toISOString(), supprime_par: this.utilisateur });
    for (const p of this.documents.filter((x) => x.parent_id === d.id && !x.coffre)) Object.assign(p, { supprime: true, supprime_le: d.supprime_le, supprime_par: this.utilisateur });
    return this.document(id);
  }

  async restaurer(id) {
    const d = this.#doc(id);
    Object.assign(d, { supprime: false, supprime_le: null, supprime_par: null });
    return this.document(id);
  }

  async purger(id) {
    const d = this.#doc(id);
    if (!this.admin) throw new ErreurGed(403, 'ACCES_REFUSE', 'Suppression définitive réservée à un administrateur');
    if (d.coffre) throw new ErreurGed(422, 'COFFRE', 'Un document du coffre-fort ne peut pas être supprimé définitivement');
    if (!d.supprime) throw new ErreurGed(422, 'NON_SUPPRIME', 'Seul un document marqué comme supprimé peut être purgé');
    for (const p of this.documents.filter((x) => x.parent_id === d.id)) p.parent_id = null;
    this.documents = this.documents.filter((x) => x.id !== d.id);
    this.versions = this.versions.filter((x) => x.document !== d.id);
    this.#nettoyerContenus();
  }

  async verifierCoffre() { return verifierChaine(this.journal); }

  /** Lignes de la source de liste « ged » (comme la vue v_liste_ged), pour la recherche dans les listes. */
  lignesListe() {
    return this.documents.filter((d) => !d.supprime).map((d) => {
      const v = this.#versions(d.id).at(-1);
      return {
        id: d.id, type_element: 'document_ged', titre: d.titre, categorie: d.categorie, nature: d.nature, type_lie: d.type_element, id_lie: d.id_element,
        auteur: d.auteur, date_document: d.date_document, etat: d.etat, coffre: d.coffre, nom_fichier: v?.nom_fichier ?? null, type_mime: v?.type_mime ?? null,
        taille: v?.taille ?? null, version: v?.numero ?? null, objet_mail: d.mail?.objet ?? null, resume: d.resume, notes: d.notes, cree_le: d.cree_le, cree_par: d.cree_par,
      };
    });
  }
}
