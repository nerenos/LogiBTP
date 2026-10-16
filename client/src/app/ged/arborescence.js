import { ArborescenceGed } from '@logibtp/ged/ui';

// Arborescence de la GED du cœur (spécialisation d'ArborescenceGed) : dossiers automatiques de la structure des
// affaires, dans le sens Projet › Affaire › Chantier › Marché › Documents, chaque document (groupe d'indices) étant
// un dossier lié à ses pièces (type_element = code du type, id_element = groupe).
//   - racine : la fiche ou le document ouvert ; GED globale : regroupements « Affaires » et « Projets » ;
//   - un document est rangé sous l'élément le plus précis de son rattachement (marché, chantier, affaire, projet),
//     dans des dossiers virtuels par famille (Ventes, Achats, Stock) puis par type (Devis client, Commande client…) ;
//   - regroupement de documents (projet, affaire, chantier, marché) : les documents enfants (transformations, copies)
//     ne sont pas imbriqués ; le dossier d'un document montre des liens symboliques vers ses enfants ;
//   - racine sur un document : chemin des documents enfants (devis › commande › facture…), imbriqués.

const ICONES = { projet: '🎯', affaire: '🗂', chantier: '🏗', marche: '📜' };
const PREFIXES = { projet: 'P', affaire: 'A', chantier: 'C', marche: 'M' };
const STRUCTURE = ['projet', 'affaire', 'chantier', 'marche'];
const FAMILLES = [['V', 'Ventes', '💶'], ['A', 'Achats', '🛒'], ['S', 'Stock', '📦']];
// Ordre des types dans une famille : cycle du document (suffixe du code), les autres ensuite par libellé.
const ORDRE_TYPES = ['DEVIS', 'DEMANDE', 'COMMANDE', 'RESERVATION', 'RECEPTION', 'ENTREE', 'SORTIE', 'TRANSFERT', 'RETOUR', 'SITUATION',
  'REPRISE_AVT', 'FACTURE_AVT', 'FACTURE', 'AVOIR', 'INVENTAIRE'];
const rangType = (code) => { const i = ORDRE_TYPES.indexOf(String(code ?? '').replace(/^[A-Z]_/, '')); return i < 0 ? ORDRE_TYPES.length : i; };
const familleDe = (d) => d.famille ?? String(d.type ?? '').charAt(0);

export class ArborescenceBtp extends ArborescenceGed {
  /**
   * contexte : élément ouvert (fiche ou document, comme l'explorateur) ; structure : fournisseur de la structure
   * (referentiels, documents(perimetre), descendants(entId)) ; entId : document ouvert (racine d'un document).
   */
  constructor(contexte, { structure, entId = null } = {}) {
    super(contexte);
    this.structure = structure;
    this.entId = entId;
    this.documentsParNoeud = new Map();
  }

  #refs() {
    this.refs ??= this.structure.referentiels();
    return this.refs;
  }

  #noeudStructure(type, x, filtre = {}) {
    return {
      cle: `${PREFIXES[type]}${x.id}`, type, id: x.id, libelle: x.code ?? String(x.id), sous_titre: x.libelle ?? null, icone: ICONES[type],
      element: { type_element: type, id_element: String(x.id) }, filtre,
    };
  }

  /** Dossier d'un document (groupe d'indices) ; mode 'regroupement' (enfants en liens) ou 'arbre' (enfants imbriqués). */
  #noeudDocument(d, mode, contexte) {
    return {
      cle: `D${d.groupe_id ?? d.id}`, type: 'document', ent_id: d.id, groupe_id: d.groupe_id ?? d.id, libelle: `${d.type_libelle ?? d.type} ${d.numero ?? `#${d.id}`}`,
      sous_titre: d.objet ?? null, icone: '📄', element: { type_element: d.type, id_element: String(d.groupe_id ?? d.id) }, mode, contexte,
    };
  }

  async racine() {
    const c = this.contexte;
    if (!c) return { cle: 'racine', libelle: 'Documents', icone: '🗂', element: null, type: 'racine' };
    if (STRUCTURE.includes(c.type_element)) {
      const refs = await this.#refs();
      const x = refs[`${c.type_element === 'marche' ? 'marches' : `${c.type_element}s`}`]?.find((y) => String(y.id) === String(c.id_element));
      if (x) return this.#noeudStructure(c.type_element, x);
    }
    const r = await super.racine();
    if (this.entId) {
      const { documents, liens } = await this.structure.descendants?.(this.entId) ?? { documents: [], liens: [] };
      return { ...r, type: 'document', ent_id: this.entId, groupe_id: Number(c.id_element), mode: 'arbre', contexte: { documents, liens } };
    }
    return r;
  }

  async enfants(n) {
    if (n.type === 'racine') {
      return [
        { cle: 'G-affaires', libelle: 'Affaires', icone: ICONES.affaire, groupe: true, type: 'groupe', niveau: 'affaire', element: null },
        { cle: 'G-projets', libelle: 'Projets', icone: ICONES.projet, groupe: true, type: 'groupe', niveau: 'projet', element: null },
      ];
    }
    if (n.type === 'groupe') {
      const refs = await this.#refs();
      return (n.niveau === 'affaire' ? refs.affaires : refs.projets).map((x) => this.#noeudStructure(n.niveau, x));
    }
    if (STRUCTURE.includes(n.type)) return this.#enfantsStructure(n);
    if (n.type === 'famille') return this.#enfantsFamille(n);
    if (n.type === 'type_document') return this.#groupes(n.documents).map((d) => this.#noeudDocument(d, 'regroupement', n.contexte));
    if (n.type === 'document') return this.#enfantsDocument(n);
    return [];
  }

  /** Documents du périmètre d'un nœud de la structure (le rattachement complète les parents : tout le sous-arbre). */
  async #documents(n) {
    if (!this.documentsParNoeud.has(n.cle)) {
      this.documentsParNoeud.set(n.cle, this.structure.documents({ [`${n.type === 'marche' ? 'marches' : `${n.type}s`}`]: [n.id] }));
    }
    return this.documentsParNoeud.get(n.cle);
  }

  async #enfantsStructure(n) {
    const refs = await this.#refs();
    const contexte = await this.#documents(n);
    const { projet = null } = n.filtre ?? {};
    const sous = [];
    if (n.type === 'projet') {
      const chantiers = refs.chantiers.filter((c) => c.prj_id === n.id);
      const affaires = new Set([...chantiers.map((c) => c.aff_id), ...contexte.documents.map((d) => d.affaire_id)].filter(Boolean));
      sous.push(...refs.affaires.filter((a) => affaires.has(a.id)).map((a) => this.#noeudStructure('affaire', a, { projet: n.id })));
      sous.push(...chantiers.filter((c) => !c.aff_id).map((c) => this.#noeudStructure('chantier', c)));
    } else if (n.type === 'affaire') {
      sous.push(...refs.chantiers.filter((c) => c.aff_id === n.id && (!projet || c.prj_id === projet)).map((c) => this.#noeudStructure('chantier', c)));
    } else if (n.type === 'chantier') {
      sous.push(...refs.marches.filter((m) => m.cha_id === n.id).map((m) => this.#noeudStructure('marche', m)));
    }
    // Documents rangés sous ce nœud : rattachement le plus précis égal au nœud.
    const ici = contexte.documents.filter((d) => this.#placement(d) === n.cle && (!projet || !d.projet_id || d.projet_id === projet));
    // Dossiers virtuels par famille (Ventes, Achats, Stock), sans documents propres.
    const familles = FAMILLES.map(([code, libelle, icone]) => ({ code, libelle, icone, documents: ici.filter((d) => familleDe(d) === code) }))
      .filter((f) => f.documents.length)
      .map((f) => ({ cle: `F${f.code}`, type: 'famille', famille: f.code, libelle: f.libelle, icone: f.icone, groupe: true, element: null,
        sous_titre: this.#compte(f.documents), documents: f.documents, contexte: { ...contexte, base: n } }));
    return [...sous, ...familles];
  }

  #compte(docs) {
    const n = new Set(docs.map((d) => d.groupe_id ?? d.id)).size;
    return `${n} document${n > 1 ? 's' : ''}`;
  }

  /** Dossiers virtuels par type de document dans une famille, dans l'ordre du cycle (devis, commande, livraison…). */
  #enfantsFamille(n) {
    const types = new Map();
    for (const d of n.documents) {
      if (!types.has(d.type)) types.set(d.type, { code: d.type, libelle: d.type_libelle ?? d.type, documents: [] });
      types.get(d.type).documents.push(d);
    }
    return [...types.values()]
      .sort((a, b) => rangType(a.code) - rangType(b.code) || a.libelle.localeCompare(b.libelle, 'fr'))
      .map((t) => ({ cle: `T${t.code}`, type: 'type_document', libelle: t.libelle, icone: '📂', groupe: true, element: null,
        sous_titre: this.#compte(t.documents), documents: t.documents, contexte: n.contexte }));
  }

  /** Clé du nœud où un document est rangé : marché, chantier, affaire, puis projet. */
  #placement(d) {
    return d.marche_id ? `M${d.marche_id}` : d.chantier_id ? `C${d.chantier_id}` : d.affaire_id ? `A${d.affaire_id}` : d.projet_id ? `P${d.projet_id}` : null;
  }

  /** Chemin d'un document depuis un nœud de regroupement (projet › affaire › chantier › marché › famille › type › document). */
  #cheminDepuis(base, d) {
    const chaine = [d.projet_id && `P${d.projet_id}`, d.affaire_id && `A${d.affaire_id}`, d.chantier_id && `C${d.chantier_id}`, d.marche_id && `M${d.marche_id}`].filter(Boolean);
    const i = chaine.indexOf(base.cle);
    return i < 0 ? null : [...chaine.slice(i + 1), `F${familleDe(d)}`, `T${d.type}`, `D${d.groupe_id ?? d.id}`];
  }

  /** Un document par groupe d'indices : l'indice de référence, sinon le plus récent. */
  #groupes(docs) {
    const parGroupe = new Map();
    for (const d of docs) {
      const g = d.groupe_id ?? d.id;
      const actuel = parGroupe.get(g);
      if (!actuel || (d.reference && !actuel.reference) || (Boolean(d.reference) === Boolean(actuel.reference) && d.id > actuel.id)) parGroupe.set(g, d);
    }
    return [...parGroupe.values()].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || a.id - b.id);
  }

  /** Documents enfants : liens symboliques dans un regroupement, dossiers imbriqués depuis un document. */
  async #enfantsDocument(n) {
    const { documents = [], liens = [], base = null } = n.contexte ?? {};
    const groupe = (id) => documents.find((d) => d.id === id)?.groupe_id ?? id;
    const sources = new Set(documents.filter((d) => (d.groupe_id ?? d.id) === n.groupe_id).map((d) => d.id));
    if (!sources.size && n.ent_id) sources.add(n.ent_id);
    const cibles = this.#groupes(documents.filter((d) => liens.some((l) => sources.has(l.source) && groupe(l.cible) === (d.groupe_id ?? d.id))
      && (d.groupe_id ?? d.id) !== n.groupe_id));
    if (n.mode === 'arbre') return cibles.map((d) => this.#noeudDocument(d, 'arbre', n.contexte));
    return cibles.map((d) => {
      const chemin = base ? this.#cheminDepuis(base, d) : null;
      const libelle = `${d.type_libelle ?? d.type} ${d.numero ?? `#${d.id}`}`;
      return chemin ? { cle: `L${d.groupe_id ?? d.id}`, libelle, sous_titre: d.objet ?? null, icone: '📄', lien: { cle: `D${d.groupe_id ?? d.id}`, chemin, libelle } }
        : { cle: `U${d.id}`, libelle, sous_titre: d.objet ?? null, icone: '📄', url: `/document/${d.id}` };
    });
  }
}
