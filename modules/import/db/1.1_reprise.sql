-- Module Import 1.1 – reprise d'une base d'un autre logiciel (plan reprise-mde-optim, lot 1).
-- import_reprise : une ligne par exécution (simulation ou reprise réelle), rapport complet en jsonb.
-- import_correspondance : clé d'origine de chaque ligne reprise (jointures de la reprise, traçabilité, reprise incrémentale).
-- import_fusion : groupes de doublons retenus par l'utilisateur avant la reprise (fiche conservée, fiches fusionnées).

CREATE TABLE IF NOT EXISTS import_reprise (
    irp_id            BIGSERIAL     PRIMARY KEY,
    irp_source        VARCHAR(10)   NOT NULL,
    irp_societes      JSONB         NOT NULL DEFAULT '[]'::jsonb,
    irp_simulation    BOOLEAN       NOT NULL,
    irp_etat          VARCHAR(20)   NOT NULL,
    irp_debut         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    irp_fin           TIMESTAMPTZ,
    irp_auteur        VARCHAR(100),
    irp_rapport       JSONB
);
COMMENT ON TABLE import_reprise IS 'Exécutions de la reprise d''une base d''un autre logiciel (simulation ou réelle) et leur rapport';

CREATE TABLE IF NOT EXISTS import_correspondance (
    imc_id            BIGSERIAL     PRIMARY KEY,
    imc_irp_id        BIGINT        NOT NULL REFERENCES import_reprise(irp_id) ON DELETE CASCADE,
    imc_table_source  VARCHAR(100)  NOT NULL,
    imc_cle_source    VARCHAR(200)  NOT NULL,
    imc_table_cible   VARCHAR(100)  NOT NULL,
    imc_id_cible      BIGINT        NOT NULL,
    CONSTRAINT ux_imc_source UNIQUE (imc_irp_id, imc_table_source, imc_cle_source)
);
CREATE INDEX IF NOT EXISTS ix_imc_cible ON import_correspondance (imc_table_cible, imc_id_cible);
COMMENT ON TABLE import_correspondance IS 'Clé d''origine de chaque ligne reprise d''une base source';

CREATE TABLE IF NOT EXISTS import_fusion (
    ifu_id            BIGSERIAL     PRIMARY KEY,
    ifu_source        VARCHAR(10)   NOT NULL,
    ifu_table_source  VARCHAR(100)  NOT NULL,
    ifu_cle_conservee VARCHAR(200)  NOT NULL,
    ifu_cles_fusionnees JSONB       NOT NULL,
    ifu_cree_le       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE import_fusion IS 'Doublons de la base source à fusionner lors de la reprise (choix de l''utilisateur)';
