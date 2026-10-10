import { D } from '@logibtp/socle';

// Champs calculés comparés entre le moteur client et le moteur serveur (même liste que ComparateurCalcul.cs).
// Une spécialisation passe ses propres listes (champs du document générique + les siens).
export const CHAMPS_DOCUMENT = ['ent_total_ht', 'ent_total_tva', 'ent_total_ttc', 'ent_net_a_payer'];
export const CHAMPS_LIGNE = [
  'lig_qte_vendue', 'lig_qte_totale', 'lig_pv', 'lig_pv_remise', 'lig_montant_ht',
  'lig_base_calcul', 'lig_montant_tva', 'lig_taux_tva', 'lig_numerotation', 'lig_libelle_affiche',
];

function egales(a, b) {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  try { return D(a).eq(D(b)); } catch { return String(a) === String(b); }
}

const cleParId = (l) => String(l.lig_id);

/**
 * Écarts { lig_id, champ, valeur_client, valeur_serveur } entre deux résultats de calcul.
 * options = { champsDocument, champsLigne, cle(ligne) → clé d'appariement des lignes }
 */
export function comparerResultats(client, serveur, { champsDocument = CHAMPS_DOCUMENT, champsLigne = CHAMPS_LIGNE, cle = cleParId } = {}) {
  const ecarts = [];
  for (const champ of champsDocument) {
    if (!egales(client.document[champ], serveur.document[champ])) {
      ecarts.push({ lig_id: null, champ, valeur_client: client.document[champ] ?? null, valeur_serveur: serveur.document[champ] ?? null });
    }
  }
  const cotesServeur = new Map(serveur.lignes.map((l) => [cle(l), l]));
  for (const lc of client.lignes) {
    const ls = cotesServeur.get(cle(lc));
    cotesServeur.delete(cle(lc));
    if (!ls) { ecarts.push({ lig_id: lc.lig_id, champ: '*', valeur_client: 'présente', valeur_serveur: 'absente' }); continue; }
    for (const champ of champsLigne) {
      if (!egales(lc[champ], ls[champ])) {
        ecarts.push({ lig_id: ls.lig_id, champ, valeur_client: lc[champ] ?? null, valeur_serveur: ls[champ] ?? null });
      }
    }
  }
  for (const ls of cotesServeur.values()) ecarts.push({ lig_id: ls.lig_id, champ: '*', valeur_client: 'absente', valeur_serveur: 'présente' });
  return ecarts;
}
