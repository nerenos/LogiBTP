import { texte, textesParCode } from '@logibtp/socle/dictionnaire';
import { ETATS_CLOS } from './notes.js';

// Rappels des notes (ANALYSE-MODULE-CRM.md, C6, C19, C26), répliqués dans ReglesRappel.cs
// (jeu modules/crm/tests/cas/02_rappels.json).
//
// Deux types : DATE (à une date et une heure) et AVANT (un délai en jours avant l'échéance de la note). Les seuils
// globaux (paramètres du CRM : orange à 7 jours ou moins, rouge à 1 jour ou moins) donnent la couleur d'un rappel
// AVANT selon le temps restant jusqu'à l'échéance ; le délai fixe seulement à partir de quand il paraît dans la liste
// et le widget (délai absent : le seuil orange). Un rappel DATE est vert avant sa date, rouge ensuite. Une note close
// (terminée, pour mémo, annulée) ou un rappel traité ne rappelle plus rien.

export const TYPES_RAPPEL = [
  { valeur: 'DATE', libelle: texte('crm.types_rappel.DATE') },
  { valeur: 'AVANT', libelle: texte('crm.types_rappel.AVANT') },
];

export const SEUILS_DEFAUT = { orange: 7, rouge: 1 };

const JOUR = 86400000;
const temps = (v) => (v === null || v === undefined || v === '' ? null : new Date(v).getTime());

/**
 * Erreurs d'un rappel (codes, dans cet ordre) : RAPPEL_TYPE, RAPPEL_DATE, RAPPEL_DELAI, RAPPEL_ECHEANCE, RAPPEL_CLOS.
 * rappel : { type, quand, delai_jours } ; note : { etat, echeance }.
 */
export function controlerRappel(rappel, note) {
  const erreurs = [];
  if (!TYPES_RAPPEL.some((t) => t.valeur === rappel.type)) erreurs.push('RAPPEL_TYPE');
  if (rappel.type === 'DATE' && temps(rappel.quand) === null) erreurs.push('RAPPEL_DATE');
  if (rappel.type === 'AVANT') {
    const d = rappel.delai_jours;
    if (d !== null && d !== undefined && d !== '' && !(Number.isInteger(Number(d)) && Number(d) >= 0)) erreurs.push('RAPPEL_DELAI');
    if (temps(note.echeance) === null) erreurs.push('RAPPEL_ECHEANCE');
  }
  if (ETATS_CLOS.includes(note.etat)) erreurs.push('RAPPEL_CLOS');
  return erreurs;
}

export const MESSAGES_RAPPEL = textesParCode('crm.rappels.erreurs', ['RAPPEL_TYPE', 'RAPPEL_DATE', 'RAPPEL_DELAI', 'RAPPEL_ECHEANCE', 'RAPPEL_CLOS']);

/**
 * État d'un rappel à un instant : { actif, visible, couleur: VERT | ORANGE | ROUGE | null, reference } ; reference =
 * date de rappel (DATE) ou échéance (AVANT). Inactif (note close, rappel traité, référence absente) : couleur nulle.
 */
export function etatRappel(rappel, note, seuils = SEUILS_DEFAUT, maintenant = new Date()) {
  const inactif = { actif: false, visible: false, couleur: null, reference: null };
  if (rappel.traite_le || ETATS_CLOS.includes(note.etat)) return inactif;
  const t = temps(maintenant);
  if (rappel.type === 'DATE') {
    const quand = temps(rappel.quand);
    if (quand === null) return inactif;
    return { actif: true, visible: true, couleur: t < quand ? 'VERT' : 'ROUGE', reference: new Date(quand).toISOString() };
  }
  const echeance = temps(note.echeance);
  if (rappel.type !== 'AVANT' || echeance === null) return inactif;
  const orange = Number(seuils?.orange ?? SEUILS_DEFAUT.orange);
  const rouge = Number(seuils?.rouge ?? SEUILS_DEFAUT.rouge);
  const delai = rappel.delai_jours === null || rappel.delai_jours === undefined || rappel.delai_jours === '' ? orange : Number(rappel.delai_jours);
  const reste = echeance - t;
  const couleur = reste <= rouge * JOUR ? 'ROUGE' : reste <= orange * JOUR ? 'ORANGE' : 'VERT';
  return { actif: true, visible: reste <= delai * JOUR, couleur, reference: new Date(echeance).toISOString() };
}

/** Ordre d'affichage : rouge, orange, vert, puis la référence la plus proche. */
export function comparerRappels(a, b) {
  const rang = { ROUGE: 0, ORANGE: 1, VERT: 2 };
  return (rang[a.couleur] ?? 3) - (rang[b.couleur] ?? 3) || String(a.reference ?? '').localeCompare(String(b.reference ?? ''));
}
