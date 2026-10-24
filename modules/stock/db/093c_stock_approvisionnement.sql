-- =============================================================================
-- Module Stock, lot 3 (ANALYSE-MODULE-STOCK.md § 5.4, S13 à S15) : seuils mini / maxi et délai de réapprovisionnement
-- par article et lieu ; horizon des propositions et de la projection par lieu (défaut 7 jours de délai, 56 jours de
-- frise). Les réservations et les commandes (événements prévus) sont lues par l'application. Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stk_seuil (
    sse_ele_id          BIGINT        NOT NULL,
    sse_lieu_id         BIGINT        NOT NULL,
    sse_mini            NUMERIC(18,6),
    sse_maxi            NUMERIC(18,6),
    sse_delai_jours     INT,                                             -- délai de réapprovisionnement (vide : celui du lieu)
    PRIMARY KEY (sse_ele_id, sse_lieu_id),
    CHECK (sse_mini IS NULL OR sse_mini >= 0),
    CHECK (sse_maxi IS NULL OR sse_mini IS NULL OR sse_maxi >= sse_mini)
);

CREATE TABLE IF NOT EXISTS stk_lieu_parametre (
    slp_lieu_id         BIGINT        PRIMARY KEY,
    slp_delai_jours     INT           NOT NULL DEFAULT 7 CHECK (slp_delai_jours >= 0),   -- horizon des propositions
    slp_frise_jours     INT           NOT NULL DEFAULT 56 CHECK (slp_frise_jours > 0)    -- horizon de la projection affichée
);
