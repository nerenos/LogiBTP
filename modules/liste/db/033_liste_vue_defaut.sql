-- =============================================================================
-- Module Liste – vue par défaut d'un thème (ergonomie L1, Q1) : ouverte d'un clic sur le thème quand l'utilisateur
-- n'a pas marqué la sienne (★, préférence du navigateur) ; sans elle, la première vue du thème.
-- =============================================================================

ALTER TABLE theme_liste ADD COLUMN IF NOT EXISTS thl_vli_defaut BIGINT REFERENCES vue_liste(vli_id) ON DELETE SET NULL;
