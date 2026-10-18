-- =============================================================================
-- Module Bibliothèque – éléments POSTE_PIED (CONCEPTION-DOCUMENTS-EVOLUTIONS.md, lot C) : postes de pied réutilisables
-- (retenue de garantie, compte prorata, remise…) insérés dans le pied des documents. Niveau HT ou TTC, mode
-- (P pourcentage, M montant, C coefficient), base (cumul, total HT, HT net, total TTC), sens (déduction, ajout), valeur,
-- retenue, compte comptable, code du taux de TVA. Rejouable.
-- =============================================================================

ALTER TABLE element DROP CONSTRAINT IF EXISTS element_ele_type_check;
ALTER TABLE element ADD CONSTRAINT element_ele_type_check CHECK (ele_type IN ('ARTICLE','OUVRAGE','ENSEMBLE','POSTE_PIED'));

ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_pied_niveau  VARCHAR(3)  CHECK (ele_pied_niveau IN ('HT','TTC'));
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_pied_mode    CHAR(1)     CHECK (ele_pied_mode IN ('P','M','C'));
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_pied_base    VARCHAR(10) CHECK (ele_pied_base IN ('CUMUL','TOTAL_HT','HT_NET','TOTAL_TTC'));
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_pied_sens    VARCHAR(10) CHECK (ele_pied_sens IN ('DEDUCTION','AJOUT'));
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_pied_valeur  NUMERIC(18,6);
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_pied_retenue BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_cpt_code     VARCHAR(20);
ALTER TABLE element ADD COLUMN IF NOT EXISTS ele_tva_code     VARCHAR(10);
