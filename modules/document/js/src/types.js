// Types de lignes (table type_ligne, identifiants fixes livrés par le module Document).
// OUVRAGE est la ligne composée : son prix est calculé à partir de ses composantes. SECTION est une tranche racine
// non numérotée qui englobe le corps d'un document (un document spécifique pourra en intégrer plusieurs) ; son total
// se calcule comme celui d'un titre.
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
  SECTION: 11,
});

export const CODES_TL = Object.freeze(Object.fromEntries(Object.entries(TL).map(([k, v]) => [v, k])));

export const estChiffree = (l) => l.lig_tyl_id === TL.OUVRAGE || l.lig_tyl_id === TL.ELEMENT;
export const estPied = (l) => l.lig_tyl_id === TL.PIED_HT || l.lig_tyl_id === TL.PIED_TTC || l.lig_tyl_id === TL.TVA;
export const estTypeNumerote = (l) => l.lig_tyl_id === TL.TITRE || l.lig_tyl_id === TL.OUVRAGE || l.lig_tyl_id === TL.ELEMENT;
export const accepteEnfants = (l) => l.lig_tyl_id === TL.TITRE || l.lig_tyl_id === TL.OUVRAGE || l.lig_tyl_id === TL.SECTION;
/** Tranche : ligne de regroupement totalisée (Titre, Section). */
export const estTranche = (l) => l.lig_tyl_id === TL.TITRE || l.lig_tyl_id === TL.SECTION;

// Colonnes génériques accessibles par les variables {{table.colonne}}. Elles reprennent le DDL du module
// (modules/document/db) et doivent rester alignées avec LogiBTP.Document (Document, DocumentLigne).
// Un module ou le cœur qui spécialise le document ajoute ses colonnes (voir MoteurDocument.colonnes…).
export const COLONNES_DOCUMENT = new Set([
  'ent_id', 'ent_tyd_id', 'ent_numero', 'ent_date', 'ent_objet', 'ent_notre_reference', 'ent_reference_externe',
  'ent_validite_jours', 'ent_date_validite', 'ent_std_id', 'ent_tiers_id',
  'ent_adresse_facturation', 'ent_adresse_livraison', 'ent_devise', 'ent_num_format', 'ent_precision_montant',
  'ent_version_calcul', 'ent_total_ht', 'ent_total_tva', 'ent_total_ttc', 'ent_net_a_payer', 'ent_proprietes',
  'ent_groupe_id', 'ent_indice', 'ent_is_reference', 'ent_verrouille', 'ent_copie_de_id', 'ent_version',
  'ent_cree_le', 'ent_cree_par', 'ent_modifie_le', 'ent_modifie_par', 'ent_modele', 'ent_etiquettes',
]);

export const COLONNES_LIGNE = new Set([
  'lig_id', 'lig_ent_id', 'lig_parent_id', 'lig_chemin', 'lig_ordre', 'lig_tyl_id',
  'lig_numerotation', 'lig_num_depart', 'lig_num_manuelle',
  'lig_code', 'lig_libelle_html', 'lig_libelle_affiche', 'lig_libelle_brut', 'lig_art_id', 'lig_cpt_code', 'lig_fichier_id',
  'lig_qte', 'lig_qte_type', 'lig_qte_vendue', 'lig_qte_totale', 'lig_unt_code', 'lig_precision_qte',
  'lig_pv', 'lig_coef_remise', 'lig_pv_remise', 'lig_precision_pv', 'lig_type_prix', 'lig_variante_de_id', 'lig_st_depuis_id',
  'lig_montant_ht',
  'lig_pied_mode', 'lig_pied_base', 'lig_pied_base_id', 'lig_pied_sens', 'lig_pied_valeur', 'lig_base_calcul', 'lig_montant_tva',
  'lig_tva_id', 'lig_taux_tva',
  'lig_commentaire', 'lig_is_non_editee', 'lig_origine_id', 'lig_solde', 'lig_proprietes', 'lig_etiquette',
]);

// Colonnes NUMERIC(18,6) : le moteur JS les manipule en chaînes décimales exactes.
export const COLONNES_DECIMALES = new Set([
  'ent_total_ht', 'ent_total_tva', 'ent_total_ttc', 'ent_net_a_payer',
  'lig_qte', 'lig_qte_vendue', 'lig_qte_totale', 'lig_pv', 'lig_coef_remise', 'lig_pv_remise', 'lig_montant_ht',
  'lig_pied_valeur', 'lig_base_calcul', 'lig_montant_tva', 'lig_taux_tva',
]);

export const COLONNES_DATES = new Set(['ent_date', 'ent_cree_le', 'ent_modifie_le']);

// Colonnes calculées que les formules de quantité ne peuvent pas lire (passe 1).
export const COLONNES_PRIX_CALCULES = new Set([
  'lig_pv_remise', 'lig_montant_ht', 'lig_montant_tva', 'lig_base_calcul',
  'ent_total_ht', 'ent_total_tva', 'ent_total_ttc', 'ent_net_a_payer',
]);

export const COLONNES_QTE_CALCULEES = new Set(['lig_qte_vendue', 'lig_qte_totale']);

/**
 * Pied : modes (P pourcentage de la base, M montant, C coefficient : base × (valeur − 1), le signe venant du
 * coefficient) et bases (CUMUL à ce point, TOTAL_HT et TOTAL_TTC du corps, HT_NET dernier total HT net,
 * LIGNE : sous-total de pied désigné par lig_pied_base_id).
 */
export const MODES_PIED = ['P', 'M', 'C'];
export const BASES_PIED = ['CUMUL', 'TOTAL_HT', 'HT_NET', 'TOTAL_TTC', 'LIGNE'];

/** Union d'ensembles de colonnes (spécialisation d'un module). */
export const union = (...ensembles) => new Set(ensembles.flatMap((e) => [...e]));
