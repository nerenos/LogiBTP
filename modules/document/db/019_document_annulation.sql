-- =============================================================================
-- Module Document – annulation par avoir (CONCEPTION-ACHATS-MARCHES.md, Q30, 13.12 bis) : un lien ANNULATION relie
-- une pièce (facture, avoir d'avancement) à l'avoir qui l'annule ; les deux passent au statut Annulé.
-- Rejouable.
-- =============================================================================

ALTER TABLE document_lien DROP CONSTRAINT IF EXISTS document_lien_lie_type_check;
ALTER TABLE document_lien ADD CONSTRAINT document_lien_lie_type_check CHECK (lie_type IN ('TRANSFORMATION','COPIE','ANNULATION'));
