// Réponse de l'enregistrement d'un document (PUT /api/documents/{id}) appliquée au contenu de l'éditeur : entête du
// serveur et identifiants définitifs des lignes, métrés, variables et ventilations (identifiants provisoires négatifs
// du client remplacés). Commun à l'enregistrement direct et à l'envoi d'une saisie faite hors ligne.

/** Champs d'identité de l'entête repris du serveur quand la saisie a continué depuis l'envoi. */
const IDENTITE = ['ent_id', 'ent_numero', 'ent_version', 'ent_groupe_id', 'ent_indice', 'ent_std_id', 'ent_modifie_le', 'ent_modifie_par', 'ent_version_calcul'];

/** Correspondance d'un identifiant (inconnu : inchangé). */
export const correspondre = (table, id) => (id === null || id === undefined ? id : table?.[id] ?? id);

/**
 * Applique la réponse au brouillon `d` (Immer) ; `identiteSeule` : l'entête saisi depuis l'envoi est gardé, seuls ses
 * champs d'identité (numéro, version…) sont repris. Renvoie la fonction de correspondance des lignes.
 */
export function appliquerReponse(d, rep, { identiteSeule = false } = {}) {
  const serveur = rep.document.document;
  if (identiteSeule) for (const k of IDENTITE) d.document[k] = serveur[k];
  else d.document = serveur;
  const cl = rep.correspondance_lignes ?? {};
  const { metres: cm = {}, variables: cv = {}, ventilations: cf = {} } = rep.correspondances ?? {};
  const map = correspondre;
  for (const l of d.lignes) {
    l.lig_id = map(cl, l.lig_id);
    l.lig_parent_id = map(cl, l.lig_parent_id);
    l.lig_st_depuis_id = map(cl, l.lig_st_depuis_id);
    l.lig_variante_de_id = map(cl, l.lig_variante_de_id);
    l.lig_pied_base_id = map(cl, l.lig_pied_base_id);
    l.lig_mtr_id = map(cm, l.lig_mtr_id);
    l.lig_ent_id = d.document.ent_id;
  }
  for (const m of d.metres) { m.mtr_id = map(cm, m.mtr_id); m.mtr_lig_id = map(cl, m.mtr_lig_id); }
  for (const v of d.variables) { v.var_id = map(cv, v.var_id); v.var_lig_id = map(cl, v.var_lig_id); v.var_mtr_id = map(cm, v.var_mtr_id); }
  for (const k of d.ventilations ?? []) {
    k.vfr_id = map(cf, k.vfr_id);
    k.vfr_source_lig_id = map(cl, k.vfr_source_lig_id);
    k.vfr_lig_id = map(cl, k.vfr_lig_id);
    k.vfr_ent_id = d.document.ent_id;
  }
  return (id) => map(cl, id);
}
