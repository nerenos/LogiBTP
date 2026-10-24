// Module Sous-traitance : pièces exigées et conformité (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.3, ST12, ST13, ST18).
// Règles partagées avec ReglesConformite.cs (jeu tests/cas/01_conformite.json) : pièces applicables à un marché
// (conditions : marché public, garantie, montant ; ajoutées ou dispensées sur l'élément), état de chaque pièce (fournie,
// à échéance, expirée, manquante, absente, dispensée), marché conforme, pièces bloquantes par action (commande,
// facture, paiement).
//
// exigence : { code, libelle, portee (TIERS | MARCHE), categorie, obligatoire, duree_mois, rappel_jours, bloquant: [..],
//   cond_public (true | false | null), cond_garantie (code | null), cond_montant_min (nombre | null), ordre } ;
// piece : { categorie, portee, dge_id, depose_le, valide_au } ; ajustement : { code, mode (AJOUTEE | DISPENSEE), motif } ;
// contexte : { public, garantie, montant_ht } ; dates 'AAAA-MM-JJ'.

export const ETATS_PIECE = {
  FOURNIE: { libelle: 'Fournie', icone: '✅' },
  A_ECHEANCE: { libelle: 'À échéance', icone: '⏳' },
  EXPIREE: { libelle: 'Expirée', icone: '⛔' },
  MANQUANTE: { libelle: 'Manquante', icone: '❌' },
  ABSENTE: { libelle: 'Non fournie (facultative)', icone: '▫' },
  DISPENSEE: { libelle: 'Dispensée', icone: '➖' },
};
export const ACTIONS_BLOQUEES = { COMMANDE: 'Validation de la commande', FACTURE: 'Validation de la facture', PAIEMENT: 'Bon à payer, paiement' };
export const PORTEES_PIECE = { TIERS: 'Sous-traitant (toutes ses affaires)', MARCHE: 'Marché' };

const pad = (n) => String(n).padStart(2, '0');
const joursDuMois = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();

/** Date + n mois (jour ramené à la fin du mois si besoin). */
export function ajouterMois(date, n) {
  const [a, m, j] = date.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  const an = Math.floor(total / 12);
  const mois = total - an * 12 + 1;
  return `${an}-${pad(mois)}-${pad(Math.min(j, joursDuMois(an, mois)))}`;
}

const ajouterJours = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Exigence applicable au contexte du marché (conditions vides : toujours). */
export function applicable(e, contexte = {}) {
  if (e.cond_public !== null && e.cond_public !== undefined && Boolean(contexte.public) !== e.cond_public) return false;
  if (e.cond_garantie && contexte.garantie !== e.cond_garantie) return false;
  if (e.cond_montant_min !== null && e.cond_montant_min !== undefined && !(Number(contexte.montant_ht ?? 0) >= Number(e.cond_montant_min))) return false;
  return true;
}

/** Fin de validité d'une pièce : saisie, sinon dépôt + durée de l'exigence, sinon sans échéance (null). */
export function finValidite(e, piece) {
  if (!piece) return null;
  if (piece.valide_au) return piece.valide_au;
  return e.duree_mois && piece.depose_le ? ajouterMois(piece.depose_le, e.duree_mois) : null;
}

/** État d'une pièce exigée. */
export function etatPiece(e, piece, { dispensee = false, obligatoire = e.obligatoire, aujourdhui }) {
  if (dispensee) return 'DISPENSEE';
  if (!piece) return obligatoire ? 'MANQUANTE' : 'ABSENTE';
  const fin = finValidite(e, piece);
  if (fin && fin < aujourdhui) return 'EXPIREE';
  if (fin && (e.rappel_jours ?? 0) > 0 && fin <= ajouterJours(aujourdhui, e.rappel_jours)) return 'A_ECHEANCE';
  return 'FOURNIE';
}

/**
 * Conformité d'un marché (ou d'un sous-traitant seul : exigences de portée TIERS) : pièces applicables dans l'ordre,
 * avec leur état et la pièce retenue (la plus récente de sa catégorie), marché conforme (aucune pièce obligatoire
 * manquante ou expirée), pièces bloquantes par action.
 */
export function conformite({ exigences, pieces = [], ajustements = [], contexte = {}, aujourdhui, portees = ['TIERS', 'MARCHE'] }) {
  const aj = new Map(ajustements.map((a) => [a.code, a]));
  const liste = exigences
    .filter((e) => portees.includes(e.portee) && (e.actif ?? true))
    .filter((e) => aj.get(e.code)?.mode === 'AJOUTEE' || aj.get(e.code)?.mode === 'DISPENSEE' || applicable(e, contexte))
    .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0) || a.code.localeCompare(b.code));
  const res = liste.map((e) => {
    const categorie = e.categorie || e.code;
    const candidates = pieces.filter((p) => p.categorie === categorie && (!p.portee || p.portee === e.portee));
    const piece = candidates.sort((a, b) => (finValidite(e, b) ?? '9999').localeCompare(finValidite(e, a) ?? '9999')
      || String(b.depose_le ?? '').localeCompare(String(a.depose_le ?? '')))[0] ?? null;
    const a = aj.get(e.code);
    const obligatoire = e.obligatoire || a?.mode === 'AJOUTEE';
    const etat = etatPiece(e, piece, { dispensee: a?.mode === 'DISPENSEE', obligatoire, aujourdhui });
    return { code: e.code, libelle: e.libelle, portee: e.portee, obligatoire, etat, fin: finValidite(e, piece), dge_id: piece?.dge_id ?? null,
      motif: a?.motif ?? null, bloquant: e.bloquant ?? [] };
  });
  const enDefaut = (p) => p.etat === 'MANQUANTE' || p.etat === 'EXPIREE';
  const bloquants = Object.fromEntries(Object.keys(ACTIONS_BLOQUEES).map((x) => [x, res.filter((p) => enDefaut(p) && p.bloquant.includes(x)).map((p) => p.code)]));
  return { pieces: res, conforme: !res.some((p) => p.obligatoire && enDefaut(p)), a_echeance: res.filter((p) => p.etat === 'A_ECHEANCE').map((p) => p.code), bloquants };
}
