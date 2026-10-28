import { ERREUR_LISTE } from './codes.js';
import { normaliserDefinition } from './modele.js';
import { filtrer, trier, lot, jusqua, comptesSegment, empreinte, filtresEffectifs } from './requete.js';

// Fournisseurs de données d'une liste. Même interface pour l'API et pour la mémoire (démo hors ligne, tests) :
//
//   themes()                      → [{ thl_code, thl_libelle, thl_icone, thl_ordre, thl_types: [{ code, libelle }], thl_actif }]
//   enregistrerTheme(theme)       supprimerTheme(code)    (profil ADMIN)
//   vues(contexte, theme)         → [{ vli_id, vli_nom, vli_contexte, vli_theme, vli_partage, vli_proprietaire, modifiable }]
//   vue(id)                       → { vli_id, vli_nom, vli_contexte, vli_partage, vli_groupe, vli_version, definition }
//   enregistrerVue(vue)           → vue enregistrée          supprimerVue(id)
//   sources()                     → [{ code, libelle, colonnes: [{ code, type, modifiable }], colonne_id, colonne_type, type_element, modifiable }]
//   colonnesRequete(sql)          → [{ code, type }]   (requête manuelle, profil ADMIN)
//   lot(demande)                  → { lignes, suite }  lignes : données + _id, _type, _h (empreinte)
//   segments(demande, colonne)    → [{ valeur, nombre }]
//   controle(demande, jusqua)     → [{ id, h }] lignes du filtre jusqu'au curseur, dans l'ordre
//   lignes(demande, ids)          → lignes du filtre parmi ces ID (absente = supprimée ou hors filtre)
//   modifier(demande, id, h, valeurs) → ligne relue après enregistrement ; erreur 409 LIGNE_MODIFIEE (details = ligne
//                                   actuelle) si l'empreinte h ne correspond plus (modifiée par ailleurs)
//
// demande = { vue_id, definition, recherche, segments: { colonne: [valeurs] }, tri: [{ colonne, sens }], apres, taille }

export class ErreurFournisseur extends Error {
  constructor(statut, code, message, details = null) {
    super(message);
    this.statut = statut;
    this.code = code;
    this.details = details;
  }
}

/** Fournisseur branché sur les routes du module (MapModuleListe côté serveur). */
export class FournisseurApi {
  constructor({ base = '/api/listes', entetes = {} } = {}) {
    this.base = base;
    this.entetes = { 'Content-Type': 'application/json', ...entetes };
  }

  async appel(methode, url, corps) {
    const r = await fetch(`${this.base}${url}`, { method: methode, headers: this.entetes, body: corps === undefined ? undefined : JSON.stringify(corps) });
    const texte = await r.text();
    const data = texte ? JSON.parse(texte) : null;
    if (!r.ok) throw new ErreurFournisseur(r.status, data?.code ?? 'HTTP', data?.title ?? r.statusText, data?.details ?? null);
    return data;
  }

  /** Corps envoyé : la définition sert pour une vue non enregistrée (concepteur) ; le serveur contrôle la source. */
  corps(demande, extra = {}) {
    const { vue_id = null, definition = null, recherche = '', segments = {}, tri = [] } = demande;
    return { vue_id, definition, recherche, segments, tri, ...extra };
  }

  themes() { return this.appel('GET', '/themes'); }
  enregistrerTheme(t) { return this.appel('PUT', `/themes/${encodeURIComponent(t.thl_code)}`, t); }
  supprimerTheme(code) { return this.appel('DELETE', `/themes/${encodeURIComponent(code)}`); }
  vues(contexte, theme) {
    const q = new URLSearchParams();
    if (contexte) q.set('contexte', contexte);
    if (theme) q.set('theme', theme);
    return this.appel('GET', `/vues${q.size ? `?${q}` : ''}`);
  }
  vue(id) { return this.appel('GET', `/vues/${id}`); }
  enregistrerVue(v) { return v.vli_id ? this.appel('PUT', `/vues/${v.vli_id}`, v) : this.appel('POST', '/vues', v); }
  supprimerVue(id) { return this.appel('DELETE', `/vues/${id}`); }
  sources() { return this.appel('GET', '/sources'); }
  colonnesRequete(requete) { return this.appel('POST', '/sources/requete', { requete }); }
  lot(d) { return this.appel('POST', '/lot', this.corps(d, { apres: d.apres ?? null, taille: d.taille ?? 100 })); }
  segments(d, colonne) { return this.appel('POST', '/segments', this.corps(d, { colonne })); }
  controle(d, curseur) { return this.appel('POST', '/controle', this.corps(d, { jusqua: curseur ?? null })); }
  lignes(d, ids) { return this.appel('POST', '/lignes', this.corps(d, { ids: ids.map(String) })); }
  modifier(d, id, h, valeurs) { return this.appel('POST', '/modifier', this.corps(d, { id: String(id), h, valeurs })); }
}

/**
 * Fournisseur en mémoire : mêmes règles que le serveur (requete.js). Sources : { code: { libelle, colonnes,
 * colonne_id, colonne_type, type_element, lignes } }. Les vues sont gardées en mémoire, et dans le
 * localStorage si `cleStockage` est fourni (démo hors ligne uniquement).
 */
export class FournisseurMemoire {
  constructor({ sources = {}, vues = [], themes = [], utilisateur = 'demo', cleStockage = null } = {}) {
    this.sourcesDonnees = sources;
    this.utilisateur = utilisateur;
    this.cleStockage = cleStockage;
    // Vues conservées dans le navigateur, complétées des vues par défaut apparues depuis.
    const stockees = this.#lireStockage();
    this.vuesStockees = stockees
      ? [...stockees, ...structuredClone(vues.filter((v) => !stockees.some((x) => x.vli_id === v.vli_id)))]
      : structuredClone(vues);
    this.prochainId = Math.max(0, ...this.vuesStockees.map((v) => v.vli_id)) + 1;
    const themesStockes = this.#lireStockage('.themes');
    this.themesStockes = themesStockes
      ? [...themesStockes, ...structuredClone(themes.filter((t) => !themesStockes.some((x) => x.thl_code === t.thl_code)))]
      : structuredClone(themes);
  }

  #lireStockage(suffixe = '') {
    if (!this.cleStockage) return null;
    try { return JSON.parse(localStorage.getItem(this.cleStockage + suffixe) ?? 'null'); } catch { return null; }
  }

  #ecrireStockage() {
    if (!this.cleStockage) return;
    try {
      localStorage.setItem(this.cleStockage, JSON.stringify(this.vuesStockees));
      localStorage.setItem(`${this.cleStockage}.themes`, JSON.stringify(this.themesStockes));
    } catch { /* stockage indisponible */ }
  }

  async themes() {
    return structuredClone(this.themesStockes.filter((t) => t.thl_actif !== false).sort((a, b) => (a.thl_ordre ?? 0) - (b.thl_ordre ?? 0) || a.thl_libelle.localeCompare(b.thl_libelle)));
  }

  async enregistrerTheme(t) {
    if (!t.thl_code?.trim() || !t.thl_libelle?.trim()) throw new ErreurFournisseur(422, 'THEME', 'Code et libellé du thème obligatoires');
    const i = this.themesStockes.findIndex((x) => x.thl_code === t.thl_code);
    if (i >= 0) this.themesStockes[i] = structuredClone(t); else this.themesStockes.push(structuredClone(t));
    this.#ecrireStockage();
    return structuredClone(t);
  }

  async supprimerTheme(code) {
    this.themesStockes = this.themesStockes.filter((t) => t.thl_code !== code);
    for (const v of this.vuesStockees) if (v.definition?.theme === code) { v.definition.theme = null; v.vli_theme = null; }
    this.#ecrireStockage();
  }

  /** Remplace les lignes d'une source (simulation des modifications d'autres utilisateurs). */
  modifierSource(code, f) {
    f(this.sourcesDonnees[code].lignes);
  }

  async vues(contexte, theme) {
    return this.vuesStockees
      .filter((v) => (!contexte || v.vli_contexte === contexte) && (!theme || (v.definition?.theme ?? null) === theme))
      .sort((a, b) => a.vli_nom.localeCompare(b.vli_nom))
      .map(({ vli_id, vli_nom, vli_contexte, vli_partage, vli_proprietaire, definition }) => ({
        vli_id, vli_nom, vli_contexte, vli_theme: definition?.theme ?? null, vli_partage, vli_proprietaire, modifiable: true,
      }));
  }

  async vue(id) {
    const v = this.vuesStockees.find((x) => x.vli_id === Number(id));
    if (!v) throw new ErreurFournisseur(404, 'INTROUVABLE', `Vue ${id} introuvable`);
    return structuredClone(v);
  }

  async enregistrerVue(v) {
    const copie = structuredClone(v);
    if (copie.vli_id) {
      const i = this.vuesStockees.findIndex((x) => x.vli_id === copie.vli_id);
      if (i < 0) throw new ErreurFournisseur(404, 'INTROUVABLE', `Vue ${copie.vli_id} introuvable`);
      copie.vli_version = (this.vuesStockees[i].vli_version ?? 1) + 1;
      this.vuesStockees[i] = copie;
    } else {
      copie.vli_id = this.prochainId++;
      copie.vli_version = 1;
      copie.vli_proprietaire = this.utilisateur;
      this.vuesStockees.push(copie);
    }
    this.#ecrireStockage();
    return structuredClone(copie);
  }

  async supprimerVue(id) {
    this.vuesStockees = this.vuesStockees.filter((v) => v.vli_id !== Number(id));
    this.#ecrireStockage();
  }

  async sources() {
    return Object.entries(this.sourcesDonnees).map(([code, s]) => ({
      code, libelle: s.libelle, colonnes: s.colonnes, colonne_id: s.colonne_id, colonne_type: s.colonne_type ?? null, type_element: s.type_element ?? null,
      modifiable: !!s.modifiable,
    }));
  }

  async colonnesRequete() {
    throw new ErreurFournisseur(501, ERREUR_LISTE.REQUETE_HORS_LIGNE, 'Requête manuelle indisponible hors ligne');
  }

  async #definition(d) {
    if (d.definition) return normaliserDefinition(d.definition);
    if (d.vue_id) return normaliserDefinition((await this.vue(d.vue_id)).definition);
    throw new ErreurFournisseur(422, 'VUE', 'Vue ou définition attendue');
  }

  /** Lignes de la source au format du serveur : colonnes de la vue + _id, _type, _h. */
  async #lignesSource(d) {
    const def = await this.#definition(d);
    if (def.source.mode !== 'vue') throw new ErreurFournisseur(501, ERREUR_LISTE.REQUETE_HORS_LIGNE, 'Requête manuelle indisponible hors ligne');
    const s = this.sourcesDonnees[def.source.vue];
    if (!s) throw new ErreurFournisseur(404, 'SOURCE', `Source ${def.source.vue} introuvable`);
    const connues = new Set(s.colonnes.map((c) => c.code));
    const codes = def.colonnes.filter((c) => !c.calcul && connues.has(c.code)).map((c) => c.code);
    // Colonnes de segment et de tri lues même si la vue ne les affiche pas (comme le WHERE / ORDER BY du serveur).
    const internes = [...Object.keys(d.segments ?? {}), ...def.segments.map((x) => x.colonne), ...(d.tri ?? []).map((t) => t.colonne),
      ...filtresEffectifs(def, connues).map((f) => f.colonne)]
      .filter((c) => connues.has(c) && !codes.includes(c));
    const segmentsVue = new Set(def.segments.map((x) => x.colonne));
    const colonneId = def.source.colonne_id ?? s.colonne_id;
    const colonneType = def.source.colonne_type ?? s.colonne_type;
    const typeConstant = def.source.type_element ?? s.type_element;
    const lignes = s.lignes.map((src) => {
      const l = {};
      for (const c of codes) l[c] = src[c] ?? null;
      l._id = src[colonneId];
      l._type = colonneType ? src[colonneType] : typeConstant;
      l._h = empreinte(l);
      // Colonnes des segments renvoyées (comptes sur les lignes chargées), les autres colonnes internes cachées.
      for (const c of internes) {
        if (segmentsVue.has(c)) l[c] = src[c] ?? null;
        else Object.defineProperty(l, c, { value: src[c] ?? null, enumerable: false });
      }
      return l;
    });
    const recherche = def.colonnes.filter((c) => !c.calcul && c.recherche && connues.has(c.code)).map((c) => c.code);
    const tri = (d.tri ?? []).filter((t) => connues.has(t.colonne));
    const filtres = filtresEffectifs(def, connues);
    const types = (this.themesStockes.find((t) => t.thl_code === def.theme)?.thl_types ?? []).map((t) => t.code);
    return { lignes, recherche, tri, filtres, types };
  }

  async lot(d) {
    const { lignes, recherche, tri, filtres, types } = await this.#lignesSource(d);
    return structuredClone(lot(trier(filtrer(lignes, { ...d, filtres, types }, recherche), tri), tri, d.apres ?? null, d.taille ?? 100));
  }

  async segments(d, colonne) {
    const { lignes, recherche, filtres, types } = await this.#lignesSource({ ...d, segments: { ...(d.segments ?? {}), [colonne]: d.segments?.[colonne] ?? [] } });
    // Comptes calculés sans le filtre du segment lui-même (les autres segments s'appliquent).
    const autres = { ...(d.segments ?? {}) };
    delete autres[colonne];
    return comptesSegment(filtrer(lignes, { ...d, segments: autres, filtres, types }, recherche), colonne);
  }

  async controle(d, curseur) {
    const { lignes, recherche, tri, filtres, types } = await this.#lignesSource(d);
    return jusqua(trier(filtrer(lignes, { ...d, filtres, types }, recherche), tri), tri, curseur).map((l) => ({ id: l._id, h: l._h }));
  }

  /**
   * Saisie dans la liste : mêmes contrôles que le serveur (source et colonnes modifiables, colonne saisissable dans
   * la vue, empreinte de la ligne inchangée), valeurs converties au type de la colonne.
   */
  async modifier(d, id, h, valeurs) {
    const def = await this.#definition(d);
    const s = this.sourcesDonnees[def.source.vue];
    if (def.source.mode !== 'vue' || !s?.modifiable) throw new ErreurFournisseur(422, 'SOURCE_LECTURE_SEULE', 'Cette source n\'est pas modifiable');
    for (const code of Object.keys(valeurs)) {
      const col = s.colonnes.find((c) => c.code === code);
      const vue = def.colonnes.find((c) => c.code === code && !c.calcul);
      if (!col?.modifiable || !vue?.modifiable) throw new ErreurFournisseur(422, 'COLONNE_NON_MODIFIABLE', `Colonne ${code} non modifiable`);
    }
    // Contrôle de l'application avant écriture (ex. fiche en cours de modification par un autre utilisateur).
    await this.verifierModification?.(def.source.vue, id, valeurs);
    const colonneId = def.source.colonne_id ?? s.colonne_id;
    const brute = s.lignes.find((l) => String(l[colonneId]) === String(id));
    if (!brute) throw new ErreurFournisseur(404, 'INTROUVABLE', `Ligne ${id} introuvable`);
    const actuelle = async () => (await this.#lignesSource({ definition: def })).lignes.find((l) => String(l._id) === String(id));
    const avant = await actuelle();
    if (h && avant._h !== h) throw new ErreurFournisseur(409, ERREUR_LISTE.LIGNE_MODIFIEE, 'La ligne a été modifiée par ailleurs : valeurs actualisées', structuredClone(avant));
    for (const [code, v] of Object.entries(valeurs)) {
      const type = s.colonnes.find((c) => c.code === code).type ?? '';
      if (v === null || v === undefined || v === '') brute[code] = null;
      else if (/bool/.test(type)) brute[code] = v === true || ['true', '1', 'vrai', 'oui'].includes(String(v).toLowerCase());
      else if (/int|numeric|decimal|real|double/.test(type)) {
        const n = Number(String(v).replace(',', '.'));
        if (Number.isNaN(n)) throw new ErreurFournisseur(422, 'VALEUR', `Valeur numérique invalide pour ${code} : ${v}`);
        brute[code] = /int/.test(type) ? Math.round(n) : n;
      } else brute[code] = String(v);
    }
    return structuredClone(await actuelle());
  }

  async lignes(d, ids) {
    const { lignes, recherche, filtres, types } = await this.#lignesSource(d);
    const voulus = new Set(ids.map(String));
    return structuredClone(filtrer(lignes.filter((l) => voulus.has(String(l._id))), { ...d, filtres, types }, recherche));
  }
}
