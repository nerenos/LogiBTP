-- =============================================================================
-- Module MCP, lot 12 (plans/mcp.md, ANALYSE-MODULE-MCP.md § 11 et R6) : serveur d'autorisation OAuth 2.1 du point /mcp
-- (clients distants : connecteur claude.ai…). Rejouable.
--
-- Clients : documents de métadonnées de client (CIMD : client_id = adresse https du document), admis seulement s'ils
-- figurent, actifs, dans la liste blanche de la société (claude.ai et Claude Code pré-renseignés, désactivables).
-- Autorisation : demande reçue par /oauth/authorize (PKCE S256, ressource = /mcp de la société), consentement = création
-- d'une délégation par l'utilisateur connecté, code à usage unique (empreinte seule). Jetons : accès = jeton délégué court
-- du module Authentification ; rafraîchissement rotatif à usage unique (empreinte seule), rejeu → délégation révoquée.
-- =============================================================================

-- Liste blanche des clients OAuth de la société (paramétrage administrateur).
CREATE TABLE IF NOT EXISTS mcp_client_oauth (
    mcl_client_id   VARCHAR(500) PRIMARY KEY,
    mcl_libelle     VARCHAR(100) NOT NULL DEFAULT '',
    mcl_actif       BOOLEAN      NOT NULL DEFAULT TRUE,
    mcl_modifie_le  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    mcl_modifie_par VARCHAR(50)  NOT NULL DEFAULT ''
);
-- Pré-renseignés (désactivables, jamais réinsérés une fois retirés ou modifiés : ON CONFLICT DO NOTHING).
INSERT INTO mcp_client_oauth (mcl_client_id, mcl_libelle, mcl_actif, mcl_modifie_par) VALUES
    ('https://claude.ai/oauth/mcp-oauth-client-metadata', 'claude.ai', TRUE, 'installation'),
    ('https://claude.ai/oauth/claude-code-client-metadata', 'Claude Code', TRUE, 'installation')
ON CONFLICT (mcl_client_id) DO NOTHING;

-- Demande d'autorisation, puis code d'autorisation après consentement (une ligne par demande).
CREATE TABLE IF NOT EXISTS mcp_oauth_autorisation (
    mau_id              BIGSERIAL     PRIMARY KEY,
    mau_demande         VARCHAR(64)   NOT NULL UNIQUE,
    mau_client_id       VARCHAR(500)  NOT NULL,
    mau_client_nom      VARCHAR(100)  NOT NULL DEFAULT '',
    mau_redirection     VARCHAR(2000) NOT NULL,
    mau_etat_client     VARCHAR(2000),
    mau_defi            VARCHAR(64)   NOT NULL,
    mau_ressource       VARCHAR(500)  NOT NULL,
    mau_portee          VARCHAR(500),
    mau_cree_le         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    mau_expire_le       TIMESTAMPTZ   NOT NULL,
    mau_decidee_le      TIMESTAMPTZ,
    mau_decidee_par     VARCHAR(50),
    mau_refusee         BOOLEAN       NOT NULL DEFAULT FALSE,
    mau_delegation      VARCHAR(40),
    mau_code_empreinte  VARCHAR(64)   UNIQUE,
    mau_code_expire_le  TIMESTAMPTZ,
    mau_code_utilise_le TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_mcp_oauth_autorisation_expire ON mcp_oauth_autorisation (mau_expire_le);

-- Jetons de rafraîchissement (rotatifs, usage unique) d'une délégation consentie par OAuth.
CREATE TABLE IF NOT EXISTS mcp_oauth_rafraichissement (
    mra_id          BIGSERIAL    PRIMARY KEY,
    mra_empreinte   VARCHAR(64)  NOT NULL UNIQUE,
    mra_delegation  VARCHAR(40)  NOT NULL,
    mra_client_id   VARCHAR(500) NOT NULL,
    mra_ressource   VARCHAR(500) NOT NULL,
    mra_cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    mra_expire_le   TIMESTAMPTZ  NOT NULL,
    mra_utilise_le  TIMESTAMPTZ,
    mra_revoque_le  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_mcp_oauth_rafraichissement_delegation ON mcp_oauth_rafraichissement (mra_delegation);

-- Délégation née d'un consentement OAuth : identifiant (adresse) du client.
ALTER TABLE mcp_delegation ADD COLUMN IF NOT EXISTS mde_client_oauth VARCHAR(500);
