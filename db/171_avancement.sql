-- =============================================================================
-- Cœur LogiBTP – avancement des marchés (CONCEPTION-ACHATS-MARCHES.md, Q24 à Q27) : types d'avancement (situation de
-- travaux S, factures d'avancement F) et option du marché qui permet de dépasser son montant (travaux publics).
-- Rejouable.
-- =============================================================================

UPDATE type_document SET tyd_avancement = 'S' WHERE tyd_code = 'V_SITUATION';
UPDATE type_document SET tyd_avancement = 'F' WHERE tyd_code IN ('V_FACTURE_AVT', 'A_FACTURE_AVT');

ALTER TABLE marche ADD COLUMN IF NOT EXISTS mar_depassement_autorise BOOLEAN NOT NULL DEFAULT FALSE;
