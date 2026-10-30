import { estChiffree } from '@logibtp/document';
import { Dz, coef } from '@logibtp/socle';

// Contrôles de saisie du cœur BTP vérifiés à la validation du document (hors moteur de calcul : un brouillon incomplet
// s'enregistre). Répliqués dans SpecialisationBtp.ControlerValidation (src/LogiBTP.Api/Btp/SpecialisationBtp.cs).

/** Nature obligatoire sur les lignes de prix (éléments, ouvrages et leurs composantes), hors ligne d'écart d'arrondi. */
export const natureObligatoire = (l) => estChiffree(l) && !l.lig_is_ecart_arrondi;

/**
 * Erreurs de validation : [{ lig_id, code, message }] ; regles : règles résolues du type (frais annexes et prorata
 * interdits si FRAIS_ANNEXES vaut false : FRAIS_ANNEXES_INTERDITS).
 */
export function controlesValidation(lignes, regles = {}) {
  const erreurs = lignes.filter((l) => natureObligatoire(l) && (l.lig_nat_id === null || l.lig_nat_id === undefined))
    .map((l) => ({ lig_id: l.lig_id, code: 'NATURE_OBLIGATOIRE', message: 'Nature obligatoire sur une ligne de prix' }));
  if (regles?.FRAIS_ANNEXES === false) {
    for (const l of lignes) {
      if (l.lig_type_prix === 'F' || (l.lig_coef_prorata !== null && l.lig_coef_prorata !== undefined && Number(l.lig_coef_prorata) !== 1)) {
        erreurs.push({ lig_id: l.lig_id, code: 'FRAIS_ANNEXES_INTERDITS', message: 'Frais annexes et prorata réservés aux ventes' });
      }
    }
  }
  return erreurs;
}

/** Contrôles de saisie (avertissements du panneau des notifications, jamais bloquants) : code → libellé du filtre. */
export const CONTROLE_SAISIE = Object.freeze({
  UNITE_MANQUANTE: 'UNITE_MANQUANTE',
  COEF_FG_INFERIEUR: 'COEF_FG_INFERIEUR',
  COEF_BENEF_INFERIEUR: 'COEF_BENEF_INFERIEUR',
  PRIX_NUL: 'PRIX_NUL',
  QTE_NULLE: 'QTE_NULLE',
});
export const LIBELLES_CONTROLE_SAISIE = Object.freeze({
  [CONTROLE_SAISIE.UNITE_MANQUANTE]: 'Sans unité',
  [CONTROLE_SAISIE.COEF_FG_INFERIEUR]: 'Coef FG < 1',
  [CONTROLE_SAISIE.COEF_BENEF_INFERIEUR]: 'Coef bénéfice < 1',
  [CONTROLE_SAISIE.PRIX_NUL]: 'PA et PV à 0',
  [CONTROLE_SAISIE.QTE_NULLE]: 'Quantité à 0',
});

/**
 * Avertissements de saisie des lignes de prix et de leurs composantes (lignes calculées) : [{ lig_id, code, message,
 * gravite }]. Lignes écartées : écart d'arrondi, pour mémoire et frais annexes (type de prix effectif). Coefficients :
 * ventes seulement, sur les lignes sans composante et sur les ouvrages calculés par leurs coefficients (mode D).
 * options : { famille, modeOuvrage, typePrix(l) → type de prix effectif, qteNulle (false : quantités à 0 non signalées,
 * documents transformés ou d'avancement dont les lignes soldées restent à 0) }.
 */
export function controlesSaisie(lignes, { famille = 'V', modeOuvrage = 'V', typePrix = (l) => l.lig_type_prix ?? 'V', qteNulle = true } = {}) {
  const parents = new Set(lignes.map((l) => l.lig_parent_id).filter((p) => p !== null && p !== undefined));
  const res = [];
  const ajouter = (l, code, message) => res.push({ lig_id: l.lig_id, code, message, gravite: 'avertissement' });
  for (const l of lignes) {
    if (!estChiffree(l) || l.lig_is_ecart_arrondi || ['M', 'F'].includes(typePrix(l))) continue;
    const compose = parents.has(l.lig_id);
    if (!l.lig_unt_code) ajouter(l, CONTROLE_SAISIE.UNITE_MANQUANTE, 'Ligne de prix sans unité');
    if (famille === 'V' && (!compose || modeOuvrage === 'D')) {
      if (coef(l.lig_coef_fg).lessThan(1)) ajouter(l, CONTROLE_SAISIE.COEF_FG_INFERIEUR, `Coefficient de frais généraux inférieur à 1 (${l.lig_coef_fg})`);
      if (coef(l.lig_coef_benef).lessThan(1)) ajouter(l, CONTROLE_SAISIE.COEF_BENEF_INFERIEUR, `Coefficient de bénéfice inférieur à 1 (${l.lig_coef_benef})`);
    }
    if (Dz(l.lig_pa).isZero() && Dz(l.lig_pv).isZero()) ajouter(l, CONTROLE_SAISIE.PRIX_NUL, 'Ligne de prix à 0 (PA et PV)');
    if (qteNulle && Dz(l.lig_qte).isZero()) ajouter(l, CONTROLE_SAISIE.QTE_NULLE, 'Quantité à 0');
  }
  return res;
}
