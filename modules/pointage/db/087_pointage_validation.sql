-- =============================================================================
-- Module Pointage, lot 2 : synthèse et validation. Couche validée d'une semaine (créée à la première modification du
-- RH ou du chef : poi_semaine), validations par période (simple ou double, annulation tracée avec motif), demandes de
-- correction (pointage refusé car validé entre-temps), journal des actions de la synthèse. Rejouable.
-- =============================================================================

ALTER TABLE poi_parametre ADD COLUMN IF NOT EXISTS ppa_seuil_semaine SMALLINT NOT NULL DEFAULT 2100;
COMMENT ON COLUMN poi_parametre.ppa_seuil_semaine IS 'Seuil hebdomadaire des heures supplémentaires (minutes) : exception de la synthèse';

-- Semaine corrigée : la couche VALIDE remplace la couche SAISIE pour ce salarié et cette semaine (même vide).
CREATE TABLE IF NOT EXISTS poi_semaine (
    psm_sal_id     INT         NOT NULL,
    psm_lundi      DATE        NOT NULL,
    psm_corrige_par VARCHAR(50) NOT NULL,
    psm_corrige_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (psm_sal_id, psm_lundi)
);

CREATE TABLE IF NOT EXISTS poi_validation (
    pvl_id           BIGSERIAL PRIMARY KEY,
    pvl_sal_id       INT         NOT NULL,
    pvl_du           DATE        NOT NULL,
    pvl_au           DATE        NOT NULL CHECK (pvl_au >= pvl_du),
    pvl_niveau       VARCHAR(4)  NOT NULL CHECK (pvl_niveau IN ('CHEF', 'RH')),
    pvl_par          VARCHAR(50) NOT NULL,
    pvl_le           TIMESTAMPTZ NOT NULL DEFAULT now(),
    pvl_annule_par   VARCHAR(50),
    pvl_annule_le    TIMESTAMPTZ,
    pvl_annule_motif VARCHAR(300),
    CHECK ((pvl_annule_le IS NULL) = (pvl_annule_par IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_pvl_sal ON poi_validation (pvl_sal_id, pvl_du, pvl_au);

CREATE TABLE IF NOT EXISTS poi_correction (
    pco_id         BIGSERIAL PRIMARY KEY,
    pco_sal_id     INT         NOT NULL,
    pco_lundi      DATE        NOT NULL,
    pco_pointages  JSONB       NOT NULL,
    pco_motif      VARCHAR(300),
    pco_par        VARCHAR(50) NOT NULL,
    pco_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
    pco_etat       VARCHAR(10) NOT NULL DEFAULT 'EN_ATTENTE' CHECK (pco_etat IN ('EN_ATTENTE', 'APPLIQUEE', 'REJETEE')),
    pco_traite_par VARCHAR(50),
    pco_traite_le  TIMESTAMPTZ,
    pco_reponse    VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS ix_pco_attente ON poi_correction (pco_lundi, pco_sal_id) WHERE pco_etat = 'EN_ATTENTE';

CREATE TABLE IF NOT EXISTS poi_journal (
    pjo_id     BIGSERIAL PRIMARY KEY,
    pjo_sal_id INT         NOT NULL,
    pjo_lundi  DATE        NOT NULL,
    pjo_action VARCHAR(20) NOT NULL,
    pjo_detail JSONB       NOT NULL DEFAULT '{}',
    pjo_par    VARCHAR(50) NOT NULL,
    pjo_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN poi_journal.pjo_action IS 'MODIFIER (couche validée), VALIDER, DEVALIDER, CORRECTION, CORRECTION_APPLIQUEE, CORRECTION_REJETEE';
CREATE INDEX IF NOT EXISTS ix_pjo_sal ON poi_journal (pjo_sal_id, pjo_lundi);
