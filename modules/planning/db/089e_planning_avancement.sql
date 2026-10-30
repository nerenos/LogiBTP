-- =============================================================================
-- Module Planning : avancement réel d'une tâche, saisi par date (au plus un relevé par tâche et par jour, le dernier
-- l'emporte), distinct de l'avancement théorique tac_avancement ; pas de cumul vers l'élément ni l'ordre. Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pla_avancement (
    pav_id          BIGSERIAL    PRIMARY KEY,
    pav_tac_id      BIGINT       NOT NULL REFERENCES pla_tache (tac_id) ON DELETE CASCADE,
    pav_le          DATE         NOT NULL,
    pav_pourcent    SMALLINT     NOT NULL CHECK (pav_pourcent BETWEEN 0 AND 100),
    pav_commentaire TEXT,
    pav_par         VARCHAR(50)  NOT NULL,
    pav_saisi_le    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (pav_tac_id, pav_le)
);
COMMENT ON TABLE pla_avancement IS 'Avancement réel daté d''une tâche (relevé du terrain), distinct de l''avancement théorique';
