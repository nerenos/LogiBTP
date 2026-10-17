import { estChiffree } from '@logibtp/document';

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
