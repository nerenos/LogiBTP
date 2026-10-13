// Structure des affaires de démonstration : affaires, projets, chantiers, marchés. Les mêmes données alimentent la
// démo hors ligne et db/161_structure_demo.sql (généré par client/scripts/generer-vues-liste.mjs). Les tiers sont
// des personnes de l'annuaire de démonstration (SCI Les Érables 14, Commune de Belleroche 15, Mme Durand 18…).

export const AFFAIRES = [
  { id: 1, code: 'AFF-2026-001', libelle: 'Résidence Les Érables', nature: 'C', tiers_id: 14, responsable: 'Paul Moreau', statut: 'OUVERTE', date_ouverture: '2026-02-02' },
  { id: 2, code: 'AFF-2026-002', libelle: 'Commune de Belleroche – bâtiments communaux', nature: 'C', tiers_id: 15, responsable: 'Sophie Laurent', statut: 'OUVERTE', date_ouverture: '2026-03-16' },
  { id: 3, code: 'AFF-GEST-2026', libelle: 'Frais généraux 2026 (hors chantier)', nature: 'G', tiers_id: null, responsable: 'Direction', statut: 'OUVERTE', date_ouverture: '2026-01-01', commentaire: 'Achats et frais non affectés à un chantier' },
];

export const PROJETS = [
  { id: 1, code: 'PRJ-2026-001', libelle: 'Extension maison individuelle', tiers_id: 18, statut: 'OBTENU', date_remise: '2026-09-23', date_decision: '2026-10-02', montant_estime: 138000, responsable: 'Paul Moreau', ville: 'Lyon' },
  { id: 2, code: 'PRJ-2026-002', libelle: 'Résidence Les Érables – 24 logements', tiers_id: 14, statut: 'OBTENU', date_remise: '2026-01-15', date_decision: '2026-01-30', montant_estime: 920000, responsable: 'Paul Moreau', ville: 'Villeurbanne' },
  { id: 3, code: 'PRJ-2026-003', libelle: 'Réhabilitation de l\'école de Belleroche', tiers_id: 15, statut: 'REMIS', date_remise: '2026-09-30', montant_estime: 365000, responsable: 'Sophie Laurent', ville: 'Belleroche' },
  { id: 4, code: 'PRJ-2026-004', libelle: 'Garage poids lourds – extension de l\'atelier', tiers_id: 40, statut: 'EN_COURS', montant_estime: 210000, responsable: 'Sophie Laurent', ville: 'Vénissieux' },
  { id: 5, code: 'PRJ-2026-005', libelle: 'Centrale solaire en toiture', tiers_id: 41, statut: 'PERDU', date_remise: '2026-05-12', date_decision: '2026-06-20', montant_estime: 145000, responsable: 'Paul Moreau', ville: 'Givors' },
];

export const CHANTIERS = [
  { id: 1, code: 'CH-2026-001', libelle: 'Maison Martin – Lyon', aff_id: null, prj_id: 1, tiers_id: 18, adresse: '12 rue des Lilas', code_postal: '69003', ville: 'Lyon', statut: 'OUVERT', date_ouverture: '2026-10-05', date_fin_prevue: '2027-03-31', conducteur: 'Marc Petit' },
  { id: 2, code: 'CH-2026-002', libelle: 'Résidence Les Érables – bâtiment A', aff_id: 1, prj_id: 2, tiers_id: 14, adresse: '4 allée des Érables', code_postal: '69100', ville: 'Villeurbanne', statut: 'OUVERT', date_ouverture: '2026-02-16', date_fin_prevue: '2027-06-30', conducteur: 'Marc Petit' },
  { id: 3, code: 'CH-2026-003', libelle: 'Résidence Les Érables – bâtiment B', aff_id: 1, prj_id: 2, tiers_id: 14, adresse: '6 allée des Érables', code_postal: '69100', ville: 'Villeurbanne', statut: 'OUVERT', date_ouverture: '2026-04-01', date_fin_prevue: '2027-09-30', conducteur: 'Julien Roux' },
  { id: 4, code: 'CH-2026-004', libelle: 'Mairie de Belleroche – mise en accessibilité', aff_id: 2, prj_id: null, tiers_id: 15, adresse: 'Place de la Mairie', code_postal: '69770', ville: 'Belleroche', statut: 'TERMINE', date_ouverture: '2026-04-06', date_fin_prevue: '2026-07-31', conducteur: 'Julien Roux' },
];

export const MARCHES = [
  { id: 1, code: 'M-2026-002-1', libelle: 'Gros œuvre – bâtiment A', cha_id: 2, tiers_id: 14, nature: 'P', montant_ht: 485000, retenue_pct: 5, date: '2026-02-10', statut: 'EN_COURS' },
  { id: 2, code: 'M-2026-003-1', libelle: 'Gros œuvre – bâtiment B', cha_id: 3, tiers_id: 14, nature: 'P', montant_ht: 412000, retenue_pct: 5, date: '2026-03-25', statut: 'EN_COURS' },
  { id: 3, code: 'M-2026-004-1', libelle: 'Accessibilité de la mairie (lot 1 – maçonnerie)', cha_id: 4, tiers_id: 15, nature: 'U', montant_ht: 128500, retenue_pct: 5, date: '2026-03-30', statut: 'SOLDE' },
];

/** Rattachement du devis de démonstration. */
export const RATTACHEMENT_DEVIS_DEMO = { ent_projet_id: 1, ent_chantier_id: 1 };

/**
 * Fonctions des intervenants (réplique de db/162_intervenants.sql, vérifiée par client/test/structure.test.js) :
 * portée S structure, D document, T tous ; unique : un seul intervenant de cette fonction par objet ;
 * paiement_direct : sous-traitant payé directement par le maître d'ouvrage.
 */
export const FONCTIONS_INTERVENANT = [
  { code: 'CLIENT', libelle: "Client / maître d'ouvrage", portee: 'T', unique: true, paiement_direct: false, ordre: 10 },
  { code: 'MOA_DELEGUE', libelle: "Maître d'ouvrage délégué", portee: 'S', unique: false, paiement_direct: false, ordre: 20 },
  { code: 'ARCHITECTE', libelle: 'Architecte', portee: 'S', unique: false, paiement_direct: false, ordre: 30 },
  { code: 'MOE', libelle: "Maître d'œuvre", portee: 'S', unique: false, paiement_direct: false, ordre: 40 },
  { code: 'BE', libelle: "Bureau d'études", portee: 'S', unique: false, paiement_direct: false, ordre: 50 },
  { code: 'BC', libelle: 'Bureau de contrôle', portee: 'S', unique: false, paiement_direct: false, ordre: 60 },
  { code: 'CSPS', libelle: 'Coordonnateur SPS', portee: 'S', unique: false, paiement_direct: false, ordre: 70 },
  { code: 'ECONOMISTE', libelle: 'Économiste', portee: 'S', unique: false, paiement_direct: false, ordre: 80 },
  { code: 'MANDATAIRE', libelle: 'Mandataire du groupement', portee: 'S', unique: true, paiement_direct: false, ordre: 90 },
  { code: 'COTRAITANT', libelle: 'Cotraitant', portee: 'S', unique: false, paiement_direct: false, ordre: 100 },
  { code: 'SOUS_TRAITANT', libelle: 'Sous-traitant', portee: 'T', unique: false, paiement_direct: true, ordre: 110 },
  { code: 'PAYEUR', libelle: 'Payeur', portee: 'T', unique: true, paiement_direct: false, ordre: 120 },
  { code: 'DESTINATAIRE', libelle: 'Destinataire des documents', portee: 'T', unique: false, paiement_direct: false, ordre: 130 },
  { code: 'VALIDATION_SITUATION', libelle: 'Validation des situations', portee: 'T', unique: false, paiement_direct: false, ordre: 140 },
  { code: 'FOURNISSEUR', libelle: 'Fournisseur', portee: 'D', unique: true, paiement_direct: false, ordre: 150 },
  { code: 'LIVRAISON', libelle: 'Contact de livraison', portee: 'D', unique: false, paiement_direct: false, ordre: 160 },
  { code: 'AUTRE', libelle: 'Autre', portee: 'T', unique: false, paiement_direct: false, ordre: 990 },
];

// Intervenants de démonstration (personnes et contacts de l'annuaire de démonstration : architecte 11 / Mme 10,
// BET 12 / 11, contrôle 13, SCI 14 / 13, commune 15 / 12, Bâtir Ensemble 16 / 13, électricien 7 / 8, plombier 8 / 9).
const I = (id, objet, objet_id, fonction, per_id, ind_id = null, autres = {}) => ({
  id, objet, objet_id, fonction, per_id, ind_id, principal: false, paiement_direct: false, commentaire: null, ...autres,
});
export const INTERVENANTS = [
  I(1, 'projet', 3, 'CLIENT', 15, 12, { principal: true }),
  I(2, 'projet', 3, 'ARCHITECTE', 11, 10),
  I(3, 'affaire', 1, 'CLIENT', 14, 13, { principal: true }),
  I(4, 'affaire', 1, 'MOA_DELEGUE', 16, 13),
  I(5, 'chantier', 1, 'CLIENT', 18, 2, { principal: true }),
  I(6, 'chantier', 1, 'ARCHITECTE', 11, 10),
  I(7, 'chantier', 1, 'SOUS_TRAITANT', 8, 9, { commentaire: 'Plomberie sanitaire' }),
  I(8, 'chantier', 2, 'CLIENT', 14, 13, { principal: true }),
  I(9, 'chantier', 2, 'MOA_DELEGUE', 16, 13),
  I(10, 'chantier', 2, 'ARCHITECTE', 11, 10),
  I(11, 'chantier', 2, 'BE', 12, 11),
  I(12, 'chantier', 2, 'BC', 13, null),
  I(13, 'chantier', 2, 'SOUS_TRAITANT', 7, 8, { paiement_direct: true, commentaire: 'Lot électricité' }),
  I(14, 'chantier', 2, 'SOUS_TRAITANT', 38, null, { paiement_direct: true, commentaire: 'Charpente' }),
  I(15, 'marche', 1, 'PAYEUR', 16, 13, { principal: true }),
  I(16, 'marche', 1, 'VALIDATION_SITUATION', 11, 10),
  I(17, 'marche', 1, 'SOUS_TRAITANT', 7, 8, { paiement_direct: true, commentaire: 'Lot électricité' }),
  I(18, 'marche', 3, 'CLIENT', 15, 12, { principal: true }),
  I(19, 'marche', 3, 'PAYEUR', 15, null, { commentaire: 'Trésorerie municipale (mandatement)' }),
  I(20, 'marche', 3, 'VALIDATION_SITUATION', 15, 12),
];

/** Annuaire du devis de démonstration (instantané du document). */
export const INTERVENANTS_DEVIS_DEMO = [
  { fonction: 'CLIENT', per_id: 18, tiers: 'Mme DURAND Claire', ind_id: 2, contact: 'Claire Durand', principal: true },
  { fonction: 'SOUS_TRAITANT', per_id: 8, tiers: 'Plomberie Dupuis et Fils', ind_id: 9, contact: 'Marc Dupuis', principal: false, paiement_direct: false },
];
