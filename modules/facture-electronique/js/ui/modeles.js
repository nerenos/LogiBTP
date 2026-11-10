// Module Facturation électronique, interface : fonctions pures des écrans (paramètres, tableau des flux, détail,
// chronologie, dépôt et import manuels), testées sans navigateur. Le serveur reste juge : les contrôles ci-dessous
// évitent un aller-retour, les refus du serveur (PARAMETRE_INVALIDE, ETAT_FLUX_INVALIDE…) s'affichent tels quels.
import {
  CONNECTEUR_FE, SYNTAXE, PROFIL_FACTURE, DECOUPAGE_EREPORTING, SENS_FLUX, ETAT_FLUX, STATUT_CDV, EVENEMENT_FE, ACTEUR_FE,
  TYPE_DOCUMENT_FLUX, TYPE_FLUX, ETAT_ACCUSE,
} from '../src/codes.js';

/** Longueur maximale de l'Organization-Id (ConnecteurPlateforme.LongueurIdentifiant). */
export const LONGUEUR_ORGANISATION = 64;
export const FREQUENCE_RELEVE = Object.freeze({ min: 1, max: 1440 });
export const DELAI_SECONDES = Object.freeze({ min: 5, max: 600 });
/** Schéma de l'adresse électronique par défaut (EAS 0225, SchemaIdentifiant.AdresseElectronique). */
export const SCHEMA_ADRESSE_DEFAUT = '0225';

export const SYNTAXES_EMISSION = Object.freeze([SYNTAXE.CII, SYNTAXE.UBL, SYNTAXE.FACTUR_X]);
export const PROFILS_EMISSION = Object.freeze([PROFIL_FACTURE.BASIC, PROFIL_FACTURE.EN16931, PROFIL_FACTURE.EXTENDED_CTC_FR]);
/** Types de statut admis à l'import d'un CDAR (ConnecteurManuel.Importer). */
export const TYPES_STATUT_IMPORT = Object.freeze([TYPE_FLUX.CDV_FACTURE_CLIENT, TYPE_FLUX.CDV_FACTURE_FOURNISSEUR]);
/** Taille de page du tableau des flux. */
export const LIMITE_PAGE = 50;

/** Paramètres lus du serveur, complétés pour l'édition (ligne absente : valeurs de la table fe_parametre). */
export function parametresPourEdition(p = {}) {
  return {
    actif: false, connecteur: CONNECTEUR_FE.SIMULE, connexion_oauth: null, adresse_flux: null, adresse_annuaire: null,
    organisation: null, adresse_electronique: null, schema_adresse: SCHEMA_ADRESSE_DEFAUT, syntaxe: SYNTAXE.CII,
    profil: PROFIL_FACTURE.EN16931, frequence_releve: 15, delai_secondes: 30, decoupage_ereporting: DECOUPAGE_EREPORTING.UNIQUE,
    ...Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => v !== undefined)),
  };
}

/** Corps de PUT /parametres (sans la liste en lecture seule des connecteurs). */
export function corpsParametres(p) {
  const { connecteurs: _connecteurs, ...corps } = p;
  return corps;
}

// Blancs communs au JS et au C# (ReglesParametresFe.EstBlanc) : \s de JS (dont U+FEFF) + U+0085 et U+001C à U+001F.
const BLANCS = '\\s\\u0085\\u001C-\\u001F';
const DEBUT_FIN_BLANCS = new RegExp(`^[${BLANCS}]+|[${BLANCS}]+$`, 'g');
const UN_BLANC = new RegExp(`[${BLANCS}]`);
const rogner = (s) => String(s).replace(DEBUT_FIN_BLANCS, '');
const vide = (s) => s === null || s === undefined || rogner(s) === '';

/** Adresse vide, ou absolue en http(s) sans espace (ReglesParametresFe.AdresseValable). */
export function adresseValable(a) {
  if (vide(a)) return true;
  const t = rogner(a);
  if (UN_BLANC.test(t)) return false;
  try {
    const u = new URL(t);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

const entier = (v) => (typeof v === 'number' ? v : Number(v));
const horsBornes = (v, { min, max }) => !Number.isInteger(entier(v)) || entier(v) < min || entier(v) > max;

/**
 * Champs en défaut des paramètres, dans l'ordre du formulaire (vide = valables) ; miroir de ReglesParametresFe.Controler,
 * jeu partagé tests/cas/02_parametres.json. connecteurs : codes disponibles (fournis par le serveur).
 */
export function controlerParametres(p, connecteurs = Object.values(CONNECTEUR_FE)) {
  const champs = [];
  const afnor = p.connecteur === CONNECTEUR_FE.AFNOR;
  if (!connecteurs.includes(p.connecteur)) champs.push('connecteur');
  if (!adresseValable(p.adresse_flux) || (afnor && vide(p.adresse_flux))) champs.push('adresse_flux');
  if (!adresseValable(p.adresse_annuaire)) champs.push('adresse_annuaire');
  if (afnor && (p.connexion_oauth === null || p.connexion_oauth === undefined || p.connexion_oauth === '')) champs.push('connexion_oauth');
  if (!vide(p.organisation) && rogner(p.organisation).length > LONGUEUR_ORGANISATION) champs.push('organisation');
  if (!SYNTAXES_EMISSION.includes(p.syntaxe)) champs.push('syntaxe');
  if (!PROFILS_EMISSION.includes(p.profil)) champs.push('profil');
  if (horsBornes(p.frequence_releve, FREQUENCE_RELEVE)) champs.push('frequence_releve');
  if (horsBornes(p.delai_secondes, DELAI_SECONDES)) champs.push('delai_secondes');
  if (!Object.values(DECOUPAGE_EREPORTING).includes(p.decoupage_ereporting)) champs.push('decoupage_ereporting');
  return champs;
}

/** Vrai si les paramètres édités diffèrent de ceux du serveur. */
export function parametresModifies(edites, serveur) {
  return JSON.stringify(corpsParametres(parametresPourEdition(edites))) !== JSON.stringify(corpsParametres(parametresPourEdition(serveur)));
}

/** Durée de l'essai de santé (TimeSpan « [j.]hh:mm:ss[.fffffff] ») en millisecondes arrondies ; illisible : null. */
export function dureeMs(duree) {
  if (typeof duree === 'number') return Math.round(duree);
  const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(String(duree ?? ''));
  if (!m) return null;
  const [, j = '0', h, mi, s, f = '0'] = m;
  const fraction = Number(`0.${f}`);
  return Math.round((((Number(j) * 24 + Number(h)) * 60 + Number(mi)) * 60 + Number(s) + fraction) * 1000);
}

/* ---------------------------------------------------------------- tableau des flux */

/** Filtres du tableau (préférence d'affichage, gardée dans le navigateur). erreurs : '' (tous), 'true', 'false'. */
export const FILTRES_VIDES = Object.freeze({ sens: '', etat: '', type: '', statut: '', erreurs: '', du: '', au: '' });

/** Filtres lus d'une préférence : seules les clés connues, en texte. */
export function filtresValables(f) {
  const o = { ...FILTRES_VIDES };
  for (const k of Object.keys(FILTRES_VIDES)) if (typeof f?.[k] === 'string') o[k] = f[k];
  return o;
}

/**
 * Requête de GET /flux : filtres du serveur (sens, état, type, erreurs, jours de création du / au), page par
 * identifiant décroissant (avant). Le statut affiché se filtre sur les flux chargés (filtrerParStatut).
 */
export function requeteFlux(filtres, { avant = null, limite = LIMITE_PAGE } = {}) {
  const q = new URLSearchParams();
  const f = filtresValables(filtres);
  for (const k of ['sens', 'etat', 'type', 'erreurs', 'du', 'au']) if (f[k]) q.set(k, f[k]);
  if (avant !== null && avant !== undefined) q.set('avant', String(avant));
  q.set('limite', String(limite));
  return q.toString();
}

/** Flux dont le statut affiché est celui du filtre (vide : tous). */
export function filtrerParStatut(flux, statut) {
  return statut ? flux.filter((x) => x.statut_affiche === statut) : flux;
}

/** Page suivante possible : la page reçue est pleine ; identifiant à passer en « avant ». */
export function pageSuivante(page, limite = LIMITE_PAGE) {
  return page.length >= limite ? page[page.length - 1].id : null;
}

/** Ajoute une page aux flux déjà chargés, sans doublon (identifiant). */
export function ajouterPage(flux, page) {
  const vus = new Set(flux.map((x) => x.id));
  return [...flux, ...page.filter((x) => !vus.has(x.id))];
}

/** Gravité d'un état de file, pour la pastille : erreur, attente, succes, neutre. */
export function graviteEtat(etat) {
  if (etat === ETAT_FLUX.ERREUR) return 'erreur';
  if (etat === ETAT_FLUX.A_ENVOYER || etat === ETAT_FLUX.ENVOYE || etat === ETAT_FLUX.RECU) return 'attente';
  if (etat === ETAT_FLUX.ACQUITTE || etat === ETAT_FLUX.TRAITE) return 'succes';
  return 'neutre';
}

/** Gravité d'un statut de cycle de vie : refus et rejets en erreur, litige et suspension en attente. */
export function graviteStatut(code) {
  if ([STATUT_CDV.REJETEE, STATUT_CDV.REFUSEE, STATUT_CDV.IRRECEVABLE, STATUT_CDV.ERREUR_ROUTAGE].includes(code)) return 'erreur';
  if ([STATUT_CDV.EN_LITIGE, STATUT_CDV.SUSPENDUE, STATUT_CDV.APPROUVEE_PARTIELLEMENT].includes(code)) return 'attente';
  if ([STATUT_CDV.APPROUVEE, STATUT_CDV.PAIEMENT_TRANSMIS, STATUT_CDV.ENCAISSEE].includes(code)) return 'succes';
  return code ? 'neutre' : '';
}

/**
 * Actions permises sur un flux, comme le serveur les accepte : nouvelle tentative (flux sortant en erreur ou à envoyer,
 * ServiceFactureElectronique.NouvelleTentative), confirmation d'un dépôt manuel (connecteur MANUEL, envoyé, identifiant
 * de dépôt connu, ConfirmerDepotManuel), téléchargement du fichier à déposer (dépôt manuel en attente).
 */
export function actionsFlux(flux) {
  const sortant = flux?.sens === SENS_FLUX.SORTANT;
  const manuelEnAttente = flux?.connecteur === CONNECTEUR_FE.MANUEL && flux?.etat === ETAT_FLUX.ENVOYE && Boolean(flux?.id_flux);
  return {
    tentative: sortant && (flux.etat === ETAT_FLUX.ERREUR || flux.etat === ETAT_FLUX.A_ENVOYER),
    confirmerDepot: sortant && manuelEnAttente,
    aDeposer: sortant && manuelEnAttente,
  };
}

/** Flux à déposer à la main sur le portail de la PA (dépôts manuels en attente d'accusé). */
export const depotsEnAttente = (flux) => flux.filter((x) => actionsFlux(x).confirmerDepot);

/**
 * Documents proposés au téléchargement : fichiers gardés, puis Converted et ReadableView d'un flux de plateforme
 * (téléchargés à la demande par le serveur). Original toujours en tête.
 */
export function documentsFlux(flux, fichiers = []) {
  const gardes = new Map(fichiers.map((f) => [f.document, f]));
  const docs = [TYPE_DOCUMENT_FLUX.ORIGINAL];
  const plateforme = Boolean(flux?.id_flux) && flux?.connecteur !== CONNECTEUR_FE.MANUEL;
  for (const d of [TYPE_DOCUMENT_FLUX.CONVERTI, TYPE_DOCUMENT_FLUX.LISIBLE]) if (gardes.has(d) || plateforme) docs.push(d);
  return docs.map((d) => ({ document: d, fichier: gardes.get(d) ?? null }));
}

/** Taille d'un fichier en Ko (une décimale, au moins 0,1). */
export const tailleKo = (octets) => Math.max(0.1, Math.round((Number(octets) || 0) / 102.4) / 10);

/* ---------------------------------------------------------------- chronologie */

/** Jour local (AAAA-MM-JJ) d'un horodatage. */
export function jourLocal(horodatage) {
  const d = new Date(horodatage);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/** Événements du journal par rang croissant, regroupés par jour local : [{ jour, evenements }]. */
export function grouperParJour(evenements = []) {
  const tries = [...evenements].sort((a, b) => a.rang - b.rang);
  const jours = [];
  for (const e of tries) {
    const jour = jourLocal(e.horodatage);
    if (jours.at(-1)?.jour !== jour) jours.push({ jour, evenements: [] });
    jours.at(-1).evenements.push(e);
  }
  return jours;
}

/** Nature d'un état avant / après dans le journal : état de la file, statut de cycle de vie (étapes STATUT_*), autre. */
export function natureEtat(valeur) {
  if (Object.values(ETAT_FLUX).includes(valeur)) return 'etat';
  if (Object.values(STATUT_CDV).includes(valeur)) return 'statut';
  return 'autre';
}

/** Changement d'état d'un événement : { avant, apres, change } (change : faux si identiques ou tous deux absents). */
export function transition(e) {
  const avant = e.etat_avant ?? null;
  const apres = e.etat_apres ?? null;
  return { avant, apres, change: avant !== apres };
}

/** Classe d'affichage d'un événement : erreur, plateforme, utilisateur ou systeme. */
export function classeEvenement(e) {
  if (e.type === EVENEMENT_FE.ERREUR) return 'erreur';
  if (e.acteur === ACTEUR_FE.PLATEFORME) return 'plateforme';
  if (e.acteur === ACTEUR_FE.UTILISATEUR) return 'utilisateur';
  return 'systeme';
}

/**
 * Détail JSON d'un événement à plat : [[chemin, valeur]] (objets parcourus par « . », tableaux de valeurs joints par
 * « , », tableaux d'objets indicés), valeurs nulles omises.
 */
export function champsDetail(detail, prefixe = '') {
  if (detail === null || detail === undefined) return [];
  if (typeof detail !== 'object') return [[prefixe || 'valeur', String(detail)]];
  if (Array.isArray(detail)) return detail.flatMap((x, i) => champsDetail(x, prefixe ? `${prefixe}[${i + 1}]` : String(i + 1)));
  const champs = [];
  for (const [k, v] of Object.entries(detail)) {
    const chemin = prefixe ? `${prefixe}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.every((x) => x === null || typeof x !== 'object')) { if (v.length) champs.push([chemin, v.join(', ')]); }
      else v.forEach((x, i) => champs.push(...champsDetail(x, `${chemin}[${i + 1}]`)));
    } else if (typeof v === 'object') champs.push(...champsDetail(v, chemin));
    else champs.push([chemin, String(v)]);
  }
  return champs;
}

/** Empreinte abrégée pour l'affichage (12 premiers caractères). */
export const empreinteCourte = (e) => (e ? String(e).slice(0, 12) : '');

/* ---------------------------------------------------------------- dépôt et import manuels */

/** Contenu binaire (ArrayBuffer ou Uint8Array) en base 64, pour POST /import. */
export function base64(contenu) {
  const octets = contenu instanceof Uint8Array ? contenu : new Uint8Array(contenu);
  let s = '';
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Corps de POST /flux/{id}/depot-manuel : accusé Ok, ou Error avec motif et message. */
export function corpsConfirmation({ etat, motif = null, message = null }) {
  return etat === ETAT_ACCUSE.OK ? { etat } : { etat, motif: motif || null, message: (message ?? '').trim() || null };
}
