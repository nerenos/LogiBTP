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
