-- =============================================================================
-- Cœur – relevés de compteurs saisis à la borne (plan materiel-suites, lot 3, MO2). Rejouable.
--
-- Un relevé de source BORNE sur un matériel non affecté au salarié ce jour est accepté mais « à valider au bureau »
-- (comme les pointages à valider) : mre_a_valider, salarié de la borne, puis traitement (qui, quand ; un refus
-- supprime le relevé).
-- =============================================================================

ALTER TABLE materiel_releve ADD COLUMN IF NOT EXISTS mre_a_valider BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE materiel_releve ADD COLUMN IF NOT EXISTS mre_sal_id     INT REFERENCES salarie(sal_id) ON DELETE SET NULL;
ALTER TABLE materiel_releve ADD COLUMN IF NOT EXISTS mre_traite_par VARCHAR(50);
ALTER TABLE materiel_releve ADD COLUMN IF NOT EXISTS mre_traite_le  TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ix_mre_a_valider ON materiel_releve (mre_id) WHERE mre_a_valider;
