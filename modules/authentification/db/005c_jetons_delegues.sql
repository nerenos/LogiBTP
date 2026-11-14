-- Module Authentification : jetons délégués aux agents IA (plan MCP, lot 4 ; ANALYSE-MODULE-MCP.md) ; rejouable.
-- Un jeton délégué agit pour un compte sous une délégation (identifiant opaque, connu du module MCP) et un client
-- (Claude Code, Claude Desktop…). Secret « lbtp_agent_… » de 32 octets aléatoires rendu une seule fois : seule son
-- empreinte SHA-256 est conservée. Révoqué un par un, par délégation ou pour tout le compte (désactivation, sessions
-- fermées, mot de passe réinitialisé).
CREATE TABLE IF NOT EXISTS jeton_delegue (
    jde_id           BIGSERIAL     PRIMARY KEY,
    jde_uuid         UUID          NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    jde_cpt_id       BIGINT        NOT NULL REFERENCES compte(cpt_id) ON DELETE CASCADE,
    jde_delegation   VARCHAR(64)   NOT NULL,
    jde_empreinte    CHAR(64)      NOT NULL UNIQUE,
    jde_client       VARCHAR(120)  NOT NULL,
    jde_cree_le      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    jde_expire_le    TIMESTAMPTZ   NOT NULL,
    jde_revoque_le   TIMESTAMPTZ,
    jde_utilise_le   TIMESTAMPTZ,
    jde_adresse      VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS ix_jde_compte ON jeton_delegue (jde_cpt_id) WHERE jde_revoque_le IS NULL;
CREATE INDEX IF NOT EXISTS ix_jde_delegation ON jeton_delegue (jde_delegation) WHERE jde_revoque_le IS NULL;

ALTER TABLE journal_connexion DROP CONSTRAINT IF EXISTS journal_connexion_jco_evenement_check;
ALTER TABLE journal_connexion ADD CONSTRAINT journal_connexion_jco_evenement_check CHECK (jco_evenement IN ('CONNEXION', 'ECHEC', 'VERROUILLAGE',
    'DECONNEXION', 'MDP_CHANGE', 'MDP_REINITIALISE', 'EXPIRE', 'REFUS', 'DEVERROUILLAGE', 'COMPTE', 'MDP_OUBLI',
    'USURPATION', 'USURPATION_FIN', 'USURPATION_ACTION', 'DOUBLE_FACTEUR', 'EXCLUSION_IP', 'VOL_PRESUME', 'MACHINE', 'SESSION_FERMEE',
    'JETON_API', 'JETON_DELEGUE'));
