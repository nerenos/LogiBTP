import { D } from './decimal.js';

// Champs calculés comparés entre les deux moteurs (même liste que ComparateurCalcul.cs).
export const CHAMPS_DOCUMENT = ['ent_coef_fa', 'ent_total_ht', 'ent_total_tva', 'ent_total_ttc', 'ent_net_a_payer'];
export const CHAMPS_LIGNE = [
  'lig_qte_base', 'lig_qte_vendue', 'lig_qte_totale', 'lig_pa', 'lig_pr', 'lig_pv', 'lig_coef_fg', 'lig_coef_benef',
  'lig_coef_fa', 'lig_pv_affiche', 'lig_pv_remise', 'lig_montant_pa', 'lig_montant_pr', 'lig_montant_ht',
  'lig_base_calcul', 'lig_montant_tva', 'lig_taux_tva', 'lig_numerotation', 'lig_libelle_affiche',
];

function egales(a, b) {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  try { return D(a).eq(D(b)); } catch { return String(a) === String(b); }
}

/** Clé d'appariement : ID, ou ouvrage parent pour la ligne d'écart d'arrondi (ID recréé). */
const cle = (l) => (l.lig_is_ecart_arrondi ? `ecart:${l.lig_parent_id}` : String(l.lig_id));

/** Écarts { lig_id, champ, valeur_client, valeur_serveur } entre deux résultats de calcul. */
export function comparerResultats(client, serveur) {
  const ecarts = [];
  for (const champ of CHAMPS_DOCUMENT) {
    if (!egales(client.document[champ], serveur.document[champ])) {
      ecarts.push({ lig_id: null, champ, valeur_client: client.document[champ] ?? null, valeur_serveur: serveur.document[champ] ?? null });
    }
  }
  const cotesServeur = new Map(serveur.lignes.map((l) => [cle(l), l]));
  for (const lc of client.lignes) {
    const ls = cotesServeur.get(cle(lc));
    cotesServeur.delete(cle(lc));
    if (!ls) { ecarts.push({ lig_id: lc.lig_id, champ: '*', valeur_client: 'présente', valeur_serveur: 'absente' }); continue; }
    for (const champ of CHAMPS_LIGNE) {
      if (!egales(lc[champ], ls[champ])) {
        ecarts.push({ lig_id: ls.lig_id, champ, valeur_client: lc[champ] ?? null, valeur_serveur: ls[champ] ?? null });
      }
    }
  }
  for (const ls of cotesServeur.values()) ecarts.push({ lig_id: ls.lig_id, champ: '*', valeur_client: 'absente', valeur_serveur: 'présente' });
  return ecarts;
}
