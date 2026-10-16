-- =============================================================================
-- Module Bibliothèque – données techniques des éléments (par unité de stock) et caractéristiques d'isolation.
-- Utilisables dans les formules de correspondance d'unités ({{poids}}, {{hauteur}}…). Les caractéristiques
-- d'isolation ne s'affichent que pour un élément dont la nature est un isolant (nat_isolant).
-- =============================================================================

ALTER TABLE element
    ADD COLUMN IF NOT EXISTS ele_poids            NUMERIC(14,6),   -- kg par unité de stock
    ADD COLUMN IF NOT EXISTS ele_surface          NUMERIC(14,6),   -- m² par unité de stock
    ADD COLUMN IF NOT EXISTS ele_surface_peinture NUMERIC(14,6),   -- m² à peindre par unité de stock
    ADD COLUMN IF NOT EXISTS ele_volume           NUMERIC(14,6),   -- m³ par unité de stock
    ADD COLUMN IF NOT EXISTS ele_hauteur          NUMERIC(12,3),   -- mm
    ADD COLUMN IF NOT EXISTS ele_largeur          NUMERIC(12,3),   -- mm
    ADD COLUMN IF NOT EXISTS ele_epaisseur        NUMERIC(12,3),   -- mm
    ADD COLUMN IF NOT EXISTS ele_longueur         NUMERIC(12,3),   -- mm (longueur de barre…)
    ADD COLUMN IF NOT EXISTS ele_isolant_r        NUMERIC(10,4),   -- résistance thermique R (m².K/W)
    ADD COLUMN IF NOT EXISTS ele_isolant_lambda   NUMERIC(10,5),   -- conductivité λ (W/m.K)
    ADD COLUMN IF NOT EXISTS ele_isolant_u        NUMERIC(10,4);   -- coefficient de transmission U (W/m².K)

ALTER TABLE nature_element ADD COLUMN IF NOT EXISTS nat_isolant BOOLEAN NOT NULL DEFAULT FALSE;
