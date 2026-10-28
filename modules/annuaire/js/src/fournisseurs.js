import { ERREUR_ANNUAIRE } from './codes.js';
import { planifierCoordonnees, valeursCoordonnee, memesValeurs, texteCoordonnee, principale, estVide, CHAMPS_NATURE, MESSAGES_COORDONNEES } from './coordonnees.js';
import { compacter } from './identifiants.js';
import { construireGraphe } from './graphe.js';
import { planFusion, motsDoublon, COLONNES_NON_FUSIONNEES } from './fusion.js';
import { siretValide } from './identifiants.js';

// Fournisseurs de l'annuaire. Même interface pour l'API (routes MapModuleAnnuaire) et pour la mémoire (démo hors ligne,
// tests ; mêmes règles que ServiceAnnuaire) :
//
//   referentiels()                                  { niveaux, casquettes, types_lien, roles }
//   enregistrerReferentiel(genre, r) / supprimerReferentiel(genre, code)   genre : niveaux, casquettes, types-lien, roles (ADMIN)
//   rechercherPersonnes({ recherche, casquette, limite })   [{ id, code, raison_sociale, niveau, ville, siret, casquettes, actif }]
//   rechercherIndividus({ recherche, limite })      [{ id, nom_complet, civilite, nom, prenom, personnes, email, telephone }]
//   personne(id) / individu(id)                     résumé (libellé, niveau…)
//   societeBase()                                   résumé de la société de la base, ou null
//   parSiret(siret)                                 personne portant ce SIRET (doublon), ou null
//   doublons({ raison_sociale, siret, exclure })    { siret : personne de même SIRET ou null, noms : personnes de nom proche }
//   creerProvisoire({ raison_sociale, siret, casquettes, niveau, confirme })   résumé du tiers provisoire créé (409
//                                                   DOUBLON_SIRET, 409 DOUBLON_NOM sans confirme ; details : personnes)
//   validerProvisoire(id)                           résumé : création validée (ADMIN)
//   apercuFusion(id, cibleId)                       { source, cible, valeurs_source, valeurs_cible, conflits, valeurs }
//   fusionner(id, { cible_id, choix })              { cible_id, reports } : tiers provisoire fusionné puis supprimé (ADMIN)
//   coordonneesProposees(type, id)                  coordonnées des fiches liées, à reprendre (même identifiant)
//   historiqueCoordonnee(cooId)                     [{ avant, le, par }]
//   creerParticulier(indId)                         { id } : compte particulier (personne) de l'individu, coordonnées partagées
//   graphe(type, id, { profondeur, contacts, liens, max_contacts })   graphe relationnel autour d'une fiche (graphe.js)
//   pageRattachements(type, id, { recherche, page, taille })   page de rattachements : { lignes, total, page, taille }
//
// Rattachements (champ géré) : la fiche lit la première page (TAILLE_PAGE_RATTACHEMENTS) et leur nombre
// (nb_rattachements) ; elle n'enregistre que les rattachements modifiés, ajoutés (sans rat_id) ou retirés
// ({ rat_id, supprime: true }) : un rattachement absent de la saisie est inchangé.
//
// Champs gérés des fiches (module Fiche, champ.gere) : personne → coordonnees, rattachements, liens, enfants ;
// individu → coordonnees, rattachements. Le fournisseur mémoire les lit et les écrit (geres(type)) ; côté serveur,
// SpecialisationFiche délègue à ServiceAnnuaire.

/** Rattachements lus avec une fiche (première page) et par page dans l'onglet Contacts. */
export const TAILLE_PAGE_RATTACHEMENTS = 20;

export class ErreurAnnuaire extends Error {
  constructor(statut, code, message, details = null) {
    super(message);
    this.statut = statut;
    this.code = code;
    this.details = details;
  }
}

export class FournisseurAnnuaireApi {
  constructor({ base = '/api/annuaire', entetes = {} } = {}) {
    this.base = base;
    this.entetes = { 'Content-Type': 'application/json', ...entetes };
  }

  async appel(methode, url, corps) {
    const r = await fetch(`${this.base}${url}`, { method: methode, headers: this.entetes, body: corps === undefined ? undefined : JSON.stringify(corps) });
    const texte = await r.text();
    const data = texte ? JSON.parse(texte) : null;
    if (!r.ok) throw new ErreurAnnuaire(r.status, data?.code ?? 'HTTP', data?.title ?? r.statusText, data?.details ?? null);
    return data;
  }

  referentiels() { return this.appel('GET', '/referentiels'); }
  enregistrerReferentiel(genre, r) { return this.appel('PUT', `/${genre}`, r); }
  supprimerReferentiel(genre, code) { return this.appel('DELETE', `/${genre}/${encodeURIComponent(code)}`); }
  rechercherPersonnes({ recherche = '', casquette = '', limite = 30 } = {}) {
    return this.appel('GET', `/personnes?${new URLSearchParams({ recherche, casquette, limite: String(limite) })}`);
  }
  rechercherIndividus({ recherche = '', limite = 30 } = {}) { return this.appel('GET', `/individus?${new URLSearchParams({ recherche, limite: String(limite) })}`); }
  personne(id) { return this.appel('GET', `/personnes/${id}`); }
  individu(id) { return this.appel('GET', `/individus/${id}`); }
  societeBase() { return this.appel('GET', '/societe'); }
  async parSiret(siret) { return (await this.appel('GET', `/siret/${encodeURIComponent(compacter(siret))}`)) ?? null; }
  coordonneesProposees(type, id) { return this.appel('GET', `/coordonnees/proposees?${new URLSearchParams({ type, id: String(id ?? '') })}`); }
  historiqueCoordonnee(cooId) { return this.appel('GET', `/coordonnees/${cooId}/historique`); }
  creerParticulier(indId) { return this.appel('POST', `/individus/${indId}/particulier`); }
  doublons({ raison_sociale = '', siret = '', exclure = null } = {}) {
    return this.appel('GET', `/doublons?${new URLSearchParams({ raison_sociale, siret, ...(exclure ? { exclure: String(exclure) } : {}) })}`);
  }
  creerProvisoire(saisie) { return this.appel('POST', '/personnes/provisoire', saisie); }
  validerProvisoire(id) { return this.appel('POST', `/personnes/${id}/validation`); }
  apercuFusion(id, cibleId) { return this.appel('GET', `/personnes/${id}/fusion?cible=${cibleId}`); }
  fusionner(id, { cible_id, choix = {} }) { return this.appel('POST', `/personnes/${id}/fusion`, { cible_id, choix }); }
  pageRattachements(type, id, { recherche = '', page = 1, taille = TAILLE_PAGE_RATTACHEMENTS } = {}) {
    return this.appel('GET', `/rattachements?${new URLSearchParams({ type, id: String(id), recherche, page: String(page), taille: String(taille) })}`);
  }
  graphe(type, id, { profondeur = 1, contacts = true, liens = true, max_contacts = 8 } = {}) {
    const q = new URLSearchParams({ type, id: String(id), profondeur: String(profondeur), contacts: String(contacts), liens: String(liens), max_contacts: String(max_contacts) });
    return this.appel('GET', `/graphe?${q}`);
  }
}

// ------------------------------------------------------------------ mémoire

const texte = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
// Même règle que f_annuaire_normaliser (SQL) : ligatures développées, diacritiques retirés, ponctuation conservée.
const SPECIAUX = { 'œ': 'oe', 'Œ': 'oe', 'æ': 'ae', 'Æ': 'ae', 'ß': 'ss', 'ø': 'o', 'Ø': 'o', 'đ': 'd', 'Đ': 'd', 'ł': 'l', 'Ł': 'l' };
const sansAccent = (s) => String(s ?? '').replace(/[œŒæÆßøØđĐłŁ]/g, (c) => SPECIAUX[c]).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const correspond = (mots, ...textes) => {
  const t = sansAccent(textes.filter(Boolean).join(' '));
  return mots.every((m) => t.includes(m));
};
const mots = (q) => sansAccent(q).split(/\s+/).filter(Boolean);
const date = (v) => (texte(v) ? String(v).slice(0, 10) : null);
const vrai = (v) => v === true || v === 'true';

// Lignes de personne en mémoire (codes des champs de fiche) ↔ colonnes de la table (fusion).
const COLONNES_MEMOIRE = { id: 'per_id', code: 'per_code', niveau: 'per_niv_code', parent_id: 'per_parent_id', casquettes: 'per_casquettes', proprietes: 'per_proprietes' };
const CHAMPS_MEMOIRE = Object.fromEntries(Object.entries(COLONNES_MEMOIRE).map(([k, v]) => [v, k]));
const colonnePersonne = (k) => COLONNES_MEMOIRE[k] ?? `per_${k}`;
const champPersonne = (c) => CHAMPS_MEMOIRE[c] ?? c.replace(/^per_/, '');
/** Colonnes dérivées des listes (deriver), jamais fusionnées. */
const DERIVEES = ['type_element', 'parent', 'ville', 'code_postal', 'telephone', 'email', 'adresse', 'contact', 'chemin'];

/** Libellé d'un individu : civilité, prénom, nom. */
export const libelleIndividu = (i) => [i?.civilite, i?.prenom, i?.nom].filter(Boolean).join(' ');

/**
 * Annuaire en mémoire. Les lignes des personnes et des individus sont indexées par code de champ de fiche (partagées
 * avec les fiches et les listes de la démo) ; les colonnes de liste en sont dérivées après chaque écriture.
 */
export class FournisseurAnnuaireMemoire {
  constructor({ niveaux = [], casquettes = [], types_lien = [], roles = [], personnes = [], individus = [], rattachements = [], liens = [],
    coordonnees = [], usages = [], profil = 'ADMIN', utilisateur = 'demo', horloge = () => Date.now() } = {}) {
    this.refs = { niveaux: structuredClone(niveaux), casquettes: structuredClone(casquettes), 'types-lien': structuredClone(types_lien), roles: structuredClone(roles) };
    this.personnes = structuredClone(personnes);
    this.individus = structuredClone(individus);
    this.rattachements = structuredClone(rattachements);
    this.liens = structuredClone(liens);
    this.coordonnees = structuredClone(coordonnees);
    this.usages = structuredClone(usages);
    this.historique = [];
    this.profil = profil;
    this.utilisateur = utilisateur;
    this.horloge = horloge;
    this.deriver();
  }

  #maintenant() { return new Date(this.horloge()).toISOString(); }
  #id(liste) { return Math.max(0, ...liste.map((x) => Number(x.id) || 0)) + 1; }
  #admin() { if (this.profil !== 'ADMIN') throw new ErreurAnnuaire(403, 'ACCES_REFUSE', 'Paramétrage de l\'annuaire réservé au profil ADMIN'); }

  // ---------------------------------------------------------------- référentiels

  async referentiels() {
    const tri = (l) => structuredClone(l).sort((a, b) => a.ordre - b.ordre || String(a.code).localeCompare(String(b.code)));
    return { niveaux: tri(this.refs.niveaux), casquettes: tri(this.refs.casquettes), types_lien: tri(this.refs['types-lien']), roles: tri(this.refs.roles) };
  }

  async enregistrerReferentiel(genre, r) {
    this.#admin();
    const liste = this.refs[genre];
    if (!liste) throw new ErreurAnnuaire(404, 'REFERENTIEL', `Référentiel ${genre} inconnu`);
    const code = String(r.code ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(code)) throw new ErreurAnnuaire(422, 'CODE', 'Code : lettres majuscules, chiffres et _ (30 caractères au plus)');
    if (!texte(r.libelle)) throw new ErreurAnnuaire(422, 'LIBELLE', 'Libellé obligatoire');
    if (genre === 'types-lien' && !texte(r.libelle_inverse)) throw new ErreurAnnuaire(422, 'LIBELLE', 'Libellé vu depuis la cible obligatoire');
    const ligne = { ...structuredClone(r), code, libelle: texte(r.libelle), ordre: Number(r.ordre ?? 0), actif: r.actif !== false };
    const i = liste.findIndex((x) => x.code === code);
    if (i >= 0) liste[i] = { ...liste[i], ...ligne }; else liste.push(ligne);
    this.deriver();
    return this.referentiels();
  }

  async supprimerReferentiel(genre, code) {
    this.#admin();
    const utilise = {
      niveaux: () => this.personnes.some((p) => p.niveau === code),
      casquettes: () => this.personnes.some((p) => (p.casquettes ?? []).includes(code)),
      'types-lien': () => this.liens.some((l) => l.tli_code === code),
      roles: () => this.individus.some((i) => (i.roles ?? []).includes(code)),
    }[genre];
    if (!utilise) throw new ErreurAnnuaire(404, 'REFERENTIEL', `Référentiel ${genre} inconnu`);
    if (utilise()) throw new ErreurAnnuaire(409, 'UTILISE', 'Code utilisé : désactivez-le plutôt');
    this.refs[genre] = this.refs[genre].filter((x) => x.code !== code);
    return this.referentiels();
  }

  // ---------------------------------------------------------------- recherches et résumés

  #resumePersonne(p) {
    if (!p) return null;
    const n = this.refs.niveaux.find((x) => x.code === p.niveau);
    return {
      id: p.id, code: p.code, raison_sociale: p.raison_sociale, nom_commercial: p.nom_commercial, niveau: p.niveau, niveau_libelle: n?.libelle ?? p.niveau,
      icone: n?.icone ?? null, ville: p.ville ?? null, siret: p.siret, casquettes: [...(p.casquettes ?? [])], actif: p.actif !== false, parent_id: p.parent_id ?? null,
      chemin: this.#chemin(p.id), provisoire: vrai(p.provisoire),
    };
  }

  #resumeIndividu(i) {
    if (!i) return null;
    return {
      id: i.id, civilite: i.civilite, nom: i.nom, prenom: i.prenom, nom_complet: libelleIndividu(i), personnes: i.personnes ?? null,
      email: i.email ?? null, telephone: i.telephone ?? i.portable ?? null, actif: i.actif !== false,
    };
  }

  #chemin(id) {
    const noms = [];
    const vus = new Set();
    let p = this.personnes.find((x) => x.id === Number(id));
    while (p && !vus.has(p.id)) { vus.add(p.id); noms.unshift(p.raison_sociale); p = this.personnes.find((x) => x.id === Number(p.parent_id)); }
    return noms.join(' › ');
  }

  async rechercherPersonnes({ recherche = '', casquette = '', limite = 30 } = {}) {
    const m = mots(recherche);
    return this.personnes
      .filter((p) => (!casquette || (p.casquettes ?? []).includes(casquette)) && correspond(m, p.code, p.raison_sociale, p.nom_commercial, p.siret, p.siren, p.ville))
      .sort((a, b) => Number(b.actif !== false) - Number(a.actif !== false) || String(a.raison_sociale).localeCompare(String(b.raison_sociale), 'fr'))
      .slice(0, limite).map((p) => this.#resumePersonne(p));
  }

  async rechercherIndividus({ recherche = '', limite = 30 } = {}) {
    const m = mots(recherche);
    return this.individus.filter((i) => correspond(m, i.nom, i.prenom, i.email, i.telephone, i.portable, i.personnes))
      .sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr') || String(a.prenom).localeCompare(String(b.prenom), 'fr'))
      .slice(0, limite).map((i) => this.#resumeIndividu(i));
  }

  async personne(id) {
    const p = this.personnes.find((x) => x.id === Number(id));
    if (!p) throw new ErreurAnnuaire(404, 'INTROUVABLE', `Personne ${id} introuvable`);
    return this.#resumePersonne(p);
  }

  async individu(id) {
    const i = this.individus.find((x) => x.id === Number(id));
    if (!i) throw new ErreurAnnuaire(404, 'INTROUVABLE', `Individu ${id} introuvable`);
    return this.#resumeIndividu(i);
  }

  async societeBase() { return this.#resumePersonne(this.personnes.find((p) => vrai(p.societe_base))); }

  async parSiret(siret) {
    const s = compacter(siret);
    return this.#resumePersonne(this.personnes.find((p) => p.siret && compacter(p.siret) === s)) ?? null;
  }

  // ---------------------------------------------------------------- tiers provisoires (mêmes règles que ServiceAnnuaire)

  async doublons({ raison_sociale = '', siret = '', exclure = null } = {}) {
    let s = texte(siret) ? await this.parSiret(siret) : null;
    if (s && s.id === Number(exclure)) s = null;
    const m = motsDoublon(raison_sociale).slice(0, 8).map(sansAccent);
    if (m.length === 0) return { siret: s, noms: [] };
    const noms = this.personnes.filter((p) => p.id !== Number(exclure) && p.id !== s?.id && correspond(m, p.raison_sociale, p.nom_commercial))
      .sort((a, b) => Number(b.actif !== false) - Number(a.actif !== false) || String(a.raison_sociale).localeCompare(String(b.raison_sociale), 'fr') || a.id - b.id)
      .slice(0, 10).map((p) => this.#resumePersonne(p));
    return { siret: s, noms };
  }

  async creerProvisoire({ raison_sociale, siret = null, casquettes = [], niveau = null, confirme = false } = {}) {
    const raison = texte(raison_sociale);
    const erreur = (champ, code, message) => new ErreurAnnuaire(422, 'VALIDATION', message, [{ champ, code, message }]);
    if (!raison) throw erreur('raison_sociale', 'OBLIGATOIRE', 'Raison sociale obligatoire');
    const s = texte(siret) ? compacter(siret) : null;
    if (s && !siretValide(s)) throw erreur('siret', 'SIRET', 'SIRET invalide (14 chiffres, clé de contrôle)');
    const d = await this.doublons({ raison_sociale: raison, siret: s });
    if (d.siret) throw new ErreurAnnuaire(409, ERREUR_ANNUAIRE.DOUBLON_SIRET, `SIRET déjà enregistré : ${d.siret.raison_sociale} (${d.siret.code})`, { personne: d.siret });
    if (!confirme && d.noms.length) throw new ErreurAnnuaire(409, ERREUR_ANNUAIRE.DOUBLON_NOM, 'Des tiers de nom proche existent déjà : vérifiez avant de créer', { personnes: d.noms });
    const niv = texte(niveau) ?? 'SOCIETE';
    if (!this.refs.niveaux.some((n) => n.code === niv)) throw erreur('niveau', 'NIVEAU', `Niveau ${niv} inconnu`);
    const id = this.#id(this.personnes);
    this.personnes.push({
      id, code: `T${String(id).padStart(6, '0')}`, niveau: niv, raison_sociale: raison, siret: s, siren: s?.slice(0, 9) ?? null,
      casquettes: [...new Set((casquettes ?? []).filter(Boolean))], pays: 'FR', devise: 'EUR', actif: true, societe_base: false, proprietes: {},
      provisoire: true, provisoire_par: this.utilisateur, provisoire_le: this.#maintenant(), cree_le: this.#maintenant(), modifie_le: this.#maintenant(),
    });
    this.deriver();
    return this.personne(id);
  }

  #validateur() { if (this.profil !== 'ADMIN') throw new ErreurAnnuaire(403, 'ACCES_REFUSE', 'Droit VALIDER_TIERS refusé'); }

  async validerProvisoire(id) {
    this.#validateur();
    const p = this.personnes.find((x) => x.id === Number(id));
    if (!p || !vrai(p.provisoire)) throw new ErreurAnnuaire(409, 'NON_PROVISOIRE', "Cette fiche n'est pas un tiers provisoire");
    Object.assign(p, { provisoire: false, valide_par: this.utilisateur, valide_le: this.#maintenant() });
    return this.personne(id);
  }

  /** Ligne de personne aux noms de colonnes de la table (per_…), sans les colonnes dérivées des listes. */
  #ligneFusion(id) {
    const p = this.personnes.find((x) => x.id === Number(id));
    if (!p) throw new ErreurAnnuaire(404, 'INTROUVABLE', `Personne ${id} introuvable`);
    const l = {};
    for (const [k, v] of Object.entries(p)) if (!DERIVEES.includes(k)) l[colonnePersonne(k)] = v;
    return { p, l };
  }

  #memeFiche(id, cibleId) {
    if (Number(id) === Number(cibleId)) {
      throw new ErreurAnnuaire(422, 'VALIDATION', 'Choisissez une autre fiche que le tiers provisoire', [{ champ: 'cible_id', code: 'MEME_FICHE' }]);
    }
  }

  async apercuFusion(id, cibleId) {
    this.#memeFiche(id, cibleId);
    const s = this.#ligneFusion(id).l, k = this.#ligneFusion(cibleId).l;
    const plan = planFusion(s, k);
    const exposees = (l) => {
      const r = Object.fromEntries(Object.entries(l).filter(([c]) => !COLONNES_NON_FUSIONNEES.includes(c)));
      for (const [cle, v] of Object.entries(l.per_proprietes ?? {})) r[`+${cle}`] = v;
      return r;
    };
    return { source: await this.personne(id), cible: await this.personne(cibleId), valeurs_source: exposees(s), valeurs_cible: exposees(k), conflits: plan.conflits, valeurs: plan.valeurs };
  }

  /**
   * Fusion d'un tiers provisoire (mêmes reports que ServiceAnnuaire.Fusionner) ; `reporterFusion(source, cible)`, posé par
   * l'hôte, reporte ses propres références et renvoie { quoi: nombre }.
   */
  async fusionner(id, { cible_id: cibleId, choix = {} } = {}) {
    this.#validateur();
    this.#memeFiche(id, cibleId);
    const src = Number(id), cible = Number(cibleId);
    const { p: ps, l: s } = this.#ligneFusion(src);
    if (!vrai(ps.provisoire)) throw new ErreurAnnuaire(409, 'NON_PROVISOIRE', 'Seul un tiers provisoire se fusionne dans une autre fiche');
    const { p: pk, l: k } = this.#ligneFusion(cible);
    const plan = planFusion(s, k, Object.fromEntries(Object.entries(choix ?? {}).filter(([, v]) => v === 'source' || v === 'cible')));
    for (const [c, v] of Object.entries(plan.valeurs)) pk[champPersonne(c)] = v;
    Object.assign(pk, { casquettes: plan.casquettes, proprietes: plan.proprietes, modifie_le: this.#maintenant() });
    if (Number(pk.parent_id) === src) pk.parent_id = ps.parent_id ?? null;
    const reports = { coordonnees: 0, contacts: 0, liens: 0, enfants: 0 };
    const nature = (u) => this.#coordonnee(u.coo_id)?.nature;
    const principales = new Set(this.usages.filter((u) => u.per_id === cible && u.principal).map(nature));
    const deja = new Set(this.usages.filter((u) => u.per_id === cible).map((u) => u.coo_id));
    for (const u of this.usages.filter((x) => x.per_id === src && !deja.has(x.coo_id))) {
      Object.assign(u, { per_id: cible, principal: !!u.principal && !principales.has(nature(u)) });
      reports.coordonnees++;
    }
    const contactPrincipal = this.rattachements.some((r) => r.per_id === cible && r.principal);
    for (const r of this.rattachements.filter((x) => x.per_id === src)) {
      const existant = this.rattachements.find((x) => x.per_id === cible && x.ind_id === r.ind_id);
      if (existant) {
        // Individu déjà contact : un seul rattachement, qui reçoit les coordonnées de l'autre.
        const coos = new Set(this.usages.filter((u) => u.rat_id === existant.id).map((u) => u.coo_id));
        for (const u of this.usages.filter((x) => x.rat_id === r.id && !coos.has(x.coo_id))) u.rat_id = existant.id;
        this.usages = this.usages.filter((u) => u.rat_id !== r.id);
        this.rattachements = this.rattachements.filter((x) => x !== r);
      } else {
        Object.assign(r, { per_id: cible, principal: !!r.principal && !contactPrincipal, modifie_le: this.#maintenant() });
        reports.contacts++;
      }
    }
    const cleLien = (l) => `${l.per_id}|${l.cible_id}|${l.tli_code}`;
    this.liens = this.liens.filter((l) => !((l.per_id === src && l.cible_id === cible) || (l.per_id === cible && l.cible_id === src)));
    const vus = new Set(this.liens.filter((l) => l.per_id !== src && l.cible_id !== src).map(cleLien));
    this.liens = this.liens.filter((l) => {
      if (l.per_id !== src && l.cible_id !== src) return true;
      const n = { ...l, per_id: l.per_id === src ? cible : l.per_id, cible_id: l.cible_id === src ? cible : l.cible_id };
      if (vus.has(cleLien(n))) return false;
      vus.add(cleLien(n));
      Object.assign(l, n);
      reports.liens++;
      return true;
    });
    for (const e of this.personnes.filter((x) => Number(x.parent_id) === src && x.id !== cible)) { e.parent_id = cible; reports.enfants++; }
    for (const [quoi, n] of Object.entries(this.reporterFusion?.(src, cible) ?? {})) reports[quoi] = n;
    this.usages = this.usages.filter((u) => u.per_id !== src);
    this.rattachements = this.rattachements.filter((r) => r.per_id !== src);
    this.personnes = this.personnes.filter((x) => x.id !== src);
    this.fusions = [...(this.fusions ?? []), {
      source_id: src, source_code: ps.code, source_libelle: ps.raison_sociale, cible_id: cible, choix, valeurs: plan.valeurs, reports, par: this.utilisateur, le: this.#maintenant(),
    }];
    this.deriver();
    return { cible_id: cible, reports: Object.fromEntries(Object.entries(reports).filter(([, n]) => n > 0)) };
  }

  // ---------------------------------------------------------------- coordonnées

  #coordonnee(id) { return this.coordonnees.find((c) => c.id === Number(id)); }

  /** Usages d'une fiche, au format des champs gérés (avec origine et autres fiches qui partagent la coordonnée). */
  #usagesDe(type, id) {
    const cle = { personne: 'per_id', individu: 'ind_id', rattachement: 'rat_id' }[type];
    return this.usages.filter((u) => u[cle] === Number(id)).sort((a, b) => (a.nature ?? '').localeCompare(b.nature ?? '') || a.ordre - b.ordre || a.id - b.id)
      .map((u) => {
        const c = this.#coordonnee(u.coo_id);
        const valeurs = valeursCoordonnee(c);
        return {
          uco_id: u.id, coo_id: c.id, nature: c.nature, usage: u.usage ?? null, libelle: u.libelle ?? null, principal: !!u.principal, ...valeurs,
          origine: { ...valeurs }, maj: c.modifie_le ?? null, partages: this.#partagesDe(c.id, u.id),
        };
      });
  }

  /** Autres fiches qui utilisent une coordonnée (hors usage exclu). */
  #partagesDe(cooId, sauf = null) {
    return this.usages.filter((u) => u.coo_id === Number(cooId) && u.id !== sauf).map((u) => this.#ficheUsage(u));
  }

  #ficheUsage(u) {
    if (u.per_id) return { type: 'personne', id: u.per_id, libelle: this.personnes.find((p) => p.id === u.per_id)?.raison_sociale ?? `Personne ${u.per_id}`, usage: u.usage };
    if (u.ind_id) return { type: 'individu', id: u.ind_id, libelle: libelleIndividu(this.individus.find((i) => i.id === u.ind_id)), usage: u.usage };
    const r = this.rattachements.find((x) => x.id === u.rat_id);
    const i = this.individus.find((x) => x.id === r?.ind_id), p = this.personnes.find((x) => x.id === r?.per_id);
    return { type: 'rattachement', id: u.rat_id, individu_id: i?.id, personne_id: p?.id, libelle: `${libelleIndividu(i)} chez ${p?.raison_sociale ?? '?'}`, usage: u.usage };
  }

  /** Coordonnées des fiches liées : personne (parents, enfants, contacts) ; individu (personnes, rattachements). */
  async coordonneesProposees(type, id) {
    const sources = [];
    const ajouter = (t, i, libelle) => { if (i) sources.push({ type: t, id: Number(i), libelle }); };
    if (type === 'personne') {
      const p = this.personnes.find((x) => x.id === Number(id));
      const vus = new Set([Number(id)]);
      for (let q = this.personnes.find((x) => x.id === Number(p?.parent_id)); q && !vus.has(q.id); q = this.personnes.find((x) => x.id === Number(q.parent_id))) {
        vus.add(q.id);
        ajouter('personne', q.id, q.raison_sociale);
      }
      for (const e of this.personnes.filter((x) => x.parent_id === Number(id))) ajouter('personne', e.id, e.raison_sociale);
      for (const r of this.rattachements.filter((x) => x.per_id === Number(id))) {
        const i = this.individus.find((x) => x.id === r.ind_id);
        ajouter('individu', i?.id, libelleIndividu(i));
      }
    } else if (type === 'individu') {
      for (const r of this.rattachements.filter((x) => x.ind_id === Number(id))) {
        const p = this.personnes.find((x) => x.id === r.per_id);
        ajouter('personne', p?.id, p?.raison_sociale);
        ajouter('rattachement', r.id, `${p?.raison_sociale ?? '?'} (coordonnées professionnelles)`);
      }
    }
    const vues = new Set();
    const res = [];
    for (const s of sources) {
      for (const u of this.#usagesDe(s.type, s.id)) {
        if (vues.has(u.coo_id)) continue;
        vues.add(u.coo_id);
        res.push({ ...u, uco_id: null, source: s });
      }
    }
    return res;
  }

  async historiqueCoordonnee(cooId) {
    return this.historique.filter((h) => h.coo_id === Number(cooId)).map((h) => ({ avant: h.avant, le: h.le, par: h.par })).reverse();
  }

  /** Nombre d'autres usages de chaque coordonnée des saisies (hors l'usage saisi lui-même). */
  #partages(saisies) {
    const p = {};
    for (const s of saisies) {
      if (s.coo_id === null || s.coo_id === undefined) continue;
      p[s.coo_id] = this.usages.filter((u) => u.coo_id === Number(s.coo_id) && u.id !== Number(s.uco_id ?? 0)).length;
    }
    return p;
  }

  /** Contrôles d'un plan : erreurs, choix requis, coordonnée modifiée entre-temps. */
  #controlerPlan(saisies, plan, contexte) {
    const nom = (i) => {
      const s = saisies[i];
      const n = { ADRESSE: 'Adresse', TELEPHONE: 'Téléphone', EMAIL: 'E-mail', WEB: 'Lien web' }[s?.nature] ?? 'Coordonnée';
      return `${contexte ? `${contexte} – ` : ''}${n} ${texteCoordonnee(s) || `n° ${i + 1}`}`;
    };
    for (const s of saisies) {
      if (s.coo_id === null || s.coo_id === undefined || estVide(s)) continue;
      const c = this.#coordonnee(s.coo_id);
      if (!c) throw new ErreurAnnuaire(404, 'INTROUVABLE', `Coordonnée ${s.coo_id} introuvable`);
      if (s.origine && !memesValeurs({ ...c, nature: c.nature }, { ...s.origine })) {
        throw new ErreurAnnuaire(409, 'COORDONNEE_MODIFIEE', `${nom(saisies.indexOf(s))} : modifiée par ailleurs entre-temps, rechargez la fiche`);
      }
    }
    if (plan.erreurs.length) {
      throw new ErreurAnnuaire(422, 'VALIDATION', 'Coordonnées incorrectes', plan.erreurs.map((e) => ({ champ: 'coordonnees', code: e.code, message: `${nom(e.index)} : ${e.message}` })));
    }
    if (plan.choix_requis.length) {
      throw new ErreurAnnuaire(422, 'CHOIX_REQUIS', MESSAGES_COORDONNEES.CHOIX, plan.choix_requis.map((c) => ({ champ: 'coordonnees', code: 'CHOIX', message: nom(c.index), ...c })));
    }
  }

  #planifier(type, id, saisies, contexte) {
    const cle = { personne: 'per_id', individu: 'ind_id', rattachement: 'rat_id' }[type];
    const existantes = id === null ? [] : this.usages.filter((u) => u[cle] === Number(id)).map((u) => u.id);
    const plan = planifierCoordonnees({ existantes, saisies, partages: this.#partages(saisies) });
    this.#controlerPlan(saisies, plan, contexte);
    return plan;
  }

  /** Application d'un plan (même ordre que ServiceAnnuaire) ; coordonnées orphelines supprimées. */
  #appliquer(type, id, plan) {
    const cle = { personne: 'per_id', individu: 'ind_id', rattachement: 'rat_id' }[type];
    const touchees = new Set();
    for (const o of plan.operations) {
      if (o.op === 'SUPPRIMER') {
        const u = this.usages.find((x) => x.id === o.uco_id);
        if (u) touchees.add(u.coo_id);
        this.usages = this.usages.filter((x) => x.id !== o.uco_id);
        continue;
      }
      let cooId = o.coo_id;
      if (o.coordonnee === 'NOUVELLE') {
        cooId = this.#id(this.coordonnees);
        this.coordonnees.push({ id: cooId, nature: o.nature, ...o.valeurs, modifie_le: this.#maintenant(), modifie_par: this.utilisateur });
      } else if (o.coordonnee === 'MODIFIER') {
        const c = this.#coordonnee(cooId);
        const avant = valeursCoordonnee(c);
        this.historique.push({ coo_id: cooId, avant, le: this.#maintenant(), par: this.utilisateur });
        Object.assign(c, o.valeurs, { modifie_le: this.#maintenant(), modifie_par: this.utilisateur });
      }
      const usage = { usage: o.usage, libelle: o.libelle, principal: o.principal, ordre: o.ordre };
      if (o.op === 'AJOUTER') this.usages.push({ id: this.#id(this.usages), coo_id: cooId, per_id: null, ind_id: null, rat_id: null, [cle]: Number(id), ...usage });
      else {
        const u = this.usages.find((x) => x.id === o.uco_id);
        if (u.coo_id !== cooId) touchees.add(u.coo_id);
        Object.assign(u, { coo_id: cooId, ...usage });
      }
    }
    for (const c of touchees) if (!this.usages.some((u) => u.coo_id === c)) this.coordonnees = this.coordonnees.filter((x) => x.id !== c);
  }

  // ---------------------------------------------------------------- rattachements et liens

  /**
   * Rattachements d'une fiche, triés (principal, actif, nom de l'autre fiche, identifiant), filtrés par une recherche (nom,
   * fonction, service) ; page de « taille » lignes, coordonnées lues pour cette page seulement.
   */
  #rattachementsDe(type, id, { recherche = '', page = 1, taille = Infinity } = {}) {
    const cle = type === 'personne' ? 'per_id' : 'ind_id';
    const m = mots(recherche);
    const nom = (r) => (type === 'personne' ? libelleIndividu(this.individus.find((x) => x.id === r.ind_id)) : this.personnes.find((x) => x.id === r.per_id)?.raison_sociale ?? '');
    const tous = this.rattachements.filter((r) => r[cle] === Number(id)).map((r) => ({ r, nom: nom(r) }))
      .filter(({ r, nom: n }) => correspond(m, n, r.fonction, r.service))
      .sort((a, b) => Number(!!b.r.principal) - Number(!!a.r.principal) || Number(b.r.actif !== false) - Number(a.r.actif !== false)
        || sansAccent(a.nom).localeCompare(sansAccent(b.nom)) || a.r.id - b.r.id);
    const debut = (Math.max(1, Number(page) || 1) - 1) * taille;
    const lignes = tous.slice(debut, debut + taille).map(({ r }) => {
      const i = this.individus.find((x) => x.id === r.ind_id), p = this.personnes.find((x) => x.id === r.per_id);
      return {
        rat_id: r.id, ind_id: r.ind_id, per_id: r.per_id, individu: libelleIndividu(i), personne: p?.raison_sociale ?? null, niveau: p?.niveau ?? null,
        fonction: r.fonction ?? null, service: r.service ?? null, principal: !!r.principal, titulaire: !!r.titulaire, debut: date(r.debut), fin: date(r.fin),
        actif: r.actif !== false, commentaire: r.commentaire ?? null, maj: r.modifie_le ?? null, coordonnees: this.#usagesDe('rattachement', r.id),
      };
    });
    return { lignes, total: tous.length };
  }

  async pageRattachements(type, id, { recherche = '', page = 1, taille = TAILLE_PAGE_RATTACHEMENTS } = {}) {
    const t = Math.min(Math.max(Number(taille) || TAILLE_PAGE_RATTACHEMENTS, 1), 200);
    return { ...this.#rattachementsDe(type, id, { recherche, page, taille: t }), page: Math.max(1, Number(page) || 1), taille: t };
  }

  #liensDe(id) {
    const n = Number(id);
    return this.liens.filter((l) => l.per_id === n || l.cible_id === n).map((l) => {
      const inverse = l.cible_id === n;
      const autre = this.personnes.find((p) => p.id === (inverse ? l.per_id : l.cible_id));
      return { lpe_id: l.id, tli_code: l.tli_code, inverse, autre_id: autre?.id ?? null, autre: autre?.raison_sociale ?? null, commentaire: l.commentaire ?? null, debut: date(l.debut), fin: date(l.fin) };
    });
  }

  #enfantsDe(id) {
    return this.personnes.filter((p) => p.parent_id === Number(id)).map((p) => this.#resumePersonne(p)).sort((a, b) => a.raison_sociale.localeCompare(b.raison_sociale, 'fr'));
  }

  /** Contrôle des rattachements saisis (personne → individus, individu → personnes) et de leurs coordonnées. */
  #planRattachements(type, id, saisies) {
    const cle = type === 'personne' ? 'per_id' : 'ind_id';
    const autre = type === 'personne' ? 'ind_id' : 'per_id';
    const existants = id === null ? [] : this.rattachements.filter((r) => r[cle] === Number(id));
    const retires = [];
    // Autres fiches déjà rattachées (hors saisie et hors retraits) : un nouveau rattachement ne peut les doubler.
    const saisis = new Set(saisies.filter((s) => s.rat_id).map((s) => Number(s.rat_id)));
    const vus = new Set(existants.filter((r) => !saisis.has(r.id)).map((r) => Number(r[autre])));
    const plans = [];
    for (const [i, s] of saisies.entries()) {
      const r = s.rat_id ? existants.find((x) => x.id === Number(s.rat_id)) : null;
      if (s.rat_id && !r) throw new ErreurAnnuaire(404, 'INTROUVABLE', `Rattachement ${s.rat_id} introuvable`);
      if (r && s.maj && r.modifie_le && s.maj !== r.modifie_le) throw new ErreurAnnuaire(409, 'RATTACHEMENT_MODIFIE', 'Un rattachement a été modifié par ailleurs entre-temps : rechargez la fiche');
      if (s.supprime) {
        if (!r) throw new ErreurAnnuaire(422, 'VALIDATION', 'Retrait impossible', [{ champ: 'rattachements', code: 'RETRAIT', message: `Rattachement n° ${i + 1} : pas encore enregistré` }]);
        retires.push(r);
        continue;
      }
      const cible = s[autre] ?? null;
      if (!cible && !(type === 'personne' && s.nouvel_individu)) throw new ErreurAnnuaire(422, 'VALIDATION', 'Rattachement incomplet', [{ champ: 'rattachements', code: 'OBLIGATOIRE', message: `Rattachement n° ${i + 1} : ${type === 'personne' ? 'individu' : 'personne'} à choisir` }]);
      if (s.nouvel_individu && !texte(s.nouvel_individu.nom)) throw new ErreurAnnuaire(422, 'VALIDATION', 'Rattachement incomplet', [{ champ: 'rattachements', code: 'OBLIGATOIRE', message: `Contact n° ${i + 1} : nom obligatoire` }]);
      if (cible) {
        if (vus.has(Number(cible))) throw new ErreurAnnuaire(422, 'VALIDATION', 'Rattachement en double', [{ champ: 'rattachements', code: 'DOUBLON', message: `Rattachement n° ${i + 1} : déjà rattaché` }]);
        vus.add(Number(cible));
        if (!(type === 'personne' ? this.individus : this.personnes).some((x) => x.id === Number(cible))) throw new ErreurAnnuaire(404, 'INTROUVABLE', `Fiche ${cible} introuvable`);
      }
      if (s.debut && s.fin && date(s.fin) < date(s.debut)) throw new ErreurAnnuaire(422, 'VALIDATION', 'Dates incohérentes', [{ champ: 'rattachements', code: 'DATES', message: `Rattachement n° ${i + 1} : fin avant le début` }]);
      const libelle = s.individu ?? s.personne ?? libelleIndividu(s.nouvel_individu);
      plans.push({ s, r, plan: this.#planifier('rattachement', r?.id ?? null, s.coordonnees ?? [], libelle) });
    }
    return { retires, plans };
  }

  #ecrireRattachements(type, id, { retires, plans }) {
    const cle = type === 'personne' ? 'per_id' : 'ind_id';
    const autre = type === 'personne' ? 'ind_id' : 'per_id';
    for (const r of retires) {
      const touchees = this.usages.filter((u) => u.rat_id === r.id).map((u) => u.coo_id);
      this.usages = this.usages.filter((u) => u.rat_id !== r.id);
      this.rattachements = this.rattachements.filter((x) => x.id !== r.id);
      for (const c of touchees) if (!this.usages.some((u) => u.coo_id === c)) this.coordonnees = this.coordonnees.filter((x) => x.id !== c);
    }
    // Contact principal : un seul par personne (le premier coché des saisies d'une personne).
    if (type === 'personne') {
      let vu = false;
      for (const p of plans) { if (vrai(p.s.principal)) { p.principal = !vu; vu = true; } }
    }
    for (const p of plans) {
      const { s, r, plan } = p;
      let cible = s[autre] ? Number(s[autre]) : null;
      if (!cible && s.nouvel_individu) {
        cible = this.#id(this.individus);
        this.individus.push({ id: cible, civilite: texte(s.nouvel_individu.civilite), nom: texte(s.nouvel_individu.nom), prenom: texte(s.nouvel_individu.prenom), pays: 'FR', roles: [], actif: true, proprietes: {} });
      }
      const valeurs = {
        [cle]: Number(id), [autre]: cible, fonction: texte(s.fonction), service: texte(s.service), principal: p.principal ?? vrai(s.principal), titulaire: vrai(s.titulaire),
        debut: date(s.debut), fin: date(s.fin), actif: s.actif !== false, commentaire: texte(s.commentaire), modifie_le: this.#maintenant(),
      };
      let ratId;
      if (r) { Object.assign(r, valeurs); ratId = r.id; } else { ratId = this.#id(this.rattachements); this.rattachements.push({ id: ratId, ...valeurs }); }
      this.#appliquer('rattachement', ratId, plan);
      // Contact principal d'une personne : les autres rattachements de la personne ne le sont plus.
      if (valeurs.principal) this.rattachements.filter((x) => x.per_id === valeurs.per_id && x.id !== ratId).forEach((x) => { x.principal = false; });
    }
  }

  /** Champs gérés rattachements (première page) et nb_rattachements. */
  #premierePage(type, id) {
    const { lignes, total } = this.#rattachementsDe(type, id, { taille: TAILLE_PAGE_RATTACHEMENTS });
    return { rattachements: lignes, nb_rattachements: total };
  }

  #controlerLiens(id, saisies) {
    for (const [i, s] of saisies.entries()) {
      const err = (message) => new ErreurAnnuaire(422, 'VALIDATION', 'Lien incorrect', [{ champ: 'liens', code: 'LIEN', message: `Lien n° ${i + 1} : ${message}` }]);
      if (!s.autre_id) throw err('personne à choisir');
      if (Number(s.autre_id) === Number(id)) throw err('une personne ne peut pas être liée à elle-même');
      if (!this.refs['types-lien'].some((t) => t.code === s.tli_code)) throw err('type de lien à choisir');
      if (!this.personnes.some((p) => p.id === Number(s.autre_id))) throw new ErreurAnnuaire(404, 'INTROUVABLE', `Personne ${s.autre_id} introuvable`);
    }
  }

  #ecrireLiens(id, saisies) {
    const n = Number(id);
    const gardes = new Set(saisies.filter((s) => s.lpe_id).map((s) => Number(s.lpe_id)));
    this.liens = this.liens.filter((l) => !((l.per_id === n || l.cible_id === n) && !gardes.has(l.id)));
    for (const s of saisies) {
      const valeurs = {
        per_id: s.inverse ? Number(s.autre_id) : n, cible_id: s.inverse ? n : Number(s.autre_id), tli_code: s.tli_code,
        commentaire: texte(s.commentaire), debut: date(s.debut), fin: date(s.fin),
      };
      const l = s.lpe_id ? this.liens.find((x) => x.id === Number(s.lpe_id)) : null;
      if (l) Object.assign(l, valeurs); else this.liens.push({ id: this.#id(this.liens), ...valeurs });
    }
  }

  /** Contrôles d'une personne nécessitant les données : société de la base unique, parent sans boucle, SIRET unique. */
  controlerPersonne(id, v) {
    if (vrai(v.societe_base) && this.personnes.some((p) => vrai(p.societe_base) && p.id !== Number(id))) {
      throw new ErreurAnnuaire(422, 'VALIDATION', 'Société de la base', [{ champ: 'societe_base', code: 'UNIQUE', message: 'La société de la base existe déjà' }]);
    }
    if (v.siret && this.personnes.some((p) => p.siret && compacter(p.siret) === compacter(v.siret) && p.id !== Number(id))) {
      throw new ErreurAnnuaire(422, 'VALIDATION', 'SIRET déjà utilisé', [{ champ: 'siret', code: 'UNIQUE', message: 'SIRET déjà enregistré pour une autre personne' }]);
    }
    if (v.parent_id) {
      const vus = new Set([Number(id)]);
      for (let p = this.personnes.find((x) => x.id === Number(v.parent_id)); p; p = this.personnes.find((x) => x.id === Number(p.parent_id))) {
        if (vus.has(p.id)) throw new ErreurAnnuaire(422, 'VALIDATION', 'Hiérarchie', [{ champ: 'parent_id', code: 'BOUCLE', message: 'Niveau supérieur : la hiérarchie bouclerait' }]);
        vus.add(p.id);
      }
    }
  }

  // ---------------------------------------------------------------- champs gérés des fiches

  /** Champs gérés des fiches personne et individu (FournisseurFicheMemoire : types.<type>.geres). */
  geres(type) {
    return {
      lire: async (l) => (type === 'personne'
        ? { coordonnees: this.#usagesDe('personne', l.id), ...this.#premierePage('personne', l.id), liens: this.#liensDe(l.id), enfants: this.#enfantsDe(l.id) }
        : { coordonnees: this.#usagesDe('individu', l.id), ...this.#premierePage('individu', l.id) }),
      valider: async (l, geres) => {
        const id = l?.id ?? null;
        if (geres.coordonnees) this.#planifier(type, id, geres.coordonnees, null);
        if (geres.rattachements) this.#planRattachements(type, id, geres.rattachements);
        if (geres.liens) this.#controlerLiens(id, geres.liens);
      },
      ecrire: async (l, geres) => {
        if (geres.coordonnees) this.#appliquer(type, l.id, this.#planifier(type, l.id, geres.coordonnees, null));
        if (geres.rattachements) this.#ecrireRattachements(type, l.id, this.#planRattachements(type, l.id, geres.rattachements));
        if (geres.liens) this.#ecrireLiens(l.id, geres.liens);
        this.deriver();
      },
    };
  }

  /** Compte particulier d'un individu : personne PARTICULIER titulaire, coordonnées personnelles partagées. */
  async creerParticulier(indId) {
    const i = this.individus.find((x) => x.id === Number(indId));
    if (!i) throw new ErreurAnnuaire(404, 'INTROUVABLE', `Individu ${indId} introuvable`);
    const existant = this.rattachements.find((r) => r.ind_id === i.id && r.titulaire && this.personnes.find((p) => p.id === r.per_id)?.niveau === 'PARTICULIER');
    if (existant) return { id: existant.per_id, existant: true };
    const id = this.#id(this.personnes);
    this.personnes.push({
      id, code: `T${String(id).padStart(6, '0')}`, niveau: 'PARTICULIER', raison_sociale: [i.civilite, i.nom?.toUpperCase(), i.prenom].filter(Boolean).join(' '),
      casquettes: ['CLIENT'], pays: i.pays ?? 'FR', devise: 'EUR', actif: true, societe_base: false, service_public: false, fe_engagement: false, proprietes: {},
      cree_le: this.#maintenant(), modifie_le: this.#maintenant(),
    });
    const ratId = this.#id(this.rattachements);
    this.rattachements.push({ id: ratId, per_id: id, ind_id: i.id, fonction: 'Titulaire', principal: true, titulaire: true, actif: true, modifie_le: this.#maintenant() });
    // Coordonnées personnelles de l'individu reprises avec le même identifiant (partagées).
    for (const u of this.usages.filter((x) => x.ind_id === i.id)) {
      this.usages.push({ id: this.#id(this.usages), coo_id: u.coo_id, per_id: id, ind_id: null, rat_id: null, usage: u.usage, libelle: u.libelle, principal: u.principal, ordre: u.ordre });
    }
    this.deriver();
    return { id, existant: false };
  }

  /** Graphe relationnel autour d'une fiche (même construction que GrapheAnnuaire côté serveur). */
  async graphe(type, id, options = {}) {
    return construireGraphe({
      niveaux: this.refs.niveaux, types_lien: this.refs['types-lien'],
      personnes: this.personnes.map((p) => ({ id: p.id, parent_id: p.parent_id ?? null, niveau: p.niveau, raison_sociale: p.raison_sociale, casquettes: p.casquettes ?? [], actif: p.actif !== false, ville: p.ville ?? null })),
      individus: this.individus.map((i) => ({ id: i.id, libelle: libelleIndividu(i), actif: i.actif !== false })),
      rattachements: this.rattachements, liens: this.liens,
    }, { type, id }, options);
  }

  // ---------------------------------------------------------------- colonnes de liste dérivées

  /** Colonnes des listes (comme v_liste_personnes et v_liste_individus) recalculées sur toutes les lignes. */
  deriver() {
    // Index (annuaire de démonstration volumineux : salariés) : coordonnées, usages par fiche, rattachements, fiches.
    const coordonnees = new Map(this.coordonnees.map((c) => [c.id, c]));
    const usagesPar = { per_id: new Map(), ind_id: new Map(), rat_id: new Map() };
    for (const u of this.usages) {
      const cle = u.per_id ? 'per_id' : u.ind_id ? 'ind_id' : 'rat_id';
      if (!usagesPar[cle].has(u[cle])) usagesPar[cle].set(u[cle], []);
      usagesPar[cle].get(u[cle]).push(u);
    }
    // Même ordre que #usagesDe : nature, rang, identifiant.
    const usagesDe = (cle, id) => (usagesPar[cle].get(id) ?? []).map((u) => {
      const c = coordonnees.get(u.coo_id);
      return { nature: c.nature, usage: u.usage ?? null, principal: !!u.principal, ordre: u.ordre, id: u.id, ...valeursCoordonnee(c) };
    }).sort((a, b) => a.nature.localeCompare(b.nature) || a.ordre - b.ordre || a.id - b.id);
    const personnes = new Map(this.personnes.map((p) => [p.id, p]));
    const individus = new Map(this.individus.map((i) => [i.id, i]));
    const ratsPar = (cle) => {
      const m = new Map();
      for (const r of this.rattachements) {
        if (r.actif === false) continue;
        if (!m.has(r[cle])) m.set(r[cle], []);
        m.get(r[cle]).push(r);
      }
      return m;
    };
    const ratsPersonne = ratsPar('per_id'), ratsIndividu = ratsPar('ind_id');
    const chemin = (p) => {
      const noms = [];
      const vus = new Set();
      for (let x = p; x && !vus.has(x.id); x = personnes.get(Number(x.parent_id))) { vus.add(x.id); noms.unshift(x.raison_sociale); }
      return noms.join(' › ');
    };
    const adresse = (usages) => usages.filter((u) => u.nature === 'ADRESSE').sort((a, b) => Number(b.principal) - Number(a.principal))[0];
    for (const p of this.personnes) {
      const usages = usagesDe('per_id', p.id);
      const contact = [...(ratsPersonne.get(p.id) ?? [])].sort((a, b) => Number(b.principal) - Number(a.principal))[0];
      const a = adresse(usages);
      Object.assign(p, {
        type_element: 'personne', parent: personnes.get(Number(p.parent_id))?.raison_sociale ?? null, ville: a?.ville ?? null, code_postal: a?.code_postal ?? null,
        telephone: principale(usages, 'TELEPHONE'), email: principale(usages, 'EMAIL'), adresse: principale(usages, 'ADRESSE'),
        contact: contact ? libelleIndividu(individus.get(contact.ind_id)) : null, chemin: chemin(p),
      });
    }
    for (const i of this.individus) {
      const usages = usagesDe('ind_id', i.id);
      const rats = ratsIndividu.get(i.id) ?? [];
      const pro = rats.flatMap((r) => usagesDe('rat_id', r.id));
      const portable = (l, oui) => l.filter((u) => (u.usage === 'PORTABLE') === oui);
      Object.assign(i, {
        type_element: 'individu', nom_complet: [i.nom?.toUpperCase(), i.prenom].filter(Boolean).join(' '),
        personnes: rats.map((r) => personnes.get(r.per_id)?.raison_sociale).filter(Boolean).join(', ') || null,
        fonction: rats.map((r) => r.fonction).find(Boolean) ?? null,
        telephone: principale(portable(pro, false), 'TELEPHONE') ?? principale(portable(usages, false), 'TELEPHONE'),
        portable: principale(portable(pro, true), 'TELEPHONE') ?? principale(portable(usages, true), 'TELEPHONE'),
        email: principale(pro, 'EMAIL') ?? principale(usages, 'EMAIL'), ville: adresse(usages)?.ville ?? null,
      });
    }
  }
}

export { CHAMPS_NATURE };
