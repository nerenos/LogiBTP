-- =============================================================================
-- Cœur – module Stock, lot 3 (ANALYSE-MODULE-STOCK.md § 5.4, S13, S25 ; module 093c) : date de besoin des réservations
-- et demandes de stock (`ent_date_besoin`), date de livraison prévue des commandes fournisseur (`ent_date_livraison`),
-- transformation réservation → transfert (sortie du dépôt vers le chantier), clés étrangères des seuils. Rejouable.
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_date_besoin DATE;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_date_livraison DATE;
COMMENT ON COLUMN document.ent_date_besoin IS 'Réservation ou demande de stock : date de besoin (projection du disponible)';
COMMENT ON COLUMN document.ent_date_livraison IS 'Commande fournisseur : date de livraison prévue (entrées attendues de la projection)';

INSERT INTO transformation_autorisee (tra_source_tyd_id, tra_cible_tyd_id, tra_etape)
SELECT s.tyd_id, c.tyd_id, 'SORTIE' FROM type_document s, type_document c
WHERE s.tyd_code = 'S_RESERVATION' AND c.tyd_code = 'S_TRANSFERT'
  AND NOT EXISTS (SELECT 1 FROM transformation_autorisee t WHERE t.tra_source_tyd_id = s.tyd_id AND t.tra_cible_tyd_id = c.tyd_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sse_element') THEN
        ALTER TABLE stk_seuil ADD CONSTRAINT fk_sse_element FOREIGN KEY (sse_ele_id) REFERENCES element(ele_id) ON DELETE CASCADE;
        ALTER TABLE stk_seuil ADD CONSTRAINT fk_sse_lieu FOREIGN KEY (sse_lieu_id) REFERENCES chantier(cha_id) ON DELETE CASCADE;
        ALTER TABLE stk_lieu_parametre ADD CONSTRAINT fk_slp_lieu FOREIGN KEY (slp_lieu_id) REFERENCES chantier(cha_id) ON DELETE CASCADE;
    END IF;
END $$;
