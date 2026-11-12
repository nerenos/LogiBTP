-- =============================================================================
-- Cœur – facturation électronique, lot 28 (plans/facturation-electronique.md, Q20) : e-reporting des ventes B2C et
-- internationales et de leurs encaissements (flux 10.1 à 10.4), collectés, extraits et transmis à la plateforme agréée
-- par LogiBTP, en un envoi ou en plusieurs envois par période (découpage : paramètre du module, fpa_decoupage_ereporting).
-- Rejouable.
--
-- - facture_electronique_ereporting_option (une ligne) : régime de TVA de la société (REGIME_EREPORTING du module, fixe
--   la périodicité), matricule de la plateforme agréée (schéma 0238, émetteur TT-7 de la transmission).
-- - ereporting_periode : une période par nature (TRANSACTIONS : 10.1 et 10.3 ; PAIEMENTS : 10.2 et 10.4) et par début ;
--   rang de correction en cours (0 : transmission initiale IN, n : n-ième rectificative RE), essai en cours (relance
--   après un rejet), résumé et écarts du contrôle de la dernière préparation. L'état affiché (préparée, envoyée,
--   acceptée, rejetée) se lit des flux des envois de l'essai en cours.
-- - ereporting_envoi : transmissions préparées (XML du flux 10 gardé tel qu'il partira), une par sous-flux et par période
--   (UNIQUE) ou par sous-flux et par jour (PLUSIEURS) ; flux du module une fois mis en file.
-- =============================================================================

CREATE TABLE IF NOT EXISTS facture_electronique_ereporting_option (
    ero_id         SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (ero_id = 1),
    ero_regime     VARCHAR(30)  NOT NULL DEFAULT 'REEL_NORMAL_MENSUEL',
    ero_matricule  VARCHAR(4),
    ero_modifie_le TIMESTAMPTZ  NOT NULL DEFAULT now()
);
ALTER TABLE facture_electronique_ereporting_option DROP CONSTRAINT IF EXISTS facture_electronique_ereporting_option_regime_check;
ALTER TABLE facture_electronique_ereporting_option ADD CONSTRAINT facture_electronique_ereporting_option_regime_check
    CHECK (ero_regime IN ('REEL_NORMAL_MENSUEL', 'REEL_NORMAL_TRIMESTRIEL', 'SIMPLIFIE', 'FRANCHISE'));
INSERT INTO facture_electronique_ereporting_option (ero_id) VALUES (1) ON CONFLICT (ero_id) DO NOTHING;
COMMENT ON TABLE facture_electronique_ereporting_option IS 'E-reporting : régime de TVA de la société (périodicité) et matricule de la plateforme (lot 28)';

CREATE TABLE IF NOT EXISTS ereporting_periode (
    erp_id          BIGSERIAL    PRIMARY KEY,
    erp_nature      VARCHAR(15)  NOT NULL,
    erp_debut       DATE         NOT NULL,
    erp_fin         DATE         NOT NULL,
    erp_regime      VARCHAR(30)  NOT NULL,
    erp_correction  INT          NOT NULL DEFAULT 0,
    erp_essai       INT          NOT NULL DEFAULT 1,
    erp_resume      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    erp_ecarts      JSONB        NOT NULL DEFAULT '[]'::jsonb,
    erp_prepare_le  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    erp_prepare_par VARCHAR(50)  NOT NULL DEFAULT '',
    erp_envoye_le   TIMESTAMPTZ,
    erp_envoye_par  VARCHAR(50),
    CONSTRAINT uq_erp_periode UNIQUE (erp_nature, erp_debut)
);
ALTER TABLE ereporting_periode DROP CONSTRAINT IF EXISTS ereporting_periode_nature_check;
ALTER TABLE ereporting_periode ADD CONSTRAINT ereporting_periode_nature_check CHECK (erp_nature IN ('TRANSACTIONS', 'PAIEMENTS'));
COMMENT ON TABLE ereporting_periode IS 'E-reporting : période déclarée (transactions ou paiements), correction et essai en cours (lot 28, Q20)';
COMMENT ON COLUMN ereporting_periode.erp_envoye_le IS 'Envoi de l''essai en cours (null : préparée, pas encore envoyée)';

CREATE TABLE IF NOT EXISTS ereporting_envoi (
    ere_id          BIGSERIAL    PRIMARY KEY,
    ere_erp_id      BIGINT       NOT NULL REFERENCES ereporting_periode (erp_id) ON DELETE CASCADE,
    ere_correction  INT          NOT NULL,
    ere_essai       INT          NOT NULL,
    ere_sous_flux   VARCHAR(4)   NOT NULL,
    ere_type_flux   VARCHAR(60)  NOT NULL,
    ere_jour        DATE,
    ere_identifiant VARCHAR(50)  NOT NULL,
    ere_type        VARCHAR(2)   NOT NULL,
    ere_elements    INT          NOT NULL DEFAULT 0,
    ere_contenu     BYTEA        NOT NULL,
    ere_flux_id     BIGINT       REFERENCES fe_flux (ffl_id) ON DELETE SET NULL,
    ere_cree_le     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ere_periode ON ereporting_envoi (ere_erp_id, ere_correction, ere_essai);
COMMENT ON TABLE ereporting_envoi IS 'E-reporting : transmissions du flux 10 préparées puis mises en file (lot 28)';
COMMENT ON COLUMN ereporting_envoi.ere_contenu IS 'XML du flux 10 (TB-0) tel qu''il est déposé';
