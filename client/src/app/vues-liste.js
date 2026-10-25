import { CASQUETTES, NIVEAUX, ROLES } from './annuaire/donnees.js';

// Thèmes, sources et vues de liste fournis par le cœur. Les mêmes définitions alimentent la démo hors ligne et le
// script db/121_vues_liste.sql (généré par client/scripts/generer-vues-liste.mjs) : une seule source de vérité.

export const SOURCES_LISTE = {
  documents: {
    libelle: 'Documents (devis, commandes, factures…)', vue: 'v_liste_documents', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'bigint'], ['type_element', 'text'], ['type_document', 'text'], ['famille', 'text'], ['numero', 'text'], ['indice', 'text'],
      ['date_document', 'date'], ['objet', 'text'], ['chantier', 'text'], ['statut', 'text'], ['tiers', 'bigint'],
      ['total_ht', 'numeric'], ['total_ttc', 'numeric'], ['net_a_payer', 'numeric'], ['reference', 'boolean'],
      ['verrouille', 'boolean'], ['modifie_le', 'timestamp with time zone'],
      ['client', 'text'], ['projet', 'text'], ['affaire', 'text'], ['marche', 'text'],
      ['projet_id', 'integer'], ['affaire_id', 'integer'], ['chantier_id', 'integer'], ['marche_id', 'integer'],
      ['alerte', 'text'], ['numero_situation', 'integer'], ['facture', 'text'],
    ],
  },
  // Ordres du module Exécution (db/197 : v_liste_ordres = documents de la famille E + exécution).
  ordres: {
    libelle: 'Ordres (exécution)', vue: 'v_liste_ordres', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'bigint'], ['type_element', 'text'], ['type_document', 'text'], ['famille', 'text'], ['numero', 'text'], ['indice', 'text'],
      ['date_document', 'date'], ['objet', 'text'], ['chantier', 'text'], ['statut', 'text'], ['tiers', 'bigint'],
      ['total_ht', 'numeric'], ['total_ttc', 'numeric'], ['net_a_payer', 'numeric'], ['reference', 'boolean'],
      ['verrouille', 'boolean'], ['modifie_le', 'timestamp with time zone'],
      ['client', 'text'], ['projet', 'text'], ['affaire', 'text'], ['marche', 'text'],
      ['projet_id', 'integer'], ['affaire_id', 'integer'], ['chantier_id', 'integer'], ['marche_id', 'integer'],
      ['alerte', 'text'], ['numero_situation', 'integer'], ['facture', 'text'],
      ['etat_execution', 'text'], ['motif', 'text'], ['service', 'text'], ['service_id', 'integer'], ['responsable', 'text'],
      ['debut_prevu', 'date'], ['fin_prevue', 'date'], ['heures_budget', 'numeric'], ['en_retard', 'boolean'],
      ['etape_en_cours', 'text'], ['prochaine_date', 'date'], ['ressource', 'text'],
    ],
  },
  // Pointages du module Pointage (db/199 : v_liste_pointages, couches saisie et validée).
  pointages: {
    libelle: "Pointages (main-d'œuvre)", vue: 'v_liste_pointages', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'bigint'], ['type_element', 'text'], ['date_pointage', 'date'], ['salarie', 'text'], ['matricule', 'text'], ['salarie_id', 'integer'],
      ['interimaire', 'boolean'], ['service', 'text'], ['service_id', 'integer'], ['chantier', 'text'], ['chantier_libelle', 'text'],
      ['chantier_id', 'integer'], ['interne', 'boolean'], ['ordre', 'text'], ['type_mo', 'text'], ['sous_type', 'text'], ['productif', 'boolean'],
      ['heures', 'numeric'], ['couche', 'text'], ['motif', 'text'], ['commentaire', 'text'], ['saisi_par', 'text'],
      ['saisi_le', 'timestamp with time zone'], ['semaine', 'date'], ['taux', 'numeric'], ['cout', 'numeric'], ['valorisation', 'text'],
    ],
  },
  // Structure des affaires (db/160_structure.sql) : projets, affaires, chantiers, marchés.
  projets: {
    libelle: 'Projets (chiffrage)', vue: 'v_liste_projets', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'integer'], ['type_element', 'text'], ['code', 'text'], ['libelle', 'text'], ['client', 'text'], ['statut', 'text'],
      ['date_remise', 'date'], ['date_decision', 'date'], ['montant_estime', 'numeric'], ['ville', 'text'], ['responsable', 'text'],
      ['chantier', 'text'], ['nb_documents', 'bigint'],
    ],
  },
  affaires: {
    libelle: 'Affaires', vue: 'v_liste_affaires', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'integer'], ['type_element', 'text'], ['code', 'text'], ['libelle', 'text'], ['nature', 'text'], ['client', 'text'], ['statut', 'text'],
      ['date_ouverture', 'date'], ['responsable', 'text'], ['nb_chantiers', 'bigint'], ['montant_marches', 'numeric'], ['facture_ht', 'numeric'],
    ],
  },
  chantiers: {
    libelle: 'Chantiers', vue: 'v_liste_chantiers', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'integer'], ['type_element', 'text'], ['code', 'text'], ['libelle', 'text'], ['affaire', 'text'], ['projet', 'text'], ['client', 'text'],
      ['ville', 'text'], ['statut', 'text'], ['date_ouverture', 'date'], ['date_fin_prevue', 'date'], ['conducteur', 'text'],
      ['nb_marches', 'bigint'], ['montant_marches', 'numeric'], ['facture_ht', 'numeric'],
    ],
  },
  marches: {
    libelle: 'Marchés', vue: 'v_liste_marches', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'integer'], ['type_element', 'text'], ['code', 'text'], ['libelle', 'text'], ['chantier', 'text'], ['affaire', 'text'], ['client', 'text'],
      ['commande', 'text'], ['nature', 'text'], ['montant_ht', 'numeric'], ['statut', 'text'], ['date_marche', 'date'],
      ['facture_ht', 'numeric'], ['reste_a_facturer', 'numeric'],
    ],
  },
  marches_st: {
    libelle: 'Marchés de sous-traitance', vue: 'v_liste_marches_st', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'integer'], ['type_element', 'text'], ['code', 'text'], ['libelle', 'text'], ['chantier', 'text'], ['affaire', 'text'], ['sous_traitant', 'text'],
      ['marche_vente', 'text'], ['nature', 'text'], ['garantie', 'text'], ['montant_ht', 'numeric'], ['montant_agree', 'numeric'], ['facture_ht', 'numeric'],
      ['reste_a_facturer', 'numeric'], ['statut', 'text'], ['date_marche', 'date'], ['fin_contractuelle', 'date'], ['nb_avenants', 'bigint'],
      ['chantier_id', 'integer'], ['tiers_id', 'bigint'],
    ],
  },
  // Module Stock (db/216) : journal des mouvements, dépôts et chantiers qui tiennent un stock.
  stk_mouvements: {
    libelle: 'Mouvements de stock', vue: 'v_liste_stk_mouvements', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'bigint'], ['type_element', 'text'], ['date_mouvement', 'timestamp with time zone'], ['lieu', 'text'], ['lieu_libelle', 'text'], ['depot', 'boolean'],
      ['article', 'text'], ['article_libelle', 'text'], ['unite', 'text'], ['quantite', 'numeric'], ['sens', 'text'], ['prix', 'numeric'], ['provisoire', 'boolean'],
      ['pmp', 'numeric'], ['valeur', 'numeric'], ['piece', 'text'], ['type_piece', 'text'], ['type_document', 'text'], ['tiers', 'text'], ['emplacement', 'text'],
      ['origine', 'text'], ['element_id', 'bigint'], ['lieu_id', 'bigint'], ['document_id', 'bigint'],
    ],
  },
  depots: {
    libelle: 'Dépôts de stock', vue: 'v_liste_depots', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'integer'], ['type_element', 'text'], ['code', 'text'], ['libelle', 'text'], ['depot', 'boolean'], ['ville', 'text'], ['statut', 'text'],
      ['nb_articles', 'bigint'], ['valeur', 'numeric'], ['nb_emplacements', 'bigint'],
    ],
  },
  salaries: {
    libelle: 'Salariés (démonstration)', vue: 'v_liste_salaries', colonne_id: 'id', colonne_type: 'type_element',
    // Saisie dans les listes : vue simple sur une table ; type_element est calculé (lecture seule dans la base).
    // service : libellé du service principal (lecture seule) ; service_code : son code (db/226).
    modifiable: true, lecture_seule: ['id', 'type_element', 'service'],
    colonnes: [
      ['id', 'integer'], ['type_element', 'text'], ['matricule', 'text'], ['nom', 'text'], ['prenom', 'text'], ['service', 'text'], ['poste', 'text'],
      ['statut', 'text'], ['date_entree', 'date'], ['salaire_brut', 'numeric'], ['heures_mois', 'numeric'], ['actif', 'boolean'],
      ['commentaire', 'text'], ['code', 'text'], ['matricule_paie', 'text'], ['service_code', 'text'],
    ],
  },
  materiels: {
    libelle: 'Matériels (démonstration)', vue: 'v_liste_materiels', colonne_id: 'id', type_element: 'materiel',
    modifiable: true, lecture_seule: ['id'],
    colonnes: [
      ['id', 'integer'], ['code', 'text'], ['designation', 'text'], ['famille', 'text'], ['etat', 'text'], ['chantier', 'text'],
      ['valeur_achat', 'numeric'], ['date_achat', 'date'], ['heures_utilisation', 'integer'], ['heures_revision', 'integer'],
      ['controle_ok', 'boolean'], ['observations', 'text'],
    ],
  },
  elements: {
    libelle: 'Bibliothèque : articles et ouvrages', vue: 'v_liste_elements', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'bigint'], ['type_element', 'text'], ['bib_code', 'text'], ['code', 'text'], ['type', 'text'], ['libelle', 'text'], ['famille', 'text'],
      ['nature', 'text'], ['regroupement', 'text'], ['gestion', 'text'], ['unite_stock', 'text'], ['scenario_pa', 'text'], ['pa', 'numeric'],
      ['coef_fg', 'numeric'], ['pr', 'numeric'], ['coef_benef', 'numeric'], ['pv', 'numeric'], ['pv_net', 'numeric'], ['actif', 'boolean'],
      ['modifie_le', 'timestamp with time zone'], ['fam_id', 'integer'], ['nat_id', 'integer'],
      // Module Stock (db/217) : marques de l'article.
      ['marques', 'ARRAY'],
    ],
  },
  // Annuaire : relations (casquettes) et rôles sont des colonnes multivaluées (tableaux de codes) ; segments et filtres « parmi ».
  personnes: {
    libelle: 'Annuaire : personnes (sociétés, établissements, particuliers…)', vue: 'v_liste_personnes', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'bigint'], ['type_element', 'text'], ['code', 'text'], ['raison_sociale', 'text'], ['nom_commercial', 'text'], ['niveau', 'text'],
      ['casquettes', 'ARRAY'], ['parent', 'text'], ['chemin', 'text'], ['siren', 'text'], ['siret', 'text'], ['tva_intra', 'text'], ['pays', 'text'],
      ['adresse', 'text'], ['code_postal', 'text'], ['ville', 'text'], ['telephone', 'text'], ['email', 'text'], ['contact', 'text'],
      ['societe_base', 'boolean'], ['actif', 'boolean'], ['modifie_le', 'timestamp with time zone'], ['provisoire', 'boolean'],
    ],
  },
  individus: {
    libelle: 'Annuaire : individus (contacts, salariés, particuliers…)', vue: 'v_liste_individus', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'bigint'], ['type_element', 'text'], ['civilite', 'text'], ['nom', 'text'], ['prenom', 'text'], ['nom_complet', 'text'], ['personnes', 'text'],
      ['fonction', 'text'], ['roles', 'ARRAY'], ['telephone', 'text'], ['portable', 'text'], ['email', 'text'], ['ville', 'text'], ['utilisateur', 'text'],
      ['actif', 'boolean'], ['modifie_le', 'timestamp with time zone'],
    ],
  },
  ged: {
    libelle: 'Documents (GED)', vue: 'v_liste_ged', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'bigint'], ['type_element', 'text'], ['titre', 'text'], ['categorie', 'text'], ['nature', 'text'], ['type_lie', 'text'],
      ['id_lie', 'text'], ['auteur', 'text'], ['date_document', 'date'], ['etat', 'text'], ['coffre', 'boolean'], ['nom_fichier', 'text'],
      ['type_mime', 'text'], ['taille', 'bigint'], ['version', 'integer'], ['objet_mail', 'text'], ['resume', 'text'], ['notes', 'text'],
      ['cree_le', 'timestamp with time zone'], ['cree_par', 'text'],
    ],
  },
  ressources: {
    libelle: 'Ressources : équipes, salariés, intérimaires, matériels, sous-traitants (démonstration)', vue: 'v_liste_ressources',
    colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'text'], ['type_element', 'text'], ['code', 'text'], ['libelle', 'text'], ['categorie', 'text'], ['statut', 'text'],
      ['disponible', 'boolean'], ['cout_horaire', 'numeric'], ['chantier', 'text'], ['observations', 'text'],
    ],
  },
};

const col = (code, titre, extra = {}) => ({ code, titre, ...extra });
const nombre = (decimales = 2) => ({ format: 'nombre', decimales });
const fixe = (valeur) => ({ largeur: { mode: 'fixe', valeur } });
const prop = (valeur, min, max) => ({ largeur: { mode: 'proportionnel', valeur, min, max } });

/**
 * Thèmes de vues (liste complétée par les administrateurs). Les types d'élément restreignent les lignes des vues du
 * thème : plusieurs types (Ressources) ou un seul type d'une source plus large (Devis parmi les documents).
 */
export const THEMES_LISTE = [
  { thl_code: 'documents', thl_libelle: 'Documents', thl_icone: '📄', thl_ordre: 10, thl_types: [] },
  { thl_code: 'devis', thl_libelle: 'Devis', thl_icone: '📝', thl_ordre: 20, thl_types: [{ code: 'V_DEVIS', libelle: 'Devis client' }] },
  { thl_code: 'commandes', thl_libelle: 'Commandes clients', thl_icone: '🤝', thl_ordre: 22, thl_types: [{ code: 'V_COMMANDE', libelle: 'Commande client' }] },
  {
    thl_code: 'livraisons', thl_libelle: 'Livraisons et retours', thl_icone: '🚚', thl_ordre: 24,
    thl_types: [{ code: 'V_RECEPTION', libelle: 'Bon de livraison' }, { code: 'V_RETOUR', libelle: 'Bon de retour client' }],
  },
  { thl_code: 'situations', thl_libelle: 'Situations de travaux', thl_icone: '📈', thl_ordre: 26, thl_types: [{ code: 'V_SITUATION', libelle: 'Situation de travaux' }] },
  {
    thl_code: 'factures', thl_libelle: 'Factures', thl_icone: '💶', thl_ordre: 30,
    thl_types: [{ code: 'V_FACTURE', libelle: 'Facture' }, { code: 'V_FACTURE_AVT', libelle: 'Facture d\'avancement' }, { code: 'V_AVOIR', libelle: 'Avoir' }],
  },
  { thl_code: 'achats_ddp', thl_libelle: 'Demandes de prix', thl_icone: '📨', thl_ordre: 32, thl_types: [{ code: 'A_DEVIS', libelle: 'Demande de prix fournisseur' }] },
  { thl_code: 'achats_commandes', thl_libelle: 'Commandes fournisseurs', thl_icone: '📦', thl_ordre: 34, thl_types: [{ code: 'A_COMMANDE', libelle: 'Commande fournisseur' }] },
  {
    thl_code: 'achats_livraisons', thl_libelle: 'Livraisons et retours fournisseurs', thl_icone: '🚛', thl_ordre: 35,
    thl_types: [{ code: 'A_RECEPTION', libelle: 'Bon de livraison fournisseur' }, { code: 'A_RETOUR', libelle: 'Bon de retour fournisseur' }],
  },
  { thl_code: 'projets', thl_libelle: 'Projets', thl_icone: '🎯', thl_ordre: 11, thl_types: [{ code: 'projet', libelle: 'Projet' }] },
  {
    thl_code: 'ordres', thl_libelle: 'Ordres (exécution)', thl_icone: '🛠', thl_ordre: 38,
    thl_types: [{ code: 'E_OE', libelle: "Ordre d'exécution" }, { code: 'E_PO', libelle: 'Ordre de pose' }, { code: 'E_DAP', libelle: "Demande d'approvisionnement" },
      { code: 'E_BE', libelle: "Ordre du bureau d'études" }, { code: 'E_BM', libelle: 'Ordre du bureau des méthodes' }, { code: 'E_OF', libelle: 'Ordre de fabrication' }, { code: 'E_CO', libelle: 'Ordre de colisage' }, { code: 'E_LI', libelle: 'Ordre de livraison' }, { code: 'E_SAV', libelle: 'Intervention SAV' }, { code: 'E_OST', libelle: 'Ordre de sous-traitance' }, { code: 'E_DAC', libelle: "Demande d'achat" }],
  },
  { thl_code: 'pointages', thl_libelle: 'Pointages', thl_icone: '⏱', thl_ordre: 39, thl_types: [{ code: 'pointage', libelle: 'Pointage' }] },
  { thl_code: 'affaires', thl_libelle: 'Affaires', thl_icone: '🗂', thl_ordre: 12, thl_types: [{ code: 'affaire', libelle: 'Affaire' }] },
  { thl_code: 'chantiers', thl_libelle: 'Chantiers', thl_icone: '🏗', thl_ordre: 13, thl_types: [{ code: 'chantier', libelle: 'Chantier' }] },
  { thl_code: 'marches', thl_libelle: 'Marchés', thl_icone: '📜', thl_ordre: 14, thl_types: [{ code: 'marche', libelle: 'Marché' }] },
  { thl_code: 'marches_st', thl_libelle: 'Marchés de sous-traitance', thl_icone: '🤝', thl_ordre: 41, thl_types: [{ code: 'marche', libelle: 'Marché de sous-traitance' }] },
  { thl_code: 'st_ao', thl_libelle: "Appels d'offres de sous-traitance", thl_icone: '📨', thl_ordre: 42, thl_types: [{ code: 'T_AO', libelle: "Appel d'offres de sous-traitance" }] },
  { thl_code: 'st_commandes', thl_libelle: 'Commandes de sous-traitance', thl_icone: '📝', thl_ordre: 43, thl_types: [{ code: 'T_COMMANDE', libelle: 'Commande de sous-traitance' }] },
  {
    thl_code: 'st_factures', thl_libelle: 'Factures de sous-traitance', thl_icone: '🧾', thl_ordre: 44,
    thl_types: [{ code: 'T_FACTURE_AVT', libelle: "Facture d'avancement de sous-traitance" }, { code: 'T_AVOIR', libelle: 'Avoir de sous-traitance' }],
  },
  { thl_code: 'stk_mouvements', thl_libelle: 'Mouvements de stock', thl_icone: '🔁', thl_ordre: 45, thl_types: [{ code: 'mouvement_stock', libelle: 'Mouvement de stock' }] },
  { thl_code: 'depots', thl_libelle: 'Dépôts de stock', thl_icone: '🏬', thl_ordre: 46, thl_types: [{ code: 'chantier', libelle: 'Dépôt' }] },
  { thl_code: 'stock_reservations', thl_libelle: 'Réservations de stock', thl_icone: '📌', thl_ordre: 48, thl_types: [{ code: 'S_RESERVATION', libelle: 'Réservation' }, { code: 'S_DEMANDE', libelle: 'Demande de stock' }] },
  {
    thl_code: 'stock_documents', thl_libelle: 'Entrées, sorties et transferts', thl_icone: '🚚', thl_ordre: 47,
    thl_types: [{ code: 'S_ENTREE', libelle: 'Entrée de stock' }, { code: 'S_SORTIE', libelle: 'Sortie de stock' }, { code: 'S_TRANSFERT', libelle: 'Transfert de stock' }],
  },
  {
    thl_code: 'achats_factures', thl_libelle: 'Factures fournisseurs', thl_icone: '🧾', thl_ordre: 36,
    thl_types: [{ code: 'A_FACTURE', libelle: 'Facture fournisseur' }, { code: 'A_FACTURE_AVT', libelle: 'Situation fournisseur' }, { code: 'A_AVOIR', libelle: 'Avoir fournisseur' }],
  },
  { thl_code: 'salaries', thl_libelle: 'Salariés', thl_icone: '👷', thl_ordre: 40, thl_types: [{ code: 'salarie', libelle: 'Salarié' }, { code: 'interim', libelle: 'Intérimaire' }] },
  { thl_code: 'materiels', thl_libelle: 'Matériels', thl_icone: '🚜', thl_ordre: 50, thl_types: [{ code: 'materiel', libelle: 'Matériel' }] },
  { thl_code: 'bibliotheque', thl_libelle: 'Bibliothèque', thl_icone: '📚', thl_ordre: 65, thl_types: [{ code: 'element', libelle: 'Élément' }] },
  { thl_code: 'tiers', thl_libelle: 'Tiers', thl_icone: '🏢', thl_ordre: 15, thl_types: [{ code: 'personne', libelle: 'Personne' }] },
  { thl_code: 'contacts', thl_libelle: 'Contacts', thl_icone: '👤', thl_ordre: 16, thl_types: [{ code: 'individu', libelle: 'Individu' }] },
  { thl_code: 'ged', thl_libelle: 'Documents (GED)', thl_icone: '📎', thl_ordre: 70, thl_types: [{ code: 'document_ged', libelle: 'Document' }] },
  {
    thl_code: 'ressources', thl_libelle: 'Ressources', thl_icone: '🧰', thl_ordre: 60,
    thl_types: [{ code: 'equipe', libelle: 'Équipe' }, { code: 'salarie', libelle: 'Salarié' }, { code: 'interim', libelle: 'Intérim' },
      { code: 'materiel', libelle: 'Matériel' }, { code: 'sous_traitant', libelle: 'Sous-traitant' }],
  },
].map((t) => ({ ...t, thl_actif: true }));

export const VUES_LISTE = [
  {
    vli_id: 1, vli_nom: 'Documents', vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
    definition: {
      theme: 'documents',
      source: { mode: 'vue', vue: 'documents', colonne_id: 'id', colonne_type: 'type_element' },
      colonnes: [
        col('type_document', 'Type', { ...prop(1.2, 90, 180) }),
        col('numero', 'N°', { ...fixe(110), style: { gras: true } }),
        col('indice', 'Ind.', { ...fixe(48), alignement: 'centre' }),
        col('date_document', 'Date', { format: 'date', ...fixe(92), recherche: false }),
        col('objet', 'Objet', { ...prop(3, 160) }),
        col('client', 'Tiers', { ...prop(2, 120) }),
        col('chantier', 'Chantier', { ...prop(2, 120) }),
        col('affaire', 'Affaire', { ...fixe(90), masquee: true }),
        col('projet', 'Projet', { ...fixe(90), masquee: true }),
        col('marche', 'Marché', { ...fixe(90), masquee: true }),
        col('statut', 'Statut', {
          format: 'picto', ...fixe(64),
          options: [
            { valeur: 'Brouillon', libelle: 'Brouillon', picto: '📝' }, { valeur: 'Validé', libelle: 'Validé', picto: '✅' },
            { valeur: 'Accepté', libelle: 'Accepté', picto: '👍' }, { valeur: 'Facturé', libelle: 'Facturé', picto: '💶' },
            { valeur: 'Soldé', libelle: 'Soldé', picto: '🔒' }, { valeur: 'Annulé', libelle: 'Annulé', picto: '⛔' },
          ],
        }),
        col('total_ht', 'Total\nHT', { ...nombre(), ...fixe(100), recherche: false }),
        col('net_a_payer', 'Net à\npayer', { ...nombre(), ...fixe(100), recherche: false, style: { gras: true } }),
        col('reference', 'Réf.', { format: 'coche', ...fixe(48), bulle: 'Indice de référence du groupe', recherche: false }),
        col('famille', 'Famille', { masquee: true }),
        // Alertes (CONCEPTION-REGLES-DOCUMENTS.md, R3, P25) : document rejeté à annuler, validité dépassée.
        col('alerte', 'Alerte', { ...prop(1.5, 90, 220), style: { couleur: '#b42318' } }),
      ],
      segments: [{ colonne: 'type_document', titre: 'Type' }, { colonne: 'statut', titre: 'Statut' }],
      tri: [{ colonne: 'date_document', sens: 'desc' }],
      lignes: 'multi',
      taille_lot: 100,
    },
  },
  {
    vli_id: 2, vli_nom: 'Salariés (démo)', vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
    definition: {
      theme: 'salaries',
      source: { mode: 'vue', vue: 'salaries', colonne_id: 'id', colonne_type: 'type_element' },
      colonnes: [
        col('matricule', 'Matricule', { ...fixe(90) }),
        col('code', 'Code', { modifiable: true, ...fixe(80), bulle: 'Code court du salarié (recherche, homonymes)' }),
        col('matricule_paie', 'Matricule\nde paie', { modifiable: true, ...fixe(96) }),
        col('nom', 'Nom', { modifiable: true, ...prop(1.5, 110), style: { gras: true },
          regles: [{ condition: 'NON [actif]', style: { couleur: '#667085', italique: true, barre: true } }],
        }),
        col('prenom', 'Prénom', { modifiable: true, ...prop(1.2, 100) }),
        col('service', 'Service', { ...prop(1.2, 100) }),
        col('poste', 'Poste', { modifiable: true, ...prop(1.5, 120) }),
        col('statut', 'Contrat', { modifiable: true, format: 'combo', ...fixe(90),
          options: [{ valeur: 'CDI', libelle: 'CDI' }, { valeur: 'CDD', libelle: 'CDD' }, { valeur: 'INTERIM', libelle: 'Intérim' }],
          regles: [{ condition: '[statut] = "INTERIM"', style: { fond: '#fff4e0', couleur: '#7a4500' } }, { condition: '[statut] = "CDD"', style: { fond: '#e3edfb', couleur: '#1d4f91' } }],
        }),
        col('date_entree', 'Date\nd\'entrée', { modifiable: true, format: 'date', ...fixe(92), recherche: false }),
        col('salaire_brut', 'Salaire\nbrut', { modifiable: true, ...nombre(), ...fixe(96), recherche: false,
          regles: [{ condition: '[salaire_brut] >= 4000', style: { gras: true, couleur: '#067647' } }],
        }),
        col('cout_annuel', 'Coût annuel\nchargé', { calcul: true, formule: 'ARRONDI([Salaire brut] * 12 * 1,45; 0)', ...nombre(0), ...fixe(104), bulle: 'Salaire brut × 12 × 1,45' }),
        col('actif', 'Actif', { modifiable: true, format: 'coche', ...fixe(52), recherche: false }),
        col('commentaire', 'Commentaire', { modifiable: true, ...prop(2.5, 140) }),
      ],
      segments: [{ colonne: 'service', titre: 'Service' }, { colonne: 'statut', titre: 'Contrat' }],
      tri: [{ colonne: 'nom', sens: 'asc' }],
      lignes: 'multi',
      taille_lot: 100,
    },
  },
  {
    vli_id: 3, vli_nom: 'Matériels (démo)', vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
    definition: {
      theme: 'materiels',
      source: { mode: 'vue', vue: 'materiels', colonne_id: 'id', type_element: 'materiel' },
      colonnes: [
        col('code', 'Code', { ...fixe(84), style: { gras: true } }),
        col('designation', 'Désignation', { modifiable: true, ...prop(2.5, 160), regles: [{ condition: '[etat] = "PANNE"', style: { couleur: '#b42318' } }],
        }),
        col('famille', 'Famille', { modifiable: true, ...prop(1.2, 100) }),
        col('etat', 'État', { modifiable: true, format: 'picto', ...fixe(56),
          options: [
            { valeur: 'DISPO', libelle: 'Disponible', picto: '🟢' }, { valeur: 'CHANTIER', libelle: 'En chantier', picto: '🔵' },
            { valeur: 'PANNE', libelle: 'En panne', picto: '🔴' }, { valeur: 'REBUT', libelle: 'Rebut', picto: '⚫' },
          ],
          regles: [{ condition: '[etat] = "PANNE"', style: { fond: '#fdecea', couleur: '#b42318' } }],
        }),
        col('chantier', 'Chantier', { modifiable: true, ...prop(1.5, 110) }),
        col('heures_utilisation', 'Heures\nd\'utilisation', { modifiable: true, ...nombre(0), ...fixe(96), recherche: false }),
        col('heures_revision', 'Révision\n(heures)', { modifiable: true, ...nombre(0), ...fixe(84), recherche: false }),
        col('revision', 'Révision', {
          calcul: true, formule: 'SI [Heures d\'utilisation] > [heures_revision] ALORS "Révision à prévoir" SINON ""', ...fixe(130),
          regles: [{ condition: '[revision] <> ""', style: { fond: '#fff4e0', gras: true, couleur: '#a15c00' } }],
        }),
        col('controle_ok', 'Contrôle\nOK', { modifiable: true, format: 'coche', ...fixe(64), recherche: false }),
        col('valeur_achat', 'Valeur\nd\'achat', { ...nombre(), ...fixe(100), recherche: false }),
        col('observations', 'Observations', { modifiable: true, ...prop(2, 140), masquee: false }),
      ],
      segments: [{ colonne: 'famille', titre: 'Famille' }, { colonne: 'etat', titre: 'État' }],
      tri: [{ colonne: 'code', sens: 'asc' }],
      lignes: 'multi',
      taille_lot: 100,
    },
  },
];

// Vue filtrée par un filtre fixe (appliqué par la base) : les salariés actifs uniquement.
const salaries = VUES_LISTE.find((v) => v.vli_id === 2);
VUES_LISTE.push({
  ...structuredClone(salaries), vli_id: 4, vli_nom: 'Salariés actifs (démo)',
  definition: { ...structuredClone(salaries.definition), filtres: [{ colonne: 'actif', op: 'vrai' }] },
});

// Thèmes filtrants : même source que Documents, restreinte aux types du thème (devis, factures).
const documents = VUES_LISTE.find((v) => v.vli_id === 1);
// Situations et factures : n° de situation du marché et pièce d'avancement liée (db/185), après le numéro.
const COLONNES_AVANCEMENT = [
  col('numero_situation', 'N° sit.', { ...fixe(64), alignement: 'centre', ...nombre(0), recherche: false }),
  col('facture', 'Facture / situation', { ...fixe(130) }),
];
const vueDocuments = (vli_id, vli_nom, theme) => {
  const definition = { ...structuredClone(documents.definition), theme, segments: [{ colonne: 'statut', titre: 'Statut' }] };
  if (['situations', 'factures'].includes(theme)) {
    const i = definition.colonnes.findIndex((c) => c.code === 'numero');
    definition.colonnes.splice(i + 1, 0, ...structuredClone(COLONNES_AVANCEMENT));
  }
  return { ...structuredClone(documents), vli_id, vli_nom, definition };
};
VUES_LISTE.push(vueDocuments(5, 'Devis', 'devis'), vueDocuments(6, 'Factures et avoirs', 'factures'));
// Achats (menu Achats du bandeau) : mêmes colonnes, documents filtrés par les types du thème.
VUES_LISTE.push(vueDocuments(9, 'Demandes de prix', 'achats_ddp'), vueDocuments(10, 'Commandes fournisseurs', 'achats_commandes'),
  vueDocuments(11, 'Factures fournisseurs', 'achats_factures'));
VUES_LISTE.push(vueDocuments(27, 'Commandes clients', 'commandes'), vueDocuments(28, 'Livraisons et retours', 'livraisons'),
  vueDocuments(29, 'Situations de travaux', 'situations'), vueDocuments(30, 'Livraisons et retours fournisseurs', 'achats_livraisons'));

// Sous-traitance (menu Sous-traitance) : documents de la famille T.
VUES_LISTE.push(vueDocuments(1200, "Appels d'offres de sous-traitance", 'st_ao'), vueDocuments(1201, 'Commandes de sous-traitance', 'st_commandes'),
  vueDocuments(1202, 'Factures de sous-traitance', 'st_factures'));

// Stock (menu Stock) : entrées, sorties et transferts (vue 1300).
VUES_LISTE.push(vueDocuments(1300, 'Entrées, sorties et transferts', 'stock_documents'), vueDocuments(1303, 'Réservations de stock', 'stock_reservations'));

// Structure des affaires : projets, affaires, chantiers, marchés (fiches du même nom).
const vueStructure = (vli_id, vli_nom, theme, colonnes, segments, tri = [{ colonne: 'code', sens: 'desc' }]) => ({
  vli_id, vli_nom, vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
  definition: {
    theme, source: { mode: 'vue', vue: theme, colonne_id: 'id', colonne_type: 'type_element' },
    colonnes, segments, tri, lignes: 'multi', taille_lot: 100,
  },
});
const montant = (code, titre, extra = {}) => col(code, titre, { ...nombre(), ...fixe(110), recherche: false, ...extra });
const statut = (options) => col('statut', 'Statut', { format: 'picto', ...fixe(64), options });
VUES_LISTE.push(
  vueStructure(31, 'Projets', 'projets', [
    col('code', 'Code', { ...fixe(100), style: { gras: true } }), col('libelle', 'Projet', { ...prop(3, 160) }), col('client', 'Client', { ...prop(2, 120) }),
    statut([{ valeur: 'EN_COURS', libelle: 'En cours', picto: '✏️' }, { valeur: 'REMIS', libelle: 'Offre remise', picto: '📨' },
      { valeur: 'OBTENU', libelle: 'Obtenu', picto: '🏆' }, { valeur: 'PERDU', libelle: 'Perdu', picto: '❌' }, { valeur: 'ABANDONNE', libelle: 'Abandonné', picto: '⛔' }]),
    col('date_remise', 'Remise', { format: 'date', ...fixe(92), recherche: false }), montant('montant_estime', 'Montant\nestimé'),
    col('ville', 'Ville', { ...prop(1, 90) }), col('chantier', 'Chantier', { ...fixe(100) }), col('responsable', 'Responsable', { masquee: true }),
    col('nb_documents', 'Docs', { ...nombre(0), ...fixe(56), recherche: false }),
  ], [{ colonne: 'statut', titre: 'Statut' }, { colonne: 'responsable', titre: 'Responsable' }]),
  vueStructure(32, 'Affaires', 'affaires', [
    col('code', 'Code', { ...fixe(100), style: { gras: true } }), col('libelle', 'Affaire', { ...prop(3, 160) }), col('nature', 'Nature', { ...fixe(90) }),
    col('client', 'Client', { ...prop(2, 120) }), col('statut', 'Statut', { ...fixe(80) }), col('nb_chantiers', 'Chantiers', { ...nombre(0), ...fixe(70), recherche: false }),
    montant('montant_marches', 'Marchés\nHT'), montant('facture_ht', 'Facturé\nHT'), col('responsable', 'Responsable', { masquee: true }),
  ], [{ colonne: 'nature', titre: 'Nature' }, { colonne: 'statut', titre: 'Statut' }]),
  vueStructure(33, 'Chantiers', 'chantiers', [
    col('code', 'Code', { ...fixe(100), style: { gras: true } }), col('libelle', 'Chantier', { ...prop(3, 160) }), col('affaire', 'Affaire', { ...fixe(90) }),
    col('client', 'Client', { ...prop(2, 120) }), col('ville', 'Ville', { ...prop(1, 90) }), col('statut', 'Statut', { ...fixe(80) }),
    col('conducteur', 'Conducteur', { masquee: true }), col('projet', 'Projet', { masquee: true }),
    col('nb_marches', 'Marchés', { ...nombre(0), ...fixe(64), recherche: false }), montant('montant_marches', 'Marchés\nHT'), montant('facture_ht', 'Facturé\nHT'),
  ], [{ colonne: 'statut', titre: 'Statut' }, { colonne: 'affaire', titre: 'Affaire' }]),
  vueStructure(34, 'Marchés', 'marches', [
    col('code', 'Code', { ...fixe(110), style: { gras: true } }), col('libelle', 'Marché', { ...prop(3, 160) }), col('chantier', 'Chantier', { ...fixe(100) }),
    col('client', 'Client', { ...prop(2, 120) }), col('commande', 'Commande', { ...fixe(110) }), col('nature', 'Nature', { ...fixe(70) }),
    montant('montant_ht', 'Montant\nHT'), montant('facture_ht', 'Facturé\nHT'), montant('reste_a_facturer', 'Reste à\nfacturer', { style: { gras: true } }),
    col('statut', 'Statut', { ...fixe(80) }), col('affaire', 'Affaire', { masquee: true }),
  ], [{ colonne: 'statut', titre: 'Statut' }, { colonne: 'chantier', titre: 'Chantier' }]),
  vueStructure(1203, 'Marchés de sous-traitance', 'marches_st', [
    col('code', 'Code', { ...fixe(120), style: { gras: true } }), col('libelle', 'Marché', { ...prop(3, 160) }), col('sous_traitant', 'Sous-traitant', { ...prop(2, 120) }),
    col('chantier', 'Chantier', { ...fixe(100) }), col('marche_vente', 'Marché de vente', { ...fixe(110) }), col('nature', 'Nature', { ...fixe(70) }),
    col('garantie', 'Garantie', { ...fixe(120) }), montant('montant_ht', 'Commandé\nHT'), montant('montant_agree', 'Agréé'), montant('facture_ht', 'Facturé\nHT'),
    montant('reste_a_facturer', 'Reste à\nfacturer', { style: { gras: true } }), col('fin_contractuelle', 'Fin\ncontractuelle', { format: 'date', ...fixe(92), recherche: false }),
    col('statut', 'Statut', { ...fixe(80) }), col('affaire', 'Affaire', { masquee: true }),
  ], [{ colonne: 'statut', titre: 'Statut' }, { colonne: 'sous_traitant', titre: 'Sous-traitant' }]),
);

// Stock : mouvements (1301) et dépôts (1302).
VUES_LISTE.push(
  vueStructure(1301, 'Mouvements de stock', 'stk_mouvements', [
    col('date_mouvement', 'Date', { format: 'date', ...fixe(92), recherche: false }), col('lieu', 'Lieu', { ...fixe(100) }),
    col('article', 'Article', { ...fixe(100), style: { gras: true } }), col('article_libelle', 'Libellé', { ...prop(3, 160) }),
    col('quantite', 'Quantité', { ...nombre(3), ...fixe(90), recherche: false }), col('unite', 'U.', { ...fixe(44), alignement: 'centre' }),
    col('sens', 'Sens', { ...fixe(64) }), montant('prix', 'Prix', { ...nombre(4) }), col('provisoire', 'Prov.', { format: 'coche', ...fixe(50), masquee: true }),
    montant('pmp', 'PMP', { ...nombre(4), masquee: true }), montant('valeur', 'Valeur'), col('piece', 'Pièce', { ...fixe(110) }),
    col('type_piece', 'Type de pièce', { ...prop(1.5, 110) }), col('tiers', 'Tiers', { ...prop(2, 110) }), col('emplacement', 'Emplacement', { ...fixe(90), masquee: true }),
  ], [{ colonne: 'lieu', titre: 'Lieu' }, { colonne: 'sens', titre: 'Sens' }, { colonne: 'type_piece', titre: 'Type de pièce' }],
  [{ colonne: 'date_mouvement', sens: 'desc' }]),
  vueStructure(1302, 'Dépôts de stock', 'depots', [
    col('code', 'Code', { ...fixe(110), style: { gras: true } }), col('libelle', 'Dépôt', { ...prop(3, 160) }), col('depot', 'Dépôt géré', { format: 'coche', ...fixe(80) }),
    col('ville', 'Ville', { ...prop(1.5, 100) }), col('nb_articles', 'Articles', { ...nombre(0), ...fixe(80), recherche: false }),
    montant('valeur', 'Valeur'), col('nb_emplacements', 'Emplacements', { ...nombre(0), ...fixe(100), recherche: false }), col('statut', 'Statut', { ...fixe(80) }),
  ], [{ colonne: 'statut', titre: 'Statut' }]),
);

// Thème à plusieurs types d'élément : toutes les ressources dans une seule vue.
VUES_LISTE.push({
  vli_id: 7, vli_nom: 'Ressources (démo)', vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
  definition: {
    theme: 'ressources',
    source: { mode: 'vue', vue: 'ressources', colonne_id: 'id', colonne_type: 'type_element' },
    colonnes: [
      col('type_element', 'Type', {
        format: 'picto', ...fixe(52),
        options: [
          { valeur: 'equipe', libelle: 'Équipe', picto: '👥' }, { valeur: 'salarie', libelle: 'Salarié', picto: '👷' },
          { valeur: 'interim', libelle: 'Intérimaire', picto: '🧑‍🔧' }, { valeur: 'materiel', libelle: 'Matériel', picto: '🚜' },
          { valeur: 'sous_traitant', libelle: 'Sous-traitant', picto: '🏢' },
        ],
      }),
      col('code', 'Code', { ...fixe(90), style: { gras: true } }),
      col('libelle', 'Ressource', { ...prop(2.5, 160) }),
      col('categorie', 'Catégorie', { ...prop(1.5, 110) }),
      col('statut', 'Statut /\nfonction', { ...prop(1.5, 110) }),
      col('disponible', 'Dispo.', { format: 'coche', ...fixe(56), recherche: false,
        regles: [{ condition: 'NON [disponible]', style: { fond: '#fdecea', couleur: '#b42318' } }] }),
      col('cout_horaire', 'Coût\nhoraire', { ...nombre(), ...fixe(90), recherche: false }),
      col('chantier', 'Chantier', { ...prop(1.5, 110) }),
      col('observations', 'Observations', { ...prop(2, 140) }),
    ],
    segments: [{ colonne: 'type_element', titre: 'Type' }, { colonne: 'categorie', titre: 'Catégorie' }],
    tri: [{ colonne: 'libelle', sens: 'asc' }],
    lignes: 'multi',
    taille_lot: 100,
  },
});

// Recherche de documents dans la GED (la vue simplifiée est dans l'onglet Pièces jointes des fiches).
VUES_LISTE.push({
  vli_id: 8, vli_nom: 'Documents GED', vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
  definition: {
    theme: 'ged',
    source: { mode: 'vue', vue: 'ged', colonne_id: 'id', colonne_type: 'type_element' },
    colonnes: [
      col('nature', '', { format: 'picto', ...fixe(36), options: [{ valeur: 'mail', libelle: 'Mail', picto: '✉️' }, { valeur: 'fichier', libelle: 'Fichier', picto: '📄' }] }),
      col('titre', 'Titre', { ...prop(3, 180), style: { gras: true } }),
      col('categorie', 'Catégorie', {
        format: 'combo', ...prop(1.2, 110),
        options: [['devis_signe', 'Devis signé'], ['facture_recue', 'Facture reçue'], ['facture_emise', 'Facture émise'], ['contrat', 'Contrat'],
          ['courrier', 'Courrier'], ['mail', 'Mail'], ['photo', 'Photo'], ['plan', 'Plan'], ['certificat', 'Certificat / habilitation'], ['autre', 'Autre']]
          .map(([valeur, libelle]) => ({ valeur, libelle })),
      }),
      col('date_document', 'Date', { format: 'date', ...fixe(92), recherche: false }),
      col('auteur', 'Auteur', { ...prop(1.5, 110) }),
      col('type_lie', 'Élément', { ...fixe(90) }),
      col('id_lie', 'N°', { ...fixe(56) }),
      col('etat', 'État', { ...fixe(90) }),
      col('coffre', 'Coffre', { format: 'coche', ...fixe(60), bulle: 'Archivé au coffre-fort', recherche: false,
        regles: [{ condition: '[coffre]', style: { fond: '#fff4e0' } }] }),
      col('version', 'Ver.', { ...nombre(0), ...fixe(48), recherche: false }),
      col('taille', 'Taille\n(octets)', { ...nombre(0), ...fixe(90), recherche: false }),
      col('resume', 'Résumé', { ...prop(2.5, 140) }),
      col('objet_mail', 'Objet du mail', { masquee: true }),
      col('notes', 'Notes', { masquee: true }),
      col('nom_fichier', 'Fichier', { masquee: true }),
    ],
    segments: [{ colonne: 'categorie', titre: 'Catégorie' }, { colonne: 'type_lie', titre: 'Élément' }],
    tri: [{ colonne: 'date_document', sens: 'desc' }],
    lignes: 'multi',
    taille_lot: 100,
  },
});

// Bibliothèque : articles, ouvrages, tous les éléments (segments bibliothèque, famille, regroupement, gestion).
const OPTIONS_TYPE_ELEMENT = [
  { valeur: 'ARTICLE', libelle: 'Article', picto: '🧱' }, { valeur: 'OUVRAGE', libelle: 'Ouvrage', picto: '🏗️' },
  { valeur: 'ENSEMBLE', libelle: 'Ensemble', picto: '🧩' }, { valeur: 'POSTE_PIED', libelle: 'Poste de pied', picto: '🧾' },
];
const OPTIONS_GESTION = [
  { valeur: 'STOCK', libelle: 'Stock', picto: '📦' }, { valeur: 'ACHAT', libelle: 'Achat', picto: '🛒' },
  { valeur: 'SOUS_TRAITANCE', libelle: 'Sous-traitance', picto: '🤝' }, { valeur: 'NON_GERE', libelle: 'Non géré', picto: '➖' },
];
const vueElements = (vli_id, vli_nom, filtres) => ({
  vli_id, vli_nom, vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
  definition: {
    theme: 'bibliotheque',
    source: { mode: 'vue', vue: 'elements', colonne_id: 'id', colonne_type: 'type_element' },
    filtres,
    colonnes: [
      col('type', '', { format: 'picto', ...fixe(36), options: OPTIONS_TYPE_ELEMENT }),
      col('bib_code', 'Bib.', { ...fixe(52) }),
      col('code', 'Code', { ...fixe(90), style: { gras: true } }),
      col('libelle', 'Libellé', { ...prop(3, 200) }),
      col('famille', 'Famille', { ...prop(1.6, 120) }),
      col('regroupement', 'Regroupement', { ...prop(1, 90) }),
      col('gestion', 'Gestion', { format: 'picto', ...fixe(64), options: OPTIONS_GESTION }),
      col('unite_stock', 'U.', { ...fixe(44), alignement: 'centre' }),
      col('marques', 'Marques', { ...prop(1, 90), masquee: true }),
      col('pa', 'PA', { ...nombre(4), ...fixe(84), recherche: false }),
      col('pr', 'PR', { ...nombre(4), ...fixe(84), recherche: false }),
      col('pv_net', 'PV net', { ...nombre(2), ...fixe(84), recherche: false, style: { gras: true } }),
      col('coef_benef', 'Coef.\nbénéf.', { ...nombre(4), ...fixe(70), recherche: false, masquee: true }),
      col('nature', 'Nature', { masquee: true }),
      col('scenario_pa', 'Scénario PA', { masquee: true }),
      col('actif', 'Actif', { format: 'coche', ...fixe(52), recherche: false, regles: [{ condition: 'NON [actif]', style: { couleur: '#667085', italique: true } }] }),
    ],
    // Familles et natures : arbres du panneau de la liste (filtres fam_id, nat_id) plutôt que des segments.
    segments: [{ colonne: 'bib_code', titre: 'Bibliothèque' }, { colonne: 'type', titre: 'Type' }, { colonne: 'gestion', titre: 'Gestion' }],
    tri: [{ colonne: 'code', sens: 'asc' }],
    lignes: 'multi',
    taille_lot: 100,
  },
});
VUES_LISTE.push(vueElements(12, 'Articles', [{ colonne: 'type', op: '=', valeur: 'ARTICLE' }]), vueElements(13, 'Ouvrages', [{ colonne: 'type', op: '=', valeur: 'OUVRAGE' }]),
  vueElements(14, 'Tous les éléments', []), vueElements(15, 'Ensembles', [{ colonne: 'type', op: '=', valeur: 'ENSEMBLE' }]));

/** Sources au format du fournisseur (colonnes { code, type }). */
export function sourcesFournisseur(donnees = {}) {
  return Object.fromEntries(Object.entries(SOURCES_LISTE).map(([code, s]) => [code, {
    libelle: s.libelle, colonne_id: s.colonne_id, colonne_type: s.colonne_type ?? null, type_element: s.type_element ?? null,
    modifiable: !!s.modifiable,
    colonnes: s.colonnes.map(([c, type]) => ({ code: c, type, modifiable: !!s.modifiable && !(s.lecture_seule ?? []).includes(c) })),
    lignes: donnees[code] ?? [],
  }]));
}

// Annuaire : tiers (personnes) par relation, contacts (individus).
const OPTIONS_CASQUETTES = CASQUETTES.map((c) => ({ valeur: c.code, libelle: c.libelle, picto: c.icone }));
const OPTIONS_NIVEAUX = NIVEAUX.map((n) => ({ valeur: n.code, libelle: n.libelle, picto: n.icone }));
const OPTIONS_ROLES = ROLES.map((r) => ({ valeur: r.code, libelle: r.libelle, picto: r.icone }));
const vuePersonnes = (vli_id, vli_nom, casquettes = null, filtres = []) => ({
  vli_id, vli_nom, vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
  definition: {
    theme: 'tiers',
    source: { mode: 'vue', vue: 'personnes', colonne_id: 'id', colonne_type: 'type_element' },
    filtres: [...(casquettes ? [{ colonne: 'casquettes', op: 'dans', valeurs: casquettes }] : []), ...filtres],
    colonnes: [
      col('niveau', '', { format: 'picto', ...fixe(36), options: OPTIONS_NIVEAUX }),
      col('code', 'Code', { ...fixe(84) }),
      col('raison_sociale', 'Raison sociale', { ...prop(2.6, 180), style: { gras: true },
        regles: [{ condition: 'NON [actif]', style: { couleur: '#667085', italique: true, barre: true } }] }),
      col('provisoire', 'Provisoire', { format: 'coche', ...fixe(70), recherche: false }),
      col('casquettes', 'Relations', { format: 'combo', ...prop(1.6, 120), options: OPTIONS_CASQUETTES }),
      col('parent', 'Niveau supérieur', { ...prop(1.4, 110) }),
      col('ville', 'Ville', { ...prop(1, 90) }),
      col('telephone', 'Téléphone', { ...fixe(118) }),
      col('email', 'E-mail', { ...prop(1.4, 120) }),
      col('contact', 'Contact', { ...prop(1.2, 100) }),
      col('siret', 'SIRET', { ...fixe(120), masquee: true }),
      col('nom_commercial', 'Nom commercial', { masquee: true }),
      col('chemin', 'Hiérarchie', { masquee: true }),
      col('tva_intra', 'TVA intracom.', { masquee: true }),
      col('code_postal', 'CP', { masquee: true }),
      col('pays', 'Pays', { ...fixe(48), masquee: true }),
      col('actif', 'Actif', { format: 'coche', ...fixe(52), recherche: false }),
    ],
    segments: [{ colonne: 'niveau', titre: 'Niveau' }, { colonne: 'casquettes', titre: 'Relation' }, { colonne: 'ville', titre: 'Ville' }],
    tri: [{ colonne: 'raison_sociale', sens: 'asc' }],
    lignes: 'multi',
    taille_lot: 100,
  },
});
VUES_LISTE.push(
  vuePersonnes(20, 'Tous les tiers'),
  vuePersonnes(21, 'Clients et prospects', ['CLIENT', 'PROSPECT']),
  vuePersonnes(22, 'Fournisseurs et loueurs', ['FOURNISSEUR', 'LOUEUR']),
  vuePersonnes(23, 'Sous-traitants, cotraitants, intérim', ['SOUS_TRAITANT', 'COTRAITANT', 'INTERIM']),
  vuePersonnes(24, 'Prescripteurs et maîtres d\'ouvrage', ['ARCHITECTE', 'MOE', 'BE', 'BC', 'MOA']),
  vuePersonnes(19, 'Tiers provisoires à valider', null, [{ colonne: 'provisoire', op: 'vrai' }]),
);
const vueIndividus = (vli_id, vli_nom, filtres = []) => ({
  vli_id, vli_nom, vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
  definition: {
    theme: 'contacts',
    source: { mode: 'vue', vue: 'individus', colonne_id: 'id', colonne_type: 'type_element' },
    filtres,
    colonnes: [
      col('nom_complet', 'Nom', { ...prop(1.6, 140), style: { gras: true },
        regles: [{ condition: 'NON [actif]', style: { couleur: '#667085', italique: true, barre: true } }] }),
      col('personnes', 'Rattaché à', { ...prop(2.2, 160) }),
      col('fonction', 'Fonction', { ...prop(1.4, 110) }),
      col('roles', 'Rôles', { format: 'combo', ...prop(1.4, 110), options: OPTIONS_ROLES }),
      col('portable', 'Portable', { ...fixe(118) }),
      col('telephone', 'Téléphone', { ...fixe(118) }),
      col('email', 'E-mail', { ...prop(1.6, 140) }),
      col('ville', 'Ville', { ...prop(0.8, 80), masquee: true }),
      col('utilisateur', 'Identifiant', { masquee: true }),
      col('actif', 'Actif', { format: 'coche', ...fixe(52), recherche: false }),
    ],
    segments: [{ colonne: 'roles', titre: 'Rôle' }],
    tri: [{ colonne: 'nom_complet', sens: 'asc' }],
    lignes: 'multi',
    taille_lot: 100,
  },
});
VUES_LISTE.push(
  vueIndividus(25, 'Tous les contacts'),
  vueIndividus(26, 'Notre société (rôles internes)', [{ colonne: 'roles', op: 'nonvide' }]),
);

// Ordres du module Exécution (identifiants 1000 et suivants : jamais en conflit avec les vues créées par les utilisateurs).
const ETATS_EXECUTION_LISTE = [
  { valeur: 'A_FAIRE', libelle: 'À faire', picto: '⚪' }, { valeur: 'EN_ATTENTE', libelle: 'En attente', picto: '⏸' },
  { valeur: 'EN_COURS', libelle: 'En cours', picto: '🔵' }, { valeur: 'BLOQUE', libelle: 'Bloqué', picto: '⛔' }, { valeur: 'TERMINE', libelle: 'Terminé', picto: '✅' },
];
const vueOrdres = (vli_id, vli_nom, filtres = []) => ({
  vli_id, vli_nom, vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
  definition: {
    theme: 'ordres',
    source: { mode: 'vue', vue: 'ordres', colonne_id: 'id', colonne_type: 'type_element' },
    filtres,
    colonnes: [
      col('type_document', 'Type', { ...prop(1.2, 90, 170) }),
      col('numero', 'N°', { ...fixe(110), style: { gras: true } }),
      col('date_document', 'Date', { format: 'date', ...fixe(92), recherche: false }),
      col('objet', 'Objet', { ...prop(3, 160) }),
      col('chantier', 'Chantier', { ...prop(2, 120) }),
      col('service', 'Service', { ...prop(1.2, 90) }),
      col('responsable', 'Responsable', { ...prop(1.4, 100) }),
      col('etat_execution', 'Exécution', { format: 'picto', ...fixe(80), options: ETATS_EXECUTION_LISTE }),
      col('motif', 'Motif', { ...prop(1.5, 100), style: { couleur: '#b42318' } }),
      col('etape_en_cours', 'Étape', { ...prop(1.4, 100) }),
      col('prochaine_date', 'Prochaine date', { format: 'date', ...fixe(92), recherche: false,
        regles: [{ condition: '[en_retard]', style: { couleur: '#b42318', gras: true } }] }),
      col('ressource', 'Ressource', { ...prop(1.4, 100), masquee: true }),
      col('statut', 'Statut', { ...fixe(100) }),
      col('debut_prevu', 'Début prévu', { format: 'date', ...fixe(92), recherche: false }),
      col('fin_prevue', 'Fin prévue', { format: 'date', ...fixe(92), recherche: false,
        regles: [{ condition: '[en_retard]', style: { couleur: '#b42318', gras: true } }] }),
      col('heures_budget', 'Heures', { ...nombre(1), ...fixe(80), recherche: false }),
      col('client', 'Client', { ...prop(1.5, 100), masquee: true }),
      col('marche', 'Marché', { ...fixe(90), masquee: true }),
      col('affaire', 'Affaire', { ...fixe(90), masquee: true }),
      col('total_ht', 'Total HT', { ...nombre(), ...fixe(100), recherche: false, masquee: true }),
      col('en_retard', 'En retard', { format: 'coche', ...fixe(60), masquee: true }),
    ],
    segments: [{ colonne: 'etat_execution', titre: 'Exécution' }, { colonne: 'service', titre: 'Service' }],
    tri: [{ colonne: 'date_document', sens: 'desc' }],
    lignes: 'multi',
    taille_lot: 100,
  },
});
VUES_LISTE.push(
  vueOrdres(1000, 'Tous les ordres'),
  vueOrdres(1001, "Ordres d'exécution", [{ colonne: 'type_element', op: '=', valeur: 'E_OE' }]),
  vueOrdres(1002, 'Ordres de pose', [{ colonne: 'type_element', op: '=', valeur: 'E_PO' }]),
  vueOrdres(1003, "Demandes d'approvisionnement", [{ colonne: 'type_element', op: '=', valeur: 'E_DAP' }]),
  vueOrdres(1004, 'Ordres bloqués', [{ colonne: 'etat_execution', op: '=', valeur: 'BLOQUE' }]),
  vueOrdres(1005, 'Ordres en retard', [{ colonne: 'en_retard', op: 'vrai' }]),
  vueOrdres(1100, "Ordres du bureau d'études", [{ colonne: 'type_element', op: '=', valeur: 'E_BE' }]),
  vueOrdres(1101, 'Ordres des méthodes', [{ colonne: 'type_element', op: '=', valeur: 'E_BM' }]),
  vueOrdres(1102, 'Ordres de fabrication', [{ colonne: 'type_element', op: '=', valeur: 'E_OF' }]),
  vueOrdres(1103, 'Ordres de colisage', [{ colonne: 'type_element', op: '=', valeur: 'E_CO' }]),
  vueOrdres(1104, 'Ordres de livraison', [{ colonne: 'type_element', op: '=', valeur: 'E_LI' }]),
  vueOrdres(1105, 'Interventions SAV', [{ colonne: 'type_element', op: '=', valeur: 'E_SAV' }]),
  vueOrdres(1106, 'Ordres de sous-traitance', [{ colonne: 'type_element', op: '=', valeur: 'E_OST' }]),
  vueOrdres(1107, "Demandes d'achat", [{ colonne: 'type_element', op: '=', valeur: 'E_DAC' }]),
);

// Pointages (module Pointage, identifiants 1010 et suivants).
const vuePointages = (vli_id, vli_nom, filtres = []) => ({
  vli_id, vli_nom, vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
  definition: {
    theme: 'pointages',
    source: { mode: 'vue', vue: 'pointages', colonne_id: 'id', colonne_type: 'type_element' },
    filtres,
    colonnes: [
      col('date_pointage', 'Date', { format: 'date', ...fixe(92), recherche: false }),
      col('salarie', 'Salarié', { ...prop(2, 130), style: { gras: true } }),
      col('matricule', 'Matricule', { ...fixe(80), masquee: true }),
      col('service', 'Service', { ...prop(1.2, 90) }),
      col('chantier', 'Chantier', { ...fixe(110) }),
      col('chantier_libelle', 'Libellé du chantier', { ...prop(2, 120) }),
      col('ordre', 'Ordre', { ...fixe(110) }),
      col('type_mo', 'Type de MO', { ...prop(1.3, 100) }),
      col('sous_type', 'Sous-type', { ...prop(1, 90) }),
      col('heures', 'Heures', { ...nombre(2), ...fixe(70), recherche: false }),
      col('motif', 'Motif', { ...prop(1.5, 100), style: { couleur: '#b42318' } }),
      col('commentaire', 'Commentaire', { ...prop(2, 100), masquee: true }),
      col('couche', 'Couche', { ...fixe(70), masquee: true }),
      col('saisi_par', 'Saisi par', { ...fixe(90), masquee: true }),
      col('interimaire', 'Intérim', { format: 'coche', ...fixe(60), masquee: true }),
      col('productif', 'Productif', { format: 'coche', ...fixe(60), masquee: true }),
      col('cout', 'Coût', { ...nombre(2), ...fixe(90), recherche: false, masquee: true }),
      col('valorisation', 'Valorisation', { ...fixe(90), masquee: true }),
    ],
    segments: [{ colonne: 'service', titre: 'Service' }, { colonne: 'type_mo', titre: 'Type de MO' }, { colonne: 'sous_type', titre: 'Sous-type' }],
    tri: [{ colonne: 'date_pointage', sens: 'desc' }, { colonne: 'salarie', sens: 'asc' }],
    lignes: 'multi',
    taille_lot: 100,
  },
});
VUES_LISTE.push(
  vuePointages(1010, 'Pointages saisis', [{ colonne: 'couche', op: '=', valeur: 'SAISIE' }]),
  vuePointages(1011, 'Non-conformités', [{ colonne: 'motif', op: 'nonvide' }]),
  vuePointages(1012, 'Temps improductif', [{ colonne: 'productif', op: 'faux' }]),
);
