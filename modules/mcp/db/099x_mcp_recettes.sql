-- =============================================================================
-- Module MCP, lot 13 (plans/mcp.md ; ANALYSE-MODULE-MCP.md § 10.2) : recettes (tâches répétitives). Rejouable.
--
-- Une recette est un prompt paramétré enregistré : marques « {nom} » du prompt = paramètres typés (MARCHE, CHANTIER,
-- DOCUMENT, PERIODE, TEXTE : TYPE_PARAMETRE_RECETTE), outils permis (noms du catalogue de l'application), sortie attendue
-- (BROUILLON, PROPOSITION, RAPPORT : SORTIE_RECETTE). Exposée au client comme prompt MCP seulement si elle est active et
-- que tous ses outils sont permis à la délégation ; lancée depuis l'interface (« Demander à l'agent »). Gérée par
-- l'administrateur seul (jamais par un agent) ; recettes fournies par l'application (mre_fournie) : modifiables et
-- désactivables, jamais supprimées.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mcp_recette (
    mre_code        VARCHAR(60)   PRIMARY KEY,
    mre_libelle     VARCHAR(200)  NOT NULL,
    mre_description VARCHAR(500),
    mre_prompt      TEXT          NOT NULL,
    -- [{ "nom", "type", "libelle", "requis" }]
    mre_parametres  JSONB         NOT NULL DEFAULT '[]',
    -- [noms d'outils]
    mre_outils      JSONB         NOT NULL DEFAULT '[]',
    mre_sortie      VARCHAR(20)   NOT NULL,
    mre_active      BOOLEAN       NOT NULL DEFAULT TRUE,
    mre_fournie     BOOLEAN       NOT NULL DEFAULT FALSE,
    mre_ordre       INTEGER       NOT NULL DEFAULT 100,
    mre_modifie_le  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    mre_modifie_par VARCHAR(50)   NOT NULL DEFAULT ''
);
