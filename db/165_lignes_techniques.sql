-- =============================================================================
-- Cœur LogiBTP – données techniques des lignes de document (DocumentLigneBtp, colonnes-btp.js).
-- Recopiées des données techniques de l'élément de bibliothèque à l'insertion (client/src/app/bibliotheque/appel.js),
-- modifiables sur la ligne et lisibles par les métrés ({{lig_longueur}}…). Poids, surfaces et volume par unité de
-- stock de l'élément ; dimensions en mètres (l'élément les garde en mm).
-- Rejouable (IF NOT EXISTS).
-- =============================================================================

ALTER TABLE document_ligne
    ADD COLUMN IF NOT EXISTS lig_poids     NUMERIC(18,6),   -- kg
    ADD COLUMN IF NOT EXISTS lig_surface   NUMERIC(18,6),   -- m²
    ADD COLUMN IF NOT EXISTS lig_volume    NUMERIC(18,6),   -- m³
    ADD COLUMN IF NOT EXISTS lig_hauteur   NUMERIC(18,6),   -- m
    ADD COLUMN IF NOT EXISTS lig_largeur   NUMERIC(18,6),   -- m
    ADD COLUMN IF NOT EXISTS lig_epaisseur NUMERIC(18,6),   -- m
    ADD COLUMN IF NOT EXISTS lig_longueur  NUMERIC(18,6);   -- m
