-- =============================================================================
-- Cœur – calendriers : fermeture de démonstration de l'atelier. Extrait de 196_calendriers.sql ; script de démonstration
-- (indicateur « demo » du manifeste), appliqué juste après 196.
-- =============================================================================

-- Démonstration : fermeture de l'atelier trois semaines en août.
INSERT INTO jour_ferme (jfe_libelle, jfe_regle, jfe_du, jfe_au, jfe_type_element, jfe_id_element, jfe_maj_par)
SELECT 'Fermeture estivale de l''atelier', 'PERIODE', DATE '2026-08-03', DATE '2026-08-21', 'service', s.srv_id::text, 'demo'
FROM service s
WHERE s.srv_code = 'ATELIER'
  AND NOT EXISTS (SELECT 1 FROM jour_ferme j WHERE j.jfe_type_element = 'service' AND j.jfe_id_element = s.srv_id::text);
