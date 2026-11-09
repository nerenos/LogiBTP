-- =============================================================================
-- Cœur LogiBTP – application de terrain (plan terrain-suites, lot 23 ; TS23 a) : intervention SAV créée sans réseau.
-- L'appareil donne à l'intervention un identifiant (UUID) et un numéro provisoire ; le serveur crée l'ordre E_SAV à
-- l'envoi et retient ici l'identifiant de l'appareil : un renvoi (réseau coupé pendant la réponse, compte rendu envoyé
-- après) rend le même ordre, sans doublon. Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS intervention_sav_appareil (
    isa_appareil   UUID         PRIMARY KEY,
    isa_ent_id     BIGINT       NOT NULL REFERENCES document (ent_id) ON DELETE CASCADE,
    isa_cree_par   VARCHAR(50)  NOT NULL,
    isa_cree_le    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
COMMENT ON TABLE intervention_sav_appareil IS 'Intervention SAV créée hors ligne : identifiant donné par l''appareil → ordre E_SAV créé à l''envoi (création idempotente)';
CREATE INDEX IF NOT EXISTS ix_isa_ent ON intervention_sav_appareil (isa_ent_id);
