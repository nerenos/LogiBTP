-- =============================================================================
-- Module Comptabilité (base) : comptes de la dépréciation des stocks (plans/stock.md, lot 9), portés par un type comptable :
-- dotation (charge) et reprise (produit) de la provision pour dépréciation ; les comptes de stock, de variation et de
-- provision par nature d'article sont des clés de ventilation des types comptables du stock. Rejouable.
-- =============================================================================

ALTER TABLE type_comptable ADD COLUMN IF NOT EXISTS tco_cpt_dotation VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;
ALTER TABLE type_comptable ADD COLUMN IF NOT EXISTS tco_cpt_reprise  VARCHAR(20) REFERENCES compte_comptable(cpt_code) ON UPDATE CASCADE;

COMMENT ON COLUMN type_comptable.tco_cpt_dotation IS 'Dotation à la provision pour dépréciation (charge), opérations diverses de fin d''exercice du stock';
COMMENT ON COLUMN type_comptable.tco_cpt_reprise IS 'Reprise sur la provision pour dépréciation (produit), opérations diverses de fin d''exercice du stock';
