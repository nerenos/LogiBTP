-- =============================================================================
-- Module Métré 1.1 – métré du document (plan metres-tranches-document, lot 1).
-- Un métré est rattaché soit à une ligne de l'hôte (mtr_lig_id), soit à son document (mtr_ent_id, mtr_lig_id NULL) :
-- le métré du document, un seul par document, publie ses variables en $$ (aucune quantité).
-- Les clés étrangères vers l'hôte sont posées par celui-ci (cœur : db/).
-- =============================================================================

ALTER TABLE metre ADD COLUMN mtr_ent_id BIGINT;                              -- document de l'hôte (métré sans ligne)
ALTER TABLE metre ALTER COLUMN mtr_lig_id DROP NOT NULL;
ALTER TABLE metre ADD CONSTRAINT ck_mtr_rattachement CHECK (mtr_lig_id IS NOT NULL OR mtr_ent_id IS NOT NULL);
CREATE UNIQUE INDEX ux_mtr_document ON metre (mtr_ent_id) WHERE mtr_lig_id IS NULL;
