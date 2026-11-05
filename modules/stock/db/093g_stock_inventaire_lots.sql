-- =============================================================================
-- Module Stock, lots et numéros de série, lot S24-b (ANALYSE-MODULE-STOCK.md § 11) : inventaire par lot. Une ligne de
-- bordereau porte un numéro de lot facultatif ; le comptage d'un article reste une ligne de stk_comptage (sa quantité
-- totale : stock, écarts et valorisation inchangés) et sa répartition par lot va dans stk_comptage_lot (le reste du
-- comptage est sans lot). cpt_lot_id (lot S24-a, jamais renseigné) est remplacée. Rejouable.
-- =============================================================================

ALTER TABLE stk_bordereau_ligne ADD COLUMN IF NOT EXISTS bli_lot VARCHAR(60);
COMMENT ON COLUMN stk_bordereau_ligne.bli_lot IS 'Numéro de lot ou de série compté (S24) ; vide = sans lot';

CREATE TABLE IF NOT EXISTS stk_comptage_lot (
    cpl_cpt_id          BIGINT        NOT NULL REFERENCES stk_comptage(cpt_id) ON DELETE CASCADE,
    cpl_lot_id          BIGINT        NOT NULL REFERENCES stk_lot(lot_id) ON DELETE RESTRICT,
    cpl_quantite        NUMERIC(18,6) NOT NULL,
    PRIMARY KEY (cpl_cpt_id, cpl_lot_id)
);
COMMENT ON TABLE stk_comptage_lot IS 'Répartition par lot d''un comptage (S24) : le reste de la quantité comptée est sans lot';

ALTER TABLE stk_comptage DROP COLUMN IF EXISTS cpt_lot_id;
