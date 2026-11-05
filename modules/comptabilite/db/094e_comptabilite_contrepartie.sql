-- =============================================================================
-- Module Comptabilité (base) : compte de contrepartie d'un type comptable, pour les opérations diverses produites par
-- l'application sans tiers ni TVA (écarts d'inventaire du stock : compte de stock ↔ variation des stocks). Rejouable.
-- =============================================================================

ALTER TABLE type_comptable ADD COLUMN IF NOT EXISTS tco_cpt_contrepartie VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;

COMMENT ON COLUMN type_comptable.tco_cpt_contrepartie IS 'Contrepartie des opérations diverses (variation des stocks des écarts d''inventaire)';
