-- Cœur – module Stock, lots et numéros de série, lot S24-a (module 093f ; ANALYSE-MODULE-STOCK.md § 11) : clés
-- étrangères du suivi des articles et des lots (article, fournisseur). Répartition d'une ligne de pièce entre ses lots :
-- `lig_proprietes.lots` ([{ numero, quantite, fabrication, limite, coulee }], quantités en unité de stock), lue à la
-- validation par MouvementsStockBtp (un mouvement par lot, le reste sans lot). Rejouable.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sas_element') THEN
        ALTER TABLE stk_article_suivi ADD CONSTRAINT fk_sas_element FOREIGN KEY (sas_ele_id) REFERENCES element(ele_id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lot_element') THEN
        ALTER TABLE stk_lot ADD CONSTRAINT fk_lot_element FOREIGN KEY (lot_ele_id) REFERENCES element(ele_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lot_tiers') THEN
        ALTER TABLE stk_lot ADD CONSTRAINT fk_lot_tiers FOREIGN KEY (lot_tiers_id) REFERENCES personne(per_id) ON DELETE SET NULL;
    END IF;
END $$;
