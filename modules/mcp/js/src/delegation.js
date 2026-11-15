// Règles de délégation des droits à un agent IA, répliquées dans ReglesDelegation.cs
// (jeu partagé modules/mcp/tests/cas/01_delegation.json).
//
// Droits d'un profil (module Droits, repris par contrat, sans dépendance) : { total, lignes: { nœud: { ACTION: PORTÉE } } } ;
// un nœud sans ligne hérite de son plus proche ancêtre qui en a une. Plafond d'une délégation : { modele, actions, portee }
// (`actions` : { nœud: [ACTIONS] } pour SUR_MESURE, même héritage ; `portee` : portée maximale, TOUT par défaut).
// Droits effectifs de l'agent = intersection du profil et du plafond par nœud et action (portée la plus étroite), moins
// les interdits absolus (§ 5.1 de l'analyse) et les garde-fous actifs (§ 5.2). Le module Droits les applique (lot 3).

import { ACTION_DROIT, PORTEE_DROIT, GARDE_FOU, MODELE_PLAFOND, ajouterJours } from '@logibtp/socle';
import { CLASSE_OUTIL, ERREUR_MCP } from './codes.js';

/** Échéance d'une délégation : 30 jours par défaut, 90 au plus. */
export const ECHEANCE_DEFAUT = 30;
export const ECHEANCE_MAX = 90;

/** Quotas du garde-fou VOLUME : éléments par appel, par jour et par délégation, alerte en pourcentage du quota du jour. */
export const QUOTA_APPEL = 200;
export const QUOTA_JOUR = 5000;
export const ALERTE_QUOTA = 80;

/** Nœuds interdits à un agent, quelle que soit l'action (préfixes : le nœud et ses descendants). */
export const NOEUDS_INTERDITS = Object.freeze(['administration', 'connexions', 'mail']);

/** Nœuds en lecture seule pour un agent (paramétrage : SQL exécuté par le serveur, règles des droits). */
export const NOEUDS_LECTURE_SEULE = Object.freeze(['parametres']);

/** Actions jamais délégables. */
export const ACTIONS_INTERDITES = Object.freeze([
  ACTION_DROIT.FORCER, ACTION_DROIT.USURPER, ACTION_DROIT.PARAMETRER, ACTION_DROIT.DEVERROUILLER,
]);

/** Actions retirées par un garde-fou actif. */
const RETIREES = Object.freeze({
  [GARDE_FOU.VALIDATION]: [ACTION_DROIT.VALIDER, ACTION_DROIT.SUPPRIMER, ACTION_DROIT.DEVALIDER],
  [GARDE_FOU.RGPD]: [ACTION_DROIT.RGPD, ACTION_DROIT.CONFIDENTIEL],
});

/** Noms d'actions employés par les modules, ramenés aux actions du modèle (même table que le module Droits). */
const ALIAS = Object.freeze({
  [ACTION_DROIT.VOIR]: ACTION_DROIT.CONSULTER,
  [ACTION_DROIT.TRANSFORMER]: ACTION_DROIT.CONSULTER,
  [ACTION_DROIT.APPROUVER]: ACTION_DROIT.VALIDER,
  [ACTION_DROIT.DEVALIDER]: ACTION_DROIT.DEVERROUILLER,
  [ACTION_DROIT.DEBLOQUER]: ACTION_DROIT.DEVERROUILLER,
  [ACTION_DROIT.CONFIDENTIEL]: ACTION_DROIT.RGPD,
});

const PREPARATION = Object.freeze([ACTION_DROIT.CONSULTER, ACTION_DROIT.CREER, ACTION_DROIT.MODIFIER]);
const PORTEES = Object.freeze([PORTEE_DROIT.SOI, PORTEE_DROIT.EQUIPE, PORTEE_DROIT.SERVICE, PORTEE_DROIT.TOUT]);
const MODELES = Object.values(MODELE_PLAFOND);
const ACTIONS = Object.values(ACTION_DROIT);
const rang = (p) => PORTEES.indexOf(p);
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function normaliserAction(action) {
  const a = String(action ?? '').trim().toUpperCase();
  return ALIAS[a] ?? a;
}

/** Le nœud est le préfixe ou l'un de ses descendants. */
const sous = (noeud, prefixe) => noeud === prefixe || noeud.startsWith(`${prefixe}/`);

/** Ligne du nœud ou de son plus proche ancêtre (null : aucune). */
function ligneDe(lignes, noeud) {
  for (let n = noeud; n; n = n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : null) {
    if (Object.hasOwn(lignes ?? {}, n)) return lignes[n];
  }
  return null;
}

/**
 * Actions permises par un modèle de plafond : LECTURE → CONSULTER ; PREPARATION → CONSULTER, CREER, MODIFIER ;
 * COMME_MOI et SUR_MESURE → null (non bornées par le modèle) ; modèle inconnu → aucune.
 */
export function actionsModele(modele) {
  if (modele === MODELE_PLAFOND.LECTURE) return [ACTION_DROIT.CONSULTER];
  if (modele === MODELE_PLAFOND.PREPARATION) return [...PREPARATION];
  if (modele === MODELE_PLAFOND.COMME_MOI || modele === MODELE_PLAFOND.SUR_MESURE) return null;
  return [];
}

/** Garde-fous actifs : tous, sauf ceux levables pour le profil **et** levés par la délégation (double accord). */
export function gardesFousActifs(levables, leves) {
  const l = new Set(levables ?? []);
  const v = new Set(leves ?? []);
  return Object.values(GARDE_FOU).filter((g) => !(l.has(g) && v.has(g)));
}

/**
 * Interdit absolu (jamais levable) : nœuds d'administration, de connexions et de messagerie, paramétrage en écriture,
 * actions FORCER, USURPER, PARAMETRER, DEVERROUILLER ; plus les interdits fournis par la spécialisation (codes
 * d'action ou préfixes de nœuds).
 */
export function estInterdit(noeud, action, interdits = []) {
  const brute = String(action ?? '').trim().toUpperCase();
  const a = normaliserAction(brute);
  if (ACTIONS_INTERDITES.includes(brute) || ACTIONS_INTERDITES.includes(a)) return true;
  if (NOEUDS_INTERDITS.some((p) => sous(noeud, p))) return true;
  if (a !== ACTION_DROIT.CONSULTER && NOEUDS_LECTURE_SEULE.some((p) => sous(noeud, p))) return true;
  for (const i of interdits ?? []) {
    if (ACTIONS.includes(i) ? brute === i || a === i : sous(noeud, i)) return true;
  }
  return false;
}

/** Nœuds retenus par les garde-fous actifs (fournis par la spécialisation : { GARDE_FOU: [nœuds] }). */
const retenus = (gardesFous, noeuds) => (gardesFous ?? []).flatMap((g) => noeuds?.[g] ?? []);

const egales = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
};

/**
 * Droits effectifs d'un agent : { total: false, lignes } (même forme que les droits d'un profil, lignes redondantes
 * retirées). `options` : `catalogue` { nœud: [actions] } (développe un profil total), `noeuds` { GARDE_FOU: [nœuds] }
 * (un nœud retenu par un garde-fou actif perd toutes ses actions : sans lecture, pas d'écriture), `interdits`.
 * Profil total : jamais COMME_MOI (rien), SUR_MESURE borné à la préparation. Modèle inconnu : rien.
 */
export function droitsEffectifs(droitsProfil, plafond, gardesFous = [], options = {}) {
  const total = Boolean(droitsProfil?.total);
  const modele = plafond?.modele;
  if (!MODELES.includes(modele) || (total && modele === MODELE_PLAFOND.COMME_MOI)) return { total: false, lignes: {} };
  const porteeMax = plafond?.portee == null ? PORTEE_DROIT.TOUT : (PORTEES.includes(plafond.portee) ? plafond.portee : PORTEE_DROIT.SOI);
  const lignesProfil = total
    ? Object.fromEntries(Object.entries(options.catalogue ?? {}).map(([n, a]) => [n, Object.fromEntries(a.map((x) => [x, PORTEE_DROIT.TOUT]))]))
    : (droitsProfil?.lignes ?? {});
  const permises = actionsModele(modele) ?? (total ? [...PREPARATION] : null);
  const lignesPlafond = modele === MODELE_PLAFOND.SUR_MESURE
    ? Object.fromEntries(Object.entries(plafond?.actions ?? {}).map(([n, a]) => [n, (a ?? []).map(normaliserAction)]))
    : null;
  const retirees = new Set((gardesFous ?? []).flatMap((g) => RETIREES[g] ?? []));
  const noeudsRetenus = retenus(gardesFous, options.noeuds);
  const interdits = options.interdits ?? [];
  const noeuds = new Set([
    ...Object.keys(lignesProfil), ...Object.keys(lignesPlafond ?? {}), ...noeudsRetenus,
    ...NOEUDS_INTERDITS, ...NOEUDS_LECTURE_SEULE, ...interdits.filter((i) => !ACTIONS.includes(i)),
  ]);
  const lignes = {};
  for (const n of [...noeuds].sort(ordinal)) {
    const ligne = {};
    if (!noeudsRetenus.some((r) => sous(n, r))) {
      const p = ligneDe(lignesProfil, n) ?? {};
      const q = lignesPlafond ? (ligneDe(lignesPlafond, n) ?? []) : null;
      for (const a of Object.keys(p).sort(ordinal)) {
        const norm = normaliserAction(a);
        if (rang(p[a]) < 0) continue;
        if (permises && !permises.includes(norm)) continue;
        if (q && !q.includes(norm)) continue;
        if (retirees.has(a) || retirees.has(norm)) continue;
        if (estInterdit(n, a, interdits)) continue;
        ligne[a] = rang(p[a]) <= rang(porteeMax) ? p[a] : porteeMax;
      }
    }
    lignes[n] = ligne;
  }
  // Lignes égales à ce que le nœud hériterait de son plus proche ancêtre (ou vides sans ancêtre) : retirées.
  const redondants = Object.keys(lignes).filter((n) => {
    const i = n.lastIndexOf('/');
    const herite = (i < 0 ? null : ligneDe(lignes, n.slice(0, i))) ?? {};
    return egales(lignes[n], herite);
  });
  for (const n of redondants) delete lignes[n];
  return { total: false, lignes };
}

/** Action permise à l'agent (droits effectifs) sur le nœud avec au moins la portée demandée. */
export function autoriseAgent(effectifs, noeud, action, porteeMin = PORTEE_DROIT.SOI) {
  const p = ligneDe(effectifs?.lignes, noeud)?.[normaliserAction(action)];
  return p != null && rang(p) >= rang(porteeMin);
}

/**
 * Contrôle d'une délégation { modele, jours, leves } au regard du délégant { total, modeles (permis, null : tous),
 * levables, jours_max } : codes d'erreur (ERREUR_MCP), dans l'ordre.
 */
export function controlerDelegation(delegation, delegant) {
  const erreurs = [];
  const m = delegation?.modele;
  if (!MODELES.includes(m)) erreurs.push(ERREUR_MCP.MCP_MODELE_INCONNU);
  else if (delegant?.modeles && !delegant.modeles.includes(m)) erreurs.push(ERREUR_MCP.MCP_MODELE_NON_PERMIS);
  if (delegant?.total && m === MODELE_PLAFOND.COMME_MOI) erreurs.push(ERREUR_MCP.MCP_ADMIN_COMME_MOI);
  const max = Math.min(delegant?.jours_max ?? ECHEANCE_MAX, ECHEANCE_MAX);
  const j = delegation?.jours;
  if (j != null && (!Number.isInteger(j) || j < 1 || j > max)) erreurs.push(ERREUR_MCP.MCP_ECHEANCE);
  const levables = delegant?.levables ?? [];
  if ((delegation?.leves ?? []).some((g) => !levables.includes(g))) erreurs.push(ERREUR_MCP.MCP_GARDE_FOU_NON_LEVABLE);
  return erreurs;
}

/** Date d'échéance (AAAA-MM-JJ) : début + jours (30 par défaut), bornés à 1 et au maximum du profil (90 au plus). */
export function echeanceDelegation(debut, jours = null, joursMax = null) {
  const max = Math.min(joursMax ?? ECHEANCE_MAX, ECHEANCE_MAX);
  const j = Math.max(1, Math.min(jours ?? ECHEANCE_DEFAUT, max));
  return ajouterJours(debut, j);
}

/**
 * Quota d'un appel (garde-fou VOLUME) : éléments accordés sur ceux demandés, compte tenu de ceux déjà lus dans la
 * journée ; `tronque` si moins que demandé, erreur MCP_QUOTA_JOUR si le quota du jour est épuisé, `alerte` à partir
 * du seuil d'alerte (pourcentage du quota du jour, après l'appel).
 */
export function appliquerQuota(demandes, dejaDuJour, quotas = {}) {
  const appel = quotas?.appel ?? QUOTA_APPEL;
  const jour = quotas?.jour ?? QUOTA_JOUR;
  const alerte = quotas?.alerte ?? ALERTE_QUOTA;
  const reste = Math.max(0, jour - dejaDuJour);
  const accordes = Math.max(0, Math.min(demandes, appel, reste));
  return {
    accordes,
    tronque: accordes < demandes,
    erreur: reste === 0 && demandes > 0 ? ERREUR_MCP.MCP_QUOTA_JOUR : null,
    alerte: (dejaDuJour + accordes) * 100 >= alerte * jour,
  };
}

/**
 * Classement d'un outil { noeud, action, envoi } pour un agent : INTERDIT (interdit absolu ou sans droit), LECTURE
 * (CONSULTER permis), BROUILLON (écriture permise), PROPOSITION (action retenue seulement par le garde-fou ENVOI ou
 * VALIDATION, que le délégant pourrait faire : un humain la fera ; jamais pour un plafond LECTURE ni un nœud retenu).
 */
export function classerOutil(outil, droitsProfil, plafond, gardesFous = [], options = {}) {
  const noeud = outil?.noeud ?? '';
  const brute = String(outil?.action ?? '').trim().toUpperCase();
  const a = normaliserAction(brute);
  if (estInterdit(noeud, brute, options.interdits)) return CLASSE_OUTIL.INTERDIT;
  const actifs = new Set(gardesFous ?? []);
  const total = Boolean(droitsProfil?.total);
  const modele = plafond?.modele;
  const proposable = MODELES.includes(modele) && modele !== MODELE_PLAFOND.LECTURE && !(total && modele === MODELE_PLAFOND.COMME_MOI)
    && (total || ligneDe(droitsProfil?.lignes, noeud)?.[a] != null)
    && !retenus(gardesFous, options.noeuds).some((r) => sous(noeud, r));
  if (outil?.envoi && actifs.has(GARDE_FOU.ENVOI)) return proposable ? CLASSE_OUTIL.PROPOSITION : CLASSE_OUTIL.INTERDIT;
  if (autoriseAgent(droitsEffectifs(droitsProfil, plafond, gardesFous, options), noeud, a)) {
    return a === ACTION_DROIT.CONSULTER ? CLASSE_OUTIL.LECTURE : CLASSE_OUTIL.BROUILLON;
  }
  const validation = RETIREES[GARDE_FOU.VALIDATION];
  if (actifs.has(GARDE_FOU.VALIDATION) && (validation.includes(brute) || validation.includes(a)) && proposable) return CLASSE_OUTIL.PROPOSITION;
  return CLASSE_OUTIL.INTERDIT;
}
