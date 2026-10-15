// Colonnes ajoutées par le cœur BTP aux colonnes génériques du module Document (db/100_btp.sql).
// Elles doivent rester alignées avec DocumentBtp et DocumentLigneBtp (LogiBTP.Domaine) : un test le vérifie.

export const COLONNES_DOCUMENT_BTP = new Set(['ent_mode_calcul_ouvrage', 'ent_coef_fa', 'ent_bib_id', 'ent_projet_id', 'ent_affaire_id', 'ent_chantier_id', 'ent_marche_id', 'ent_intervenants', 'ent_redacteur_id']);

export const COLONNES_LIGNE_BTP = new Set([
  'lig_nat_id', 'lig_ptv_id', 'lig_mtr_id', 'lig_qte_source', 'lig_qte_base', 'lig_coef_perte',
  'lig_pa', 'lig_coef_fg', 'lig_pr', 'lig_coef_benef', 'lig_coef_fa', 'lig_coef_prorata', 'lig_pv_affiche',
  'lig_pv_fixe', 'lig_pv_affiche_fixe', 'lig_is_ecart_arrondi', 'lig_montant_pa', 'lig_montant_pr', 'lig_pied_is_fa',
]);

export const COLONNES_DECIMALES_BTP = new Set([
  'ent_coef_fa', 'lig_qte_base', 'lig_coef_perte', 'lig_pa', 'lig_coef_fg', 'lig_pr', 'lig_coef_benef',
  'lig_coef_fa', 'lig_coef_prorata', 'lig_pv_affiche', 'lig_montant_pa', 'lig_montant_pr',
]);

export const COLONNES_PRIX_CALCULES_BTP = new Set([
  'lig_pr', 'lig_pv', 'lig_pv_affiche', 'lig_coef_fa', 'lig_montant_pa', 'lig_montant_pr', 'ent_coef_fa',
]);

export const COLONNES_QTE_CALCULEES_BTP = new Set(['lig_qte_base']);
