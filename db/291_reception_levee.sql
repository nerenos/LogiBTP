-- =============================================================================
-- Cœur LogiBTP – application de terrain (plan terrain-suites, lot 16 ; TS14 a) : procès-verbal de levée des réserves
-- signé par le client sur le terrain, une fois toutes les réserves de l'ordre levées. Signature simple (table signature,
-- empreinte SHA-256 du PDF rangé dans la GED de l'ordre), heure de l'appareil pour un PV gardé hors ligne ; réserves
-- couvertes par le PV (rre_rlv_id). PV édité par le modèle PV_LEVEE_RESERVES (db/191), source annexe levee_reserves.
-- Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS reception_levee (
    rlv_id                  BIGSERIAL    PRIMARY KEY,
    rlv_ent_id              BIGINT       NOT NULL REFERENCES document (ent_id) ON DELETE CASCADE,
    rlv_sig_id              BIGINT       REFERENCES signature (sig_id) ON DELETE SET NULL,
    rlv_dge_id              BIGINT,
    rlv_courriel            VARCHAR(200),
    rlv_signee_appareil_le  TIMESTAMPTZ,
    rlv_cree_par            VARCHAR(50)  NOT NULL,
    rlv_cree_le             TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE reception_levee IS 'Procès-verbal de levée des réserves d''un ordre de pose, signé sur le terrain (PV rangé dans la GED de l''ordre)';
COMMENT ON COLUMN reception_levee.rlv_signee_appareil_le IS 'Heure de signature sur l''appareil (PV gardé hors ligne) ; vide si signé en ligne';
CREATE INDEX IF NOT EXISTS ix_rlv_ent ON reception_levee (rlv_ent_id);

ALTER TABLE reception_reserve ADD COLUMN IF NOT EXISTS rre_rlv_id BIGINT REFERENCES reception_levee (rlv_id) ON DELETE SET NULL;
COMMENT ON COLUMN reception_reserve.rre_rlv_id IS 'PV de levée qui constate la levée de la réserve';
