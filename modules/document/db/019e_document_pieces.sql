-- =============================================================================
-- Module Document – pièces comptables (CONCEPTION-REGLES-DOCUMENTS.md, P9) : date de la pièce externe (achats : date
-- de la facture du fournisseur, date comptable et départ de l'échéancier ; la date du document reste celle de la saisie).
-- Rejouable.
-- =============================================================================

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_date_externe DATE;
