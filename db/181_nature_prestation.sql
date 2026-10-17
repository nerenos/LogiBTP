-- =============================================================================
-- Cœur LogiBTP – nature « Prestations » (CONCEPTION-REGLES-DOCUMENTS.md, P10, P20) : lignes d'acompte, ouvrages sans
-- composante passés en éléments à la validation. Rejouable.
-- =============================================================================

INSERT INTO nature_element (nat_code, nat_libelle, nat_rgn_code, nat_axe_analytique, nat_compte_achat, nat_compte_vente, nat_actif, nat_isolant, nat_types)
SELECT 'PRE', 'Prestations', 'VENTE', 'VENTE', NULL, '706000', TRUE, FALSE, '["DIVERS"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM nature_element WHERE nat_code = 'PRE');
