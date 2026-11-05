import { fusionner, TABLES_FUSION } from '../hors-ligne/fusion.js';

// Restauration d'une version précédente d'un document (écran de l'onglet Suivi › Traçabilité) : l'instantané enregistré
// dans l'historique (état avant une action : entête, lignes, métrés, variables, clés de ventilation des frais annexes)
// est rechargé dans l'éditeur en une seule étape annulable, sur l'identité actuelle du document (identifiant, numéro,
// version, statut, indice : champs tenus par le serveur), puis enregistré comme toute modification (verrou, contrôles,
// recalcul, nouvelle entrée d'historique : la version remplacée reste elle-même restaurable).

/** Tables de la saisie remplacées par la restauration (l'échéancier et le règlement du tiers restent ceux d'aujourd'hui). */
export const TABLES_RESTAUREES = TABLES_FUSION.map(([t]) => t);

/**
 * Saisie restaurée : l'instantané (document complet de l'historique) posé sur la saisie courante. Un champ absent de
 * l'instantané (version enregistrée avant l'ajout de ce champ) garde sa valeur actuelle ; une entité supprimée depuis
 * reçoit un identifiant provisoire négatif (recréée à l'enregistrement), références suivies.
 */
export function saisieRestauree(instantane, courante) {
  const local = { document: { ...courante.document, ...(instantane?.document ?? {}) } };
  for (const [table, cle] of TABLES_FUSION) {
    const actuelles = new Map((courante[table] ?? []).map((x) => [x[cle], x]));
    local[table] = (instantane?.[table] ?? []).map((x) => ({ ...(actuelles.get(x[cle]) ?? {}), ...x }));
  }
  const serveur = { document: courante.document };
  for (const t of TABLES_RESTAUREES) serveur[t] = courante[t] ?? [];
  return fusionner({ local, serveur }, { mode: 'ecraser' }).saisie;
}
