-- =============================================================================
-- Cœur – module Stock, lot 4 (ANALYSE-MODULE-STOCK.md § 5.5, § 5.6, S16 à S19 ; module 093d) : affaire de gestion
-- « DOTATIONS » et chantier de dotation de chaque salarié (`salarie.sal_cha_dotation_id`, créé à la première sortie :
-- code DOT-<code du salarié>, tient un stock = ce qui est doté, statut CLOS pour rester hors des listes de pointage et
-- de planning), clé étrangère des articles de dotation. Rejouable.
-- =============================================================================

INSERT INTO affaire (aff_code, aff_libelle, aff_nature, aff_commentaire)
VALUES ('DOTATIONS', 'Dotations des salariés', 'G', 'Affaire de gestion des dotations (EPI, outillage) : un chantier par salarié (module Stock)')
ON CONFLICT (aff_code) DO NOTHING;

ALTER TABLE salarie ADD COLUMN IF NOT EXISTS sal_cha_dotation_id INT REFERENCES chantier(cha_id) ON DELETE SET NULL;
COMMENT ON COLUMN salarie.sal_cha_dotation_id IS 'Chantier de dotation du salarié (module Stock) : son stock = EPI et outillage dotés non rendus';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sad_element') THEN
        ALTER TABLE stk_article_dotation ADD CONSTRAINT fk_sad_element FOREIGN KEY (sad_ele_id) REFERENCES element(ele_id) ON DELETE CASCADE;
    END IF;
END $$;
