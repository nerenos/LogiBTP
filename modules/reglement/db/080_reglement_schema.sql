-- =============================================================================
-- Module Règlements (CONCEPTION-MARCHES-REGLEMENTS.md, Q14 à Q18) : règlements reçus (E : encaissement) et émis
-- (D : décaissement), cautions, pointage des échéances. Les échéances appartiennent à l'application (module Document
-- dans LogiBTP) : poi_echeance_id n'a pas de clé étrangère ici, le cœur l'ajoute (db/175).
-- Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS reglement (
    reg_id          BIGSERIAL     PRIMARY KEY,
    reg_tiers_id    BIGINT        NOT NULL,
    reg_sens        CHAR(1)       NOT NULL CHECK (reg_sens IN ('E','D')),
    reg_date        DATE          NOT NULL,
    reg_mode        VARCHAR(20)   NOT NULL,
    reg_montant     NUMERIC(18,6) NOT NULL,
    reg_reference   VARCHAR(100),
    reg_commentaire TEXT,
    reg_cree_le     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    reg_cree_par    VARCHAR(50)   NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_reglement_tiers ON reglement (reg_tiers_id, reg_date);

-- Caution (retenue de garantie cautionnée…) : objet de l'application (marché…), organisme, montant, validité, mainlevée.
CREATE TABLE IF NOT EXISTS caution (
    cau_id          BIGSERIAL     PRIMARY KEY,
    cau_tiers_id    BIGINT        NOT NULL,
    cau_objet       VARCHAR(30),
    cau_objet_id    BIGINT,
    cau_organisme   VARCHAR(150)  NOT NULL,
    cau_montant     NUMERIC(18,6) NOT NULL,
    cau_date        DATE          NOT NULL,
    cau_date_fin    DATE,
    cau_reference   VARCHAR(100),
    cau_mainlevee   DATE
);
CREATE INDEX IF NOT EXISTS ix_caution_tiers ON caution (cau_tiers_id);

-- Pointage d'une échéance par un règlement ou une caution (montant du signe de l'échéance).
CREATE TABLE IF NOT EXISTS pointage (
    poi_id          BIGSERIAL     PRIMARY KEY,
    poi_reg_id      BIGINT        REFERENCES reglement (reg_id) ON DELETE CASCADE,
    poi_cau_id      BIGINT        REFERENCES caution (cau_id) ON DELETE CASCADE,
    poi_echeance_id BIGINT        NOT NULL,
    poi_montant     NUMERIC(18,6) NOT NULL,
    CONSTRAINT pointage_une_source CHECK ((poi_reg_id IS NULL) <> (poi_cau_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_pointage_echeance ON pointage (poi_echeance_id);
