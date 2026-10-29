import { PROFIL, ErreurApi, appelApi } from '@logibtp/socle';
import { ERREUR_FICHE } from './codes.js';
import { validerChamp, erreurRequete, MESSAGES } from './validation.js';
import { controlerChrono, formaterCode, lireCode, debutCode, codeSuivant, exerciceChrono } from './chrono.js';

// Fournisseurs de données des fiches. Même interface pour l'API (routes MapModuleFiche) et pour la mémoire
// (démo hors ligne, tests) :
//
//   definition(type)                          → définition complétée : champs du programme (+ obligatoire_parametre),
//                                               supplementaires, sections, droits { voir, modifier, debloquer, confidentiel }
//   charger(type, id, { confidentiel })       → { id, valeurs, proprietes, h, masques: [codes, '+code'], secrets, verrou }
//   reveler(type, id)                         → { valeurs, proprietes } des champs confidentiels (accès journalisé)
//   revelerSecret(type, id, champ)            → { valeur } d'un mot de passe (champ = code ou '+code' ; accès journalisé)
//   verrouiller(type, id, { jeton, forcer })  → { ok, verrou: { utilisateur, depuis, moi, meme_utilisateur } }   (battement compris)
//   deverrouiller(type, id, jeton)
//   enregistrer(type, id, { jeton, h, valeurs, proprietes, confidentiel })  → fiche relue ; 409 VERROU_PERDU / FICHE_MODIFIEE
//   creer(type, { valeurs, proprietes, confidentiel })  → fiche créée (création et copie)
//   supprimer(type, id)                       → droit SUPPRIMER ; 409 FICHE_EN_MODIFICATION (verrou d'un autre), FICHE_UTILISEE
//   (confidentiel : relire les champs confidentiels, si l'utilisateur les avait affichés et en a le droit)
//   parametrage(type) / enregistrerParametrage(type, { obligatoires, confidentiels, supplementaires })   (profil ADMIN)
//   code(type, { code, valeurs, id })        → { previsionnel, pris: { id, code } | null } (chrono : code prévisionnel
//                                               d'une création, fiche qui porte déjà le code saisi)
//   chronos(type) / enregistrerChrono(type, { variante, prefixe, format, raz, dernier })   (paramétrage : ADMIN)
//
// Chrono (definition.chrono : champ, prefixe, format, raz, portee, parent, variante, variantes) : création avec le code
// vide = code calculé attribué (compteur avancé) ; code saisi déjà pris = 409 CODE_PRIS (details { code, pris, propose }) ;
// code changé en modification = droit modifier_code, 422 CODE_PRIS s'il est pris.
//
// Mots de passe (type motdepasse) : jamais envoyés au chargement (valeur null, code dans secrets s'il est enregistré),
// révélés à la demande ; chiffrés en base par le serveur. Listes de valeurs par requête SQL (champ supplémentaire
// requete) : exécutées par le serveur en lecture seule, la définition reçoit les options (jamais la requête).
//
// Champs gérés (champ.gere, sans colonne) : données liées lues et écrites par le type, hors de la ligne :
// { geres: { lire(ligne) → { code: valeur }, valider(ligne | null, geres), ecrire(ligne, geres, { creation }) } }.
//
// verrou : null (personne ne modifie) ou { utilisateur, depuis, moi, meme_utilisateur } (le même utilisateur reprend son verrou) ; une erreur 422 VALIDATION porte
// details = [{ champ, code, message, supplementaire }].

export class ErreurFiche extends ErreurApi {}

export class FournisseurFicheApi {
  constructor({ base = '/api/fiches', entetes = {} } = {}) {
    this.base = base;
    this.entetes = { 'Content-Type': 'application/json', ...entetes };
  }

  appel(methode, url, corps, { keepalive = false } = {}) {
    return appelApi(`${this.base}${url}`, { methode, corps, entetes: this.entetes, keepalive, Erreur: ErreurFiche });
  }

  #u(type, id = null, suite = '') {
    return `/${encodeURIComponent(type)}${id === null ? '' : `/${encodeURIComponent(id)}`}${suite}`;
  }

  definition(type) { return this.appel('GET', this.#u(type, null, '/definition')); }
  charger(type, id, { confidentiel = false } = {}) { return this.appel('GET', this.#u(type, id, confidentiel ? '?confidentiel=true' : '')); }
  reveler(type, id) { return this.appel('POST', this.#u(type, id, '/confidentiel')); }
  revelerSecret(type, id, champ) { return this.appel('POST', this.#u(type, id, '/secret'), { champ }); }
  verrouiller(type, id, { jeton, forcer = false }) { return this.appel('POST', this.#u(type, id, '/verrou'), { jeton, forcer }); }
  // keepalive : la libération aboutit même si la fenêtre se ferme (onglet fermé sur une fiche en modification).
  deverrouiller(type, id, jeton) { return this.appel('DELETE', this.#u(type, id, `/verrou?jeton=${encodeURIComponent(jeton)}`), undefined, { keepalive: true }); }
  enregistrer(type, id, corps) { return this.appel('PUT', this.#u(type, id), corps); }
  creer(type, corps) { return this.appel('POST', this.#u(type), corps); }
  supprimer(type, id) { return this.appel('DELETE', this.#u(type, id)); }
  parametrage(type) { return this.appel('GET', this.#u(type, null, '/parametrage')); }
  enregistrerParametrage(type, p) { return this.appel('PUT', this.#u(type, null, '/parametrage'), p); }
  code(type, demande) { return this.appel('POST', this.#u(type, null, '/code'), demande); }
  chronos(type) { return this.appel('GET', this.#u(type, null, '/chrono')); }
  enregistrerChrono(type, saisie) { return this.appel('PUT', this.#u(type, null, '/chrono'), saisie); }
}

const EXPIRATION_VERROU = 120000;

function empreinte(o) {
  const s = JSON.stringify(o);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

const estSecret = (c) => c.type === 'motdepasse';
const TYPES_SUPPLEMENTAIRES = ['texte', 'nombre', 'booleen', 'date', 'liste', 'motdepasse'];

/**
 * Fournisseur en mémoire (démo hors ligne, tests) : mêmes règles que le serveur (mots de passe gardés en clair, en
 * mémoire seulement ; requête d'une liste exécutée par l'option requete(sql) → [{ valeur, libelle }], sinon options saisies). Types :
 * { code: { definition, lignes, cle, proprietes (nom de la propriété JSON des champs supplémentaires), derivees(ligne) } } ;
 * derivees : colonnes recalculées après écriture (colonnes dérivées d'une vue de liste partagée). Les lignes
 * sont indexées par code de champ (elles peuvent être partagées avec une source de liste en mémoire).
 */
export class FournisseurFicheMemoire {
  constructor({ types = {}, droits = [], profil = PROFIL.ADMIN, utilisateur = 'demo', parametrage = {}, horloge = () => Date.now(), requete = null, parentChrono = null } = {}) {
    this.types = types;
    // Chrono à {PARENT} : texte du jeton pour la fiche parente (type, champ, valeur) → texte ou null (comme CodeParentChronoAsync).
    this.parentChrono = parentChrono;
    this.chronosParametres = new Map();
    this.compteurs = new Map();
    this.requete = requete;
    this.droits = droits;
    this.profil = profil;
    this.utilisateur = utilisateur;
    this.parametres = structuredClone(parametrage);
    this.horloge = horloge;
    this.verrous = new Map();
    this.journal = [];
  }

  #type(code) {
    const t = this.types[code];
    if (!t) throw new ErreurFiche(404, 'TYPE', `Type de fiche ${code} inconnu`);
    return t;
  }

  #droits(type) {
    const a = new Set(this.droits.filter((d) => d.profil === this.profil && d.type === type).map((d) => d.action));
    return {
      voir: a.has('VOIR'), modifier: a.has('MODIFIER'), debloquer: a.has('DEBLOQUER'), confidentiel: a.has('CONFIDENTIEL'), supprimer: a.has('SUPPRIMER'),
      modifier_code: a.has('MODIFIER_CODE'),
    };
  }

  #exiger(type, droit) {
    if (!this.#droits(type)[droit]) throw new ErreurFiche(403, 'ACCES_REFUSE', `Droit ${droit.toUpperCase()} refusé`);
  }

  async definition(type) {
    const t = this.#type(type);
    const p = this.parametres[type] ?? {};
    const obligatoires = new Set(p.obligatoires ?? []);
    const confidentiels = new Set(p.confidentiels ?? []);
    const supplementaires = structuredClone((p.supplementaires ?? []).filter((c) => c.actif !== false).sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0)));
    for (const c of supplementaires) {
      if (c.type === 'liste' && c.requete && this.requete) c.options = await this.#options(c.requete);
      delete c.requete;
    }
    return {
      ...structuredClone(t.definition),
      type,
      champs: t.definition.champs.map((c) => {
        const confidentielParametre = !c.confidentiel && !c.gere && confidentiels.has(c.code);
        return { ...structuredClone(c), obligatoire_parametre: obligatoires.has(c.code) && !c.obligatoire, confidentiel_parametre: confidentielParametre, confidentiel: !!c.confidentiel || confidentielParametre };
      }),
      supplementaires,
      droits: this.#droits(type),
    };
  }

  async #options(sql) {
    const e = erreurRequete(sql);
    if (e) throw new ErreurFiche(422, 'REQUETE', e);
    const lignes = await this.requete(sql);
    return lignes.slice(0, 1000).map((l) => {
      const v = Array.isArray(l) ? l : [l.valeur ?? Object.values(l)[0], l.libelle ?? Object.values(l)[1]];
      return { valeur: String(v[0]), libelle: String(v[1] ?? v[0]) };
    }).filter((o) => o.valeur !== 'null' && o.valeur !== 'undefined');
  }

  #ligne(type, id) {
    const t = this.#type(type);
    const l = t.lignes.find((x) => String(x[t.cle]) === String(id));
    if (!l) throw new ErreurFiche(404, 'INTROUVABLE', `Fiche ${type} ${id} introuvable`);
    return l;
  }

  #verrou(type, id) {
    const v = this.verrous.get(`${type}:${id}`);
    if (!v || this.horloge() - v.renouvele > EXPIRATION_VERROU) return null;
    return v;
  }

  #vueVerrou(v, jeton) {
    return v ? { utilisateur: v.utilisateur, depuis: new Date(v.depuis).toISOString(), moi: !!jeton && v.jeton === jeton, meme_utilisateur: v.utilisateur === this.utilisateur } : null;
  }

  async #lire(type, id, { confidentiel = false, jeton = null } = {}) {
    const t = this.#type(type);
    const def = await this.definition(type);
    const l = this.#ligne(type, id);
    const visible = confidentiel && def.droits.confidentiel;
    const valeurs = {}, proprietes = {}, masques = [], secrets = [];
    for (const c of def.champs) {
      if (estSecret(c)) { valeurs[c.code] = null; if ((l[c.code] ?? null) !== null) secrets.push(c.code); }
      else if (c.confidentiel && !visible) { valeurs[c.code] = null; masques.push(c.code); } else valeurs[c.code] = l[c.code] ?? null;
    }
    const brutes = l[t.proprietes] ?? {};
    for (const c of def.supplementaires) {
      if (estSecret(c)) { proprietes[c.code] = null; if ((brutes[c.code] ?? null) !== null) secrets.push(`+${c.code}`); }
      else if (c.confidentiel && !visible) { proprietes[c.code] = null; masques.push(`+${c.code}`); } else proprietes[c.code] = brutes[c.code] ?? null;
    }
    if (visible && masques.length === 0) this.#journaliser(type, id, def);
    if (t.geres) Object.assign(valeurs, await t.geres.lire(l));
    return { id: l[t.cle], valeurs, proprietes, h: this.#empreinte(type, l), masques, secrets, verrou: this.#vueVerrou(this.#verrou(type, id), jeton) };
  }

  #empreinte(type, l) {
    const t = this.#type(type);
    const o = {};
    for (const c of t.definition.champs.filter((x) => !x.gere)) o[c.code] = l[c.code] ?? null;
    o[t.proprietes] = l[t.proprietes] ?? {};
    return empreinte(o);
  }

  #journaliser(type, id, def, champs = [...def.champs.filter((c) => c.confidentiel && !estSecret(c)).map((c) => c.code),
    ...def.supplementaires.filter((c) => c.confidentiel && !estSecret(c)).map((c) => `+${c.code}`)]) {
    if (champs.length) this.journal.push({ type, element: String(id), utilisateur: this.utilisateur, champs, date: new Date(this.horloge()).toISOString() });
  }

  async charger(type, id, options = {}) {
    this.#exiger(type, 'voir');
    return this.#lire(type, id, options);
  }

  async reveler(type, id) {
    this.#exiger(type, 'voir');
    this.#exiger(type, 'confidentiel');
    const f = await this.#lire(type, id, { confidentiel: true });
    const def = await this.definition(type);
    return {
      valeurs: Object.fromEntries(def.champs.filter((c) => c.confidentiel && !estSecret(c)).map((c) => [c.code, f.valeurs[c.code]])),
      proprietes: Object.fromEntries(def.supplementaires.filter((c) => c.confidentiel && !estSecret(c)).map((c) => [c.code, f.proprietes[c.code]])),
    };
  }

  async revelerSecret(type, id, champ) {
    this.#exiger(type, 'voir');
    const def = await this.definition(type);
    const supplementaire = String(champ).startsWith('+');
    const c = supplementaire ? def.supplementaires.find((x) => x.code === champ.slice(1)) : def.champs.find((x) => x.code === champ);
    if (!c || !estSecret(c)) throw new ErreurFiche(422, 'CHAMP', `Champ ${champ} : pas un mot de passe`);
    if (c.confidentiel) this.#exiger(type, 'confidentiel');
    const l = this.#ligne(type, id);
    this.#journaliser(type, id, def, [champ]);
    return { valeur: (supplementaire ? l[this.#type(type).proprietes]?.[c.code] : l[c.code]) ?? null };
  }

  async verrouiller(type, id, { jeton, forcer = false }) {
    this.#exiger(type, 'modifier');
    this.#ligne(type, id);
    const v = this.#verrou(type, id);
    // Le même utilisateur reprend son propre verrou (autre fenêtre, fenêtre fermée) sans avertissement.
    if (v && v.jeton !== jeton && v.utilisateur !== this.utilisateur) {
      if (!forcer) return { ok: false, verrou: this.#vueVerrou(v, jeton) };
      this.#exiger(type, 'debloquer');
    }
    const maintenant = this.horloge();
    const nouveau = v && v.jeton === jeton ? { ...v, renouvele: maintenant } : { utilisateur: this.utilisateur, jeton, depuis: maintenant, renouvele: maintenant };
    this.verrous.set(`${type}:${id}`, nouveau);
    return { ok: true, verrou: this.#vueVerrou(nouveau, jeton) };
  }

  async deverrouiller(type, id, jeton) {
    const v = this.verrous.get(`${type}:${id}`);
    if (v?.jeton === jeton) this.verrous.delete(`${type}:${id}`);
  }

  /** Verrou actif d'une fiche (contrôle d'une saisie dans une liste), ou null. */
  verrouActif(type, id) { return this.#vueVerrou(this.#verrou(type, id), null); }

  /** Démo : un autre utilisateur ouvre la fiche en modification. */
  simulerVerrouAutre(type, id, utilisateur = 'autre.utilisateur') {
    const maintenant = this.horloge();
    this.verrous.set(`${type}:${id}`, { utilisateur, jeton: `autre-${maintenant}`, depuis: maintenant, renouvele: maintenant });
  }

  /** Contrôle de la ligne complète (valeurs connues et confidentielles conservées). */
  async #valider(type, valeurs, proprietes) {
    const def = await this.definition(type);
    const erreurs = [];
    for (const c of def.champs) {
      if (c.lecture_seule) continue;
      const code = validerChamp(c, valeurs[c.code]);
      if (code) erreurs.push({ champ: c.code, code, message: MESSAGES[code], supplementaire: false });
    }
    for (const c of def.supplementaires) {
      const code = validerChamp(c, proprietes[c.code]);
      if (code) erreurs.push({ champ: c.code, code, message: MESSAGES[code], supplementaire: true });
    }
    if (erreurs.length) throw new ErreurFiche(422, 'VALIDATION', 'Fiche incomplète ou incorrecte', erreurs);
  }

  #ecrire(type, l, valeurs, proprietes) {
    const t = this.#type(type);
    const champs = new Map(t.definition.champs.map((c) => [c.code, c]));
    for (const [code, v] of Object.entries(valeurs ?? {})) {
      const c = champs.get(code);
      if (!c || c.lecture_seule) throw new ErreurFiche(422, 'CHAMP', `Champ ${code} non modifiable`);
      l[code] = convertir(c, v);
    }
    if (proprietes && Object.keys(proprietes).length) l[t.proprietes] = { ...(l[t.proprietes] ?? {}), ...proprietes };
  }

  /** Valeurs saisies séparées : champs de la ligne et champs gérés par le type. */
  #separer(type, valeurs) {
    const geres = new Set(this.#type(type).definition.champs.filter((c) => c.gere).map((c) => c.code));
    const ligne = {}, autres = {};
    for (const [k, v] of Object.entries(valeurs ?? {})) (geres.has(k) ? autres : ligne)[k] = v;
    return [ligne, autres];
  }

  async enregistrer(type, id, { jeton, h, valeurs: saisies = {}, proprietes = {}, confidentiel = false }) {
    this.#exiger(type, 'modifier');
    const t = this.#type(type);
    const [valeurs, geres] = this.#separer(type, saisies);
    const l = this.#ligne(type, id);
    const v = this.#verrou(type, id);
    if (!v || v.jeton !== jeton) {
      throw new ErreurFiche(409, ERREUR_FICHE.VERROU_PERDU, v ? `Fiche reprise en modification par ${v.utilisateur}` : 'Verrou de modification expiré : reprenez la modification', this.#vueVerrou(v, jeton));
    }
    if (h && h !== this.#empreinte(type, l)) throw new ErreurFiche(409, 'FICHE_MODIFIEE', 'La fiche a été modifiée par ailleurs : rechargez-la');
    const essai = structuredClone(l);
    this.#ecrire(type, essai, valeurs, proprietes);
    const def = await this.definition(type);
    await this.#valider(type, Object.fromEntries(def.champs.filter((c) => !c.gere).map((c) => [c.code, essai[c.code] ?? null])), essai[t.proprietes] ?? {});
    this.#controlerCodeModifie(type, id, l, essai);
    if (Object.keys(geres).length) await t.geres.valider?.(l, geres);
    Object.assign(l, essai, t.derivees?.(essai) ?? {});
    if (Object.keys(geres).length) await t.geres.ecrire(l, geres, { creation: false });
    v.renouvele = this.horloge();
    return this.#lire(type, id, { confidentiel, jeton });
  }

  async creer(type, { valeurs: saisies = {}, proprietes = {}, confidentiel = false }) {
    this.#exiger(type, 'modifier');
    const t = this.#type(type);
    const [valeurs, geres] = this.#separer(type, saisies);
    const l = {};
    this.#ecrire(type, l, valeurs, proprietes);
    const chrono = this.#preparerCodeCreation(type, l);
    const def = await this.definition(type);
    await this.#valider(type, Object.fromEntries(def.champs.filter((c) => !c.gere).map((c) => [c.code, l[c.code] ?? null])), l[t.proprietes] ?? {});
    if (Object.keys(geres).length) await t.geres.valider?.(null, geres);
    if (chrono) l[chrono.definition.champ] = this.#attribuer(type, chrono);
    l[t.cle] = Math.max(0, ...t.lignes.map((x) => Number(x[t.cle]) || 0)) + 1;
    Object.assign(l, t.derivees?.(l) ?? {});
    t.lignes.push(l);
    if (Object.keys(geres).length) await t.geres.ecrire(l, geres, { creation: true });
    return this.#lire(type, l[t.cle], { confidentiel });
  }

  /** Suppression (droit SUPPRIMER) : refusée si un autre utilisateur modifie la fiche. */
  async supprimer(type, id) {
    this.#exiger(type, 'supprimer');
    const t = this.#type(type);
    const v = this.verrous.get(`${type}:${id}`);
    if (v && v.utilisateur !== this.utilisateur) throw new ErreurFiche(409, ERREUR_FICHE.FICHE_EN_MODIFICATION, `Fiche en cours de modification par ${v.utilisateur} : suppression impossible`);
    const i = t.lignes.findIndex((x) => String(x[t.cle]) === String(id));
    if (i < 0) throw new ErreurFiche(404, 'INTROUVABLE', `Fiche ${type} ${id} introuvable`);
    await t.avantSuppression?.(t.lignes[i]);
    t.lignes.splice(i, 1);
    this.verrous.delete(`${type}:${id}`);
  }

  // ---------------------------------------------------------------- chrono (mêmes règles que ServiceFiche.Chrono.cs)

  #chrono(type, valeurs) {
    const def = this.#type(type).definition.chrono;
    if (!def) return null;
    const texte = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
    const variante = def.variante ? texte(valeurs[def.variante]) ?? def.variantes?.[0]?.valeur ?? '' : '';
    const p = this.chronosParametres.get(`${type}:${variante}`);
    const prefixe = p ? p.prefixe : def.variantes?.find((v) => v.valeur === variante)?.prefixe ?? def.prefixe;
    const format = p ? p.format ?? def.format : def.format;
    const raz = p ? p.raz : def.raz ?? 'J';
    const portee = def.portee ? texte(valeurs[def.portee]) ?? '' : '';
    const aParent = (format ?? '').includes('{PARENT}');
    const valeurParent = def.parent && aParent ? texte(valeurs[def.parent]) : null;
    const parent = valeurParent !== null ? this.parentChrono?.(type, def.parent, valeurParent) ?? null : null;
    return { definition: def, variante, prefixe, format, raz, portee, parent, aParent };
  }

  #pris(type, ch, code, exclure = null) {
    const t = this.#type(type);
    const l = t.lignes.find((x) => x[ch.definition.champ] === code && String(x[t.cle]) !== String(exclure)
      && (!ch.definition.portee || String(x[ch.definition.portee] ?? '') === ch.portee));
    return l ? { id: String(l[t.cle]), code } : null;
  }

  #rangsPris(type, ch, annee) {
    const t = this.#type(type);
    const exercice = exerciceChrono(ch.raz, annee);
    const debut = debutCode(ch, { annee: ch.aParent || exercice === 0 ? null : annee, parent: ch.parent ?? '' });
    return new Set(t.lignes
      .filter((x) => String(x[ch.definition.champ] ?? '').startsWith(debut) && (!ch.definition.portee || String(x[ch.definition.portee] ?? '') === ch.portee))
      .map((x) => lireCode(ch, x[ch.definition.champ], { parent: ch.parent ?? '' }))
      .filter((x) => x && (ch.aParent || exerciceChrono(ch.raz, x.annee ?? annee) === exercice)).map((x) => x.rang));
  }

  #cleCompteur(type, ch, exercice) { return `${type}|${ch.variante}|${ch.portee}|${exercice}`; }

  #previsionnel(type, ch) {
    if (ch.aParent && ch.parent === null) return null;
    const annee = new Date(this.horloge()).getFullYear();
    const pris = this.#rangsPris(type, ch, annee);
    if (ch.aParent) return formaterCode(ch, { annee, rang: Math.max(0, ...pris) + 1, parent: ch.parent });
    let rang = (this.compteurs.get(this.#cleCompteur(type, ch, exerciceChrono(ch.raz, annee))) ?? 0) + 1;
    while (pris.has(rang)) rang++;
    return formaterCode(ch, { annee, rang });
  }

  #attribuer(type, ch) {
    const code = this.#previsionnel(type, ch);
    if (!ch.aParent && code !== null) {
      const annee = new Date(this.horloge()).getFullYear();
      this.compteurs.set(this.#cleCompteur(type, ch, exerciceChrono(ch.raz, annee)), lireCode(ch, code).rang);
    }
    return code;
  }

  #suivantLibre(type, ch, code) {
    let c = codeSuivant(code);
    for (let i = 0; c !== null && i < 1000; i++, c = codeSuivant(c)) if (!this.#pris(type, ch, c)) return c;
    return null;
  }

  /** Création : code vide = prévisionnel (validation), attribué ensuite ; code saisi pris = 409 CODE_PRIS. */
  #preparerCodeCreation(type, l) {
    const ch = this.#chrono(type, l);
    if (!ch) return null;
    const saisi = l[ch.definition.champ];
    if (saisi !== null && saisi !== undefined && String(saisi).trim() !== '') {
      const pris = this.#pris(type, ch, String(saisi).trim());
      if (pris) throw new ErreurFiche(409, ERREUR_FICHE.CODE_PRIS, `Le code ${saisi} est déjà utilisé`, { code: saisi, pris, propose: this.#suivantLibre(type, ch, saisi) });
      return null;
    }
    l[ch.definition.champ] = this.#previsionnel(type, ch);
    return ch;
  }

  #controlerCodeModifie(type, id, avant, apres) {
    const def = this.#type(type).definition.chrono;
    if (!def) return;
    const nouveau = apres[def.champ] ?? null;
    if (nouveau === (avant[def.champ] ?? null)) return;
    this.#exiger(type, 'modifier_code');
    const pris = nouveau !== null ? this.#pris(type, this.#chrono(type, apres), nouveau, id) : null;
    if (pris) throw new ErreurFiche(422, ERREUR_FICHE.CODE_PRIS, `Le code ${nouveau} est déjà utilisé`, { code: nouveau, pris, propose: null });
  }

  async code(type, { code = null, valeurs = {}, id = null } = {}) {
    this.#exiger(type, 'modifier');
    const ch = this.#chrono(type, valeurs);
    if (!ch) return { previsionnel: null, pris: null };
    const saisi = code === null || code === undefined || String(code).trim() === '' ? null : String(code).trim();
    return { previsionnel: id === null ? this.#previsionnel(type, ch) : null, pris: saisi === null ? null : this.#pris(type, ch, saisi, id) };
  }

  async chronos(type) {
    this.#exiger(type, 'voir');
    const t = this.#type(type);
    const def = t.definition.chrono;
    if (!def) return [];
    const annee = new Date(this.horloge()).getFullYear();
    return (def.variantes?.length ? def.variantes : [{ valeur: '' }]).map((v) => {
      const ch = this.#chrono(type, def.variante ? { [def.variante]: v.valeur } : {});
      const exercice = exerciceChrono(ch.raz, annee);
      const dernier = ch.aParent ? 0 : this.compteurs.get(this.#cleCompteur(type, { ...ch, portee: '' }, exercice)) ?? 0;
      return {
        type, libelle: t.definition.libelle, variante: v.valeur, libelle_variante: v.libelle ?? null, prefixe: ch.prefixe ?? null, format: ch.format ?? null, raz: ch.raz,
        parent: ch.aParent, portee: !!def.portee, exercice, dernier,
        // Prochain code : celui que recevra une création (rang déjà pris sauté) ; d'après le parent pour un chrono à {PARENT}.
        prochain: ch.aParent || def.portee ? formaterCode(ch, { annee, rang: dernier + 1, parent: ch.aParent ? '…' : '' }) : this.#previsionnel(type, ch),
      };
    });
  }

  async enregistrerChrono(type, { variante = '', prefixe = null, format = null, raz = 'J', dernier = null }) {
    if (this.profil !== PROFIL.ADMIN) throw new ErreurFiche(403, 'ACCES_REFUSE', 'Paramétrage réservé au profil ADMIN');
    const def = this.#type(type).definition.chrono;
    if (!def) throw new ErreurFiche(422, 'CHRONO', `Les fiches ${type} n'ont pas de chrono`);
    const f = format?.trim() || null;
    const r = raz === 'A' ? 'A' : 'J';
    const e = controlerChrono({ format: f ?? def.format, raz: r });
    if (e) throw new ErreurFiche(422, 'CHRONO_FORMAT', e);
    this.chronosParametres.set(`${type}:${variante}`, { prefixe: prefixe?.trim() || null, format: f, raz: r });
    if (dernier !== null && dernier !== undefined) {
      const ch = this.#chrono(type, def.variante ? { [def.variante]: variante } : {});
      this.compteurs.set(this.#cleCompteur(type, { ...ch, portee: '' }, exerciceChrono(r, new Date(this.horloge()).getFullYear())), Number(dernier));
    }
    return this.chronos(type);
  }

  async parametrage(type) {
    this.#type(type);
    return structuredClone({ obligatoires: [], confidentiels: [], supplementaires: [], ...this.parametres[type] });
  }

  async enregistrerParametrage(type, p) {
    if (this.profil !== PROFIL.ADMIN) throw new ErreurFiche(403, 'ACCES_REFUSE', 'Paramétrage réservé au profil ADMIN');
    const codes = new Set();
    for (const c of p.supplementaires ?? []) {
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(c.code ?? '')) throw new ErreurFiche(422, 'CODE', `Code de champ invalide : ${c.code ?? ''} (minuscules, chiffres, _)`);
      if (codes.has(c.code) || this.#type(type).definition.champs.some((x) => x.code === c.code)) throw new ErreurFiche(422, 'CODE', `Code de champ déjà utilisé : ${c.code}`);
      if (!TYPES_SUPPLEMENTAIRES.includes(c.type)) throw new ErreurFiche(422, 'TYPE', `Type de champ invalide : ${c.type}`);
      if (!String(c.libelle ?? '').trim()) throw new ErreurFiche(422, 'LIBELLE', `Libellé obligatoire pour le champ ${c.code}`);
      if (c.type === 'liste' && c.requete?.trim()) {
        const e = erreurRequete(c.requete);
        if (e) throw new ErreurFiche(422, 'REQUETE', e);
      }
      codes.add(c.code);
    }
    const def = this.#type(type).definition;
    const programme = new Map(def.champs.map((c) => [c.code, c]));
    const sections = new Set((def.sections ?? []).map((s) => s.code));
    p = {
      ...p,
      confidentiels: (p.confidentiels ?? []).filter((c) => programme.has(c) && !programme.get(c).gere && !programme.get(c).confidentiel),
      supplementaires: (p.supplementaires ?? []).map((c) => ({
        ...c, requete: c.type === 'liste' && c.requete?.trim() ? c.requete.trim() : null,
        section: c.section && sections.has(c.section) ? c.section : null, groupe: c.groupe?.trim() || null,
      })),
    };
    this.parametres[type] = structuredClone(p);
    return this.parametrage(type);
  }
}

/** Conversion d'une valeur saisie au type du champ (nombre, booléen, vide = null). */
export function convertir(champ, v) {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  if (champ.type === 'nombre') return typeof v === 'number' ? v : Number(String(v).replace(/[\s  ]/g, '').replace(',', '.'));
  if (champ.type === 'booleen') return v === true || v === 'true';
  // Colonne jsonb : objet ou tableau conservé tel quel (texte JSON relu).
  if (champ.type === 'json') { if (typeof v !== 'string') return structuredClone(v); try { return JSON.parse(v); } catch { return v; } }
  return typeof v === 'string' ? v : String(v);
}
