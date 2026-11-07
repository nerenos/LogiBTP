-- Cœur – module SAV, lot 6 du plan Stock (plans/stock.md ; ANALYSE-MODULE-STOCK.md § 11, S24.8) : équipement installé
-- concerné par un compte rendu d'intervention SAV du terrain (intervention_sav, db/245). L'équipement supprimé
-- laisse le compte rendu (colonne remise à null). Rejouable.

ALTER TABLE intervention_sav ADD COLUMN IF NOT EXISTS isv_eqi_id BIGINT;
COMMENT ON COLUMN intervention_sav.isv_eqi_id IS 'Équipement installé (module SAV) sur lequel porte l''intervention, facultatif';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_isv_equipement') THEN
        ALTER TABLE intervention_sav ADD CONSTRAINT fk_isv_equipement FOREIGN KEY (isv_eqi_id) REFERENCES equipement_installe (eqi_id) ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_isv_equipement ON intervention_sav (isv_eqi_id) WHERE isv_eqi_id IS NOT NULL;
