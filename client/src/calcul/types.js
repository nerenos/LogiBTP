// Types de lignes (table type_ligne, identifiants fixes du paramétrage de référence).
export const TL = Object.freeze({
  TITRE: 1,
  OUVRAGE: 2,
  ELEMENT: 3,
  TEXTE: 4,
  SOUS_TOTAL: 5,
  IMAGE: 6,
  SAUT_PAGE: 7,
  PIED_HT: 8,
  PIED_TTC: 9,
  TVA: 10,
});

export const CODES_TL = Object.freeze(Object.fromEntries(Object.entries(TL).map(([k, v]) => [v, k])));

export const estChiffree = (l) => l.lig_tyl_id === TL.OUVRAGE || l.lig_tyl_id === TL.ELEMENT;
export const estPied = (l) => l.lig_tyl_id === TL.PIED_HT || l.lig_tyl_id === TL.PIED_TTC || l.lig_tyl_id === TL.TVA;
export const estNumerotee = (l) =>
  (l.lig_tyl_id === TL.TITRE || l.lig_tyl_id === TL.OUVRAGE || l.lig_tyl_id === TL.ELEMENT) && !l.lig_is_ecart_arrondi;
export const accepteEnfants = (l) => l.lig_tyl_id === TL.TITRE || l.lig_tyl_id === TL.OUVRAGE;

// Colonnes accessibles par les variables {{table.colonne}} : elles reprennent le DDL
// et doivent rester alignées avec les propriétés de LogiBTP.Domaine (Document, DocumentLigne).
export const COLONNES_DOCUMENT = new Set([
  'ent_id', 'ent_tyd_id', 'ent_numero', 'ent_date', 'ent_objet', 'ent_std_id', 'ent_tiers_id',
  'ent_adresse_facturation', 'ent_adresse_livraison', 'ent_devise', 'ent_mode_calcul_ouvrage',
  'ent_num_format', 'ent_precision_montant', 'ent_version_calcul', 'ent_coef_fa', 'ent_total_ht',
  'ent_total_tva', 'ent_total_ttc', 'ent_net_a_payer', 'ent_proprietes', 'ent_groupe_id', 'ent_indice',
  'ent_is_reference', 'ent_verrouille', 'ent_copie_de_id', 'ent_version', 'ent_cree_le', 'ent_cree_par',
  'ent_modifie_le', 'ent_modifie_par',
]);

export const COLONNES_LIGNE = new Set([
  'lig_id', 'lig_ent_id', 'lig_parent_id', 'lig_chemin', 'lig_ordre', 'lig_tyl_id',
  'lig_numerotation', 'lig_num_depart', 'lig_num_manuelle',
  'lig_code', 'lig_libelle_html', 'lig_libelle_affiche', 'lig_libelle_brut', 'lig_art_id', 'lig_nat_id',
  'lig_ptv_id', 'lig_cpt_code', 'lig_fichier_id',
  'lig_qte', 'lig_qte_type', 'lig_mtr_id', 'lig_qte_source', 'lig_qte_base', 'lig_coef_perte',
  'lig_qte_vendue', 'lig_qte_totale', 'lig_unt_code', 'lig_precision_qte',
  'lig_pa', 'lig_coef_fg', 'lig_pr', 'lig_coef_benef', 'lig_pv', 'lig_coef_fa', 'lig_pv_affiche',
  'lig_coef_remise', 'lig_pv_remise', 'lig_precision_pv', 'lig_pv_fixe', 'lig_pv_affiche_fixe',
  'lig_type_prix', 'lig_variante_de_id', 'lig_is_ecart_arrondi', 'lig_st_depuis_id',
  'lig_montant_pa', 'lig_montant_pr', 'lig_montant_ht',
  'lig_pied_mode', 'lig_pied_base', 'lig_pied_sens', 'lig_pied_valeur', 'lig_pied_is_fa',
  'lig_base_calcul', 'lig_montant_tva', 'lig_tva_id', 'lig_taux_tva',
  'lig_commentaire', 'lig_is_non_editee', 'lig_origine_id', 'lig_proprietes',
]);

// Colonnes NUMERIC(18,6) : le moteur JS les manipule en chaînes décimales exactes.
export const COLONNES_DECIMALES = new Set([
  'ent_coef_fa', 'ent_total_ht', 'ent_total_tva', 'ent_total_ttc', 'ent_net_a_payer',
  'lig_qte', 'lig_qte_base', 'lig_coef_perte', 'lig_qte_vendue', 'lig_qte_totale',
  'lig_pa', 'lig_coef_fg', 'lig_pr', 'lig_coef_benef', 'lig_pv', 'lig_coef_fa', 'lig_pv_affiche',
  'lig_coef_remise', 'lig_pv_remise', 'lig_montant_pa', 'lig_montant_pr', 'lig_montant_ht',
  'lig_pied_valeur', 'lig_base_calcul', 'lig_montant_tva', 'lig_taux_tva',
]);

export const COLONNES_DATES = new Set(['ent_date', 'ent_cree_le', 'ent_modifie_le']);

// Colonnes calculées que les formules de quantité et de métré ne peuvent pas lire (passe 1).
export const COLONNES_PRIX_CALCULES = new Set([
  'lig_pr', 'lig_pv', 'lig_pv_affiche', 'lig_pv_remise', 'lig_coef_fa', 'lig_montant_pa', 'lig_montant_pr',
  'lig_montant_ht', 'lig_montant_tva', 'lig_base_calcul',
  'ent_coef_fa', 'ent_total_ht', 'ent_total_tva', 'ent_total_ttc', 'ent_net_a_payer',
]);

export const COLONNES_QTE_CALCULEES = new Set(['lig_qte_base', 'lig_qte_vendue', 'lig_qte_totale']);
