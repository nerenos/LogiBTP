-- =============================================================================
-- Module Comptabilité (base) : catégorie de TVA EN 16931 et motif d'exonération VATEX des catégories de TVA
-- (plans/facturation-electronique.md, lot 10, Q9). La catégorie (S, E, AE, K, G, O, Z) et le code VATEX sont des
-- données fiscales du module, lues par l'export et par la facture électronique. Valeurs proposées depuis le
-- comportement (N → S, A et I → AE, E → E) seulement quand elles sont vides. Rejouable.
-- =============================================================================

ALTER TABLE categorie_tva ADD COLUMN IF NOT EXISTS ctv_categorie_en16931 VARCHAR(2);
ALTER TABLE categorie_tva ADD COLUMN IF NOT EXISTS ctv_vatex VARCHAR(40);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categorie_tva_ctv_categorie_en16931_ck') THEN
        ALTER TABLE categorie_tva ADD CONSTRAINT categorie_tva_ctv_categorie_en16931_ck
            CHECK (ctv_categorie_en16931 IS NULL OR ctv_categorie_en16931 IN ('S', 'E', 'AE', 'K', 'G', 'O', 'Z'));
    END IF;
END $$;

UPDATE categorie_tva SET ctv_categorie_en16931 = CASE ctv_comportement
        WHEN 'N' THEN 'S' WHEN 'E' THEN 'E' ELSE 'AE' END
    WHERE ctv_categorie_en16931 IS NULL OR ctv_categorie_en16931 = '';

UPDATE categorie_tva SET ctv_vatex = CASE ctv_categorie_en16931
        WHEN 'AE' THEN 'VATEX-FR-AE' WHEN 'E' THEN 'VATEX-EU-132' END
    WHERE (ctv_vatex IS NULL OR ctv_vatex = '') AND ctv_categorie_en16931 IN ('AE', 'E');

COMMENT ON COLUMN categorie_tva.ctv_categorie_en16931 IS 'Catégorie de TVA EN 16931 (BT-151 / BT-118) : S, E, AE, K, G, O, Z';
COMMENT ON COLUMN categorie_tva.ctv_vatex IS 'Code VATEX du motif d''exonération ou d''autoliquidation (BT-121), ex. VATEX-FR-AE';
