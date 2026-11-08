-- =============================================================================
-- Cœur – application de terrain, pointage à la ligne d'ordre (plans/terrain-suites.md, lot 7 ; TS5 a, TS6 a).
-- Rejouable.
--
-- Une tâche du planning d'origine « ligne » (tac_origine_type = 'ligne', tac_origine_id = lig_id) se pointe au niveau
-- planifié : poi_lig_id = la ligne, poi_ent_id = son document, chantier de la ligne (Btp/TerrainPointageBtp.cs).
-- - clé étrangère de poi_lig_id (ligne supprimée : pointage ramené au niveau de l'ordre) ;
-- - v_pointages_retenus (reprise de 202, colonnes inchangées) reçoit lig_id en fin de liste (fait du module Rentabilité
--   rattaché à la ligne) ; toute nouvelle reprise de la vue part de ce script ;
-- - reprise des pointages saisis existants des tâches d'origine ligne : poi_lig_id renseigné (et poi_ent_id s'il était
--   vide), seulement quand le pointage est resté sur le chantier et le document de la ligne ; journées validées
--   (validation non annulée) et semaines corrigées (couche validée) exclues.
-- =============================================================================

CREATE INDEX IF NOT EXISTS ix_poi_lig ON poi_pointage (poi_lig_id) WHERE poi_lig_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_poi_ligne') THEN
        UPDATE poi_pointage p SET poi_lig_id = NULL
        WHERE p.poi_lig_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_ligne l WHERE l.lig_id = p.poi_lig_id);
        ALTER TABLE poi_pointage ADD CONSTRAINT fk_poi_ligne FOREIGN KEY (poi_lig_id) REFERENCES document_ligne (lig_id) ON DELETE SET NULL;
    END IF;
END $$;
COMMENT ON COLUMN poi_pointage.poi_lig_id IS 'Ligne d''ordre pointée : tâche du planning d''origine ligne (terrain, lot 7)';

CREATE OR REPLACE VIEW v_pointages_retenus AS
SELECT p.poi_id, p.poi_sal_id AS sal_id, p.poi_date AS date_pointage, p.poi_cha_id AS chantier_id, p.poi_ent_id AS ordre_id, p.poi_type_mo AS nature_id,
       n.nat_srv_id AS srv_id, p.poi_minutes AS minutes, p.poi_cout AS cout, p.poi_sous_type AS sous_type, p.poi_motif AS motif,
       p.poi_lig_id AS lig_id
FROM poi_pointage p
LEFT JOIN nature_element n ON n.nat_id = p.poi_type_mo
WHERE p.poi_couche = CASE WHEN EXISTS (SELECT 1 FROM poi_semaine s WHERE s.psm_sal_id = p.poi_sal_id AND s.psm_lundi = date_trunc('week', p.poi_date)::date)
                          THEN 'VALIDE' ELSE 'SAISIE' END;

-- Reprise des pointages déjà saisis au niveau de l'ordre (ou du chantier) sur une tâche d'origine ligne.
UPDATE poi_pointage p
SET poi_lig_id = l.lig_id, poi_ent_id = l.lig_ent_id
FROM pla_tache t
JOIN document_ligne l ON l.lig_id = CASE WHEN t.tac_origine_id ~ '^[0-9]+$' THEN t.tac_origine_id::bigint END
JOIN document d ON d.ent_id = l.lig_ent_id
WHERE t.tac_origine_type = 'ligne'
  AND p.poi_tac_id = t.tac_id
  AND p.poi_couche = 'SAISIE'
  AND p.poi_lig_id IS DISTINCT FROM l.lig_id
  AND (p.poi_ent_id IS NULL OR p.poi_ent_id = l.lig_ent_id)
  AND p.poi_cha_id = coalesce(l.lig_cha_id, d.ent_chantier_id, p.poi_cha_id)
  AND NOT EXISTS (SELECT 1 FROM poi_validation v
                  WHERE v.pvl_sal_id = p.poi_sal_id AND p.poi_date BETWEEN v.pvl_du AND v.pvl_au AND v.pvl_annule_le IS NULL)
  AND NOT EXISTS (SELECT 1 FROM poi_semaine s WHERE s.psm_sal_id = p.poi_sal_id AND s.psm_lundi = date_trunc('week', p.poi_date)::date);
