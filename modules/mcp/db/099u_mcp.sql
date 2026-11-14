-- =============================================================================
-- Module MCP, lot 5 (plans/mcp.md, ANALYSE-MODULE-MCP.md § 4, 5, 9) : délégations aux agents IA, levées des
-- garde-fous et quotas par profil, journal des appels d'outils, compteurs de lecture par jour. Rejouable.
--
-- Sans métier : le module ne connaît ni les comptes, ni les profils, ni les éléments de l'application ; mde_compte,
-- mlp_profil, ajo_compte sont des codes de l'application, sans clé étrangère (le module ne dépend pas du module
-- Authentification ni du module Droits). Les jetons des délégations sont ceux du module Authentification
-- (jeton_delegue.jde_delegation = mde_code).
-- =============================================================================

-- Délégation : mandat d'un compte à un agent (modèle de plafond, nœuds sur mesure, portée maximale, garde-fous levés,
-- client, échéance). Révoquée : jetons révoqués, plafond nul.
CREATE TABLE IF NOT EXISTS mcp_delegation (
    mde_id            BIGSERIAL    PRIMARY KEY,
    mde_code          VARCHAR(40)  NOT NULL UNIQUE,
    mde_compte        VARCHAR(50)  NOT NULL,
    mde_libelle       VARCHAR(200) NOT NULL DEFAULT '',
    mde_modele        VARCHAR(20)  NOT NULL,
    mde_noeuds        JSONB,
    mde_portee        VARCHAR(10),
    mde_leves         JSONB        NOT NULL DEFAULT '[]',
    mde_client        VARCHAR(100) NOT NULL DEFAULT '',
    mde_echeance      DATE         NOT NULL,
    mde_cree_le       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    mde_premier_usage TIMESTAMPTZ,
    mde_revoquee_le   TIMESTAMPTZ,
    mde_revoquee_par  VARCHAR(50)
);
ALTER TABLE mcp_delegation DROP CONSTRAINT IF EXISTS mcp_delegation_modele_check;
ALTER TABLE mcp_delegation ADD CONSTRAINT mcp_delegation_modele_check CHECK (mde_modele IN ('LECTURE','PREPARATION','COMME_MOI','SUR_MESURE'));
CREATE INDEX IF NOT EXISTS ix_mcp_delegation_compte ON mcp_delegation (mde_compte);

-- Levées par profil (administrateur) : garde-fous levables, modèles permis (null : tous), échéance maximale, quotas du
-- garde-fou VOLUME (null : valeurs par défaut de ReglesDelegation). Profil sans ligne : rien de levable, défauts.
CREATE TABLE IF NOT EXISTS mcp_levee_profil (
    mlp_profil      VARCHAR(30)  PRIMARY KEY,
    mlp_levables    JSONB        NOT NULL DEFAULT '[]',
    mlp_modeles     JSONB,
    mlp_jours_max   INT,
    mlp_quota_appel INT,
    mlp_quota_jour  INT,
    mlp_alerte      INT,
    mlp_modifie_le  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    mlp_modifie_par VARCHAR(50)  NOT NULL DEFAULT ''
);
ALTER TABLE mcp_levee_profil DROP CONSTRAINT IF EXISTS mcp_levee_profil_jours_check;
ALTER TABLE mcp_levee_profil ADD CONSTRAINT mcp_levee_profil_jours_check CHECK (mlp_jours_max IS NULL OR mlp_jours_max BETWEEN 1 AND 90);

-- Journal des agents (§ 9) : une ligne par appel d'outil, lecture comprise. Paramètres résumés sans valeur sensible ;
-- routes appelées et statut ; éléments lus et écrits ; garde-fous appliqués (clés retirées) ; durée ; erreur.
CREATE TABLE IF NOT EXISTS agent_journal (
    ajo_id          BIGSERIAL    PRIMARY KEY,
    ajo_date        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ajo_delegation  VARCHAR(40)  NOT NULL,
    ajo_compte      VARCHAR(50)  NOT NULL,
    ajo_client      VARCHAR(100) NOT NULL DEFAULT '',
    ajo_session     VARCHAR(100),
    ajo_outil       VARCHAR(100) NOT NULL,
    ajo_classe      VARCHAR(20)  NOT NULL DEFAULT '',
    ajo_parametres  JSONB,
    ajo_routes      JSONB,
    ajo_lus         JSONB,
    ajo_nb_lus      INT          NOT NULL DEFAULT 0,
    ajo_ecrits      JSONB,
    ajo_gardes_fous JSONB,
    ajo_statut      VARCHAR(20)  NOT NULL,
    ajo_duree_ms    INT          NOT NULL DEFAULT 0,
    ajo_erreur      TEXT
);
ALTER TABLE agent_journal DROP CONSTRAINT IF EXISTS agent_journal_statut_check;
ALTER TABLE agent_journal ADD CONSTRAINT agent_journal_statut_check CHECK (ajo_statut IN ('SUCCES','REFUS','QUOTA','ERREUR'));
CREATE INDEX IF NOT EXISTS ix_agent_journal_delegation ON agent_journal (ajo_delegation, ajo_date);
CREATE INDEX IF NOT EXISTS ix_agent_journal_compte ON agent_journal (ajo_compte, ajo_date);

-- Compteurs du garde-fou VOLUME : éléments lus et appels par délégation et par jour.
CREATE TABLE IF NOT EXISTS mcp_compteur (
    mco_delegation  VARCHAR(40)  NOT NULL,
    mco_jour        DATE         NOT NULL,
    mco_appels      INT          NOT NULL DEFAULT 0,
    mco_elements    INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (mco_delegation, mco_jour)
);
