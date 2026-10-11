-- =============================================================================
-- Cœur LogiBTP – bibliothèque de démonstration (référentiels, articles, ouvrage, tarifs fournisseurs).
-- FICHIER GÉNÉRÉ par client/scripts/generer-vues-liste.mjs depuis client/src/app/bibliotheque/donnees.js : ne pas modifier.
-- Prix calculés à la génération (même calcul que l'API) ; l'historique des prix part de ces valeurs.
-- =============================================================================

INSERT INTO bibliotheque (bib_id, bib_code, bib_libelle, bib_defaut, bib_actif, bib_ordre) VALUES
 (1, 'GEN', 'Bibliothèque générale', TRUE, TRUE, 1),
 (2, 'FAB', 'Catalogue fabricants', FALSE, TRUE, 2);

INSERT INTO famille_element (fam_id, fam_bib_id, fam_parent_id, fam_code, fam_libelle, fam_ordre) VALUES
 (1, 1, NULL, 'GO', 'Gros œuvre', 1),
 (2, 1, 1, 'BET', 'Béton', 1),
 (3, 1, 2, 'ARM', 'Armatures', 2),
 (4, 1, 1, 'MAC', 'Maçonnerie', 2),
 (5, 1, NULL, 'MO', 'Main-d''œuvre', 2),
 (6, 1, NULL, 'ENG', 'Engins et matériel', 3),
 (7, 2, NULL, 'PLAT', 'Plâtrerie', 1),
 (8, 2, 7, 'ISOL', 'Isolation', 2);

INSERT INTO nature_element (nat_id, nat_code, nat_libelle, nat_rgn_code, nat_axe_analytique, nat_compte_achat, nat_compte_vente, nat_actif, nat_isolant) VALUES
 (1, 'MO', 'Main-d''œuvre', 'MO', 'MO', '641100', '704000', TRUE, FALSE),
 (2, 'MAT', 'Matériaux et fournitures', 'MATERIAUX', 'FOURN', '601000', '701000', TRUE, FALSE),
 (3, 'LOC', 'Location d''engins', 'ENGIN', 'ENGIN', '613500', '706000', TRUE, FALSE),
 (4, 'ST', 'Sous-traitance', 'SOUS_TRAITANCE', 'ST', '604000', '704000', TRUE, FALSE),
 (5, 'OUV', 'Ouvrages', 'VENTE', 'VENTE', NULL, '704000', TRUE, FALSE),
 (6, 'ISO', 'Isolants', 'MATERIAUX', 'FOURN', '601000', '701000', TRUE, TRUE);

INSERT INTO element (ele_id, ele_bib_id, ele_code, ele_type, ele_libelle_html, ele_libelle, ele_fam_id, ele_nat_id, ele_gestion, ele_unt_stock, ele_unt_achat,
  ele_unt_vente, ele_unites, ele_scenario_pa, ele_scenarios, ele_pa_fixe, ele_dernier_pa, ele_pmp, ele_pa, ele_coef_fg, ele_pr, ele_coef_benef, ele_pv,
  ele_pv_fixe, ele_coef_remise, ele_pv_net, ele_composition, ele_proprietes, ele_actif, ele_maj_par, ele_commentaire_prix,
  ele_poids, ele_surface, ele_surface_peinture, ele_volume, ele_hauteur, ele_largeur, ele_epaisseur, ele_isolant_r, ele_isolant_lambda, ele_isolant_u) VALUES
 (1, 1, 'HA10', 'ARTICLE', '<p><b>Acier HA10</b> – barre de 12 m</p><p>Fe E500, NF A 35-080-1</p>', 'Acier HA10 – barre de 12 m Fe E500, NF A 35-080-1', 3, 2, 'STOCK', 'ml', 't', 'kg', '[{"unite":"kg","formule":"1 / {{poids}}"},{"unite":"t","formule":"1000 / {{poids}}"}]'::jsonb, 'FOURNISSEUR_PRINCIPAL', NULL, NULL, NULL, NULL, 0.70955, 1.08, 0.766314, 1.25, 0.957893, FALSE, 1, 0.957893, NULL, '{}'::jsonb, TRUE, 'demo', 'Données de démonstration', 0.617, NULL, NULL, NULL, NULL, NULL, 10, NULL, NULL, NULL),
 (2, 1, 'HA12', 'ARTICLE', '<p><b>Acier HA12</b> – barre de 12 m</p><p>Fe E500, NF A 35-080-1</p>', 'Acier HA12 – barre de 12 m Fe E500, NF A 35-080-1', 3, 2, 'STOCK', 'ml', 't', 'kg', '[{"unite":"kg","formule":"1 / {{poids}}"},{"unite":"t","formule":"1000 / {{poids}}"}]'::jsonb, 'FOURNISSEUR_PRINCIPAL', NULL, NULL, NULL, NULL, 1.00344, 1.08, 1.083715, 1.25, 1.354644, FALSE, 1, 1.354644, NULL, '{}'::jsonb, TRUE, 'demo', 'Données de démonstration', 0.888, NULL, NULL, NULL, NULL, NULL, 12, NULL, NULL, NULL),
 (3, 1, 'BPE25', 'ARTICLE', '<p><b>Béton prêt à l''emploi C25/30</b></p><p>XC1, Dmax 20, S3 – livré toupie</p>', 'Béton prêt à l''emploi C25/30 XC1, Dmax 20, S3 – livré toupie', 2, 2, 'ACHAT', 'm3', NULL, NULL, '[{"unite":"t","formule":"1000 / {{poids}}"}]'::jsonb, 'MEILLEUR_MIN', NULL, NULL, NULL, NULL, 112.5, 1.1, 123.75, 1.2, 148.5, FALSE, 1, 148.5, NULL, '{"masse_volumique":2400}'::jsonb, TRUE, 'demo', 'Données de démonstration', 2400, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL),
 (4, 1, 'PARP20', 'ARTICLE', '<p><b>Parpaing creux 20 × 20 × 50</b></p><p>B40, NF</p>', 'Parpaing creux 20 × 20 × 50 B40, NF', 4, 2, 'STOCK', 'u', 'pal', 'm2', '[{"unite":"pal","formule":"60"},{"unite":"m2","formule":"1000000 / ({{hauteur}} * {{largeur}})"}]'::jsonb, 'DERNIER_PA', NULL, NULL, 1.32, 1.28, 1.32, 1.1, 1.452, 1.2, 1.7424, FALSE, 1, 1.7424, NULL, '{}'::jsonb, TRUE, 'demo', 'Données de démonstration', 18.5, NULL, 0.1, 0.02, 200, 500, 200, NULL, NULL, NULL),
 (5, 1, 'MOMAC', 'ARTICLE', '<p><b>Heure de maçon</b> N3P2</p>', 'Heure de maçon N3P2', 5, 1, 'NON_GERE', 'h', NULL, NULL, '[]'::jsonb, 'FIXE', NULL, 38, NULL, NULL, 38, 1.35, 51.3, 1.15, 58.995, FALSE, 1, 58.995, NULL, '{}'::jsonb, TRUE, 'demo', 'Données de démonstration', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
 (6, 1, 'LMP25', 'ARTICLE', '<p><b>Location mini-pelle 2,5 t</b> (journée, sans chauffeur)</p>', 'Location mini-pelle 2,5 t (journée, sans chauffeur)', 6, 3, 'ACHAT', 'j', NULL, NULL, '[]'::jsonb, 'FIXE', NULL, 210, NULL, NULL, 210, 1.05, 220.5, 1.25, 275.625, FALSE, 0.95, 261.84375, NULL, '{}'::jsonb, TRUE, 'demo', 'Données de démonstration', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
 (7, 1, 'DAL15', 'OUVRAGE', '<p><b>Dalle béton armé ép. 15 cm</b></p><p>Béton C25/30, treillis HA10, coulage et talochage</p>', 'Dalle béton armé ép. 15 cm Béton C25/30, treillis HA10, coulage et talochage', 2, 5, 'NON_GERE', 'm2', NULL, NULL, '[]'::jsonb, 'FIXE', NULL, NULL, NULL, NULL, 42.63, 1.1, 46.891625, 1.2, 56.26995, FALSE, 1, 56.26995, '{"mode":"D","lignes":[{"lig_ent_id":0,"lig_proprietes":{},"lig_coef_remise":1,"lig_precision_qte":2,"lig_precision_pv":2,"lig_type_prix":"V","lig_qte_source":"S","lig_coef_perte":1,"lig_id":1,"lig_parent_id":null,"lig_ordre":1,"lig_tyl_id":2,"lig_libelle_html":"<b>Dalle béton armé ép. 15 cm</b>","lig_qte":1,"lig_unt_code":"m2","lig_coef_fg":1.1,"lig_coef_benef":1.2},{"lig_ent_id":0,"lig_proprietes":{"element":{"id":3,"bib":"GEN","code":"BPE25"}},"lig_coef_remise":1,"lig_precision_qte":4,"lig_precision_pv":2,"lig_type_prix":"V","lig_qte_source":"M","lig_coef_perte":1.05,"lig_id":2,"lig_parent_id":1,"lig_ordre":1,"lig_tyl_id":3,"lig_libelle_html":"Béton prêt à l''emploi C25/30","lig_mtr_id":10,"lig_qte_type":"R","lig_unt_code":"m3","lig_pa":112.5,"lig_coef_fg":1.1,"lig_coef_benef":1.2},{"lig_ent_id":0,"lig_proprietes":{"element":{"id":1,"bib":"GEN","code":"HA10"}},"lig_coef_remise":1,"lig_precision_qte":2,"lig_precision_pv":2,"lig_type_prix":"V","lig_qte_source":"S","lig_coef_perte":1.1,"lig_id":3,"lig_parent_id":1,"lig_ordre":2,"lig_tyl_id":3,"lig_libelle_html":"Acier HA10 (treillis 20 × 20)","lig_qte":10,"lig_qte_type":"R","lig_unt_code":"ml","lig_pa":0.71,"lig_coef_fg":1.08,"lig_coef_benef":1.25},{"lig_ent_id":0,"lig_proprietes":{"element":{"id":5,"bib":"GEN","code":"MOMAC"}},"lig_coef_remise":1,"lig_precision_qte":2,"lig_precision_pv":2,"lig_type_prix":"V","lig_qte_source":"S","lig_coef_perte":1,"lig_id":4,"lig_parent_id":1,"lig_ordre":3,"lig_tyl_id":3,"lig_libelle_html":"Heure de maçon (coulage, talochage)","lig_qte":0.45,"lig_qte_type":"R","lig_unt_code":"h","lig_pa":38,"lig_coef_fg":1.35,"lig_coef_benef":1.15}],"metres":[{"mtr_id":10,"mtr_lig_id":2,"mtr_libelle":"Volume de béton par m²","mtr_unt_code":"m3","mtr_variable":null}],"metre_lignes":[{"mli_id":11,"mli_mtr_id":10,"mli_parent_id":null,"mli_ordre":1,"mli_type":"V","mli_operateur":"+","mli_formule":"1","mli_commentaire":"Surface (1 m²)"},{"mli_id":12,"mli_mtr_id":10,"mli_parent_id":null,"mli_ordre":2,"mli_type":"V","mli_operateur":"*","mli_formule":"0,15","mli_commentaire":"Épaisseur"}],"variables":[]}'::jsonb, '{}'::jsonb, TRUE, 'demo', 'Données de démonstration', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
 (8, 2, 'BA13', 'ARTICLE', '<p><b>Plaque de plâtre BA13</b> standard</p><p>1,20 × 2,50 m</p>', 'Plaque de plâtre BA13 standard 1,20 × 2,50 m', 7, 2, 'STOCK', 'm2', 'pl', 'm2', '[{"unite":"pl","formule":"{{hauteur}} * {{largeur}} / 1000000"}]'::jsonb, 'PMP', NULL, NULL, 2.24, 2.15, 2.15, 1.12, 2.408, 1.3, 3.1304, FALSE, 1, 3.1304, NULL, '{"reference_fabricant":"BA13-STD"}'::jsonb, TRUE, 'demo', 'Données de démonstration', 8.6, 1, 1, NULL, 2500, 1200, 12.5, NULL, NULL, NULL),
 (9, 2, 'LV100', 'ARTICLE', '<p><b>Laine de verre 100 mm</b> revêtue kraft</p><p>Rouleau 1,20 × 6 m</p>', 'Laine de verre 100 mm revêtue kraft Rouleau 1,20 × 6 m', 8, 6, 'STOCK', 'm2', 'rl', 'm2', '[{"unite":"rl","formule":"{{largeur}} * 6000 / 1000000"}]'::jsonb, 'FIXE', NULL, 4.85, NULL, NULL, 4.85, 1.12, 5.432, 1.3, 7.0616, FALSE, 1, 7.0616, NULL, '{}'::jsonb, TRUE, 'demo', 'Données de démonstration', 1.2, 1, NULL, NULL, 6000, 1200, 100, 3.15, 0.032, 0.32);

INSERT INTO tarif_fournisseur (tfo_id, tfo_ele_id, tfo_fournisseur, tfo_reference, tfo_libelle, tfo_unt_code, tfo_prix, tfo_debut, tfo_fin, tfo_principal, tfo_lien, tfo_maj_par) VALUES
 (1, 1, 'Aciers du Rhône', 'HA10-12', 'HA10 L 12 m', 't', 1150, '2026-01-01', NULL, TRUE, 'https://example.com/tarifs/aciers-du-rhone', 'demo'),
 (2, 1, 'Métal Distribution', 'B10', 'Barre HA10', 'kg', 1.12, NULL, '2026-12-31', FALSE, NULL, 'demo'),
 (3, 1, 'Aciers du Rhône', 'HA10-12-P', 'HA10 promotion (fin de série)', 't', 1080, '2025-01-01', '2025-12-31', FALSE, NULL, 'demo'),
 (4, 2, 'Aciers du Rhône', 'HA12-12', 'HA12 L 12 m', 't', 1130, '2026-01-01', NULL, TRUE, NULL, 'demo'),
 (5, 3, 'Béton Lyonnais', 'C25-XC1', 'C25/30 XC1 S3', 'm3', 118, NULL, NULL, TRUE, NULL, 'demo'),
 (6, 3, 'Unibéton', 'U-C25', 'C25/30 toupie 8 m³', 'm3', 112.5, '2026-03-01', NULL, FALSE, NULL, 'demo'),
 (7, 3, 'Béton Express', 'BE-25', 'C25/30 petite quantité', 'm3', 125, NULL, NULL, FALSE, NULL, 'demo'),
 (8, 4, 'Matériaux Rhône-Alpes', 'PAR20', 'Parpaing 20 (palette de 60)', 'pal', 79.2, NULL, NULL, TRUE, NULL, 'demo');

SELECT setval(pg_get_serial_sequence('bibliotheque', 'bib_id'), (SELECT max(bib_id) FROM bibliotheque));
SELECT setval(pg_get_serial_sequence('famille_element', 'fam_id'), (SELECT max(fam_id) FROM famille_element));
SELECT setval(pg_get_serial_sequence('nature_element', 'nat_id'), (SELECT max(nat_id) FROM nature_element));
SELECT setval(pg_get_serial_sequence('element', 'ele_id'), (SELECT max(ele_id) FROM element));
SELECT setval(pg_get_serial_sequence('tarif_fournisseur', 'tfo_id'), (SELECT max(tfo_id) FROM tarif_fournisseur));
