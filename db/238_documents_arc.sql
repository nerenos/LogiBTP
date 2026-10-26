-- =============================================================================
-- Cœur – documents, lot 9 des demandes du 25/10/2026 (A24e, A24a). Rejouable.
--   Accusé de réception de commande (ARC) d'une commande fournisseur ou de sous-traitance : numéro, date, livraison
--   confirmée (remplace la livraison prévue de l'entête pour les lignes sans date propre) ; fichier de l'ARC dans la
--   GED du document (catégorie « arc »). Saisi même sur une commande validée (PUT /api/structure/documents/{id}/arc).
--   f_date_livraison_ligne : date de livraison effective d'une ligne (ligne, ARC, livraison prévue, date de la pièce),
--   lue par la projection du stock.
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_arc_numero VARCHAR(50);
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_arc_date DATE;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_arc_livraison DATE;
COMMENT ON COLUMN document.ent_arc_numero IS 'Commande fournisseur : numéro de l''accusé de réception du fournisseur';
COMMENT ON COLUMN document.ent_arc_date IS 'Commande fournisseur : date de l''accusé de réception';
COMMENT ON COLUMN document.ent_arc_livraison IS 'Commande fournisseur : livraison confirmée par l''accusé de réception (remplace ent_date_livraison)';

CREATE OR REPLACE FUNCTION f_date_livraison_ligne(p_ligne DATE, p_arc DATE, p_prevue DATE, p_date DATE) RETURNS DATE
LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(p_ligne, p_arc, p_prevue, p_date) $$;
