// Règles du référentiel des ressources, répliquées dans src/LogiBTP.Domaine/Ressources/ReglesRessources.cs (jeux
// tests/ressources) : validité des habilitations (fin calculée depuis la durée du type, état à une date), habilitations
// exigées manquantes, contrôle des habilitations et des missions d'intérim, mission en cours. Dates au format AAAA-MM-JJ.

export const ETATS_HABILITATION = {
  VALIDE: 'Valide', A_RENOUVELER: 'À renouveler', EXPIREE: 'Expirée', NON_ACQUISE: 'Pas encore acquise',
};

/** Délai (jours) avant la fin de validité à partir duquel une habilitation est « à renouveler ». */
export const SEUIL_RENOUVELLEMENT = 60;

export const MESSAGES_RESSOURCES = {
  HAB_TYPE: "Type d'habilitation inconnu ou inactif",
  HAB_CONCERNE: "Ce type d'habilitation ne s'applique pas à cet élément",
  HAB_DATES: "Fin de validité antérieure à l'obtention",
  MIS_PERIODE: 'Fin de mission antérieure au début',
  MIS_DATES: 'Début et fin de mission obligatoires',
  MIS_AGENCE: "Agence d'intérim obligatoire",
  MIS_TAUX: 'Taux horaire négatif',
  MIS_CHEVAUCHEMENT: 'Missions qui se chevauchent',
};

const pad = (n) => String(n).padStart(2, '0');
const joursDuMois = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate(); // m : 1 à 12

/** Date + n mois, jour ramené au dernier du mois s'il n'existe pas (31 janvier + 1 mois = 28 ou 29 février). */
export function ajouterMois(date, n) {
  const [a, m, j] = date.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  const an = Math.floor(total / 12);
  const mois = total - an * 12 + 1;
  return `${an}-${pad(mois)}-${pad(Math.min(j, joursDuMois(an, mois)))}`;
}

/** Nombre de jours de `de` à `a` (dates AAAA-MM-JJ). */
export function joursEntre(de, a) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);
}

/** Fin de validité : saisie, sinon obtention + durée du type (mois), sinon sans fin (null). */
export function finValidite(h, dureeMois) {
  if (h.valide_jusqu_au) return h.valide_jusqu_au;
  if (h.obtenue_le && dureeMois) return ajouterMois(h.obtenue_le, dureeMois);
  return null;
}

/** État d'une habilitation à une date : { etat, fin, jours_restants } (jours_restants nul sans fin de validité). */
export function etatHabilitation(h, dureeMois, date, seuil = SEUIL_RENOUVELLEMENT) {
  const fin = finValidite(h, dureeMois);
  const jours = fin ? joursEntre(date, fin) : null;
  let etat = 'VALIDE';
  if (h.obtenue_le && h.obtenue_le > date) etat = 'NON_ACQUISE';
  else if (fin && fin < date) etat = 'EXPIREE';
  else if (fin && jours <= seuil) etat = 'A_RENOUVELER';
  return { etat, fin, jours_restants: jours };
}

/**
 * Codes exigés sans habilitation valable à la date (valide ou à renouveler), triés. `types` : { code: { duree_mois } }.
 */
export function habilitationsManquantes(exigees, habilitations, types, date) {
  const valables = new Set(habilitations
    .filter((h) => ['VALIDE', 'A_RENOUVELER'].includes(etatHabilitation(h, types[h.code]?.duree_mois ?? null, date).etat))
    .map((h) => h.code));
  return [...new Set(exigees)].filter((c) => !valables.has(c)).sort();
}

/** Contrôle d'une habilitation saisie pour un élément (salarie ou materiel) : codes triés. */
export function controlerHabilitation(h, types, element) {
  const erreurs = [];
  const t = types[h.code];
  if (!t || t.actif === false) erreurs.push('HAB_TYPE');
  else if (t.concerne !== 'LES_DEUX' && t.concerne !== (element === 'materiel' ? 'MATERIEL' : 'SALARIE')) erreurs.push('HAB_CONCERNE');
  if (h.obtenue_le && h.valide_jusqu_au && h.valide_jusqu_au < h.obtenue_le) erreurs.push('HAB_DATES');
  return erreurs.sort();
}

/**
 * Contrôle des missions d'un intérimaire : [{ index, codes }] des missions en erreur (période, agence, taux,
 * chevauchement avec une autre mission, signalé sur les deux).
 */
export function controlerMissions(missions) {
  const res = missions.map(() => new Set());
  missions.forEach((m, i) => {
    if (!m.debut || !m.fin) res[i].add('MIS_DATES');
    else if (m.fin < m.debut) res[i].add('MIS_PERIODE');
    if (!m.agence_id) res[i].add('MIS_AGENCE');
    if (m.taux_horaire !== null && m.taux_horaire !== undefined && Number(m.taux_horaire) < 0) res[i].add('MIS_TAUX');
  });
  for (let i = 0; i < missions.length; i++) {
    for (let j = i + 1; j < missions.length; j++) {
      const a = missions[i];
      const b = missions[j];
      if (a.debut && a.fin && b.debut && b.fin && a.debut <= b.fin && b.debut <= a.fin) { res[i].add('MIS_CHEVAUCHEMENT'); res[j].add('MIS_CHEVAUCHEMENT'); }
    }
  }
  return res.map((s, index) => ({ index, codes: [...s].sort() })).filter((x) => x.codes.length);
}

/** Mission qui couvre la date (la dernière commencée si plusieurs), ou null. */
export function missionEnCours(missions, date) {
  return missions.filter((m) => m.debut && m.fin && m.debut <= date && date <= m.fin).sort((a, b) => (a.debut < b.debut ? 1 : -1))[0] ?? null;
}
