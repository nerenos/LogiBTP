-- =============================================================================
-- Cœur LogiBTP – application de terrain (plan terrain-suites, lot 19 ; TS18 a) : heures de matériel pointées à la borne
-- d'atelier. Après ses heures, le salarié identifié saisit une durée sur les matériels qui lui sont affectés ce jour
-- (materiel_affectation, type SALARIE) et un chantier de sa journée ; même table que le terrain (pointage_materiel), donc
-- même déboursé du chantier (db/261), avec la source de la saisie. Rejouable.
-- =============================================================================

ALTER TABLE pointage_materiel ADD COLUMN IF NOT EXISTS pma_source VARCHAR(10) NOT NULL DEFAULT 'TERRAIN';
ALTER TABLE pointage_materiel DROP CONSTRAINT IF EXISTS pointage_materiel_pma_source_check;
ALTER TABLE pointage_materiel ADD CONSTRAINT pointage_materiel_pma_source_check CHECK (pma_source IN ('TERRAIN', 'BORNE'));
COMMENT ON COLUMN pointage_materiel.pma_source IS 'Saisie : TERRAIN (tâche de l''application de terrain) ou BORNE (borne d''atelier, sans tâche)';
CREATE INDEX IF NOT EXISTS ix_pma_salarie ON pointage_materiel (pma_sal_id, pma_date) WHERE pma_source = 'BORNE';
