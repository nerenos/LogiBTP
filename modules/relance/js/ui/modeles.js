// Module Relances, écrans : état et calculs sans DOM (testés seuls). Les écrans (liste-relances.js, parametres-relances.js,
// suspensions.js) ne font que les afficher. Montants en decimal (Dz), jamais en Number.
import { Dz } from '@logibtp/socle';
import { NATURE_RELANCE, MODE_RELANCE, ETAT_RELANCE, ETAT_LOT_RELANCE } from '../src/codes.js';
import { NIVEAUX_MAX, regleParDefaut } from '../src/regles.js';

/** Modes proposés pour une nature : la tâche du CRM seulement pour un devis (Q16). */
export const modesAdmis = (nature) => Object.values(MODE_RELANCE).filter((m) => m !== MODE_RELANCE.TACHE || nature === NATURE_RELANCE.DEVIS);

/** Somme décimale de montants (nombres ou chaînes du serveur). */
export const somme = (valeurs) => valeurs.reduce((t, v) => t.plus(Dz(v ?? 0)), Dz(0));

/** Groupes dus regroupés par tiers (ordre de première apparition), pour l'affichage tiers puis chargé. */
export function regrouperParTiers(groupes) {
  const tiers = new Map();
  for (const g of groupes ?? []) {
    if (!tiers.has(g.tiers_id)) tiers.set(g.tiers_id, { tiers_id: g.tiers_id, tiers: g.tiers, groupes: [] });
    tiers.get(g.tiers_id).groupes.push(g);
  }
  return [...tiers.values()].map((t) => ({ ...t, montant: somme(t.groupes.map((g) => g.montant)) }));
}

/** Relances proposées d'un groupe de lot. */
export const proposees = (groupe) => (groupe.relances ?? []).filter((r) => r.etat === ETAT_RELANCE.PROPOSEE);

/**
 * Sélection initiale d'un lot : tous les groupes et toutes les relances proposées cochés, mode du groupe, commentaire vide.
 * Retour : Map groupe → { coche, mode, commentaire, retenues: Set(id de relance) }.
 */
export function selectionLot(lot) {
  const sel = new Map();
  for (const g of lot?.groupes ?? []) {
    const p = proposees(g);
    sel.set(g.groupe, { coche: p.length > 0, mode: g.mode, commentaire: '', retenues: new Set(p.map((r) => r.id)) });
  }
  return sel;
}

/** Coche ou décoche une relance ; un groupe sans relance retenue est décoché, un groupe recoché reprend ses relances. */
export function basculerRelance(groupe, s, id, coche) {
  if (coche) s.retenues.add(id); else s.retenues.delete(id);
  s.coche = s.retenues.size > 0;
  return s;
}

export function basculerGroupe(groupe, s, coche) {
  s.retenues = new Set(coche ? proposees(groupe).map((r) => r.id) : []);
  s.coche = coche && s.retenues.size > 0;
  return s;
}

/** Corps de POST /lots/{id}/valider : seuls les groupes cochés partent (les autres restent proposés), avec leurs relances retenues. */
export function corpsValidation(lot, sel) {
  const groupes = [];
  for (const g of lot?.groupes ?? []) {
    const s = sel.get(g.groupe);
    if (!s?.coche || s.retenues.size === 0) continue;
    const toutes = proposees(g).every((r) => s.retenues.has(r.id));
    groupes.push({
      groupe: g.groupe,
      mode: s.mode !== g.mode ? s.mode : null,
      commentaire: s.commentaire?.trim() || null,
      relances: toutes ? null : [...s.retenues],
    });
  }
  return { groupes };
}

/** Relances proposées non retenues (annulables d'un coup par POST /lots/{id}/annuler). */
export function nonRetenues(lot, sel) {
  return (lot?.groupes ?? []).flatMap((g) => proposees(g).filter((r) => !sel.get(g.groupe)?.retenues.has(r.id)).map((r) => r.id));
}

/** Lot dont des relances sont encore à valider. */
export const lotOuvert = (lot) => lot?.etat === ETAT_LOT_RELANCE.PREPARE || lot?.etat === ETAT_LOT_RELANCE.PARTIEL;

/** Recommandés envoyés qui attendent leur numéro : une lettre (lot + groupe) par ligne, ses relances dedans. */
export function attentesNumero(lots) {
  const lettres = [];
  for (const lot of lots ?? []) {
    for (const g of lot.groupes ?? []) {
      const r = (g.relances ?? []).filter((x) => x.etat === ETAT_RELANCE.ATTENTE_NUMERO);
      if (r.length) lettres.push({ lot: lot.id, groupe: g.groupe, tiers_id: g.tiers_id, date: lot.date, relances: r, montant: somme(r.map((x) => x.montant)) });
    }
  }
  return lettres;
}

/* ---------- règle ---------- */

const copie = (regle) => ({ ...regle, niveaux: (regle?.niveaux ?? []).map((n) => ({ ...n })) });
const renumeroter = (niveaux) => niveaux.forEach((n, i) => { n.rang = i + 1; });

/** Règle à modifier : copie de la règle du serveur, sinon règle par défaut de la nature. */
export const reglePourEdition = (regle, nature) => copie(regle ?? regleParDefaut(nature));

/** Ajoute un niveau (au plus NIVEAUX_MAX) : délai du précédent + 15 jours, mode du précédent. */
export function ajouterNiveau(regle) {
  const r = copie(regle);
  if (r.niveaux.length >= NIVEAUX_MAX) return r;
  const dernier = r.niveaux.at(-1);
  r.niveaux.push({ rang: r.niveaux.length + 1, delai: (dernier?.delai ?? 0) + 15, mode: dernier?.mode ?? MODE_RELANCE.COURRIEL, modele_courriel: null, modele_edition: null });
  return r;
}

/** Retire le niveau de ce rang et renumérote. */
export function retirerNiveau(regle, rang) {
  const r = copie(regle);
  r.niveaux = r.niveaux.filter((n) => n.rang !== rang);
  renumeroter(r.niveaux);
  return r;
}

/** Champ d'un niveau (delai, mode, modele_courriel, modele_edition) : délai entier ou null si illisible. */
export function modifierNiveau(regle, rang, champ, valeur) {
  const r = copie(regle);
  const n = r.niveaux.find((x) => x.rang === rang);
  if (!n) return r;
  if (champ === 'delai') n.delai = valeur === '' || valeur === null || Number.isNaN(Number(valeur)) ? null : Number(valeur);
  else if (champ === 'modele_courriel' || champ === 'modele_edition') n[champ] = valeur ? Number(valeur) : null;
  else n[champ] = valeur;
  return r;
}

/** Répétition du dernier niveau : intervalle conservé tant qu'elle est active, effacé sinon. */
export function definirRepetition(regle, repeter, intervalle) {
  const r = copie(regle);
  r.repeter = Boolean(repeter);
  r.intervalle = r.repeter ? (intervalle === '' || intervalle === null || intervalle === undefined ? null : Number(intervalle)) : null;
  return r;
}

/* ---------- suspensions ---------- */

/** Suspension active à une date : jusqu'au (compris) pas encore passé. */
export const suspensionActive = (s, date) => s.jusqu_au >= date;

/** Suspension saisie prête à l'envoi : exactement une cible (pièce ou tiers), un motif, une date. Retourne les champs manquants. */
export function controlerSuspension(s) {
  const manques = [];
  if (Boolean(s.piece_id) === Boolean(s.tiers_id)) manques.push('cible');
  if (!s.motif) manques.push('motif');
  if (!s.jusqu_au) manques.push('jusqu_au');
  return manques;
}

/** Corps de POST/PUT /suspensions. */
export const corpsSuspension = (s) => ({
  piece_id: s.piece_id ? Number(s.piece_id) : null,
  tiers_id: s.tiers_id ? Number(s.tiers_id) : null,
  jusqu_au: s.jusqu_au,
  motif: s.motif,
  commentaire: s.commentaire?.trim() || null,
});
