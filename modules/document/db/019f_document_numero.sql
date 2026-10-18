-- =============================================================================
-- Module Document – changement du numéro d'un document (CONCEPTION-DOCUMENTS-EVOLUTIONS.md, lot B) : action NUMERO
-- de l'historique (ancien et nouveau numéro, motif). Rejouable.
-- =============================================================================

ALTER TABLE document_historique DROP CONSTRAINT IF EXISTS document_historique_his_action_check;
ALTER TABLE document_historique ADD CONSTRAINT document_historique_his_action_check
    CHECK (his_action IN ('CREATION','MODIFICATION','VALIDATION','ANNULATION','APPROBATION','ENVOI','VALIDATION_TIERS',
                          'DEVALIDATION','FORCAGE','REJET','NUMERO'));
