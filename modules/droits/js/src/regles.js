// Règles des droits (module Droits), répliquées dans ReglesDroits.cs (jeu partagé modules/droits/tests/cas/01_droits.json).
//
// Arbre des droits : un nœud est un chemin « module/élément » (documents/V_DEVIS, fiches/salarie, administration/profils).
// Un profil porte des lignes { nœud: { ACTION: PORTÉE } } ; un nœud sans ligne hérite de son plus proche ancêtre qui en
// a une (« hérité »), un nœud avec une ligne garde la sienne (« propre », même vide). Un profil total (ADMIN) a tout.

/** Actions en cascade (l'interface coche les précédentes) ; les nœuds peuvent déclarer des actions supplémentaires (RGPD…). */
export const ACTIONS = Object.freeze(['CONSULTER', 'MODIFIER', 'VALIDER', 'CREER', 'SUPPRIMER', 'DEVERROUILLER', 'FORCER']);

/** Portées, de la plus étroite à la plus large. */
export const PORTEES = ['SOI', 'EQUIPE', 'SERVICE', 'TOUT'];

/** Noms d'actions employés par les modules, ramenés aux actions du modèle. */
export const ALIAS_ACTIONS = {
  VOIR: 'CONSULTER', TRANSFORMER: 'CONSULTER', APPROUVER: 'VALIDER', DEVALIDER: 'DEVERROUILLER', DEBLOQUER: 'DEVERROUILLER',
  CONFIDENTIEL: 'RGPD',
};

export const LIBELLES_ACTIONS = {
  CONSULTER: 'Consulter', MODIFIER: 'Modifier', VALIDER: 'Valider', CREER: 'Créer', SUPPRIMER: 'Supprimer',
  DEVERROUILLER: 'Déverrouiller', FORCER: 'Forcer', RGPD: 'Données RGPD', SUPERVISER: 'Superviser', USURPER: 'Usurper',
  MODIFIER_CODE: 'Modifier le code',
};

export const LIBELLES_PORTEES = { SOI: 'Soi', EQUIPE: 'Son équipe', SERVICE: 'Son service', TOUT: 'Tout' };

export const MESSAGES_DROITS = {
  PROFIL_CODE: 'Code du profil : 2 à 30 caractères, une lettre puis lettres, chiffres ou _ (majuscules)',
  PROFIL_LIBELLE: 'Libellé du profil obligatoire (100 caractères au plus)',
  NOEUD_INVALIDE: 'Nœud de droits invalide',
  ACTION_INCONNUE: 'Action inconnue pour ce nœud',
  PORTEE_INCONNUE: 'Portée inconnue (SOI, EQUIPE, SERVICE ou TOUT)',
};

const rang = (p) => PORTEES.indexOf(p);

export function normaliserAction(action) {
  const a = String(action ?? '').trim().toUpperCase();
  return ALIAS_ACTIONS[a] ?? a;
}

/** Nœud parent (null pour une racine). */
export function parent(noeud) {
  const i = noeud.lastIndexOf('/');
  return i < 0 ? null : noeud.slice(0, i);
}

/** Le nœud puis ses ancêtres, jusqu'à la racine. */
export function ancetres(noeud) {
  const liste = [];
  for (let n = noeud; n; n = parent(n)) liste.push(n);
  return liste;
}

/**
 * Actions effectives d'un nœud pour des droits { total, lignes } : celles de la ligne du nœud ou du plus proche ancêtre
 * qui en a une ; `source` = nœud de cette ligne (null : aucune, rien n'est permis). Profil total : `total` vrai.
 */
export function actionsEffectives(droits, noeud) {
  if (droits?.total) return { total: true, source: null, actions: {} };
  const lignes = droits?.lignes ?? {};
  for (const n of ancetres(noeud)) {
    if (Object.hasOwn(lignes, n)) return { total: false, source: n, actions: { ...lignes[n] } };
  }
  return { total: false, source: null, actions: {} };
}

/** Portée accordée pour une action sur un nœud (null : refusée) ; profil total : TOUT. */
export function porteeAccordee(droits, noeud, action) {
  const e = actionsEffectives(droits, noeud);
  if (e.total) return 'TOUT';
  return e.actions[normaliserAction(action)] ?? null;
}

/** Action permise sur le nœud avec au moins la portée demandée (SOI par défaut). */
export function autorise(droits, noeud, action, porteeMin = 'SOI') {
  const p = porteeAccordee(droits, noeud, action);
  return p !== null && rang(p) >= rang(porteeMin);
}

/**
 * Accès à un sous-arbre (un module et ses éléments) : au moins une action sur le nœud ou l'un de ses descendants ;
 * en écriture, au moins une action autre que la consultation.
 */
export function accesSousArbre(droits, noeud, ecriture = false) {
  if (droits?.total) return true;
  const utile = (actions) => Object.keys(actions ?? {}).some((a) => !ecriture || a !== 'CONSULTER');
  if (utile(actionsEffectives(droits, noeud).actions)) return true;
  const prefixe = `${noeud}/`;
  return Object.entries(droits?.lignes ?? {}).some(([n, a]) => n.startsWith(prefixe) && utile(a));
}

/** Coche une action à une portée : les actions précédentes de la cascade sont cochées au moins à cette portée. */
export function cocher(actions, action, portee = 'TOUT') {
  const res = { ...actions };
  const i = ACTIONS.indexOf(action);
  if (i < 0) {
    res[action] = portee;
    return res;
  }
  for (let k = 0; k <= i; k++) {
    const a = ACTIONS[k];
    if (k === i || res[a] === undefined || rang(res[a]) < rang(portee)) res[a] = portee;
  }
  return res;
}

/** Décoche une seule action (les autres restent : actions indépendantes). */
export function decocher(actions, action) {
  const res = { ...actions };
  delete res[action];
  return res;
}

/** « Réappliquer aux enfants » : les lignes des descendants sont retirées (ils héritent de nouveau du nœud). */
export function reappliquer(lignes, noeud) {
  const prefixe = `${noeud}/`;
  return Object.fromEntries(Object.entries(lignes).filter(([n]) => !n.startsWith(prefixe)));
}

/** Contrôle d'un profil saisi : codes d'erreur. */
export function controlerProfil(profil) {
  const erreurs = [];
  const code = String(profil?.code ?? '');
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)) erreurs.push('PROFIL_CODE');
  const libelle = String(profil?.libelle ?? '').trim();
  if (!libelle || libelle.length > 100) erreurs.push('PROFIL_LIBELLE');
  return erreurs;
}

/**
 * Contrôle des lignes d'un profil au regard du catalogue { nœud: [actions permises] } : nœud connu, actions permises
 * du nœud, portée connue ; erreurs { noeud, code } dans l'ordre des nœuds puis des actions.
 */
export function controlerLignes(lignes, catalogue) {
  const erreurs = [];
  for (const noeud of Object.keys(lignes ?? {}).sort()) {
    const permises = catalogue?.[noeud];
    if (!permises) {
      erreurs.push({ noeud, code: 'NOEUD_INVALIDE' });
      continue;
    }
    for (const [action, portee] of Object.entries(lignes[noeud] ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!permises.includes(action)) erreurs.push({ noeud, code: 'ACTION_INCONNUE', action });
      else if (!PORTEES.includes(portee)) erreurs.push({ noeud, code: 'PORTEE_INCONNUE', action });
    }
  }
  return erreurs;
}
