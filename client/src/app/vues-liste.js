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
    ],
  },
  salaries: {
    libelle: 'Salariés (démonstration)', vue: 'v_liste_salaries', colonne_id: 'id', colonne_type: 'type_element',
    // Saisie dans les listes : vue simple sur une table ; type_element est calculé (lecture seule dans la base).
    modifiable: true, lecture_seule: ['id', 'type_element'],
    colonnes: [
      ['id', 'integer'], ['type_element', 'text'], ['matricule', 'text'], ['nom', 'text'], ['prenom', 'text'], ['service', 'text'], ['poste', 'text'],
      ['statut', 'text'], ['date_entree', 'date'], ['salaire_brut', 'numeric'], ['heures_mois', 'numeric'], ['actif', 'boolean'],
      ['commentaire', 'text'],
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
    ],
  },
  // Annuaire : casquettes et rôles sont des colonnes multivaluées (tableaux de codes) ; segments et filtres « parmi ».
  personnes: {
    libelle: 'Annuaire : personnes (sociétés, établissements, particuliers…)', vue: 'v_liste_personnes', colonne_id: 'id', colonne_type: 'type_element',
    colonnes: [
      ['id', 'bigint'], ['type_element', 'text'], ['code', 'text'], ['raison_sociale', 'text'], ['nom_commercial', 'text'], ['niveau', 'text'],
      ['casquettes', 'ARRAY'], ['parent', 'text'], ['chemin', 'text'], ['siren', 'text'], ['siret', 'text'], ['tva_intra', 'text'], ['pays', 'text'],
      ['adresse', 'text'], ['code_postal', 'text'], ['ville', 'text'], ['telephone', 'text'], ['email', 'text'], ['contact', 'text'],
      ['societe_base', 'boolean'], ['actif', 'boolean'], ['modifie_le', 'timestamp with time zone'],
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
  {
    thl_code: 'factures', thl_libelle: 'Factures', thl_icone: '💶', thl_ordre: 30,
    thl_types: [{ code: 'V_FACTURE', libelle: 'Facture' }, { code: 'V_FACTURE_AVT', libelle: 'Facture d\'avancement' }, { code: 'V_AVOIR', libelle: 'Avoir' }],
  },
  { thl_code: 'achats_ddp', thl_libelle: 'Demandes de prix', thl_icone: '📨', thl_ordre: 32, thl_types: [{ code: 'A_DEVIS', libelle: 'Demande de prix fournisseur' }] },
  { thl_code: 'achats_commandes', thl_libelle: 'Commandes fournisseurs', thl_icone: '📦', thl_ordre: 34, thl_types: [{ code: 'A_COMMANDE', libelle: 'Commande fournisseur' }] },
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
        col('chantier', 'Chantier', { ...prop(2, 120) }),
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
        col('nom', 'Nom', { modifiable: true, ...prop(1.5, 110), style: { gras: true },
          regles: [{ condition: 'NON [actif]', style: { couleur: '#667085', italique: true, barre: true } }],
        }),
        col('prenom', 'Prénom', { modifiable: true, ...prop(1.2, 100) }),
        col('service', 'Service', { modifiable: true, ...prop(1.2, 100) }),
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
const vueDocuments = (vli_id, vli_nom, theme) => ({
  ...structuredClone(documents), vli_id, vli_nom,
  definition: { ...structuredClone(documents.definition), theme, segments: [{ colonne: 'statut', titre: 'Statut' }] },
});
VUES_LISTE.push(vueDocuments(5, 'Devis', 'devis'), vueDocuments(6, 'Factures et avoirs', 'factures'));
// Achats (menu Achats du bandeau) : mêmes colonnes, documents filtrés par les types du thème.
VUES_LISTE.push(vueDocuments(9, 'Demandes de prix', 'achats_ddp'), vueDocuments(10, 'Commandes fournisseurs', 'achats_commandes'),
  vueDocuments(11, 'Factures fournisseurs', 'achats_factures'));

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
const OPTIONS_TYPE_ELEMENT = [{ valeur: 'ARTICLE', libelle: 'Article', picto: '🧱' }, { valeur: 'OUVRAGE', libelle: 'Ouvrage', picto: '🏗️' }];
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
  vueElements(14, 'Tous les éléments', []));

/** Sources au format du fournisseur (colonnes { code, type }). */
export function sourcesFournisseur(donnees = {}) {
  return Object.fromEntries(Object.entries(SOURCES_LISTE).map(([code, s]) => [code, {
    libelle: s.libelle, colonne_id: s.colonne_id, colonne_type: s.colonne_type ?? null, type_element: s.type_element ?? null,
    modifiable: !!s.modifiable,
    colonnes: s.colonnes.map(([c, type]) => ({ code: c, type, modifiable: !!s.modifiable && !(s.lecture_seule ?? []).includes(c) })),
    lignes: donnees[code] ?? [],
  }]));
}

// Annuaire : tiers (personnes) par casquette, contacts (individus).
const OPTIONS_CASQUETTES = CASQUETTES.map((c) => ({ valeur: c.code, libelle: c.libelle, picto: c.icone }));
const OPTIONS_NIVEAUX = NIVEAUX.map((n) => ({ valeur: n.code, libelle: n.libelle, picto: n.icone }));
const OPTIONS_ROLES = ROLES.map((r) => ({ valeur: r.code, libelle: r.libelle, picto: r.icone }));
const vuePersonnes = (vli_id, vli_nom, casquettes = null) => ({
  vli_id, vli_nom, vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
  definition: {
    theme: 'tiers',
    source: { mode: 'vue', vue: 'personnes', colonne_id: 'id', colonne_type: 'type_element' },
    filtres: casquettes ? [{ colonne: 'casquettes', op: 'dans', valeurs: casquettes }] : [],
    colonnes: [
      col('niveau', '', { format: 'picto', ...fixe(36), options: OPTIONS_NIVEAUX }),
      col('code', 'Code', { ...fixe(84) }),
      col('raison_sociale', 'Raison sociale', { ...prop(2.6, 180), style: { gras: true },
        regles: [{ condition: 'NON [actif]', style: { couleur: '#667085', italique: true, barre: true } }] }),
      col('casquettes', 'Casquettes', { format: 'combo', ...prop(1.6, 120), options: OPTIONS_CASQUETTES }),
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
    segments: [{ colonne: 'niveau', titre: 'Niveau' }, { colonne: 'casquettes', titre: 'Casquette' }, { colonne: 'ville', titre: 'Ville' }],
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
