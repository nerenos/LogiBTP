// Module MCP, interface : fonctions pures des écrans (configuration du client, journal filtré et exporté, écarts d'un
// contenu de proposition, propositions classées, recettes). Sans DOM, testées seules ; les écrans les affichent.
import { aujourdhui, MODELE_PLAFOND } from '@logibtp/socle';
import { celluleCsv } from '@logibtp/socle/ui';
import { ETAT_PROPOSITION, TYPE_PARAMETRE_RECETTE } from '../src/codes.js';
import { etatProposition } from '../src/propositions.js';

/** Nom du serveur MCP déclaré dans le client de l'agent (identifiant technique de la configuration). */
export const NOM_SERVEUR = 'logibtp';

/** Chemin du point MCP de l'application. */
export const CHEMIN_MCP = '/mcp';

/** Modèles proposés à la création depuis l'écran (le sur-mesure demande l'arbre des droits : hors de cet écran). */
export const MODELES_ECRAN = Object.freeze([MODELE_PLAFOND.LECTURE, MODELE_PLAFOND.PREPARATION, MODELE_PLAFOND.COMME_MOI]);

/** Adresse absolue du point MCP de la société (`origine` : « https://demo.exemple.fr »). */
export function adresseMcp(origine) {
  return `${String(origine ?? '').replace(/\/+$/, '')}${CHEMIN_MCP}`;
}

/**
 * Configuration à coller dans Claude Code : commande `claude mcp add` et fichier `.mcp.json`, en-tête Authorization
 * avec le secret du jeton délégué (rendu une seule fois par le serveur).
 */
export function configurationClaudeCode({ origine, secret, nom = NOM_SERVEUR }) {
  const url = adresseMcp(origine);
  const authorization = `Bearer ${secret}`;
  const commande = `claude mcp add --transport http ${nom} ${url} --header "Authorization: ${authorization}"`;
  const json = JSON.stringify({ mcpServers: { [nom]: { type: 'http', url, headers: { Authorization: authorization } } } }, null, 2);
  return { url, authorization, commande, json };
}

/** Choix de création retenus : modèles de l'écran parmi ceux permis, levables parmi les garde-fous. */
export function choixEcran(choix) {
  const c = choix ?? {};
  return {
    modeles: MODELES_ECRAN.filter((m) => (c.modeles ?? MODELES_ECRAN).includes(m)),
    gardes_fous: c.gardes_fous ?? [],
    levables: (c.levables ?? []).filter((g) => (c.gardes_fous ?? []).includes(g)),
    echeance_defaut: c.echeance_defaut ?? 30,
    echeance_max: c.echeance_max ?? 90,
    portees: c.portees ?? [],
  };
}

/** Corps de création d'une délégation depuis la saisie de l'écran (jours entiers, levés dédoublonnés, textes rognés). */
export function corpsDelegation({ libelle, modele, jours, leves, client, portee }) {
  const j = Number.parseInt(jours, 10);
  return {
    libelle: String(libelle ?? '').trim() || null,
    modele,
    jours: Number.isFinite(j) ? j : null,
    leves: [...new Set(leves ?? [])],
    client: String(client ?? '').trim() || null,
    portee: portee || null,
  };
}

/** Texte d'un élément lu ou écrit au journal (`{ type, identifiants, nombre, action }`) pour la recherche et l'export. */
export function texteElements(trace) {
  if (!trace) return '';
  const ids = (trace.identifiants ?? []).join(' ');
  return [trace.type, ids].filter(Boolean).join(' ');
}

const minuscule = (v) => String(v ?? '').toLowerCase();

/**
 * Journal filtré : compte (exact ou partie), agent (client ou code de la délégation), élément (type ou identifiant lu ou
 * écrit), période (dates « AAAA-MM-JJ » comprises, sur la date de l'appel).
 */
export function filtrerJournal(lignes, { compte = '', agent = '', element = '', du = '', au = '' } = {}) {
  const c = minuscule(compte).trim();
  const a = minuscule(agent).trim();
  const e = minuscule(element).trim();
  return (lignes ?? []).filter((l) => {
    const jour = String(l.date ?? '').slice(0, 10);
    if (c && !minuscule(l.compte).includes(c)) return false;
    if (a && !minuscule(l.client).includes(a) && !minuscule(l.delegation).includes(a)) return false;
    if (e && !`${minuscule(texteElements(l.lus))} ${minuscule(texteElements(l.ecrits))}`.includes(e)) return false;
    if (du && jour < du) return false;
    if (au && jour > au) return false;
    return true;
  });
}

/** Colonnes de l'export CSV du journal (clés des lignes rendues par GET /api/mcp/journal). */
export const COLONNES_JOURNAL = Object.freeze(['date', 'compte', 'client', 'delegation', 'outil', 'classe', 'statut', 'lus', 'ecrits', 'duree_ms', 'erreur', 'proposition', 'humain']);

/** Lignes CSV du journal (séparateur « ; ») : en-têtes donnés par l'écran (libellés), puis une ligne par appel. */
export function lignesCsvJournal(lignes, entetes) {
  const valeur = (l, c) => (c === 'lus' || c === 'ecrits' ? texteElements(l[c]) : l[c]);
  return [
    COLONNES_JOURNAL.map((c) => celluleCsv(entetes?.[c] ?? c)).join(';'),
    ...(lignes ?? []).map((l) => COLONNES_JOURNAL.map((c) => celluleCsv(valeur(l, c))).join(';')),
  ];
}

/** Contenu JSON aplati en chemins (« besoins[0].quantite ») et valeurs simples, dans l'ordre du document. */
export function aplatir(valeur, prefixe = '') {
  if (Array.isArray(valeur)) {
    if (!valeur.length) return [{ chemin: prefixe, valeur: '[]' }];
    return valeur.flatMap((v, i) => aplatir(v, `${prefixe}[${i}]`));
  }
  if (valeur && typeof valeur === 'object') {
    const cles = Object.keys(valeur);
    if (!cles.length) return prefixe ? [{ chemin: prefixe, valeur: '{}' }] : [];
    return cles.flatMap((k) => aplatir(valeur[k], prefixe ? `${prefixe}.${k}` : k));
  }
  return [{ chemin: prefixe, valeur: valeur === null || valeur === undefined ? '' : String(valeur) }];
}

/** Écarts entre deux contenus (avant, après) : chemins modifiés, ajoutés ou retirés, dans l'ordre d'apparition. */
export function ecartsContenu(avant, apres) {
  const a = new Map(aplatir(avant).map((x) => [x.chemin, x.valeur]));
  const b = new Map(aplatir(apres).map((x) => [x.chemin, x.valeur]));
  const chemins = [...new Set([...a.keys(), ...b.keys()])];
  return chemins.filter((c) => a.get(c) !== b.get(c)).map((c) => ({ chemin: c, avant: a.has(c) ? a.get(c) : null, apres: b.has(c) ? b.get(c) : null }));
}

/** Contenu saisi en JSON : `{ contenu }` ou `{ erreur }` (texte invalide ou contenu qui n'est pas un objet). */
export function lireContenu(texte) {
  try {
    const v = JSON.parse(texte);
    return v && typeof v === 'object' && !Array.isArray(v) ? { contenu: v } : { erreur: true };
  } catch {
    return { erreur: true };
  }
}

/** Avertissement d'une proposition affichable : texte brut, ou message / code d'un objet. */
export function texteAvertissement(a) {
  if (a === null || a === undefined) return '';
  if (typeof a !== 'object') return String(a);
  return String(a.message ?? a.libelle ?? a.code ?? JSON.stringify(a));
}

/** État affiché d'une proposition (échue au-delà de son échéance, règle du module) et décisions encore possibles. */
export function etatAffiche(p, jour = aujourdhui()) {
  const etat = etatProposition(p?.etat, p?.echeance, jour);
  return { etat, ouverte: etat === ETAT_PROPOSITION.EN_ATTENTE };
}

/** Délégations classées : actives d'abord (échéance la plus proche), puis les autres (les plus récentes d'abord). */
export function trierDelegations(liste) {
  return [...(liste ?? [])].sort((x, y) => (Number(Boolean(y.active)) - Number(Boolean(x.active)))
    || (x.active ? String(x.echeance).localeCompare(String(y.echeance)) : String(y.cree_le).localeCompare(String(x.cree_le))));
}

/**
 * Corps de la liste blanche des clients OAuth (lot 12) : adresses rognées, libellés rognés, actif booléen, une ligne par
 * adresse (la dernière saisie l'emporte), lignes sans adresse retirées. Le serveur contrôle les adresses (https, chemin).
 */
export function corpsClients(lignes) {
  const parAdresse = new Map();
  for (const l of lignes ?? []) {
    const client = String(l?.client_id ?? '').trim();
    if (client) parAdresse.set(client, { client_id: client, libelle: String(l.libelle ?? '').trim(), actif: l.actif !== false });
  }
  return [...parAdresse.values()];
}

// Recettes (lot 13) : saisie de l'administrateur, choix et remplissage depuis une fiche ou une pièce.

/** Recettes actives proposées pour un élément d'un type (MARCHE, CHANTIER, DOCUMENT) : celles qui ont un paramètre de ce type. */
export function recettesPourType(recettes, type) {
  return (recettes ?? []).filter((r) => r.active !== false && (r.parametres ?? []).some((p) => p.type === type));
}

/** Valeurs initiales d'une recette lancée depuis un élément : la référence va dans le premier paramètre de son type. */
export function valeursInitiales(recette, type, reference) {
  const p = (recette?.parametres ?? []).find((x) => x.type === type);
  return p ? { [p.nom]: reference ?? '' } : {};
}

/**
 * Paramètres suivant les marques du prompt (`parametresPrompt`) : ceux déjà saisis gardés (dans l'ordre des marques),
 * marques nouvelles ajoutées en TEXTE requis, paramètres sans marque retirés.
 */
export function parametresDepuisPrompt(marques, existants) {
  return (marques ?? []).map((nom) => (existants ?? []).find((p) => p.nom === nom) ?? { nom, type: TYPE_PARAMETRE_RECETTE.TEXTE, libelle: '', requis: true });
}

/** Corps d'enregistrement d'une recette : textes rognés (vides en null pour la description), outils uniques, requis booléen. */
export function corpsRecette({ libelle, description, prompt, parametres, outils, sortie, active }) {
  return {
    libelle: String(libelle ?? '').trim(),
    description: String(description ?? '').trim() || null,
    prompt: String(prompt ?? '').trim(),
    parametres: (parametres ?? []).map((p) => ({ nom: p.nom, type: p.type, libelle: String(p.libelle ?? '').trim() || null, requis: Boolean(p.requis) })),
    outils: [...new Set(outils ?? [])],
    sortie,
    active: active !== false,
  };
}
