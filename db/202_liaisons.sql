-- =============================================================================
-- Cœur – liaisons croisées (Exécution ↔ Planning ↔ Pointage ↔ CRM, ANALYSE-MODULES-TRANSVERSE.md § 9 étape 6) :
-- pointages retenus (couche validée des semaines corrigées, sinon saisie) avec le service de leur type de main-d'œuvre
-- et du salarié, heures réalisées par ordre et par chantier. Rejouable.
-- =============================================================================

CREATE OR REPLACE VIEW v_pointages_retenus AS
SELECT p.poi_id, p.poi_sal_id AS sal_id, p.poi_date AS date_pointage, p.poi_cha_id AS chantier_id, p.poi_ent_id AS ordre_id, p.poi_type_mo AS nature_id,
       n.nat_srv_id AS srv_id, p.poi_minutes AS minutes, p.poi_cout AS cout, p.poi_sous_type AS sous_type, p.poi_motif AS motif
FROM poi_pointage p
LEFT JOIN nature_element n ON n.nat_id = p.poi_type_mo
WHERE p.poi_couche = CASE WHEN EXISTS (SELECT 1 FROM poi_semaine s WHERE s.psm_sal_id = p.poi_sal_id AND s.psm_lundi = date_trunc('week', p.poi_date)::date)
                          THEN 'VALIDE' ELSE 'SAISIE' END;

-- Heures réalisées (pointées) par ordre d'exécution et par service.
CREATE OR REPLACE VIEW v_heures_realisees_ordre AS
SELECT ordre_id AS ent_id, srv_id, round(sum(minutes) / 60.0, 2) AS heures, sum(cout) AS cout
FROM v_pointages_retenus WHERE ordre_id IS NOT NULL GROUP BY ordre_id, srv_id;

-- Heures réalisées par chantier et par service.
CREATE OR REPLACE VIEW v_heures_realisees_chantier AS
SELECT chantier_id, srv_id, round(sum(minutes) / 60.0, 2) AS heures, sum(cout) AS cout
FROM v_pointages_retenus GROUP BY chantier_id, srv_id;
