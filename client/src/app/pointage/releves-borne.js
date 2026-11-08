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
