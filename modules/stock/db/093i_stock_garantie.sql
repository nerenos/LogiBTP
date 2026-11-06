-- =============================================================================
-- Module Stock, numéros de série et équipements installés, lot S24-d (plans/stock.md, lot 3 ; ANALYSE-MODULE-STOCK.md
-- § 11, S24.8) : durée de garantie, en mois, des équipements posés pour un article suivi (facultative, modifiable sur
-- l'équipement lui-même). Lue par le cœur à la création des équipements du module SAV. Rejouable.
-- =============================================================================

ALTER TABLE stk_article_suivi ADD COLUMN IF NOT EXISTS sas_garantie_mois INT CHECK (sas_garantie_mois IS NULL OR sas_garantie_mois BETWEEN 1 AND 600);
COMMENT ON COLUMN stk_article_suivi.sas_garantie_mois IS 'Durée de garantie des équipements posés (mois, S24-d) : proposée à la pose ; null = sans garantie';
