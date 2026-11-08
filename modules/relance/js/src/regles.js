import { Dz, S, ZERO } from '@logibtp/socle';
import { NATURE_RELANCE, MODE_RELANCE, ERREUR_RELANCE } from './codes.js';

// Règle des niveaux et calcul des relances dues (plans/relances.md, lot 1 ; ANALYSE-RELANCES.md, Q3 à Q10), répliqué
// dans ReglesRelance.cs (jeu modules/relance/tests/cas/01_niveaux.json).
//
// Règle d'une nature : 1 à NIVEAUX_MAX niveaux { rang, delai (jours depuis le départ), mode, modele_courriel,
// modele_edition }, le dernier répétable tous les `intervalle` jours (repeter). Départ : date d'envoi d'un devis ;
// échéance échue (date < date du calcul) la plus ancienne non soldée d'une facture (une retenue de garantie porte sa date
// de libération, null : jamais échue). Niveau atteint à une date : le plus haut dont le délai est écoulé (répétition k du
// dernier : délai + k × intervalle) ; seul ce niveau est proposé, et seulement s'il dépasse la dernière relance faite
// (même rang : seulement pour une répétition plus récente que cette relance) : une relance manquée n'est pas rattrapée
// deux fois. Pièce arrêtée ou suspendue jusqu'à la date (comprise) : rien. Montant relancé : montant du devis, reste échu
// de la facture ; échéances futures listées pour information. Regroupement par tiers, chargé, nature et mode : modèles
// du niveau le plus élevé du groupe, chaque pièce garde son niveau.

/** Nombre maximal de niveaux d'une règle. */
export const NIVEAUX_MAX = 5;

const JOUR = 86400000;
const temps = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const ecart = (a, b) => Math.round((temps(b) - temps(a)) / JOUR);
const plus = (d, n) => new Date(temps(d) + n * JOUR).toISOString().slice(0, 10);
const entierPositif = (v) => Number.isInteger(v) && v >= 1;

/** Règle par défaut d'une nature (Q4) : 15, 30, 60 jours ; dernier niveau d'une facture en recommandé (Q13). */
export function regleParDefaut(nature) {
  const dernier = nature === NATURE_RELANCE.FACTURE ? MODE_RELANCE.RECOMMANDE : MODE_RELANCE.COURRIEL;
  const niveau = (rang, delai, mode) => ({ rang, delai, mode, modele_courriel: null, modele_edition: null });
  return {
    niveaux: [niveau(1, 15, MODE_RELANCE.COURRIEL), niveau(2, 30, MODE_RELANCE.COURRIEL), niveau(3, 60, dernier)],
    repeter: false,
    intervalle: null,
  };
}

/** Erreurs d'une règle (codes ERREUR_RELANCE, sans doublon, dans l'ordre des contrôles) ; [] : règle valable. */
export function controlerRegle(regle, nature) {
  const erreurs = [];
  const ajouter = (code) => { if (!erreurs.includes(code)) erreurs.push(code); };
  const niveaux = regle?.niveaux ?? [];
  if (niveaux.length === 0) ajouter(ERREUR_RELANCE.REGLE_SANS_NIVEAU);
  if (niveaux.length > NIVEAUX_MAX) ajouter(ERREUR_RELANCE.REGLE_TROP_DE_NIVEAUX);
  const modes = Object.values(MODE_RELANCE).filter((m) => m !== MODE_RELANCE.TACHE || nature === NATURE_RELANCE.DEVIS);
  niveaux.forEach((n, i) => {
    if (n.rang !== i + 1) ajouter(ERREUR_RELANCE.NIVEAU_RANG);
    if (!entierPositif(n.delai) || (i > 0 && !(n.delai > niveaux[i - 1].delai))) ajouter(ERREUR_RELANCE.NIVEAU_DELAI);
    if (!modes.includes(n.mode)) ajouter(ERREUR_RELANCE.NIVEAU_MODE);
  });
  if (regle?.repeter && !entierPositif(regle.intervalle)) ajouter(ERREUR_RELANCE.REGLE_INTERVALLE);
  return erreurs;
}

/**
 * Niveau atteint à une date depuis un départ (dates AAAA-MM-JJ) : { rang, repetition, palier (date où il est atteint),
 * jours (depuis le départ) } ou null avant le premier niveau.
 */
export function niveauAtteint(regle, depart, date) {
  const niveaux = [...regle.niveaux].sort((a, b) => a.rang - b.rang);
  const jours = ecart(depart, date);
  const atteint = niveaux.filter((n) => n.delai <= jours).at(-1);
  if (!atteint) return null;
  let repetition = 0;
  if (regle.repeter && regle.intervalle >= 1 && atteint === niveaux.at(-1)) {
    repetition = Math.floor((jours - atteint.delai) / regle.intervalle);
  }
  return { rang: atteint.rang, repetition, palier: plus(depart, atteint.delai + repetition * (regle.intervalle ?? 0)), jours };
}

/** Départ, montant échu, échéances échues et futures d'une facture à une date (échéances ouvertes : reste > seuil). */
function etatFacture(echeances, date, seuil) {
  const ouvertes = (echeances ?? []).filter((e) => Dz(e.reste).gt(Dz(seuil)));
  const echue = (e) => e.date != null && e.date < date;
  const echues = ouvertes.filter(echue);
  const parDate = (a, b) => (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31') || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  return {
    depart: echues.map((e) => e.date).sort()[0] ?? null,
    montant: echues.reduce((t, e) => t.plus(Dz(e.reste)), ZERO),
    echues: [...echues].sort(parDate).map((e) => e.id),
    futures: ouvertes.filter((e) => !echue(e)).sort(parDate)
      .map((e) => ({ id: e.id, date: e.date ?? null, reste: S(Dz(e.reste)), retenue: !!e.retenue })),
  };
}

/**
 * Relance due d'une pièce à une date, ou null. piece : { id, nature, tiers, charge, depart (devis), montant (devis),
 * echeances [{ id, date, reste, retenue }] (facture), derniere { niveau, date } (dernière relance faite non annulée),
 * arretee, suspendue_jusqu_au, regle (surcharge du tiers) }.
 */
export function relanceDue(regle, piece, date, seuil = 0) {
  if (!regle || piece.arretee) return null;
  if (piece.suspendue_jusqu_au && date <= piece.suspendue_jusqu_au) return null;
  const facture = piece.nature === NATURE_RELANCE.FACTURE;
  const etat = facture
    ? etatFacture(piece.echeances, date, seuil)
    : { depart: piece.depart ?? null, montant: Dz(piece.montant), echues: [], futures: [] };
  if (!etat.depart) return null;
  const n = niveauAtteint(regle, etat.depart, date);
  if (!n) return null;
  const d = piece.derniere;
  if (d && (d.niveau > n.rang || (d.niveau === n.rang && (n.repetition === 0 || d.date >= n.palier)))) return null;
  const niveau = regle.niveaux.find((x) => x.rang === n.rang);
  return {
    id: piece.id,
    nature: piece.nature,
    tiers: piece.tiers,
    charge: piece.charge ?? null,
    niveau: n.rang,
    repetition: n.repetition,
    mode: niveau.mode,
    modele_courriel: niveau.modele_courriel ?? null,
    modele_edition: niveau.modele_edition ?? null,
    depart: etat.depart,
    palier: n.palier,
    jours: n.jours,
    montant: S(etat.montant),
    echues: etat.echues,
    futures: etat.futures,
  };
}

/** Relances dues des pièces à une date (règle propre de la pièce, sinon règle de sa nature : regles { DEVIS, FACTURE }). */
export function relancesDues(regles, pieces, date, seuil = 0) {
  return pieces.map((p) => relanceDue(p.regle ?? regles?.[p.nature], p, date, seuil)).filter((r) => r !== null);
}

/**
 * Regroupement des relances dues par tiers, chargé, nature et mode (ordre de première apparition) : { tiers, charge,
 * nature, mode, niveau (le plus élevé), modele_courriel, modele_edition (de la première pièce à ce niveau), jours (le plus
 * grand), montant (somme), pieces [{ id, niveau, repetition, jours, montant }] }.
 */
export function regrouper(dues) {
  const groupes = new Map();
  for (const r of dues) {
    const cle = JSON.stringify([r.tiers, r.charge ?? null, r.nature, r.mode]);
    let g = groupes.get(cle);
    if (!g) {
      g = { tiers: r.tiers, charge: r.charge ?? null, nature: r.nature, mode: r.mode, niveau: 0, modele_courriel: null, modele_edition: null, jours: 0, montant: ZERO, pieces: [] };
      groupes.set(cle, g);
    }
    if (r.niveau > g.niveau) {
      g.niveau = r.niveau;
      g.modele_courriel = r.modele_courriel ?? null;
      g.modele_edition = r.modele_edition ?? null;
    }
    g.jours = Math.max(g.jours, r.jours);
    g.montant = g.montant.plus(Dz(r.montant));
    g.pieces.push({ id: r.id, niveau: r.niveau, repetition: r.repetition, jours: r.jours, montant: S(Dz(r.montant)) });
  }
  return [...groupes.values()].map((g) => ({ ...g, montant: S(g.montant) }));
}
