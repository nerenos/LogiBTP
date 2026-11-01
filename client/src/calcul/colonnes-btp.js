// Colonnes ajoutées par le cœur BTP aux colonnes génériques du module Document (db/100_btp.sql).
// Elles doivent rester alignées avec DocumentBtp et DocumentLigneBtp (LogiBTP.Domaine) : un test le vérifie.

export const COLONNES_DOCUMENT_BTP = new Set(['ent_mode_calcul_ouvrage', 'ent_coef_fa', 'ent_bib_id', 'ent_projet_id', 'ent_affaire_id', 'ent_chantier_id', 'ent_marche_id', 'ent_intervenants', 'ent_redacteur_id', 'ent_fa_lignes', 'ent_fa_mode', 'ent_contact_client', 'ent_contact_payeur',
  // Exécution (db/197) : état, motif, service, responsable, dates prévues de l'ordre.
  'ent_exe_etat', 'ent_exe_motif_id', 'ent_exe_commentaire', 'ent_srv_id', 'ent_responsable_id', 'ent_debut_prevu', 'ent_fin_prevue',
  // Facture de sous-traitance (db/213) : mode de saisie, montants de la facture reçue.
  'ent_st_saisie', 'ent_st_recu_ht', 'ent_st_recu_tva', 'ent_st_recu_ttc',
  // Stock (db/216) : date-heure du mouvement, lieux d'origine et de destination.
  'ent_date_mouvement', 'ent_stk_origine_id', 'ent_stk_destination_id',
  // Approvisionnement (db/218) : date de besoin d'une réservation, livraison prévue d'une commande fournisseur.
  'ent_date_besoin', 'ent_date_livraison', 'ent_arc_numero', 'ent_arc_date', 'ent_arc_livraison',
  // Révision des prix (db/250) : mois des travaux d'une facture d'avancement.
  'ent_mois_revision']);

export const COLONNES_LIGNE_BTP = new Set([
  'lig_nat_id', 'lig_ptv_id', 'lig_mtr_id', 'lig_qte_source', 'lig_qte_base', 'lig_coef_perte',
  'lig_pa', 'lig_coef_fg', 'lig_pr', 'lig_coef_benef', 'lig_coef_fa', 'lig_coef_prorata', 'lig_pv_affiche',
  'lig_pv_fixe', 'lig_pv_affiche_fixe', 'lig_is_ecart_arrondi', 'lig_montant_pa', 'lig_montant_pr', 'lig_pied_is_fa',
  // Données techniques (db/165) : recopiées de l'élément de bibliothèque, dimensions en mètres.
  'lig_poids', 'lig_surface', 'lig_volume', 'lig_hauteur', 'lig_largeur', 'lig_epaisseur', 'lig_longueur',
  // Heures réalisées d'une ligne d'ordre (db/197).
  'lig_heures_realisees',
  // Chantier de la ligne des documents d'achat (db/248).
  'lig_cha_id',
]);

export const COLONNES_DECIMALES_BTP = new Set([
  'ent_coef_fa', 'lig_qte_base', 'lig_coef_perte', 'lig_pa', 'lig_coef_fg', 'lig_pr', 'lig_coef_benef',
  'lig_coef_fa', 'lig_coef_prorata', 'lig_pv_affiche', 'lig_montant_pa', 'lig_montant_pr',
  'lig_poids', 'lig_surface', 'lig_volume', 'lig_hauteur', 'lig_largeur', 'lig_epaisseur', 'lig_longueur', 'lig_heures_realisees',
]);

export const COLONNES_PRIX_CALCULES_BTP = new Set([
  'lig_pr', 'lig_pv', 'lig_pv_affiche', 'lig_coef_fa', 'lig_montant_pa', 'lig_montant_pr', 'ent_coef_fa',
]);

export const COLONNES_QTE_CALCULEES_BTP = new Set(['lig_qte_base']);
