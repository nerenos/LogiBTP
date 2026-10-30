// Calcul du cœur BTP : spécialisation du module Document et du module Métré.
import { comparerResultats as comparerDocument, CHAMPS_DOCUMENT, CHAMPS_LIGNE } from '@logibtp/document';

export { MoteurDevisBtp, calculerDocument, cleElementVentilation } from './moteur-btp.js';
export { VERSION_MOTEUR, TL, CODES_TL, estChiffree, estPied, accepteEnfants, estTranche } from '@logibtp/document';
export { evaluerExpression, referencesDe, ErreurCalcul, arrondir, formatNombre, Dec, D, S } from '@logibtp/socle';

// Champs comparés entre les moteurs client et serveur : génériques + BTP (même liste que ComparateurCalcul côté C#).
export const CHAMPS_DOCUMENT_BTP = [...CHAMPS_DOCUMENT, 'ent_coef_fa'];
export const CHAMPS_LIGNE_BTP = [
  ...CHAMPS_LIGNE, 'lig_qte_base', 'lig_pa', 'lig_pr', 'lig_coef_fg', 'lig_coef_benef', 'lig_coef_fa', 'lig_pv_affiche',
  'lig_montant_pa', 'lig_montant_pr',
];

/** La ligne d'écart d'arrondi est recréée à chaque calcul : appariée par son ouvrage parent. */
export const cleLigneBtp = (l) => (l.lig_is_ecart_arrondi ? `ecart:${l.lig_parent_id}` : String(l.lig_id));

export function comparerResultats(client, serveur) {
  return comparerDocument(client, serveur, { champsDocument: CHAMPS_DOCUMENT_BTP, champsLigne: CHAMPS_LIGNE_BTP, cle: cleLigneBtp });
}
export { natureObligatoire, controlesValidation, controlesSaisie, CONTROLE_SAISIE, LIBELLES_CONTROLE_SAISIE } from './controles-btp.js';
