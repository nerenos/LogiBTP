-- =============================================================================
-- Module Stock : pièce des écarts d'un lot d'inventaire validé (pièce comptable produite par l'application) et pièce
-- qui la contre-passe à l'annulation d'un lot déjà transféré en comptabilité. Identifiants fournis par l'application
-- (clés étrangères posées par le cœur). Rejouable.
-- =============================================================================

ALTER TABLE stk_lot_inventaire ADD COLUMN IF NOT EXISTS lin_ent_id BIGINT;
ALTER TABLE stk_lot_inventaire ADD COLUMN IF NOT EXISTS lin_extourne_ent_id BIGINT;

COMMENT ON COLUMN stk_lot_inventaire.lin_ent_id IS 'Pièce des écarts valorisés du lot (pièce comptable de l''application)';
COMMENT ON COLUMN stk_lot_inventaire.lin_extourne_ent_id IS 'Contre-passation de la pièce des écarts (lot annulé après son transfert en comptabilité)';
