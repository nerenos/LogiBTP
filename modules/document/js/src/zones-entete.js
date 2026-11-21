// Zones supplémentaires d'entête des documents, en colonnes « x_ » de `document` (plan fiches-lignes-documents, lot 10).
// Règles répliquées dans ZonesEntete.cs (jeu partagé tests/zones/01_zones_entete.json) : nom de colonne, validation d'une
// création ou d'une modification, portée (global, famille, type) et zones applicables à un document. Les contrôles
// faisant foi sont ceux du serveur (422 VALIDATION) et des fonctions SQL ; le reste (nom proposé, valeurs d'une liste
// saisies en lignes, champ d'écran d'une erreur) sert l'écran de paramétrage.
import { ERREUR_ZONE_ENTETE, PORTEE_ZONE_ENTETE, TYPE_ZONE_ENTETE } from './codes.js';

export const PREFIXE_ZONE = 'x_';
/** Longueur maximale d'un nom de colonne : « x_ » + une lettre + 40 caractères (`^x_[a-z][a-z0-9_]{0,40}$`). */
export const LONGUEUR_COLONNE_ZONE = 43;
export const LONGUEUR_LIBELLE_ZONE = 100;
export const LONGUEUR_VALEUR_ZONE = 200;
const FAMILLES = ['V', 'A', 'S', 'E', 'T'];

export const nomZoneValide = (colonne) => typeof colonne === 'string' && /^x_[a-z][a-z0-9_]{0,40}$/.test(colonne);

/** Portée d'une zone : TYPE si un type est fixé, FAMILLE si une famille l'est, sinon GLOBAL. */
export function porteeZone(zone) {
  if (zone?.type_document) return PORTEE_ZONE_ENTETE.TYPE;
  if (zone?.famille) return PORTEE_ZONE_ENTETE.FAMILLE;
  return PORTEE_ZONE_ENTETE.GLOBAL;
}

/**
 * Valeurs d'une liste : au moins une, sans doublon, valeur non vide et de 200 caractères au plus. Retour : liste de
 * `{ champ, code }` (vide si tout va bien).
 */
export function erreursValeursZone(valeurs, champ = '') {
  if (!Array.isArray(valeurs) || valeurs.length === 0) return [{ champ, code: ERREUR_ZONE_ENTETE.VALEURS }];
  const erreurs = [];
  const vues = new Set();
  for (const v of valeurs) {
    const valeur = v?.valeur;
    if (typeof valeur !== 'string' || valeur.trim() === '' || valeur.length > LONGUEUR_VALEUR_ZONE) erreurs.push({ champ, code: ERREUR_ZONE_ENTETE.VALEURS });
    else if (vues.has(valeur)) erreurs.push({ champ, code: ERREUR_ZONE_ENTETE.VALEURS });
    else vues.add(valeur);
  }
  return erreurs;
}

/** Erreurs du libellé : obligatoire, 100 caractères au plus. */
function erreurLibelle(libelle, champ) {
  const l = String(libelle ?? '').trim();
  return l === '' || l.length > LONGUEUR_LIBELLE_ZONE ? [{ champ, code: ERREUR_ZONE_ENTETE.LIBELLE_OBLIGATOIRE }] : [];
}

/** Erreurs de portée : une famille connue ou un type, pas les deux. */
function erreursPortee(zone, champ) {
  if (zone.famille && zone.type_document) return [{ champ, code: ERREUR_ZONE_ENTETE.PORTEE_INVALIDE }];
  if (zone.famille && !FAMILLES.includes(zone.famille)) return [{ champ, code: ERREUR_ZONE_ENTETE.PORTEE_INVALIDE }];
  return [];
}

/**
 * Erreurs d'une demande de création `{ colonne, type, libelle, valeurs, famille, type_document }` (hors existence du
 * type de document et de la colonne, contrôlées avec la base).
 */
export function erreursCreationZone(zone) {
  const champ = zone.colonne ?? '';
  const erreurs = [];
  if (!nomZoneValide(zone.colonne)) erreurs.push({ champ, code: ERREUR_ZONE_ENTETE.NOM_INVALIDE });
  if (!Object.values(TYPE_ZONE_ENTETE).includes(zone.type)) erreurs.push({ champ, code: ERREUR_ZONE_ENTETE.TYPE_INVALIDE });
  erreurs.push(...erreurLibelle(zone.libelle, champ));
  if (zone.type === TYPE_ZONE_ENTETE.LISTE) erreurs.push(...erreursValeursZone(zone.valeurs, champ));
  erreurs.push(...erreursPortee(zone, champ));
  return erreurs;
}

/** Erreurs d'une modification (libellé, valeurs d'une liste, portée) d'une zone de type connu. */
export function erreursModificationZone(zone, type) {
  const champ = zone.colonne ?? '';
  const erreurs = erreurLibelle(zone.libelle, champ);
  if (type === TYPE_ZONE_ENTETE.LISTE) erreurs.push(...erreursValeursZone(zone.valeurs, champ));
  erreurs.push(...erreursPortee(zone, champ));
  return erreurs;
}

/** La zone s'applique-t-elle à un document de cette famille et de ce type (code) ? Une zone inactive jamais. */
export function zoneApplicable(zone, famille, typeDocument) {
  if (zone.actif === false) return false;
  switch (porteeZone(zone)) {
    case PORTEE_ZONE_ENTETE.TYPE: return zone.type_document === typeDocument;
    case PORTEE_ZONE_ENTETE.FAMILLE: return zone.famille === famille;
    default: return true;
  }
}

/** Zones actives d'un document (famille, type), dans l'ordre : groupe (sans groupe d'abord, ordre des caractères), ordre, colonne. */
export function zonesDuType(zones, famille, typeDocument) {
  const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return (zones ?? []).filter((z) => zoneApplicable(z, famille, typeDocument))
    .sort((a, b) => ordinal(a.groupe ?? '', b.groupe ?? '') || (a.ordre ?? 0) - (b.ordre ?? 0) || ordinal(a.colonne, b.colonne));
}

/** Nom technique proposé d'après le libellé : sans accent, minuscules, tirets bas, préfixe « x_ ». */
export function proposerColonneZone(libelle) {
  const base = String(libelle ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const sansChiffre = /^[0-9]/.test(base) ? `n_${base}` : base;
  const nom = (PREFIXE_ZONE + sansChiffre).slice(0, LONGUEUR_COLONNE_ZONE);
  return nom.length > PREFIXE_ZONE.length ? nom.replace(/_+$/, '') : nom;
}

/** Valeurs d'une liste saisies une par ligne (« valeur » ou « valeur | libellé »). */
export function lireValeursZone(saisie) {
  return String(saisie ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf('|');
    const valeur = (i < 0 ? l : l.slice(0, i)).trim();
    const libelle = i < 0 ? '' : l.slice(i + 1).trim();
    return { valeur, libelle: libelle || valeur };
  });
}

/** Inverse de `lireValeursZone`. */
export function ecrireValeursZone(valeurs) {
  return (valeurs ?? []).map((o) => (o.libelle && o.libelle !== o.valeur ? `${o.valeur} | ${o.libelle}` : o.valeur)).join('\n');
}

/** Contrôle de l'écran qui porte une erreur du serveur (`colonne`, `type`, `libelle`, `valeurs`, `portee`). */
export function controleDeErreurZone(code) {
  switch (code) {
    case ERREUR_ZONE_ENTETE.TYPE_INVALIDE: return 'type';
    case ERREUR_ZONE_ENTETE.LIBELLE_OBLIGATOIRE: return 'libelle';
    case ERREUR_ZONE_ENTETE.VALEURS: return 'valeurs';
    case ERREUR_ZONE_ENTETE.PORTEE_INVALIDE: return 'portee';
    default: return 'colonne';
  }
}

/** Demande de création d'après la saisie de l'écran. */
export function demandeCreationZone({ colonne, type, libelle, groupe, ordre, obligatoire, valeurs, famille, typeDocument }) {
  return {
    colonne: String(colonne ?? '').trim(), type, libelle: String(libelle ?? '').trim(), groupe: String(groupe ?? '').trim() || null,
    ordre: Number.parseInt(ordre, 10) || 0, obligatoire: !!obligatoire && type !== TYPE_ZONE_ENTETE.CASE_A_COCHER,
    valeurs: type === TYPE_ZONE_ENTETE.LISTE ? lireValeursZone(valeurs) : null,
    famille: famille || null, type_document: typeDocument || null,
  };
}

// ------------------------------------------------------------------ valeurs saisies d'un document (lot 11)

const estVide = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

function dateValide(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mo - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j;
}

/** Une valeur non vide convient-elle au type de la zone ? (texte, liste d'une valeur connue, nombre, montant de 16 chiffres au plus, date AAAA-MM-JJ, booléen). */
export function valeurZoneValide(zone, valeur) {
  switch (zone.type) {
    case TYPE_ZONE_ENTETE.TEXTE: return typeof valeur === 'string';
    case TYPE_ZONE_ENTETE.LISTE: return typeof valeur === 'string' && (zone.valeurs ?? []).some((o) => o.valeur === valeur);
    case TYPE_ZONE_ENTETE.NOMBRE: return typeof valeur === 'number' && Number.isFinite(valeur);
    case TYPE_ZONE_ENTETE.MONTANT: return typeof valeur === 'number' && Number.isFinite(valeur) && Math.abs(valeur) < 1e16;
    case TYPE_ZONE_ENTETE.DATE: return typeof valeur === 'string' && dateValide(valeur);
    case TYPE_ZONE_ENTETE.CASE_A_COCHER: return typeof valeur === 'boolean';
    default: return false;
  }
}

/**
 * Erreurs des valeurs d'un document de cette famille et de ce type : `{ champ: colonne, code }` dans l'ordre des zones.
 * Une valeur non vide du mauvais type ou hors liste : ZONE_VALEUR_INVALIDE (toujours) ; une zone obligatoire vide :
 * ZONE_OBLIGATOIRE (à la validation seulement, `validation` vrai ; jamais pour une case à cocher).
 */
export function erreursSaisieZones(zones, famille, typeDocument, valeurs, validation = false) {
  const erreurs = [];
  for (const z of zonesDuType(zones, famille, typeDocument)) {
    const v = valeurs?.[z.colonne];
    if (estVide(v)) {
      if (validation && z.obligatoire && z.type !== TYPE_ZONE_ENTETE.CASE_A_COCHER) erreurs.push({ champ: z.colonne, code: ERREUR_ZONE_ENTETE.OBLIGATOIRE });
    } else if (!valeurZoneValide(z, v)) erreurs.push({ champ: z.colonne, code: ERREUR_ZONE_ENTETE.VALEUR_INVALIDE });
  }
  return erreurs;
}

/** Valeurs à reprendre d'un document dans un autre (copie, indice, transformation) : celles des zones qui existent dans le type cible. */
export function zonesReprises(zones, valeurs, famille, typeDocument) {
  const reprises = {};
  for (const z of zonesDuType(zones, famille, typeDocument)) if (!estVide(valeurs?.[z.colonne])) reprises[z.colonne] = valeurs[z.colonne];
  return reprises;
}
