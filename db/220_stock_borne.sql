-- =============================================================================
-- Cœur – module Stock, lot 5 (ANALYSE-MODULE-STOCK.md § 5.5, S17, S18 ; liaison Pointage → Stock) : dépôt de stock de
-- chaque borne d'atelier (`poi_appareil.pap_stk_lieu_id`) ; pièces de stock saisies à la borne par un salarié : comptées
-- dès la saisie mais « à valider » par le responsable de son service ou un magasinier (`ent_stk_a_valider`, salarié
-- `ent_stk_salarie_id`, traitement : par, le, motif d'un refus). Rejouable.
-- =============================================================================

ALTER TABLE poi_appareil ADD COLUMN IF NOT EXISTS pap_stk_lieu_id INT REFERENCES chantier(cha_id) ON DELETE SET NULL;
COMMENT ON COLUMN poi_appareil.pap_stk_lieu_id IS 'Dépôt de stock de la borne : sorties et retours de l''atelier (module Stock)';

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_stk_a_valider BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_stk_salarie_id INT REFERENCES salarie(sal_id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_stk_traite_par VARCHAR(50);
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_stk_traite_le TIMESTAMPTZ;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_stk_motif TEXT;
COMMENT ON COLUMN document.ent_stk_a_valider IS 'Pièce de stock saisie à la borne : mouvements comptés, à valider par le chef de service ou le magasin (S17, S18)';
CREATE INDEX IF NOT EXISTS ix_ent_stk_a_valider ON document (ent_id) WHERE ent_stk_a_valider;
