// Congés et absences (module Pointage) : une demande couvre une période (journées entières, demi-journée possible au
// premier jour — commence l'après-midi — et au dernier — finit à midi), sans nature ; le RH valide en affectant la
// nature ou refuse. Règles répliquées dans ReglesConges.cs (jeu tests/cas/04_conges.json) : contrôle d'une demande
// (dates, demi-journées, chevauchement à la demi-journée avec les demandes et congés en cours du salarié), jours
// décomptés (jours travaillés seulement, 0,5 aux bornes en demi-journée), traitements permis.
import { textesParCode } from '@logibtp/socle/dictionnaire';
import { ETAT_CONGE } from './codes.js';

/** Libellés des états d'une demande (fr.json : pointage.etats_conge.<ÉTAT>). */
export const ETATS_CONGE = textesParCode('pointage.etats_conge', Object.values(ETAT_CONGE));

/** Libellés des refus d'une demande (fr.json : pointage.conges.<CODE>). */
export const MESSAGES_CONGES = textesParCode('pointage.conges', [
  'CNG_DATES', 'CNG_DEMI', 'CNG_CHEVAUCHEMENT', 'CNG_ETAT', 'CNG_NATURE',
]);

const jourNumero = (d) => Date.parse(`${d}T00:00:00Z`) / 86400000;

/** Demi-journées couvertes [début, fin] (inclusives) : 2 par jour, l'après-midi impair. */
function demiJournees(c) {
  return [jourNumero(c.du) * 2 + (c.debut_midi ? 1 : 0), jourNumero(c.au) * 2 + (c.fin_midi ? 0 : 1)];
}

/** Congé en cours (compte dans les chevauchements) : demandé ou validé. */
export const enCours = (c) => c.etat === ETAT_CONGE.DEMANDE || c.etat === ETAT_CONGE.VALIDE;

/**
 * Contrôle d'une demande : codes triés. `autres` : congés du salarié (le congé contrôlé exclu par son identifiant) ;
 * seuls les congés demandés ou validés comptent dans le chevauchement.
 */
export function controlerConge(c, autres = []) {
  const r = [];
  if (!c.du || !c.au || c.au < c.du) r.push('CNG_DATES');
  else {
    if (c.du === c.au && c.debut_midi && c.fin_midi) r.push('CNG_DEMI');
    const [a, b] = demiJournees(c);
    if (autres.some((x) => x.id !== c.id && enCours(x) && x.du && x.au && (([d, f]) => d <= b && a <= f)(demiJournees(x)))) r.push('CNG_CHEVAUCHEMENT');
  }
  return r.sort();
}

/** Jours décomptés d'un congé : jours travaillés de la période, 0,5 au premier (après-midi) et au dernier (midi). */
export function joursConge(c, joursTravailles) {
  const travailles = new Set(joursTravailles);
  const r = [];
  for (let n = jourNumero(c.du); n <= jourNumero(c.au); n++) {
    const date = new Date(n * 86400000).toISOString().slice(0, 10);
    if (!travailles.has(date)) continue;
    const part = 1 - (date === c.du && c.debut_midi ? 0.5 : 0) - (date === c.au && c.fin_midi ? 0.5 : 0);
    if (part > 0) r.push({ date, part });
  }
  return r;
}

/** Total des jours décomptés. */
export const totalJours = (jours) => jours.reduce((s, j) => s + j.part, 0);

/**
 * Traitement d'un congé : VALIDER (demandé, nature obligatoire), REFUSER (demandé), ANNULER (demandé ou validé) ;
 * codes triés.
 */
export function controlerTraitement(action, c, nature = null) {
  const r = [];
  if (action === 'VALIDER' || action === 'REFUSER') {
    if (c.etat !== 'DEMANDE') r.push('CNG_ETAT');
    if (action === 'VALIDER' && !nature) r.push('CNG_NATURE');
  } else if (action === 'ANNULER' && !enCours(c)) r.push('CNG_ETAT');
  return r.sort();
}
