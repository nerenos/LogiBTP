// Sources et vues de liste fournies par le cœur. Les mêmes définitions alimentent la démo hors ligne et le
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
    libelle: 'Salariés (démonstration)', vue: 'v_liste_salaries', colonne_id: 'id', type_element: 'salarie',
    colonnes: [
      ['id', 'integer'], ['matricule', 'text'], ['nom', 'text'], ['prenom', 'text'], ['service', 'text'], ['poste', 'text'],
      ['statut', 'text'], ['date_entree', 'date'], ['salaire_brut', 'numeric'], ['heures_mois', 'numeric'], ['actif', 'boolean'],
      ['commentaire', 'text'],
    ],
  },
  materiels: {
    libelle: 'Matériels (démonstration)', vue: 'v_liste_materiels', colonne_id: 'id', type_element: 'materiel',
    colonnes: [
      ['id', 'integer'], ['code', 'text'], ['designation', 'text'], ['famille', 'text'], ['etat', 'text'], ['chantier', 'text'],
      ['valeur_achat', 'numeric'], ['date_achat', 'date'], ['heures_utilisation', 'integer'], ['heures_revision', 'integer'],
      ['controle_ok', 'boolean'], ['observations', 'text'],
    ],
  },
};

const col = (code, titre, extra = {}) => ({ code, titre, ...extra });
const nombre = (decimales = 2) => ({ format: 'nombre', decimales });
const fixe = (valeur) => ({ largeur: { mode: 'fixe', valeur } });
const prop = (valeur, min, max) => ({ largeur: { mode: 'proportionnel', valeur, min, max } });

export const VUES_LISTE = [
  {
    vli_id: 1, vli_nom: 'Documents', vli_contexte: null, vli_partage: 'T', vli_proprietaire: 'admin', vli_groupe: null,
    definition: {
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
      source: { mode: 'vue', vue: 'salaries', colonne_id: 'id', type_element: 'salarie' },
      colonnes: [
        col('matricule', 'Matricule', { ...fixe(90) }),
        col('nom', 'Nom', {
          ...prop(1.5, 110), style: { gras: true },
          regles: [{ condition: 'NON [actif]', style: { couleur: '#667085', italique: true, barre: true } }],
        }),
        col('prenom', 'Prénom', { ...prop(1.2, 100) }),
        col('service', 'Service', { ...prop(1.2, 100) }),
        col('poste', 'Poste', { ...prop(1.5, 120) }),
        col('statut', 'Contrat', {
          format: 'combo', ...fixe(90),
          options: [{ valeur: 'CDI', libelle: 'CDI' }, { valeur: 'CDD', libelle: 'CDD' }, { valeur: 'INTERIM', libelle: 'Intérim' }],
          regles: [{ condition: '[statut] = "INTERIM"', style: { fond: '#fff4e0' } }, { condition: '[statut] = "CDD"', style: { fond: '#e3edfb' } }],
        }),
        col('date_entree', 'Date\nd\'entrée', { format: 'date', ...fixe(92), recherche: false }),
        col('salaire_brut', 'Salaire\nbrut', {
          ...nombre(), ...fixe(96), recherche: false,
          regles: [{ condition: '[salaire_brut] >= 4000', style: { gras: true, couleur: '#067647' } }],
        }),
        col('cout_annuel', 'Coût annuel\nchargé', { calcul: true, formule: 'ARRONDI([Salaire brut] * 12 * 1,45; 0)', ...nombre(0), ...fixe(104), bulle: 'Salaire brut × 12 × 1,45' }),
        col('actif', 'Actif', { format: 'coche', ...fixe(52), recherche: false }),
        col('commentaire', 'Commentaire', { ...prop(2.5, 140) }),
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
      source: { mode: 'vue', vue: 'materiels', colonne_id: 'id', type_element: 'materiel' },
      colonnes: [
        col('code', 'Code', { ...fixe(84), style: { gras: true } }),
        col('designation', 'Désignation', {
          ...prop(2.5, 160), regles: [{ condition: '[etat] = "PANNE"', style: { couleur: '#b42318' } }],
        }),
        col('famille', 'Famille', { ...prop(1.2, 100) }),
        col('etat', 'État', {
          format: 'picto', ...fixe(56),
          options: [
            { valeur: 'DISPO', libelle: 'Disponible', picto: '🟢' }, { valeur: 'CHANTIER', libelle: 'En chantier', picto: '🔵' },
            { valeur: 'PANNE', libelle: 'En panne', picto: '🔴' }, { valeur: 'REBUT', libelle: 'Rebut', picto: '⚫' },
          ],
          regles: [{ condition: '[etat] = "PANNE"', style: { fond: '#fdecea' } }],
        }),
        col('chantier', 'Chantier', { ...prop(1.5, 110) }),
        col('heures_utilisation', 'Heures\nd\'utilisation', { ...nombre(0), ...fixe(96), recherche: false }),
        col('heures_revision', 'Révision\n(heures)', { ...nombre(0), ...fixe(84), recherche: false }),
        col('revision', 'Révision', {
          calcul: true, formule: 'SI [Heures d\'utilisation] > [heures_revision] ALORS "Révision à prévoir" SINON ""', ...fixe(130),
          regles: [{ condition: '[revision] <> ""', style: { fond: '#fff4e0', gras: true, couleur: '#a15c00' } }],
        }),
        col('controle_ok', 'Contrôle\nOK', { format: 'coche', ...fixe(64), recherche: false }),
        col('valeur_achat', 'Valeur\nd\'achat', { ...nombre(), ...fixe(100), recherche: false }),
        col('observations', 'Observations', { ...prop(2, 140), masquee: false }),
      ],
      segments: [{ colonne: 'famille', titre: 'Famille' }, { colonne: 'etat', titre: 'État' }],
      tri: [{ colonne: 'code', sens: 'asc' }],
      lignes: 'multi',
      taille_lot: 100,
    },
  },
];

/** Sources au format du fournisseur (colonnes { code, type }). */
export function sourcesFournisseur(donnees = {}) {
  return Object.fromEntries(Object.entries(SOURCES_LISTE).map(([code, s]) => [code, {
    libelle: s.libelle, colonne_id: s.colonne_id, colonne_type: s.colonne_type ?? null, type_element: s.type_element ?? null,
    colonnes: s.colonnes.map(([c, type]) => ({ code: c, type })), lignes: donnees[code] ?? [],
  }]));
}
