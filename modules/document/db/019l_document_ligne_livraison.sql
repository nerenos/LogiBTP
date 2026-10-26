-- =============================================================================
-- Module Document – date de livraison par ligne (analyse des demandes du 25/10/2026, lot 9, A24a). Rejouable.
--   lig_date_livraison : date de livraison propre à la ligne ; vide = date par défaut fournie par l'application
--                        (cœur : livraison confirmée par l'accusé de réception, sinon livraison prévue de l'entête),
--                        qui suit donc tout changement de l'entête.
-- =============================================================================

ALTER TABLE document_ligne ADD COLUMN IF NOT EXISTS lig_date_livraison DATE;
COMMENT ON COLUMN document_ligne.lig_date_livraison IS 'Date de livraison propre à la ligne (vide : date par défaut de l''entête)';
