-- =============================================================================
-- Cœur LogiBTP – application de terrain (plan terrain-suites, lot 14 ; TS14 a) : réserves suivies d'une réception de
-- pose, une ligne par réserve (libellé, photo de la GED, état OUVERTE / LEVEE, levée le, par qui, heure de l'appareil
-- pour une levée gardée hors ligne, commentaire et photo de la levée). Écrites par le serveur à la réception avec
-- réserves (TerrainReceptionBtp.cs) ; la tâche du CRM reste comme alerte. Pas de reprise des réserves déjà notées
-- dans les tâches du CRM (nouvelles réceptions seulement). États : client/src/app/codes.js ETAT_RESERVE ↔
-- Codes.cs EtatsReserve. Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS reception_reserve (
    rre_id                 BIGSERIAL    PRIMARY KEY,
    rre_rec_id             BIGINT       NOT NULL REFERENCES reception_pose (rec_id) ON DELETE CASCADE,
    rre_ent_id             BIGINT       NOT NULL REFERENCES document (ent_id) ON DELETE CASCADE,
    rre_ordre              SMALLINT     NOT NULL,
    rre_libelle            TEXT         NOT NULL,
    rre_dge_id             BIGINT,
    rre_etat               VARCHAR(10)  NOT NULL DEFAULT 'OUVERTE' CHECK (rre_etat IN ('OUVERTE', 'LEVEE')),
    rre_levee_le           TIMESTAMPTZ,
    rre_levee_appareil_le  TIMESTAMPTZ,
    rre_levee_par          VARCHAR(50),
    rre_levee_commentaire  TEXT,
    rre_levee_dge_id       BIGINT,
    CONSTRAINT ck_rre_levee CHECK (rre_etat = 'OUVERTE' OR rre_levee_le IS NOT NULL AND rre_levee_par IS NOT NULL),
    CONSTRAINT uq_rre_rang UNIQUE (rre_rec_id, rre_ordre)
);
COMMENT ON TABLE reception_reserve IS 'Réserve d''une réception de pose, suivie jusqu''à sa levée (application de terrain, TS14)';
COMMENT ON COLUMN reception_reserve.rre_ent_id IS 'Ordre de pose de la réception (recopié pour les lectures par ordre)';
COMMENT ON COLUMN reception_reserve.rre_dge_id IS 'Photo de la réserve (GED de l''ordre)';
COMMENT ON COLUMN reception_reserve.rre_levee_le IS 'Levée reçue par le serveur';
COMMENT ON COLUMN reception_reserve.rre_levee_appareil_le IS 'Heure de la levée sur l''appareil (levée gardée hors ligne) ; vide si levée en ligne';
COMMENT ON COLUMN reception_reserve.rre_levee_dge_id IS 'Photo de la levée (GED de l''ordre)';
CREATE INDEX IF NOT EXISTS ix_rre_ent ON reception_reserve (rre_ent_id, rre_etat);
