-- =============================================================================
-- Cœur – module MCP, lot 7 (plans/mcp.md ; ANALYSE-MODULE-MCP.md § 9). Rejouable.
--
-- Origine des écritures dans l'historique des pièces (document_historique, module Document) : colonnes posées par le
-- cœur (SpecialisationBtp.ApresHistoriqueAsync) quand l'utilisateur de la requête est un agent (Utilisateur.Agent) :
-- - his_origine : ORIGINE_ECRITURE du socle (AGENT) ; NULL = action humaine (les lignes existantes restent NULL) ;
-- - his_delegation : code opaque de la délégation (mcp_delegation.mde_code, jeton_delegue.jde_delegation) ;
-- - his_client : client de l'agent (claude.ai, Claude Code…), tel que déclaré par le jeton délégué.
-- Affichage « 🤖 via <client> » dans l'historique : lot 11.
-- =============================================================================

ALTER TABLE document_historique ADD COLUMN IF NOT EXISTS his_origine VARCHAR(20);
ALTER TABLE document_historique ADD COLUMN IF NOT EXISTS his_delegation VARCHAR(100);
ALTER TABLE document_historique ADD COLUMN IF NOT EXISTS his_client VARCHAR(100);

ALTER TABLE document_historique DROP CONSTRAINT IF EXISTS document_historique_his_origine_check;
ALTER TABLE document_historique ADD CONSTRAINT document_historique_his_origine_check
    CHECK (his_origine IS NULL OR his_origine IN ('HUMAIN', 'AGENT', 'USURPATION', 'SERVICE'));

CREATE INDEX IF NOT EXISTS ix_his_delegation ON document_historique (his_delegation) WHERE his_delegation IS NOT NULL;
