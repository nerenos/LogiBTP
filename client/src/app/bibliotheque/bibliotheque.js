import { FournisseurBibliothequeApi } from '@logibtp/bibliotheque';
import { arr6, D, S } from '@logibtp/socle';
import { calculerDocument, TL } from '../../calcul/index.js';
import { ENTETES } from '../api.js';
import { DEFINITION_DEMO } from '../demo.js';

// Bibliothèque du cœur : fournisseur (API), calcul des ouvrages par le moteur de devis BTP
// (composition : lignes, métrés, variables), colonnes de la liste dérivées des fiches.

/** Entête minimale du document de calcul d'une composition d'ouvrage. */
export const documentComposition = (mode = 'V') => ({
  // ent_modele COMPOSITION : vue de colonnes propre à la composition (mémorisée à part de celle des devis).
  ent_id: 0, ent_tyd_id: 1, ent_numero: 'OUVRAGE', ent_objet: 'Composition', ent_std_id: 1, ent_tiers_id: 1, ent_mode_calcul_ouvrage: mode, ent_modele: 'COMPOSITION',
  ent_precision_montant: 2, ent_version: 1, ent_num_format: { separateur: '.', niveaux: [{ style: '1' }, { style: '1' }, { style: '1' }] }, ent_proprietes: {},
});

/** Ligne racine (ouvrage) d'une composition. */
export const racineComposition = (lignes) => lignes.find((l) => l.lig_parent_id === null && l.lig_tyl_id === TL.OUVRAGE) ?? null;

/** Ligne racine (tranche) d'un ensemble : structure de lignes vendues, en option ou en variante. */
export const racineEnsemble = (lignes) => lignes.find((l) => l.lig_parent_id === null && l.lig_tyl_id === TL.TITRE) ?? null;

/** Élément composé (ouvrage ou ensemble) : son prix vient de sa composition. */
export const estCompose = (type) => type === 'OUVRAGE' || type === 'ENSEMBLE';

/**
 * Prix d'un ouvrage par unité : la racine (quantité 1, coefficients de l'élément en mode déboursé) est calculée par le
 * moteur de devis ; PA = montant PA de la racine, PR et PV unitaires, PV net = PV × remise. PV fixe de l'ouvrage : imposé à
 * la racine (ventilé sur la composition selon son mode, gardé tel quel en bordereau B), coefficient de bénéfice déduit
 * (PV / PR). Même calcul côté serveur (ElementsBibliotheque.CalculerOuvrage, MoteurDevisBtp).
 */
export function calculerOuvrage(composition, { coef_fg = 1, coef_benef = 1, coef_remise = 1, pv_fixe = false, pv = null } = {}) {
  const lignes = composition?.lignes ?? [];
  if (!racineComposition(lignes)) return racineEnsemble(lignes) ? calculerEnsemble(composition) : { pa: null, pr: null, pv: null, pv_net: null, resultat: null };
  const fixe = (pv_fixe === true || pv_fixe === 'true') && D(pv) !== null;
  const prixFixe = fixe ? { lig_pv_fixe: true, lig_pv: Number(pv) } : { lig_pv_fixe: false };
  const entree = {
    document: documentComposition(composition.mode),
    lignes: lignes.map((l) => (l === racineComposition(lignes) ? { ...l, lig_qte: 1, lig_coef_fg: Number(coef_fg), lig_coef_benef: Number(coef_benef), ...prixFixe } : l)),
    taux_tva: DEFINITION_DEMO.taux_tva, entites: {}, options: {},
    metres: composition.metres ?? [], variables: composition.variables ?? [],
  };
  const resultat = calculerDocument(entree);
  const r = racineComposition(resultat.lignes);
  const prix = D(r.lig_pv);
  const pr = arr6(D(r.lig_pr) ?? D(0));
  return {
    pa: S(arr6(D(r.lig_montant_pa) ?? D(0))), pr: S(pr), pv: S(arr6(prix ?? D(0))),
    pv_net: S(arr6((prix ?? D(0)).times(D(coef_remise) ?? D(1)))), resultat,
    ...(fixe && !pr.isZero() ? { coef_benef: S(arr6(D(prix ?? 0).div(pr))) } : {}),
  };
}

/**
 * Prix d'un ensemble : totaux de sa tranche racine calculés par le moteur de devis (lignes vendues seulement : options,
 * variantes et lignes pour mémoire hors total) ; chaque ligne garde ses coefficients. Même calcul côté serveur
 * (ElementsBibliotheque.CalculerOuvrage).
 */
export function calculerEnsemble(composition) {
  const lignes = composition?.lignes ?? [];
  if (!racineEnsemble(lignes)) return { pa: null, pr: null, pv: null, pv_net: null, resultat: null };
  const resultat = calculerDocument({
    document: documentComposition(composition.mode), lignes, taux_tva: DEFINITION_DEMO.taux_tva, entites: {}, options: {},
    metres: composition.metres ?? [], variables: composition.variables ?? [],
  });
  const r = racineEnsemble(resultat.lignes);
  const pv = S(arr6(D(r.lig_montant_ht) ?? D(0)));
  return { pa: S(arr6(D(r.lig_montant_pa) ?? D(0))), pr: S(arr6(D(r.lig_montant_pr) ?? D(0))), pv, pv_net: pv, resultat };
}

export const creerFournisseurBibliotheque = () => new FournisseurBibliothequeApi({ base: '/api/bibliotheque', entetes: ENTETES });
