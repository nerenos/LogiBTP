import { NIVEAU_CONFIDENTIALITE, PROFIL } from '@logibtp/socle';
import { echapper, lirePreferences, ecrirePreferences, creerCombo, confirmer, saisir, formatDate, formatDateHeure, separateur } from '@logibtp/socle/ui';
import { icone, formatTaille } from '../src/fichiers.js';
import { versionsVisibles, etapes, ETAPES, GENRES } from '../src/versions.js';
import { normaliserRecherche } from '../src/recherche.js';
import { CONFIDENTIALITES, libelleConfidentialite, peutChangerAcces } from '../src/acces.js';
import { rendreApercu, libererApercu, htmlMail } from './apercu.js';
import { DialogueDepot } from './depot.js';
import { ArborescenceGed } from './arborescence.js';

// Explorateur de la GED (classe mère), à la façon de l'explorateur Windows :
//   - barre : précédent / suivant / dossier parent, chemin du dossier courant (la racine est la fiche ou le document
//     ouvert) dont la zone de saisie filtre le dossier (Entrée : recherche dans toute la GED, contenu compris), vue
//     icônes ou détails, nouveau dossier, ajout de fichiers, filtres (coffre-fort, à envoyer, archives, supprimés) ;
//   - arbre des dossiers (nœuds automatiques de l'arborescence + répertoires créés), liste du dossier (colonnes
//     triables), séparateurs redimensionnables (tailles gardées dans le navigateur) ;
//   - visualisation : en-tête (type, titre, actions en icônes avec bulles), aperçu, et dock bas à onglets
//     (informations, versions, historique, dérivations, coffre-fort) masquable et redimensionnable.
// Dépôt (bouton ou glisser-déposer) dans le dossier courant ou le dossier survolé : le document est lié à l'élément
// du dossier, même si ce n'est pas l'élément ouvert. Glisser un document sur un dossier l'y classe.
//
// Options : fournisseur, contexte { type_element, id_element, libelle } (null = GED globale), arborescence
// (ArborescenceGed ou dérivée), compact (vue des fiches), modifiable, admin, utilisateur, message, documentInitial,
// coffre (filtre coffre-fort), envoi (pièces jointes à envoyer, module Mail), ouvrirUrl(url) (nœud qui ouvre une page).

const libelleEtape = (code) => ETAPES.find(([c]) => c === code)?.[1] ?? code ?? '';
const cleChemin = (chemin) => chemin.map((n) => n.cle).join('/');
const cleElement = (e) => (e ? `${e.type_element}|${e.id_element}` : '∅');
const TYPE_GLISSE = 'application/x-logibtp-ged';
const TYPES_DERIVATION = [['VERSION', 'Version'], ['TRADUCTION', 'Traduction'], ['ADAPTATION', 'Adaptation'], ['EXTRAIT', 'Extrait'], ['ANNOTATION', 'Annotation']];
const STATUTS_RETENTION = { ACTIF: 'Actif', A_ARCHIVER: 'À archiver', FIN_CONSERVATION: 'Fin de conservation' };
const ETATS_INDEX = { A_FAIRE: 'À indexer', FAIT: 'Texte indexé', SANS_TEXTE: 'Aucun texte', ECHEC: 'Échec de l\'extraction' };
const COLONNES = [
  { cle: 'nom', libelle: 'Nom', compact: true }, { cle: 'categorie', libelle: 'Catégorie' }, { cle: 'date', libelle: 'Date', compact: true },
  { cle: 'auteur', libelle: 'Auteur' }, { cle: 'taille', libelle: 'Taille', compact: true, nombre: true }, { cle: 'confidentialite', libelle: 'Accès' },
];

/** Bouton d'action en icône, libellé dans une bulle. */
const bouton = (action, icone, bulle, { classe = '', pos = '' } = {}) =>
  `<button type="button" class="ged-icone-bouton ${classe}" data-action="${action}" data-bulle="${echapper(bulle)}" aria-label="${echapper(bulle)}"${pos ? ` data-bulle-pos="${pos}"` : ''}>${icone}</button>`;

export class ExplorateurGed {
  constructor(conteneur, { fournisseur, contexte = null, arborescence = null, compact = false, modifiable = true, admin = false, utilisateur = '', message,
    documentInitial = null, coffre = false, envoi = false, terrain = false, ouvrirUrl = null }) {
    this.conteneur = conteneur;
    this.ouvrirUrl = ouvrirUrl;
    this.fournisseur = fournisseur;
    this.contexte = contexte;
    this.arbo = arborescence ?? new ArborescenceGed(contexte);
    this.compact = compact;
    this.modifiable = modifiable;
    this.admin = admin;
    this.utilisateur = utilisateur;
    this.message = message ?? (() => {});
    this.documentInitial = documentInitial;
    this.options = { coffre, supprimes: false, archives: false, aEnvoyer: false, terrain: false };
    this.envoi = envoi;
    this.terrain = terrain;
    this.clePrefs = compact ? 'gedCompact' : 'ged';
    const p = this.#prefs();
    this.vue = p.vue ?? 'details';
    this.tri = p.tri ?? { col: 'nom', sens: 1 };
    this.chemin = [];
    this.arriere = [];
    this.avant = [];
    this.filtre = '';
    this.resultats = null;
    this.selection = null;           // { doc: id } ou { noeud: cle }
    this.doc = null;
    this.cacheEnfants = new Map();
    this.cacheReps = new Map();
    this.cacheDocs = new Map();
    this.ouverts = new Set();
    this.#construire();
  }

  #prefs() { return lirePreferences()[this.clePrefs] ?? {}; }
  #ecrirePrefs(v) { ecrirePreferences({ [this.clePrefs]: { ...this.#prefs(), ...v } }); }
  #erreur(e) { console.error(e); this.message(e.message ?? String(e), 'erreur'); }
  #lancer(f) { return Promise.resolve().then(f).catch((x) => this.#erreur(x)); }

  // ================================================================ construction

  #construire() {
    const c = this.conteneur;
    const p = this.#prefs();
    c.classList.add('ged');
    c.classList.toggle('ged-compact', this.compact);
    c.innerHTML = `
      <div class="ged-barre">
        <div class="ged-nav">
          ${bouton('arriere', '←', 'Précédent (Alt+←)', { pos: 'gauche' })}${bouton('avant', '→', 'Suivant (Alt+→)', { pos: 'gauche' })}${bouton('parent', '↑', 'Dossier parent (Retour arrière)', { pos: 'gauche' })}
        </div>
        <div class="ged-chemin" title="Chemin du dossier ; la saisie filtre le dossier, Entrée cherche dans toute la GED (contenu des fichiers compris)">
          <span class="ged-segments"></span>
          <input type="search" class="ged-filtre" placeholder="Filtrer… (Entrée : rechercher partout)" aria-label="Filtrer le dossier ou rechercher">
        </div>
        <div class="ged-outils">
          ${bouton('arbre', '🌳', 'Afficher ou masquer l\'arbre des dossiers')}
          ${bouton('vue', '☰', 'Affichage : icônes ou détails')}
          ${this.modifiable ? bouton('dossier', '📁＋', 'Nouveau dossier') : ''}
          ${this.modifiable ? `${bouton('ajouter', '＋', 'Ajouter des documents (ou glisser-déposer)', { classe: 'principal' })}<input type="file" multiple hidden data-fichiers>` : ''}
          <span class="ged-separateur-outils"></span>
          ${this.contexte ? '' : bouton('filtre-coffre', '🔒', 'Coffre-fort seulement', { classe: 'bascule' })}
          ${this.envoi ? bouton('filtre-envoi', '📧', 'Pièces jointes à envoyer seulement', { classe: 'bascule' }) : ''}
          ${this.terrain ? bouton('filtre-terrain', '📱', 'Pièces diffusées sur le terrain seulement', { classe: 'bascule' }) : ''}
          ${bouton('filtre-archives', '🗄', 'Documents archivés', { classe: 'bascule' })}
          ${this.admin ? bouton('filtre-supprimes', '🗑', 'Afficher les documents supprimés', { classe: 'bascule' }) : ''}
          ${this.admin && !this.contexte ? bouton('coffre', '🛡', 'Vérifier toute la chaîne du coffre-fort') : ''}
          ${this.admin && !this.contexte ? bouton('retention', '⏳', 'Rétention : documents à archiver') : ''}
        </div>
      </div>
      <div class="ged-corps">
        <nav class="ged-arbre" aria-label="Dossiers"></nav>
        <div class="ged-sep" data-sep="arbre"></div>
        <section class="ged-liste" tabindex="0" aria-label="Contenu du dossier">
          <div class="ged-liste-entete"><span class="ged-compteur"></span><span class="ged-actions-dossier"></span></div>
          <div class="ged-contenu"></div>
        </section>
        <div class="ged-sep" data-sep="visu"></div>
        <section class="ged-visu">
          <div class="ged-visu-haut"><p class="aide ged-visu-vide">Sélectionnez un document, ou déposez des fichiers dans un dossier.</p></div>
          <div class="ged-sep ged-sep-h" data-sep="dock"></div>
          <div class="ged-dock"></div>
        </section>
      </div>
      <div class="ged-depot-zone" hidden></div>`;
    this.arbre = c.querySelector('.ged-arbre');
    this.liste = c.querySelector('.ged-liste');
    this.contenu = c.querySelector('.ged-contenu');
    this.visu = c.querySelector('.ged-visu');
    this.haut = c.querySelector('.ged-visu-haut');
    this.dock = c.querySelector('.ged-dock');

    // Tailles et visibilités gardées dans le navigateur.
    const largeur = (el, v) => { if (v) { el.style.width = `${v}px`; el.style.flexBasis = `${v}px`; } };
    largeur(this.arbre, p.largeurArbre);
    largeur(this.visu, p.largeurVisu);
    if (p.hauteurDock) this.dock.style.height = `${p.hauteurDock}px`;
    this.#basculerArbre(p.arbre ?? !this.compact, false);
    this.#basculerDock(p.dock ?? true, false);
    separateur(c.querySelector('[data-sep="arbre"]'), { cible: this.arbre, min: 140, max: () => c.clientWidth * 0.45, surFin: (v) => this.#ecrirePrefs({ largeurArbre: v }) });
    separateur(c.querySelector('[data-sep="visu"]'), { cible: this.visu, sens: -1, min: 260, max: () => c.clientWidth * 0.75, surFin: (v) => this.#ecrirePrefs({ largeurVisu: v }) });
    separateur(c.querySelector('[data-sep="dock"]'), { cible: this.dock, axe: 'y', sens: -1, min: 90, max: () => this.visu.clientHeight - 120, surFin: (v) => this.#ecrirePrefs({ hauteurDock: v }) });

    const action = (nom, f) => c.querySelector(`.ged-barre [data-action="${nom}"]`)?.addEventListener('click', () => this.#lancer(f));
    action('arriere', () => this.precedent());
    action('avant', () => this.suivant());
    action('parent', () => this.dossierParent());
    action('arbre', () => this.#basculerArbre(this.arbre.hidden));
    action('vue', () => { this.vue = this.vue === 'details' ? 'icones' : 'details'; this.#ecrirePrefs({ vue: this.vue }); this.#rendreListe(); });
    action('dossier', () => this.nouveauDossier());
    const entree = c.querySelector('[data-fichiers]');
    action('ajouter', () => entree.click());
    entree?.addEventListener('change', () => { if (entree.files.length) this.deposer(entree.files); entree.value = ''; });
    const bascule = (nom, cle, rechargement = true) => action(nom, async () => {
      this.options[cle] = !this.options[cle];
      c.querySelector(`[data-action="${nom}"]`).setAttribute('aria-pressed', String(this.options[cle]));
      if (rechargement) await this.recharger(); else this.#rendreListe();
    });
    bascule('filtre-coffre', 'coffre');
    bascule('filtre-envoi', 'aEnvoyer', false);
    bascule('filtre-terrain', 'terrain', false);
    bascule('filtre-archives', 'archives');
    bascule('filtre-supprimes', 'supprimes');
    c.querySelector('[data-action="filtre-coffre"]')?.setAttribute('aria-pressed', String(this.options.coffre));
    action('coffre', () => this.verifierCoffre());
    action('retention', () => this.afficherRetention());

    const filtre = c.querySelector('.ged-filtre');
    filtre.addEventListener('input', () => { this.filtre = filtre.value; this.#rendreListe(); });
    filtre.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && filtre.value.trim()) { e.preventDefault(); this.#lancer(() => this.rechercher(filtre.value.trim())); }
      if (e.key === 'Escape' && filtre.value) { e.stopPropagation(); filtre.value = ''; this.filtre = ''; this.#rendreListe(); }
    });
    c.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); this.#lancer(() => this.precedent()); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); this.#lancer(() => this.suivant()); }
    });
    this.liste.addEventListener('keydown', (e) => this.#clavierListe(e));
    if (this.modifiable) this.#glisserDeposer();
    this.#lancer(() => this.#demarrer());
  }

  #basculerArbre(visible, memoriser = true) {
    this.arbre.hidden = !visible;
    this.conteneur.querySelector('[data-sep="arbre"]').hidden = !visible;
    this.conteneur.querySelector('[data-action="arbre"]')?.setAttribute('aria-pressed', String(visible));
    if (memoriser) this.#ecrirePrefs({ arbre: visible });
  }

  #basculerDock(visible, memoriser = true) {
    this.dock.hidden = !visible;
    this.conteneur.querySelector('[data-sep="dock"]').hidden = !visible;
    this.haut.querySelector('[data-action="dock"]')?.setAttribute('aria-pressed', String(visible));
    if (memoriser) this.#ecrirePrefs({ dock: visible });
  }

  async #demarrer() {
    this.parametres = await this.fournisseur.parametres();
    const racine = await this.arbo.racine();
    this.ouverts.add(racine.cle);
    await this.#aller([racine], { historique: false });
    if (this.documentInitial !== null) await this.selectionnerDocument(Number(this.documentInitial));
  }

  libelleCategorie(code) { return this.parametres?.categories?.find((c) => c.code === code)?.libelle ?? code ?? ''; }

  // ================================================================ données (caches par élément)

  #filtreListe(element) {
    const f = { supprimes: this.options.supprimes, coffre: this.options.coffre, archives: this.options.archives };
    return element ? { ...f, type_element: element.type_element, id_element: String(element.id_element) } : { ...f, sans_element: true };
  }

  async #documentsElement(element) {
    const k = cleElement(element);
    if (!this.cacheDocs.has(k)) this.cacheDocs.set(k, this.fournisseur.lister(this.#filtreListe(element)));
    return this.cacheDocs.get(k);
  }

  async #repertoires(element) {
    const k = cleElement(element);
    if (!this.cacheReps.has(k)) this.cacheReps.set(k, this.fournisseur.repertoires(element ?? {}).catch(() => []));
    return this.cacheReps.get(k);
  }

  #noeudRepertoire(r, parent) {
    return { cle: `R${r.id}`, libelle: r.nom, icone: '📁', element: parent.element, repertoire: { id: r.id, nom: r.nom }, nb: r.nb_documents };
  }

  /** Nœuds sous le dernier nœud du chemin : automatiques (liens compris) puis répertoires créés. */
  async #enfants(chemin) {
    const k = cleChemin(chemin);
    if (!this.cacheEnfants.has(k)) {
      this.cacheEnfants.set(k, (async () => {
        const n = chemin.at(-1);
        if (n.lien) return [];
        const auto = n.repertoire ? [] : await this.arbo.enfants(n).catch((e) => { this.#erreur(e); return []; });
        if (n.groupe) return auto;
        const parent = n.repertoire?.id ?? null;
        const reps = (await this.#repertoires(n.element)).filter((r) => (r.parent_id ?? null) === parent).map((r) => this.#noeudRepertoire(r, n));
        return [...auto, ...reps];
      })());
    }
    return this.cacheEnfants.get(k);
  }

  async #documents(n) {
    if (n.groupe || n.lien || n.url) return [];
    const rep = n.repertoire?.id ?? null;
    return (await this.#documentsElement(n.element)).filter((d) => (d.repertoire_id ?? null) === rep);
  }

  /** Données relues (dépôt, déplacement, filtres) ; le dossier courant est conservé. */
  async recharger({ arbre = true } = {}) {
    this.cacheDocs.clear();
    this.cacheReps.clear();
    if (arbre) this.cacheEnfants.clear();
    this.resultats = this.resultats ? { ...this.resultats, documents: await this.fournisseur.lister({ recherche: this.resultats.recherche, archives: this.options.archives }) } : null;
    await this.#chargerDossier();
    await this.#rendreArbre();
    if (this.selection?.doc) await this.selectionnerDocument(this.selection.doc, { silencieux: true });
  }

  /** Appelée après un changement fait ailleurs (alias historique). */
  charger() { return this.recharger(); }

  // ================================================================ navigation

  get noeud() { return this.chemin.at(-1); }

  async #aller(chemin, { historique = true } = {}) {
    if (historique && this.chemin.length) { this.arriere.push(this.chemin); this.avant = []; }
    this.chemin = chemin;
    this.resultats = null;
    this.selection = null;
    this.doc = null;
    this.filtre = '';
    this.conteneur.querySelector('.ged-filtre').value = '';
    for (let i = 1; i <= chemin.length; i++) this.ouverts.add(cleChemin(chemin.slice(0, i)));
    await this.#chargerDossier();
    await this.#rendreArbre();
  }

  ouvrir(noeud) {
    if (noeud.url) { this.ouvrirUrl?.(noeud.url); return Promise.resolve(); }
    if (noeud.lien) return this.#suivreLien(noeud);
    return this.#aller([...this.chemin, noeud]);
  }

  /**
   * Lien symbolique : chemin relatif (lien.chemin, clés successives ; à défaut [lien.cle]) résolu depuis le dossier
   * courant, puis depuis chacun de ses ancêtres.
   */
  async #suivreLien(lien) {
    const relatif = lien.lien.chemin ?? [lien.lien.cle];
    for (let i = this.chemin.length; i >= 1; i--) {
      let base = this.chemin.slice(0, i);
      for (const cle of relatif) {
        const n = (await this.#enfants(base)).find((x) => x.cle === cle && !x.lien && !x.url);
        base = n ? [...base, n] : null;
        if (!base) break;
      }
      if (base) return this.#aller(base);
    }
    this.message(`Dossier « ${lien.lien.libelle ?? lien.libelle} » introuvable dans l'arborescence`, 'erreur');
  }

  async precedent() {
    if (this.resultats) { this.resultats = null; await this.#chargerDossier(); return; }
    const c = this.arriere.pop();
    if (!c) return;
    this.avant.push(this.chemin);
    await this.#aller(c, { historique: false });
  }

  async suivant() {
    const c = this.avant.pop();
    if (!c) return;
    this.arriere.push(this.chemin);
    await this.#aller(c, { historique: false });
  }

  async dossierParent() {
    if (this.resultats) { this.resultats = null; await this.#chargerDossier(); return; }
    if (this.chemin.length > 1) await this.#aller(this.chemin.slice(0, -1));
  }

  /** Recherche dans toute la GED (métadonnées, noms de fichiers, contenu indexé), résultats dans un dossier virtuel. */
  async rechercher(texte) {
    this.resultats = { recherche: texte, documents: await this.fournisseur.lister({ recherche: texte, archives: this.options.archives }) };
    this.filtre = '';
    this.conteneur.querySelector('.ged-filtre').value = '';
    await this.#chargerDossier();
  }

  // ================================================================ dossier courant

  async #chargerDossier() {
    const n = this.noeud;
    if (this.resultats) { this.dossiers = []; this.documents = this.resultats.documents; }
    else [this.dossiers, this.documents] = await Promise.all([this.#enfants(this.chemin), this.#documents(n)]);
    this.#rendreChemin();
    this.#rendreListe();
    this.conteneur.querySelector('[data-action="parent"]').disabled = !this.resultats && this.chemin.length < 2;
    this.conteneur.querySelector('[data-action="arriere"]').disabled = !this.resultats && !this.arriere.length;
    this.conteneur.querySelector('[data-action="avant"]').disabled = !this.avant.length;
    if (!this.selection?.doc) this.#rendreVisuDossier();
  }

  #rendreChemin() {
    const z = this.conteneur.querySelector('.ged-segments');
    const segments = this.chemin.map((n, i) => `<button type="button" class="ged-segment" data-i="${i}">${n.icone ?? '📁'} ${echapper(n.libelle)}</button>`);
    if (this.resultats) segments.push(`<span class="ged-segment courant">🔍 « ${echapper(this.resultats.recherche)} »</span>`);
    z.innerHTML = segments.join('<span class="ged-chevron">›</span>');
    z.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => this.#lancer(() => this.#aller(this.chemin.slice(0, Number(b.dataset.i) + 1)))));
    z.querySelectorAll('[data-i]').forEach((b) => this.#cibleDepot(b, this.chemin.slice(0, Number(b.dataset.i) + 1)));
    z.scrollLeft = z.scrollWidth;
  }

  // ================================================================ arbre

  async #rendreArbre() {
    if (this.arbre.hidden) return;
    const courant = cleChemin(this.chemin);
    const branche = async (chemin) => {
      const n = chemin.at(-1);
      const k = cleChemin(chemin);
      const ouvert = this.ouverts.has(k);
      const enfants = ouvert ? (await this.#enfants(chemin)).filter((x) => !x.lien && !x.url) : null;
      const feuille = ouvert && !enfants.length;
      const sous = ouvert ? (await Promise.all(enfants.map((e) => branche([...chemin, e])))).join('') : '';
      return `<li><div class="ged-noeud ${k === courant ? 'courant' : ''}" data-chemin="${echapper(k)}">
          <button type="button" class="ged-deplier" data-deplier="${echapper(k)}" ${feuille ? 'disabled' : ''} aria-label="${ouvert ? 'Replier' : 'Déplier'}">${feuille ? '' : ouvert ? '▾' : '▸'}</button>
          <span class="ged-noeud-ico">${n.icone ?? '📁'}</span><span class="ged-noeud-nom" title="${echapper(n.libelle)}">${echapper(n.libelle)}</span>
        </div>${sous ? `<ul>${sous}</ul>` : ''}</li>`;
    };
    this.cheminsArbre = new Map();
    const indexer = async (chemin) => {
      this.cheminsArbre.set(cleChemin(chemin), chemin);
      if (this.ouverts.has(cleChemin(chemin))) for (const e of (await this.#enfants(chemin)).filter((x) => !x.lien && !x.url)) await indexer([...chemin, e]);
    };
    const racine = this.chemin.slice(0, 1);
    await indexer(racine);
    this.arbre.innerHTML = `<ul class="ged-arbre-racine">${await branche(racine)}</ul>`;
    this.arbre.querySelectorAll('[data-deplier]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = b.dataset.deplier;
      if (this.ouverts.has(k)) this.ouverts.delete(k); else this.ouverts.add(k);
      this.#lancer(() => this.#rendreArbre());
    }));
    this.arbre.querySelectorAll('.ged-noeud').forEach((el) => {
      const chemin = this.cheminsArbre.get(el.dataset.chemin);
      el.addEventListener('click', () => this.#lancer(() => this.#aller(chemin)));
      this.#cibleDepot(el, chemin);
    });
    this.arbre.querySelector('.ged-noeud.courant')?.scrollIntoView({ block: 'nearest' });
  }

  // ================================================================ liste du dossier

  #correspond(texte) {
    const f = normaliserRecherche(this.filtre).trim();
    return !f || f.split(/\s+/).every((m) => normaliserRecherche(texte).includes(m));
  }

  #valeurTri(d, col) {
    switch (col) {
      case 'categorie': return this.libelleCategorie(d.categorie);
      case 'date': return d.date_document ?? '';
      case 'auteur': return d.auteur ?? '';
      case 'taille': return d.version?.taille ?? 0;
      case 'confidentialite': return CONFIDENTIALITES.findIndex(([c]) => c === (d.confidentialite ?? NIVEAU_CONFIDENTIALITE.INTERNE));
      default: return d.titre ?? '';
    }
  }

  #trier(docs) {
    const { col, sens } = this.tri;
    return [...docs].sort((a, b) => {
      const x = this.#valeurTri(a, col);
      const y = this.#valeurTri(b, col);
      return sens * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true })) || b.id - a.id;
    });
  }

  #rendreListe() {
    const dossiers = (this.dossiers ?? []).filter((n) => this.#correspond(n.libelle));
    let docs = (this.documents ?? []).filter((d) => this.#correspond(`${d.titre} ${d.version?.nom_fichier ?? ''} ${this.libelleCategorie(d.categorie)} ${d.auteur ?? ''} ${(d.mots_cles ?? []).join(' ')}`));
    if (this.options.aEnvoyer) docs = docs.filter((d) => d.a_envoyer);
    if (this.options.terrain) docs = docs.filter((d) => d.terrain);
    // Pièces jointes d'un mail : sous le mail quand il est dans la liste.
    const ids = new Set(docs.map((d) => d.id));
    const racines = this.#trier(docs.filter((d) => !d.parent_id || !ids.has(d.parent_id)));
    const ordonnes = racines.flatMap((d) => [d, ...docs.filter((x) => x.parent_id === d.id)]);
    this.visibles = { dossiers, docs: ordonnes };
    const nbEnvoi = docs.filter((d) => d.a_envoyer).length;
    const nbTerrain = docs.filter((d) => d.terrain).length;
    this.conteneur.querySelector('.ged-compteur').textContent = [
      dossiers.length ? `${dossiers.length} dossier${dossiers.length > 1 ? 's' : ''}` : '',
      `${docs.length} document${docs.length > 1 ? 's' : ''}`, this.envoi && nbEnvoi ? `${nbEnvoi} à envoyer` : '',
      this.terrain && nbTerrain ? `${nbTerrain} sur le terrain` : '',
    ].filter(Boolean).join(' · ');
    this.#rendreActionsDossier();
    if (!dossiers.length && !ordonnes.length) {
      this.contenu.innerHTML = `<p class="aide ged-vide">${this.filtre || this.resultats ? 'Aucun résultat.' : 'Dossier vide.'}${this.modifiable && !this.resultats && !this.noeud?.groupe ? ' Glissez des fichiers ici ou utilisez ＋.' : ''}</p>`;
      return;
    }
    this.contenu.innerHTML = this.vue === 'icones' ? this.#htmlIcones(dossiers, ordonnes, ids) : this.#htmlDetails(dossiers, ordonnes, ids);
    this.#lierListe();
  }

  #classeDoc(d, ids) {
    return [this.selection?.doc === d.id ? 'selectionnee' : '', d.supprime ? 'supprime' : '', d.archive ? 'archive' : '', d.parent_id && ids.has(d.parent_id) ? 'piece' : ''].join(' ');
  }

  #badges(d) {
    return `${d.coffre ? '<span class="ged-badge coffre" data-bulle="Coffre-fort : verrouillé, horodaté">🔒</span>' : ''}
      ${d.archive ? '<span class="ged-badge" data-bulle="Archivé">🗄</span>' : ''}
      ${d.nb_pieces ? `<span class="ged-badge" data-bulle="Pièces jointes">📎 ${d.nb_pieces}</span>` : ''}
      ${d.etat ? `<span class="ged-badge etat">${echapper(libelleEtape(d.etat))}</span>` : ''}
      ${d.version?.numero > 1 ? `<span class="ged-badge" data-bulle="Version courante">v${d.version.numero}</span>` : ''}`;
  }

  #htmlDetails(dossiers, docs, ids) {
    const colonnes = COLONNES.filter((c) => !this.compact || c.compact);
    const recherche = Boolean(this.resultats);
    const entete = colonnes.map((c) => `<th data-tri="${c.cle}" class="${c.nombre ? 'nombre' : ''} ${this.tri.col === c.cle ? 'trie' : ''}" aria-sort="${this.tri.col === c.cle ? (this.tri.sens > 0 ? 'ascending' : 'descending') : 'none'}">
      ${c.libelle}${this.tri.col === c.cle ? (this.tri.sens > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const cellules = (d) => colonnes.map((c) => {
      switch (c.cle) {
        case 'nom': return `<td class="ged-nom"><span class="ged-ico">${icone(d)}</span><span class="ged-titre">${echapper(d.titre)}</span>${this.#badges(d)}
          ${recherche && d.type_element ? `<small class="ged-emplacement">${echapper(`${d.type_element} ${d.id_element ?? ''}`)}</small>` : ''}</td>`;
        case 'categorie': return `<td>${echapper(this.libelleCategorie(d.categorie))}</td>`;
        case 'date': return `<td>${formatDate(d.date_document)}</td>`;
        case 'auteur': return `<td>${echapper(d.auteur ?? '')}</td>`;
        case 'taille': return `<td class="nombre">${formatTaille(d.version?.taille)}</td>`;
        case 'confidentialite': return `<td>${(d.confidentialite ?? NIVEAU_CONFIDENTIALITE.INTERNE) === NIVEAU_CONFIDENTIALITE.INTERNE && !(d.acces_profils ?? []).length && !(d.acces_utilisateurs ?? []).length ? ''
          : `<span class="ged-badge acces">${echapper(libelleConfidentialite(d.confidentialite))}${(d.acces_profils ?? []).length + (d.acces_utilisateurs ?? []).length ? ' 👥' : ''}</span>`}</td>`;
        default: return '<td></td>';
      }
    }).join('');
    const vide = colonnes.length - 1;
    return `<table class="ged-table"><thead><tr>${this.envoi ? '<th class="ged-envoi" data-bulle="Pièce jointe à envoyer (module Mail)">📧</th>' : ''}${this.terrain ? '<th class="ged-envoi" data-bulle="Pièce diffusée sur le terrain">📱</th>' : ''}${entete}</tr></thead><tbody>
      ${dossiers.map((n, i) => `<tr data-noeud="${i}" class="ged-ligne-dossier ${this.selection?.noeud === n.cle ? 'selectionnee' : ''} ${n.lien || n.url ? 'lien' : ''}" draggable="false">
        ${this.envoi ? '<td></td>' : ''}${this.terrain ? '<td></td>' : ''}<td class="ged-nom"><span class="ged-ico">${n.lien || n.url ? '↪' : ''}${n.icone ?? '📁'}</span><span class="ged-titre">${echapper(n.libelle)}</span>
        ${n.sous_titre ? `<small class="ged-emplacement">${echapper(n.sous_titre)}</small>` : ''}</td>${'<td></td>'.repeat(vide)}</tr>`).join('')}
      ${docs.map((d) => `<tr data-doc="${d.id}" class="${this.#classeDoc(d, ids)}" draggable="${this.modifiable && !d.archive}">
        ${this.envoi ? `<td class="ged-envoi"><input type="checkbox" data-envoi="${d.id}" ${d.a_envoyer ? 'checked' : ''} ${this.modifiable && !d.supprime && !d.archive ? '' : 'disabled'} aria-label="Pièce jointe à envoyer"></td>` : ''}
        ${this.terrain ? `<td class="ged-envoi"><input type="checkbox" data-terrain="${d.id}" ${d.terrain ? 'checked' : ''} ${this.modifiable && !d.supprime && !d.archive ? '' : 'disabled'} aria-label="Pièce diffusée sur le terrain"></td>` : ''}
        ${cellules(d)}</tr>`).join('')}
    </tbody></table>`;
  }

  #htmlIcones(dossiers, docs, ids) {
    return `<div class="ged-icones">
      ${dossiers.map((n, i) => `<div class="ged-tuile ${this.selection?.noeud === n.cle ? 'selectionnee' : ''} ${n.lien || n.url ? 'lien' : ''}" data-noeud="${i}" tabindex="-1" title="${echapper(n.libelle)}">
        <span class="ged-tuile-ico">${n.icone ?? '📁'}${n.lien || n.url ? '<span class="ged-tuile-lien">↪</span>' : ''}</span><span class="ged-tuile-nom">${echapper(n.libelle)}</span></div>`).join('')}
      ${docs.map((d) => `<div class="ged-tuile ${this.#classeDoc(d, ids)}" data-doc="${d.id}" tabindex="-1" draggable="${this.modifiable && !d.archive}" title="${echapper(d.titre)}">
        <span class="ged-tuile-ico">${icone(d)}${d.coffre ? '<span class="ged-tuile-lien">🔒</span>' : ''}</span><span class="ged-tuile-nom">${echapper(d.titre)}</span></div>`).join('')}
    </div>`;
  }

  #lierListe() {
    this.contenu.querySelectorAll('[data-tri]').forEach((th) => th.addEventListener('click', () => {
      this.tri = { col: th.dataset.tri, sens: this.tri.col === th.dataset.tri ? -this.tri.sens : 1 };
      this.#ecrirePrefs({ tri: this.tri });
      this.#rendreListe();
    }));
    this.contenu.querySelectorAll('[data-noeud]').forEach((el) => {
      const n = this.visibles.dossiers[Number(el.dataset.noeud)];
      el.addEventListener('click', () => this.#selectionnerNoeud(n));
      el.addEventListener('dblclick', () => this.#lancer(() => this.ouvrir(n)));
      if (!n.lien && !n.url && !n.groupe) this.#cibleDepot(el, [...this.chemin, n]);
    });
    this.contenu.querySelectorAll('[data-doc]').forEach((el) => {
      const id = Number(el.dataset.doc);
      el.addEventListener('click', (e) => { if (!e.target.closest('[data-envoi]')) this.#lancer(() => this.selectionnerDocument(id)); });
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(TYPE_GLISSE, JSON.stringify({ ids: [id] }));
        e.dataTransfer.effectAllowed = 'move';
      });
    });
    this.contenu.querySelectorAll('[data-envoi]').forEach((c) => c.addEventListener('change', () => this.#lancer(() => this.marquerEnvoi(Number(c.dataset.envoi), c.checked))));
    this.contenu.querySelectorAll('[data-terrain]').forEach((c) => c.addEventListener('change', () => this.#lancer(() => this.marquerTerrain(Number(c.dataset.terrain), c.checked))));
  }

  #selectionnerNoeud(n) {
    this.selection = { noeud: n.cle };
    this.doc = null;
    this.contenu.querySelectorAll('.selectionnee').forEach((x) => x.classList.remove('selectionnee'));
    this.contenu.querySelector(`[data-noeud="${this.visibles.dossiers.indexOf(n)}"]`)?.classList.add('selectionnee');
    this.#rendreActionsDossier();
    this.#rendreVisuDossier(n);
  }

  #noeudSelectionne() { return this.visibles?.dossiers.find((n) => n.cle === this.selection?.noeud) ?? null; }

  /** Renommer / supprimer un répertoire créé (sélectionné), ou le dossier courant. */
  #rendreActionsDossier() {
    const z = this.conteneur.querySelector('.ged-actions-dossier');
    const n = this.#noeudSelectionne() ?? (this.resultats ? null : this.noeud);
    z.innerHTML = this.modifiable && n?.repertoire
      ? `${bouton('renommer', '✎', `Renommer « ${n.libelle} » (F2)`)}${bouton('supprimer-dossier', '✕', `Supprimer le dossier « ${n.libelle} » (vide)`)}` : '';
    z.querySelector('[data-action="renommer"]')?.addEventListener('click', () => this.#lancer(() => this.renommerDossier(n)));
    z.querySelector('[data-action="supprimer-dossier"]')?.addEventListener('click', () => this.#lancer(() => this.supprimerDossier(n)));
  }

  #clavierListe(e) {
    if (e.target.closest('input, textarea, button')) return;
    const elements = [...this.contenu.querySelectorAll('[data-noeud], [data-doc]')];
    const i = elements.findIndex((x) => x.classList.contains('selectionnee'));
    const choisir = (el) => { el?.click(); el?.scrollIntoView({ block: 'nearest' }); };
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); choisir(elements[Math.min(i + 1, elements.length - 1)]); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); choisir(elements[Math.max(i - 1, 0)]); }
    else if (e.key === 'Enter' && this.#noeudSelectionne()) { e.preventDefault(); this.#lancer(() => this.ouvrir(this.#noeudSelectionne())); }
    else if (e.key === 'Backspace') { e.preventDefault(); this.#lancer(() => this.dossierParent()); }
    else if (e.key === 'F2' && this.#noeudSelectionne()?.repertoire) { e.preventDefault(); this.#lancer(() => this.renommerDossier(this.#noeudSelectionne())); }
  }

  // ================================================================ répertoires

  async nouveauDossier() {
    const n = this.noeud;
    if (this.resultats || n.groupe || n.lien) { this.message('Ouvrez un dossier pour y créer un sous-dossier', 'erreur'); return; }
    const nom = await saisir(`Nouveau dossier dans « ${n.libelle} » :`, 'Nouveau dossier');
    if (!nom?.trim()) return;
    await this.fournisseur.creerRepertoire({ nom: nom.trim(), parent_id: n.repertoire?.id ?? null, ...(n.element ?? {}) });
    this.message(`Dossier « ${nom.trim()} » créé`, 'succes');
    await this.recharger();
  }

  async renommerDossier(n) {
    const nom = await saisir('Nouveau nom du dossier :', n.libelle);
    if (!nom?.trim() || nom.trim() === n.libelle) return;
    await this.fournisseur.modifierRepertoire(n.repertoire.id, { nom: nom.trim() });
    if (this.noeud.cle === n.cle) this.chemin = [...this.chemin.slice(0, -1), { ...n, libelle: nom.trim() }];
    this.message('Dossier renommé', 'succes');
    await this.recharger();
  }

  async supprimerDossier(n) {
    if (!await confirmer(`Supprimer le dossier « ${n.libelle} » ? Il doit être vide.`)) return;
    await this.fournisseur.supprimerRepertoire(n.repertoire.id);
    this.message('Dossier supprimé', 'succes');
    this.selection = null;
    if (this.noeud.cle === n.cle) this.chemin = this.chemin.slice(0, -1);
    await this.recharger();
  }

  // ================================================================ dépôt et glisser-déposer

  /** Destination d'un dépôt : élément lié et répertoire du dossier (libellé : chemin). */
  #destination(chemin) {
    const n = chemin.at(-1);
    return { ...(n.element ?? { type_element: null, id_element: null }), repertoire_id: n.repertoire?.id ?? null, libelle: chemin.map((x) => x.libelle).join(' › ') };
  }

  async deposer(fichiers, chemin = this.chemin) {
    const n = chemin.at(-1);
    if (this.resultats && chemin === this.chemin) { this.message('Ouvrez un dossier pour y déposer des fichiers', 'erreur'); return; }
    if (n.groupe || n.lien || n.url) { this.message(`« ${n.libelle} » regroupe des dossiers : déposez les fichiers dans l'un d'eux`, 'erreur'); return; }
    this.parametres ??= await this.fournisseur.parametres();
    new DialogueDepot(fichiers, {
      fournisseur: this.fournisseur, destination: this.#destination(chemin), utilisateur: this.utilisateur, parametres: this.parametres, message: this.message,
      surTermine: (crees) => this.#lancer(async () => { await this.recharger(); if (crees[0] && chemin === this.chemin) await this.selectionnerDocument(crees[0].id); }),
    });
  }

  /** Classe des documents glissés dans un dossier (lié à un autre élément : le document y est rattaché). */
  async classer(ids, chemin) {
    const n = chemin.at(-1);
    const meta = n.repertoire ? { repertoire_id: n.repertoire.id }
      : { type_element: n.element?.type_element ?? null, id_element: n.element ? String(n.element.id_element) : null, repertoire_id: null };
    for (const id of ids) await this.fournisseur.modifier(id, meta);
    this.message(`${ids.length > 1 ? `${ids.length} documents classés` : 'Document classé'} dans « ${n.libelle} »`, 'succes');
    await this.recharger();
  }

  #cibleDepot(el, chemin) {
    if (!this.modifiable) return;
    const n = chemin.at(-1);
    if (n.groupe || n.lien || n.url) return;
    const accepte = (e) => [...(e.dataTransfer?.types ?? [])].some((t) => t === 'Files' || t === TYPE_GLISSE);
    el.addEventListener('dragover', (e) => { if (!accepte(e)) return; e.preventDefault(); e.stopPropagation(); el.classList.add('ged-cible'); });
    el.addEventListener('dragleave', () => el.classList.remove('ged-cible'));
    el.addEventListener('drop', (e) => {
      if (!accepte(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('ged-cible');
      this.#finirGlisser();
      const interne = e.dataTransfer.getData(TYPE_GLISSE);
      if (interne) this.#lancer(() => this.classer(JSON.parse(interne).ids, chemin));
      else if (e.dataTransfer.files.length) this.deposer(e.dataTransfer.files, chemin);
    });
  }

  #finirGlisser() {
    this.profondeur = 0;
    this.conteneur.querySelector('.ged-depot-zone').hidden = true;
  }

  /** Fichiers glissés depuis l'explorateur du poste ou le client mail : sur la liste = dossier courant. */
  #glisserDeposer() {
    const zone = this.conteneur.querySelector('.ged-depot-zone');
    this.profondeur = 0;
    const avecFichiers = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    this.conteneur.addEventListener('dragenter', (e) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      this.profondeur++;
      zone.textContent = `Déposer dans « ${this.resultats ? '…' : this.noeud?.libelle ?? ''} » (ou sur un dossier)`;
      zone.hidden = false;
    });
    this.conteneur.addEventListener('dragover', (e) => { if (avecFichiers(e)) e.preventDefault(); });
    this.conteneur.addEventListener('dragleave', () => { this.profondeur = Math.max(0, this.profondeur - 1); if (!this.profondeur) zone.hidden = true; });
    this.conteneur.addEventListener('drop', (e) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      this.#finirGlisser();
      if (e.dataTransfer.files.length) this.deposer(e.dataTransfer.files);
    });
  }

  // ================================================================ visualisation

  /** Panneau de visualisation sans document : dossier courant ou sélectionné. */
  #rendreVisuDossier(n = this.resultats ? null : this.noeud) {
    libererApercu(this.haut.querySelector('.ged-apercu') ?? this.haut);
    this.dock.innerHTML = '';
    if (!n) { this.haut.innerHTML = '<p class="aide ged-visu-vide">Sélectionnez un document.</p>'; return; }
    const nbDocs = n === this.noeud ? (this.documents ?? []).length : n.nb;
    this.haut.innerHTML = `<header class="ged-visu-entete"><span class="ged-icone-grande">${n.lien || n.url ? '↪' : ''}${n.icone ?? '📁'}</span>
        <div class="ged-visu-titre"><h3>${echapper(n.libelle)}</h3><small>${n.lien ? 'Lien vers un dossier de l\'arborescence' : n.url ? 'Ouvre l\'élément' : n.groupe ? 'Regroupement' : n.repertoire ? 'Dossier' : n.element ? 'Dossier de l\'élément' : 'Documents sans élément lié'}
        ${n.sous_titre ? ` · ${echapper(n.sous_titre)}` : ''}${nbDocs !== undefined && !n.groupe && !n.lien ? ` · ${nbDocs} document${nbDocs > 1 ? 's' : ''}` : ''}</small></div>
        <div class="ged-visu-actions">${n === this.noeud ? '' : bouton('ouvrir-noeud', '📂', 'Ouvrir')}</div></header>
      <p class="aide ged-visu-vide">${n.lien || n.url ? 'Ouvrez le lien pour aller au dossier.'
        : n.groupe ? (n === this.noeud ? 'Regroupement : ouvrez l\'un de ses dossiers pour y déposer des fichiers.' : 'Ouvrez le dossier pour voir son contenu.')
          : 'Sélectionnez un document, ou déposez des fichiers.'}</p>`;
    this.haut.querySelector('[data-action="ouvrir-noeud"]')?.addEventListener('click', () => this.#lancer(() => this.ouvrir(n)));
  }

  async selectionnerDocument(id, { silencieux = false } = {}) {
    this.selection = { doc: id };
    this.contenu.querySelectorAll('.selectionnee').forEach((x) => x.classList.remove('selectionnee'));
    this.contenu.querySelector(`[data-doc="${id}"]`)?.classList.add('selectionnee');
    this.#rendreActionsDossier();
    try {
      this.doc = await this.fournisseur.document(id);
    } catch (e) {
      if (silencieux) { this.selection = null; this.#rendreVisuDossier(); return; }
      throw e;
    }
    this.#rendreDetail();
  }

  /** Alias historique (onglets des fiches, page GED). */
  selectionner(id) { return this.selectionnerDocument(id); }

  #lienContenu(v, telecharger = true) { return this.fournisseur.urlContenu(v.id, { telecharger }); }

  get #utilisateurCourant() { return { code: this.utilisateur, profil: this.admin ? PROFIL.ADMIN : '' }; }

  #rendreDetail() {
    const d = this.doc;
    libererApercu(this.haut.querySelector('.ged-apercu') ?? this.haut);
    const courante = d.versions.at(-1);
    const editable = this.modifiable && !d.supprime && !d.archive;
    const ongletDock = this.#prefs().onglet ?? 'infos';
    this.haut.innerHTML = `
      <header class="ged-visu-entete">
        <span class="ged-icone-grande">${icone(d)}</span>
        <div class="ged-visu-titre"><h3 title="${echapper(d.titre)}">${echapper(d.titre)}</h3>
          <small>${echapper(this.libelleCategorie(d.categorie) || 'Sans catégorie')}${d.etat ? ` · ${echapper(libelleEtape(d.etat))}` : ''}
          ${d.confidentialite && d.confidentialite !== NIVEAU_CONFIDENTIALITE.INTERNE ? ` · ${echapper(libelleConfidentialite(d.confidentialite))}` : ''}
          ${d.archive ? ' · <b>archivé</b>' : ''}${d.supprime ? ` · <b class="erreur">supprimé le ${formatDate(d.supprime_le)}</b>` : ''}</small></div>
        <div class="ged-visu-actions">
          ${courante ? `<a class="ged-icone-bouton" href="${echapper(this.#lienContenu(courante))}" download="${echapper(courante.nom_fichier)}" data-bulle="Télécharger" aria-label="Télécharger">⬇</a>` : ''}
          ${editable && !d.coffre ? `${bouton('version', '⟳', `Nouvelle version (les ${this.parametres.editions_conservees} dernières éditions sont conservées)`)}<input type="file" hidden data-version>` : ''}
          ${editable && !d.coffre ? bouton('etape', '✔', 'Enregistrer une étape (validation, envoi, signature…)') : ''}
          ${editable && !d.coffre ? bouton('coffre', '🔒', 'Archiver au coffre-fort : verrouillé, empreinte et horodatage') : ''}
          ${d.coffre && !d.archive ? bouton('verifier', '✓', 'Vérifier l\'intégrité (empreinte et chaîne du coffre-fort)') : ''}
          ${editable && !d.parent_id ? bouton('archiver', '🗄', 'Archiver (sort des recherches actives, restaurable)') : ''}
          ${d.archive && this.modifiable ? bouton('desarchiver', '📤', 'Sortir de l\'archive') : ''}
          ${this.modifiable && !d.supprime && !d.archive && (!d.coffre || this.admin) ? bouton('supprimer', '🗑', 'Supprimer (masqué, récupérable)') : ''}
          ${d.supprime && this.modifiable ? bouton('restaurer', '↺', 'Restaurer') : ''}
          ${d.supprime && this.admin && !d.coffre ? bouton('purger', '✖', 'Supprimer définitivement (administrateur)', { classe: 'danger' }) : ''}
          ${bouton('dock', '▤', 'Afficher ou masquer le panneau des informations', { classe: 'bascule' })}
        </div>
      </header>
      <div class="ged-etape-saisie" hidden>
        <span data-place="etape"></span>
        <input data-etape-commentaire placeholder="Commentaire (destinataire, signataire…)">
        <label class="ged-option" title="Joindre le fichier de cette étape (ex. devis signé)"><input type="file" data-etape-fichier></label>
        <button type="button" class="principal" data-action="etape-ok">Enregistrer l'étape</button>
      </div>
      ${d.parent ? `<p class="ged-lien-mail">📎 Pièce jointe du mail <a href="#" data-ouvrir="${d.parent.id}">${echapper(d.parent.titre)}</a></p>` : ''}
      ${d.pieces?.length ? `<div class="ged-pieces"><b>Pièces jointes</b>${d.pieces.map((p) => `<a href="#" data-ouvrir="${p.id}">${icone(p)} ${echapper(p.titre)}</a>`).join('')}</div>` : ''}
      <div class="ged-apercu"></div>`;
    this.#rendreDock(ongletDock);
    this.#basculerDock(!this.dock.hidden, false);
    const z = this.haut;
    const apercu = z.querySelector('.ged-apercu');
    this.#apercu(apercu, courante);
    z.querySelectorAll('[data-ouvrir]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.#lancer(() => this.selectionnerDocument(Number(a.dataset.ouvrir))); }));
    const etape = creerCombo({ options: ETAPES.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: 'VALIDATION', vide: false, titre: 'Étape' });
    z.querySelector('[data-place="etape"]').replaceWith(etape);
    const action = (nom, f) => z.querySelector(`[data-action="${nom}"]`)?.addEventListener('click', () => this.#lancer(f));
    action('dock', () => this.#basculerDock(this.dock.hidden));
    const entreeVersion = z.querySelector('[data-version]');
    action('version', () => entreeVersion.click());
    entreeVersion?.addEventListener('change', () => this.#lancer(async () => {
      const f = entreeVersion.files[0];
      if (!f) return;
      await this.fournisseur.nouvelleVersion(d.id, { fichier: f, genre: GENRES.EDITION, commentaire: 'Nouvelle version' });
      this.message('Nouvelle version enregistrée', 'succes');
      await this.recharger({ arbre: false });
    }));
    action('etape', () => { const s = z.querySelector('.ged-etape-saisie'); s.hidden = !s.hidden; });
    action('etape-ok', async () => {
      const code = etape.valeurCombo || 'VALIDATION';
      const commentaire = z.querySelector('[data-etape-commentaire]').value || null;
      const f = z.querySelector('[data-etape-fichier]').files[0];
      if (f) await this.fournisseur.nouvelleVersion(d.id, { fichier: f, genre: GENRES.ETAPE, etape: code, etat: code, commentaire });
      else await this.fournisseur.etape(d.id, { etape: code, etat: code, commentaire });
      this.message(`Étape « ${libelleEtape(code)} » enregistrée`, 'succes');
      await this.recharger({ arbre: false });
    });
    action('coffre', async () => {
      const motif = await saisir('Archivage au coffre-fort : le document sera verrouillé (ni modification ni suppression).\nMotif :', this.libelleCategorie(d.categorie) || 'Archivage');
      if (motif === null) return;
      await this.fournisseur.mettreAuCoffre(d.id, motif);
      this.message('Document archivé au coffre-fort', 'succes');
      await this.recharger({ arbre: false });
    });
    action('verifier', async () => {
      const r = await this.fournisseur.verifier(d.id);
      this.message(r.integre
        ? `✓ Intègre : empreinte recalculée identique${r.coffre ? (r.coffre.ok ? `, chaîne du coffre-fort valide (${r.coffre.entrees} entrées)` : ` — chaîne rompue : ${r.coffre.rupture?.raison}`) : ''}`
        : `✗ Altéré : empreinte attendue ${r.empreinte_attendue}, calculée ${r.empreinte_calculee}`, r.integre && r.coffre?.ok !== false ? 'succes' : 'erreur');
    });
    action('archiver', async () => {
      if (!await confirmer(`Archiver « ${d.titre} »${d.nb_pieces ? ' et ses pièces jointes' : ''} ? Le document sort des recherches actives ; il reste consultable avec le filtre 🗄 et restaurable.`)) return;
      const r = await this.fournisseur.archiver(d.id, 'Archivage manuel');
      this.message(`${r.archives} document${r.archives > 1 ? 's' : ''} archivé${r.archives > 1 ? 's' : ''}`, 'succes');
      this.selection = this.options.archives ? this.selection : null;
      await this.recharger({ arbre: false });
      if (!this.selection) this.#rendreVisuDossier();
    });
    action('desarchiver', async () => {
      await this.fournisseur.desarchiver(d.id);
      this.message('Document sorti de l\'archive', 'succes');
      await this.recharger({ arbre: false });
    });
    action('supprimer', async () => {
      if (!await confirmer(`Supprimer « ${d.titre} » ? Le document est masqué, il reste récupérable${d.nb_pieces ? ' (ses pièces jointes aussi)' : ''}.`)) return;
      await this.fournisseur.supprimer(d.id);
      this.message('Document supprimé (masqué)', 'succes');
      if (!this.options.supprimes) this.selection = null;
      await this.recharger({ arbre: false });
      if (!this.selection) this.#rendreVisuDossier();
    });
    action('restaurer', async () => { await this.fournisseur.restaurer(d.id); this.message('Document restauré', 'succes'); await this.recharger({ arbre: false }); });
    action('purger', async () => {
      if (!await confirmer(`Supprimer DÉFINITIVEMENT « ${d.titre} » et toutes ses versions ? Cette action est irréversible.`)) return;
      await this.fournisseur.purger(d.id);
      this.message('Document supprimé définitivement', 'succes');
      this.selection = null;
      await this.recharger({ arbre: false });
      this.#rendreVisuDossier();
    });
  }

  // ---------------------------------------------------------------- dock des informations

  #rendreDock(onglet) {
    const d = this.doc;
    const editions = versionsVisibles(d.versions);
    const historique = etapes(d.versions);
    const onglets = [
      ['infos', 'Informations'], ['versions', `Versions (${editions.length})`], ['historique', `Historique (${historique.length})`],
      ['derivations', `Dérivations (${d.derivations?.length ?? 0})`], ...(d.coffre ? [['coffre', 'Coffre-fort']] : []),
    ];
    if (!onglets.some(([k]) => k === onglet)) onglet = 'infos';
    this.dock.innerHTML = `<div class="ged-dock-onglets" role="tablist">
        ${onglets.map(([k, l]) => `<button type="button" role="tab" class="ged-onglet ${k === onglet ? 'actif' : ''}" aria-selected="${k === onglet}" data-onglet="${k}">${l}</button>`).join('')}
        <button type="button" class="ged-icone-bouton ged-dock-masquer" data-action="masquer-dock" data-bulle="Masquer le panneau" aria-label="Masquer le panneau">▾</button>
      </div><div class="ged-dock-corps" role="tabpanel"></div>`;
    this.dock.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => { this.#ecrirePrefs({ onglet: b.dataset.onglet }); this.#rendreDock(b.dataset.onglet); }));
    this.dock.querySelector('[data-action="masquer-dock"]').addEventListener('click', () => this.#basculerDock(false));
    const corps = this.dock.querySelector('.ged-dock-corps');
    ({ infos: () => this.#ongletInfos(corps), versions: () => this.#ongletVersions(corps, editions), historique: () => this.#ongletHistorique(corps, historique),
      derivations: () => this.#ongletDerivations(corps), coffre: () => this.#ongletCoffre(corps) })[onglet]();
  }

  #ongletInfos(z) {
    const d = this.doc;
    const editable = this.modifiable && !d.supprime && !d.archive;
    const lecture = !editable || d.coffre;
    const acces = editable && peutChangerAcces(d, this.#utilisateurCourant);
    const champ = (k, libelle, type = 'text', ro = lecture) => `<label>${libelle}<input type="${type}" data-m="${k}" value="${echapper(d[k] ?? '')}" ${ro ? 'readonly' : ''}></label>`;
    const tableau = (k, libelle, ro, aide = '') => `<label>${libelle}<input data-t="${k}" value="${echapper((d[k] ?? []).join(', '))}" ${ro ? 'readonly' : ''} placeholder="${aide}"></label>`;
    const r = d.retention;
    z.innerHTML = `
      <div class="ged-formulaire">
        ${champ('titre', 'Titre')}
        <label>Catégorie <span data-place="categorie"></span></label>
        ${champ('date_document', 'Date', 'date')}
        ${champ('auteur', 'Auteur')}
        <label>Confidentialité <span data-place="confidentialite"></span></label>
        ${tableau('acces_profils', 'Réservé aux profils', !acces, 'tous')}
        ${tableau('acces_utilisateurs', 'Réservé aux utilisateurs', !acces, 'tous')}
        ${tableau('mots_cles', 'Mots-clés', !editable, 'séparés par des virgules')}
        <label class="large">Résumé <textarea rows="2" data-m="resume" ${editable ? '' : 'readonly'} placeholder="Résumé du document">${echapper(d.resume ?? '')}</textarea></label>
        <label class="large">Notes <textarea rows="2" data-m="notes" ${editable ? '' : 'readonly'}>${echapper(d.notes ?? '')}</textarea></label>
        ${this.envoi ? `<label class="coche"><input type="checkbox" data-envoi-detail ${d.a_envoyer ? 'checked' : ''} ${editable ? '' : 'disabled'}> 📧 Pièce jointe à envoyer</label>` : ''}
        ${this.terrain ? `<label class="coche"><input type="checkbox" data-terrain-detail ${d.terrain ? 'checked' : ''} ${editable ? '' : 'disabled'}> 📱 Diffusée sur le terrain</label>` : ''}
      </div>
      <dl class="ged-proprietes">
        <dt>Élément lié</dt><dd>${echapper(d.type_element ? `${d.type_element} ${d.id_element}` : 'aucun')}${d.repertoire_id ? ' · classé dans un dossier' : ''}</dd>
        <dt>Indexation</dt><dd>${echapper(ETATS_INDEX[d.index_etat] ?? d.index_etat ?? '')}
          ${editable && this.fournisseur.indexer ? `<button type="button" class="ged-lien-bouton" data-action="indexer">réindexer</button>` : ''}
          ${d.extrait_texte ? `<details><summary>Texte extrait</summary><pre class="ged-extrait">${echapper(d.extrait_texte)}</pre></details>` : ''}</dd>
        ${d.classification?.regles?.length ? `<dt>Classement automatique</dt><dd>${d.classification.regles.length} règle${d.classification.regles.length > 1 ? 's' : ''} appliquée${d.classification.regles.length > 1 ? 's' : ''}
          ${d.classification.categorie ? ` · catégorie proposée : ${echapper(this.libelleCategorie(d.classification.categorie))}` : ''}</dd>` : ''}
        ${r ? `<dt>Rétention</dt><dd>${echapper(r.libelle ?? 'aucune règle')} · <b>${STATUTS_RETENTION[r.statut] ?? r.statut}</b>
          ${r.archiver_le ? ` · archivage le ${formatDate(r.archiver_le)}` : ''}${r.fin_le ? ` · fin de conservation le ${formatDate(r.fin_le)}` : ''}</dd>` : ''}
        ${d.archive ? `<dt>Archivé</dt><dd>le ${formatDateHeure(d.archive_le)}</dd>` : ''}
        <dt>Créé</dt><dd>le ${formatDateHeure(d.cree_le)} par ${echapper(d.cree_par ?? '')}${d.modifie_le ? ` · modifié le ${formatDateHeure(d.modifie_le)}` : ''} · ${d.nb_versions ?? d.versions.length} version(s) · ${d.nb_consultations ?? 0} consultation(s)</dd>
      </dl>`;
    const categorie = creerCombo({ options: (this.parametres.categories ?? []).map((c) => ({ valeur: c.code, libelle: c.libelle })), valeur: d.categorie ?? '', titre: 'Catégorie' });
    const confidentialite = creerCombo({ options: CONFIDENTIALITES.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: d.confidentialite ?? NIVEAU_CONFIDENTIALITE.INTERNE, vide: false, titre: 'Confidentialité' });
    categorie.readOnly = lecture;
    confidentialite.readOnly = !acces;
    z.querySelector('[data-place="categorie"]').replaceWith(categorie);
    z.querySelector('[data-place="confidentialite"]').replaceWith(confidentialite);
    categorie.addEventListener('change', () => this.#lancer(() => this.#modifier({ categorie: categorie.valeurCombo || null })));
    confidentialite.addEventListener('change', () => this.#lancer(() => this.#modifier({ confidentialite: confidentialite.valeurCombo })));
    z.querySelectorAll('[data-m]').forEach((el) => el.addEventListener('change', () => this.#lancer(() => this.#modifier({ [el.dataset.m]: el.value }))));
    z.querySelectorAll('[data-t]').forEach((el) => el.addEventListener('change', () => this.#lancer(() => this.#modifier({ [el.dataset.t]: el.value.split(',').map((x) => x.trim()).filter(Boolean) }))));
    z.querySelector('[data-envoi-detail]')?.addEventListener('change', (e) => this.#lancer(() => this.marquerEnvoi(d.id, e.target.checked)));
    z.querySelector('[data-terrain-detail]')?.addEventListener('change', (e) => this.#lancer(() => this.marquerTerrain(d.id, e.target.checked)));
    z.querySelector('[data-action="indexer"]')?.addEventListener('click', () => this.#lancer(async () => {
      this.doc = await this.fournisseur.indexer(d.id);
      this.message(ETATS_INDEX[this.doc.index_etat] ?? 'Indexé', this.doc.index_etat === 'ECHEC' ? 'erreur' : 'succes');
      this.#rendreDock('infos');
    }));
  }

  #ligneVersion(v, etape = false) {
    return `<tr${etape ? ` data-texte="${echapper(`${libelleEtape(v.etape)} ${v.etat ?? ''} ${v.auteur} ${formatDateHeure(v.date)} ${v.commentaire ?? ''}`.toLowerCase())}"` : ''}>
      <td>v${v.numero}</td><td>${formatDateHeure(v.date)}</td><td>${echapper(v.auteur)}</td>
      ${etape ? `<td><b>${echapper(libelleEtape(v.etape))}</b></td><td>${echapper(v.commentaire ?? '')}</td>` : `<td>${echapper(v.nom_fichier)}</td><td class="nombre">${formatTaille(v.taille)}</td>`}
      <td class="ged-versions-actions"><a href="${echapper(this.#lienContenu(v))}" download="${echapper(v.nom_fichier)}" data-bulle="Télécharger" aria-label="Télécharger">⬇</a>
        <a href="#" data-apercu="${v.id}" data-bulle="Aperçu" aria-label="Aperçu">👁</a></td></tr>`;
  }

  #lierApercus(z) {
    z.querySelectorAll('[data-apercu]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.#apercu(this.haut.querySelector('.ged-apercu'), this.doc.versions.find((v) => v.id === Number(a.dataset.apercu)));
    }));
  }

  #ongletVersions(z, editions) {
    z.innerHTML = `<table class="ged-versions">${editions.map((v) => this.#ligneVersion(v)).join('')}</table>
      <p class="aide">Les ${this.parametres.editions_conservees} dernières éditions sont conservées.</p>`;
    this.#lierApercus(z);
  }

  #ongletHistorique(z, historique) {
    z.innerHTML = `<input type="search" data-filtre-etapes placeholder="Rechercher une version antérieure (étape, état, auteur, date…)">
      <table class="ged-versions ged-etapes">${historique.map((v) => this.#ligneVersion(v, true)).join('') || '<tr><td class="aide">Aucune étape enregistrée.</td></tr>'}</table>`;
    z.querySelector('[data-filtre-etapes]').addEventListener('input', (e) => {
      const t = e.target.value.toLowerCase();
      z.querySelectorAll('.ged-etapes tr[data-texte]').forEach((tr) => { tr.hidden = !!t && !tr.dataset.texte.includes(t); });
    });
    this.#lierApercus(z);
  }

  #ongletDerivations(z) {
    const d = this.doc;
    const editable = this.modifiable && !d.supprime && !d.archive;
    const candidats = (this.documents ?? []).filter((x) => x.id !== d.id && !d.derivations?.some((l) => l.document.id === x.id));
    const libelle = (t) => TYPES_DERIVATION.find(([c]) => c === t)?.[1] ?? t;
    z.innerHTML = `
      <table class="ged-versions">${(d.derivations ?? []).map((l) => `<tr>
        <td>${l.sens === 'cible' ? '→' : '←'}</td><td><b>${echapper(libelle(l.type))}</b>${l.langue ? ` (${echapper(l.langue)})` : ''}</td>
        <td><a href="#" data-ouvrir="${l.document.id}">${icone(l.document)} ${echapper(l.document.titre)}</a></td><td>${echapper(l.commentaire ?? '')}</td>
        <td>${editable ? `<button type="button" class="ged-lien-bouton" data-retirer="${l.id}" aria-label="Retirer le lien">✕</button>` : ''}</td></tr>`).join('')
        || '<tr><td class="aide">Aucune dérivation : versions séparées, traductions, adaptations, extraits ou annotations de ce document.</td></tr>'}</table>
      ${editable && candidats.length ? `<div class="ged-ajout-derivation"><span>Ce document a pour</span><span data-place="type"></span>
        <span data-place="cible"></span><input data-langue placeholder="Langue (traduction)" size="10">
        <button type="button" data-action="deriver">Lier</button></div>` : ''}
      <p class="aide">→ : document dérivé de celui-ci ; ← : document dont celui-ci dérive.</p>`;
    z.querySelectorAll('[data-ouvrir]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.#lancer(() => this.selectionnerDocument(Number(a.dataset.ouvrir))); }));
    z.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => this.#lancer(async () => {
      await this.fournisseur.supprimerDerivation(Number(b.dataset.retirer));
      await this.selectionnerDocument(d.id);
    })));
    if (!z.querySelector('[data-action="deriver"]')) return;
    const type = creerCombo({ options: TYPES_DERIVATION.map(([valeur, l]) => ({ valeur, libelle: `${l.toLowerCase()}` })), valeur: 'TRADUCTION', vide: false, titre: 'Type de dérivation' });
    const cible = creerCombo({ options: candidats.map((x) => ({ valeur: x.id, libelle: x.titre, detail: x.version?.nom_fichier ?? '' })), titre: 'Document dérivé (dossier courant)' });
    z.querySelector('[data-place="type"]').replaceWith(type);
    z.querySelector('[data-place="cible"]').replaceWith(cible);
    z.querySelector('[data-action="deriver"]').addEventListener('click', () => this.#lancer(async () => {
      if (!cible.valeurCombo) { this.message('Choisissez le document dérivé', 'erreur'); return; }
      this.doc = await this.fournisseur.ajouterDerivation(d.id, { cible_id: Number(cible.valeurCombo), type: type.valeurCombo, langue: z.querySelector('[data-langue]').value || null });
      this.message('Dérivation enregistrée', 'succes');
      this.#rendreDock('derivations');
    }));
  }

  #ongletCoffre(z) {
    z.innerHTML = `<dl class="ged-coffre">${(this.doc.journal_coffre ?? []).map((e) => `
        <dt>Archivé le</dt><dd>${formatDateHeure(e.horodatage)} par ${echapper(e.utilisateur)}${e.motif ? ` · ${echapper(e.motif)}` : ''}</dd>
        <dt>Empreinte (SHA-256)</dt><dd><code>${e.empreinte_document}</code></dd>
        <dt>Entrée du journal</dt><dd><code>${e.empreinte_entree}</code></dd>`).join('')}</dl>`;
  }

  #apercu(zone, version) {
    rendreApercu(zone, {
      fournisseur: this.fournisseur, doc: this.doc, version, tailleMax: this.parametres.taille_apercu_max,
      urlTelechargement: version ? this.#lienContenu(version) : null,
    }).catch((e) => { zone.innerHTML = `<p class="erreur">Aperçu impossible : ${echapper(e.message)}</p>`; });
  }

  async #modifier(meta) {
    this.doc = await this.fournisseur.modifier(this.doc.id, meta);
    this.message('Informations enregistrées', 'succes');
    const deplace = 'categorie' in meta || 'titre' in meta || 'confidentialite' in meta || 'date_document' in meta || 'auteur' in meta;
    if (deplace) {
      this.cacheDocs.clear();
      await this.#chargerDossier();
      this.#rendreDetail();
    }
  }

  /** Marque (ou non) le document comme pièce jointe à envoyer. */
  async marquerEnvoi(id, valeur) {
    await this.fournisseur.modifier(id, { a_envoyer: valeur });
    for (const d of this.documents ?? []) if (d.id === id) d.a_envoyer = valeur;
    if (this.doc?.id === id) this.doc.a_envoyer = valeur;
    this.#rendreListe();
    this.message(valeur ? 'Pièce jointe à envoyer' : 'Pièce jointe retirée de l\'envoi', 'succes');
  }

  /** Diffuse (ou non) le document sur le terrain (application de terrain de l'élément lié). */
  async marquerTerrain(id, valeur) {
    await this.fournisseur.modifier(id, { terrain: valeur });
    for (const d of this.documents ?? []) if (d.id === id) d.terrain = valeur;
    if (this.doc?.id === id) this.doc.terrain = valeur;
    this.#rendreListe();
    this.message(valeur ? 'Pièce diffusée sur le terrain' : 'Pièce retirée du terrain', 'succes');
  }

  // ================================================================ administration

  async verifierCoffre() {
    const r = await this.fournisseur.verifierCoffre();
    this.message(r.ok ? `Coffre-fort intègre : ${r.entrees} entrée(s), chaîne valide` : `Coffre-fort : ${r.rupture.raison} à l'entrée ${r.rupture.index + 1}`, r.ok ? 'succes' : 'erreur');
  }

  /** Échéances de rétention : liste des documents à archiver, archivage sur confirmation. */
  async afficherRetention() {
    const dues = await this.fournisseur.echeances();
    if (!dues.length) { this.message('Aucun document à archiver', 'succes'); return; }
    this.resultats = { recherche: 'rétention échue', documents: dues.map((e) => e.document) };
    await this.#chargerDossier();
    if (await confirmer(`${dues.length} document${dues.length > 1 ? 's sont arrivés' : ' est arrivé'} à échéance de rétention. Les archiver maintenant ?`)) {
      const r = await this.fournisseur.appliquerRetention();
      this.message(`${r.archives} document${r.archives > 1 ? 's' : ''} archivé${r.archives > 1 ? 's' : ''}`, 'succes');
      this.resultats = null;
      await this.recharger();
    }
  }

  detruire() {
    libererApercu(this.haut.querySelector('.ged-apercu') ?? this.haut);
  }
}

export { htmlMail };
