-- =============================================================================
-- Cœur LogiBTP – natures d'éléments de la bibliothèque (regroupements, comptes, coefficients par période) : référence,
-- hors données de démonstration (extrait de 116_bibliotheque_demo.sql).
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/bibliotheque/donnees.js : ne pas modifier.
-- =============================================================================

INSERT INTO regroupement_nature (rgn_code, rgn_libelle, rgn_ordre) VALUES
 ('MO', 'Main-d''œuvre', 10),
 ('MATERIAUX', 'Matériaux', 20),
 ('ENGIN', 'Engins', 30),
 ('SOUS_TRAITANCE', 'Sous-traitance', 40),
 ('PRESTATION', 'Prestations', 50),
 ('VENTE', 'Vente', 60),
 ('FABRICATION', 'Fabrication', 70)
ON CONFLICT (rgn_code) DO UPDATE SET rgn_libelle = EXCLUDED.rgn_libelle, rgn_ordre = EXCLUDED.rgn_ordre;

INSERT INTO nature_element (nat_id, nat_code, nat_libelle, nat_rgn_code, nat_axe_analytique, nat_compte_achat, nat_compte_vente, nat_actif, nat_isolant, nat_types) VALUES
 (1, 'MO', 'Main-d''œuvre', 'MO', 'MO', '641100', '704000', TRUE, FALSE, '["MO"]'::jsonb),
 (2, 'MAT', 'Matériaux et fournitures', 'MATERIAUX', 'FOURN', '601000', '701000', TRUE, FALSE, '["MATERIAUX"]'::jsonb),
 (3, 'LOC', 'Location d''engins', 'ENGIN', 'ENGIN', '613500', '706000', TRUE, FALSE, '["ENGIN"]'::jsonb),
 (4, 'ST', 'Sous-traitance', 'SOUS_TRAITANCE', 'ST', '604000', '704000', TRUE, FALSE, '["SOUS_TRAITANCE"]'::jsonb),
 (5, 'OUV', 'Ouvrages', 'VENTE', 'VENTE', NULL, '704000', TRUE, FALSE, '["DIVERS"]'::jsonb),
 (6, 'ISO', 'Isolants', 'MATERIAUX', 'FOURN', '601000', '701000', TRUE, TRUE, '["MATERIAUX"]'::jsonb),
 (7, 'FABAT', 'Fabrication atelier', 'FABRICATION', 'FAB', '604100', '704000', TRUE, FALSE, '["MO","SOUS_TRAITANCE"]'::jsonb),
 (8, 'AMO', 'Amortissement du matériel', 'ENGIN', 'ENGIN', '681120', NULL, TRUE, FALSE, '["AMORTISSEMENT","FACTURATION_INTERNE"]'::jsonb);

INSERT INTO coefficient_periode (cop_id, cop_nat_id, cop_debut, cop_coef_fg, cop_coef_benef, cop_commentaire, cop_cree_le, cop_cree_par) VALUES
 (1, NULL, '2025-01-01', 1.1, 1.2, 'Coefficients 2025', '2025-12-15T09:00:00Z', 'admin'),
 (2, NULL, '2026-01-01', 1.12, 1.18, 'Révision annuelle 2026', '2025-12-15T09:00:00Z', 'admin'),
 (3, NULL, '2027-01-01', 1.15, 1.16, 'Prévision 2027', '2025-12-15T09:00:00Z', 'admin'),
 (4, 1, '2026-01-01', 1.35, 1.15, 'Charges sociales de la main-d''œuvre', '2025-12-15T09:00:00Z', 'admin'),
 (5, 3, '2026-01-01', 1.05, NULL, 'Location : frais réduits, bénéfice global', '2025-12-15T09:00:00Z', 'admin');

SELECT setval(pg_get_serial_sequence('nature_element', 'nat_id'), (SELECT max(nat_id) FROM nature_element));
SELECT setval(pg_get_serial_sequence('coefficient_periode', 'cop_id'), (SELECT max(cop_id) FROM coefficient_periode));
