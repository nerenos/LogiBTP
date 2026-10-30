-- Module GED LogiBTP – pièce diffusée sur le terrain (plans, consignes, photos) : lue par l'application de terrain de
-- l'élément lié (ANALYSE-TERRAIN.md, T6). Rejouable.

ALTER TABLE document_ged ADD COLUMN IF NOT EXISTS dge_terrain BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS ix_dge_terrain ON document_ged (dge_type_element, dge_id_element) WHERE dge_terrain AND NOT dge_supprime;
