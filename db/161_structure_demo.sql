-- =============================================================================
-- Cœur LogiBTP – structure des affaires de démonstration : affaires, projets, chantiers, marchés ; rattachement
-- des devis de démonstration.
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/structure/donnees.js : ne pas modifier.
-- =============================================================================

INSERT INTO affaire (aff_id, aff_code, aff_libelle, aff_nature, aff_tiers_id, aff_responsable, aff_statut, aff_date_ouverture, aff_commentaire) VALUES
 (1, 'AFF-2026-001', 'Résidence Les Érables', 'C', 14, 'Paul Moreau', 'OUVERTE', '2026-02-02', NULL),
 (2, 'AFF-2026-002', 'Commune de Belleroche – bâtiments communaux', 'C', 15, 'Sophie Laurent', 'OUVERTE', '2026-03-16', NULL),
 (3, 'AFF-GEST-2026', 'Frais généraux 2026 (hors chantier)', 'G', NULL, 'Direction', 'OUVERTE', '2026-01-01', 'Achats et frais non affectés à un chantier');

INSERT INTO projet (prj_id, prj_code, prj_libelle, prj_tiers_id, prj_statut, prj_date_remise, prj_date_decision, prj_montant_estime, prj_responsable, prj_ville) VALUES
 (1, 'PRJ-2026-001', 'Extension maison individuelle', 18, 'OBTENU', '2026-09-23', '2026-10-02', 138000, 'Jean-Pierre Martin', 'Lyon'),
 (2, 'PRJ-2026-002', 'Résidence Les Érables – 24 logements', 14, 'OBTENU', '2026-01-15', '2026-01-30', 920000, 'Jean-Pierre Martin', 'Villeurbanne'),
 (3, 'PRJ-2026-003', 'Réhabilitation de l''école de Belleroche', 15, 'REMIS', '2026-09-30', NULL, 365000, 'Sophie Bernard', 'Belleroche'),
 (4, 'PRJ-2026-004', 'Garage poids lourds – extension de l''atelier', 40, 'EN_COURS', NULL, NULL, 210000, 'Sophie Bernard', 'Vénissieux'),
 (5, 'PRJ-2026-005', 'Centrale solaire en toiture', 41, 'PERDU', '2026-05-12', '2026-06-20', 145000, 'Jean-Pierre Martin', 'Givors');

INSERT INTO chantier (cha_id, cha_code, cha_libelle, cha_aff_id, cha_prj_id, cha_tiers_id, cha_adresse, cha_code_postal, cha_ville, cha_statut, cha_date_ouverture, cha_date_fin_prevue, cha_conducteur_ind_id) VALUES
 (1, 'CH-2026-001', 'Maison Martin – Lyon', NULL, 1, 18, '12 rue des Lilas', '69003', 'Lyon', 'OUVERT', '2026-10-05', '2027-03-31', 6),
 (2, 'CH-2026-002', 'Résidence Les Érables – bâtiment A', 1, 2, 14, '4 allée des Érables', '69100', 'Villeurbanne', 'OUVERT', '2026-02-16', '2027-06-30', 6),
 (3, 'CH-2026-003', 'Résidence Les Érables – bâtiment B', 1, 2, 14, '6 allée des Érables', '69100', 'Villeurbanne', 'OUVERT', '2026-04-01', '2027-09-30', 1010),
 (4, 'CH-2026-004', 'Mairie de Belleroche – mise en accessibilité', 2, NULL, 15, 'Place de la Mairie', '69770', 'Belleroche', 'TERMINE', '2026-04-06', '2026-07-31', 1010);

INSERT INTO marche (mar_id, mar_code, mar_libelle, mar_cha_id, mar_tiers_id, mar_nature, mar_montant_ht, mar_retenue_pct, mar_date, mar_statut) VALUES
 (1, 'M-2026-002-1', 'Gros œuvre – bâtiment A', 2, 14, 'P', 485000, 5, '2026-02-10', 'EN_COURS'),
 (2, 'M-2026-003-1', 'Gros œuvre – bâtiment B', 3, 14, 'P', 412000, 5, '2026-03-25', 'EN_COURS'),
 (3, 'M-2026-004-1', 'Accessibilité de la mairie (lot 1 – maçonnerie)', 4, 15, 'U', 128500, 5, '2026-03-30', 'SOLDE');

SELECT setval(pg_get_serial_sequence('affaire', 'aff_id'), (SELECT max(aff_id) FROM affaire));
SELECT setval(pg_get_serial_sequence('projet', 'prj_id'), (SELECT max(prj_id) FROM projet));
SELECT setval(pg_get_serial_sequence('chantier', 'cha_id'), (SELECT max(cha_id) FROM chantier));
SELECT setval(pg_get_serial_sequence('marche', 'mar_id'), (SELECT max(mar_id) FROM marche));

-- Devis de démonstration (créé au premier lancement) : rattaché ici s'il existe déjà.
UPDATE document SET ent_projet_id = 1, ent_chantier_id = 1
WHERE ent_objet = 'Extension maison individuelle' AND ent_chantier_id IS NULL;
