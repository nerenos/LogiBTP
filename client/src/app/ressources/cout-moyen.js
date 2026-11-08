/**
 * Reprise du coût par heure de l'onglet Coûts comme coût moyen de la fiche matériel (plan materiel-suites, MO5) :
 * sur confirmation seulement. Retourne true si la reprise a eu lieu, false si elle est annulée.
 */
export async function reprendreCoutMoyen({ confirmer, reprendre, message }) {
  if (!await confirmer(message)) return false;
  await reprendre();
  return true;
}
