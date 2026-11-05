-- =============================================================================
-- Module Stock, lots et numéros de série, lot S24-c (ANALYSE-MODULE-STOCK.md § 11, S24.5 à S24.7) : certificat exigé
-- par article, délai d'alerte de péremption par lieu (30 jours par défaut), stock présent par lot et lieu
-- (v_stk_stock_lot, ensembliste : dernier comptage de l'article dans le lieu réparti par lot, puis mouvements du lot
-- postérieurs ; même règle que stockParLot / ReglesTracabilite.StockParLot), copies des certificats d'un lot dans la
-- GED des chantiers où il est sorti (une par lot, chantier et certificat). Rejouable.
-- =============================================================================

ALTER TABLE stk_article_suivi ADD COLUMN IF NOT EXISTS sas_certificat BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN stk_article_suivi.sas_certificat IS 'Certificat matière exigé pour chaque lot (S24.5) : lot sans certificat signalé';

ALTER TABLE stk_lieu_parametre ADD COLUMN IF NOT EXISTS slp_alerte_peremption INT NOT NULL DEFAULT 30 CHECK (slp_alerte_peremption >= 0);
COMMENT ON COLUMN stk_lieu_parametre.slp_alerte_peremption IS 'Délai d''alerte avant la date limite des lots périssables (jours, S24.7)';

CREATE OR REPLACE VIEW v_stk_stock_lot AS
WITH dc AS (
    SELECT DISTINCT ON (cpt_ele_id, cpt_lieu_id) cpt_ele_id AS ele, cpt_lieu_id AS lieu, date_trunc('minute', cpt_date) AS d
    FROM stk_comptage WHERE cpt_date <= now()
    ORDER BY cpt_ele_id, cpt_lieu_id, cpt_date DESC, cpt_id DESC
), base AS (
    SELECT l.cpl_lot_id AS lot, c.cpt_lieu_id AS lieu, sum(l.cpl_quantite) AS q
    FROM stk_comptage c JOIN dc ON dc.ele = c.cpt_ele_id AND dc.lieu = c.cpt_lieu_id AND date_trunc('minute', c.cpt_date) = dc.d
    JOIN stk_comptage_lot l ON l.cpl_cpt_id = c.cpt_id
    GROUP BY l.cpl_lot_id, c.cpt_lieu_id
), mv AS (
    SELECT m.mvt_lot_id AS lot, m.mvt_lieu_id AS lieu, sum(m.mvt_quantite) AS q
    FROM stk_mouvement m LEFT JOIN dc ON dc.ele = m.mvt_ele_id AND dc.lieu = m.mvt_lieu_id
    WHERE m.mvt_lot_id IS NOT NULL AND m.mvt_date <= now() AND (dc.d IS NULL OR date_trunc('minute', m.mvt_date) > dc.d)
    GROUP BY m.mvt_lot_id, m.mvt_lieu_id
)
SELECT coalesce(b.lot, v.lot) AS lot_id, coalesce(b.lieu, v.lieu) AS lieu_id, coalesce(b.q, 0) + coalesce(v.q, 0) AS quantite
FROM base b FULL JOIN mv v ON v.lot = b.lot AND v.lieu = b.lieu
WHERE coalesce(b.q, 0) + coalesce(v.q, 0) <> 0;
COMMENT ON VIEW v_stk_stock_lot IS 'Stock présent par lot et lieu (S24) : lots non nuls ; le sans lot n''y figure pas';

CREATE TABLE IF NOT EXISTS stk_lot_certificat_copie (
    slc_lot_id          BIGINT        NOT NULL REFERENCES stk_lot(lot_id) ON DELETE CASCADE,
    slc_lieu_id         BIGINT        NOT NULL,
    slc_dge_source      BIGINT        NOT NULL,
    slc_dge_copie       BIGINT,
    slc_le              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (slc_lot_id, slc_lieu_id, slc_dge_source)
);
COMMENT ON TABLE stk_lot_certificat_copie IS 'Certificats d''un lot copiés dans la GED d''un chantier où le lot est sorti (S24.6)';
