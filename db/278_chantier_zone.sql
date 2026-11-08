-- =============================================================================
-- Chantier : zone de déplacement estimée (0 à 9), reprise du projet à l'ouverture du chantier (plan ne-plus-utiliser-tva,
-- lot 7). Les zones validées par agence restent celles du Pointage (poi_zone_chantier). Rejouable.
-- =============================================================================

ALTER TABLE chantier ADD COLUMN IF NOT EXISTS cha_zone SMALLINT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cha_zone') THEN
        ALTER TABLE chantier ADD CONSTRAINT ck_cha_zone CHECK (cha_zone BETWEEN 0 AND 9);
    END IF;
END $$;
