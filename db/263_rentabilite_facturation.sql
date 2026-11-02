-- =============================================================================
-- Cœur – prévisionnel de facturation de la rentabilité (ANALYSE-MODULE-ANALYSE.md § 10.2 ; module Rentabilité, lot 7).
-- Rejouable.
--
-- Clé étrangère des versions du prévisionnel (rentabilite_facturation_version du module 099r) vers le chantier.
-- Aucun fait : le prévisionnel de facturation se lit à part (versions, mois) et se compare au facturé des faits.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_rfv_chantier') THEN
        ALTER TABLE rentabilite_facturation_version ADD CONSTRAINT fk_rfv_chantier FOREIGN KEY (rfv_cha_id) REFERENCES chantier (cha_id) ON DELETE CASCADE;
    END IF;
END $$;
