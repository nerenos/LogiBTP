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
import { texte, textesParCode, icone } from '@logibtp/socle/dictionnaire';
import { ajouterMois, ajouterJours } from '@logibtp/socle';

export const ETATS_PIECE = Object.freeze(Object.fromEntries(['FOURNIE', 'A_ECHEANCE', 'EXPIREE', 'MANQUANTE', 'ABSENTE', 'DISPENSEE'].map((c) => [c, Object.freeze({
  get libelle() { return texte(`sous_traitance.pieces.etats.${c}`); },
  get icone() { return icone(`sous_traitance_piece_${c.toLowerCase()}`); },
})])));
export const ACTIONS_BLOQUEES = textesParCode('sous_traitance.pieces.actions', ['COMMANDE', 'FACTURE', 'PAIEMENT']);
export const PORTEES_PIECE = textesParCode('sous_traitance.pieces.portees', ['TIERS', 'MARCHE']);

export { ajouterMois };

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
