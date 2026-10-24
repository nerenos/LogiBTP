-- =============================================================================
-- Module Stock, lot 4 (ANALYSE-MODULE-STOCK.md § 5.6, S16, S19, S27) : articles de dotation (EPI, outillage
-- consommable, non identifiés) : type de dotation et durée de vie en mois (renouvellement, lot 5). Les dotations sont
-- des transferts vers le lieu de stock du salarié (fourni par l'application) ; les retours, des transferts vers le dépôt
-- (réutilisable) ou des sorties (rebut). Rejouable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stk_article_dotation (
    sad_ele_id          BIGINT        PRIMARY KEY,
    sad_type            VARCHAR(10)   NOT NULL CHECK (sad_type IN ('EPI', 'OUTILLAGE')),
    sad_duree_mois      INT           CHECK (sad_duree_mois IS NULL OR sad_duree_mois > 0)
);
