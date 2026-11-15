-- =============================================================================
-- Module MCP, lot 10 (plans/mcp.md, ANALYSE-MODULE-MCP.md § 10.1) : file des propositions d'agents. Rejouable.
--
-- Une proposition est une action préparée par un agent et non exécutée (valider une pièce, appliquer une ventilation,
-- envoyer un document, créer un tiers…) : un humain l'accepte (exécution par l'exécuteur déclaré par l'application, sous
-- sa propre identité, en une transaction), corrige son contenu ou la refuse avec un motif. Sans métier : action, nœud
-- et droit exigés, cible et contenu sont des codes et des données de l'application, sans clé étrangère.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mcp_proposition (
    mpr_id             BIGSERIAL    PRIMARY KEY,
    mpr_delegation     VARCHAR(40)  NOT NULL,
    mpr_compte         VARCHAR(50)  NOT NULL,
    mpr_client         VARCHAR(100) NOT NULL DEFAULT '',
    mpr_outil          VARCHAR(100) NOT NULL,
    mpr_action         VARCHAR(60)  NOT NULL,
    mpr_noeud          VARCHAR(200) NOT NULL,
    mpr_droit          VARCHAR(30)  NOT NULL,
    mpr_libelle        VARCHAR(300) NOT NULL DEFAULT '',
    mpr_cible_type     VARCHAR(60),
    mpr_cible_id       VARCHAR(60),
    mpr_contenu        JSONB        NOT NULL DEFAULT '{}',
    mpr_avertissements JSONB        NOT NULL DEFAULT '[]',
    mpr_echeance       DATE         NOT NULL,
    mpr_etat           VARCHAR(20)  NOT NULL DEFAULT 'EN_ATTENTE',
    mpr_cree_le        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    mpr_corrige_le     TIMESTAMPTZ,
    mpr_corrige_par    VARCHAR(50),
    mpr_traitee_le     TIMESTAMPTZ,
    mpr_traitee_par    VARCHAR(50),
    mpr_motif          TEXT,
    mpr_resultat       JSONB
);
ALTER TABLE mcp_proposition DROP CONSTRAINT IF EXISTS mcp_proposition_etat_check;
ALTER TABLE mcp_proposition ADD CONSTRAINT mcp_proposition_etat_check CHECK (mpr_etat IN ('EN_ATTENTE','ACCEPTEE','REFUSEE','ANNULEE','ECHUE'));
CREATE INDEX IF NOT EXISTS ix_mcp_proposition_compte ON mcp_proposition (mpr_compte, mpr_etat);
CREATE INDEX IF NOT EXISTS ix_mcp_proposition_attente ON mcp_proposition (mpr_etat, mpr_echeance) WHERE mpr_etat = 'EN_ATTENTE';

-- Journal des agents : proposition concernée (dépôt, correction, acceptation, refus) et humain qui a décidé.
ALTER TABLE agent_journal ADD COLUMN IF NOT EXISTS ajo_proposition BIGINT;
ALTER TABLE agent_journal ADD COLUMN IF NOT EXISTS ajo_humain VARCHAR(50);
CREATE INDEX IF NOT EXISTS ix_agent_journal_proposition ON agent_journal (ajo_proposition) WHERE ajo_proposition IS NOT NULL;
