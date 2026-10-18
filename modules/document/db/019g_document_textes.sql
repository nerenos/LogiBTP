-- =============================================================================
-- Module Document – textes d'introduction et de conclusion (CONCEPTION-DOCUMENTS-EVOLUTIONS.md, lot E) : HTML avec
-- variables comme les libellés des lignes ; modèle par type recopié dans le document à sa création (puis modifiable),
-- repris à la transformation ; texte affiché (variables remplacées) calculé par le moteur et figé à la validation.
-- Placement à l'impression : introduction avant le bloc des lignes, conclusion après le pied et les récapitulatifs.
-- Rejouable.
-- =============================================================================

ALTER TABLE type_document ADD COLUMN IF NOT EXISTS tyd_texte_intro_html TEXT;
ALTER TABLE type_document ADD COLUMN IF NOT EXISTS tyd_texte_fin_html   TEXT;

ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_texte_intro_html TEXT;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_texte_intro      TEXT;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_texte_fin_html   TEXT;
ALTER TABLE document ADD COLUMN IF NOT EXISTS ent_texte_fin        TEXT;
