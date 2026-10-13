import { estChiffree } from '@logibtp/document';

// Contrôles de saisie du cœur BTP vérifiés à la validation du document (hors moteur de calcul : un brouillon incomplet
// s'enregistre). Répliqués dans SpecialisationBtp.ControlerValidation (src/LogiBTP.Api/Btp/SpecialisationBtp.cs).

/** Nature obligatoire sur les lignes de prix (éléments, ouvrages et leurs composantes), hors ligne d'écart d'arrondi. */
export const natureObligatoire = (l) => estChiffree(l) && !l.lig_is_ecart_arrondi;

/** Erreurs de validation : [{ lig_id, code, message }]. */
export function controlesValidation(lignes) {
  return lignes.filter((l) => natureObligatoire(l) && (l.lig_nat_id === null || l.lig_nat_id === undefined))
    .map((l) => ({ lig_id: l.lig_id, code: 'NATURE_OBLIGATOIRE', message: 'Nature obligatoire sur une ligne de prix' }));
}
