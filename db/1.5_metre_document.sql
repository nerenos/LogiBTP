-- requiert: metre 1.1
-- =============================================================================
-- Cœur – métré du document (plan metres-tranches-document, lot 3) : un métré sans ligne est rattaché à son document
-- (metre.mtr_ent_id, module Métré 1.1), supprimé avec lui. Le métré d'une tranche est un métré de ligne ordinaire
-- (lig_mtr_id de la ligne TITRE, fk_mtr_ligne).
-- =============================================================================

ALTER TABLE metre ADD CONSTRAINT fk_mtr_document FOREIGN KEY (mtr_ent_id) REFERENCES document(ent_id) ON DELETE CASCADE;
