import { echapper } from '@logibtp/socle/ui';
import { ModeleVue, normaliserDefinition } from '../src/modele.js';
import { filtreActif, correspond, comparerValeurs, estNumerique } from '../src/filtres.js';
import { calculerLargeurs } from '../src/largeurs.js';
import { FormatsCellule, appliquerStyle, alignement } from './formats.js';
import { ouvrirMenuFiltre, fermerMenuFiltre } from './menu-filtre.js';
import { ConcepteurVue } from './concepteur.js';

const LARGEUR_COIN = 30;
const DELAI_RECHERCHE = 350;
const DUREE_MARQUE = 4000;

/**
 * Liste de données (classe mère) : chargement par lots au défilement, recherche « contient » et segments
 * appliqués par la base, tri (lignes chargées ou toute la base), filtres de colonnes façon tableur sur les
 * lignes chargées, rafraîchissement ciblé et contrôle périodique des lignes ajoutées, modifiées ou supprimées.
 *
 * Options : fournisseur (FournisseurApi / FournisseurMemoire), contexte (vues proposées), ouvrir({ id, type, ligne }),
 * message(texte, niveau), peutRequete (requête manuelle dans le concepteur), intervalleControle (ms, 0 = jamais),
 * formats (FormatsCellule ou dérivée), cleVue (clé localStorage de la dernière vue ouverte).
 */
export class ListeDonnees {
  constructor(racine, { fournisseur, contexte = null, ouvrir, message, peutRequete = false, intervalleControle = 30000, formats, cleVue } = {}) {
    this.racine = racine;
    this.fournisseur = fournisseur;
    this.contexte = contexte;
    this.ouvrirExterne = ouvrir;
    this.message = message ?? (() => {});
    this.peutRequete = peutRequete;
    this.formats = formats ?? new FormatsCellule();
    this.cleVue = cleVue ?? `logibtp.liste.${contexte ?? 'toutes'}`;
    this.vues = [];
    this.vue = null;               // vue courante : { vli_id, vli_nom, …, definition }
    this.nonEnregistree = false;   // définition appliquée depuis le concepteur, pas encore enregistrée
    this.modele = new ModeleVue({});
    this.recherche = '';
    this.segments = new Map();     // colonne → Set de valeurs (texte brut, null = vide)
    this.triBase = null;           // [{ colonne, sens }] envoyé au serveur, null = tri de la vue
    this.triLocal = null;          // { code, sens } sur les lignes chargées
    this.modeTriBase = false;      // bouton « Trier toute la base »
    this.filtres = new Map();      // code → filtre de colonne (lignes chargées)
    this.lignes = [];              // lignes chargées, dans l'ordre du serveur
    this.suite = null;             // curseur du lot suivant, null = tout est chargé
    this.enCours = false;
    this.generation = 0;
    this.marques = new Map();      // id → 'nouvelle' | 'modifiee'
    this.selection = null;
    this.#construire();
    if (intervalleControle > 0) {
      this.minuterie = setInterval(() => { if (this.visible()) this.verifier().catch(() => {}); }, intervalleControle);
      this.surFocus = () => { if (this.visible()) this.verifier().catch(() => {}); };
      window.addEventListener('focus', this.surFocus);
    }
  }

  detruire() {
    clearInterval(this.minuterie);
    window.removeEventListener('focus', this.surFocus);
    this.observateur?.disconnect();
    this.redim?.disconnect();
  }

  visible() { return this.racine.offsetParent !== null && document.visibilityState === 'visible'; }

  get definition() { return this.modele.definition; }

  // ---------------------------------------------------------------- construction

  #construire() {
    const r = this.racine;
    r.classList.add('liste');
    r.innerHTML = `
      <div class="liste-barre">
        <select class="liste-vues" title="Vue"></select>
        <button type="button" data-action="concevoir" title="Modifier la vue (mise en forme, colonnes, partage)">✎</button>
        <button type="button" data-action="nouvelle" title="Nouvelle vue">＋</button>
        <input type="search" class="liste-recherche" placeholder="Rechercher…" title="Contient, sans casse ni accents, sur toute la base">
        <span class="liste-compteur"></span>
        <button type="button" data-action="effacer" title="Effacer les filtres et le tri des colonnes" hidden>⨯ Filtres</button>
        <button type="button" data-action="tout" title="Charger toutes les lignes">⇊</button>
        <button type="button" data-action="rafraichir" title="Recharger depuis la base">⟳</button>
      </div>
      <div class="liste-segments" hidden></div>
      <p class="liste-erreurs" hidden></p>
      <div class="liste-zone" tabindex="0">
        <table class="liste-table"><colgroup></colgroup><thead></thead><tbody></tbody></table>
        <div class="liste-suite"></div>
      </div>`;
    this.zone = r.querySelector('.liste-zone');
    this.table = r.querySelector('.liste-table');
    this.corps = this.table.tBodies[0];
    this.basSuite = r.querySelector('.liste-suite');
    r.querySelector('.liste-vues').addEventListener('change', (e) => this.ouvrirVue(Number(e.target.value)).catch((x) => this.#erreur(x)));
    r.querySelector('[data-action="concevoir"]').addEventListener('click', () => this.concevoir(false));
    r.querySelector('[data-action="nouvelle"]').addEventListener('click', () => this.concevoir(true));
    r.querySelector('[data-action="rafraichir"]').addEventListener('click', () => this.recharger());
    r.querySelector('[data-action="tout"]').addEventListener('click', () => this.toutCharger().catch((x) => this.#erreur(x)));
    r.querySelector('[data-action="effacer"]').addEventListener('click', () => {
      this.filtres.clear();
      this.triLocal = null;
      this.#rendreEntete();
      this.rendreCorps();
    });
    const recherche = r.querySelector('.liste-recherche');
    recherche.addEventListener('input', () => {
      clearTimeout(this.minuterieRecherche);
      this.minuterieRecherche = setTimeout(() => {
        this.recherche = recherche.value.trim();
        this.recharger();
        this.rafraichirSegments();
      }, DELAI_RECHERCHE);
    });
    this.corps.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) this.#selectionner(tr.dataset.id);
    });
    this.corps.addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) this.ouvrir(tr.dataset.id);
    });
    this.zone.addEventListener('keydown', (e) => this.#clavier(e));
    this.observateur = new IntersectionObserver((entrees) => {
      if (entrees.some((x) => x.isIntersecting)) this.chargerSuite().catch((x) => this.#erreur(x));
    }, { root: this.zone, rootMargin: '300px' });
    this.observateur.observe(this.basSuite);
    this.redim = new ResizeObserver(() => this.#largeurs());
    this.redim.observe(this.zone);
  }

  #erreur(e) {
    console.error(e);
    this.message(e.message ?? String(e), 'erreur');
  }

  // ---------------------------------------------------------------- vues

  /** Charge la liste des vues et ouvre la vue demandée, la dernière utilisée ou la première. */
  async demarrer(vueId = null) {
    await this.chargerVues();
    let id = vueId;
    if (id === null) { try { id = Number(localStorage.getItem(this.cleVue)) || null; } catch { id = null; } }
    if (!this.vues.some((v) => v.vli_id === id)) id = this.vues[0]?.vli_id ?? null;
    if (id !== null) await this.ouvrirVue(id);
  }

  async chargerVues() {
    this.vues = await this.fournisseur.vues(this.contexte);
    const partage = { P: 'personnelle', G: 'groupe', T: 'tous' };
    this.racine.querySelector('.liste-vues').innerHTML = this.vues.map((v) =>
      `<option value="${v.vli_id}" title="Vue ${partage[v.vli_partage] ?? ''} de ${echapper(v.vli_proprietaire ?? '')}">${echapper(v.vli_nom)}</option>`).join('');
    if (this.vue?.vli_id) this.racine.querySelector('.liste-vues').value = String(this.vue.vli_id);
  }

  async ouvrirVue(id) {
    const vue = await this.fournisseur.vue(id);
    try { localStorage.setItem(this.cleVue, String(id)); } catch { /* préférence non conservée */ }
    this.racine.querySelector('.liste-vues').value = String(id);
    this.appliquerVue(vue, { nonEnregistree: false });
  }

  /** Applique une vue (enregistrée ou issue du concepteur) : en-têtes, segments, rechargement. */
  appliquerVue(vue, { nonEnregistree = false } = {}) {
    this.vue = { ...vue, definition: normaliserDefinition(vue.definition) };
    this.nonEnregistree = nonEnregistree;
    this.modele = new ModeleVue(this.vue.definition);
    const codes = new Set(this.modele.colonnes.map((c) => c.code));
    for (const k of [...this.filtres.keys()]) if (!codes.has(k)) this.filtres.delete(k);
    const segs = new Set(this.definition.segments.map((s) => s.colonne));
    for (const k of [...this.segments.keys()]) if (!segs.has(k)) this.segments.delete(k);
    this.triBase = null;
    this.triLocal = null;
    const erreurs = [...this.modele.erreurs].map(([code, m]) => `${this.modele.parCode.get(code)?.titre ?? code} : ${m}`);
    const zoneErreurs = this.racine.querySelector('.liste-erreurs');
    zoneErreurs.hidden = !erreurs.length;
    zoneErreurs.textContent = erreurs.join(' · ');
    this.racine.classList.toggle('liste-simple', this.definition.lignes === 'simple');
    this.#rendreEntete();
    this.recharger();
    this.rafraichirSegments();
  }

  concevoir(nouvelle) {
    fermerMenuFiltre();
    const base = nouvelle || !this.vue
      ? { vli_id: null, vli_nom: 'Nouvelle vue', vli_contexte: this.contexte, vli_partage: 'P', vli_groupe: null,
        definition: nouvelle && this.vue ? structuredClone(this.vue.definition) : normaliserDefinition({}) }
      : structuredClone(this.vue);
    this.concepteur = new ConcepteurVue({
      fournisseur: this.fournisseur,
      vue: base,
      peutRequete: this.peutRequete,
      appliquer: (v) => this.appliquerVue(v, { nonEnregistree: true }),
      enregistrer: async (v) => {
        const enregistree = await this.fournisseur.enregistrerVue(v);
        await this.chargerVues();
        try { localStorage.setItem(this.cleVue, String(enregistree.vli_id)); } catch { /* préférence non conservée */ }
        this.appliquerVue(enregistree, { nonEnregistree: false });
        this.racine.querySelector('.liste-vues').value = String(enregistree.vli_id);
        this.message(`Vue « ${enregistree.vli_nom} » enregistrée`, 'succes');
        return enregistree;
      },
      supprimer: async (v) => {
        await this.fournisseur.supprimerVue(v.vli_id);
        this.vue = null;
        await this.demarrer();
        this.message(`Vue « ${v.vli_nom} » supprimée`, 'succes');
      },
      message: this.message,
    });
  }

  // ---------------------------------------------------------------- demandes au fournisseur

  demande() {
    const segments = {};
    for (const [col, valeurs] of this.segments) if (valeurs.size) segments[col] = [...valeurs];
    return {
      vue_id: this.vue?.vli_id ?? null,
      definition: this.nonEnregistree || !this.vue?.vli_id ? this.definition : null,
      recherche: this.recherche,
      segments,
      tri: this.triBase ?? this.definition.tri,
    };
  }

  /** Recharge la liste depuis le début (recherche, segments ou tri de la base modifiés). */
  recharger() {
    this.generation++;
    this.lignes = [];
    this.suite = null;
    this.fin = false;
    this.enCours = false;
    this.marques.clear();
    this.rendreCorps();
    if (!this.vue) return;
    this.chargerSuite().catch((e) => this.#erreur(e));
  }

  async chargerSuite() {
    if (!this.vue || this.enCours || this.fin) return;
    this.enCours = true;
    const gen = this.generation;
    this.#rendreSuite();
    try {
      const r = await this.fournisseur.lot({ ...this.demande(), apres: this.suite, taille: this.definition.taille_lot });
      if (gen !== this.generation) return;
      this.lignes.push(...r.lignes);
      this.suite = r.suite;
      this.fin = !r.suite;
      this.#ajouterAuCorps(r.lignes);
    } finally {
      if (gen === this.generation) {
        this.enCours = false;
        this.#rendreSuite();
      }
    }
    // Zone visible mais pas encore remplie : lot suivant sans attendre le défilement.
    if (gen === this.generation && !this.fin && this.zone.clientHeight > 0 && this.zone.scrollHeight <= this.zone.clientHeight + 300) await this.chargerSuite();
  }

  async toutCharger() {
    let n = 0;
    while (!this.fin && this.vue && n++ < 1000) {
      if (this.enCours) { await new Promise((ok) => setTimeout(ok, 50)); continue; }
      await this.chargerSuite();
    }
  }

  /**
   * Contrôle des lignes chargées : lignes ajoutées, modifiées (empreinte) ou sorties du filtre depuis le
   * chargement, jusqu'au curseur du dernier lot. Les lignes concernées sont relues, l'ordre est celui de la base.
   */
  async verifier() {
    if (!this.vue || this.enCours) return null;
    const gen = this.generation;
    const etat = await this.fournisseur.controle(this.demande(), this.fin ? null : this.suite);
    if (gen !== this.generation) return null;
    const connues = new Map(this.lignes.map((l) => [String(l._id), l]));
    const presents = new Set(etat.map((x) => String(x.id)));
    const aLire = etat.filter((x) => connues.get(String(x.id))?._h !== x.h).map((x) => String(x.id));
    const supprimees = this.lignes.filter((l) => !presents.has(String(l._id))).length;
    if (!aLire.length && !supprimees) return { ajoutees: 0, modifiees: 0, supprimees: 0 };
    const relues = new Map();
    for (let i = 0; i < aLire.length; i += 500) {
      for (const l of await this.fournisseur.lignes(this.demande(), aLire.slice(i, i + 500))) relues.set(String(l._id), l);
    }
    if (gen !== this.generation) return null;
    let ajoutees = 0, modifiees = 0;
    for (const id of relues.keys()) {
      this.marques.set(id, connues.has(id) ? 'modifiee' : 'nouvelle');
      if (connues.has(id)) modifiees++; else ajoutees++;
    }
    this.lignes = etat.map((x) => relues.get(String(x.id)) ?? connues.get(String(x.id))).filter(Boolean);
    this.rendreCorps();
    this.#effacerMarques();
    return { ajoutees, modifiees, supprimees };
  }

  /** Rafraîchissement ciblé après une modification connue (enregistrement d'une fiche…). */
  async rafraichirLignes(ids) {
    if (!this.vue || !ids.length) return;
    const voulus = ids.map(String);
    const relues = new Map((await this.fournisseur.lignes(this.demande(), voulus)).map((l) => [String(l._id), l]));
    let inconnue = false;
    for (const id of voulus) {
      const i = this.lignes.findIndex((l) => String(l._id) === id);
      if (i < 0) { inconnue ||= relues.has(id); continue; }
      if (relues.has(id)) { this.lignes[i] = relues.get(id); this.marques.set(id, 'modifiee'); }
      else this.lignes.splice(i, 1);
    }
    this.rendreCorps();
    this.#effacerMarques();
    // Ligne nouvelle ou déplacée par le tri : sa place est donnée par le contrôle complet.
    if (inconnue) await this.verifier();
  }

  #effacerMarques() {
    clearTimeout(this.minuterieMarques);
    this.minuterieMarques = setTimeout(() => {
      this.marques.clear();
      this.corps.querySelectorAll('tr.nouvelle, tr.modifiee').forEach((tr) => tr.classList.remove('nouvelle', 'modifiee'));
    }, DUREE_MARQUE);
  }

  // ---------------------------------------------------------------- segments

  async rafraichirSegments() {
    const zone = this.racine.querySelector('.liste-segments');
    const segs = this.definition.segments;
    zone.hidden = !segs.length;
    if (!segs.length || !this.vue) { zone.replaceChildren(); return; }
    const gen = this.generation;
    const comptes = await Promise.all(segs.map((s) => this.fournisseur.segments(this.demande(), s.colonne).catch(() => [])));
    if (gen !== this.generation) return;
    zone.innerHTML = segs.map((s, i) => {
      const col = this.modele.parCode.get(s.colonne);
      const actives = this.segments.get(s.colonne) ?? new Set();
      const titre = s.titre || col?.titre || s.colonne;
      return `<div class="segment" data-segment="${echapper(s.colonne)}">
        <span class="segment-titre">${echapper(titre.replace(/\n/g, ' '))}</span>
        <button type="button" data-tout class="${actives.size ? '' : 'actif'}">Tous</button>
        ${comptes[i].map((c) => {
          const libelle = c.valeur === null ? '(vide)' : col ? this.modele.texte(c.valeur, col) || c.valeur : c.valeur;
          return `<button type="button" data-valeur="${c.valeur === null ? '' : echapper(c.valeur)}" data-vide="${c.valeur === null}"
            class="${actives.has(c.valeur) ? 'actif' : ''}">${echapper(libelle)} <small>${c.nombre}</small></button>`;
        }).join('')}
        ${[...actives].filter((v) => !comptes[i].some((c) => c.valeur === v)).map((v) =>
          `<button type="button" class="actif" data-valeur="${echapper(v ?? '')}" data-vide="${v === null}">${echapper(v ?? '(vide)')} <small>0</small></button>`).join('')}
      </div>`;
    }).join('');
    zone.querySelectorAll('[data-segment]').forEach((div) => {
      const col = div.dataset.segment;
      div.querySelector('[data-tout]').addEventListener('click', () => { this.segments.delete(col); this.#segmentsModifies(); });
      div.querySelectorAll('[data-valeur]').forEach((b) => b.addEventListener('click', (e) => {
        const v = b.dataset.vide === 'true' ? null : b.dataset.valeur;
        const actives = new Set(this.segments.get(col) ?? []);
        // Clic : sélection unique ; Ctrl/Maj + clic : sélection multiple.
        if (e.ctrlKey || e.metaKey || e.shiftKey) { if (actives.has(v)) actives.delete(v); else actives.add(v); }
        else if (actives.size === 1 && actives.has(v)) actives.clear();
        else { actives.clear(); actives.add(v); }
        this.segments.set(col, actives);
        this.#segmentsModifies();
      }));
    });
  }

  #segmentsModifies() {
    this.recharger();
    this.rafraichirSegments();
  }

  // ---------------------------------------------------------------- en-têtes, tri, filtres

  #rendreEntete() {
    const visibles = this.modele.visibles;
    const thead = this.table.tHead;
    const tr = document.createElement('tr');
    const coin = document.createElement('th');
    coin.className = 'liste-coin';
    coin.innerHTML = `<button type="button" class="${this.modeTriBase ? 'actif' : ''}" title="${this.modeTriBase
      ? 'Tri sur toute la base : un clic sur un en-tête recharge la liste dans cet ordre'
      : 'Trier toute la base (sinon le tri porte sur les lignes chargées)'}">⇅</button>`;
    coin.querySelector('button').addEventListener('click', () => {
      this.modeTriBase = !this.modeTriBase;
      this.#rendreEntete();
      this.message(this.modeTriBase ? 'Tri sur toute la base' : 'Tri sur les lignes chargées');
    });
    tr.append(coin);
    for (const c of visibles) {
      const th = document.createElement('th');
      th.dataset.code = c.code;
      th.className = `aligne-${alignement(c)}`;
      if (c.bulle) th.title = c.bulle;
      const triB = (this.triBase ?? []).find((t) => t.colonne === c.code);
      const triL = this.triLocal?.code === c.code ? this.triLocal : null;
      const sens = triL?.sens ?? triB?.sens ?? null;
      const actif = filtreActif(this.filtres.get(c.code));
      th.innerHTML = `<div class="liste-th">
        <span class="liste-th-titre">${echapper(c.titre ?? c.code)}</span>
        <span class="liste-th-boutons">
          <button type="button" data-tri class="${sens ? 'actif' : ''} ${triB ? 'base' : ''}" title="${triB ? 'Trié sur toute la base' : triL ? 'Trié sur les lignes chargées' : 'Trier'}">${sens === 'asc' ? '▲' : sens === 'desc' ? '▼' : '⇵'}</button>
          <button type="button" data-filtre class="${actif ? 'actif' : ''}" title="Filtrer les lignes chargées">${actif ? '⧩' : '▾'}</button>
        </span></div>`;
      th.querySelector('[data-tri]').addEventListener('click', () => this.#clicTri(c, sens));
      th.querySelector('[data-filtre]').addEventListener('click', (e) => this.#menu(c, e.currentTarget));
      tr.append(th);
    }
    thead.replaceChildren(tr);
    const filtres = [...this.filtres.values()].some(filtreActif);
    this.racine.querySelector('[data-action="effacer"]').hidden = !filtres && !this.triLocal;
    this.#largeurs();
  }

  #clicTri(colonne, sens) {
    const suivant = sens === null ? 'asc' : sens === 'asc' ? 'desc' : null;
    if (this.modeTriBase) this.trier(colonne.code, suivant, true);
    else this.trier(colonne.code, suivant, false);
  }

  /** Tri d'une colonne : sur les lignes chargées, ou sur toute la base (rechargement). */
  trier(code, sens, base) {
    const c = this.modele.parCode.get(code);
    if (base && c?.calcul) {
      this.message('Colonne calculée : tri des lignes chargées uniquement', 'avertissement');
      base = false;
    }
    if (base) {
      this.triLocal = null;
      this.triBase = sens ? [{ colonne: code, sens }] : null;
      this.#rendreEntete();
      this.recharger();
      return;
    }
    this.triLocal = sens ? { code, sens } : null;
    this.#rendreEntete();
    this.rendreCorps();
  }

  #menu(colonne, ancre) {
    ouvrirMenuFiltre({
      ancre, colonne, modele: this.modele, lignes: this.lignes, filtre: this.filtres.get(colonne.code),
      appliquer: (f) => {
        if (f) this.filtres.set(colonne.code, f); else this.filtres.delete(colonne.code);
        this.#rendreEntete();
        this.rendreCorps();
      },
      trier: (sens, base) => this.trier(colonne.code, sens, base),
    });
  }

  // ---------------------------------------------------------------- corps

  #cellule(ligne, c) {
    return { valeur: this.modele.valeur(ligne, c.code), texte: this.modele.texteCellule(ligne, c), style: this.modele.style(ligne, c.code) };
  }

  /** Lignes affichées : lignes chargées filtrées par les filtres de colonnes, triées localement si demandé. */
  lignesAffichees(lignes = this.lignes) {
    const actifs = [...this.filtres].filter(([, f]) => filtreActif(f)).map(([code, f]) => [this.modele.parCode.get(code), f]).filter(([c]) => c);
    let res = actifs.length ? lignes.filter((l) => actifs.every(([c, f]) => correspond(f, this.#cellule(l, c), c))) : lignes;
    if (this.triLocal && lignes === this.lignes) {
      const c = this.modele.parCode.get(this.triLocal.code);
      if (c) {
        const s = this.triLocal.sens === 'desc' ? -1 : 1;
        const num = estNumerique(c);
        res = [...res].sort((a, b) => {
          const va = this.modele.valeur(a, c.code), vb = this.modele.valeur(b, c.code);
          const vide = (v) => v === null || v === undefined || v === '';
          if (vide(va) || vide(vb)) return comparerValeurs(va, vb, num); // vides en dernier
          return s * comparerValeurs(va, vb, num);
        });
      }
    }
    return res;
  }

  #ligneDom(ligne, visibles) {
    const tr = document.createElement('tr');
    const id = String(ligne._id);
    tr.dataset.id = id;
    const marque = this.marques.get(id);
    if (marque) tr.classList.add(marque);
    if (this.selection === id) tr.classList.add('selectionnee');
    const coin = document.createElement('td');
    coin.className = 'liste-coin';
    tr.append(coin);
    for (const c of visibles) {
      const td = document.createElement('td');
      td.className = `aligne-${alignement(c)}`;
      const valeur = this.modele.valeur(ligne, c.code);
      const contenu = this.formats.contenu(valeur, c, this.modele);
      if (contenu instanceof Node) td.append(contenu); else td.textContent = contenu ?? '';
      appliquerStyle(td, this.modele.style(ligne, c.code));
      if (this.definition.lignes === 'simple' && typeof contenu === 'string' && contenu.length > 20) td.title = contenu;
      tr.append(td);
    }
    return tr;
  }

  rendreCorps() {
    const visibles = this.modele.visibles;
    const f = document.createDocumentFragment();
    const affichees = this.lignesAffichees();
    for (const l of affichees) f.append(this.#ligneDom(l, visibles));
    this.corps.replaceChildren(f);
    this.#compteur(affichees.length);
    this.#rendreSuite();
  }

  /** Nouveau lot : ajouté en fin de tableau, sauf tri local actif (le tableau est alors retrié). */
  #ajouterAuCorps(nouvelles) {
    if (this.triLocal) { this.rendreCorps(); return; }
    const visibles = this.modele.visibles;
    const f = document.createDocumentFragment();
    for (const l of this.lignesAffichees(nouvelles)) f.append(this.#ligneDom(l, visibles));
    this.corps.append(f);
    this.#compteur(this.corps.rows.length);
  }

  #compteur(affichees) {
    const charge = `${this.lignes.length}${this.fin ? '' : '+'}`;
    this.racine.querySelector('.liste-compteur').textContent = affichees === this.lignes.length
      ? `${charge} ligne${this.lignes.length > 1 ? 's' : ''}`
      : `${affichees} / ${charge} chargées`;
  }

  #rendreSuite() {
    const b = this.basSuite;
    if (!this.vue) { b.textContent = 'Aucune vue'; return; }
    if (this.enCours) b.innerHTML = '<span class="liste-attente">Chargement…</span>';
    else if (!this.fin) {
      b.innerHTML = '<button type="button">Charger la suite</button>';
      b.querySelector('button').addEventListener('click', () => this.chargerSuite().catch((e) => this.#erreur(e)));
    } else b.textContent = this.lignes.length ? `Fin de la liste · ${this.lignes.length} ligne${this.lignes.length > 1 ? 's' : ''}` : 'Aucune ligne';
  }

  #largeurs() {
    const visibles = this.modele.visibles;
    const dispo = Math.max(this.zone.clientWidth - LARGEUR_COIN - 2, 200);
    const largeurs = calculerLargeurs(visibles, dispo);
    const cg = this.table.querySelector('colgroup');
    cg.innerHTML = `<col style="width:${LARGEUR_COIN}px">${largeurs.map((l) => `<col style="width:${l}px">`).join('')}`;
    this.table.style.width = `${LARGEUR_COIN + largeurs.reduce((s, l) => s + l, 0)}px`;
  }

  // ---------------------------------------------------------------- sélection, ouverture

  #selectionner(id) {
    this.selection = id;
    this.corps.querySelectorAll('tr.selectionnee').forEach((tr) => tr.classList.remove('selectionnee'));
    const tr = this.corps.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    tr?.classList.add('selectionnee');
    tr?.scrollIntoView({ block: 'nearest' });
  }

  #clavier(e) {
    if (e.target !== this.zone) return;
    const lignes = [...this.corps.rows];
    const i = lignes.findIndex((tr) => tr.dataset.id === this.selection);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), lignes.length - 1);
      if (lignes[j]) this.#selectionner(lignes[j].dataset.id);
    } else if (e.key === 'Enter' && this.selection) {
      e.preventDefault();
      this.ouvrir(this.selection);
    }
  }

  /** Ouvre la fiche de la ligne : l'ID et le type d'élément sont fournis par la source. */
  ouvrir(id) {
    const ligne = this.lignes.find((l) => String(l._id) === String(id));
    if (ligne) this.ouvrirExterne?.({ id: ligne._id, type: ligne._type, ligne });
  }
}
