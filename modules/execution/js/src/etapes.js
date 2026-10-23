// Module Exécution : étapes d'un ordre (états personnalisés par type d'ordre, ANALYSE-MODULE-EXECUTION.md § 13).
// Règles partagées avec ReglesEtapes.cs (jeu tests/cas/02_etapes.json) : ordre de validation (prédécesseurs, étapes
// masquées validées d'office, contrôle N+1), annulation, état d'exécution déduit, étape en cours, dates prévisionnelles
// par enchaînement (durées en heures, jours ouvrés ou calendaires, sur un calendrier de minutes par jour), contrôle de
// la liste des états d'un type.
//
// Une étape : { code, libelle, nature (TACHE | JALON | ATTENTE), duree, unite (H | OUV | CAL), amonts (null : l'étape
// précédente), date_obligatoire, controle, controle_bloquant, valide_le, controle_le, prevu_impose } ; dates 'AAAA-MM-JJ'.

export const NATURES_ETAPE = {
  TACHE: { libelle: 'Tâche (enchaînement)', icone: '▬' },
  JALON: { libelle: 'Jalon (point de repère)', icone: '◆' },
  ATTENTE: { libelle: 'Attente (séchage, validation d\'un tiers)', icone: '⏳' },
};
export const UNITES_ETAPE = { H: 'heures', OUV: 'jours ouvrés', CAL: 'jours calendaires' };

export const MESSAGES_ETAPES = {
  ETP_INCONNUE: 'Étape inconnue',
  ETP_DEJA_VALIDEE: 'Étape déjà validée',
  ETP_ORDRE: 'Étapes précédentes à valider d\'abord',
  ETP_CONTROLE: 'Contrôle du N+1 attendu sur une étape précédente',
  ETP_CONTROLE_ATTENTE: 'Contrôle du N+1 pas encore fait sur une étape précédente',
  ETP_NON_VALIDEE: 'Étape non validée',
  ETP_SUIVANT_VALIDE: 'Une étape suivante est déjà validée',
  ETP_SANS_CONTROLE: 'Cette étape n\'a pas de contrôle du N+1',
  ETP_CODE: 'Code d\'état obligatoire',
  ETP_DOUBLON: 'Même état deux fois',
  ETP_AMONT: 'Étape amont inconnue',
  ETP_BOUCLE: 'Les étapes amont forment une boucle',
  ETP_NATURE: 'Nature inconnue',
  ETP_DUREE: 'Durée négative ou unité inconnue',
};

const JOUR = 86400000;
const versJour = (d) => Math.floor(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / JOUR);
const versDate = (n) => new Date(n * JOUR).toISOString().slice(0, 10);
const SEMAINE = [420, 420, 420, 420, 420, 0, 0];

/** Minutes travaillées d'un jour (numéro de jour) : jour saisi, sinon semaine type (lundi = 0). */
function minutesJour(calendrier, n) {
  const date = versDate(n);
  if (calendrier?.jours && date in calendrier.jours) return Number(calendrier.jours[date]) || 0;
  return (calendrier?.semaine ?? SEMAINE)[(new Date(n * JOUR).getUTCDay() + 6) % 7] ?? 0;
}

/** Étapes dans l'ordre (champ `ordre`, sinon ordre du tableau). */
const trier = (etapes) => etapes.map((e, i) => ({ e, i })).sort((a, b) => (a.e.ordre ?? a.i) - (b.e.ordre ?? b.i) || a.i - b.i).map((x) => x.e);

/** Prédécesseurs d'une étape : ses amonts, sinon l'étape précédente. */
export function predecesseurs(etapes, code) {
  const liste = trier(etapes);
  const i = liste.findIndex((e) => e.code === code);
  if (i < 0) return [];
  const e = liste[i];
  if (Array.isArray(e.amonts)) return e.amonts.filter((a) => liste.some((x) => x.code === a));
  return i > 0 ? [liste[i - 1].code] : [];
}

/**
 * Validation d'une étape : étapes validées ensemble (l'étape et ses prédécesseurs masqués — sans date obligatoire — non
 * validés, de proche en proche), erreurs (prédécesseur à date obligatoire non validé, contrôle bloquant attendu) et
 * avertissements (contrôle non bloquant attendu).
 */
export function etapesAValider(etapes, code) {
  const parCode = new Map(etapes.map((e) => [e.code, e]));
  const e = parCode.get(code);
  if (!e) return { codes: [], erreurs: ['ETP_INCONNUE'], avertissements: [] };
  if (e.valide_le) return { codes: [], erreurs: ['ETP_DEJA_VALIDEE'], avertissements: [] };
  const codes = [code];
  const attente = [];
  const vus = new Set([code]);
  for (let k = 0; k < codes.length; k++) {
    for (const p of predecesseurs(etapes, codes[k])) {
      if (vus.has(p)) continue;
      vus.add(p);
      const x = parCode.get(p);
      if (x.valide_le) continue;
      if (x.date_obligatoire) attente.push(p);
      else codes.push(p);
    }
  }
  const erreurs = [];
  const avertissements = [];
  if (attente.length) erreurs.push('ETP_ORDRE');
  // Contrôle du N+1 des prédécesseurs déjà validés (ceux validés ensemble ne peuvent pas encore être contrôlés).
  const controles = new Set();
  for (const c of codes) for (const p of predecesseurs(etapes, c)) if (!codes.includes(p)) controles.add(p);
  for (const p of controles) {
    const x = parCode.get(p);
    if (!x.valide_le || !x.controle || x.controle_le) continue;
    if (x.controle_bloquant) { if (!erreurs.includes('ETP_CONTROLE')) erreurs.push('ETP_CONTROLE'); } else if (!avertissements.includes('ETP_CONTROLE_ATTENTE')) avertissements.push('ETP_CONTROLE_ATTENTE');
  }
  const ordre = trier(etapes).map((x) => x.code);
  return { codes: erreurs.length ? [] : codes.sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b)), erreurs, avertissements, attente };
}

/** Annulation de la validation d'une étape : refusée si elle n'est pas validée ou si une étape suivante l'est. */
export function controlerAnnulation(etapes, code) {
  const e = etapes.find((x) => x.code === code);
  if (!e) return ['ETP_INCONNUE'];
  if (!e.valide_le) return ['ETP_NON_VALIDEE'];
  const suivants = etapes.filter((x) => predecesseurs(etapes, x.code).includes(code));
  return suivants.some((x) => x.valide_le) ? ['ETP_SUIVANT_VALIDE'] : [];
}

/** Étape en cours : la première non validée dont les prédécesseurs sont validés ; null si tout est validé. */
export function etapeEnCours(etapes) {
  const liste = trier(etapes);
  const parCode = new Map(liste.map((e) => [e.code, e]));
  const libre = liste.find((e) => !e.valide_le && predecesseurs(liste, e.code).every((p) => parCode.get(p).valide_le));
  return (libre ?? liste.find((e) => !e.valide_le))?.code ?? null;
}

/**
 * État d'exécution de l'ordre déduit de ses étapes : bloqué reste bloqué (le blocage se lève à la main) ; aucune étape :
 * état actuel ; rien de validé : à faire ; tout validé : terminé ; étape en cours de nature attente : en attente ;
 * sinon en cours.
 */
export function etatExecution(etapes, actuel = null) {
  if (actuel === 'BLOQUE') return 'BLOQUE';
  if (!etapes.length) return actuel ?? 'A_FAIRE';
  if (etapes.every((e) => e.valide_le)) return 'TERMINE';
  if (!etapes.some((e) => e.valide_le)) return 'A_FAIRE';
  const enCours = etapes.find((e) => e.code === etapeEnCours(etapes));
  return enCours?.nature === 'ATTENTE' ? 'EN_ATTENTE' : 'EN_COURS';
}

/** Fin (borne : début du jour suivant) d'une étape commencée à la borne `pos`. */
function finEtape(e, pos, calendrier) {
  const duree = Math.max(0, Number(e.duree) || 0);
  if (e.nature === 'JALON' || duree === 0) return pos;
  if (e.unite === 'CAL') return pos + Math.ceil(duree);
  let n = pos;
  if (e.unite === 'H') {
    let reste = Math.round(duree * 60);
    for (let garde = 0; reste > 0 && garde < 3660; garde++, n++) reste -= minutesJour(calendrier, n);
    return n;
  }
  let reste = Math.ceil(duree);
  for (let garde = 0; reste > 0 && garde < 3660; garde++, n++) if (minutesJour(calendrier, n) > 0) reste--;
  return n;
}

/**
 * Dates prévisionnelles par enchaînement (E36, E37) : une étape commence quand ses prédécesseurs finissent (la
 * première au début de l'ordre) et dure selon son unité ; une étape validée finit à sa date de validation, une date
 * imposée est gardée. Rend pour chaque étape { code, debut, prevu } (prevu : jour où l'état doit être atteint).
 */
export function datesPrevues({ etapes, debut, calendrier = null }) {
  const liste = trier(etapes);
  const fins = new Map();
  const depart = versJour(debut);
  return liste.map((e) => {
    const preds = predecesseurs(liste, e.code);
    const pos = preds.length ? Math.max(...preds.map((p) => fins.get(p) ?? depart)) : depart;
    let fin;
    let prevu;
    if (e.valide_le) { prevu = versJour(e.valide_le); fin = prevu + 1; } else if (e.prevu_impose) { prevu = versJour(e.prevu_impose); fin = prevu + 1; } else {
      fin = finEtape(e, pos, calendrier);
      prevu = fin > pos ? fin - 1 : pos;
    }
    fins.set(e.code, fin);
    return { code: e.code, debut: versDate(pos), prevu: versDate(prevu) };
  });
}

/** Contrôle des états d'un type d'ordre ou d'une étape de modèle (codes, doublons, amonts, boucles, natures, durées). */
export function controlerEtapes(etapes) {
  const erreurs = new Set();
  const codes = etapes.map((e) => e.code);
  for (const e of etapes) {
    if (!e.code) erreurs.add('ETP_CODE');
    if (e.nature && !NATURES_ETAPE[e.nature]) erreurs.add('ETP_NATURE');
    if ((Number(e.duree) || 0) < 0 || (e.unite && !UNITES_ETAPE[e.unite])) erreurs.add('ETP_DUREE');
    for (const a of e.amonts ?? []) if (!codes.includes(a)) erreurs.add('ETP_AMONT');
  }
  if (new Set(codes).size !== codes.length) erreurs.add('ETP_DOUBLON');
  // Boucle : parcours en profondeur des amonts.
  const amonts = new Map(etapes.map((e) => [e.code, e.amonts ?? []]));
  const etat = new Map();
  const visiter = (c) => {
    if (etat.get(c) === 1) return true;
    if (etat.get(c) === 2) return false;
    etat.set(c, 1);
    const boucle = (amonts.get(c) ?? []).some((a) => amonts.has(a) && visiter(a));
    etat.set(c, 2);
    return boucle;
  };
  if (codes.some((c) => visiter(c))) erreurs.add('ETP_BOUCLE');
  return [...erreurs].sort();
}
