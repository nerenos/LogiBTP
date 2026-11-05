-- =============================================================================
-- Module Stock, lots et numéros de série, lot S24-a (ANALYSE-MODULE-STOCK.md § 11, S24.1 à S24.12) : suivi de chaque
-- article (aucun, par lot, par numéro de série ; périssable et durée théorique de péremption), lots (numéro unique par
-- article et fournisseur, fabrication, date limite, coulée, norme), lot des mouvements et des comptages (null = sans
-- lot). La colonne réservée mvt_tracabilite est remplacée par mvt_lot_id. Articles et fournisseurs fournis par
-- l'application (clés étrangères posées par le cœur). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stk_article_suivi (
    sas_ele_id          BIGINT        PRIMARY KEY,
    sas_suivi           VARCHAR(5)    NOT NULL DEFAULT 'AUCUN' CHECK (sas_suivi IN ('AUCUN', 'LOT', 'SERIE')),
    sas_perissable      BOOLEAN       NOT NULL DEFAULT FALSE,
    sas_duree           INT           CHECK (sas_duree IS NULL OR sas_duree > 0),
    sas_unite           CHAR(1)       NOT NULL DEFAULT 'M' CHECK (sas_unite IN ('J', 'M')),
    sas_maj_par         VARCHAR(50),
    sas_maj_le          TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE stk_article_suivi IS 'Suivi d''un article géré en stock : par lot ou numéro de série, péremption (S24.1, S24.7) ; absent = aucun suivi';

CREATE TABLE IF NOT EXISTS stk_lot (
    lot_id              BIGSERIAL     PRIMARY KEY,
    lot_ele_id          BIGINT        NOT NULL,
    lot_numero          VARCHAR(60)   NOT NULL CHECK (btrim(lot_numero) <> ''),
    lot_tiers_id        BIGINT,                                          -- fournisseur (réception), sinon null
    lot_fabrication     DATE,
    lot_limite          DATE,                                            -- date limite d'utilisation (article périssable)
    lot_coulee          VARCHAR(60),                                     -- numéro de coulée (acier)
    lot_norme           VARCHAR(60),
    lot_commentaire     TEXT,
    lot_cree_par        VARCHAR(50)   NOT NULL,
    lot_cree_le         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    lot_maj_par         VARCHAR(50),
    lot_maj_le          TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lot_numero ON stk_lot (lot_ele_id, coalesce(lot_tiers_id, 0), upper(lot_numero));
COMMENT ON TABLE stk_lot IS 'Lot ou numéro de série d''un article (S24) : un numéro de série est un lot d''une unité';

ALTER TABLE stk_mouvement ADD COLUMN IF NOT EXISTS mvt_lot_id BIGINT REFERENCES stk_lot(lot_id) ON DELETE RESTRICT;
ALTER TABLE stk_comptage ADD COLUMN IF NOT EXISTS cpt_lot_id BIGINT REFERENCES stk_lot(lot_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS ix_mvt_lot ON stk_mouvement (mvt_lot_id) WHERE mvt_lot_id IS NOT NULL;
ALTER TABLE stk_mouvement DROP COLUMN IF EXISTS mvt_tracabilite;
