-- Module CRM LogiBTP – case « Terrain » d'un plan du suivi des validations (plan terrain-suites, lot 2, décision TS2 b) :
-- plan coché montré en tête des pièces de l'application de terrain (indice en vigueur seul). Rejouable.
ALTER TABLE crm_plan ADD COLUMN IF NOT EXISTS pla_terrain BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN crm_plan.pla_terrain IS 'Plan montré en tête sur le terrain (indice en vigueur seul)';
