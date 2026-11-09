import { unitesCompteurs } from '../ressources/compteurs.js';

// Relevés de compteurs à la borne (plan materiel-suites, lots 3 et 4, MO2) : mise en forme des données de
// `GET /api/pointage/borne/materiel` et du corps de `POST /api/pointage/borne/materiel/releves` (règle serveur : `CompteursBorneBtp`).

/** Lignes d'un matériel : une par unité suivie (H, KM) avec le dernier cumul connu. */
export function lignesCompteurs(m) {
  return unitesCompteurs(m.compteurs).map((unite) => ({ unite, dernier: unite === 'H' ? m.heures : m.kilometres }));
}

/** Matériels à proposer : affectés ce jour d'abord (liste rapide), puis les autres si `tous`, filtrés sur code et désignation. */
export function materielsProposes(donnees, { tous = false, recherche = '' } = {}) {
  const mots = recherche.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const garde = (m) => mots.every((w) => `${m.code} ${m.designation}`.toLowerCase().includes(w));
  const liste = [...donnees.affectes.map((m) => ({ ...m, affecte: true })), ...(tous || mots.length ? donnees.autres.map((m) => ({ ...m, affecte: false })) : [])];
  return liste.filter(garde);
}

/** Valeur saisie (virgule ou point) : nombre positif ou nul, sinon null. Pas de montant, un compteur n'est pas un montant. */
export function lireValeur(saisie) {
  const t = String(saisie ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Corps du relevé envoyé à la borne ; null si la valeur n'est pas lisible. */
export function corpsReleve(jeton, materiel, unite, saisie, { remise = false, commentaire = null } = {}) {
  const valeur = lireValeur(saisie);
  if (valeur === null) return null;
  return { jeton, materiel, unite, valeur, remise, commentaire: commentaire || null };
}

// Heures de matériel à la borne (plan terrain-suites, lot 19, TS18 a) : après les heures de la journée, une durée sur
// chaque matériel affecté ce jour (`GET|PUT /api/pointage/borne/materiel/heures`, règle serveur : `CompteursBorneBtp.RefusHeure`).

/** Chantiers de la journée, du plus pointé au moins pointé (le premier est proposé d'office). */
export function chantiersJournee(lignesJournee) {
  const totaux = new Map();
  for (const l of lignesJournee) if (l.minutes > 0) totaux.set(l.cha_id, (totaux.get(l.cha_id) ?? 0) + l.minutes);
  return [...totaux.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Une ligne par matériel affecté : durée déjà pointée à la borne ce jour (cumulée) et son chantier, sinon le chantier principal. */
export function lignesHeuresMateriel(donnees, lignesJournee) {
  const chantiers = chantiersJournee(lignesJournee);
  return donnees.materiels.map((m) => {
    const pointes = donnees.pointes.filter((p) => p.materiel === m.id && chantiers.includes(p.cha_id));
    return { materiel: m.id, code: m.code, designation: m.designation,
      cha_id: pointes[0]?.cha_id ?? chantiers[0] ?? null, minutes: pointes.reduce((s, p) => s + p.minutes, 0) };
  });
}

/** Corps de l'enregistrement : lignes de durée positive seulement (aucune = heures de la borne retirées pour ce jour). */
export function corpsHeuresMateriel(jeton, date, lignes) {
  return { jeton, date, lignes: lignes.filter((l) => l.minutes > 0 && l.cha_id).map((l) => ({ materiel: l.materiel, cha_id: l.cha_id, minutes: l.minutes })) };
}
