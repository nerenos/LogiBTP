import { calculerElement } from './calcul.js';
import { texteBrut } from '@logibtp/socle';

// Fournisseurs du module Bibliothèque. Même interface pour l'API (routes MapModuleBibliotheque) et pour la mémoire
// (démo hors ligne, tests) :
//   parametres() / enregistrerParametres(p)              { scenario_defaut, scenarios_autorises, coef_fg_defaut, coef_benef_defaut }
//   bibliotheques() / enregistrerBibliotheque(b) / supprimerBibliotheque(id)        [{ id, code, libelle, defaut, actif, ordre }]
//   familles(bibId) / enregistrerFamille(f) / supprimerFamille(id)                  [{ id, bib_id, parent_id, code, libelle, ordre, chemin, niveau }]
//   regroupements() / enregistrerRegroupement(r) / supprimerRegroupement(code)      [{ code, libelle, ordre }]
//   natures() / enregistrerNature(n) / supprimerNature(id)                          [{ id, code, libelle, regroupement, axe_analytique, compte_achat, compte_vente, actif }]
//   unites()                                              [{ unt_code, unt_libelle }]
//   tarifs(eleId) / enregistrerTarif(eleId, t) / supprimerTarif(eleId, id)  → { tarifs, prix }  (prix de l'élément recalculé)
//   historique(eleId)                                     [{ id, date, auteur, commentaire, avant, apres }]
//   rechercher({ recherche, bib, type })                  [{ id, bib_code, code, type, libelle, libelle_html, unite_stock, pa, pr, pv, pv_net, coef_fg, coef_benef }]

export class ErreurBibliotheque extends Error {
  constructor(statut, code, message) {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

export class FournisseurBibliothequeApi {
  constructor({ base = '/api/bibliotheque', entetes = {} } = {}) {
    this.base = base;
    this.entetes = { 'Content-Type': 'application/json', ...entetes };
  }

  async appel(methode, url, corps) {
    const r = await fetch(`${this.base}${url}`, { method: methode, headers: this.entetes, body: corps === undefined ? undefined : JSON.stringify(corps) });
    const texte = await r.text();
    const data = texte ? JSON.parse(texte) : null;
    if (!r.ok) throw new ErreurBibliotheque(r.status, data?.code ?? 'HTTP', data?.title ?? r.statusText);
    return data;
  }

  parametres() { return this.appel('GET', '/parametres'); }
  enregistrerParametres(p) { return this.appel('PUT', '/parametres', p); }
  bibliotheques() { return this.appel('GET', '/bibliotheques'); }
  enregistrerBibliotheque(b) { return this.appel('PUT', '/bibliotheques', { id: 0, ordre: 0, actif: true, defaut: false, ...b }); }
  supprimerBibliotheque(id) { return this.appel('DELETE', `/bibliotheques/${id}`); }
  familles(bibId) { return this.appel('GET', `/familles${bibId ? `?bib=${bibId}` : ''}`); }
  enregistrerFamille(f) { return this.appel('PUT', '/familles', { id: 0, ordre: 0, parent_id: null, chemin: '', niveau: 0, ...f }); }
  supprimerFamille(id) { return this.appel('DELETE', `/familles/${id}`); }
  regroupements() { return this.appel('GET', '/regroupements'); }
  enregistrerRegroupement(r) { return this.appel('PUT', '/regroupements', { ordre: 0, ...r }); }
  supprimerRegroupement(code) { return this.appel('DELETE', `/regroupements/${encodeURIComponent(code)}`); }
  natures() { return this.appel('GET', '/natures'); }
  enregistrerNature(n) { return this.appel('PUT', '/natures', { id: 0, actif: true, ...n }); }
  supprimerNature(id) { return this.appel('DELETE', `/natures/${id}`); }
  async unites() {
    const r = await fetch('/api/unites', { headers: this.entetes });
    return r.ok ? r.json() : [];
  }
  tarifs(eleId) { return this.appel('GET', `/elements/${eleId}/tarifs`); }
  enregistrerTarif(eleId, t) { return this.appel('POST', `/elements/${eleId}/tarifs`, { id: 0, principal: false, maj_le: new Date().toISOString(), ...t }); }
  supprimerTarif(eleId, id) { return this.appel('DELETE', `/elements/${eleId}/tarifs/${id}`); }
  historique(eleId) { return this.appel('GET', `/elements/${eleId}/historique`); }
  rechercher({ recherche = '', bib = null, type = null } = {}) {
    const q = new URLSearchParams(Object.entries({ recherche, bib, type }).filter(([, v]) => v !== null && v !== '').map(([k, v]) => [k, String(v)]));
    return this.appel('GET', `/elements${q.size ? `?${q}` : ''}`);
  }
}

export const SCENARIOS_TOUS = ['FIXE', 'FOURNISSEUR_PRINCIPAL', 'DERNIER_PA', 'MEILLEUR_MIN', 'MEILLEUR_MAX', 'PMP'];

/** Données techniques de l'élément (par unité de stock ; dimensions en mm), utilisables dans les formules d'unités. */
export const DONNEES_TECHNIQUES = [
  ['poids', 'Poids (kg)'], ['surface', 'Surface (m²)'], ['surface_peinture', 'Surface à peindre (m²)'], ['volume', 'Volume (m³)'],
  ['hauteur', 'Hauteur (mm)'], ['largeur', 'Largeur (mm)'], ['epaisseur', 'Épaisseur (mm)'],
  ['isolant_r', 'Résistance thermique R'], ['isolant_lambda', 'Conductivité λ'], ['isolant_u', 'Coefficient U'],
];

const CHAMPS_PRIX = ['scenario', 'pa', 'coef_fg', 'pr', 'coef_benef', 'pv', 'pv_fixe', 'coef_remise', 'pv_net'];

/** Entrée du calcul depuis une ligne d'élément (codes de champs de la fiche et de la liste). */
export function entreeDepuisLigne(l, tarifs = []) {
  const json = (v, defaut) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return defaut; } })() : v ?? defaut);
  return {
    unite_stock: l.unite_stock, unites: json(l.unites, []),
    // Données des formules : champs supplémentaires puis données techniques de la fiche.
    donnees: { ...json(l.proprietes, {}), ...Object.fromEntries(DONNEES_TECHNIQUES.map(([c]) => [c, l[c]]).filter(([, v]) => v !== null && v !== undefined && v !== '')) },
    scenario: l.scenario_pa, pa_fixe: l.pa_fixe, dernier_pa: l.dernier_pa, pmp: l.pmp,
    tarifs: tarifs.map((t) => ({ prix: t.prix, unite: t.unite, principal: t.principal, debut: t.debut, fin: t.fin })),
    coef_fg: l.coef_fg, coef_benef: l.coef_benef, pv: l.pv, pv_fixe: l.pv_fixe === true || l.pv_fixe === 'true', coef_remise: l.coef_remise,
  };
}

/**
 * Fournisseur en mémoire : mêmes règles que le serveur. Les éléments sont les lignes partagées avec la fiche et la
 * liste de démonstration ; apresEcriture(ligne) joue le rôle du recalcul serveur et du trigger d'historique.
 */
export class FournisseurBibliothequeMemoire {
  constructor({ bibliotheques = [], familles = [], regroupements = [], natures = [], unites = [], elements = [], tarifs = [],
    parametres = {}, profil = 'ADMIN', utilisateur = 'demo', horloge = () => Date.now() } = {}) {
    this.bibs = structuredClone(bibliotheques);
    this.fams = structuredClone(familles);
    this.rgns = structuredClone(regroupements);
    this.nats = structuredClone(natures);
    this.unts = structuredClone(unites);
    this.elements = elements;
    this.tarifsElements = structuredClone(tarifs);
    this.historiques = [];
    this.params = { scenario_defaut: 'FIXE', scenarios_autorises: SCENARIOS_TOUS, coef_fg_defaut: 1, coef_benef_defaut: 1, ...parametres };
    this.profil = profil;
    this.utilisateur = utilisateur;
    this.horloge = horloge;
    for (const e of this.elements) this.apresEcriture(e, { creation: true, commentaire: 'Reprise des données' });
  }

  #admin() { if (this.profil !== 'ADMIN') throw new ErreurBibliotheque(403, 'ACCES_REFUSE', 'Droit PARAMETRER refusé'); }
  #id(liste, cle = 'id') { return Math.max(0, ...liste.map((x) => Number(x[cle]) || 0)) + 1; }
  #element(id) {
    const e = this.elements.find((x) => String(x.id) === String(id));
    if (!e) throw new ErreurBibliotheque(404, 'INTROUVABLE', `Élément ${id} introuvable`);
    return e;
  }

  async parametres() { return structuredClone(this.params); }
  async enregistrerParametres(p) {
    this.#admin();
    if (!p.scenarios_autorises.includes(p.scenario_defaut)) throw new ErreurBibliotheque(422, 'SCENARIO', 'Le scénario par défaut doit être autorisé');
    this.params = { ...this.params, ...p };
    return this.parametres();
  }

  async bibliotheques() { return structuredClone([...this.bibs].sort((a, b) => a.ordre - b.ordre || a.code.localeCompare(b.code))); }
  async enregistrerBibliotheque(b) {
    this.#admin();
    const code = String(b.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,10}$/.test(code)) throw new ErreurBibliotheque(422, 'CODE', 'Code : lettres, chiffres ou _ (10 au plus), sans « : »');
    if (this.bibs.some((x) => x.code === code && x.id !== b.id)) throw new ErreurBibliotheque(409, 'CODE', `Bibliothèque ${code} déjà existante`);
    if (b.defaut) for (const x of this.bibs) x.defaut = false;
    const existante = this.bibs.find((x) => x.id === b.id);
    const v = { ordre: 0, actif: true, defaut: false, ...b, code, id: existante?.id ?? this.#id(this.bibs) };
    if (existante) Object.assign(existante, v); else this.bibs.push(v);
    return this.bibliotheques();
  }
  async supprimerBibliotheque(id) {
    this.#admin();
    if (this.elements.some((e) => e.bib_id === id)) throw new ErreurBibliotheque(409, 'UTILISEE', 'Bibliothèque contenant des éléments : désactivez-la plutôt');
    this.bibs = this.bibs.filter((b) => b.id !== id);
    return this.bibliotheques();
  }

  #chemins() {
    const par = new Map(this.fams.map((f) => [f.id, f]));
    const chemin = (f, n = 0) => (f.parent_id && par.has(f.parent_id) && n < 20 ? `${chemin(par.get(f.parent_id), n + 1)} › ${f.libelle}` : f.libelle);
    const niveau = (f, n = 1) => (f.parent_id && par.has(f.parent_id) && n < 20 ? niveau(par.get(f.parent_id), n + 1) : n);
    return this.fams.map((f) => ({ ...f, chemin: chemin(f), niveau: niveau(f) }));
  }
  async familles(bibId) {
    return structuredClone(this.#chemins().filter((f) => !bibId || f.bib_id === Number(bibId))
      .sort((a, b) => a.bib_id - b.bib_id || a.chemin.localeCompare(b.chemin, 'fr', { sensitivity: 'base' })));
  }
  async enregistrerFamille(f) {
    this.#admin();
    const code = String(f.code ?? '').trim().toUpperCase();
    if (!code || !String(f.libelle ?? '').trim()) throw new ErreurBibliotheque(422, 'OBLIGATOIRE', 'Code et libellé obligatoires');
    if (this.fams.some((x) => x.bib_id === f.bib_id && x.code === code && x.id !== f.id)) throw new ErreurBibliotheque(409, 'CODE', `Famille ${code} déjà existante`);
    for (let p = f.parent_id; p; p = this.fams.find((x) => x.id === p)?.parent_id) {
      if (p === f.id) throw new ErreurBibliotheque(422, 'PARENT', 'Une famille ne peut pas être rangée sous elle-même');
    }
    const existante = this.fams.find((x) => x.id === f.id);
    const v = { id: existante?.id ?? this.#id(this.fams), bib_id: f.bib_id, parent_id: f.parent_id ?? null, code, libelle: f.libelle.trim(), ordre: f.ordre ?? 0 };
    if (existante) Object.assign(existante, v); else this.fams.push(v);
    return this.familles(f.bib_id);
  }
  async supprimerFamille(id) {
    this.#admin();
    const f = this.fams.find((x) => x.id === id);
    if (this.fams.some((x) => x.parent_id === id)) throw new ErreurBibliotheque(409, 'SOUS_FAMILLES', 'Famille contenant des sous-familles');
    this.fams = this.fams.filter((x) => x.id !== id);
    for (const e of this.elements) if (e.fam_id === id) e.fam_id = null;
    return this.familles(f?.bib_id);
  }
  /** Chemin d'une famille (« Gros œuvre › Béton »), pour les lignes de la liste de démonstration. */
  cheminFamille(id) { return this.#chemins().find((f) => f.id === Number(id))?.chemin ?? null; }

  async regroupements() { return structuredClone([...this.rgns].sort((a, b) => a.ordre - b.ordre)); }
  async enregistrerRegroupement(r) {
    this.#admin();
    const code = String(r.code ?? '').trim().toUpperCase();
    const existant = this.rgns.find((x) => x.code === code);
    if (existant) Object.assign(existant, { libelle: r.libelle, ordre: r.ordre ?? 0 }); else this.rgns.push({ code, libelle: r.libelle, ordre: r.ordre ?? 0 });
    return this.regroupements();
  }
  async supprimerRegroupement(code) {
    this.#admin();
    if (this.nats.some((n) => n.regroupement === code)) throw new ErreurBibliotheque(409, 'UTILISE', 'Regroupement utilisé par des natures');
    this.rgns = this.rgns.filter((r) => r.code !== code);
    return this.regroupements();
  }

  async natures() { return structuredClone([...this.nats].sort((a, b) => a.code.localeCompare(b.code))); }
  async enregistrerNature(n) {
    this.#admin();
    const code = String(n.code ?? '').trim().toUpperCase();
    if (this.nats.some((x) => x.code === code && x.id !== n.id)) throw new ErreurBibliotheque(409, 'CODE', `Nature ${code} déjà existante`);
    const existante = this.nats.find((x) => x.id === n.id);
    const v = { actif: true, ...n, code, id: existante?.id ?? this.#id(this.nats) };
    if (existante) Object.assign(existante, v); else this.nats.push(v);
    return this.natures();
  }
  async supprimerNature(id) {
    this.#admin();
    this.nats = this.nats.filter((n) => n.id !== id);
    for (const e of this.elements) if (e.nat_id === id) e.nat_id = null;
    return this.natures();
  }

  async unites() { return structuredClone(this.unts); }

  async tarifs(eleId) {
    return structuredClone(this.tarifsElements.filter((t) => String(t.ele_id) === String(eleId))
      .sort((a, b) => Number(b.principal) - Number(a.principal) || a.fournisseur.localeCompare(b.fournisseur) || a.id - b.id));
  }
  async #apresTarif(eleId, commentaire) {
    const e = this.#element(eleId);
    this.apresEcriture(e, { commentaire });
    const { pa, pr, pv, coef_benef, pv_net } = e;
    return { tarifs: await this.tarifs(eleId), prix: { pa, pr, pv, coef_benef, pv_net, alertes: e.alertes ?? [] } };
  }
  async enregistrerTarif(eleId, t) {
    this.#element(eleId);
    if (!String(t.fournisseur ?? '').trim() || !t.unite) throw new ErreurBibliotheque(422, 'OBLIGATOIRE', 'Fournisseur et unité obligatoires');
    if (Number(t.prix) < 0) throw new ErreurBibliotheque(422, 'PRIX', 'Prix négatif');
    if (t.debut && t.fin && t.fin < t.debut) throw new ErreurBibliotheque(422, 'DATES', 'Fin de validité avant le début');
    if (t.principal) for (const x of this.tarifsElements) if (String(x.ele_id) === String(eleId)) x.principal = false;
    const existant = this.tarifsElements.find((x) => x.id === t.id);
    const v = { ...t, ele_id: Number(eleId), id: existant?.id ?? this.#id(this.tarifsElements), maj_le: new Date(this.horloge()).toISOString(), maj_par: this.utilisateur };
    if (existant) Object.assign(existant, v); else this.tarifsElements.push(v);
    return this.#apresTarif(eleId, `Tarif fournisseur ${v.fournisseur} : ${v.prix} / ${v.unite}`);
  }
  async supprimerTarif(eleId, id) {
    const t = this.tarifsElements.find((x) => x.id === id);
    this.tarifsElements = this.tarifsElements.filter((x) => x.id !== id);
    return this.#apresTarif(eleId, `Tarif fournisseur ${t?.fournisseur ?? ''} supprimé`);
  }

  async historique(eleId) {
    return structuredClone(this.historiques.filter((h) => String(h.ele_id) === String(eleId)).sort((a, b) => b.id - a.id));
  }

  /**
   * Après écriture d'un élément (fiche, tarif) : libellé brut, prix recalculés (article ; un ouvrage garde les prix de
   * sa composition) et historique si un prix a changé (auteur, commentaire consommé), comme le serveur et son trigger.
   */
  apresEcriture(e, { creation = false, commentaire = null } = {}) {
    e.libelle = texteBrut(e.libelle_html ?? '') ?? '';
    if (e.type !== 'OUVRAGE') {
      const r = calculerElement(entreeDepuisLigne(e, this.tarifsElements.filter((t) => String(t.ele_id) === String(e.id))));
      Object.assign(e, { pa: r.pa, pr: r.pr, pv: r.pv, coef_benef: r.coef_benef, pv_net: r.pv_net, alertes: r.alertes });
    }
    const prix = Object.fromEntries(CHAMPS_PRIX.map((k) => [k, k === 'scenario' ? e.scenario_pa : e[k] ?? null]));
    const precedent = this.historiques.filter((h) => h.ele_id === e.id).at(-1)?.apres ?? null;
    if (creation || JSON.stringify(precedent) !== JSON.stringify(prix)) {
      this.historiques.push({
        id: this.historiques.length + 1, ele_id: e.id, date: new Date(this.horloge()).toISOString(), auteur: e.maj_par ?? this.utilisateur,
        commentaire: commentaire ?? e.commentaire_prix ?? (creation ? 'Création' : null), avant: creation ? null : precedent, apres: prix,
      });
    }
    e.commentaire_prix = null;
  }

  async rechercher({ recherche = '', bib = null, type = null } = {}) {
    const mots = String(recherche).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/\s+/).filter(Boolean);
    return structuredClone(this.elements
      .filter((e) => e.actif !== false && (!bib || e.bib_id === Number(bib)) && (!type || e.type === type))
      .filter((e) => { const t = `${e.code} ${e.libelle ?? ''}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); return mots.every((m) => t.includes(m)); })
      .sort((a, b) => a.code.localeCompare(b.code)).slice(0, 50)
      .map((e) => ({
        id: e.id, bib_code: this.bibs.find((b) => b.id === e.bib_id)?.code ?? '', code: e.code, type: e.type, libelle: e.libelle, libelle_html: e.libelle_html,
        unite_stock: e.unite_stock, pa: e.pa, pr: e.pr, pv: e.pv, pv_net: e.pv_net, coef_fg: e.coef_fg, coef_benef: e.coef_benef,
      })));
  }
}
